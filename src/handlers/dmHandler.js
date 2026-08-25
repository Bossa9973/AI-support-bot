const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const knowledgeManager = require('../ai/knowledgeManager');
const { answerSuggestionQuestion } = require('../ai/selfLearning');
const db = require('../database/db');
const { getClient, withRetry, createChatCompletion } = require('../ai/client');

/**
 * Formats recent Discord channel messages into an OpenAI-compatible messages array,
 * extracting full embed contents, field values, footers, buttons, and custom IDs so the AI
 * maintains rich context of everything shown in the chat.
 */
function extractConversationHistory(fetchedMessages, botUserId) {
  const history = [];

  for (const msg of fetchedMessages) {
    const isBot = msg.author.id === botUserId || msg.author.bot;
    const role = isBot ? 'assistant' : 'user';

    const parts = [];

    if (msg.content && msg.content.trim()) {
      parts.push(msg.content.trim());
    }

    if (msg.embeds && msg.embeds.length > 0) {
      for (const emb of msg.embeds) {
        const embLines = [];
        if (emb.title) embLines.push(`[EMBED TITLE]: ${emb.title}`);
        if (emb.description) embLines.push(`[EMBED DESCRIPTION]: ${emb.description}`);
        if (emb.fields && emb.fields.length > 0) {
          for (const f of emb.fields) {
            embLines.push(`[FIELD ${f.name}]: ${f.value}`);
          }
        }
        if (emb.footer && emb.footer.text) {
          embLines.push(`[FOOTER]: ${emb.footer.text}`);
        }
        if (embLines.length > 0) {
          parts.push(`--- EMBED CONTENT ---\n${embLines.join('\n')}\n---------------------`);
        }
      }
    }

    if (msg.components && msg.components.length > 0) {
      const buttonLabels = [];
      for (const row of msg.components) {
        if (row.components) {
          for (const comp of row.components) {
            if (comp.label) {
              buttonLabels.push(`[Button "${comp.label}" (customId: ${comp.customId})]`);
            }
          }
        }
      }
      if (buttonLabels.length > 0) {
        parts.push(`Available Action Buttons: ${buttonLabels.join(', ')}`);
      }
    }

    if (parts.length > 0) {
      const combined = parts.join('\n');
      const last = history[history.length - 1];
      if (last && last.role === role) {
        last.content += `\n\n${combined}`;
      } else {
        history.push({ role, content: combined });
      }
    }
  }

  return history;
}

/**
 * AI Tool Agent that translates the Boss's conversational requests into actions
 * with complete context awareness of knowledge catalog, gaps, drafts, and past embeds.
 */
