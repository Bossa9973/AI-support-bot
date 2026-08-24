const { EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');
const config = require('../config');
const knowledgeManager = require('../ai/knowledgeManager');

let openaiClient = null;

function getClient() {
  if (!openaiClient && config.openRouter.apiKey) {
    openaiClient = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.openRouter.apiKey,
      defaultHeaders: {
        'HTTP-Referer': config.openRouter.siteUrl,
        'X-Title': config.openRouter.siteName
      }
    });
  }
  return openaiClient;
}

/**
 * AI Tool Agent that translates the Boss's conversational requests into actions.
 */
async function processBossCommand(userText, username) {
  const client = getClient();
  const currentLessons = knowledgeManager.getLessons();
  const currentArticles = knowledgeManager.listArticles();
  const currentOverrides = knowledgeManager.getOverrides();

  // If no OpenAI client configured, fallback to basic intent/text response
  if (!client) {
    return {
      action: 'chat',
      reply: '⚠️ OpenRouter API Key is not configured yet in `.env`. I cannot process conversational AI commands.'
    };
  }

  const systemPrompt = `You are the executive personal assistant for the Boss / Creator of the Discord AI Support Bot.
The Boss (@${username}) is sending you direct messages to teach you, manage your knowledge base, adjust settings, and set real-time overrides.

CURRENT KNOWLEDGE STATE:
- Active Overrides (${currentOverrides.length}): ${JSON.stringify(currentOverrides)}
- Lessons (${Object.keys(currentLessons).length}): ${JSON.stringify(currentLessons)}
- Articles: ${JSON.stringify(Object.keys(currentArticles))}

YOU CAN PERFORM THE FOLLOWING ACTIONS:
1. **SET_OVERRIDE**: When the boss tells you a temporary rule, live hotfix, or current status (e.g. "Feature A is down, tell users X", "Dallas node is undergoing maintenance", "Don't accept crypto payments today").
2. **REMOVE_OVERRIDE**: When the boss tells you an override is no longer applicable or asks to clear an override.
3. **SAVE_LESSON**: When the boss gives you a short atomic fact (e.g. "We offer Plan 1 ($5), Plan 2 ($10)", "Node 1 is in Dallas", "Support hours are 9-5").
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
    const response = await client.chat.completions.create({
      model: config.openRouter.model || 'stealth/ox-alpha',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText }
      ],
      temperature: 0.2,
      max_tokens: 1500
    });

    const reply = response.choices?.[0]?.message?.content || '';

    // Extract JSON block
    const jsonMatch = reply.match(/```json([\s\S]*?)```/i) || reply.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr.trim());
      return parsed;
    }

    return {
      action: 'CHAT',
      bossMessage: reply.trim()
    };
  } catch (error) {
    console.error('Boss DM AI processing error:', error);
    return {
      action: 'CHAT',
      bossMessage: `I heard you, Boss, but encountered an error processing the structured command: ${error.message}`
    };
  }
}

module.exports = {
  /**
   * Handles Direct Messages from the Owner.
   * @param {import('discord.js').Message} message 
   */
  async handleDM(message) {
    // 1. Validate Owner ID
    const isOwner =
      config.ownerId === message.author.id ||
      config.ownerIds.includes(message.author.id);

    if (!isOwner) {
      return message.reply({
        content: '👋 Hello! I am the automated support assistant. To get help, please open a support ticket in our Discord server.'
      });
    }

    await message.channel.sendTyping();

    // 2. Direct Shortcuts / Fast Commands
    const content = message.content.trim();

    if (content.toLowerCase() === '!help' || content.toLowerCase() === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('👑 Boss Executive Control Center')
        .setDescription('You can manage my entire knowledge base, set live overrides, and train me in natural language right here in DMs!')
        .addFields([
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
      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('💡 New Lesson Learned')
        .addFields([
          { name: '🔑 Topic / Key', value: saved.key, inline: true },
          { name: '📝 Atomic Fact', value: saved.fact, inline: false }
        ]);

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

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📚 Current Knowledge Base Catalog')
        .addFields([
          {
            name: `🚨 Active Overrides (${overrides.length})`,
            value: overrides.length > 0
              ? overrides.map((o, idx) => `**${idx + 1}.** ${o.directive}`).join('\n')
              : '*None active*'
          },
          {
            name: `💡 Fast Lessons (${Object.keys(lessons).length})`,
            value: Object.keys(lessons).length > 0
              ? Object.keys(lessons).slice(0, 8).map((k) => `• **${k}**: ${lessons[k].fact.slice(0, 60)}...`).join('\n')
              : '*None loaded*'
          },
          {
            name: `📖 Articles by Category (${Object.keys(articles).length} categories)`,
            value: Object.keys(articles).length > 0
              ? Object.keys(articles).map((cat) => `📁 **${cat}**: ${articles[cat].length} articles (${articles[cat].map((a) => a.title).join(', ')})`).join('\n')
              : '*None loaded*'
          }
        ]);

      return message.reply({ embeds: [embed] });
    }

    // Default chat reply
    return message.reply({ content: result.bossMessage || 'Yes, Boss! I am updated and ready.' });
  }
};
