const { PermissionFlagsBits } = require('discord.js');
const ticketManager = require('../utils/ticketManager');
const embedBuilder = require('../utils/embedBuilder');
const { generateTranscript } = require('../utils/transcript');
const db = require('../database/db');
const config = require('../config');

/**
 * Helper to check staff permissions
 */
function isStaffMember(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (config.tickets.supportRoleId && member.roles.cache.has(config.tickets.supportRoleId)) {
    return true;
  }
  return false;
}

module.exports = {
  /**
   * Dispatches button interactions.
   * @param {import('discord.js').ButtonInteraction} interaction 
   */
  async handleButton(interaction) {
    const { customId, guild, user, channel, member } = interaction;

    // 1. Create Ticket
    if (customId === 'ticket_create') {
      await interaction.deferReply({ ephemeral: true });

      const result = await ticketManager.createTicketChannel(guild, user);
      if (!result.success) {
        return interaction.editReply({ content: `⚠️ ${result.error}` });
      }

      return interaction.editReply({
        content: `✅ Your ticket has been created! Head over to <#${result.channel.id}> to get assistance.`
      });
    }

    // 2. Close Ticket Request (Show Confirmation)
    if (customId === 'ticket_close_request') {
      const confirmation = embedBuilder.createCloseConfirmation();
      return interaction.reply({ ...confirmation, ephemeral: true });
    }

    // 3. Confirm Close Ticket
    if (customId === 'ticket_close_confirm') {
      await interaction.reply({ content: '🔒 Closing ticket and saving transcript...', ephemeral: false });
      return ticketManager.closeTicket(channel, user);
    }

    // 4. Cancel Close Ticket
    if (customId === 'ticket_close_cancel') {
      return interaction.reply({ content: '❌ Ticket close cancelled.', ephemeral: true });
    }

    // 5. Generate Instant Transcript
    if (customId === 'ticket_transcript') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const transcriptAttachment = await generateTranscript(channel);
        return interaction.editReply({
          content: '📑 Here is the current transcript for this ticket:',
          files: [transcriptAttachment]
        });
      } catch (err) {
        console.error('Transcript error:', err);
        return interaction.editReply({ content: 'Failed to generate transcript.' });
      }
    }

    // 6. Claim Ticket
    if (customId === 'ticket_claim') {
      const ticketData = db.getTicket(channel.id);
      if (!ticketData) {
        return interaction.reply({ content: 'This channel is not an active ticket.', ephemeral: true });
      }

      // Check if user is staff
      if (!isStaffMember(member)) {
        return interaction.reply({
          content: '⚠️ Only support team members or administrators can claim tickets.',
          ephemeral: true
        });
      }

      if (ticketData.claimedBy) {
        return interaction.reply({
          content: `⚠️ This ticket has already been claimed by <@${ticketData.claimedBy}>.`,
          ephemeral: true
        });
      }

      db.claimTicket(channel.id, user.id);
      return interaction.reply({
        content: `🙋‍♂️ **Ticket Claimed**: <@${user.id}> has claimed this ticket and is now assisting.`
      });
    }

    // 7. Re-open Ticket
    if (customId === 'ticket_reopen') {
      if (!isStaffMember(member)) {
        return interaction.reply({ content: '⚠️ Only staff members can re-open tickets.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });
      const result = await ticketManager.reopenTicket(channel, user);
      if (!result.success) {
        return interaction.editReply({ content: `⚠️ ${result.error}` });
      }
      return interaction.editReply({ content: `🔓 Ticket successfully re-opened.` });
    }

    // 8. Delete Ticket
    if (customId === 'ticket_delete') {
      if (!isStaffMember(member)) {
        return interaction.reply({ content: '⚠️ Only staff members can delete tickets.', ephemeral: true });
      }
      return ticketManager.deleteTicket(channel, user);
    }
  }
};