async function processBossCommand(conversationHistory, userText, username) {
  const client = getClient();
  const currentLessons = knowledgeManager.getLessons();
  const currentArticles = knowledgeManager.listArticles();
  const currentOverrides = knowledgeManager.getOverrides();
  const pendingQuestions = db.listPendingQuestions();
  const pendingSuggestions = db.listPendingSuggestions();
  const pendingDrafts = db.listPendingDrafts();

  if (!client) {
    return {
      action: 'CHAT',
      bossMessage: `⚠️ ${config.ai.providerName} API Key is not configured yet in \`.env\`. I cannot process conversational AI commands.`
    };
  }

  // Build detailed articles catalog
  const articlesCatalog = Object.entries(currentArticles).map(([cat, list]) => {
    const items = list.map(a => `  • [${cat}/${a.slug}] "${a.title}"`).join('\n');
    return `📁 Category: ${cat} (${list.length} articles)\n${items}`;
  }).join('\n\n') || 'No articles found.';

  // Build pending gaps section
  let pendingGapsSection = 'No pending knowledge gaps.';
  if (pendingQuestions.length > 0) {
    pendingGapsSection = pendingQuestions.map(q =>
      `• [ID: ${q.id}] Topic: "${q.topic}" | Ticket: #${q.ticketNumber || 'Live'} | User Asked: "${q.userQuery || ''}" | Question: "${q.question}"`
    ).join('\n');
  }

  // Build pending drafts section
  let pendingDraftsSection = 'No active pending drafts.';
  if (pendingDrafts.length > 0) {
    pendingDraftsSection = pendingDrafts.map(d =>
      `• [ID: ${d.id}] Type: ${d.type} | Target: "${d.title || d.key || d.directive}" | Category/Slug: "${d.category || 'N/A'}/${d.slug || 'N/A'}" | Status: ${d.status}\n  Summary: ${d.changesSummary || 'Draft'}\n  Content Preview: ${(d.content || d.fact || d.directive || '').slice(0, 150)}...`
    ).join('\n');
  }

  // Build pending suggestions section
  let pendingSuggSection = 'No pending ticket suggestions.';
  if (pendingSuggestions.length > 0) {
    pendingSuggSection = pendingSuggestions.map(s =>
      `• [ID: ${s.id}] Type: ${s.type} | Target: "${s.title || s.key}" | Category: "${s.category || 'N/A'}"\n  Trigger: "${s.triggerQuery}"`
    ).join('\n');
  }

  const systemPrompt = `You are the chief executive AI assistant and knowledge curator for the Boss / Creator of the Vertex Nodes Discord AI Support Bot.
The Boss (@${username}) is sending you direct messages to teach you, resolve knowledge gaps, refine policies, review article drafts, and command overrides.

CURRENT KNOWLEDGE BASE STATE:
=========================================
1. ACTIVE DIRECTIVES & OVERRIDES (${currentOverrides.length}):
${JSON.stringify(currentOverrides, null, 2)}

2. ATOMIC LESSON FACTS (${Object.keys(currentLessons).length}):
${JSON.stringify(currentLessons, null, 2)}

3. CATEGORIZED ARTICLES CATALOG:
${articlesCatalog}

4. PENDING KNOWLEDGE GAP QUESTIONS FROM TICKETS (${pendingQuestions.length}):
${pendingGapsSection}

5. PENDING SELF-LEARNING SUGGESTIONS (${pendingSuggestions.length}):
${pendingSuggSection}

6. ACTIVE INTERACTIVE DRAFTS (${pendingDrafts.length}):
${pendingDraftsSection}
=========================================

CONTEXT & CONVERSATION RULES:
1. **Full Context Awareness**: You receive the full DM conversation history, including all embedded gap IDs (GAP-XXXX), suggestions (SUGG-XXXX), interactive draft IDs (DRAFT-XXXX), published articles, and overrides.
2. **Never Force the User to Type Slugs or IDs**: If the Boss says "update the crypto article", "make it an article in VPS plans", "for that gap the answer is 5 ports", or "change the RAM to 4GB", you MUST automatically recognize which article, gap, draft, or category they are referring to from context.
3. **Iterative Draft Refinement with Accept/Decline**:
   - Whenever the Boss gives new information, answers a gap, teaches a policy, asks to create/update an article or lesson, or provides refinements/corrections:
   - Output action **"PROPOSE_DRAFT"** with the complete, updated content/fact/directive and a clear "changesSummary".
   - The bot will drop this updated version as an interactive preview with [Accept & Save] and [Decline] buttons.
   - If the Boss gives further instructions on an existing draft, update that same draft (or create a refined version) referencing its draftId.
4. **Direct Confirmation & Save**:
   - If the Boss says "Accept", "Save it", "Looks good", "Commit", "Publish", or directly commands to save immediately without draft, output action **"SAVE_ARTICLE"**, **"SAVE_LESSON"**, or **"SET_OVERRIDE"**.
   - If a gapId was being answered, include "gapId" so the pending question is resolved.
   - If a draftId was approved, include "draftId".
5. **Clarity on Saved State**:
   - When asked if something is saved or in draft, explicitly confirm its exact filename, category, and live status.

ACTIONS YOU CAN RETURN:
1. **PROPOSE_DRAFT**: Drafts or updates an article, lesson, or override with Accept/Decline buttons.
   Fields:
   - "action": "PROPOSE_DRAFT"
   - "draftId": "DRAFT-XXXX" (optional, reuse if updating existing draft)
   - "type": "article" | "lesson" | "override"
   - "category": "category-slug" (e.g. "vps-management", "billing-and-subscriptions", "rewards-and-claims", etc.)
   - "title": "Article Title"
   - "slug": "article-slug"
   - "key": "Lesson Key" (for lesson)
   - "content": "Full markdown content" (for article)
   - "fact": "Full atomic fact" (for lesson)
   - "directive": "Override rule" (for override)
   - "gapId": "GAP-XXXX" (if resolving a gap)
   - "suggId": "SUGG-XXXX" (if updating a suggestion)
   - "changesSummary": "Concise summary of what was added/updated in this version"
   - "bossMessage": "Your direct, polite response to the Boss explaining what you prepared"

2. **SAVE_ARTICLE**: Immediately publishes/updates an article to the permanent knowledge base.
   Fields: "action", "category", "title", "slug", "content", "gapId", "draftId", "bossMessage"

3. **SAVE_LESSON**: Immediately saves an atomic fact.
   Fields: "action", "key", "fact", "gapId", "draftId", "bossMessage"

4. **SET_OVERRIDE**: Immediately activates a high-priority emergency rule/status.
   Fields: "action", "directive", "reason", "bossMessage"

5. **REMOVE_OVERRIDE**: Clears an active override.
   Fields: "action", "overrideId", "clearAll", "bossMessage"

6. **DECLINE_DRAFT**: Discards a draft when requested.
   Fields: "action", "draftId", "bossMessage"

7. **DELETE_LESSON**: Deletes a lesson.
   Fields: "action", "key", "bossMessage"

8. **DELETE_ARTICLE**: Deletes an article.
   Fields: "action", "category", "titleOrSlug", "bossMessage"

9. **SHOW_ARTICLE**: Displays the full contents of an existing article.
   Fields: "action", "category", "slug", "bossMessage"

10. **LIST_KNOWLEDGE**: Summarizes knowledge catalog, active drafts, gaps, and overrides.
    Fields: "action", "bossMessage"

11. **CHAT**: General conversation, answering questions about your training, or clarifying intent.
    Fields: "action", "bossMessage"

OUTPUT FORMAT:
Always place your final JSON object inside \`\`\`json ... \`\`\` at the end of your response.`;

  // Construct message array: system prompt + recent conversation history
  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory
  ];

  // If latest user message not already at the end of history, append it
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || !lastMsg.content.includes(userText.trim())) {
    messages.push({ role: 'user', content: userText });
  }

  try {
    const response = await createChatCompletion({
      model: config.ai.model,
      messages,
      temperature: 0.2,
      max_tokens: Math.min(config.ai.maxTokens ? config.ai.maxTokens * 2 : 1000, 1000)
    }, { context: 'OwnerDM' });

    const reply = response.choices?.[0]?.message?.content || '';

    // Strip thinking blocks or prologues if the model generates them
    let cleanReply = reply
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^Here's a thinking process:[\s\S]*?\n\n/gi, '')
      .trim();

    // Robust JSON extraction
    const jsonMatch = cleanReply.match(/```json([\s\S]*?)```/i) || cleanReply.match(/\{[\s\S]*?\}/s);
    if (jsonMatch) {
      const rawStr = (jsonMatch[1] || jsonMatch[0]).trim();
      try {
        const parsed = JSON.parse(rawStr);
        if (parsed.bossMessage) {
          parsed.bossMessage = parsed.bossMessage
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/^Here's a thinking process:[\s\S]*?\n\n/gi, '')
            .trim();
        }
        return parsed;
      } catch {
        // Fallback regex field extraction
        const action = (rawStr.match(/"action"\s*:\s*"([^"]+)"/i) || [])[1] || 'CHAT';
        const bmMatch = rawStr.match(/"bossMessage"\s*:\s*"([\s\S]*)"[^"]*\}?\s*$/i);
        let bossMessage = bmMatch
          ? bmMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\n+$/, '').trim()
          : cleanReply.replace(/```[\s\S]*?```/g, '').trim();

        bossMessage = bossMessage
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^Here's a thinking process:[\s\S]*?\n\n/gi, '')
          .trim();

        const title = (rawStr.match(/"title"\s*:\s*"([^"]+)"/i) || [])[1];
        const slug = (rawStr.match(/"slug"\s*:\s*"([^"]+)"/i) || [])[1];
        const category = (rawStr.match(/"category"\s*:\s*"([^"]+)"/i) || [])[1];
        const key = (rawStr.match(/"key"\s*:\s*"([^"]+)"/i) || [])[1];
        const draftId = (rawStr.match(/"draftId"\s*:\s*"([^"]+)"/i) || [])[1];
        const gapId = (rawStr.match(/"gapId"\s*:\s*"([^"]+)"/i) || [])[1];
        const changesSummary = (rawStr.match(/"changesSummary"\s*:\s*"([^"]+)"/i) || [])[1];
        const content = (rawStr.match(/"content"\s*:\s*"([\s\S]*)"\s*[,}]/i) || [])[1]
          ?.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
        const fact = (rawStr.match(/"fact"\s*:\s*"([\s\S]*)"\s*[,}]/i) || [])[1]
          ?.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
        const directive = (rawStr.match(/"directive"\s*:\s*"([\s\S]*)"\s*[,}]/i) || [])[1]
          ?.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();

        return {
          action,
          bossMessage,
          title,
          slug,
          category,
          key,
          draftId,
          gapId,
          changesSummary,
          content,
          fact,
          directive
        };
      }
    }

    return {
      action: 'CHAT',
      bossMessage: cleanReply.slice(0, 1900)
    };
  } catch (error) {
    console.error('Boss DM AI processing error:', error);
    const is429 = error?.status === 429 || error?.message?.includes('429');
    return {
      action: 'CHAT',
      bossMessage: is429
        ? "Hit a rate limit on the AI provider — try again in a few seconds."
        : `Encountered an error: ${error.message}`
    };
  }
}

