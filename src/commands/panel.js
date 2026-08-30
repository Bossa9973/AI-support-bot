const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');
const embedBuilder = require('../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Deploy the interactive support ticket panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const panel = embedBuilder.createTicketPanel(interaction.guild);
    await interaction.channel.send(panel);

    const successEmbed = embedBuilder.createSuccessEmbed(
      'Support Panel Deployed',
      'The interactive support ticket panel has been posted to this channel.'
    );

    await interaction.editReply({ embeds: [successEmbed] });
  }
};
