const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');
const db = require('../database/db');
const knowledgeManager = require('./knowledgeManager');
const { getClient, withRetry } = require('./client');

/**
 * Generates a short unique suggestion ID like SUGG-A3B2
 */
function generateSuggestionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'SUGG-';
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  const existing = db.getSuggestion(id);
  return existing ? generateSuggestionId() : id;
}

/**
 * Detect if an AI reply signals a knowledge gap that warrants a learning suggestion.
 */
function detectsKnowledgeGap(aiReply, userQuery) {
  if (!aiReply) return false;

  const uncertaintyPhrases = [
    "i'm not sure",
    "i don't have",
    "i don't know",
    "not in my knowledge",
    "i can't find",
    "i don't have information",
    "unclear to me",
    "i'm unsure",
    "beyond what i know",
    "i don't have details",
    "i couldn't find",
    "not documented"
  ];

  const replyLower = aiReply.toLowerCase();
  return uncertaintyPhrases.some(phrase => replyLower.includes(phrase));
}

/**
 * Analyzes a full ticket transcript (especially staff interactions upon claim/closure)
 * to extract new knowledge or ask the owner if there is an unresolved gap.
 */
async function inspectTicketTranscript(discordClient, ticketData, messages) {
  const client = getClient();
  if (!client || !messages || messages.size === 0) return;

  // Format messages chronologically
  const sorted = Array.from(messages.values()).sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  // Build readable transcript
  const transcriptLines = [];
  let hasStaffParticipation = false;

  for (const msg of sorted) {
    if (!msg.content && msg.attachments.size === 0) continue;
    const authorName = msg.author.username;
    const isBot = msg.author.id === discordClient.user.id;
    const isOwner = msg.author.id === config.ownerId || (config.ownerIds && config.ownerIds.includes(msg.author.id));
    const isStaff = !isBot && !isOwner && (msg.member?.roles?.cache?.has(config.tickets.supportRoleId) || ticketData.claimedBy === msg.author.id);

    let roleTag = 'USER';
    if (isBot) roleTag = 'AI';
    else if (isStaff || isOwner) {
      roleTag = 'STAFF';
      hasStaffParticipation = true;
    }

    transcriptLines.push(`[${roleTag} @${authorName}]: ${msg.content || '[Sent attachment]'}`);
  }

  // Need at least 2 messages to inspect
  if (transcriptLines.length < 2) return;
  const transcriptText = transcriptLines.slice(-30).join('\n');

  const existingArticles = Object.keys(knowledgeManager.listArticles());
  const existingLessons = Object.keys(knowledgeManager.getLessons());

  const prompt = `You are the chief knowledge curator and self-learning engine for the Vertex Nodes AI Support Bot.
You are inspecting a closed or staff-handled support ticket (#${String(ticketData.ticketNumber || 1).padStart(4, '0')}).

EXISTING KNOWLEDGE CATEGORIES: ${existingArticles.join(', ') || 'none'}
EXISTING LESSON KEYS: ${existingLessons.join(', ') || 'none'}

TICKET TRANSCRIPT:
${transcriptText}

YOUR TASK:
Analyze the conversation between the user, staff, and AI:
1. Did staff share valuable new knowledge, fixes, specific numbers, policies, or solutions not already in the knowledge base?
   -> Output a "lesson" or "article" suggestion to be added.
2. Did the ticket involve an unresolved issue, unexpected question, or policy ambiguity where the answer is missing or you need the OWNER's guidance?
   -> Output a "question_for_owner" asking the owner directly.
3. If this was routine, already covered, or purely account-specific (like private email verification), output "skip".

RESPONSE FORMAT (JSON only, no markdown surrounding the JSON):
If new knowledge was taught by staff:
{
  "action": "suggestion",
  "type": "lesson" or "article",
  "key": "Short descriptive key (for lesson)",
  "fact": "Atomic fact in 1-3 sentences (for lesson)",
  "category": "kebab-category (for article)",
  "title": "Article Title (for article)",
  "content": "Full markdown content (for article)",
  "reasoning": "Why this is valuable and what staff solved in this ticket",
  "sources": ["Ticket #${String(ticketData.ticketNumber || 1).padStart(4, '0')}"]
}

If you stumble upon something you don't know and need to ask the owner:
{
  "action": "ask_owner",
  "topic": "Short topic name (e.g. Reverse Proxy NAT Port Limits, Boost Grace Period)",
  "contextSummary": "1-2 sentences summarizing what happened in the ticket",
  "question": "Clear, specific question for the owner on how the bot should handle this in the future",
  "suggestedApproach": "Your proposed rule or answer for the owner to approve or correct"
}

If no action needed:
{
  "action": "skip",
  "reason": "Why no knowledge or question is needed"
}`;

  try {
    const response = await withRetry(() => client.chat.completions.create({
      model: config.openRouter.model || 'stealth/ox-alpha',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Inspect this ticket transcript and output your JSON evaluation.' }
      ],
      temperature: 0.3,
      max_tokens: 1500
    }));

    const raw = response.choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.action === 'suggestion') {
      const id = generateSuggestionId();
      const suggestion = {
        id,
        status: 'pending',
        createdAt: new Date().toISOString(),
        triggerQuery: `Staff resolution in Ticket #${String(ticketData.ticketNumber || 1).padStart(4, '0')}`,
        reasoning: parsed.reasoning || 'Extracted from staff ticket resolution',
        sources: parsed.sources || [`Ticket #${ticketData.ticketNumber || 1}`],
        type: parsed.type || 'lesson',
        key: parsed.key,
        fact: parsed.fact,
        category: parsed.category,
        title: parsed.title,
        content: parsed.content
      };
      db.saveSuggestion(suggestion);
      await sendSuggestionToOwner(discordClient, suggestion);
    } else if (parsed.action === 'ask_owner') {
      await sendKnowledgeQuestionToOwner(discordClient, {
        ticketNumber: ticketData.ticketNumber || 1,
        topic: parsed.topic,
        contextSummary: parsed.contextSummary,
        question: parsed.question,
        suggestedApproach: parsed.suggestedApproach
      });
    }
  } catch (err) {
    console.error('[SelfLearning] Error inspecting ticket transcript:', err.message);
  }
}

