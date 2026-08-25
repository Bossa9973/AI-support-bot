const { EmbedBuilder } = require('discord.js');
const config = require('../config');
const knowledgeManager = require('../ai/knowledgeManager');
const { answerSuggestionQuestion } = require('../ai/selfLearning');
const db = require('../database/db');
const { getClient, withRetry } = require('../ai/client');

/**
 * AI Tool Agent that translates the Boss's conversational requests into actions.
 */
async function processBossCommand(userText, username) {
  const client = getClient();
  const currentLessons = knowledgeManager.getLessons();
  const currentArticles = knowledgeManager.listArticles();
  const currentOverrides = knowledgeManager.getOverrides();
  const pendingQuestions = db.listPendingQuestions();

  // If no AI client configured, fallback to basic intent/text response
  if (!client) {
    return {
      action: 'chat',
      reply: `⚠️ ${config.ai.providerName} API Key is not configured yet in \`.env\`. I cannot process conversational AI commands.`
    };
  }

  let pendingSection = '';
  if (pendingQuestions.length > 0) {
    pendingSection = `\nPENDING KNOWLEDGE GAP QUESTIONS AWAITING CLARIFICATION FROM BOSS:\n` +
      pendingQuestions.map(q => `• [ID: ${q.id}] (Topic: ${q.topic}) Question: "${q.question}" | User asked: "${q.userQuery || ''}"`).join('\n') +
      `\nIf the Boss is answering any of these questions, set "action": "SAVE_LESSON" or "SAVE_ARTICLE", and include "gapId": "<ID>" in the JSON.`;
  }

  const systemPrompt = `You are the executive personal assistant for the Boss / Creator of the Discord AI Support Bot.
The Boss (@${username}) is sending you direct messages to teach you, answer knowledge gaps, manage your knowledge base, adjust settings, and set real-time overrides.

CURRENT KNOWLEDGE STATE:
- Active Overrides (${currentOverrides.length}): ${JSON.stringify(currentOverrides)}
- Lessons (${Object.keys(currentLessons).length}): ${JSON.stringify(currentLessons)}
- Articles: ${JSON.stringify(Object.keys(currentArticles))}${pendingSection}

YOU CAN PERFORM THE FOLLOWING ACTIONS:
1. **SET_OVERRIDE**: When the boss tells you a temporary rule, live hotfix, or current status (e.g. "Feature A is down, tell users X", "Dallas node is undergoing maintenance", "Don't accept crypto payments today").
2. **REMOVE_OVERRIDE**: When the boss tells you an override is no longer applicable or asks to clear an override.
3. **SAVE_LESSON**: When the boss gives you a short atomic fact or answers a question (e.g. "We offer Plan 1 ($5), Plan 2 ($10)", "Node 1 is in Dallas", "Support hours are 9-5", or answers an uncovered question).
4. **DELETE_LESSON**: When the boss asks to remove a lesson or fact.
5. **SAVE_ARTICLE**: When the boss wants to create/update an in-depth article with a category, title, and detailed content.
6. **DELETE_ARTICLE**: When the boss asks to delete an article.
7. **LIST_KNOWLEDGE**: When the boss asks to see what you know, list articles, list lessons, or list overrides.
8. **CHAT**: General conversation, questions about how you would respond to users, or acknowledging the boss.

OUTPUT FORMAT INSTRUCTIONS:
Always respond with a JSON object at the very end enclosed in \`\`\`json ... \`\`\` with the exact action parameters, plus a polite, respectful message addressing the boss.

JSON Schema Examples:
\`\`\`json
{
  "action": "SET_OVERRIDE",
  "directive": "Feature A is currently not working, advise users to use the console instead",
  "reason": "Temporary outage reported by Boss",
  "bossMessage": "Understood, Boss! I have logged this active override. I will instruct all users accordingly until you let me know it is resolved."
}
\`\`\`

\`\`\`json
{
  "action": "SAVE_LESSON",
  "key": "VPS Plan Pricing",
  "fact": "Plan 1 is $5/mo (2GB RAM), Plan 2 is $10/mo (4GB RAM), Plan 3 is $20/mo (8GB RAM)",
  "gapId": "GAP-XXXX",
  "bossMessage": "Got it, Boss! I have saved this lesson to my atomic facts library."
}
\`\`\`

\`\`\`json
{
  "action": "SAVE_ARTICLE",
  "category": "reward-claim",
  "title": "Community Reward Claiming",
  "content": "Detailed step-by-step instructions...",
  "bossMessage": "I have created the new article in category 'reward-claim' titled 'Community Reward Claiming'."
}
\`\`\`

\`\`\`json
{
  "action": "CHAT",
  "bossMessage": "Your response to the boss..."
}
\`\`\``;

  try {
    const response = await withRetry(() => client.chat.completions.create({
      model: config.ai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ],
      temperature: 0.2,
      max_tokens: 1500
    }));

    const reply = response.choices?.[0]?.message?.content || '';

    // Strip thinking blocks or prologues if the model generates them
    let cleanReply = reply
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/^Here's a thinking process:[\s\S]*?\n\n/gi, '')
      .trim();

    // Robust JSON extraction — handles newlines and special chars inside values
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
        // JSON.parse failed (e.g. unescaped newline in a value) — extract fields with regex
        const action = (rawStr.match(/"action"\s*:\s*"([^"]+)"/i) || [])[1] || 'CHAT';

        // Extract bossMessage: grab everything between the first " after "bossMessage": and the last "
        const bmMatch = rawStr.match(/"bossMessage"\s*:\s*"([\s\S]*)"[^"]*\}?\s*$/i);
        let bossMessage = bmMatch
          ? bmMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\n+$/, '').trim()
          : cleanReply.replace(/```[\s\S]*?```/g, '').trim();

        bossMessage = bossMessage
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/^Here's a thinking process:[\s\S]*?\n\n/gi, '')
          .trim();

        const articleTitle = (rawStr.match(/"articleTitle"\s*:\s*"([^"]+)"/i) || [])[1];
        const articleContent = (rawStr.match(/"articleContent"\s*:\s*"([\s\S]*)"\s*[,}]/i) || [])[1]
          ?.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
        const category = (rawStr.match(/"category"\s*:\s*"([^"]+)"/i) || [])[1];
        const suggestionId = (rawStr.match(/"suggestionId"\s*:\s*"([^"]+)"/i) || [])[1];

        return { action, bossMessage, articleTitle, articleContent, category, suggestionId };
      }
    }

    return {
      action: 'CHAT',
      bossMessage: cleanReply.slice(0, 1900)
    };
  } catch (error) {
    console.error('Boss DM AI processing error:', error);
    // Surface 429 clearly so the owner knows it's a rate limit, not a bug
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
   * Handles Direct Messages from the Owner.
   * @param {import('discord.js').Message} message 
   */
  async handleDM(message) {
    // 0. Ignore bots
    if (message.author.bot) return;

    // 1. Validate Owner ID
    const isOwner =
      Boolean(config.ownerId && config.ownerId === message.author.id) ||
      (Array.isArray(config.ownerIds) && config.ownerIds.includes(message.author.id));

    if (!isOwner) {
      // Do not respond to non-owners in DM
      return;
    }

    await message.channel.sendTyping();

    // 2. Direct Shortcuts / Fast Commands
    const content = message.content.trim();

    // 2a. List pending suggestions
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
        .setFooter({ text: 'Reply with "SUGG-XXXX <your question>" to interrogate a suggestion.' });
      return message.reply({ embeds: [embed] });
    }

    // 2b. List pending knowledge questions
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
        .setFooter({ text: 'Reply directly or type "GAP-XXXX <your answer>" to teach me!' });
      return message.reply({ embeds: [embed] });
    }

    // 2c. Direct answer to a knowledge question: "GAP-XXXX The answer is..."
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

    // 2d. Owner asking a question about a specific suggestion: "SUGG-XXXX what sources did you use?"
    const suggMatch = content.match(/^(SUGG-[A-Z0-9]{4})\s+(.+)/i);
    if (suggMatch) {
      const suggId = suggMatch[1].toUpperCase();
      const question = suggMatch[2].trim();
      const suggestion = db.getSuggestion(suggId);
      if (!suggestion) {
        return message.reply(`⚠️ Couldn't find suggestion \`${suggId}\`. Use \`!suggestions\` to see pending ones.`);
      }
      await message.channel.sendTyping();
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
        .setDescription('You can manage my entire knowledge base, set live overrides, and train me in natural language right here in DMs!')
        .addFields([
          {
            name: '❓ Knowledge Gaps & Questions',
            value: '• When I lack documentation in a ticket, I will DM you here instead of bothering staff.\n• *"!gaps"* — List unanswered questions from tickets\n• *"GAP-XXXX <your answer>"* or just reply in natural language!'
          },
          {
            name: '🚨 Live Overrides (Hotfixes & Temp Status)',
            value: '• *"Feature A is down, tell users to do X"*\n• *"Dallas node is under maintenance"*\n• *"Clear override 1"* or *"Clear all overrides"*'
          },
          {
            name: '💡 Lessons (Fast Atomic Facts)',
            value: '• *"Add lesson: We have 3 plans: Basic ($5), Pro ($15), Ultra ($30)"*\n• *"List lessons"*\n• *"Delete lesson <key>"*'
          },
          {
            name: '📖 Articles (In-Depth Categorized Docs)',
            value: '• *"Create article in category \'rewards\' titled \'Daily Claims\' with content..."*\n• *"List articles"*\n• *"Show article rewards daily-claims"*'
          },
          {
            name: '💬 Direct Conversational Training',
            value: 'You can talk to me naturally or ask: *"How would you answer a user with data loss on node 2?"*'
          }
        ])
        .setFooter({ text: 'Executive Management Interface' });

      return message.reply({ embeds: [helpEmbed] });
    }

    // 3. Process Natural Language Command with AI
    const result = await processBossCommand(content, message.author.username);

    // 4. Execute Action
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

      await message.reply({ content: result.bossMessage || 'Directive active!', embeds: [embed] });
      return;
    }

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

    if (result.action === 'SAVE_LESSON') {
      const saved = knowledgeManager.saveLesson(result.key, result.fact);
      if (result.gapId) {
        db.resolvePendingQuestion(result.gapId, { key: saved.key, fact: saved.fact });
      }
      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('💡 New Lesson Learned')
        .addFields([
          { name: '🔑 Topic / Key', value: saved.key, inline: true },
          { name: '📝 Atomic Fact', value: saved.fact, inline: false }
        ]);

      if (result.gapId) {
        embed.setFooter({ text: `Resolved Knowledge Gap ${result.gapId}` });
      }

      return message.reply({ content: result.bossMessage || 'Lesson saved, Boss!', embeds: [embed] });
    }

    if (result.action === 'DELETE_LESSON') {
      const deleted = knowledgeManager.deleteLesson(result.key);
      if (deleted) {
        return message.reply({ content: `✅ Lesson \`${result.key}\` has been removed from my memory.` });
      } else {
        return message.reply({ content: `⚠️ Could not find lesson with key \`${result.key}\`.` });
      }
    }

    if (result.action === 'SAVE_ARTICLE') {
      const saved = knowledgeManager.saveArticle(result.category, result.title, result.content);
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📖 Article Published: ${saved.title}`)
        .addFields([
          { name: '📂 Category', value: saved.category, inline: true },
          { name: '📄 Slug', value: `\`${saved.slug}.md\``, inline: true },
          { name: '📑 Content Preview', value: result.content.slice(0, 300) + '...', inline: false }
        ]);

      return message.reply({ content: result.bossMessage || 'Article saved, Boss!', embeds: [embed] });
    }

    if (result.action === 'DELETE_ARTICLE') {
      const deleted = knowledgeManager.deleteArticle(result.category, result.title || result.slug);
      if (deleted) {
        return message.reply({ content: `✅ Article removed from category \`${result.category}\`.` });
      } else {
        return message.reply({ content: `⚠️ Could not find article in category \`${result.category}\`.` });
      }
    }

    if (result.action === 'LIST_KNOWLEDGE') {
      const overrides = knowledgeManager.getOverrides();
      const lessons = knowledgeManager.getLessons();
      const articles = knowledgeManager.listArticles();
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

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📚 Current Knowledge Base Catalog')
        .setDescription(`Total Categories: **${catKeys.length}** | Total Articles: **${totalArticles}** | Lessons: **${Object.keys(lessons).length}**`)
        .addFields([
          {
            name: `🚨 Active Overrides (${overrides.length})`,
            value: overridesStr
          },
          {
            name: `💡 Fast Lessons (${Object.keys(lessons).length})`,
            value: lessonsStr
          },
          {
            name: `📖 Categories & Articles`,
            value: articlesStr
          }
        ]);

      return message.reply({ embeds: [embed] });
    }

    // Default chat reply
    return message.reply({ content: result.bossMessage || 'Yes, Boss! I am updated and ready.' });
  }
};
