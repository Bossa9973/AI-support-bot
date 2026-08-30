const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../database/db');
const embedBuilder = require('../utils/embedBuilder');

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
      const errorEmbed = embedBuilder.createErrorEmbed(
        'Invalid Ticket Channel',
        'This command can only be used inside an active ticket channel.'
      );
      return interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
    }

    const targetUser = interaction.options.getUser('user');
    if (targetUser.id === ticket.userId) {
      const warningEmbed = embedBuilder.createWarningEmbed(
        'Action Prohibited',
        'You cannot remove the ticket owner from their own support ticket.'
      );
      return interaction.reply({
        embeds: [warningEmbed],
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    await interaction.channel.permissionOverwrites.delete(targetUser.id);

    const successEmbed = embedBuilder.createSuccessEmbed(
      'Member Removed from Ticket',
      `<@${targetUser.id}>'s access to this ticket has been revoked by <@${interaction.user.id}>.`
    );

    await interaction.editReply({ embeds: [successEmbed] });
  }
};
