const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const ticketManager = require('../utils/ticketManager');
const embedBuilder = require('../utils/embedBuilder');
const { generateTranscript } = require('../utils/transcript');
const db = require('../database/db');
const config = require('../config');
const knowledgeManager = require('../ai/knowledgeManager');
const resolutionManager = require('../utils/resolutionManager');

const { isStaffMember } = require('../utils/staffChecker');
const { executeConfirmedAction, handleActionCancel } = require('./panelActionHandler');
const { handleClaim: handleHappyHourClaim } = require('../utils/happyHour');

module.exports = {
  /**
   * Dispatches button interactions.
   * @param {import('discord.js').ButtonInteraction} interaction 
   */
  async handleButton(interaction) {
    const { customId, guild, user, channel, member } = interaction;

    // 0. Handle Ticket Category Dropdown Select Menu
    if (customId === 'ticket_category_select' || (typeof interaction.isStringSelectMenu === 'function' && interaction.isStringSelectMenu())) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
        await interaction.reply({ embeds: [resolveEmbed] }).catch(() => {});
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
      return interaction.reply({ ...confirmation, flags: MessageFlags.Ephemeral });
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
        await interaction.reply({ embeds: [closingEmbed] }).catch(() => {});
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
        return interaction.reply({ embeds: [cancelEmbed], flags: MessageFlags.Ephemeral });
      }
    }

    // 7. Generate Instant Transcript
    if (customId === 'ticket_transcript') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const transcriptAttachment = await generateTranscript(channel);
        if (!transcriptAttachment) {
          const errEmbed = embedBuilder.createErrorEmbed('Transcript Unavailable', 'Unable to retrieve messages for transcript generation at this time.');
          return interaction.editReply({ embeds: [errEmbed] });
        }
        const transcriptNotice = embedBuilder.createInfoEmbed(
          '📑 Ticket Transcript',
          'Here is the complete record of this ticket session. You can download and view this file directly.'
        );
        return interaction.editReply({
          embeds: [transcriptNotice],
          files: [transcriptAttachment]
        });
      } catch (err) {
        console.warn('Transcript error:', err?.message || err);
        const errEmbed = embedBuilder.createErrorEmbed('Transcript Generation Failed', err?.message || 'Unknown error occurred.');
        return interaction.editReply({ embeds: [errEmbed] });
      }
    }

    // 8. Claim Ticket
    if (customId === 'ticket_claim') {
      const ticketData = db.getTicket(channel.id);
      if (!ticketData) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', 'This channel is not an active ticket.');
        return interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
      }

      // Check if user is staff
      if (!isStaffMember(member, guild, user)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only verified support team members and administrators can claim tickets.'
        );
        return interaction.reply({
          embeds: [warnEmbed],
          flags: MessageFlags.Ephemeral
        });
      }

      if (ticketData.claimedBy) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Already Claimed',
          `This ticket is currently assigned to <@${ticketData.claimedBy}>. Click **Transfer** to reassign.`
        );
        return interaction.reply({
          embeds: [warnEmbed],
          flags: MessageFlags.Ephemeral
        });
      }

      db.claimTicket(channel.id, user.id);
      db.updateTicket(channel.id, { continueWithAi: false });
      resolutionManager.onTicketClaimed(channel, user);

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
        return interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
      }

      if (!isStaffMember(member, guild, user)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only support team members or administrators can transfer tickets.'
        );
        return interaction.reply({
          embeds: [warnEmbed],
          flags: MessageFlags.Ephemeral
        });
      }

      const prevClaimed = ticketData.claimedBy;
      db.unclaimTicket(channel.id);
      resolutionManager.onTeamHandoff(channel);

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
        return interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
      }

      if (!isStaffMember(member, interaction.guild, user)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only support team members or administrators can resume AI assistance.'
        );
        return interaction.reply({ embeds: [warnEmbed], flags: MessageFlags.Ephemeral });
      }

      db.updateTicket(channel.id, { continueWithAi: true, claimedBy: null, staffActive: false });

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
        'Eon will continue answering questions in this ticket until a staff member arrives to assist.'
      );

      return interaction.reply({
        embeds: [aiResumeEmbed],
        components: [row]
      });
    }

    // 11. Re-open Ticket
    if (customId === 'ticket_reopen') {
      if (!isStaffMember(member, interaction.guild, user)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only staff members or administrators can re-open tickets.'
        );
        return interaction.reply({ embeds: [warnEmbed], flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();
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
      if (!isStaffMember(member, interaction.guild, user)) {
        const warnEmbed = embedBuilder.createWarningEmbed(
          'Permission Denied',
          'Only staff members or administrators can delete ticket channels.'
        );
        return interaction.reply({ embeds: [warnEmbed], flags: MessageFlags.Ephemeral });
      }
      const deleteWarning = embedBuilder.createWarningEmbed(
        'Channel Deletion',
        '⛔ Permanently deleting ticket channel in **5 seconds**...'
      );
      await interaction.reply({ embeds: [deleteWarning] }).catch(() => {});
      return ticketManager.deleteTicket(channel, user);
    }

    // 13. Self-Learning: Approve Suggestion
    if (customId.startsWith('learn_approve_')) {
      const suggId = customId.replace('learn_approve_', '');
      const suggestion = db.getSuggestion(suggId);
      if (!suggestion) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', `Suggestion \`${suggId}\` not found.`);
        return interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
      }
      if (suggestion.status !== 'pending') {
        const warnEmbed = embedBuilder.createWarningEmbed('Notice', `Suggestion \`${suggId}\` has already been ${suggestion.status}.`);
        return interaction.reply({ embeds: [warnEmbed], flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply();

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
        return interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
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
        return interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
      }
      if (draft.status !== 'pending') {
        const warnEmbed = embedBuilder.createWarningEmbed('Notice', `Draft \`${draftId}\` has already been ${draft.status}.`);
        return interaction.reply({ embeds: [warnEmbed], flags: MessageFlags.Ephemeral });
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
        return interaction.followUp({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
      }
    }

    // 16. DM Interactive Draft: Decline
    if (customId.startsWith('dm_decline_draft_')) {
      const draftId = customId.replace('dm_decline_draft_', '');
      const draft = db.getDraft(draftId);
      if (!draft) {
        const errEmbed = embedBuilder.createErrorEmbed('Error', `Draft \`${draftId}\` not found.`);
        return interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral });
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

    // ── Panel Action Confirmation Buttons ───────────────────────────────────────
    // Format: panel_action_confirm|<type>|<serverId>|<param>|<ownerDiscordId>
    if (customId.startsWith('panel_action_confirm|')) {
      const ticket = db.getTicket(channel?.id);

      // Only ticket owner or staff can confirm
      const isOwner = ticket && ticket.userId === user.id;
      const staffMember = isStaffMember(member, guild, user);
      if (!isOwner && !staffMember) {
        return interaction.reply({
          content: '❌ Only the ticket owner or staff can confirm this action.',
          flags: MessageFlags.Ephemeral
        });
      }

      // Parse the action from customId
      const parts = customId.split('|');
      // parts: [0]=panel_action_confirm [1]=type [2]=serverId [3]=param [4]=ownerDiscordId
      if (parts.length < 5) {
        return interaction.reply({ content: '❌ Malformed action button.', flags: MessageFlags.Ephemeral });
      }

      const action = {
        type: parts[1],
        serverId: Number(parts[2]),
        param: parts[3],
        ownerDiscordId: parts[4]
      };

      // Remove buttons from confirmation message
      await interaction.message?.edit({ components: [] }).catch(() => {});

      await executeConfirmedAction(interaction, action);
      return;
    }

    if (customId === 'panel_action_cancel') {
      await handleActionCancel(interaction);
      return;
    }

    // ── Happy Hour Claim Button ──────────────────────────────────────
    // Format: happy_hour_claim|<eventId>
    if (customId.startsWith('happy_hour_claim|')) {
      const eventId = customId.split('|')[1];
      if (!eventId) {
        return interaction.reply({ content: '❌ Malformed claim button.', flags: MessageFlags.Ephemeral });
      }
      await handleHappyHourClaim(interaction, eventId);
      return;
    }
  }
};
