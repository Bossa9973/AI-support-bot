const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

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

  // OpenRouter Config
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'stealth/ox-alpha',
    siteUrl: process.env.OPENROUTER_SITE_URL || 'https://discord.gg',
    siteName: process.env.OPENROUTER_SITE_NAME || 'Discord AI Support'
  },

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
