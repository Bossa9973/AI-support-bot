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
 * Intelligent completion helper that:
 * 1. Enforces dynamic max_tokens (defaults to 500-600 to prevent credit exhaustion)
 * 2. Catches OpenRouter 402 "can only afford X tokens" errors and automatically retries with affordable token limits
 * 3. Falls back to free models if balance is 0 or paid model is blocked
 * 4. Retries automatically on rate limits (429/529/503/502)
 */
async function createChatCompletion(params, options = {}) {
  const client = getClient();
  if (!client) throw new Error('AI client not initialized (missing API key)');

  const defaultMax = parseInt(config.ai.maxTokens || '600', 10);
  let requestParams = {
    ...params,
    model: params.model || config.ai.model,
    max_tokens: params.max_tokens ? Math.min(params.max_tokens, defaultMax) : defaultMax
  };

  const context = options.context || 'AI';
  const maxAttempts = options.maxAttempts || 3;
  let delay = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.chat.completions.create(requestParams);
    } catch (err) {
      const status = err?.status || err?.code || (err?.response ? err.response.status : 0);
      const errMsg = err?.message || JSON.stringify(err?.response?.data || '');

      // ─── 1. HANDLE 402 INSUFFICIENT CREDITS / MAX_TOKENS LIMIT ────────────────
      if (status === 402 || errMsg.includes('402') || errMsg.includes('requires more credits') || errMsg.includes('fewer max_tokens')) {
        const affordMatch = errMsg.match(/can only afford (\d+)/i) || errMsg.match(/afford up to (\d+)/i);
        if (affordMatch) {
          const rawAffordable = parseInt(affordMatch[1], 10);
          const safeAffordable = Math.max(40, rawAffordable - 10);
          console.warn(`[${context}] ⚠️ OpenRouter credit limit reached. Auto-adjusting max_tokens from ${requestParams.max_tokens} down to ${safeAffordable} and retrying...`);
          requestParams.max_tokens = safeAffordable;
          continue;
        }

        // If credits are 0 or cannot afford on paid model, switch to free fallback model
        const fallbackModel = config.ai.fallbackModel || 'poolside/laguna-s-2.1:free';
        if (requestParams.model !== fallbackModel && config.ai.provider === 'openrouter') {
          console.warn(`[${context}] ⚠️ OpenRouter paid model credit low. Automatically falling back to efficient model (${fallbackModel}) with max_tokens: 300...`);
          requestParams.model = fallbackModel;
          requestParams.max_tokens = 300;
          continue;
        }
      }

      // ─── 2. HANDLE 410 MODEL END-OF-LIFE (EOL / Gone) ────────────────────────
      if (status === 410 || errMsg.includes('410') || errMsg.includes('end of life') || errMsg.includes('no longer available')) {
        const eolFallback = config.ai.fallbackModel ||
          (config.ai.provider === 'nvidia' ? 'nvidia/nemotron-3.5-lightning-30b-a3b' : 'poolside/laguna-s-2.1:free');
        if (requestParams.model !== eolFallback) {
          console.warn(`[${context}] ⚠️ Model '${requestParams.model}' has reached end of life (410). Switching to fallback: ${eolFallback}`);
          requestParams.model = eolFallback;
          requestParams.max_tokens = Math.min(requestParams.max_tokens || 400, 400);
          continue;
        }
        // Fallback itself is also EOL — throw so the caller surfaces a proper error
        throw err;
      }

      // ─── 3. HANDLE 404 MODEL UNAVAILABLE / REDIRECT SLUG ─────────────────────
      if (status === 404 || errMsg.includes('404') || errMsg.includes('unavailable') || errMsg.includes('No endpoints found')) {
        const slugMatch = errMsg.match(/use this slug instead:\s*([a-zA-Z0-9_\-\.\/:]+)/i);
        if (slugMatch) {
          const suggestedSlug = slugMatch[1].trim();
          console.warn(`[${context}] ⚠️ OpenRouter model redirected: switching to suggested slug (${suggestedSlug}) with max_tokens: 350...`);
          requestParams.model = suggestedSlug;
          requestParams.max_tokens = Math.min(requestParams.max_tokens || 350, 350);
          continue;
        }

        // If the model was a :free model that failed, fallback to base model with low tokens
        if (requestParams.model.endsWith(':free')) {
          const baseSlug = requestParams.model.replace(':free', '');
          console.warn(`[${context}] ⚠️ Free model endpoint unavailable. Retrying with base model (${baseSlug}) with low max_tokens...`);
          requestParams.model = baseSlug;
          requestParams.max_tokens = Math.min(requestParams.max_tokens || 300, 300);
          continue;
        }

        // Fallback to configured fallback model
        const notFoundFallback = config.ai.fallbackModel || 'poolside/laguna-s-2.1:free';
        if (requestParams.model !== notFoundFallback) {
          console.warn(`[${context}] ⚠️ Model unavailable (404). Falling back to ${notFoundFallback}...`);
          requestParams.model = notFoundFallback;
          requestParams.max_tokens = Math.min(requestParams.max_tokens || 350, 350);
          continue;
        }
      }

      // ─── 3. HANDLE 429 / 529 / 503 / 502 RATE LIMITS & OVERLOADS ──────────────
      const isRetryable =
        status === 429 ||
        status === 529 ||
        status === 503 ||
        status === 502 ||
        errMsg.includes('429') ||
        errMsg.includes('529') ||
        errMsg.includes('overloaded');

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
  createChatCompletion,
  warmupConnection,
  buildUserContent,
  getActiveProvider: () => config.ai
};
