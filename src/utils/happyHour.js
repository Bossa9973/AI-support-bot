/**
 * happyHour.js — Happy Hour VPS Event Engine
 *
 * Runs as a background scheduler inside the Discord bot.
 * Fires at a random time each cycle, rolls a random VPS plan + discount tier,
 * posts a flashy announcement embed with a Claim button, then expires after
 * HAPPY_HOUR_DURATION_MINUTES (default 60 min) or when all slots are claimed.
 *
 * Three event tiers:
 *   REGULAR   — anyone, discount 10–55%, weighted toward lower end
 *   BOOSTER   — server boosters only, discount 30–60%
 *   LEGENDARY — ultra-rare (2% chance), 80–90% off, 1 slot only
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const db = require('../database/db');

// ─── Plan catalogue ───────────────────────────────────────────────────────────

const VPS_PLANS = [
  { id: 'nano',       name: 'VPS Nano',       invites: 5,  bolts: 1000, ram: '13 GB', cpu: 3,  disk: '100 GB' },
  { id: 'micro',      name: 'VPS Micro',      invites: 8,  bolts: 1600, ram: '21 GB', cpu: 4,  disk: '160 GB' },
  { id: 'mini',       name: 'VPS Mini',       invites: 10, bolts: 2000, ram: '25 GB', cpu: 6,  disk: '200 GB' },
  { id: 'small',      name: 'VPS Small',      invites: 12, bolts: 2400, ram: '30 GB', cpu: 6,  disk: '240 GB' },
  { id: 'medium',     name: 'VPS Medium',     invites: 15, bolts: 3000, ram: '32 GB', cpu: 8,  disk: '300 GB' },
  { id: 'large',      name: 'VPS Large',      invites: 16, bolts: 3200, ram: '40 GB', cpu: 8,  disk: '320 GB' },
  { id: 'xl',         name: 'VPS XL',         invites: 20, bolts: 4000, ram: '50 GB', cpu: 10, disk: '400 GB' },
  { id: 'xxl',        name: 'VPS XXL',        invites: 25, bolts: 5000, ram: '64 GB', cpu: 10, disk: '500 GB' },
  { id: 'jumbo',      name: 'VPS Jumbo',      invites: 30, bolts: 6000, ram: '80 GB', cpu: 12, disk: '650 GB' },
  { id: 'enterprise', name: 'VPS Enterprise', invites: 40, bolts: 8000, ram: '96 GB', cpu: 16, disk: '800 GB' }
];

// Plan selection weights — mid-tier plans (mini–xl) appear most often
const PLAN_WEIGHTS = [5, 8, 12, 14, 16, 14, 13, 10, 5, 3]; // index matches VPS_PLANS

// ─── Rarity tables ────────────────────────────────────────────────────────────

const REGULAR_DISCOUNTS = [
  { pct: 10, w: 28 }, { pct: 15, w: 22 }, { pct: 20, w: 18 },
  { pct: 25, w: 12 }, { pct: 30, w: 8  }, { pct: 35, w: 5  },
  { pct: 40, w: 3  }, { pct: 45, w: 2  }, { pct: 50, w: 1.5}, { pct: 55, w: 0.5 }
];

const BOOSTER_DISCOUNTS = [
  { pct: 30, w: 35 }, { pct: 35, w: 25 }, { pct: 40, w: 18 },
  { pct: 45, w: 12 }, { pct: 50, w: 7  }, { pct: 55, w: 2  }, { pct: 60, w: 1 }
];

const LEGENDARY_DISCOUNTS = [
  { pct: 80, w: 70 }, { pct: 85, w: 20 }, { pct: 90, w: 10 }
];

// Claim slot weights (index 0 = 1 slot, index 9 = 10 slots)
const SLOT_WEIGHTS = [5, 15, 20, 18, 15, 10, 7, 5, 3, 2];

// ─── Weighted random helper ───────────────────────────────────────────────────

function weightedRandom(items) {
  // items: array of { ..., w: number }
  const total = items.reduce((s, x) => s + x.w, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.w;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function weightedIndex(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ─── Event rolling ────────────────────────────────────────────────────────────

/**
 * Roll event tier:
 *   0-1  (2%)   → LEGENDARY
 *   2-11 (10%)  → BOOSTER
 *   12+  (88%)  → REGULAR
 */
function rollEventType() {
  const r = Math.floor(Math.random() * 100);
  if (r <= 1)  return 'legendary';
  if (r <= 11) return 'booster';
  return 'regular';
}

function rollDiscount(tier) {
  const table = tier === 'legendary' ? LEGENDARY_DISCOUNTS
    : tier === 'booster' ? BOOSTER_DISCOUNTS
    : REGULAR_DISCOUNTS;
  return weightedRandom(table).pct;
}

