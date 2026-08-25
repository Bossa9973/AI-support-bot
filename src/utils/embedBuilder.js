const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const config = require('../config');

module.exports = {
  /**
   * Panel Embed that is posted in the public support channel for creating tickets (Ticket Tool style).
   */
  createTicketPanel() {
    const embed = new EmbedBuilder()
      .setColor(config.tickets.embedColor || '#5865F2')
      .setTitle('📩 Open a Support Ticket')
      .setDescription(
        'Need help or have questions?\nClick the button below to open a private support ticket with our team and AI assistant.'
      )
      .addFields([
        {
          name: '🤖 AI Fast Support',
          value: 'Get immediate answers to common questions, setup guides, and troubleshooting.',
          inline: true
        },
        {
          name: '👥 Staff Assistance',
          value: 'Our support team can be called at any time during your ticket.',
          inline: true
        }
      ])
      .setFooter({ text: 'Support Ticket System • Powered by AI' })
      .setTimestamp();

    const button = new ButtonBuilder()
      .setCustomId('ticket_create')
      .setLabel('Create Ticket')
      .setEmoji('📩')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(button);

    return { embeds: [embed], components: [row] };
  },

  /**
   * Initial embed posted inside the newly created ticket channel.
   */
  createTicketGreeting(ticketUser, ticketNumber) {
    const rawGreeting = config.tickets.greetingMessage || "Hello {user}, thank you for reaching out! 👋\nPlease describe your issue or question in detail, and our AI support assistant will be right with you.";
    const formattedGreeting = rawGreeting.replace(/\{user\}/g, `<@${ticketUser.id}>`);

    const embed = new EmbedBuilder()
      .setColor(config.tickets.embedColor || '#5865F2')
      .setTitle(`🎫 Ticket #${String(ticketNumber).padStart(4, '0')}`)
      .setDescription(formattedGreeting)
      .addFields([
        { name: '👤 Opened by', value: `<@${ticketUser.id}>`, inline: true },
        { name: '🤖 AI Assistant', value: 'Active & Listening', inline: true },
        { name: '⚙️ Controls', value: 'Use the buttons below to manage this ticket.', inline: false }
      ])
      .setFooter({ text: 'Support Ticket • Click Close when resolved' })
      .setTimestamp();

    const closeBtn = new ButtonBuilder()
      .setCustomId('ticket_close_request')
      .setLabel('Close')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger);

    const transcriptBtn = new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('Transcript')
      .setEmoji('📑')
      .setStyle(ButtonStyle.Secondary);

    const claimBtn = new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel('Claim')
      .setEmoji('🙋‍♂️')
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(closeBtn, transcriptBtn, claimBtn);

    return { content: `<@${ticketUser.id}>`, embeds: [embed], components: [row] };
  },

  /**
   * Staff Handoff Alert Embed with 3 Priority Tiers (Red, Yellow, Green).
   * @param {string} summary 
   * @param {'red'|'yellow'|'green'} priority 
   * @param {string|null} supportRoleId 
   */
  createStaffHandoffEmbed(summary, priority = 'green', supportRoleId = null) {
    const roleTag = supportRoleId ? `<@&${supportRoleId}>` : '**Support Team**';
    const normPriority = (priority || 'green').toLowerCase();

    let color = '#57F287'; // Default Green
    let title = '🟢 [STANDARD SUPPORT] Priority: GREEN';
    let urgencyNote = 'AI has escalated this ticket for standard staff review.';
    let btnStyle = ButtonStyle.Success;
    let btnLabel = 'Claim Ticket';

    if (normPriority === 'red') {
      color = '#ED4245'; // Critical Red
      title = '🚨 [CRITICAL EMERGENCY] Priority: RED';
      urgencyNote = '🔥 **CRITICAL ISSUE DETECTED** (e.g. Downtime, Data Loss, Security Breach, Node Failure). Immediate response required!';
      btnStyle = ButtonStyle.Danger;
      btnLabel = 'Claim Emergency Ticket';
    } else if (normPriority === 'yellow' || normPriority === 'orange') {
      color = '#FEE75C'; // Elevated Yellow
      title = '⚠️ [ELEVATED PRIORITY] Priority: YELLOW';
      urgencyNote = 'User has a non-destructive blocker or billing/setup hurdle requiring staff attention.';
      btnStyle = ButtonStyle.Primary;
      btnLabel = 'Claim Ticket';
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(`${roleTag}\n\n**Issue Summary from AI Assistant:**\n${summary}`)
      .addFields([
        {
          name: '📊 Priority Assessment',
          value: urgencyNote,
          inline: false
        }
      ])
      .setFooter({ text: `Team Vertex Support • Priority: ${normPriority.toUpperCase()}` })
      .setTimestamp();

    const claimBtn = new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel(btnLabel)
      .setEmoji('🙋‍♂️')
      .setStyle(btnStyle);

    const continueAiBtn = new ButtonBuilder()
      .setCustomId('ticket_continue_ai')
      .setLabel('Continue with AI')
      .setEmoji('🤖')
      .setStyle(ButtonStyle.Secondary);

    const transferBtn = new ButtonBuilder()
      .setCustomId('ticket_transfer')
      .setLabel('Transfer')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(claimBtn, transferBtn, continueAiBtn);

    return {
      content: supportRoleId ? `<@&${supportRoleId}>` : undefined,
      embeds: [embed],
      components: [row]
    };
  },

  /**
   * Confirmation prompt when user clicks Close.
   */
  createCloseConfirmation() {
    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('🔒 Close Confirmation')
      .setDescription('Are you sure you want to close this ticket?');

    const confirmBtn = new ButtonBuilder()
      .setCustomId('ticket_close_confirm')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId('ticket_close_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    return { embeds: [embed], components: [row] };
  },

  /**
   * Resolution prompt asked to the user when AI solves an issue.
   * @param {string} userId 
   */
  createResolutionPrompt(userId) {
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('❓ Did this solve your issue?')
      .setDescription(
        `Hey <@${userId}>, please let us know if your question or issue has been resolved so we can keep our support queue clean.`
      )
      .setFooter({ text: 'Auto-closes after 10 minutes of inactivity if unresolved' });

    const yesBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_yes')
      .setLabel('Yes, Close Ticket')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success);

    const noBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_no')
      .setLabel('No, Need More Help')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(yesBtn, noBtn);

    return { embeds: [embed], components: [row] };
  },

  /**
   * 5-minute inactivity reminder pinging the user.
   * @param {string} userId 
   */
  createInactivityReminder(userId) {
    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('⏳ Ticket Inactivity Reminder')
      .setDescription(
        `Hey <@${userId}>! Just checking in to make sure everything is taken care of.\n\n` +
        `• If you're all set, click **Yes, Close Ticket** below.\n` +
        `• If you still need help, reply in this channel or click **No, Need More Help**.\n\n` +
        `⏰ *This ticket will automatically close in **5 minutes** if no response is received.*`
      )
      .setTimestamp();

    const yesBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_yes')
      .setLabel('Yes, Close Ticket')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success);

    const noBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_no')
      .setLabel('No, Need More Help')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(yesBtn, noBtn);

    return { content: `<@${userId}>`, embeds: [embed], components: [row] };
  },

  /**
   * Controls shown once a ticket has been closed (Reopen, Transcript, Delete).
   */
  createClosedControls(closedByUserId) {
    const embed = new EmbedBuilder()
      .setColor('#2F3136')
      .setTitle('🔒 Ticket Closed')
      .setDescription(`This ticket was closed by <@${closedByUserId}>.\nStaff members can re-open or permanently delete this channel.`)
      .setTimestamp();

    const reopenBtn = new ButtonBuilder()
      .setCustomId('ticket_reopen')
      .setLabel('Re-open')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Success);

    const transcriptBtn = new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('Transcript')
      .setEmoji('📑')
      .setStyle(ButtonStyle.Secondary);

    const deleteBtn = new ButtonBuilder()
      .setCustomId('ticket_delete')
      .setLabel('Delete')
      .setEmoji('⛔')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(reopenBtn, transcriptBtn, deleteBtn);

    return { embeds: [embed], components: [row] };
  },

  /**
   * Transcript log embed for the log channel.
   */
  createTranscriptLogEmbed(ticketData, closedByUser, messageCount) {
    const priorityEmoji = ticketData.priority === 'red' ? '🔴' : (ticketData.priority === 'yellow' ? '🟡' : '🟢');
    return new EmbedBuilder()
      .setColor(config.tickets.embedColor || '#5865F2')
      .setTitle(`📑 Ticket Log: #${String(ticketData.ticketNumber).padStart(4, '0')}`)
      .addFields([
        { name: '🎫 Ticket ID', value: `#${String(ticketData.ticketNumber).padStart(4, '0')}`, inline: true },
        { name: '👤 Owner', value: `<@${ticketData.userId}>`, inline: true },
        { name: '🔒 Closed By', value: `<@${closedByUser.id}>`, inline: true },
        { name: '📊 Priority', value: `${priorityEmoji} ${(ticketData.priority || 'normal').toUpperCase()}`, inline: true },
        { name: '💬 Total Messages', value: `${messageCount}`, inline: true },
        { name: '⏰ Created', value: `<t:${Math.floor(new Date(ticketData.createdAt).getTime() / 1000)}:R>`, inline: true }
      ])
      .setFooter({ text: 'Ticket Transcript Archive' })
      .setTimestamp();
  }
};
