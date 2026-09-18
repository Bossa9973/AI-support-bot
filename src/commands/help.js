const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('View available support commands and platform features'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(config.tickets.embedColor || '#5865F2')
      .setTitle('🛡️ Support Desk • Commands & Capabilities')
      .setDescription(
        'Welcome to the **Support System**. Below is the complete directory of slash commands, automated AI capabilities, and ticket controls.'
      )
      .addFields([
        {
          name: '🎫 Ticket Management Commands',
          value: [
            '• `/panel` — Deploy the interactive support ticket embed (Admins only)',
            '• `/backup` — ⚡ Broad cloud backups across nodes (Paid/Free/All)',
            '• `/backup-vm <@user>` — 📦 Select and backup specific VMs of a tagged user',
            '• `/close` — Close, lock, and archive the current ticket with full HTML transcript',
            '• `/add <@user>` — Grant another user or staff member access to this ticket',
            '• `/remove <@user>` — Revoke a user\'s access from this ticket',
            '• `/help` — Display this command index'
          ].join('\n'),
          inline: false
        },
        {
          name: '🤖 24/7 AI Support Engine',
          value: [
            '• **Instant Answers**: Resolves inquiries using server documentation and platform knowledge.',
            '• **Troubleshooting & Diagnostics**: Ingests error logs, config files, and code snippets.',
            '• **Multi-Modal**: Analyzes attached screenshot images for rapid troubleshooting.'
          ].join('\n'),
          inline: false
        },
        {
          name: '👥 Staff Assistance & Escalation',
          value: 'Need a human engineer or billing support? Click **Request Staff** inside your ticket channel, or ask the AI directly for staff assistance.',
          inline: false
        }
      ])
      .setFooter({ text: 'Customer Support Desk • Powered by AI' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
