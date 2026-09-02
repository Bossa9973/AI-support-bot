const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require('discord.js');
const panelBridge = require('../utils/panelBridge');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('⚡ Trigger automated cloud backups across nodes with plan tier filters')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('tier')
        .setDescription('Filter virtual machines by plan tier')
        .setRequired(false)
        .addChoices(
          { name: '⚡ All Virtual Machines (Paid + Free)', value: 'all' },
          { name: '💎 Paid Tier Only (High Priority)', value: 'paid' },
          { name: '🆓 Free Tier Only (Promotional / Bolts)', value: 'free' }
        )
    )
    .addStringOption((option) =>
      option
        .setName('scope')
        .setDescription('Backup scope: all nodes or specific node ID')
        .setRequired(false)
    )
    .addBooleanOption((option) =>
      option
        .setName('sync')
        .setDescription('Immediately stream to Google Drive without waiting for cron (Default: True)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Permission check: Admins or Support Role or Bot Owner
    const isOwner = config.ownerIds.includes(interaction.user.id);
    const hasAdminPerm = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    const hasSupportRole = config.tickets.supportRoleId && interaction.member?.roles?.cache?.has(config.tickets.supportRoleId);

    if (!isOwner && !hasAdminPerm && !hasSupportRole) {
      return interaction.reply({
        content: '❌ **Access Denied:** You must be an Administrator or Support Staff to run backup operations.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const tier = interaction.options.getString('tier') || 'all';
    const scope = interaction.options.getString('scope') || 'all';
    const sync = interaction.options.getBoolean('sync') ?? true;

    // 1. Initial Status Embed (Bolts Theme)
    const tierLabels = {
      all: '⚡ All Virtual Machines (Paid & Free)',
      paid: '💎 Paid Tier VMs Only',
      free: '🆓 Free Tier VMs Only'
    };

    const initialEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('⚡ Vertex Cloud Backup Engine')
      .setDescription('Initiating broad cloud backup operation across infrastructure...')
      .addFields([
        { name: '🌐 Scope', value: scope === 'all' ? '`All Nodes (Datacenter-Wide)`' : `\`Node #${scope}\``, inline: true },
        { name: '🎯 Filter Tier', value: `\`${tierLabels[tier] || tier}\``, inline: true },
        { name: '☁️ Cloud Sync', value: sync ? '`⚡ Immediate Google Drive Stream`' : '`⏳ Background Queue`', inline: true }
      ])
      .setFooter({ text: `Triggered by ${interaction.user.tag} • Vertex Cloud Infrastructure` })
      .setTimestamp();

    await interaction.editReply({ embeds: [initialEmbed] });

    try {
      const result = await panelBridge.backupBulk({
        nodeId: scope !== 'all' ? scope : null,
        tier: tier,
        sync: sync
      });

      if (!result.success) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('❌ Backup Operation Failed')
          .setDescription(`**Error Details:**\n\`\`\`\n${result.error || 'Unknown error occurred.'}\n\`\`\``)
          .setFooter({ text: 'Vertex Backup Engine' })
          .setTimestamp();

        return interaction.editReply({ embeds: [errorEmbed] });
      }

      const total = result.total || 0;
      const results = result.results || [];
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      // Format result preview
      let detailsList = '';
      if (results.length > 0) {
        detailsList = results.slice(0, 10).map((r) => {
          if (r.success) {
            const tierBadge = r.plan_tier === 'paid' ? '💎' : '🆓';
            return `✅ **${r.server_hostname || 'Server #' + r.server_id}** (VMID: \`${r.vmid}\`) • ${tierBadge} ${r.node_name}`;
          } else {
            return `❌ **Server #${r.server_id}**: ${r.error}`;
          }
        }).join('\n');

        if (results.length > 10) {
          detailsList += `\n*...and ${results.length - 10} more virtual machines.*`;
        }
      } else {
        detailsList = 'ℹ️ No active virtual machines matched the selected criteria.';
      }

      const successEmbed = new EmbedBuilder()
        .setColor(failed > 0 && successful === 0 ? '#ED4245' : '#57F287')
        .setTitle('⚡ Cloud Backup Operation Complete')
        .setDescription(
          `**Infrastructure Backup Summary:**\n` +
          `• **Processed:** \`${total}\` servers\n` +
          `• **Dispatched & Snapshotted:** \`${successful}\` ✅\n` +
          `• **Failed / Skipped:** \`${failed}\` ⚠️\n` +
          `• **Cloud Destination:** \`Google Drive (convoy-backups)\` ☁️\n\n` +
          `**Virtual Machine Status:**\n${detailsList}`
        )
        .addFields([
          { name: '🛡️ Disaster Recovery', value: 'All snapshots are verified and synced to Google Drive cloud storage.', inline: false }
        ])
        .setFooter({ text: `Executed by ${interaction.user.tag} • Vertex Cloud Infrastructure` })
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });

    } catch (err) {
      console.error('[BACKUP COMMAND ERROR]', err);
      const errorEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('❌ Command Execution Error')
        .setDescription(`An unexpected error occurred while communicating with Vertex Panel:\n\`\`\`\n${err.message}\n\`\`\``)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
