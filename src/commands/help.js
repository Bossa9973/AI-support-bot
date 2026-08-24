const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View available commands and bot features'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(config.tickets.embedColor || '#5865F2')
      .setTitle('🛠️ AI Support Bot Commands & Help')
      .setDescription('This bot combines **Ticket Tool** style channel management with an **AI Knowledge Base Assistant** powered by OpenRouter.')
      .addFields([
        {
          name: '📋 Slash Commands',
          value: [
            '`/panel` - Deploy the ticket creation panel (Admin only)',
            '`/close` - Close and archive the current ticket',
            '`/add <@user>` - Grant another user access to the ticket',
            '`/remove <@user>` - Revoke a user\'s access from the ticket',
            '`/help` - Show this help menu'
          ].join('\n')
        },
        {
          name: '🤖 AI Support Assistant',
          value: 'When a ticket is opened, the AI automatically listens to questions and answers from the server knowledge base. If you need a human agent, click the **Claim** button or ask for staff!'
        }
      ])
      .setFooter({ text: 'AI Support Ticket System' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
