const { PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');
const config = require('../config');
const { generateSupportResponse } = require('../ai/openrouter');
const embedBuilder = require('../utils/embedBuilder');

/**
 * Splits long message content into Discord-safe chunks (max 2000 chars each).
 */
function splitMessage(str, maxLen = 1950) {
  if (str.length <= maxLen) return [str];
  const chunks = [];
  let remaining = str;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let sliceIndex = remaining.lastIndexOf('\n', maxLen);
    if (sliceIndex === -1 || sliceIndex < maxLen * 0.5) {
      sliceIndex = remaining.lastIndexOf(' ', maxLen);
    }
    if (sliceIndex === -1) {
      sliceIndex = maxLen;
    }
    chunks.push(remaining.slice(0, sliceIndex));
    remaining = remaining.slice(sliceIndex).trim();
  }
  return chunks;
}

/**
 * Checks if a guild member is staff/admin.
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
   * Handles incoming text messages in ticket channels.
   * @param {import('discord.js').Message} message 
   */
  async handleMessage(message) {
    // 1. Ignore bot messages or non-guild messages
    if (message.author.bot || !message.guild) return;

    // 2. Check if channel is an active tracked ticket
    const ticket = db.getTicket(message.channel.id);
    if (!ticket || ticket.status === 'closed') return;

    // 3. Check for Staff / Admin Message (Implicit Handover)
    if (isStaffMember(message.member)) {
      // If the ticket was not claimed by this staff member yet, claim it automatically!
      if (ticket.claimedBy !== message.author.id) {
        db.claimTicket(message.channel.id, message.author.id);
        await message.channel.send({
          content: `🙋‍♂️ **Staff Takeover**: <@${message.author.id}> has joined the ticket and will be assisting directly.`
        }).catch(console.error);
      }
      // Stop AI from responding to staff messages
      return;
    }

    // 4. If ticket is already claimed by a human staff member, allow human chat without AI interruption
    if (ticket.claimedBy && !message.mentions.has(message.client.user)) {
      return;
    }

    try {
      // 5. Trigger typing indicator
      await message.channel.sendTyping();

      // 6. Fetch recent messages for conversation context
      const fetchedMessages = await message.channel.messages.fetch({ limit: 15 });
      const history = [];

      const sorted = Array.from(fetchedMessages.values()).sort(
        (a, b) => a.createdTimestamp - b.createdTimestamp
      );

      for (const msg of sorted) {
        if (msg.id === message.id) continue;
        if (!msg.content) continue;

        const role = msg.author.id === message.client.user.id ? 'assistant' : 'user';
        history.push({ role, content: `${msg.author.username}: ${msg.content}` });
      }

      // 7. Generate AI response (with intelligent handoff & priority assessment)
      const aiResult = await generateSupportResponse(
        history,
        message.content,
        message.author.username
      );

      // 8. Send the direct reply to the user
      const chunks = splitMessage(aiResult.reply);
      for (const chunk of chunks) {
        await message.channel.send({
          content: chunk,
          allowedMentions: { repliedUser: false }
        });
      }

      // 9. If AI determined that Staff Handoff is required
      if (aiResult.handoff) {
        const priority = aiResult.priority || 'green';

        // Tag admin/support role + send prioritized summary embed with "Claim Ticket" button
        const handoffEmbed = embedBuilder.createStaffHandoffEmbed(
          aiResult.summary,
          priority,
          config.tickets.supportRoleId
        );

        // For Critical Red emergencies, send an extra urgent alert notice
        if (priority === 'red') {
          const emergencyTag = config.tickets.supportRoleId
            ? `<@&${config.tickets.supportRoleId}> 🚨 **CRITICAL EMERGENCY ALERT**`
            : '🚨 **CRITICAL EMERGENCY ALERT**';
          
          await message.channel.send({ content: emergencyTag, ...handoffEmbed });
        } else {
          await message.channel.send(handoffEmbed);
        }

        // Update database state with priority
        db.updateTicket(message.channel.id, {
          status: 'needs_staff',
          priority: priority,
          lastSummary: aiResult.summary
        });

        // Update channel topic to reflect priority badge
        const priorityEmoji = priority === 'red' ? '🔴' : (priority === 'yellow' ? '🟡' : '🟢');
        const formattedNum = String(ticket.ticketNumber || 1).padStart(4, '0');
        message.channel.setTopic(
          `${priorityEmoji} [${priority.toUpperCase()}] Ticket #${formattedNum} | ${aiResult.summary.slice(0, 100)}`
        ).catch(() => {});
      }
    } catch (error) {
      console.error('Error in ticket message handler:', error);
    }
  }
};
