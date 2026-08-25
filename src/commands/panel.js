const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const embedBuilder = require('../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Deploy the interactive support ticket panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const panel = embedBuilder.createTicketPanel(interaction.guild);
    await interaction.channel.send(panel);

    const successEmbed = embedBuilder.createSuccessEmbed(
      'Support Panel Deployed',
      'The interactive support ticket panel has been posted to this channel.'
    );

    await interaction.reply({ embeds: [successEmbed], ephemeral: true });
  }
};
