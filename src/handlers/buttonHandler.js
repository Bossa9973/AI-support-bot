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

    // 2. User Confirmed Issue Resolved ("Yes, Close Ticket")
    if (customId === 'ticket_resolve_yes') {
      resolutionManager.clearTimers(channel.id);
      try {
        await interaction.update({ content: '✅ Issue resolved! Closing ticket and generating transcript...', embeds: [], components: [] });
      } catch {
        await interaction.reply({ content: '✅ Issue resolved! Closing ticket and generating transcript...', ephemeral: false }).catch(() => {});
      }
      return ticketManager.closeTicket(channel, user, 'Resolved by user confirmation');
    }

    // 3. User Needs More Help ("No, Need More Help")
    if (customId === 'ticket_resolve_no') {
      resolutionManager.clearTimers(channel.id);
      try {
        await interaction.update({
          content: '👍 Understood! The ticket remains open. What else can we help you with?',
          embeds: [],
          components: []
        });
      } catch {
        await interaction.reply({ content: '👍 Understood! What else can we help you with?' }).catch(() => {});
      }
      return;
    }

    // 4. Close Ticket Request (Show Confirmation)
    if (customId === 'ticket_close_request') {
      const confirmation = embedBuilder.createCloseConfirmation();
      return interaction.reply({ ...confirmation, ephemeral: true });
    }

    // 3. Confirm Close Ticket
    if (customId === 'ticket_close_confirm') {
      try {
        await interaction.update({ content: '🔒 Closing ticket and generating transcript...', embeds: [], components: [] });
      } catch {
        await interaction.reply({ content: '🔒 Closing ticket and generating transcript...', ephemeral: false }).catch(() => {});
      }
      return ticketManager.closeTicket(channel, user);
    }

    // 4. Cancel Close Ticket
    if (customId === 'ticket_close_cancel') {
      try {
        return await interaction.update({ content: '❌ Ticket close cancelled.', embeds: [], components: [] });
      } catch {
        return interaction.reply({ content: '❌ Ticket close cancelled.', ephemeral: true });
      }
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
          content: `⚠️ This ticket has already been claimed by <@${ticketData.claimedBy}>. Use **Transfer** to reassign it.`,
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
        .setLabel('Close')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(transferBtn, closeBtn);

      return interaction.reply({
        content: `🙋‍♂️ **Ticket Claimed**: <@${user.id}> has claimed this ticket and is now assisting.`,
        components: [row]
      });
    }

    // 7. Transfer Ticket (Unclaim and make available for other staff)
    if (customId === 'ticket_transfer') {
      const ticketData = db.getTicket(channel.id);
      if (!ticketData) {
        return interaction.reply({ content: 'This channel is not an active ticket.', ephemeral: true });
      }

      if (!isStaffMember(member)) {
        return interaction.reply({
          content: '⚠️ Only support team members or administrators can transfer tickets.',
          ephemeral: true
        });
      }

      const prevClaimed = ticketData.claimedBy;
      db.unclaimTicket(channel.id);

      const claimBtn = new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim Ticket')
        .setEmoji('🙋‍♂️')
        .setStyle(ButtonStyle.Success);

      const continueAiBtn = new ButtonBuilder()
        .setCustomId('ticket_continue_ai')
        .setLabel('Continue with AI')
        .setEmoji('🤖')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(claimBtn, continueAiBtn);

      return interaction.reply({
        content: `🔄 **Ticket Transferred / Unclaimed**: <@${user.id}> unassigned this ticket${prevClaimed ? ` (previously claimed by <@${prevClaimed}>)` : ''}. It is now open for any staff member to claim.`,
        components: [row]
      });
    }

    // 8. Continue with AI (Keep AI responding until staff takes over)
    if (customId === 'ticket_continue_ai') {
      const ticketData = db.getTicket(channel.id);
      if (!ticketData) {
        return interaction.reply({ content: 'This channel is not an active ticket.', ephemeral: true });
      }

      db.updateTicket(channel.id, { continueWithAi: true, claimedBy: null });

      const claimBtn = new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel('Claim Ticket')
        .setEmoji('🙋‍♂️')
        .setStyle(ButtonStyle.Success);

      const transferBtn = new ButtonBuilder()
        .setCustomId('ticket_transfer')
        .setLabel('Transfer')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary);

      const row = new ActionRowBuilder().addComponents(claimBtn, transferBtn);

      return interaction.reply({
        content: `🤖 **AI Assistance Active**: I will continue answering your questions in this ticket until a staff member arrives.`,
        components: [row]
      });
    }

    // 9. Re-open Ticket
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

    // 10. Delete Ticket
    if (customId === 'ticket_delete') {
      if (!isStaffMember(member)) {
        return interaction.reply({ content: '⚠️ Only staff members can delete tickets.', ephemeral: true });
      }
      await interaction.reply({ content: '⛔ *Deleting ticket channel in 5 seconds...*', ephemeral: false }).catch(() => {});
      return ticketManager.deleteTicket(channel, user);
    }

    // 11. Self-Learning: Approve Suggestion
    if (customId.startsWith('learn_approve_')) {
      const suggId = customId.replace('learn_approve_', '');
      const suggestion = db.getSuggestion(suggId);
      if (!suggestion) {
        return interaction.reply({ content: `⚠️ Suggestion \`${suggId}\` not found.`, ephemeral: true });
      }
      if (suggestion.status !== 'pending') {
        return interaction.reply({ content: `⚠️ Suggestion \`${suggId}\` has already been ${suggestion.status}.`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });

      try {
        if (suggestion.type === 'lesson') {
          knowledgeManager.saveLesson(suggestion.key, suggestion.fact);
        } else if (suggestion.type === 'article') {
          knowledgeManager.saveArticle(suggestion.category, suggestion.title, suggestion.content);
        }
        db.approveSuggestion(suggId);

        return interaction.editReply({
          content: `✅ **Suggestion \`${suggId}\` approved and added to the knowledge base.**\n${suggestion.type === 'lesson' ? `💡 Lesson: \`${suggestion.key}\`` : `📖 Article: **${suggestion.title}** in \`${suggestion.category}\``}`
        });
      } catch (err) {
        return interaction.editReply({ content: `❌ Failed to apply suggestion: ${err.message}` });
      }
    }

    // 12. Self-Learning: Reject Suggestion
    if (customId.startsWith('learn_reject_')) {
      const suggId = customId.replace('learn_reject_', '');
      const suggestion = db.getSuggestion(suggId);
      if (!suggestion) {
        return interaction.reply({ content: `⚠️ Suggestion \`${suggId}\` not found.`, ephemeral: true });
      }
      db.rejectSuggestion(suggId);
      return interaction.reply({
        content: `❌ Suggestion \`${suggId}\` rejected. It won't be applied to the knowledge base.`
      });
    }

    // 13. DM Interactive Draft: Accept & Save
    if (customId.startsWith('dm_accept_draft_')) {
      const draftId = customId.replace('dm_accept_draft_', '');
      const draft = db.getDraft(draftId);
      if (!draft) {
        return interaction.reply({ content: `⚠️ Draft \`${draftId}\` not found or already processed.`, ephemeral: true });
      }
      if (draft.status !== 'pending') {
        return interaction.reply({ content: `⚠️ Draft \`${draftId}\` has already been ${draft.status}.`, ephemeral: true });
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

        const { EmbedBuilder: ButtonEmbed } = require('discord.js');
        const confirmEmbed = new ButtonEmbed()
          .setColor('#57F287')
          .setTitle(`✅ Draft Accepted & Published`)
          .setDescription(
            draft.type === 'article'
              ? `📖 **Article Saved**: \`${draft.category}/${saveResult.slug}.md\` (${draft.title})\n\nI am now actively utilizing this knowledge for all ticket responses.`
              : draft.type === 'lesson'
              ? `💡 **Lesson Learned**: \`${draft.key}\`\n> ${draft.fact}\n\nI have saved this atomic fact to my live memory.`
              : `🚨 **Override Enacted**: \`${saveResult.id}\`\n> ${draft.directive}\n\nThis directive is now in effect across all tickets.`
          )
          .setFooter({ text: `Draft ID: ${draftId} • Saved to Knowledge Base` })
          .setTimestamp();

        return interaction.editReply({
          content: '🎉 **Successfully published to knowledge base, Boss!**',
          embeds: [confirmEmbed],
          components: []
        });
      } catch (err) {
        return interaction.followUp({ content: `❌ Error saving draft: ${err.message}`, ephemeral: true });
      }
    }

    // 14. DM Interactive Draft: Decline
    if (customId.startsWith('dm_decline_draft_')) {
      const draftId = customId.replace('dm_decline_draft_', '');
      const draft = db.getDraft(draftId);
      if (!draft) {
        return interaction.reply({ content: `⚠️ Draft \`${draftId}\` not found.`, ephemeral: true });
      }
      db.rejectDraft(draftId);

      const { EmbedBuilder: ButtonEmbed } = require('discord.js');
      const declineEmbed = new ButtonEmbed()
        .setColor('#ED4245')
        .setTitle(`❌ Draft Declined & Discarded`)
        .setDescription(`Draft \`${draftId}\` (${(draft.type || 'draft').toUpperCase()}: **${draft.title || draft.key || draft.directive || 'Draft'}**) was discarded.\nNo changes were made to the knowledge base.`)
        .setFooter({ text: 'You can give me new instructions anytime to propose a fresh draft.' });

      try {
        await interaction.update({
          content: '🗑️ Draft discarded.',
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
