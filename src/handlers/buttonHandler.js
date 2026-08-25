const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const ticketManager = require('../utils/ticketManager');
const embedBuilder = require('../utils/embedBuilder');
const { generateTranscript } = require('../utils/transcript');
const db = require('../database/db');
const config = require('../config');
const knowledgeManager = require('../ai/knowledgeManager');
const resolutionManager = require('../utils/resolutionManager');

/**
 * Helper to check staff permissions
 */
function isStaffMember(member) {
  if (!member) return false;
  if (config.tickets.supportRoleId && member.roles.cache.has(config.tickets.supportRoleId)) {
    return true;
  }
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.guild && member.guild.ownerId === member.id) return true;
  if (config.ownerId === member.id || (config.ownerIds && config.ownerIds.includes(member.id))) {
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

    // 0. Handle Ticket Category Dropdown Select Menu
    if (customId === 'ticket_category_select' || (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu())) {
      await interaction.deferReply({ ephemeral: true });

      const selectedCategory = interaction.values?.[0] || 'general_support';
      const categoryData = embedBuilder.getCategoryData(selectedCategory);

      const result = await ticketManager.createTicketChannel(guild, user, selectedCategory);
      if (!result.success) {
        const errorEmbed = embedBuilder.createWarningEmbed(
          'Ticket Already Active',
          result.error
        );
        return interaction.editReply({ embeds: [errorEmbed] });
      }

      const successEmbed = embedBuilder.createSuccessEmbed(
        'Ticket Created Successfully',
        `Your support ticket for ${categoryData.emoji} **${categoryData.label}** has been created at <#${result.channel.id}>. Head over to describe your issue and receive immediate assistance!`
      );

      return interaction.editReply({ embeds: [successEmbed] });
    }

    // 1. Create Ticket (Fallback button)
    if (customId === 'ticket_create') {
      await interaction.deferReply({ ephemeral: true });

      const result = await ticketManager.createTicketChannel(guild, user, 'general_support');
      if (!result.success) {
        const errorEmbed = embedBuilder.createWarningEmbed(
          'Ticket Already Active',
          result.error
        );
        return interaction.editReply({ embeds: [errorEmbed] });
      }

      const successEmbed = embedBuilder.createSuccessEmbed(
        'Ticket Created Successfully',
        `Your dedicated support channel is ready at <#${result.channel.id}>. Head over to describe your issue and receive immediate assistance!`
      );

      return interaction.editReply({ embeds: [successEmbed] });
    }

    // 2. User Confirmed Issue Resolved ("Yes, Close Ticket")
    if (customId === 'ticket_resolve_yes') {
      resolutionManager.clearTimers(channel.id);
      const resolveEmbed = embedBuilder.createSuccessEmbed(
        'Inquiry Resolved',
        'Thank you for confirming! Closing ticket, generating HTML transcript, and archiving channel...'
      );
      try {
        await interaction.update({ embeds: [resolveEmbed], components: [] });
      } catch {
        await interaction.reply({ embeds: [resolveEmbed], ephemeral: false }).catch(() => {});
      }
      return ticketManager.closeTicket(channel, user, 'Resolved by user confirmation');
    }

    // 3. User Needs More Help ("No, Need More Help")
    if (customId === 'ticket_resolve_no') {
      resolutionManager.clearTimers(channel.id);
      const keepOpenEmbed = embedBuilder.createInfoEmbed(
        '💬 Ticket Kept Open',
        'Understood! This ticket will remain active. Please describe what else you need assistance with, and our AI assistant or staff will help.'
      );
      try {
        await interaction.update({
          embeds: [keepOpenEmbed],
          components: []
        });
      } catch {
        await interaction.reply({ embeds: [keepOpenEmbed] }).catch(() => {});
      }
      return;
    }

    // 4. Close Ticket Request (Show Confirmation)
    if (customId === 'ticket_close_request') {
      const confirmation = embedBuilder.createCloseConfirmation();
      return interaction.reply({ ...confirmation, ephemeral: true });
    }

    // 5. Confirm Close Ticket
    if (customId === 'ticket_close_confirm') {
      const closingEmbed = embedBuilder.createWarningEmbed(
        'Closing Ticket',
        '🔒 Closing ticket, generating transcript, and locking channel permissions...'
      );
      try {
        await interaction.update({ embeds: [closingEmbed], components: [] });
      } catch {
        await interaction.reply({ embeds: [closingEmbed], ephemeral: false }).catch(() => {});
      }
      return ticketManager.closeTicket(channel, user);
    }

    // 6. Cancel Close Ticket
    if (customId === 'ticket_close_cancel') {
      const cancelEmbed = embedBuilder.createInfoEmbed(
        'Ticket Close Cancelled',
        'Ticket closure has been cancelled. This channel remains open and active.'
      );
      try {
        return await interaction.update({ embeds: [cancelEmbed], components: [] });
      } catch {
        return interaction.reply({ embeds: [cancelEmbed], ephemeral: true });
      }
    }

    // 7. Generate Instant Transcript
    if (customId === 'ticket_transcript') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const transcriptAttachment = await generateTranscript(channel);
        const transcriptNotice = embedBuilder.createInfoEmbed(
          '📑 Instant HTML Transcript',
          'Here is the complete record of this ticket session. You can download and view this in any web browser.'
        );
        return interaction.editReply({
          embeds: [transcriptNotice],
          files: [transcriptAttachment]
        });
      } catch (err) {
        console.error('Transcript error:', err);
        const errEmbed = embedBuilder.createErrorEmbed('Transcript Generation Failed', err.message);
        return interaction.editReply({ embeds: [errEmbed] });
      }
    }

    // 8. Claim Ticket
    if (customId === 'ticket_claim') {
      const ticketData = db.getTicket(channel.id);
      if (!ticketData) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', 'This channel is not an active ticket.');
        return interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }

      // Check if user is staff
      if (!isStaffMember(member)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only verified support team members and administrators can claim tickets.'
        );
        return interaction.reply({
          embeds: [warnEmbed],
          ephemeral: true
        });
      }

      if (ticketData.claimedBy) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Already Claimed',
          `This ticket is currently assigned to <@${ticketData.claimedBy}>. Click **Transfer** to reassign.`
        );
        return interaction.reply({
          embeds: [warnEmbed],
          ephemeral: true
        });
      }

      db.claimTicket(channel.id, user.id);
      db.updateTicket(channel.id, { continueWithAi: false });

      const transferBtn = new ButtonBuilder()
        .setCustomId('ticket_transfer')
        .setLabel('Transfer Ticket')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary);

      const closeBtn = new ButtonBuilder()
        .setCustomId('ticket_close_request')
        .setLabel('Close Ticket')
        .setEmoji(embedBuilder.parseEmoji(embedBuilder.EMOJIS.closeTicket))
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(transferBtn, closeBtn);

      const claimEmbed = embedBuilder.createSuccessEmbed(
        'Ticket Claimed by Staff',
        `🙋‍♂️ <@${user.id}> has claimed this ticket and will be providing direct assistance.\n\n` +
        `• Automated AI responses are paused while staff is active.\n` +
        `• Use the controls below to transfer or close the ticket.`
      );

      return interaction.reply({
        embeds: [claimEmbed],
        components: [row]
      });
    }

    // 9. Transfer Ticket (Unclaim and make available for other staff)
    if (customId === 'ticket_transfer') {
      const ticketData = db.getTicket(channel.id);
      if (!ticketData) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', 'This channel is not an active ticket.');
        return interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }

      if (!isStaffMember(member)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only support team members or administrators can transfer tickets.'
        );
        return interaction.reply({
          embeds: [warnEmbed],
          ephemeral: true
        });
      }

      const prevClaimed = ticketData.claimedBy;
      db.unclaimTicket(channel.id);

      const claimBtn = new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim Ticket')
        .setEmoji(embedBuilder.parseEmoji(embedBuilder.EMOJIS.claimTicket))
        .setStyle(ButtonStyle.Success);

      const continueAiBtn = new ButtonBuilder()
        .setCustomId('ticket_continue_ai')
        .setLabel('Continue with AI')
        .setEmoji(embedBuilder.parseEmoji(embedBuilder.EMOJIS.continueAi))
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(claimBtn, continueAiBtn);

      const transferEmbed = embedBuilder.createInfoEmbed(
        '🔄 Ticket Unassigned / Transferred',
        `<@${user.id}> unassigned this ticket${prevClaimed ? ` (previously handled by <@${prevClaimed}>)` : ''}.\n\n` +
        `The ticket is now open in the queue for any available staff member to claim.`
      );

      return interaction.reply({
        embeds: [transferEmbed],
        components: [row]
      });
    }

    // 10. Continue with AI (Keep AI responding until staff takes over)
    if (customId === 'ticket_continue_ai') {
      const ticketData = db.getTicket(channel.id);
      if (!ticketData) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', 'This channel is not an active ticket.');
        return interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }

      db.updateTicket(channel.id, { continueWithAi: true, claimedBy: null });

      const claimBtn = new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim Ticket')
        .setEmoji(embedBuilder.parseEmoji(embedBuilder.EMOJIS.claimTicket))
        .setStyle(ButtonStyle.Success);

      const transferBtn = new ButtonBuilder()
        .setCustomId('ticket_transfer')
        .setLabel('Transfer')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(claimBtn, transferBtn);

      const aiResumeEmbed = embedBuilder.createInfoEmbed(
        '🤖 AI Fast-Response Resumed',
        'The AI Support Assistant will continue answering questions in this ticket until a staff member arrives to assist.'
      );

      return interaction.reply({
        embeds: [aiResumeEmbed],
        components: [row]
      });
    }

    // 11. Re-open Ticket
    if (customId === 'ticket_reopen') {
      if (!isStaffMember(member)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only staff members or administrators can re-open tickets.'
        );
        return interaction.reply({ embeds: [warnEmbed], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });
      const result = await ticketManager.reopenTicket(channel, user);
      if (!result.success) {
        const errEmbed = embedBuilder.createErrorEmbed('Reopen Failed', result.error);
        return interaction.editReply({ embeds: [errEmbed] });
      }

      const reopenSuccess = embedBuilder.createSuccessEmbed(
        'Ticket Re-Opened',
        `🔓 This ticket has been re-opened by <@${user.id}>. User permissions have been restored.`
      );
      return interaction.editReply({ embeds: [reopenSuccess] });
    }

    // 12. Delete Ticket
    if (customId === 'ticket_delete') {
      if (!isStaffMember(member)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only staff members or administrators can delete ticket channels.'
        );
        return interaction.reply({ embeds: [warnEmbed], ephemeral: true });
      }
      const deleteWarning = embedBuilder.createWarningEmbed(
        'Channel Deletion',
        '⛔ Permanently deleting ticket channel in **5 seconds**...'
      );
      await interaction.reply({ embeds: [deleteWarning], ephemeral: false }).catch(() => {});
      return ticketManager.deleteTicket(channel, user);
    }

    // 13. Self-Learning: Approve Suggestion
    if (customId.startsWith('learn_approve_')) {
      const suggId = customId.replace('learn_approve_', '');
      const suggestion = db.getSuggestion(suggId);
      if (!suggestion) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', `Suggestion \`${suggId}\` not found.`);
        return interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
      if (suggestion.status !== 'pending') {
        const warnEmbed = embedBuilder.createWarningEmbed('Notice', `Suggestion \`${suggId}\` has already been ${suggestion.status}.`);
        return interaction.reply({ embeds: [warnEmbed], ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });

      try {
        if (suggestion.type === 'lesson') {
          knowledgeManager.saveLesson(suggestion.key, suggestion.fact);
        } else if (suggestion.type === 'article') {
          knowledgeManager.saveArticle(suggestion.category, suggestion.title, suggestion.content);
        }
        db.approveSuggestion(suggId);

        const approveEmbed = embedBuilder.createSuccessEmbed(
          'Suggestion Approved & Published',
          `✅ **Suggestion \`${suggId}\` approved and saved to the knowledge base.**\n\n` +
          `${suggestion.type === 'lesson' ? `💡 **Lesson**: \`${suggestion.key}\`\n> ${suggestion.fact}` : `📖 **Article**: **${suggestion.title}** in \`${suggestion.category}\``}`
        );

        return interaction.editReply({ embeds: [approveEmbed] });
      } catch (err) {
        const errEmbed = embedBuilder.createErrorEmbed('Publication Failed', err.message);
        return interaction.editReply({ embeds: [errEmbed] });
      }
    }

    // 14. Self-Learning: Reject Suggestion
    if (customId.startsWith('learn_reject_')) {
      const suggId = customId.replace('learn_reject_', '');
      const suggestion = db.getSuggestion(suggId);
      if (!suggestion) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', `Suggestion \`${suggId}\` not found.`);
        return interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
      db.rejectSuggestion(suggId);
      const rejectEmbed = embedBuilder.createWarningEmbed(
        'Suggestion Rejected',
        `❌ Suggestion \`${suggId}\` has been discarded. No changes were made to the knowledge base.`
      );
      return interaction.reply({ embeds: [rejectEmbed] });
    }

    // 15. DM Interactive Draft: Accept & Save
    if (customId.startsWith('dm_accept_draft_')) {
      const draftId = customId.replace('dm_accept_draft_', '');
      const draft = db.getDraft(draftId);
      if (!draft) {
        const errEmbed = embedBuilder.createErrorEmbed('Draft Not Found', `Draft \`${draftId}\` was not found or has already been processed.`);
        return interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
      if (draft.status !== 'pending') {
        const warnEmbed = embedBuilder.createWarningEmbed('Notice', `Draft \`${draftId}\` has already been ${draft.status}.`);
        return interaction.reply({ embeds: [warnEmbed], ephemeral: true });
      }

      await interaction.deferUpdate().catch(() => {});

      try {
        let saveResult;
        if (draft.type === 'article') {
          saveResult = knowledgeManager.saveArticle(draft.category, draft.title, draft.content, draft.slug);
        } else if (draft.type === 'lesson') {
          saveResult = knowledgeManager.saveLesson(draft.key, draft.fact);
        } else if (draft.type === 'override') {
          saveResult = knowledgeManager.addOverride(draft.directive, draft.reason || 'Set via Owner DM');
        }

        if (draft.gapId) {
          db.resolvePendingQuestion(draft.gapId, { draftId, result: saveResult });
        }
        if (draft.suggId) {
          db.approveSuggestion(draft.suggId);
        }

        db.approveDraft(draftId);

        const confirmEmbed = embedBuilder.createSuccessEmbed(
          'Draft Accepted & Live in Knowledge Base',
          draft.type === 'article'
            ? `📖 **Article Published**: \`${draft.category}/${saveResult.slug}.md\`\n**Title**: ${draft.title}\n\n*The AI is now actively utilizing this knowledge for all ticket responses.*`
            : draft.type === 'lesson'
            ? `💡 **Atomic Lesson Learned**: \`${draft.key}\`\n> ${draft.fact}\n\n*Saved to live memory and instantly available.*`
            : `🚨 **Executive Override Enacted**: \`${saveResult.id}\`\n> ${draft.directive}\n\n*This directive is in effect across all support channels.*`
        )
        .setFooter({ text: `Draft ID: ${draftId} • Published to Knowledge Base` });

        return interaction.editReply({
          content: '🎉 **Successfully published to knowledge base, Boss!**',
          embeds: [confirmEmbed],
          components: []
        });
      } catch (err) {
        const errEmbed = embedBuilder.createErrorEmbed('Error Saving Draft', err.message);
        return interaction.followUp({ embeds: [errEmbed], ephemeral: true });
      }
    }

    // 16. DM Interactive Draft: Decline
    if (customId.startsWith('dm_decline_draft_')) {
      const draftId = customId.replace('dm_decline_draft_', '');
      const draft = db.getDraft(draftId);
      if (!draft) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', `Draft \`${draftId}\` not found.`);
        return interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
      db.rejectDraft(draftId);

      const declineEmbed = embedBuilder.createErrorEmbed(
        'Draft Discarded',
        `Draft \`${draftId}\` (${(draft.type || 'draft').toUpperCase()}: **${draft.title || draft.key || draft.directive || 'Draft'}**) was discarded.\nNo changes were made to the knowledge base.`
      )
      .setFooter({ text: 'You can give me new instructions anytime to propose a fresh draft.' });

      try {
        await interaction.update({
          embeds: [declineEmbed],
          components: []
        });
      } catch {
        await interaction.reply({ embeds: [declineEmbed] });
      }
      return;
    }
  }
};
