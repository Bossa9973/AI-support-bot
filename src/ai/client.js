const OpenAI = require('openai');
const config = require('../config');

let openaiClient = null;
let currentProviderKey = null;

/**
 * Returns a singleton OpenAI client configured for the active AI provider
 * (OpenRouter, NVIDIA NIM, or custom OpenAI-compatible endpoint).
 */
function getClient() {
  const ai = config.ai;
  const clientKey = `${ai.provider}:${ai.baseURL}:${ai.apiKey}`;

  if (!openaiClient || currentProviderKey !== clientKey) {
    if (ai.apiKey) {
      openaiClient = new OpenAI({
        baseURL: ai.baseURL,
        apiKey: ai.apiKey,
        defaultHeaders: ai.defaultHeaders || {},
        maxRetries: 0 // We handle retries and backoff explicitly
      });
      currentProviderKey = clientKey;
    } else {
      openaiClient = null;
    }
  }

  return openaiClient;
}

/**
 * Wraps an AI API call with automatic exponential retry on 429/529/503/502 rate-limit or overload errors.
 */
async function withRetry(fn, maxAttempts = 3, context = 'AI') {
  let delay = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status || err?.code || (err?.response ? err.response.status : 0);
      const isRetryable =
        status === 429 ||
        status === 529 ||
        status === 503 ||
        status === 502 ||
        err?.message?.includes('429') ||
        err?.message?.includes('529') ||
        err?.message?.includes('overloaded');

      if (isRetryable && attempt < maxAttempts) {
        const retryAfter = parseInt(err?.response?.headers?.['retry-after'] || '0', 10);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : delay;
        console.warn(`[${context}] ${status || 'Overload/Rate-limit'} — retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, waitMs));
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

/**
 * Warms up the active AI provider HTTP connection on bot startup
 * to eliminate cold-start latency on the first user ticket.
 */
async function warmupConnection() {
  const client = getClient();
  if (!client) {
    console.warn(`[${config.ai.providerName}] No API Key configured — AI features will be disabled.`);
    return;
  }

  try {
    await client.chat.completions.create({
      model: config.ai.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      temperature: 0
    });
    console.log(`[${config.ai.providerName}] Connection warmed up ✓ (${config.ai.model})`);
  } catch (err) {
    console.warn(`[${config.ai.providerName}] Warmup notice: ${err?.message || err}`);
  }
}

/**
 * Builds a user content payload for the API.
 * If imageUrls are provided, returns a multimodal content array (text + images).
 * Otherwise returns a plain string.
 */
function buildUserContent(text, imageUrls = []) {
  if (!imageUrls || imageUrls.length === 0) return text || '';
  const parts = [];
  if (text && text.trim()) parts.push({ type: 'text', text });
  for (const url of imageUrls) parts.push({ type: 'image_url', image_url: { url } });
  return parts.length > 0 ? parts : (text || '');
}

module.exports = {
  getClient,
  withRetry,
  warmupConnection,
  buildUserContent,
  getActiveProvider: () => config.ai
};
