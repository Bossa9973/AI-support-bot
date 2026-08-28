const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Primary Brand Palette
const BRAND_COLOR = config.tickets.embedColor || '#00d285';
const SUCCESS_COLOR = '#57F287';
const WARNING_COLOR = '#FEE75C';
const DANGER_COLOR = '#ED4245';
const DARK_PANEL_COLOR = '#2B2D31';

// Custom System Emojis
const EMOJIS = {
  // Category Emojis
  cart: '<:cart:1541899176135237773>',
  account: '<:emoji2:1541900863310794863>',
  bug: '<:bug:1541903664707272804>',
  technical: '<:Code:1541900534662045717>',
  support: '<:support:1541899692567302296>',
  info: '<:info:1541899910373187614>',
  gift: '<:Gift:1541901863849431050>',

  // Priority Time Badges
  emergency: '<:replace_time4:1541902633982238899>', // Critical / Emergency (Red)
  moderate: '<:replace_time3:1541902584955150469>',  // Moderate / High (Orange)
  mid: '<:replace_time2:1541902531259531334>',       // Mid / Elevated (Yellow)
  standard: '<:replace_time1:1541902476779855955>',  // Low / Standard (Green)

  // Bot & Ticket UI Icons
  ticket: '<:ticket:1541904611584114689>',
  user: '<:user:1541904678768480307>',
  deleteTicket: '<:emoji22:1541903146807332906>',
  reopenTicket: '<:ticket_open:1541905670536962078>',
  closeTicket: '<:ticket_close:1541905770214334627>',
  claimTicket: '<:emoji43:1541903349429968936>',
  continueAi: '<:emoji31:1541903062514274316>',
  transcript: '📑'
};

// Helper to safely parse custom and unicode emojis for Discord components
function parseEmoji(raw) {
  if (!raw) return undefined;
  const match = String(raw).match(/<(a?):([a-zA-Z0-9_]+):([0-9]+)>/);
  if (match) {
    return { name: match[2], id: match[3], animated: match[1] === 'a' };
  }
  return raw;
}

// Categories sorted by priority
const TICKET_CATEGORIES = [
  {
    id: 'purchase_vps',
    label: 'Purchase VPS',
    emoji: EMOJIS.cart,
    description: 'Inquire about paid VPS plans, upgrades & custom orders',
    priorityRank: 1
  },
  {
    id: 'account_issue',
    label: 'Account Issue',
    emoji: EMOJIS.account,
    description: 'Login, password reset, or client area account problems',
    priorityRank: 2
  },
  {
    id: 'report_bug',
    label: 'Report Bug',
    emoji: EMOJIS.bug,
    description: 'Report node glitches, panel errors, or service defects',
    priorityRank: 3
  },
  {
    id: 'technical_questions',
    label: 'Technical Questions',
    emoji: EMOJIS.technical,
    description: 'NAT port forwarding, networking, OS & server diagnostics',
    priorityRank: 4
  },
  {
    id: 'general_support',
    label: 'General Support',
    emoji: EMOJIS.support,
    description: 'Assistance with server management, dashboard & services',
    priorityRank: 5
  },
  {
    id: 'general_question',
    label: 'General Question',
    emoji: EMOJIS.info,
    description: 'General inquiries, basic help & platform information',
    priorityRank: 6
  },
  {
    id: 'claim_giveaway',
    label: 'Claim Giveaway Reward',
    emoji: EMOJIS.gift,
    description: 'Claim event prizes, bolts or booster rewards',
    priorityRank: 7
  }
];

function getCategoryData(categoryId) {
  const cat = TICKET_CATEGORIES.find((c) => c.id === categoryId);
  return cat || {
    id: 'general_support',
    label: 'General Support',
    emoji: EMOJIS.support,
    description: 'Assistance with server management and dashboard'
  };
}

