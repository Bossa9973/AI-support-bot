const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const ticketManager = require('../utils/ticketManager');
const embedBuilder = require('../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Close and archive the current support ticket'),

  async execute(interaction) {
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) {
      const errorEmbed = embedBuilder.createErrorEmbed(
        'Invalid Ticket Channel',
        'This command can only be used inside an active ticket channel.'
      );
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }

    const closeEmbed = embedBuilder.createWarningEmbed(
      'Ticket Closure Initiated',
      `🔒 Closing ticket #${String(ticket.ticketNumber).padStart(4, '0')}, generating transcript, and archiving channel...`
    );

    await interaction.reply({ embeds: [closeEmbed] });
    await ticketManager.closeTicket(interaction.channel, interaction.user);
  }
};