module.exports = {
  /**
   * Handles Direct Messages from the Owner with advanced context & interactive draft controls.
   * @param {import('discord.js').Message} message 
   */
  async handleDM(message) {
    // 0. Ignore bots
    if (message.author.bot) return;

    // 1. Validate Owner ID
    const isOwner =
      Boolean(config.ownerId && config.ownerId === message.author.id) ||
      (Array.isArray(config.ownerIds) && config.ownerIds.includes(message.author.id));

    if (!isOwner) return;

    try {
      message?.channel?.sendTyping?.().catch(() => {});
    } catch (_) {}

    const content = message.content.trim();

    // 2. Direct Shortcuts / Fast Commands
    // 2a. List pending drafts
    if (content.toLowerCase() === '!drafts' || content.toLowerCase() === 'drafts') {
      const pendingDrafts = db.listPendingDrafts();
      if (pendingDrafts.length === 0) {
        return message.reply('No active pending drafts right now, Boss!');
      }
      const lines = pendingDrafts.map(d => {
        return `**\`${d.id}\`** — **${(d.type || 'draft').toUpperCase()}**: ${d.title || d.key || d.directive}\n> *${d.changesSummary || 'Draft waiting for review'}*`;
      });
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📝 Pending Draft Proposals (${pendingDrafts.length})`)
        .setDescription(lines.join('\n\n').slice(0, 4000))
        .setFooter({ text: 'Reply with your changes to refine a draft, or click Accept on the draft embed.' });
      return message.reply({ embeds: [embed] });
    }

    // 2b. List pending suggestions
    if (content.toLowerCase() === '!suggestions' || content.toLowerCase() === 'suggestions') {
      const pending = db.listPendingSuggestions();
      if (pending.length === 0) {
        return message.reply('No pending self-learning suggestions right now.');
      }
      const lines = pending.map(s => {
        const label = s.type === 'lesson' ? `💡 Lesson: \`${s.key}\`` : `📖 Article: **${s.title}** (${s.category})`;
        return `**\`${s.id}\`** — ${label}\n> ${s.triggerQuery.slice(0, 80)}...`;
      });
      const embed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle(`🧠 Pending Self-Learning Suggestions (${pending.length})`)
        .setDescription(lines.join('\n\n').slice(0, 4000))
        .setFooter({ text: 'Reply with "SUGG-XXXX <your question>" or give instructions in natural language.' });
      return message.reply({ embeds: [embed] });
    }

    // 2c. List pending knowledge questions
    if (content.toLowerCase() === '!gaps' || content.toLowerCase() === 'gaps' || content.toLowerCase() === '!questions') {
      const pendingQuestions = db.listPendingQuestions();
      if (pendingQuestions.length === 0) {
        return message.reply('No pending knowledge gap questions from tickets right now!');
      }
      const lines = pendingQuestions.map(q => {
        const ticketNumStr = q.ticketNumber ? `#${String(q.ticketNumber).padStart(4, '0')}` : 'Live';
        return `**\`${q.id}\`** — **${q.topic}** (Ticket ${ticketNumStr})\n> **Q:** ${q.question}\n> **User:** *${(q.userQuery || '').slice(0, 60)}...*`;
      });
      const embed = new EmbedBuilder()
        .setColor('#9B59B6')
        .setTitle(`❓ Knowledge Questions Awaiting Your Clarification (${pendingQuestions.length})`)
        .setDescription(lines.join('\n\n').slice(0, 4000))
        .setFooter({ text: 'Reply directly in natural language to answer and drop a draft!' });
      return message.reply({ embeds: [embed] });
    }

    // 2d. Direct answer to a knowledge question shortcut: "GAP-XXXX The answer is..."
    const gapMatch = content.match(/^(GAP-[A-Z0-9]{4})\s+(.+)/i);
    if (gapMatch) {
      const gapId = gapMatch[1].toUpperCase();
      const answerText = gapMatch[2].trim();
      const pendingQuestions = db.listPendingQuestions();
      const questionData = pendingQuestions.find(q => q.id === gapId);

      const key = questionData ? questionData.topic : `Topic ${gapId}`;
      const saved = knowledgeManager.saveLesson(key, answerText);
      db.resolvePendingQuestion(gapId, { key: saved.key, fact: saved.fact });

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle(`💡 Learned from Gap Clarification [${gapId}]`)
        .setDescription(`I have saved your answer to my atomic knowledge library and resolved question \`${gapId}\`.`)
        .addFields([
          { name: '🔑 Topic / Key', value: saved.key, inline: true },
          { name: '📝 Learned Fact', value: saved.fact, inline: false }
        ]);

      return message.reply({ content: `Understood, Boss! I've updated my knowledge base with your answer.`, embeds: [embed] });
    }

    // 2e. Owner asking a question about a specific suggestion shortcut: "SUGG-XXXX what sources did you use?"
    const suggMatch = content.match(/^(SUGG-[A-Z0-9]{4})\s+(.+)/i);
    if (suggMatch) {
      const suggId = suggMatch[1].toUpperCase();
      const question = suggMatch[2].trim();
      const suggestion = db.getSuggestion(suggId);
      if (!suggestion) {
        return message.reply(`⚠️ Couldn't find suggestion \`${suggId}\`. Use \`!suggestions\` to see pending ones.`);
      }
      try {
        message?.channel?.sendTyping?.().catch(() => {});
      } catch (_) {}
      const answer = await answerSuggestionQuestion(suggestion, question);
      const embed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle(`🧠 \`${suggId}\` — Your Question`)
        .setDescription(`**Q:** ${question}\n\n**A:** ${answer}`);
      return message.reply({ embeds: [embed] });
    }

    if (content.toLowerCase() === '!help' || content.toLowerCase() === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('👑 Boss Executive Control Center')
        .setDescription('You can manage my entire knowledge base, review drafts, set live overrides, and train me in natural language right here in DMs!')
        .addFields([
          {
            name: '📝 Interactive Drafts & Iterative Feedback',
            value: '• Whenever you teach me or answer a gap, I will drop an **interactive draft preview** with `[Accept & Save]` and `[Decline]` buttons.\n• Give more instructions anytime (e.g. *"also add X"*, *"change category to billing"*), and I will update the draft live!'
          },
          {
            name: '❓ Knowledge Gaps & Questions',
            value: '• When I lack documentation in a ticket, I DM you here.\n• *"!gaps"* — List unanswered questions\n• Answer naturally: *"For that NAT question, free gets 5 ports, paid gets 20"*\n• I will automatically drop the prepared draft for your approval.'
          },
          {
            name: '🚨 Live Overrides (Emergency Hotfixes)',
            value: '• *"Feature A is down, tell users to use console"*\n• *"Dallas node is under maintenance"*\n• *"Clear override 1"* or *"Clear all overrides"*'
          },
          {
            name: '📚 Fast Shortcuts',
            value: '• `!drafts` — View pending drafts\n• `!gaps` — View pending ticket questions\n• `!suggestions` — View self-learning suggestions\n• `!knowledge` or *"list articles"* — View entire knowledge catalog'
          }
        ])
        .setFooter({ text: 'Vertex AI Support Assistant • Full Natural Language Memory' });

      return message.reply({ embeds: [helpEmbed] });
    }

    // 3. Fetch Recent DM Channel History (up to 15 messages) for rich context
    let history = [];
    try {
      const fetched = await message.channel.messages.fetch({ limit: 15 });
      const sorted = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      // Exclude the current message since it's passed explicitly as userText
      const prior = sorted.filter(m => m.id !== message.id);
      history = extractConversationHistory(prior, message.client?.user?.id);
    } catch (fetchErr) {
      console.warn('[dmHandler] Could not fetch DM channel history:', fetchErr.message);
    }

    // 4. Process Natural Language Command with AI
    const result = await processBossCommand(history, content, message.author.username);

    // 5. Execute Action
    // 5a. PROPOSE_DRAFT (Interactive Preview with Accept / Decline Buttons)
    if (result.action === 'PROPOSE_DRAFT') {
      const draft = db.saveDraft({
        id: result.draftId,
        type: result.type || 'article',
        category: result.category || 'general',
        title: result.title || result.key || 'Knowledge Update',
        slug: result.slug,
        key: result.key,
        content: result.content,
        fact: result.fact,
        directive: result.directive,
        gapId: result.gapId,
        suggId: result.suggId,
        changesSummary: result.changesSummary || 'Draft prepared based on your instructions'
      });

      const isArticle = draft.type === 'article';
      const isLesson = draft.type === 'lesson';
      const isOverride = draft.type === 'override';

      const embed = new EmbedBuilder()
        .setColor(isArticle ? '#5865F2' : isLesson ? '#57F287' : '#ED4245')
        .setTitle(`📝 Draft Proposal [${draft.id}] — ${draft.title || draft.key || 'Directive'}`)
        .setDescription(
          `Here is the updated version based on your instructions. Click **Accept & Save** to publish it live, or give more instructions to refine it.`
        )
        .addFields([
          { name: '📌 Type', value: `\`${draft.type.toUpperCase()}\``, inline: true },
          { name: '🏷️ Draft ID', value: `\`${draft.id}\``, inline: true },
          { name: '🔄 Changes / Focus', value: `> ${draft.changesSummary}`, inline: false }
        ]);

      if (isArticle) {
        embed.addFields([
          { name: '📂 Category', value: `\`${draft.category}\``, inline: true },
          { name: '📄 Target File', value: `\`${draft.category}/${draft.slug || 'article'}.md\``, inline: true },
          {
            name: '📑 Article Content Preview',
            value: '```markdown\n' + (draft.content || '').slice(0, 1000) + ((draft.content || '').length > 1000 ? '\n...(preview truncated)' : '') + '\n```',
            inline: false
          }
        ]);
      } else if (isLesson) {
        embed.addFields([
          { name: '🔑 Topic / Key', value: `\`${draft.key}\``, inline: true },
          { name: '📝 Learned Fact', value: draft.fact || '', inline: false }
        ]);
      } else if (isOverride) {
        embed.addFields([
          { name: '🚨 Directive', value: draft.directive || '', inline: false }
        ]);
      }

      if (draft.gapId) {
        embed.addFields([{ name: '❓ Resolves Knowledge Gap', value: `\`${draft.gapId}\``, inline: true }]);
      }

      const acceptBtn = new ButtonBuilder()
        .setCustomId(`dm_accept_draft_${draft.id}`)
        .setLabel('✅ Accept & Save')
        .setStyle(ButtonStyle.Success);

      const declineBtn = new ButtonBuilder()
        .setCustomId(`dm_decline_draft_${draft.id}`)
        .setLabel('❌ Decline')
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(acceptBtn, declineBtn);

      return message.reply({
        content: result.bossMessage || `I've updated the draft below. Click **Accept & Save** to publish it.`,
        embeds: [embed],
        components: [row]
      });
    }

    // 5b. SAVE_ARTICLE (Immediate Publication)
    if (result.action === 'SAVE_ARTICLE') {
      const saved = knowledgeManager.saveArticle(result.category, result.title, result.content, result.slug);
      if (result.gapId) {
        db.resolvePendingQuestion(result.gapId, { article: saved });
      }
      if (result.draftId) {
        db.approveDraft(result.draftId);
      }
      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle(`📖 Article Published: ${saved.title}`)
        .setDescription(`Successfully saved to knowledge base and activated for all ticket responses.`)
        .addFields([
          { name: '📂 Category', value: `\`${saved.category}\``, inline: true },
          { name: '📄 File Path', value: `\`${saved.category}/${saved.slug}.md\``, inline: true },
          { name: '📑 Content Preview', value: '```markdown\n' + (result.content || '').slice(0, 400) + '...\n```', inline: false }
        ]);

      if (result.gapId) {
        embed.setFooter({ text: `Resolved Knowledge Gap ${result.gapId}` });
      }

      return message.reply({ content: result.bossMessage || 'Article saved and live in knowledge base, Boss!', embeds: [embed] });
    }

    // 5c. SAVE_LESSON (Immediate Fact Save)
    if (result.action === 'SAVE_LESSON') {
      const saved = knowledgeManager.saveLesson(result.key, result.fact);
      if (result.gapId) {
        db.resolvePendingQuestion(result.gapId, { key: saved.key, fact: saved.fact });
      }
      if (result.draftId) {
        db.approveDraft(result.draftId);
      }
      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('💡 New Lesson Learned')
        .setDescription(`Saved atomic fact to memory. This is now active in AI context.`)
        .addFields([
          { name: '🔑 Topic / Key', value: saved.key, inline: true },
          { name: '📝 Atomic Fact', value: saved.fact, inline: false }
        ]);

      if (result.gapId) {
        embed.setFooter({ text: `Resolved Knowledge Gap ${result.gapId}` });
      }

      return message.reply({ content: result.bossMessage || 'Lesson saved to memory, Boss!', embeds: [embed] });
    }

    // 5d. SET_OVERRIDE (Emergency Override Directive)
    if (result.action === 'SET_OVERRIDE') {
      const newOverride = knowledgeManager.addOverride(result.directive, result.reason || 'Set via Owner DM');
      const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🚨 Active Boss Directive Enacted')
        .setDescription(`**Directive**: ${newOverride.directive}`)
        .addFields([
          { name: '🆔 Override ID', value: `\`${newOverride.id}\``, inline: true },
          { name: '⚡ Priority', value: 'Highest (Active across all tickets)', inline: true }
        ])
        .setFooter({ text: 'Use "Clear override" when this is no longer applicable' });

      return message.reply({ content: result.bossMessage || 'Directive active!', embeds: [embed] });
    }

    // 5e. REMOVE_OVERRIDE
    if (result.action === 'REMOVE_OVERRIDE') {
      if (result.clearAll) {
        knowledgeManager.clearAllOverrides();
        return message.reply({ content: '✅ All active overrides have been cleared, Boss!' });
      }
      const removed = knowledgeManager.removeOverride(result.overrideId || result.id || '1');
      if (removed) {
        return message.reply({ content: `✅ Override successfully cleared. I have resumed standard protocol, Boss!` });
      } else {
        return message.reply({ content: `⚠️ Could not find that override ID. Current overrides:\n\`\`\`json\n${JSON.stringify(knowledgeManager.getOverrides(), null, 2)}\n\`\`\`` });
      }
    }

    // 5f. DECLINE_DRAFT
    if (result.action === 'DECLINE_DRAFT') {
      const targetId = result.draftId || (db.getLatestPendingDraft() || {}).id;
      if (targetId) {
        db.rejectDraft(targetId);
      }
      return message.reply({ content: result.bossMessage || `Draft \`${targetId || 'active'}\` has been discarded.` });
    }

    // 5g. DELETE_LESSON
    if (result.action === 'DELETE_LESSON') {
      const deleted = knowledgeManager.deleteLesson(result.key);
      if (deleted) {
        return message.reply({ content: `✅ Lesson \`${result.key}\` has been removed from my memory.` });
      } else {
        return message.reply({ content: `⚠️ Could not find lesson with key \`${result.key}\`.` });
      }
    }

    // 5h. DELETE_ARTICLE
    if (result.action === 'DELETE_ARTICLE') {
      const deleted = knowledgeManager.deleteArticle(result.category, result.titleOrSlug || result.slug);
      if (deleted) {
        return message.reply({ content: `✅ Article removed from category \`${result.category}\`.` });
      } else {
        return message.reply({ content: `⚠️ Could not find article in category \`${result.category}\`.` });
      }
    }

    // 5i. SHOW_ARTICLE
    if (result.action === 'SHOW_ARTICLE') {
      const article = knowledgeManager.findArticle(result.slug || result.title || result.category);
      if (article) {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`📖 ${article.title} (\`${article.category}/${article.slug}.md\`)`)
          .setDescription('```markdown\n' + article.content.slice(0, 3900) + '\n```');
        return message.reply({ content: result.bossMessage || `Here is the requested article:`, embeds: [embed] });
      }
      return message.reply({ content: `⚠️ Could not find article matching "${result.slug || result.title}".` });
    }

    // 5j. LIST_KNOWLEDGE
    if (result.action === 'LIST_KNOWLEDGE') {
      const overrides = knowledgeManager.getOverrides();
      const lessons = knowledgeManager.getLessons();
      const articles = knowledgeManager.listArticles();
      const pendingDrafts = db.listPendingDrafts();
      const pendingGaps = db.listPendingQuestions();

      const catKeys = Object.keys(articles);
      const totalArticles = catKeys.reduce((sum, c) => sum + articles[c].length, 0);

      const overridesStr = overrides.length > 0
        ? overrides.map((o, idx) => `**${idx + 1}.** ${o.directive}`).join('\n').slice(0, 1000)
        : '*None active*';

      const lessonsStr = Object.keys(lessons).length > 0
        ? Object.keys(lessons).slice(0, 6).map((k) => `• **${k}**: ${lessons[k].fact.slice(0, 50)}...`).join('\n').slice(0, 1000)
        : '*None loaded*';

      let articlesStr = '*None loaded*';
      if (catKeys.length > 0) {
        const lines = catKeys.map((cat) => `📁 **${cat}** (${articles[cat].length} articles)`);
        articlesStr = lines.join('\n');
        if (articlesStr.length > 1000) {
          articlesStr = articlesStr.slice(0, 980) + '\n*...and more*';
        }
      }

      const draftsStr = pendingDrafts.length > 0
        ? pendingDrafts.map(d => `• **\`${d.id}\`**: ${d.title || d.key} (*${d.type}*)`).join('\n')
        : '*No pending drafts*';

      const gapsStr = pendingGaps.length > 0
        ? pendingGaps.map(g => `• **\`${g.id}\`**: ${g.topic}`).join('\n')
        : '*No pending gap questions*';

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📚 Current Knowledge Base Catalog')
        .setDescription(`Total Categories: **${catKeys.length}** | Total Articles: **${totalArticles}** | Lessons: **${Object.keys(lessons).length}**`)
        .addFields([
          { name: `🚨 Active Overrides (${overrides.length})`, value: overridesStr, inline: false },
          { name: `📝 Pending Draft Proposals (${pendingDrafts.length})`, value: draftsStr, inline: true },
          { name: `❓ Unresolved Ticket Gaps (${pendingGaps.length})`, value: gapsStr, inline: true },
          { name: `💡 Fast Lessons (${Object.keys(lessons).length})`, value: lessonsStr, inline: false },
          { name: `📖 Categories & Articles`, value: articlesStr, inline: false }
        ]);

      return message.reply({ embeds: [embed] });
    }

    // Default chat reply
    return message.reply({ content: result.bossMessage || 'Yes, Boss! I am updated and ready.' });
  }
};
