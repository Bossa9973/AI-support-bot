const embedBuilder = require('./embedBuilder');
const ticketManager = require('./ticketManager');
const db = require('../database/db');
const config = require('../config');

// In-memory active timers: channelId -> Map<timerKey, timeoutId>
const channelTimers = new Map();

// Default timing constants (can be overridden via config / env)
const DEFAULT_USER_INACTIVITY_MS = 60 * 60 * 1000;   // 1 hour after staff reply
const DEFAULT_USER_GRACE_MS      = 15 * 60 * 1000;   // 15 minutes grace period after warning tag
const DEFAULT_TEAM_PING_MS       = 60 * 60 * 1000;   // 1 hour recurring ping for unclaimed handoffs
const DEFAULT_UNCLAIMED_MAX_MS   = 3 * 60 * 60 * 1000; // 3 hours max unclaimed before auto-close

// Legacy AI prompt timings
const AI_FIRST_PROMPT_MS         = 5 * 60 * 1000;
const AI_SECOND_PROMPT_MS        = 5 * 60 * 1000;

class ResolutionManager {
  constructor() {
    this._bgInterval = null;
  }

  getUserInactivityMs() {
    return config.tickets?.userInactivityMs || DEFAULT_USER_INACTIVITY_MS;
  }

  getUserGraceMs() {
    return config.tickets?.userGraceMs || DEFAULT_USER_GRACE_MS;
  }

  getTeamPingMs() {
    return config.tickets?.teamPingIntervalMs || DEFAULT_TEAM_PING_MS;
  }

  getUnclaimedMaxMs() {
    return config.tickets?.unclaimedMaxMs || DEFAULT_UNCLAIMED_MAX_MS;
  }

  /**
   * Helper to set a named timer for a channel.
   */
  _setTimer(channelId, key, callback, delayMs) {
    if (!channelTimers.has(channelId)) {
      channelTimers.set(channelId, new Map());
    }
    const map = channelTimers.get(channelId);
    if (map.has(key)) {
      clearTimeout(map.get(key));
    }
    const timeoutId = setTimeout(callback, delayMs);
    map.set(key, timeoutId);
    return timeoutId;
  }