/**
 * Generates a short unique question ID like Q-A3B2
 */
function generateQuestionId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'GAP-';
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Sends a direct DM question to the owner when the AI stumbles upon an unknown policy or gap.
 */
async function sendKnowledgeQuestionToOwner(discordClient, data) {
  const ownerId = config.ownerId;
  if (!ownerId) return;

  try {
    const owner = await discordClient.users.fetch(ownerId);
    if (!owner) return;

    const qId = generateQuestionId();
    db.savePendingQuestion(qId, {
      ticketNumber: data.ticketNumber,
      channelId: data.channelId,
      guildId: data.guildId,
      topic: data.topic,
      question: data.question,
      userQuery: data.userQuery || data.contextSummary
    });

    const ticketNumStr = data.ticketNumber ? `#${String(data.ticketNumber).padStart(4, '0')}` : 'Live Ticket';
    const embed = new EmbedBuilder()
      .setColor('#9B59B6')
      .setTitle(`❓ Knowledge Gap Detected in Ticket ${ticketNumStr} — \`${data.topic}\``)
      .setDescription(
        `Hey Boss! A user asked a question where I didn't have enough knowledge. Instead of escalating prematurely, I need your clarification.`
      )
      .addFields([
        {
          name: '🏷️ Gap ID',
          value: `\`${qId}\``,
          inline: true
        },
        {
          name: '📌 Topic',
          value: data.topic || 'General Inquiry',
          inline: true
        },
        {
          name: '👤 User Asked',
          value: `> ${String(data.userQuery || data.contextSummary || 'User inquiry').slice(0, 300)}`,
          inline: false
        },
        {
          name: '🧠 Question for You',
          value: `**${data.question}**`,
          inline: false
        }
      ])
      .setFooter({ text: '💬 Reply directly to this DM with your answer! I will learn it and update my knowledge base.' })
      .setTimestamp();

    if (data.guildId && data.channelId) {
      embed.addFields([{
        name: '🔗 Ticket Link',
        value: `[Open Ticket Channel](https://discord.com/channels/${data.guildId}/${data.channelId})`,
        inline: false
      }]);
    }

    if (data.suggestedApproach) {
      embed.addFields([{
        name: '💡 Suggested Rule / Approach',
        value: `*${data.suggestedApproach}*`,
        inline: false
      }]);
    }

    await owner.send({ embeds: [embed] });
    console.log(`[SelfLearning] Sent knowledge gap question [${qId}] to owner for Ticket ${ticketNumStr}.`);
  } catch (err) {
    console.error('[SelfLearning] Failed to send knowledge question to owner:', err.message);
  }
}

