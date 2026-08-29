/**
 * /happyhour — Admin command to manage the Happy Hour VPS event system.
 *
 * Subcommands:
 *   status   — show active event, scheduled event, and history
 *   trigger  — manually fire a happy hour right now (admin / staff / owner)
 *   schedule — schedule a happy hour at a certain time / delay (admin / staff / owner)
 *   cancel   — cancel active and/or scheduled happy hours early (admin / staff / owner)
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { isStaffMember } = require('../utils/staffChecker');
const {
  startHappyHour,
  scheduleHappyHourAt,
  cancelHappyHour,
  parseTimeInput,
  buildCustomHappyHourEvent,
  VPS_PLANS
} = require('../utils/happyHour');
const db = require('../database/db');
const config = require('../config');

// Plan choices for trigger / schedule options
const PLAN_CHOICES = VPS_PLANS.map(p => ({
  name: `${p.name} (${p.ram} RAM, ${p.cpu} CPU)`,
  value: p.id
}));

function canManageHappyHour(interaction) {
  const isOwner = config.ownerIds.includes(interaction.user.id);
  if (isOwner) return true;
  if (interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (config.happyHour?.adminRoleId) {
    const targetRoleId = String(config.happyHour.adminRoleId).trim();
    if (interaction.member?.roles?.cache?.has(targetRoleId)) return true;
    if (Array.isArray(interaction.member?.roles) && interaction.member.roles.includes(targetRoleId)) return true;
  }
  if (isStaffMember(interaction.member, interaction.guild, interaction.user)) return true;
  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('happyhour')
    .setDescription('Manage and schedule the Happy Hour VPS event system.')
    .addSubcommand(sub =>
      sub.setName('status')
         .setDescription('Show current active event, scheduled event, and recent history.')
    )
    .addSubcommand(sub =>
      sub.setName('trigger')
         .setDescription('Manually start a happy hour event right now.')
         .addStringOption(opt =>
           opt.setName('tier')
              .setDescription('Force a specific tier (optional)')
              .setRequired(false)
              .addChoices(
                { name: 'Regular (10–55% off)', value: 'regular' },
                { name: 'Booster Exclusive (30–60% off)', value: 'booster' },
                { name: '👑 Legendary (80–90% off, 1 slot)', value: 'legendary' }
              )
         )
         .addStringOption(opt =>
           opt.setName('plan')
              .setDescription('Force a specific VPS plan (optional)')
              .setRequired(false)
              .addChoices(...PLAN_CHOICES)
         )
         .addIntegerOption(opt =>
           opt.setName('discount')
              .setDescription('Custom discount % (10 to 90) (optional)')
              .setRequired(false)
              .setMinValue(10)
              .setMaxValue(90)
         )
         .addIntegerOption(opt =>
           opt.setName('slots')
              .setDescription('Number of claim slots (1 to 20) (optional)')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(20)
         )
         .addStringOption(opt =>
           opt.setName('requirement')
              .setDescription('Claim requirement type (optional)')
              .setRequired(false)
              .addChoices(
                { name: 'Invites only', value: 'invites' },
                { name: 'BOLTs only', value: 'bolts' },
                { name: 'Invites + 1 Server Boost', value: 'invites_boost' }
              )
         )
         .addIntegerOption(opt =>
           opt.setName('duration')
              .setDescription('Event duration in minutes (default: configured duration)')
              .setRequired(false)
              .setMinValue(5)
              .setMaxValue(1440)
         )
    )
    .addSubcommand(sub =>
      sub.setName('schedule')
         .setDescription('Schedule a happy hour event to fire at a certain time or delay.')
         .addStringOption(opt =>
           opt.setName('time')
              .setDescription('When to start (e.g. 30m, 2h, 1h30m, 18:00, 20:00 UTC, 2026-08-30 15:00)')
              .setRequired(true)
         )
         .addStringOption(opt =>
           opt.setName('tier')
              .setDescription('Force a specific tier (optional)')
              .setRequired(false)
              .addChoices(
                { name: 'Regular (10–55% off)', value: 'regular' },
                { name: 'Booster Exclusive (30–60% off)', value: 'booster' },
                { name: '👑 Legendary (80–90% off, 1 slot)', value: 'legendary' }
              )
         )
         .addStringOption(opt =>
           opt.setName('plan')
              .setDescription('Force a specific VPS plan (optional)')
              .setRequired(false)
              .addChoices(...PLAN_CHOICES)
         )
         .addIntegerOption(opt =>
           opt.setName('discount')
              .setDescription('Custom discount % (10 to 90) (optional)')
              .setRequired(false)
              .setMinValue(10)
              .setMaxValue(90)
         )
         .addIntegerOption(opt =>
           opt.setName('slots')
              .setDescription('Number of claim slots (1 to 20) (optional)')
              .setRequired(false)
              .setMinValue(1)
              .setMaxValue(20)
         )
         .addStringOption(opt =>
           opt.setName('requirement')
              .setDescription('Claim requirement type (optional)')
              .setRequired(false)
              .addChoices(
                { name: 'Invites only', value: 'invites' },
                { name: 'BOLTs only', value: 'bolts' },
                { name: 'Invites + 1 Server Boost', value: 'invites_boost' }
              )
         )
         .addIntegerOption(opt =>
           opt.setName('duration')
              .setDescription('Event duration in minutes (default: configured duration)')
              .setRequired(false)
              .setMinValue(5)
              .setMaxValue(1440)
         )
    )
    .addSubcommand(sub =>
      sub.setName('cancel')
         .setDescription('Cancel active and/or scheduled Happy Hours.')
         .addStringOption(opt =>
           opt.setName('target')
              .setDescription('What to cancel (default: both active and scheduled)')
              .setRequired(false)
              .addChoices(
                { name: 'Cancel Both (Active & Scheduled)', value: 'all' },
                { name: 'Active Event Only', value: 'active' },
                { name: 'Scheduled Event Only', value: 'scheduled' }
              )
         )
    ),

  async execute(interaction) {
    // Check permission
    if (!canManageHappyHour(interaction)) {
      return interaction.reply({
        content: '❌ You do not have permission to manage Happy Hours. (Requires Admin or Staff role)',
        flags: MessageFlags.Ephemeral
      });
    }

    const sub = interaction.options.getSubcommand();

    // ── STATUS ────────────────────────────────────────────────────────────────
    if (sub === 'status') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const activeEvent = db.getHappyHourEvent();
      const scheduled   = db.getScheduledHappyHour();
      const history     = db.getHappyHourHistory(5);

      const embed = new EmbedBuilder().setColor(0x5865F2);

      if (activeEvent && !activeEvent.expired) {
        const slotsLeft = activeEvent.slots - activeEvent.claimed;
        const startedAt = activeEvent.startedAt ? Math.floor(new Date(activeEvent.startedAt).getTime() / 1000) : null;
        const durationMin = activeEvent.durationMinutes || config.happyHour.durationMinutes || 60;
        const expiresAt = startedAt ? startedAt + (durationMin * 60) : null;

        embed.setColor(activeEvent.tier === 'legendary' ? 0xFF4500 : activeEvent.tier === 'booster' ? 0xFF73FA : 0xFFD700)
          .setTitle(`⚡ Active Happy Hour — ${activeEvent.plan?.name}`)
          .addFields(
            { name: 'Tier',        value: activeEvent.tier.toUpperCase(),                         inline: true },
            { name: 'Discount',    value: `${activeEvent.discount}% OFF`,                         inline: true },
            { name: 'Slots',       value: `${slotsLeft} / ${activeEvent.slots} remaining`,        inline: true },
            { name: 'Requirement', value: activeEvent.reqType,                                    inline: true },
            { name: 'Started',     value: startedAt ? `<t:${startedAt}:R>` : 'Unknown',            inline: true },
            { name: 'Expires',     value: expiresAt  ? `<t:${expiresAt}:R>` : 'Unknown',           inline: true }
          );

        const claims = db.getHappyHourClaims(activeEvent.id);
        if (claims.length > 0) {
          embed.addFields({ name: `🎟️ Claimants (${claims.length})`, value: claims.map(id => `<@${id}>`).join(', ') });
        }
      } else {
        embed.setTitle('Happy Hour — No Active Event');
      }

      // Scheduled info
      if (scheduled && scheduled.scheduledFor) {
        const schedUnix = Math.floor(new Date(scheduled.scheduledFor).getTime() / 1000);
        const schedPlan = scheduled.event?.plan?.name || 'Random Plan';
        const schedTier = (scheduled.event?.tier || 'random').toUpperCase();
        const schedDisc = scheduled.event?.discount ? `${scheduled.event.discount}% OFF` : 'Random %';
        embed.addFields({
          name: '📅 Upcoming Scheduled Event',
          value: `• **Starts:** <t:${schedUnix}:F> (<t:${schedUnix}:R>)\n• **Plan:** ${schedPlan} (${schedTier} - ${schedDisc})\n• **Set By:** ${scheduled.scheduledBy ? `<@${scheduled.scheduledBy}>` : 'Admin'}`
        });
      }

      // Recent history
      const histLines = history.length > 0
        ? history.map(e =>
            `• **${e.plan?.name}** — ${e.discount}% off | ${e.claimed}/${e.slots} claimed | ${e.tier} | <t:${Math.floor(new Date(e.startedAt).getTime() / 1000)}:R>`
          ).join('\n')
        : '_No previous events._';

      embed.addFields({ name: '📜 Last 5 Events', value: histLines });
      embed.setFooter({ text: 'Use /happyhour trigger, /happyhour schedule, or /happyhour cancel' });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── TRIGGER ───────────────────────────────────────────────────────────────
    if (sub === 'trigger') {
      if (!config.happyHour.channelId) {
        return interaction.reply({
          content: '⚠️ No announcement channel configured! Please set `HAPPY_HOUR_CHANNEL_ID` in `.env`.',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const customOptions = {
        tier:            interaction.options.getString('tier') || null,
        planId:          interaction.options.getString('plan') || null,
        discount:        interaction.options.getInteger('discount') || null,
        slots:           interaction.options.getInteger('slots') || null,
        reqType:         interaction.options.getString('requirement') || null,
        durationMinutes: interaction.options.getInteger('duration') || null
      };

      const hasCustom = Object.values(customOptions).some(v => v !== null);
      const event = hasCustom ? buildCustomHappyHourEvent(customOptions) : null;

      await startHappyHour(interaction.client, event);
      return interaction.editReply({ content: `✅ Happy Hour triggered immediately! Check <#${config.happyHour.channelId}>.` });
    }

    // ── SCHEDULE ──────────────────────────────────────────────────────────────
    if (sub === 'schedule') {
      if (!config.happyHour.channelId) {
        return interaction.reply({
          content: '⚠️ No announcement channel configured! Please set `HAPPY_HOUR_CHANNEL_ID` in `.env`.',
          flags: MessageFlags.Ephemeral
        });
      }

      const timeInput = interaction.options.getString('time');
      const parsed = parseTimeInput(timeInput);

      if (!parsed) {
        return interaction.reply({
          content: '❌ Invalid time format.\n\n**Examples of supported formats:**\n• Relative: `15m`, `30min`, `1h`, `2h`, `1h30m`, `1d`\n• Clock time: `18:00`, `3:30pm`, `20:00 UTC`\n• Full Date: `2026-08-30 15:00`',
          flags: MessageFlags.Ephemeral
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const customOptions = {
        tier:            interaction.options.getString('tier') || null,
        planId:          interaction.options.getString('plan') || null,
        discount:        interaction.options.getInteger('discount') || null,
        slots:           interaction.options.getInteger('slots') || null,
        reqType:         interaction.options.getString('requirement') || null,
        durationMinutes: interaction.options.getInteger('duration') || null
      };

      const { scheduledData, event } = scheduleHappyHourAt(
        interaction.client,
        parsed.targetDate,
        customOptions,
        interaction.user.id
      );

      const targetUnix = Math.floor(parsed.targetDate.getTime() / 1000);
      const durationMin = event.durationMinutes || config.happyHour.durationMinutes || 60;

      const schedEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Happy Hour Scheduled!')
        .setDescription(`A Happy Hour has been successfully scheduled to start <t:${targetUnix}:R> (<t:${targetUnix}:F>).`)
        .addFields(
          { name: '📦 Plan',        value: event.plan?.name || 'Random Plan', inline: true },
          { name: '🏷️ Discount',    value: `${event.discount}% OFF`,          inline: true },
          { name: '🎟️ Slots',       value: `${event.slots} slots`,            inline: true },
          { name: '📋 Requirement', value: event.reqType,                     inline: true },
          { name: '⏳ Duration',    value: `${durationMin} minutes`,          inline: true },
          { name: '📢 Channel',     value: `<#${config.happyHour.channelId}>`,inline: true }
        )
        .setFooter({ text: 'To cancel early, run /happyhour cancel' });

      return interaction.editReply({ embeds: [schedEmbed] });
    }

    // ── CANCEL ────────────────────────────────────────────────────────────────
    if (sub === 'cancel') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const target = interaction.options.getString('target') || 'all';
      const { cancelledActive, cancelledScheduled } = await cancelHappyHour(interaction.client, target);

      if (!cancelledActive && !cancelledScheduled) {
        return interaction.editReply({ content: '⚠️ No active or scheduled Happy Hour was found to cancel.' });
      }

      const notes = [];
      if (cancelledActive) notes.push('• Active Happy Hour event was cancelled and closed.');
      if (cancelledScheduled) notes.push('• Upcoming scheduled Happy Hour was removed.');

      return interaction.editReply({
        content: `✅ **Cancellation Complete:**\n${notes.join('\n')}\n*The normal randomized Happy Hour cycle has been resumed.*`
      });
    }
  }
};