  /**
   * Helper to clear a named timer or all timers for a channel.
   */
  _clearTimer(channelId, key) {
    if (channelTimers.has(channelId)) {
      const map = channelTimers.get(channelId);
      if (key) {
        if (map.has(key)) {
          clearTimeout(map.get(key));
          map.delete(key);
        }
      } else {
        map.forEach((tid) => clearTimeout(tid));
        channelTimers.delete(channelId);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. STAFF REPLY & USER INACTIVITY FLOW (1h alert -> grace period -> close+delete)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Called when a staff member sends a message in a ticket.
   * Starts a 1-hour countdown for user reply.
   *
   * @param {import('discord.js').TextChannel} channel
   * @param {import('discord.js').User|object} staffUser
   */
  async onStaffReply(channel, staffUser) {
    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed' || ticket.noAutoClose) return;

    // Clear legacy AI resolution timer
    this._clearTimer(channel.id, 'ai_resolve');
    this._clearTimer(channel.id, 'user_grace');

    const now = new Date().toISOString();
    db.updateTicket(channel.id, {
      lastStaffReplyAt: now,
      lastMessageIsStaff: true,
      lastActivityAt: now,
      userInactivityWarned: false
    });

    const delayMs = this.getUserInactivityMs();

    this._setTimer(channel.id, 'user_inactivity', async () => {
      await this._handleUserInactivityWarning(channel, ticket.userId);
    }, delayMs);
  }

  /**
   * Fires after 1 hour of user inactivity following a staff reply.
   * Tags user with warning and sets grace period before close and deletion.
   */
  async _handleUserInactivityWarning(channel, userId) {
    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed' || ticket.noAutoClose) {
      this._clearTimer(channel.id, 'user_inactivity');
      return;
    }

    db.updateTicket(channel.id, { userInactivityWarned: true });

    try {
      await channel.send({
        content: `<@${userId}> ⏰ **Ticket Inactivity Warning**\n\n` +
                 `Our staff replied 1 hour ago. If you still need assistance, please reply to this ticket.\n` +
                 `If no response is received, this ticket will be automatically closed and deleted.`,
        allowedMentions: { users: [userId] }
      });
    } catch (err) {
      console.warn(`[ResolutionManager] Could not send inactivity warning to ${channel.id}:`, err.message);
    }

    const graceMs = this.getUserGraceMs();

    this._setTimer(channel.id, 'user_grace', async () => {
      await this._handleUserInactivityCloseAndDelete(channel, userId);
    }, graceMs);
  }

  /**
   * Fires after grace period expires with no user response: closes and deletes ticket.
   */
  async _handleUserInactivityCloseAndDelete(channel, userId) {
    this.clearTimers(channel.id);

    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed' || ticket.noAutoClose) return;

    try {
      await channel.send({
        content: `🔒 **Ticket Inactive** — No reply was received from <@${userId}> following the staff response. Closing and deleting ticket channel...`
      }).catch(() => {});

      await ticketManager.closeTicket(
        channel,
        channel.client.user,
        'Auto-closed due to 1 hour user inactivity after staff response'
      );

      // Auto-delete the ticket channel
      await ticketManager.deleteTicket(channel, channel.client.user);
    } catch (err) {
      console.error(`[ResolutionManager] Error closing/deleting inactive ticket ${channel.id}:`, err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. TEAM HANDOFF & UNCLAIMED INACTIVITY FLOW (1h pings -> 3h auto-close+delete)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Called when a ticket is escalated/handed over to the team or unassigned.
   * Pings the support team role every 1 hour and auto-closes after 3 hours if unclaimed.
   *
   * @param {import('discord.js').TextChannel} channel
   */
  async onTeamHandoff(channel) {
    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed' || ticket.noAutoClose) return;

    const now = new Date().toISOString();
    const handoffTime = ticket.handedOverToTeamAt || now;

    db.updateTicket(channel.id, {
      handedOverToTeamAt: handoffTime,
      lastTeamPingAt: now,
      unclaimedSince: handoffTime,
      claimedBy: null
    });

    this._scheduleNextTeamPing(channel);
    this._scheduleUnclaimedMaxTimeout(channel);
  }

  /**
   * Schedules next 1-hour recurring team role ping.
   */
  _scheduleNextTeamPing(channel) {
    const pingDelayMs = this.getTeamPingMs();

    this._setTimer(channel.id, 'team_ping', async () => {
      const ticket = db.getTicket(channel.id);
      if (!ticket || ticket.status === 'closed' || ticket.claimedBy || ticket.noAutoClose) {
        this._clearTimer(channel.id, 'team_ping');
        return;
      }

      const roleTag = config.tickets.supportRoleId ? `<@&${config.tickets.supportRoleId}>` : '**Staff Team**';
      try {
        await channel.send({
          content: `${roleTag} ⏳ **Staff Attention Reminder**\n` +
                   `This ticket was handed over to the team and is still waiting for staff assistance. Please claim or respond!`,
          allowedMentions: config.tickets.supportRoleId ? { roles: [config.tickets.supportRoleId] } : { parse: [] }
        });
        db.updateTicket(channel.id, { lastTeamPingAt: new Date().toISOString() });
      } catch (err) {
        console.warn(`[ResolutionManager] Could not send team ping to ${channel.id}:`, err.message);
      }

      // Schedule next recurring ping
      this._scheduleNextTeamPing(channel);
    }, pingDelayMs);
  }

  /**
   * Schedules the 3-hour unclaimed timeout to close and delete the ticket if no admin/staff responded.
   */
  _scheduleUnclaimedMaxTimeout(channel) {
    const maxDelayMs = this.getUnclaimedMaxMs();

    this._setTimer(channel.id, 'unclaimed_max', async () => {
      const ticket = db.getTicket(channel.id);
      if (!ticket || ticket.status === 'closed' || ticket.claimedBy || ticket.noAutoClose) {
        this._clearTimer(channel.id, 'unclaimed_max');
        return;
      }

      try {
        await channel.send({
          content: `🔒 **Unclaimed Ticket Timeout** — This ticket was unclaimed for 3 hours of inactivity. Closing and archiving channel...`
        }).catch(() => {});

        await ticketManager.closeTicket(
          channel,
          channel.client.user,
          'Auto-closed due to 3 hours unclaimed inactivity'
        );

        await ticketManager.deleteTicket(channel, channel.client.user);
      } catch (err) {
        console.error(`[ResolutionManager] Error auto-closing unclaimed ticket ${channel.id}:`, err);
      }
    }, maxDelayMs);
  }

  /**
   * Called when a staff member claims the ticket.
   * Cancels unclaimed team pings and 3-hour timeout.
   *
   * @param {import('discord.js').TextChannel} channel
   * @param {import('discord.js').User|object} staffUser
   */
  onTicketClaimed(channel, staffUser) {
    this._clearTimer(channel.id, 'team_ping');
    this._clearTimer(channel.id, 'unclaimed_max');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. USER MESSAGE EVENT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Called when the ticket creator (user) sends a message.
   * Clears any active user-inactivity warnings and resets timers.
   *
   * @param {import('discord.js').TextChannel} channel
   * @param {import('discord.js').User} user
   */
  onUserMessage(channel, user) {
    this._clearTimer(channel.id, 'user_inactivity');
    this._clearTimer(channel.id, 'user_grace');
    this._clearTimer(channel.id, 'ai_resolve');

    db.updateTicket(channel.id, {
      lastActivityAt: new Date().toISOString(),
      lastMessageIsStaff: false,
      userInactivityWarned: false
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. /no_auto_close COMMAND SUPPORT
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Toggles or sets noAutoClose status on a ticket.
   *
   * @param {string} channelId
   * @param {boolean|null} [forcedState=null]
   * @returns {boolean} new noAutoClose state
   */
  toggleNoAutoClose(channelId, forcedState = null) {
    const ticket = db.getTicket(channelId);
    if (!ticket) return false;

    const newState = forcedState !== null ? !!forcedState : !ticket.noAutoClose;
    db.updateTicket(channelId, { noAutoClose: newState });

    if (newState) {
      // Clear all active auto-close timers
      this.clearTimers(channelId);
    }

    return newState;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. LEGACY AI RESOLUTION FLOW (5m buttons -> 5m reminder -> close)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Starts the 2-stage AI resolution & inactivity flow for a ticket.
   * @param {import('discord.js').TextChannel} channel 
   * @param {string} userId 
   */
  async startResolutionFlow(channel, userId) {
    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed' || ticket.noAutoClose) return;

    this.clearTimers(channel.id);

    // 1. Send resolution prompt embed with buttons
    const prompt = embedBuilder.createResolutionPrompt(userId);
    await channel.send(prompt).catch((err) => console.warn('Could not send resolution prompt:', err.message));

    // 2. Schedule Stage 1 timer (5 minutes)
    this._setTimer(channel.id, 'ai_resolve', async () => {
      await this._handleFirstTimeout(channel, userId);
    }, AI_FIRST_PROMPT_MS);
  }

  async _handleFirstTimeout(channel, userId) {
    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed' || ticket.noAutoClose) {
      this.clearTimers(channel.id);
      return;
    }

    const reminder = embedBuilder.createInactivityReminder(userId);
    await channel.send(reminder).catch((err) => console.warn('Could not send inactivity reminder:', err.message));

    this._setTimer(channel.id, 'ai_resolve', async () => {
      await this._handleSecondTimeout(channel, userId);
    }, AI_SECOND_PROMPT_MS);
  }

  async _handleSecondTimeout(channel, userId) {
    this.clearTimers(channel.id);

    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed' || ticket.noAutoClose) return;

    try {
      await channel.send('🔒 **This ticket was automatically closed due to 10 minutes of inactivity after resolution.**').catch(() => {});
      await ticketManager.closeTicket(
        channel,
        channel.client.user,
        'Automatically closed due to inactivity after issue resolution'
      );
    } catch (err) {
      console.error('Error auto-closing inactive ticket:', err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. GENERAL HELPERS & LIFECYCLE
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Clears any active timers for a channel.
   * @param {string} channelId 
   */
  clearTimers(channelId) {
    this._clearTimer(channelId, null);
  }

  /**
   * Checks if a channel has any active timers.
   * @param {string} channelId 
   */
  hasActivePrompt(channelId) {
    return channelTimers.has(channelId) && channelTimers.get(channelId).size > 0;
  }
}

module.exports = new ResolutionManager();
