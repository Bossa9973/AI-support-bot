const {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const db = require('../database/db');
const config = require('../config');
const { generateSupportResponseStream } = require('../ai/openrouter');
const { checkAndLearn, sendKnowledgeQuestionToOwner } = require('../ai/selfLearning');
const embedBuilder = require('../utils/embedBuilder');
const ticketManager = require('../utils/ticketManager');
const aiQueue = require('../utils/aiQueue');
const resolutionManager = require('../utils/resolutionManager');
const { isStaffMember } = require('../utils/staffChecker');

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
 * Robust check for user or staff close intent.
 */
function isCloseIntent(text) {
  if (!text) return false;
  const clean = text.trim().toLowerCase().replace(/[.!?]/g, '');

  const exactPhrases = [
    'close', 'close ticket', 'close this ticket', 'close the ticket',
    'close it', 'close please', 'please close', 'please close ticket',
    'please close the ticket', 'please close this ticket', 'close it please',
    'close now', 'close ticket now', 'you can close', 'you can close it',
    'you can close the ticket', 'you can close this ticket', 'you can close now',
    'feel free to close', 'feel free to close the ticket', 'feel free to close it',
    'go ahead and close', 'go ahead and close the ticket', 'go ahead and close it',
    'can you close', 'can you close the ticket', 'can you close it',
    'i want to close the ticket', 'i want to close', 'i want to close it',
    'done close', 'done close it', 'resolved close', 'resolved close it',
    'fixed close', 'fixed close it', 'all good close it', 'all good close ticket',
    'all good close', 'no more questions close', 'no further questions close',
    'lock ticket', 'lock channel', 'archive ticket'
  ];
  if (exactPhrases.includes(clean)) return true;

  // Regex patterns (e.g. "please close the ticket now", "you can close this", "close ticket thanks")
  const closeRegex = /^(?:please\s+)?(?:you\s+can\s+|feel\s+free\s+to\s+|go\s+ahead\s+and\s+|can\s+you\s+)?(?:close|resolve|archive|shut\s+down)(?:\s+(?:the|this|my|it))?(?:\s+ticket)?(?:\s+(?:now|please|pls|thanks|thank\s+you))?$/i;
  return closeRegex.test(clean);
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

    const isTicketCreator = ticket.userId === message.author.id;
    const isStaff = isStaffMember(message.member, message.guild, message.author);

    // 3. Handle Staff Members speaking in tickets
    if (isStaff && !isTicketCreator) {
      // If staff member gives close command:
      if (isCloseIntent(message.content)) {
        resolutionManager.clearTimers(message.channel.id);
        await message.channel.send('🔒 Staff initiated ticket closure. Archiving channel...');
        await ticketManager.closeTicket(message.channel, message.author, 'Closed by staff request');
        return;
      }

      // Automatic handover: when staff speaks in a ticket, pause AI and assign staff control
      db.updateTicket(message.channel.id, {
        staffActive: true,
        continueWithAi: false,
        claimedBy: ticket.claimedBy || message.author.id,
        claimedAt: ticket.claimedAt || new Date().toISOString()
      });
      return;
    }

    // Clear any pending inactivity auto-close timer since the user is actively messaging
    resolutionManager.clearTimers(message.channel.id);

    // 4. Check if User/Customer sent an explicit close request
    const trimmedQuery = (message.content || '').trim().toLowerCase().replace(/[.!?]/g, '');
    if (isCloseIntent(trimmedQuery)) {
      resolutionManager.clearTimers(message.channel.id);
      await message.channel.send('🔒 Closing ticket now. Thank you for contacting support!');
      await ticketManager.closeTicket(message.channel, message.author, 'Closed by user request');
      return;
    }

    // 5. If ticket is currently being handled by human staff (claimed or staff active with AI paused),
    // do NOT generate automated AI responses — let the user and staff talk directly!
    if (ticket.continueWithAi === false || ticket.staffActive || ticket.claimedBy) {
      return;
    }

    let typingInterval = null;
    try {
      // 5. Fire typing indicator AND history fetch simultaneously — before entering the queue
      try {
        message?.channel?.sendTyping?.().catch(() => {});
      } catch (_) {}

      typingInterval = setInterval(() => {
        try {
          if (message?.channel && typeof message.channel.sendTyping === 'function') {
            message.channel.sendTyping().catch(() => {});
          } else if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
          }
        } catch (_) {
          if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
          }
        }
      }, 8000);

      // Pre-fetch history immediately (runs in parallel while waiting for queue slot)
      const historyPromise = message.channel && message.channel.messages
        ? message.channel.messages.fetch({ limit: 35 }).then((fetchedMessages) => {
            const history = [];
            const sorted = Array.from(fetchedMessages.values()).sort(
              (a, b) => a.createdTimestamp - b.createdTimestamp
            );
            for (const msg of sorted) {
              if (msg.id === message.id) continue;
              const isBot = msg.author.id === message.client.user.id;

              let text = msg.content || '';
              if (msg.embeds && msg.embeds.length > 0) {
                const embLines = [];
                for (const emb of msg.embeds) {
                  if (emb.title) embLines.push(`[Embed Title: ${emb.title}]`);
                  if (emb.description) embLines.push(`[Embed Description: ${emb.description}]`);
                  if (emb.fields && emb.fields.length > 0) {
                    for (const f of emb.fields) embLines.push(`[${f.name}: ${f.value}]`);
                  }
                }
                if (embLines.length > 0) {
                  text += (text ? '\n' : '') + embLines.join('\n');
                }
              }
              if (!text.trim()) continue;

              if (isBot) {
                // NEVER prefix bot's own assistant message with bot name
                history.push({ role: 'assistant', content: text.trim() });
              } else {
                const msgAuthorStaff = isStaffMember(msg.member);
                const prefix = msgAuthorStaff ? `[Staff @${msg.author.username}]` : `@${msg.author.username}`;
                history.push({ role: 'user', content: `${prefix}: ${text.trim()}` });
              }
            }
            return history;
          }).catch(() => [])
        : Promise.resolve([]);

      // 6. Enqueue AI work for this channel (serial per-channel, parallel across channels)
      await aiQueue.run(message.channel.id, async () => {
        // 6a. Await pre-fetched history (likely already done by now)
        const history = await historyPromise;

        // 6b. Parse attachments from the current message
        const imageUrls = [];
        let inlineText = '';
        for (const [, attachment] of message.attachments) {
          const ct = (attachment.contentType || '').toLowerCase();
          const name = (attachment.name || '').toLowerCase();
          if (ct.startsWith('image/')) {
            imageUrls.push(attachment.url);
          } else if (
            ct.startsWith('text/') ||
            name.endsWith('.txt') || name.endsWith('.log') ||
            name.endsWith('.json') || name.endsWith('.yaml') ||
            name.endsWith('.yml') || name.endsWith('.conf') ||
            name.endsWith('.sh') || name.endsWith('.py') ||
            name.endsWith('.js') || name.endsWith('.md')
          ) {
            try {
              const res = await fetch(attachment.url);
              const text = await res.text();
              const trimmed = text.slice(0, 4000);
              inlineText += `\n\n[Attached file: ${attachment.name}]\n\`\`\`\n${trimmed}${text.length > 4000 ? '\n... (truncated)' : ''}\n\`\`\``;
            } catch (fetchErr) {
              console.error('Failed to fetch text attachment:', fetchErr.message);
            }
          }
        }

        const fullUserQuery = (message.content || '') + inlineText;

        // 6c. Build ticket state
        const ticketCategory = ticket.category || 'general_support';
        const ticketCategoryData = embedBuilder.getCategoryData(ticketCategory);

        const ticketState = {
          escalated: ticket.status === 'needs_staff' && ticket.continueWithAi === true,
          priority: ticket.priority || 'green',
          lastSummary: ticket.lastSummary || '',
          category: ticketCategory,
          categoryLabel: ticketCategoryData.label,
          categoryDescription: ticketCategoryData.description
        };

        // Check if last bot message asked about closing and user affirmed with yea/yes/sure/thanks
        const lastBotMsg = [...history].reverse().find(m => m.role === 'assistant');
        const botAskedToClose = lastBotMsg && (
          lastBotMsg.content.toLowerCase().includes('close') ||
          lastBotMsg.content.toLowerCase().includes('solve your issue') ||
          lastBotMsg.content.toLowerCase().includes('anything else') ||
          lastBotMsg.content.toLowerCase().includes('is that okay')
        );
        const isAffirmativeClose = botAskedToClose && (
          trimmedQuery === 'yea' ||
          trimmedQuery === 'yeah' ||
          trimmedQuery === 'yes' ||
          trimmedQuery === 'yep' ||
          trimmedQuery === 'sure' ||
          trimmedQuery === 'ok' ||
          trimmedQuery === 'okay' ||
          trimmedQuery === 'all good' ||
          trimmedQuery === 'thanks' ||
          trimmedQuery === 'thank you' ||
          trimmedQuery === 'that worked' ||
          trimmedQuery === 'it worked' ||
          trimmedQuery === 'fixed' ||
          trimmedQuery === 'no thanks' ||
          trimmedQuery === 'nope' ||
          trimmedQuery === 'no'
        );

        if (isAffirmativeClose) {
          if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
          }
          resolutionManager.clearTimers(message.channel.id);
          await message.channel.send('Closing this ticket now. Let us know if you need anything else later!');
          await ticketManager.closeTicket(message.channel, message.author, 'Closed by user confirmation');
          return;
        }

        // 6d. Generate AI response
        let streamBuffer = '';
        let aiResult;
        try {
          aiResult = await generateSupportResponseStream(
            history,
            fullUserQuery,
            message.author.username,
            ticketState,
            imageUrls,
            (token) => { streamBuffer += token; }
          );
        } finally {
          if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
          }
        }

        // 6e. Send the complete reply if not empty
        if (aiResult.reply && aiResult.reply.trim()) {
          const finalChunks = splitMessage(aiResult.reply);
          for (const chunk of finalChunks) {
            if (chunk && chunk.trim()) {
              await message.channel.send({
                content: chunk,
                allowedMentions: { repliedUser: false }
              }).catch(console.error);
            }
          }
        } else if (aiResult.closeTicket) {
          await message.channel.send({
            content: 'Closing this ticket now. Let us know if you need anything else later!'
          }).catch(console.error);
        }

        // 6f. If the AI determined the ticket issue is fully resolved and user confirmed closing
        if (aiResult.closeTicket) {
          resolutionManager.clearTimers(message.channel.id);
          const reason = aiResult.closeReason || 'Issue resolved by AI support';
          await ticketManager.closeTicket(message.channel, message.client.user, reason);
          return;
        }

        // 6g. If the AI solved the question and wants to prompt user for resolution / start 5m timer
        if (aiResult.resolvePrompt && !ticketState.escalated && !aiResult.handoff) {
          await resolutionManager.startResolutionFlow(message.channel, ticket.userId || message.author.id);
        }

        // 6h. If AI detected a knowledge gap, proactively ask the Owner via DM for clarification
        if (aiResult.knowledgeGap && !ticketState.escalated) {
          sendKnowledgeQuestionToOwner(message.client, {
            ticketNumber: ticket.ticketNumber,
            channelId: message.channel.id,
            guildId: message.guild.id,
            topic: aiResult.knowledgeGap.topic,
            question: aiResult.knowledgeGap.question,
            userQuery: fullUserQuery
          }).catch((err) => console.error('[MessageHandler] sendKnowledgeQuestionToOwner error:', err.message));
        }

        // 6i. Fire general self-learning in the background (non-blocking)
        if (!ticketState.escalated) {
          checkAndLearn(message.client, fullUserQuery, aiResult.reply, history).catch(() => {});
        }

        // 6j. Staff handoff only when strictly necessary (verified emergency, explicit user request, admin backend task)
        if (aiResult.handoff) {
          const priority = aiResult.priority || 'green';
          const slug = aiResult.slug || 'support-issue';
          await ticketManager.updateTicketNameAndPriority(message.channel, priority, slug);
          const handoffEmbed = embedBuilder.createStaffHandoffEmbed(
            aiResult.summary,
            priority,
            config.tickets.supportRoleId
          );

          const roleTag = config.tickets.supportRoleId ? `<@&${config.tickets.supportRoleId}>` : '**Staff Team**';
          const staffAlertText = priority === 'red'
            ? `${roleTag} 🚨 **CRITICAL EMERGENCY ALERT**\n\n${aiResult.summary}`
            : `${roleTag} Hey! This needs you 👋\n\n${aiResult.summary}`;

          await message.channel.send({ content: staffAlertText, ...handoffEmbed });

          db.updateTicket(message.channel.id, {
            status: 'needs_staff',
            priority: priority,
            slug: slug,
            lastSummary: aiResult.summary
          });

          const priorityEmoji = priority === 'red' ? '🔴' : (priority === 'yellow' ? '🟡' : '🟢');
          const formattedNum = String(ticket.ticketNumber || 1).padStart(4, '0');
          message.channel.setTopic(
            `${priorityEmoji} [${priority.toUpperCase()}] Ticket #${formattedNum} | ${aiResult.summary.slice(0, 100)}`
          ).catch(() => {});
        }

        // 6k. Re-ping staff if holding mode AI detected an update
        if (aiResult.repingStaff) {
          const repingPriority = aiResult.priority || ticket.priority || 'green';
          const repingEmbed = embedBuilder.createStaffHandoffEmbed(
            `🔄 **Update from user:** ${aiResult.summary}`,
            repingPriority,
            config.tickets.supportRoleId
          );

          const roleTag = config.tickets.supportRoleId ? `<@&${config.tickets.supportRoleId}>` : '**Staff Team**';
          const repingAlertText = repingPriority === 'red'
            ? `${roleTag} 🚨 **SITUATION UPDATE — CRITICAL**\n\n${aiResult.summary}`
            : `${roleTag} 🔄 **Ticket Update:**\n\n${aiResult.summary}`;

          await message.channel.send({ content: repingAlertText, ...repingEmbed });

          if (repingPriority !== ticket.priority) {
            db.updateTicket(message.channel.id, { priority: repingPriority });
            await ticketManager.updateTicketNameAndPriority(
              message.channel,
              repingPriority,
              ticket.slug || 'support-issue'
            );
          }
        }
      }); // end aiQueue.run()

    } catch (error) {
      console.error('Error in ticket message handler:', error);
    } finally {
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }
    }
  }
};