module.exports = {
  BRAND_COLOR,
  SUCCESS_COLOR,
  WARNING_COLOR,
  DANGER_COLOR,
  DARK_PANEL_COLOR,
  EMOJIS,
  TICKET_CATEGORIES,
  parseEmoji,
  getCategoryData,

  /**
   * Dropdown Ticket Panel Embed (matches modern reference design).
   */
  createTicketPanel(guild = null) {
    const guildName = guild?.name || 'Support';
    const categoryListLines = TICKET_CATEGORIES.map(
      (cat) => `### ${cat.emoji} ${cat.label}`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('🎫 Ticket System')
      .setDescription(
        `Please select a category below to create a ticket:\n\n${categoryListLines}`
      )
      .setFooter({ text: `${guildName} • Ticket System` })
      .setTimestamp();

    let files = [];

    const logoPath = path.join(__dirname, '../../assets/logo.png');
    const hasLogo = fs.existsSync(logoPath);
    if (hasLogo) {
      const logoAttachment = new AttachmentBuilder(logoPath, { name: 'logo.png' });
      embed.setThumbnail('attachment://logo.png');
      files.push(logoAttachment);
    } else if (guild && typeof guild.iconURL === 'function' && guild.iconURL()) {
      embed.setThumbnail(guild.iconURL({ dynamic: true, size: 256 }));
    }

    const bannerPath = path.join(__dirname, '../../assets/support-banner.jpg');
    const hasBanner = fs.existsSync(bannerPath);
    if (hasBanner) {
      const bannerAttachment = new AttachmentBuilder(bannerPath, { name: 'support-banner.jpg' });
      embed.setImage('attachment://support-banner.jpg');
      files.push(bannerAttachment);
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category_select')
      .setPlaceholder('Select a ticket category...')
      .addOptions(
        TICKET_CATEGORIES.map((cat) => {
          const opt = new StringSelectMenuOptionBuilder()
            .setLabel(cat.label)
            .setValue(cat.id)
            .setDescription(cat.description);

          const parsed = parseEmoji(cat.emoji);
          if (parsed) {
            opt.setEmoji(parsed);
          }
          return opt;
        })
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);

    return { embeds: [embed], components: [row], files };
  },

  /**
   * Initial embed posted inside the newly created ticket channel.
   */
  createTicketGreeting(ticketUser, ticketNumber, categoryId = 'general_support') {
    const formattedNumber = String(ticketNumber).padStart(4, '0');
    const categoryData = getCategoryData(categoryId);
    const rawGreeting = config.tickets.greetingMessage || "Hello {user}, thank you for reaching out! 👋\nPlease describe your issue or question in detail, and our AI support assistant will be right with you.";
    const formattedGreeting = rawGreeting.replace(/\{user\}/g, `<@${ticketUser.id}>`);

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`Support Ticket • #${formattedNumber}`)
      .setDescription(
        `${formattedGreeting}\n\n` +
        `> **Selected Category**: ${categoryData.emoji} **${categoryData.label}**\n` +
        `> Describe your issue or attach error logs/screenshots. Our AI assistant is active, and human staff can be paged at any time.`
      )
      .addFields([
        { name: `${EMOJIS.user} Opened By`, value: `<@${ticketUser.id}>`, inline: true },
        { name: '🏷️ Category', value: `${categoryData.emoji} ${categoryData.label}`, inline: true },
        { name: '🤖 AI Assistant', value: '`🟢 Active & Listening`', inline: true }
      ])
      .setFooter({ text: `Ticket #${formattedNumber} • Click Close when resolved` })
      .setTimestamp();

    const closeBtn = new ButtonBuilder()
      .setCustomId('ticket_close_request')
      .setLabel('Close')
      .setEmoji(parseEmoji(EMOJIS.closeTicket))
      .setStyle(ButtonStyle.Danger);

    const transcriptBtn = new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('Transcript')
      .setEmoji(parseEmoji(EMOJIS.transcript))
      .setStyle(ButtonStyle.Secondary);

    const claimBtn = new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel('Claim')
      .setEmoji(parseEmoji(EMOJIS.claimTicket))
      .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(closeBtn, transcriptBtn, claimBtn);

    return { content: `<@${ticketUser.id}>`, embeds: [embed], components: [row] };
  },

  /**
   * Staff Handoff Alert Embed with 3 Priority Tiers.
   */
  createStaffHandoffEmbed(summary, priority = 'green', supportRoleId = null) {
    const roleTag = supportRoleId ? `<@&${supportRoleId}>` : '**Support Team**';
    const normPriority = (priority || 'green').toLowerCase();

    let color = SUCCESS_COLOR;
    let priorityBadge = `${EMOJIS.standard} [STANDARD INQUIRY] Priority: Low`;
    let urgencyNote = 'Standard inquiry escalated for staff review or panel execution.';
    let btnStyle = ButtonStyle.Success;
    let btnLabel = 'Claim Ticket';

    if (normPriority === 'red' || normPriority === 'emergency') {
      color = DANGER_COLOR;
      priorityBadge = `${EMOJIS.emergency} [CRITICAL EMERGENCY] Priority: Emergency`;
      urgencyNote = '🔥 **CRITICAL SEVERITY**: Outage, severe node failure, security issue, or data risk detected. Immediate engineer review required!';
      btnStyle = ButtonStyle.Danger;
      btnLabel = 'Claim Emergency Ticket';
    } else if (normPriority === 'yellow' || normPriority === 'orange' || normPriority === 'moderate') {
      color = WARNING_COLOR;
      priorityBadge = `${EMOJIS.moderate} [ELEVATED PRIORITY] Priority: Moderate`;
      urgencyNote = 'User has a non-destructive blocker, port/NAT routing request, or billing hurdle requiring staff assistance.';
      btnStyle = ButtonStyle.Primary;
      btnLabel = 'Claim Ticket';
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(priorityBadge)
      .setDescription(
        `${roleTag}\n\n` +
        `**📋 AI Briefing & Issue Summary:**\n` +
        `> ${summary.replace(/\n/g, '\n> ')}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      )
      .addFields([
        {
          name: '📊 Priority Assessment',
          value: urgencyNote,
          inline: false
        }
      ])
      .setFooter({ text: `Staff Dispatch • Priority: ${normPriority.toUpperCase()}` })
      .setTimestamp();

    const claimBtn = new ButtonBuilder()
      .setCustomId('ticket_claim')
      .setLabel(btnLabel)
      .setEmoji(parseEmoji(EMOJIS.claimTicket))
      .setStyle(btnStyle);

    const transferBtn = new ButtonBuilder()
      .setCustomId('ticket_transfer')
      .setLabel('Transfer')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary);

    const continueAiBtn = new ButtonBuilder()
      .setCustomId('ticket_continue_ai')
      .setLabel('Continue with AI')
      .setEmoji(parseEmoji(EMOJIS.continueAi))
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
      .setColor(DANGER_COLOR)
      .setTitle(`${EMOJIS.closeTicket} Confirm Ticket Closure`)
      .setDescription(
        'Are you sure you want to close this ticket?\n\n' +
        '• The channel will be locked and an HTML transcript generated.\n' +
        '• Staff will have the option to re-open or permanently delete the channel.'
      )
      .setFooter({ text: 'Closing a ticket archives the full chat transcript' });

    const confirmBtn = new ButtonBuilder()
      .setCustomId('ticket_close_confirm')
      .setLabel('Yes, Close Ticket')
      .setEmoji(parseEmoji(EMOJIS.closeTicket))
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId('ticket_close_cancel')
      .setLabel('Cancel')
      .setEmoji('↩️')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

    return { embeds: [embed], components: [row] };
  },

  /**
   * Resolution prompt asked to the user when AI solves an issue.
   */
  createResolutionPrompt(userId) {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('❓ Did this solve your issue?')
      .setDescription(
        `Hey <@${userId}>! Our AI assistant provided a solution above.\n\n` +
        `Please let us know if your question or issue has been resolved so we can keep our support queue organized.`
      )
      .setFooter({ text: 'Auto-closes after 10 minutes of inactivity if resolved' });

    const yesBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_yes')
      .setLabel('Yes, Close Ticket')
      .setEmoji(parseEmoji(EMOJIS.closeTicket))
      .setStyle(ButtonStyle.Success);

    const noBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_no')
      .setLabel('No, Need More Help')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(yesBtn, noBtn);

    return { embeds: [embed], components: [row] };
  },

  /**
   * 5-minute inactivity reminder pinging the user.
   */
  createInactivityReminder(userId) {
    const embed = new EmbedBuilder()
      .setColor(WARNING_COLOR)
      .setTitle('⏳ Inactivity Check & Auto-Close Warning')
      .setDescription(
        `Hey <@${userId}>! Just checking in to make sure you're all set with your inquiry.\n\n` +
        `• **Issue Resolved?** Click **Yes, Close Ticket** below.\n` +
        `• **Still Need Help?** Simply reply in this channel or click **No, Need More Help**.\n\n` +
        `⏰ *This ticket will automatically archive in **5 minutes** if no response is received.*`
      )
      .setFooter({ text: 'Automated Ticket Queue Maintenance' })
      .setTimestamp();

    const yesBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_yes')
      .setLabel('Yes, Close Ticket')
      .setEmoji(parseEmoji(EMOJIS.closeTicket))
      .setStyle(ButtonStyle.Success);

    const noBtn = new ButtonBuilder()
      .setCustomId('ticket_resolve_no')
      .setLabel('No, Need More Help')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(yesBtn, noBtn);

    return { content: `<@${userId}>`, embeds: [embed], components: [row] };
  },

  /**
   * Controls shown once a ticket has been closed (Reopen, Transcript, Delete).
   */
  createClosedControls(closedByUserId) {
    const embed = new EmbedBuilder()
      .setColor(DARK_PANEL_COLOR)
      .setTitle('🔒 Ticket Closed & Archived')
      .setDescription(
        `This ticket was closed by <@${closedByUserId}>.\n\n` +
        `**Staff Controls:**\n` +
        `• **Re-open**: Restores user permissions and moves ticket back to active.\n` +
        `• **Transcript**: Downloads a complete HTML transcript of the discussion.\n` +
        `• **Delete**: Permanently removes this channel after a countdown.`
      )
      .setFooter({ text: 'Support Ticket System • Channel Locked' })
      .setTimestamp();

    const reopenBtn = new ButtonBuilder()
      .setCustomId('ticket_reopen')
      .setLabel('Re-open Ticket')
      .setEmoji(parseEmoji(EMOJIS.reopenTicket))
      .setStyle(ButtonStyle.Success);

    const transcriptBtn = new ButtonBuilder()
      .setCustomId('ticket_transcript')
      .setLabel('Download Transcript')
      .setEmoji(parseEmoji(EMOJIS.transcript))
      .setStyle(ButtonStyle.Secondary);

    const deleteBtn = new ButtonBuilder()
      .setCustomId('ticket_delete')
      .setLabel('Delete Channel')
      .setEmoji(parseEmoji(EMOJIS.deleteTicket))
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(reopenBtn, transcriptBtn, deleteBtn);

    return { embeds: [embed], components: [row] };
  },

  /**
   * User DM Embed sent when a ticket is closed with the HTML transcript attachment.
   */
  createTranscriptUserDMEmbed(ticketData, guild, closedByUser, messageCount) {
    const categoryData = getCategoryData(ticketData.category);
    const createdTimestamp = ticketData.createdAt
      ? Math.floor(new Date(ticketData.createdAt).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`Support Ticket Closed • #${String(ticketData.ticketNumber).padStart(4, '0')}`)
      .setDescription(
        `Thank you for contacting **${guild?.name || 'Support'}**! Your support ticket has been closed.\n\n` +
        `A complete interactive HTML transcript has been attached below for your records.`
      )
      .addFields([
        { name: `${EMOJIS.ticket} Ticket ID`, value: `\`#${String(ticketData.ticketNumber).padStart(4, '0')}\``, inline: true },
        { name: '🏷️ Category', value: `${categoryData.emoji} ${categoryData.label}`, inline: true },
        { name: `${EMOJIS.user} Closed By`, value: `<@${closedByUser.id}>`, inline: true },
        { name: '💬 Total Messages', value: `\`${messageCount}\``, inline: true },
        { name: '⏰ Created', value: `<t:${createdTimestamp}:R>`, inline: true }
      ])
      .setFooter({ text: `${guild?.name || 'Support'} • Ticket Archive` })
      .setTimestamp();

    if (guild && typeof guild.iconURL === 'function' && guild.iconURL()) {
      embed.setThumbnail(guild.iconURL({ dynamic: true, size: 128 }));
    }

    return embed;
  },

  /**
   * Transcript log embed for the log channel.
   */
  createTranscriptLogEmbed(ticketData, closedByUser, messageCount) {
    const categoryData = getCategoryData(ticketData.category);
    const priority = (ticketData.priority || 'green').toLowerCase();
    const priorityEmoji = priority === 'red' ? EMOJIS.emergency : (priority === 'yellow' || priority === 'orange' ? EMOJIS.moderate : EMOJIS.standard);
    const priorityLabel = priority.toUpperCase();
    const createdTimestamp = ticketData.createdAt ? Math.floor(new Date(ticketData.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000);

    return new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`Ticket Archive • #${String(ticketData.ticketNumber).padStart(4, '0')}`)
      .setDescription('A support ticket has been closed and archived. The complete HTML transcript is attached below.')
      .addFields([
        { name: `${EMOJIS.ticket} Ticket ID`, value: `\`#${String(ticketData.ticketNumber).padStart(4, '0')}\``, inline: true },
        { name: '🏷️ Category', value: `${categoryData.emoji} ${categoryData.label}`, inline: true },
        { name: `${EMOJIS.user} Creator`, value: `<@${ticketData.userId}>`, inline: true },
        { name: `${EMOJIS.user} Closed By`, value: `<@${closedByUser.id}>`, inline: true },
        { name: '📊 Priority', value: `${priorityEmoji} \`${priorityLabel}\``, inline: true },
        { name: '💬 Messages', value: `\`${messageCount}\``, inline: true },
        { name: '⏰ Created', value: `<t:${createdTimestamp}:R>`, inline: true }
      ])
      .setFooter({ text: 'Support Ticket Transcripts' })
      .setTimestamp();
  },

  /**
   * Reusable Brand Success Embed
   */
  createSuccessEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(SUCCESS_COLOR)
      .setTitle(title.startsWith('✅') ? title : `✅ ${title}`)
      .setDescription(description)
      .setTimestamp();
  },

  /**
   * Reusable Brand Error Embed
   */
  createErrorEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(DANGER_COLOR)
      .setTitle(title.startsWith('❌') ? title : `❌ ${title}`)
      .setDescription(description)
      .setTimestamp();
  },

  /**
   * Reusable Brand Info Embed
   */
  createInfoEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();
  },

  /**
   * Reusable Brand Warning Embed
   */
  createWarningEmbed(title, description) {
    return new EmbedBuilder()
      .setColor(WARNING_COLOR)
      .setTitle(title.startsWith('⚠️') ? title : `⚠️ ${title}`)
      .setDescription(description)
      .setTimestamp();
  }
};