function rollPlan() {
  return VPS_PLANS[weightedIndex(PLAN_WEIGHTS)];
}

/** Roll 1–10 claim slots. Legendary always = 1. */
function rollSlots(tier) {
  if (tier === 'legendary') return 1;
  return weightedIndex(SLOT_WEIGHTS) + 1; // 1-indexed
}

/**
 * Roll requirement type.
 * Regular:  invites (70%) | bolts (30%)
 * Booster:  invites (50%) | bolts (30%) | invites+boost (20%)
 * Legendary: invites (60%) | bolts (40%)
 */
function rollRequirementType(tier) {
  const r = Math.random();
  if (tier === 'booster') {
    if (r < 0.50) return 'invites';
    if (r < 0.80) return 'bolts';
    return 'invites_boost';
  }
  if (tier === 'legendary') return r < 0.60 ? 'invites' : 'bolts';
  return r < 0.70 ? 'invites' : 'bolts';
}

/**
 * Build a full event object.
 */
function buildHappyHourEvent() {
  const tier      = rollEventType();
  const plan      = rollPlan();
  const discount  = rollDiscount(tier);
  const slots     = rollSlots(tier);
  const reqType   = rollRequirementType(tier);

  const mult = 1 - discount / 100;
  const discountedInvites = Math.ceil(plan.invites * mult);
  const discountedBolts   = Math.round(plan.bolts  * mult);

  return {
    id:         uuidv4(),
    tier,                       // 'regular' | 'booster' | 'legendary'
    plan,                       // full plan object
    discount,                   // e.g. 25
    slots,                      // total claim slots
    claimed:    0,              // current claim count
    reqType,                    // 'invites' | 'bolts' | 'invites_boost'
    discountedInvites,
    discountedBolts,
    expired:    false,
    announceMessageId: null,    // filled after posting
    announceChannelId: null
  };
}

// ─── Embed builder ────────────────────────────────────────────────────────────

const TIER_META = {
  regular:   { color: 0xFFD700, label: '⚡ HAPPY HOUR',             badge: '' },
  booster:   { color: 0xFF73FA, label: '<:roti_boost:1> BOOSTER EXCLUSIVE HAPPY HOUR', badge: '🔒 **Boosters Only**\n' },
  legendary: { color: 0xFF4500, label: '👑 ☄️ LEGENDARY DROP',      badge: '⚠️ **FIRST COME, FIRST SERVED — 1 SLOT ONLY**\n' }
};

function buildRequirementLine(event) {
  const { reqType, discountedInvites, discountedBolts, plan } = event;
  if (reqType === 'invites') {
    return `<:invitelink:1> **${discountedInvites} invites** *(normally ${plan.invites})*`;
  }
  if (reqType === 'bolts') {
    return `⚡ **${discountedBolts.toLocaleString()} BOLTs** *(normally ${plan.bolts.toLocaleString()})*`;
  }
  // invites_boost
  return `<:invitelink:1> **${discountedInvites} invites** + <:roti_boost:1> **1 Server Boost** *(normally ${plan.invites} invites)*`;
}

/**
 * Build the announcement EmbedBuilder for an event.
 * @param {object} event
 * @param {number} minutesLeft — used when editing (countdown)
 */
function buildAnnounceEmbed(event, minutesLeft = null) {
  const meta     = TIER_META[event.tier] || TIER_META.regular;
  const plan     = event.plan;
  const slotsLeft = event.slots - event.claimed;
  const duration  = config.happyHour.durationMinutes;
  const timeStr   = minutesLeft !== null ? `${minutesLeft} minutes` : `${duration} minutes`;

  const desc = [
    meta.badge,
    `<:vpsserver:1> **Plan:** ${plan.name}`,
    `<:cpu_bot_3d:1> **CPU:** ${plan.cpu} Cores`,
    `<:ram4:1> **RAM:** ${plan.ram} DDR4`,
    `📀 **Storage:** ${plan.disk}`,
    `<:linux2:1> Ubuntu / Debian  |  <:proxmoxlogo:1> Proxmox Support`,
    `<:online_badge:1> **Uptime:** 24/7`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🏷️ **Discount: ${event.discount}% OFF**`,
    `📋 **Requirement:** ${buildRequirementLine(event)}`,
    `🎟️ **Slots: ${slotsLeft} / ${event.slots} remaining**`,
    `⏳ **Expires in:** ${timeStr}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    event.expired
      ? '🔴 **This Happy Hour has ended.**'
      : '*Click the button below to claim your slot! Open a ticket to submit proof.*'
  ].join('\n');

  return new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(meta.label + ' — ' + plan.name)
    .setDescription(desc)
    .setFooter({ text: `Vertex Nodes Happy Hour • ${new Date().toUTCString()}` });
}

