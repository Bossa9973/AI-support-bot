/**
 * /no_auto_close — Command to prevent a ticket from auto-closing due to inactivity.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../database/db');
const resolutionManager = require('../utils/resolutionManager');
const { isStaffMember } = require('../utils/staffChecker');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('no_auto_close')
    .setDescription('Prevent or toggle automatic inactivity closing for this ticket.')
    .addStringOption((opt) =>
      opt.setName('action')
         .setDescription('Enable, disable, or check auto-close protection status')
         .setRequired(false)
         .addChoices(
           { name: '🛡️ Enable Protection (Do not auto-close)', value: 'enable' },
           { name: '⏰ Disable Protection (Allow auto-close)', value: 'disable' },
           { name: 'ℹ️ Check Status', value: 'status' }
         )
    ),

  async execute(interaction) {
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({
        content: '❌ This command can only be used inside an active support ticket channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    const isOwner = config.ownerIds.includes(interaction.user.id);
    const isTicketCreator = ticket.userId === interaction.user.id;
    const isStaff = isStaffMember(interaction.member, interaction.guild, interaction.user);

    if (!isOwner && !isTicketCreator && !isStaff) {
      return interaction.reply({
        content: '❌ You do not have permission to modify auto-close settings for this ticket.',
        flags: MessageFlags.Ephemeral
      });
    }

    const action = interaction.options.getString('action');

    // 1. Status query
    if (action === 'status') {
      const isProtected = !!ticket.noAutoClose;
      const embed = new EmbedBuilder()
        .setColor(isProtected ? 0x57F287 : 0x5865F2)
        .setTitle(`Ticket #${String(ticket.ticketNumber).padStart(4, '0')} — Auto-Close Status`)
        .setDescription(
          isProtected
            ? '🛡️ **Auto-Close Protection: ACTIVE**\nThis ticket will **not** be automatically closed or deleted due to inactivity.'
            : '⏰ **Auto-Close Protection: INACTIVE**\nStandard inactivity rules apply (1h user inactivity after staff reply, 3h unclaimed limit).'
        );
      return interaction.reply({ embeds: [embed] });
    }

    // 2. Enable or Disable
    let newProtectedState = true;
    if (action === 'enable') {
      newProtectedState = true;
    } else if (action === 'disable') {
      newProtectedState = false;
    } else {
      // Toggle if no action specified
      newProtectedState = !ticket.noAutoClose;
    }

    resolutionManager.toggleNoAutoClose(interaction.channel.id, newProtectedState);

    const embed = new EmbedBuilder()
      .setColor(newProtectedState ? 0x57F287 : 0xFEE75C)
      .setTitle(newProtectedState ? '🛡️ Auto-Close Protection Enabled' : '⏰ Auto-Close Protection Disabled')
      .setDescription(
        newProtectedState
          ? `**Auto-close protection is now ENABLED for this ticket.**\n\n` +
            `• Inactivity timers and automatic channel deletion are paused.\n` +
            `• This ticket will stay open until manually closed by staff or the user with \`/close\`.\n` +
            `• Set by <@${interaction.user.id}>.`
          : `**Auto-close protection is now DISABLED for this ticket.**\n\n` +
            `• Standard inactivity timers have been restored.\n` +
            `• Staff reply inactivity (1h) and team handoff rules apply.`
      );

    return interaction.reply({ embeds: [embed] });
  }
};
