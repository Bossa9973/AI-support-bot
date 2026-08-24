const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../database/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a user to this support ticket')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to add')
        .setRequired(true)
    ),

  async execute(interaction) {
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({ content: '❌ This channel is not an active ticket.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    await interaction.channel.permissionOverwrites.edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });

    await interaction.reply({
      content: `✅ Successfully added <@${targetUser.id}> to this ticket.`
    });
  }
};