function buildClaimRow(event) {
  const disabled = event.expired || event.claimed >= event.slots;
  const btn = new ButtonBuilder()
    .setCustomId(`happy_hour_claim|${event.id}`)
    .setLabel(disabled ? '🔴 Closed' : '🎁 Claim Now')
    .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(disabled);
  return new ActionRowBuilder().addComponents(btn);
}

// ─── Scheduler state ──────────────────────────────────────────────────────────

let _expiryTimer  = null;
let _scheduleTimer = null;

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Post the happy hour announcement and start the expiry timer.
 * @param {import('discord.js').Client} client
 * @param {object|null} forcedEvent — pass a pre-built event to skip rolling (for /happyhour trigger)
 */
async function startHappyHour(client, forcedEvent = null) {
  const cfg = config.happyHour;
  if (!cfg.channelId) {
    console.warn('[HappyHour] No HAPPY_HOUR_CHANNEL_ID configured — skipping.');
    scheduleNextHappyHour(client);
    return;
  }

  // Cancel any existing active event first
  const existing = db.getHappyHourEvent();
  if (existing && !existing.expired) {
    await expireHappyHour(client, existing.id, true).catch(() => {});
  }

  const event = forcedEvent || buildHappyHourEvent();
  db.setHappyHourEvent(event);

  try {
    const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel) {
      console.warn('[HappyHour] Channel not found:', cfg.channelId);
      db.expireHappyHourEvent();
      scheduleNextHappyHour(client);
      return;
    }

    const embed = buildAnnounceEmbed(event);
    const row   = buildClaimRow(event);

    // Optional role ping
    const pingContent = cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : null;
    const msg = await channel.send({
      content: pingContent,
      embeds: [embed],
      components: [row],
      allowedMentions: cfg.pingRoleId ? { roles: [cfg.pingRoleId] } : { parse: [] }
    });

    // Store message reference for later edits
    db.setHappyHourEvent({
      ...db.getHappyHourEvent(),
      announceMessageId: msg.id,
      announceChannelId: channel.id
    });

    const tierLabel = event.tier.toUpperCase();
    console.log(`[HappyHour] 🎉 ${tierLabel} event started: ${event.plan.name} — ${event.discount}% off | ${event.slots} slots | req: ${event.reqType}`);

    // Schedule expiry
    const durationMs = cfg.durationMinutes * 60 * 1000;
    if (_expiryTimer) clearTimeout(_expiryTimer);
    _expiryTimer = setTimeout(() => expireHappyHour(client, event.id), durationMs);

  } catch (err) {
    console.error('[HappyHour] Error starting event:', err.message);
    db.expireHappyHourEvent();
    scheduleNextHappyHour(client);
  }
}

/**
 * Expire the active happy hour: edit embed to show closed state, archive in DB.
 * @param {import('discord.js').Client} client
 * @param {string} eventId
 * @param {boolean} [silent=false] — skip scheduling next when called from startHappyHour replacement
 */
