const discordTranscripts = require('discord-html-transcripts');
const { AttachmentBuilder } = require('discord.js');

/**
 * Generates an HTML transcript of a Discord channel with robust fallback.
 * @param {import('discord.js').TextChannel} channel 
 * @param {string} customFileName
 * @returns {Promise<import('discord.js').AttachmentBuilder|null>}
 */
async function generateTranscript(channel, customFileName = null) {
  const fileName = customFileName || `transcript-${channel.name}.html`;

  // 1. Attempt standard HTML transcript with saveImages: false to prevent component/image fetch crashes
  try {
    const attachment = await discordTranscripts.createTranscript(channel, {
      limit: -1, // Export all messages
      returnType: 'attachment',
      filename: fileName,
      saveImages: false,
      poweredBy: false
    });
    if (attachment) return attachment;
  } catch (error) {
    console.warn(`[Transcript] HTML render notice for #${channel.name}: ${error?.message || error}. Falling back to plain text transcript.`);
  }

  // 2. Fallback: Generate safe, formatted text transcript
  try {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages || messages.size === 0) {
      const buffer = Buffer.from(`[Transcript: #${channel.name}]\n(No messages recorded in this channel)\n`, 'utf-8');
      return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
    }

    const formatted = Array.from(messages.values())
      .reverse()
      .map((m) => {
        const time = m.createdAt ? m.createdAt.toISOString() : new Date().toISOString();
        const tag = m.author ? (m.author.tag || m.author.username || 'Unknown') : 'Unknown';
        const content = m.cleanContent || m.content || '';
        const attachments = m.attachments && m.attachments.size > 0
          ? ` [Attachments: ${Array.from(m.attachments.values()).map(a => a.url).join(', ')}]`
          : '';
        return `[${time}] ${tag}: ${content}${attachments}`;
      })
      .join('\n');

    const buffer = Buffer.from(formatted || `[Transcript: #${channel.name}]\n(Empty)`, 'utf-8');
    return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
  } catch (fallbackError) {
    console.warn(`[Transcript] Text fallback failed for #${channel.name}:`, fallbackError?.message || fallbackError);
    return null;
  }
}

module.exports = {
  generateTranscript
};
