const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');
const embedBuilder = require('../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Deploy the Ticket Tool style support panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const panel = embedBuilder.createTicketPanel();
    await interaction.channel.send(panel);
    await interaction.reply({ content: '✅ Support ticket panel deployed successfully!', ephemeral: true });
  }
};