/**
 * Sends the suggestion as a DM to the owner with Approve/Reject buttons.
 */
async function sendSuggestionToOwner(discordClient, suggestion) {
  const ownerId = config.ownerId;
  if (!ownerId) return;

  try {
    const owner = await discordClient.users.fetch(ownerId);
    if (!owner) return;

    const isArticle = suggestion.type === 'article';
    const color = isArticle ? '#5865F2' : '#57F287';
    const typeLabel = isArticle ? '📖 Article Draft' : '💡 Lesson Draft';

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🧠 Self-Learning Suggestion — \`${suggestion.id}\``)
      .setDescription(`The AI identified new platform knowledge from a support ticket and drafted the following ${isArticle ? 'article' : 'lesson'} for your review.`)
      .addFields([
        {
          name: '📌 Type',
          value: typeLabel,
          inline: true
        },
        {
          name: '🏷️ Suggestion ID',
          value: `\`${suggestion.id}\``,
          inline: true
        },
        {
          name: '🔍 Source / Context',
          value: `> ${suggestion.triggerQuery.slice(0, 200)}`,
          inline: false
        },
        {
          name: '🧩 Why it should be added',
          value: suggestion.reasoning.slice(0, 400),
          inline: false
        }
      ])
      .setTimestamp()
      .setFooter({ text: 'Reply with the ID to ask questions, or use the buttons below to approve/reject.' });

    if (isArticle) {
      embed.addFields([
        { name: '📂 Category', value: `\`${suggestion.category}\``, inline: true },
        { name: '📄 Title', value: suggestion.title, inline: true },
        { name: '📑 Content Preview', value: '```markdown\n' + suggestion.content.slice(0, 800) + (suggestion.content.length > 800 ? '\n...(truncated)' : '') + '\n```', inline: false }
      ]);
    } else {
      embed.addFields([
        { name: '🔑 Key', value: `\`${suggestion.key}\``, inline: true },
        { name: '📝 Fact', value: suggestion.fact, inline: false }
      ]);
    }

    if (suggestion.sources && suggestion.sources.length > 0) {
      embed.addFields([{
        name: '🔗 Sources',
        value: suggestion.sources.map(s => `• ${s}`).join('\n').slice(0, 500),
        inline: false
      }]);
    }

    const approveBtn = new ButtonBuilder()
      .setCustomId(`learn_approve_${suggestion.id}`)
      .setLabel('✅ Approve & Add')
      .setStyle(ButtonStyle.Success);

    const rejectBtn = new ButtonBuilder()
      .setCustomId(`learn_reject_${suggestion.id}`)
      .setLabel('❌ Reject')
      .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(approveBtn, rejectBtn);

    await owner.send({ embeds: [embed], components: [row] });
    console.log(`[SelfLearning] Suggestion ${suggestion.id} sent to owner.`);
  } catch (err) {
    console.error('[SelfLearning] Failed to DM owner:', err.message);
  }
}

