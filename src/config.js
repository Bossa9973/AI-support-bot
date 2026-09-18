const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const s = String(val).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// ─── AI PROVIDER CONFIGURATIONS ───────────────────────────────────────────────

const openRouterConfig = {
  enabled: parseBool(process.env.OPENROUTER_ENABLED, true),
  apiKey: process.env.OPENROUTER_API_KEY || '',
  model: process.env.OPENROUTER_MODEL || 'minimax/minimax-m3:free',
  baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  siteUrl: process.env.OPENROUTER_SITE_URL || 'https://discord.gg',
  siteName: process.env.OPENROUTER_SITE_NAME || 'Discord AI Support'
};

const nvidiaConfig = {
  enabled: parseBool(process.env.NVIDIA_ENABLED, false),
  apiKey: process.env.NVIDIA_API_KEY || '',
  model: process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct',
  baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1'
};

// Determine active provider based on explicit AI_PROVIDER or toggle flags
let selectedProvider = 'openrouter';

const explicitProvider = (process.env.AI_PROVIDER || '').trim().toLowerCase();
if (explicitProvider === 'nvidia' || explicitProvider === 'nim') {
  selectedProvider = 'nvidia';
} else if (explicitProvider === 'openrouter') {
  selectedProvider = 'openrouter';
} else {
  // Check toggle switches (e.g., OPENROUTER_ENABLED=0, NVIDIA_ENABLED=1)
  if (nvidiaConfig.enabled && !openRouterConfig.enabled) {
    selectedProvider = 'nvidia';
  } else if (openRouterConfig.enabled && !nvidiaConfig.enabled) {
    selectedProvider = 'openrouter';
  } else if (nvidiaConfig.enabled && nvidiaConfig.apiKey && !openRouterConfig.apiKey) {
    selectedProvider = 'nvidia';
  } else {
    selectedProvider = 'openrouter';
  }
}

const maxTokens = parseInt(process.env.AI_MAX_TOKENS || process.env.MAX_TOKENS || '350', 10);
const fallbackModel = process.env.AI_FALLBACK_MODEL || (selectedProvider === 'openrouter'
  ? 'openrouter/free'
  : 'nvidia/nemotron-3.5-lightning-30b-a3b');

const activeAIConfig = selectedProvider === 'nvidia'
  ? {
      provider: 'nvidia',
      providerName: 'NVIDIA NIM',
      apiKey: nvidiaConfig.apiKey,
      model: nvidiaConfig.model,
      baseURL: nvidiaConfig.baseURL,
      maxTokens,
      fallbackModel,
      defaultHeaders: {}
    }
  : {
      provider: 'openrouter',
      providerName: 'OpenRouter',
      apiKey: openRouterConfig.apiKey,
      model: openRouterConfig.model,
      baseURL: openRouterConfig.baseURL,
      maxTokens,
      fallbackModel,
      defaultHeaders: {
        'HTTP-Referer': openRouterConfig.siteUrl,
        'X-Title': openRouterConfig.siteName
      }
    };

module.exports = {
  // Discord Config
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',

  // Bot Owner ID(s) for DM training, hotpatching & executive controls
  ownerId: (process.env.OWNER_ID || '').trim(),
  ownerIds: (process.env.OWNER_ID || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),

  // Active AI Config
  ai: activeAIConfig,

  // Provider specific blocks (kept for any code that reads these directly)
  openRouter: {
    get apiKey() { return activeAIConfig.apiKey; },
    get model() { return activeAIConfig.model; },
    get baseURL() { return activeAIConfig.baseURL; },
    siteUrl: openRouterConfig.siteUrl,
    siteName: openRouterConfig.siteName,
    raw: openRouterConfig
  },
  nvidia: nvidiaConfig,

  // Ticket Settings
  tickets: {
    categoryId: process.env.TICKET_CATEGORY_ID || null,
    supportRoleId: process.env.SUPPORT_ROLE_ID || null,
    transcriptChannelId: process.env.TRANSCRIPT_CHANNEL_ID || null,
    greetingMessage: process.env.TICKET_GREETING_MESSAGE ||
      "Hello {user}, thank you for reaching out! 👋\nDescribe your issue or question and **Eon**, our AI support agent, will be right with you.",
    embedColor: process.env.EMBED_COLOR || '#5865F2',
    channelPrefix: 'ticket-',
    maxTicketsPerUser: 1
  },

  // Vertex Panel Integration
  panel: {
    url: (process.env.PANEL_URL || '').replace(/\/$/, ''), // strip trailing slash
    botSecret: process.env.PANEL_BOT_SECRET || '',
    enabled: !!(process.env.PANEL_URL && process.env.PANEL_BOT_SECRET),
    timeoutMs: parseInt(process.env.PANEL_TIMEOUT_MS || '5000', 10)
  },

  // Happy Hour VPS Event System (additive — bot is still the AI support agent)
  happyHour: {
    channelId: process.env.HAPPY_HOUR_CHANNEL_ID || '',
    enabled: parseBool(process.env.HAPPY_HOUR_ENABLED, true),
    pingRoleId: process.env.HAPPY_HOUR_PING_ROLE_ID || '', // optional role to @mention on announce
    adminRoleId: (process.env.HAPPY_HOUR_ADMIN_ROLE_ID || process.env.ADMIN_ROLE_ID || '').trim(), // optional admin role allowed to trigger/schedule
    minDelayHours: parseFloat(process.env.HAPPY_HOUR_MIN_DELAY_HOURS || '2'),
    maxDelayHours: parseFloat(process.env.HAPPY_HOUR_MAX_DELAY_HOURS || '22'),
    durationMinutes: parseInt(process.env.HAPPY_HOUR_DURATION_MINUTES || '60', 10)
  }
};
