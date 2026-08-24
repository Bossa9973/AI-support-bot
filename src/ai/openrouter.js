const OpenAI = require('openai');
const config = require('../config');
const { getKnowledgeContext } = require('./knowledgeBase');

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
 * Generates an AI response for a support ticket.
 * Evaluates whether it can assist or should escalate to human staff with priority classification.
 * @param {Array<{role: string, content: string}>} conversationHistory 
 * @param {string} userQuery
 * @param {string} username
 * @returns {Promise<{reply: string, handoff: boolean, priority: 'red'|'yellow'|'green', summary: string | null}>}
 */
async function generateSupportResponse(conversationHistory, userQuery, username = 'User') {
  const client = getClient();
  if (!client) {
    return {
      reply: "⚠️ *AI Support is currently in setup mode. An API key has not been configured in `.env`. A human staff member will assist you shortly.*",
      handoff: true,
      priority: 'green',
      summary: `User @${username} opened a ticket and needs assistance from staff.`
    };
  }

  const knowledgeBaseText = getKnowledgeContext();

  const systemPrompt = `You are the official AI Support Specialist for Vertex Panel and Hosting Services.
You possess deep technical expertise on how the dashboard ("the dash"), server management, reseller portal, web terminals, and auto-deploy engines operate.

--- CORE KNOWLEDGE BASE ---
${knowledgeBaseText}
--- END KNOWLEDGE BASE ---

CRITICAL DECISION-MAKING & PRIORITY COMPASS:
Evaluate the user's message, assess the context broadly, and decide whether you can resolve it or if it requires staff escalation:

1. **WHEN YOU CAN RESOLVE (Self-Service & Troubleshooting)**:
   - Dashboard navigation, UI walkthroughs, power actions (Start/Stop/Reboot/Kill).
   - Explaining Web Terminal vs noVNC Console, using "1-Click Repair", waiting for guest agent.
   - Reseller models (Zero-Cost 30% cap vs Own Inventory), payment links (/pay/{uuid}), $10 min withdrawal.
   - Standard FAQs and general troubleshooting.
   ➔ Provide clear, step-by-step instructions using Discord markdown.

2. **PROBING & CLARIFYING AMBIGUOUS REQUESTS**:
   - If a user sends a vague message like "I want a refund" or "help my server is weird", do NOT panic or instantly declare an emergency.
   - First, ask polite clarifying questions (e.g. asking why they want a refund, if they ran into a technical hurdle you can fix, or what specific error message appears).
   - If it's a routine request (e.g. "I just don't need this anymore"), handle it as standard/non-emergent (GREEN).

3. **PRIORITY CLASSIFICATION COMPASS (FOR STAFF HANDOFFS)**:
   When an issue requires human staff intervention, assess its severity and categorize into one of three tiers:

   🟢 **GREEN (Standard / Non-Emergent)**:
   - Minor inquiries, routine billing or cancellation requests, cosmetic UI questions.
   - Small VPS issues or configuration tasks that need staff review but do NOT impact critical uptime.
   - General account inquiries where systems are operating normally.

   🟡 **YELLOW (Elevated Priority / Attention Required)**:
   - Functional blockers where the user cannot deploy or configure a feature, but existing servers are fine.
   - Reseller payment/balance discrepancies or delayed gateway sessions.
   - Performance slowdowns or recurring non-fatal errors.

   🔴 **RED (Critical Emergency)**:
   - Complete server downtime, widespread host node outages, or network blackouts.
   - Active data loss, destroyed disks, corrupted critical partitions.
   - Security breaches, compromised root access, unauthorized modifications.
   - Hypervisor node crashes or critical backend infrastructure failures.

4. **HOW TO FORMAT A STAFF HANDOFF**:
   - First, address the user politely: explain that you do not have the physical or administrative capability to perform this action directly, and inform them that you are handing the ticket to our team.
   - At the VERY END of your message, output the exact handoff block:
   [HANDOFF]
   PRIORITY: <RED | YELLOW | GREEN>
   SUMMARY: <Concise 1-2 sentence explanation of what the user is experiencing and why it has this priority>
   [/HANDOFF]

USER CONTEXT:
The user you are speaking with is @${username}. Be intelligent, empathetic, and actionable.`;

  // Build message array for the model
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  // Include recent conversation context (last 10 messages)
  if (Array.isArray(conversationHistory)) {
    const recent = conversationHistory.slice(-10);
    for (const msg of recent) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    }
  }

  // Append current user message
  messages.push({ role: 'user', content: userQuery });

  try {
    const response = await client.chat.completions.create({
      model: config.openRouter.model || 'stealth/ox-alpha',
      messages: messages,
      temperature: 0.3,
      max_tokens: 1000
    });

    const rawReply = response.choices?.[0]?.message?.content || '';
    if (!rawReply.trim()) {
      return {
        reply: "I'm having trouble processing that right now. I am notifying our support team to step in.",
        handoff: true,
        priority: 'green',
        summary: `User @${username} requested help with: "${userQuery.slice(0, 150)}"`
      };
    }

    // Parse for [HANDOFF] ... [/HANDOFF]
    const handoffMatch = rawReply.match(/\[HANDOFF\][\s\S]*?\[\/HANDOFF\]/i);
    if (handoffMatch) {
      const block = handoffMatch[0];
      
      // Extract priority
      const priorityMatch = block.match(/PRIORITY:\s*(RED|YELLOW|GREEN|ORANGE)/i);
      let priority = 'green';
      if (priorityMatch) {
        const rawP = priorityMatch[1].toLowerCase();
        priority = rawP === 'orange' ? 'yellow' : rawP;
      }

      // Extract summary
      const summaryMatch = block.match(/SUMMARY:\s*([\s\S]*?)(?:\[\/HANDOFF\]|$)/i);
      const summary = summaryMatch ? summaryMatch[1].trim() : `User @${username} requires human assistance for: "${userQuery.slice(0, 150)}"`;

      const cleanReply = rawReply.replace(/\[HANDOFF\][\s\S]*?\[\/HANDOFF\]/i, '').trim();

      return {
        reply: cleanReply,
        handoff: true,
        priority: priority,
        summary: summary
      };
    }

    return {
      reply: rawReply.trim(),
      handoff: false,
      priority: 'green',
      summary: null
    };
  } catch (error) {
    console.error('OpenRouter AI Error:', error?.response?.data || error?.message || error);

    return {
      reply: "I encountered an issue generating a response. I am notifying our support team to assist you directly.",
      handoff: true,
      priority: 'green',
      summary: `User @${username} needs assistance (AI request failed): "${userQuery.slice(0, 150)}"`
    };
  }
}

module.exports = {
  generateSupportResponse
};