/**
 * Answers a question the owner asks about a specific suggestion.
 */
async function answerSuggestionQuestion(suggestion, ownerQuestion) {
  const client = getClient();
  if (!client) return "Can't answer right now — API key not configured.";

  try {
    const context = suggestion.type === 'article'
      ? `Title: ${suggestion.title}\nCategory: ${suggestion.category}\nContent: ${suggestion.content}`
      : `Key: ${suggestion.key}\nFact: ${suggestion.fact}`;

    const response = await withRetry(() => client.chat.completions.create({
      model: config.openRouter.model || 'stealth/ox-alpha',
      messages: [
        {
          role: 'system',
          content: `You generated this knowledge base suggestion and are now answering a question from the owner about it.\n\nSuggestion:\n${context}\n\nReasoning for adding it: ${suggestion.reasoning}\nSources: ${(suggestion.sources || []).join(', ')}\n\nAnswer the owner's question directly and honestly. If they point out an error in the suggestion, acknowledge it clearly.`
        },
        { role: 'user', content: ownerQuestion }
      ],
      temperature: 0.3,
      max_tokens: 600
    }));

    return response.choices?.[0]?.message?.content?.trim() || "I couldn't generate a response.";
  } catch (err) {
    console.error('[SelfLearning] answerSuggestionQuestion error:', err.message);
    return `Error: ${err.message}`;
  }
}

/**
 * Main entry point called after standard AI responses.
 */
async function checkAndLearn(discordClient, userQuery, aiReply, history = []) {
  try {
    if (!detectsKnowledgeGap(aiReply, userQuery)) return;

    const pending = db.listPendingSuggestions();
    const alreadyQueued = pending.some(s =>
      s.triggerQuery && s.triggerQuery.toLowerCase().includes(userQuery.slice(0, 30).toLowerCase())
    );
    if (alreadyQueued) return;

    const context = history
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const client = getClient();
    if (!client) return;

    const existingArticles = Object.keys(knowledgeManager.listArticles());
    const existingLessons = Object.keys(knowledgeManager.getLessons());

    const prompt = `You are a knowledge curator for Vertex Nodes, a free VPS hosting service.
A support conversation revealed a knowledge gap.

EXISTING KNOWLEDGE CATEGORIES: ${existingArticles.join(', ') || 'none'}
EXISTING LESSON KEYS: ${existingLessons.join(', ') || 'none'}

CONVERSATION CONTEXT:
User: "${userQuery}"
AI: "${aiReply.slice(0, 500)}"

TASK:
1. Determine if this reveals a genuine gap.
2. If yes, generate a "lesson" or "article".
3. If not worth adding, output "skip".

RESPONSE FORMAT (JSON only):
{
  "type": "lesson" or "article" or "skip",
  "key": "...",
  "fact": "...",
  "category": "...",
  "title": "...",
  "content": "...",
  "reasoning": "...",
  "sources": ["User support conversation"]
}`;

    const response = await withRetry(() => client.chat.completions.create({
      model: config.openRouter.model || 'stealth/ox-alpha',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: context || userQuery }
      ],
      temperature: 0.3,
      max_tokens: 1500
    }));

    const raw = response.choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const draft = JSON.parse(jsonMatch[0]);
    if (draft.type === 'skip') return;

    const id = generateSuggestionId();
    const suggestion = {
      id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      triggerQuery: userQuery.slice(0, 300),
      reasoning: draft.reasoning || '',
      sources: draft.sources || [],
      type: draft.type,
      key: draft.key,
      fact: draft.fact,
      category: draft.category,
      title: draft.title,
      content: draft.content
    };

    db.saveSuggestion(suggestion);
    await sendSuggestionToOwner(discordClient, suggestion);
  } catch (err) {
    console.error('[SelfLearning] checkAndLearn error:', err.message);
  }
}

module.exports = {
  checkAndLearn,
  inspectTicketTranscript,
  answerSuggestionQuestion,
  sendKnowledgeQuestionToOwner
};
