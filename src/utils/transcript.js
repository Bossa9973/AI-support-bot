const discordTranscripts = require('discord-html-transcripts');
const { AttachmentBuilder } = require('discord.js');

/**
 * Generates an HTML transcript of a Discord channel.
 * @param {import('discord.js').TextChannel} channel 
 * @param {string} customFileName
 * @returns {Promise<import('discord.js').AttachmentBuilder>}
 */
async function generateTranscript(channel, customFileName = null) {
  try {
    const fileName = customFileName || `transcript-${channel.name}.html`;
    const attachment = await discordTranscripts.createTranscript(channel, {
      limit: -1, // Export all messages
      returnType: 'attachment',
      filename: fileName,
      saveImages: true,
      poweredBy: false
    });
    return attachment;
  } catch (error) {
    console.error('Error generating HTML transcript, falling back to text:', error);

    // Fallback: Generate simple text transcript
    const messages = await channel.messages.fetch({ limit: 100 });
    const formatted = messages
      .reverse()
      .map((m) => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
      .join('\n');

    const buffer = Buffer.from(formatted, 'utf-8');
    return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}.txt` });
  }
}

module.exports = {
  generateTranscript
};
