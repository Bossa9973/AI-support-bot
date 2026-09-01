/**
 * inviteTracker.js — Happy Hour Invite Snapshot & Tracking Engine
 *
 * Tracks Discord guild invites specifically for active Happy Hour events.
 * Snapshots all guild invite uses milliseconds before Happy Hour starts,
 * then tracks new invite uses/joins during the event to calculate
 * exact event-scoped invite deltas per user.
 */

const { Collection } = require('discord.js');
const db = require('../database/db');

// In-memory invite cache: guildId -> Collection<code, Invite>
const guildInviteCache = new Map();

/**
 * Cache all current invites for a guild.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<Collection<string, import('discord.js').Invite>>}
 */
async function cacheGuildInvites(guild) {
  if (!guild || !guild.invites) return new Collection();
  try {
    const invites = await guild.invites.fetch().catch(() => new Collection());
    guildInviteCache.set(guild.id, invites);
    return invites;
  } catch (err) {
    console.warn(`[InviteTracker] Could not fetch invites for guild ${guild.id}:`, err.message);
    return new Collection();
  }
}

/**
 * Capture an invite snapshot of the guild at the exact start of Happy Hour.
 * Returns { timestamp, codeUses, userTotals }.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ timestamp: number, codeUses: Record<string, number>, userTotals: Record<string, number> }>}
 */
async function snapshotGuildInvites(guild) {
  const snapshot = {
    timestamp: Date.now(),
    codeUses: {},
    userTotals: {}
  };

  if (!guild || !guild.invites) return snapshot;

  try {
    const invites = await guild.invites.fetch().catch(() => new Collection());
    guildInviteCache.set(guild.id, invites);

    invites.forEach((inv) => {
      const uses = inv.uses || 0;
      snapshot.codeUses[inv.code] = uses;
      if (inv.inviter?.id) {
        snapshot.userTotals[inv.inviter.id] = (snapshot.userTotals[inv.inviter.id] || 0) + uses;
      }
    });
  } catch (err) {
    console.warn('[InviteTracker] Failed to snapshot invites:', err.message);
  }

  return snapshot;
}

/**
 * Calculate the number of new invites a user gained during the active Happy Hour.
 *
 * Compares current guild invite uses against the event's baseline snapshot,
 * plus any live joins recorded during the event.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {object} event — active Happy Hour event object from DB
 * @returns {Promise<number>}
 */
async function getUserHappyHourInvites(guild, userId, event) {
  if (!event || !userId) return 0;

  const baseline = event.inviteBaseline || { codeUses: {}, userTotals: {} };
  const baselineCodeUses = baseline.codeUses || {};

  let deltaFromCurrent = 0;

  if (guild && guild.invites) {
    try {
      const currentInvites = await guild.invites.fetch().catch(() => null);
      if (currentInvites) {
        guildInviteCache.set(guild.id, currentInvites);

        currentInvites.forEach((inv) => {
          if (inv.inviter?.id === userId) {
            const prevUses = baselineCodeUses[inv.code] ?? 0;
            const currentUses = inv.uses || 0;
            const diff = Math.max(0, currentUses - prevUses);
            deltaFromCurrent += diff;
          }
        });
      }
    } catch (err) {
      console.warn('[InviteTracker] Error fetching invites for user count:', err.message);
    }
  }

  const trackedJoins = (event.trackedInvites && event.trackedInvites[userId]) || 0;
  return Math.max(deltaFromCurrent, trackedJoins);
}

/**
 * Handle guildMemberAdd to attribute join to an inviter during Happy Hour.
 *
 * @param {import('discord.js').GuildMember} member
 */
async function handleGuildMemberAdd(member) {
  const guild = member.guild;
  const event = db.getHappyHourEvent();

  // If no active happy hour, just update cache
  if (!event || event.expired) {
    await cacheGuildInvites(guild);
    return;
  }

  try {
    const prevInvites = guildInviteCache.get(guild.id) || new Collection();
    const currentInvites = await guild.invites.fetch().catch(() => new Collection());
    guildInviteCache.set(guild.id, currentInvites);

    // Find the invite that was used
    const usedInvite = currentInvites.find((inv) => {
      const prev = prevInvites.get(inv.code);
      return prev && inv.uses > prev.uses;
    });

    if (usedInvite && usedInvite.inviter?.id) {
      const inviterId = usedInvite.inviter.id;
      db.incrementHappyHourInvite(event.id, inviterId);
      console.log(`[InviteTracker] 🎉 Member ${member.user.tag} joined via Happy Hour invite from ${usedInvite.inviter.tag} (${inviterId})`);
    }
  } catch (err) {
    console.warn('[InviteTracker] Error processing guildMemberAdd:', err.message);
  }
}

/**
 * Handle inviteCreate event to keep local cache updated.
 * @param {import('discord.js').Invite} invite
 */
function handleInviteCreate(invite) {
  if (!invite.guild) return;
  const cache = guildInviteCache.get(invite.guild.id);
  if (cache) cache.set(invite.code, invite);
}

/**
 * Handle inviteDelete event to keep local cache updated.
 * @param {import('discord.js').Invite} invite
 */
function handleInviteDelete(invite) {
  if (!invite.guild) return;
  const cache = guildInviteCache.get(invite.guild.id);
  if (cache) cache.delete(invite.code);
}

module.exports = {
  cacheGuildInvites,
  snapshotGuildInvites,
  getUserHappyHourInvites,
  handleGuildMemberAdd,
  handleInviteCreate,
  handleInviteDelete
};
