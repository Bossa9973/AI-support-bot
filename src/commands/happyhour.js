/**
 * /happyhour — Admin command to manage the Happy Hour system.
 *
 * Subcommands:
 *   status   — show current event info or "no active event"
 *   trigger  — manually fire a happy hour right now (owner / admin only)
 *   cancel   — cancel the current happy hour early (owner / admin only)
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { isStaffMember } = require('../utils/staffChecker');
const {
  startHappyHour,
  cancelHappyHour,
  buildHappyHourEvent,
  VPS_PLANS
} = require('../utils/happyHour');
const db = require('../database/db');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('happyhour')
    .setDescription('Manage the Happy Hour VPS event system.')
    .addSubcommand(sub =>
      sub.setName('status')
         .setDescription('Show the current happy hour event status.')
    )
    .addSubcommand(sub =>
      sub.setName('trigger')
         .setDescription('Manually start a happy hour event right now.')
         .addStringOption(opt =>
           opt.setName('tier')
              .setDescription('Force a specific tier (optional)')
              .setRequired(false)
              .addChoices(
                { name: 'Regular', value: 'regular' },
                { name: 'Booster Exclusive', value: 'booster' },
                { name: '👑 Legendary (80-90% off)', value: 'legendary' }
              )
         )
    )
    .addSubcommand(sub =>
      sub.setName('cancel')
         .setDescription('Cancel the currently active happy hour early.')
    ),

  async execute(interaction) {
    // Only staff / owner may use this command
    const isOwner = config.ownerIds.includes(interaction.user.id);
    const staffOk = isStaffMember(interaction.member, interaction.guild, interaction.user);
    if (!isOwner && !staffOk) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // ── STATUS ────────────────────────────────────────────────────────────────
    if (sub === 'status') {
      await interaction.deferReply({ ephemeral: true });

      const event = db.getHappyHourEvent();
      const history = db.getHappyHourHistory(5);

      if (!event) {
        const histLines = history.length > 0
          ? history.map(e =>
              `• **${e.plan?.name}** — ${e.discount}% off | ${e.claimed}/${e.slots} claimed | ${e.tier} | <t:${Math.floor(new Date(e.startedAt).getTime() / 1000)}:R>`
            ).join('\n')
          : '_No previous events._';

        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle('Happy Hour — No Active Event')
          .addFields({ name: '📜 Last 5 Events', value: histLines })
          .setFooter({ text: 'Use /happyhour trigger to start one now.' });

        return interaction.editReply({ embeds: [embed] });
      }

      const slotsLeft = event.slots - event.claimed;
      const startedAt = event.startedAt ? Math.floor(new Date(event.startedAt).getTime() / 1000) : null;
      const expiresAt = startedAt ? startedAt + (config.happyHour.durationMinutes * 60) : null;

      const embed = new EmbedBuilder()
        .setColor(event.tier === 'legendary' ? 0xFF4500 : event.tier === 'booster' ? 0xFF73FA : 0xFFD700)
        .setTitle(`⚡ Active Happy Hour — ${event.plan?.name}`)
        .addFields(
          { name: 'Tier',     value: event.tier.toUpperCase(),                      inline: true },
          { name: 'Discount', value: `${event.discount}% OFF`,                      inline: true },
          { name: 'Slots',    value: `${slotsLeft} / ${event.slots} remaining`,     inline: true },
          { name: 'Requirement', value: event.reqType,                              inline: true },
          { name: 'Started',  value: startedAt ? `<t:${startedAt}:R>` : 'Unknown', inline: true },
          { name: 'Expires',  value: expiresAt  ? `<t:${expiresAt}:R>` : 'Unknown', inline: true }
        );

      const claims = db.getHappyHourClaims(event.id);
      if (claims.length > 0) {
        embed.addFields({ name: `🎟️ Claimants (${claims.length})`, value: claims.map(id => `<@${id}>`).join(', ') });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ── TRIGGER ───────────────────────────────────────────────────────────────
    if (sub === 'trigger') {
      if (!isOwner && !interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Only the server owner or administrators can trigger Happy Hours.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const forcedTier = interaction.options.getString('tier') || null;
      let event = null;
      if (forcedTier) {
        // Build event with forced tier
        const { rollDiscount, rollPlan, rollSlots, rollRequirementType } = require('../utils/happyHour');
        const plan     = rollPlan();
        const discount = rollDiscount(forcedTier);
        const slots    = rollSlots(forcedTier);
        const reqType  = rollRequirementType(forcedTier);
        const mult = 1 - discount / 100;
        const { v4: uuidv4 } = require('uuid');
        event = {
          id: uuidv4(), tier: forcedTier, plan, discount, slots, claimed: 0, reqType,
          discountedInvites: Math.ceil(plan.invites * mult),
          discountedBolts:   Math.round(plan.bolts  * mult),
          expired: false, announceMessageId: null, announceChannelId: null
        };
      }

      await startHappyHour(interaction.client, event);
      return interaction.editReply({ content: `✅ Happy Hour triggered! Check <#${config.happyHour.channelId}>.` });
    }

    // ── CANCEL ────────────────────────────────────────────────────────────────
    if (sub === 'cancel') {
      if (!isOwner && !interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Only the server owner or administrators can cancel Happy Hours.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const cancelled = await cancelHappyHour(interaction.client);
      return interaction.editReply({
        content: cancelled ? '✅ Happy Hour cancelled.' : '⚠️ No active Happy Hour to cancel.'
      });
    }
  }
};
