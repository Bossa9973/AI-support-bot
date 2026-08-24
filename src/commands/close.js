const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const ticketManager = require('../utils/ticketManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close the current support ticket'),

  async execute(interaction) {
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({ content: '❌ This channel is not an active ticket.', ephemeral: true });
    }

    await interaction.reply({ content: '🔒 Closing ticket and generating transcript...' });
    await ticketManager.closeTicket(interaction.channel, interaction.user);
  }
};
