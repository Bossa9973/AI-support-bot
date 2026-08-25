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
  model: process.env.OPENROUTER_MODEL || 'stealth/ox-alpha',
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

const maxTokens = parseInt(process.env.AI_MAX_TOKENS || process.env.MAX_TOKENS || '600', 10);
const fallbackModel = process.env.AI_FALLBACK_MODEL || (selectedProvider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct:free' : 'meta/llama-3.3-70b-instruct');

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

  // Provider specific blocks
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
    greetingMessage: process.env.TICKET_GREETING_MESSAGE || "Hello {user}, thank you for reaching out! 👋\nPlease describe your issue or question in detail, and our AI support assistant will be right with you.",
    embedColor: process.env.EMBED_COLOR || '#5865F2',
    channelPrefix: 'ticket-',
    maxTicketsPerUser: 1
  }
};
