const embedBuilder = require('./embedBuilder');
const ticketManager = require('./ticketManager');
const db = require('../database/db');

// Map of channelId -> { timeoutId, stage, userId }
const activeTimers = new Map();

// 5 minutes in milliseconds (300,000 ms)
const FIRST_INACTIVITY_MS = 5 * 60 * 1000;
const SECOND_INACTIVITY_MS = 5 * 60 * 1000;

class ResolutionManager {
  /**
   * Starts the 2-stage resolution & inactivity flow for a ticket.
   * Stage 1: Sends resolution prompt, waits 5m.
   * Stage 2: If no reply in 5m, tags user with reminder, waits another 5m.
   * Stage 3: If still no reply, auto-closes ticket.
   *
   * @param {import('discord.js').TextChannel} channel 
   * @param {string} userId 
   */
  async startResolutionFlow(channel, userId) {
    this.clearTimers(channel.id);

    // 1. Send resolution prompt embed with buttons
    const prompt = embedBuilder.createResolutionPrompt(userId);
    await channel.send(prompt).catch((err) => console.warn('Could not send resolution prompt:', err.message));

    // 2. Schedule Stage 1 timer (5 minutes)
    const timeoutId = setTimeout(async () => {
      await this._handleFirstTimeout(channel, userId);
    }, FIRST_INACTIVITY_MS);

    activeTimers.set(channel.id, {
      timeoutId,
      stage: 1,
      userId
    });
  }

  /**
   * Handles first 5-minute timeout: pings user with reminder and sets second 5m timer.
   */
  async _handleFirstTimeout(channel, userId) {
    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed') {
      this.clearTimers(channel.id);
      return;
    }

    // Send reminder tagging the user
    const reminder = embedBuilder.createInactivityReminder(userId);
    await channel.send(reminder).catch((err) => console.warn('Could not send inactivity reminder:', err.message));

    // Schedule Stage 2 timer (another 5 minutes)
    const timeoutId = setTimeout(async () => {
      await this._handleSecondTimeout(channel, userId);
    }, SECOND_INACTIVITY_MS);

    activeTimers.set(channel.id, {
      timeoutId,
      stage: 2,
      userId
    });
  }

  /**
   * Handles second 5-minute timeout: auto-closes the ticket due to inactivity.
   */
  async _handleSecondTimeout(channel, userId) {
    this.clearTimers(channel.id);

    const ticket = db.getTicket(channel.id);
    if (!ticket || ticket.status === 'closed') {
      return;
    }

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

  /**
   * Clears any active resolution timers for a channel (called when user sends a message or interacts).
   * @param {string} channelId 
   */
  clearTimers(channelId) {
    if (activeTimers.has(channelId)) {
      const entry = activeTimers.get(channelId);
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      activeTimers.delete(channelId);
    }
  }

  /**
   * Checks if a channel has an active resolution timer.
   * @param {string} channelId 
   */
  hasActivePrompt(channelId) {
    return activeTimers.has(channelId);
  }
}

module.exports = new ResolutionManager();
