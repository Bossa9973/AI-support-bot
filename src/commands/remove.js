const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a user from this support ticket')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to remove')
        .setRequired(true)
    ),

  async execute(interaction) {
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({ content: '❌ This channel is not an active ticket.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    if (targetUser.id === ticket.userId) {
      return interaction.reply({
        content: '⚠️ You cannot remove the ticket creator from their own ticket.',
        ephemeral: true
      });
    }

    await interaction.channel.permissionOverwrites.delete(targetUser.id);

    await interaction.reply({
      content: `✅ Successfully removed <@${targetUser.id}> from this ticket.`
    });
  }
};