async function expireHappyHour(client, eventId, silent = false) {
  const event = db.getHappyHourEvent();
  if (!event || event.id !== eventId) return;

  db.expireHappyHourEvent(); // marks expired, archives to history

  console.log(`[HappyHour] Event ${eventId} expired (${event.plan?.name} — ${event.discount}% off, ${event.claimed}/${event.slots} claimed)`);

  // Edit the announcement embed
  try {
    if (event.announceChannelId && event.announceMessageId) {
      const ch = await client.channels.fetch(event.announceChannelId).catch(() => null);
      if (ch) {
        const msg = await ch.messages.fetch(event.announceMessageId).catch(() => null);
        if (msg) {
          const expiredEmbed = buildAnnounceEmbed({ ...event, expired: true }, 0);
          const disabledRow  = buildClaimRow({ ...event, expired: true });
          await msg.edit({ embeds: [expiredEmbed], components: [disabledRow] }).catch(() => {});
          await ch.send({
            content: `⏰ The **${event.plan?.name}** Happy Hour has ended! **${event.claimed}/${event.slots}** slots were claimed.`
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('[HappyHour] Could not edit expired embed:', err.message);
  }

  if (!silent) scheduleNextHappyHour(client);
}

/**
 * Schedule the next happy hour after a random delay.
 * @param {import('discord.js').Client} client
 */
function scheduleNextHappyHour(client) {
  const cfg = config.happyHour;
  if (!cfg.enabled) return;

  const minMs = cfg.minDelayHours * 60 * 60 * 1000;
  const maxMs = cfg.maxDelayHours * 60 * 60 * 1000;
  const delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  const delayHours = (delayMs / 3600000).toFixed(1);

  console.log(`[HappyHour] Next happy hour in ${delayHours}h`);

  if (_scheduleTimer) clearTimeout(_scheduleTimer);
  _scheduleTimer = setTimeout(() => startHappyHour(client), delayMs);
}

/**
 * Handle a user clicking the Claim Now button.
 * Called by buttonHandler. Returns { ok, reason, event, claimed, total }.
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {string} eventId
 */
async function handleClaim(interaction, eventId) {
  const { guild, user, member } = interaction;

  const event = db.getHappyHourEvent();

  // Validate event still active
  if (!event || event.id !== eventId || event.expired) {
    return interaction.reply({ content: '⏰ This Happy Hour has already ended!', ephemeral: true });
  }

  // Booster check
  if (event.tier === 'booster') {
    const isBoosting = member?.premiumSince || member?.premiumSinceTimestamp;
    if (!isBoosting) {
      return interaction.reply({
        content: '<:roti_boost:1> This Happy Hour is **Booster Exclusive**. You need to be actively boosting this server to claim it!',
        ephemeral: true
      });
    }
  }

  // Try to reserve a slot
  const result = db.addHappyHourClaim(eventId, user.id);

  if (!result.ok) {
    return interaction.reply({ content: `❌ ${result.reason}`, ephemeral: true });
  }

  // Update announcement embed slot counter
  try {
    const updatedEvent = { ...event, claimed: result.claimed };
    if (event.announceChannelId && event.announceMessageId) {
      const ch = await interaction.client.channels.fetch(event.announceChannelId).catch(() => null);
      if (ch) {
        const msg = await ch.messages.fetch(event.announceMessageId).catch(() => null);
        if (msg) {
          const newEmbed = buildAnnounceEmbed(updatedEvent);
          const allClaimed = result.claimed >= event.slots;
          const newRow    = buildClaimRow({ ...updatedEvent, expired: allClaimed });
          await msg.edit({ embeds: [newEmbed], components: [newRow] }).catch(() => {});
          if (allClaimed) {
            // All slots taken — expire immediately
            await ch.send({ content: `🎉 All slots for the **${event.plan?.name}** Happy Hour have been claimed!` }).catch(() => {});
            expireHappyHour(interaction.client, eventId);
          }
        }
      }
    }
  } catch (_) {}

  // Open a support ticket for the user with pre-filled context
  const ticketManager = require('../utils/ticketManager');
  const embedBuilder  = require('../utils/embedBuilder');

  const ticketResult = await ticketManager.createTicketChannel(guild, user, 'claim_reward');
  if (!ticketResult.success) {
    return interaction.reply({
      content: `✅ Slot reserved! You already have an open ticket at <#${guild.channels.cache.find(c => c.name?.includes(user.username.toLowerCase()))?.id ?? '?'}>. Please mention your Happy Hour claim there.`,
      ephemeral: true
    });
  }

  // Post the claim brief into the new ticket
  const reqLabel = event.reqType === 'bolts'
    ? `⚡ **${event.discountedBolts.toLocaleString()} BOLTs** *(${event.discount}% off ${event.plan.bolts.toLocaleString()})*`
    : `<:invitelink:1> **${event.discountedInvites} invites** *(${event.discount}% off ${event.plan.invites})*${event.reqType === 'invites_boost' ? ' + <:roti_boost:1> **1 Server Boost**' : ''}`;

  const claimEmbed = new EmbedBuilder()
    .setColor(TIER_META[event.tier]?.color ?? 0xFFD700)
    .setTitle(`🎁 Happy Hour Claim — ${event.plan.name}`)
    .setDescription(
      `Hey <@${user.id}>! You've reserved a slot for the **${event.discount}% OFF ${event.plan.name}** Happy Hour.\n\n` +
      `**To complete your claim, please provide:**\n${reqLabel}\n\n` +
      `Staff or Eon will verify your requirement and process your free VPS. ` +
      `Please have your invite count or BOLTs screenshot ready!`
    );

  await ticketResult.channel.send({ embeds: [claimEmbed] }).catch(() => {});

  return interaction.reply({
    content: `✅ Slot reserved! Head to <#${ticketResult.channel.id}> to complete your claim.`,
    ephemeral: true
  });
}

// ─── Cancel active happy hour ─────────────────────────────────────────────────

async function cancelHappyHour(client) {
  const event = db.getHappyHourEvent();
  if (!event || event.expired) return false;
  if (_expiryTimer) { clearTimeout(_expiryTimer); _expiryTimer = null; }
  await expireHappyHour(client, event.id, true);
  scheduleNextHappyHour(client);
  return true;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  VPS_PLANS,
  buildHappyHourEvent,
  buildAnnounceEmbed,
  buildClaimRow,
  startHappyHour,
  expireHappyHour,
  scheduleNextHappyHour,
  handleClaim,
  cancelHappyHour,
  // Exposed for tests
  rollEventType,
  rollDiscount,
  rollPlan,
  rollSlots,
  rollRequirementType
};
