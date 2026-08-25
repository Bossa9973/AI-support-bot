const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const embedBuilder = require('../utils/embedBuilder');

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
      const errorEmbed = embedBuilder.createErrorEmbed(
        'Invalid Ticket Channel',
        'This command can only be used inside an active ticket channel.'
      );
      return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    await interaction.channel.permissionOverwrites.edit(targetUser.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });

    const successEmbed = embedBuilder.createSuccessEmbed(
      'Member Added to Ticket',
      `<@${targetUser.id}> has been granted access to this ticket by <@${interaction.user.id}>.`
    );

    await interaction.reply({ embeds: [successEmbed] });
  }
};
