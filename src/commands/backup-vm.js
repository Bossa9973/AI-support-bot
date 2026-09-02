const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits
} = require('discord.js');
const panelBridge = require('../utils/panelBridge');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup-vm')
    .setDescription('⚡ Tag a user to select and instantly back up their virtual machines to Google Drive')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The Discord user whose virtual machines you want to back up')
        .setRequired(true)
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

    const targetUser = interaction.options.getUser('user');
    const sync = interaction.options.getBoolean('sync') ?? true;

    try {
      // 1. Fetch user's VMs from Vertex Panel
      const userRes = await panelBridge.getUserVMs(targetUser.id);

      if (!userRes.success || !userRes.servers || userRes.servers.length === 0) {
        const notFoundEmbed = new EmbedBuilder()
          .setColor('#FEE75C')
          .setTitle('⚠️ No Virtual Machines Found')
          .setDescription(
            `Could not find any active virtual machines for <@${targetUser.id}> (\`${targetUser.tag}\`).\n\n` +
            `**Possible Reasons:**\n` +
            `• The user has not linked their Discord account on Vertex Panel.\n` +
            `• The user currently has 0 active virtual machine instances.\n` +
            `• User email/ID does not match database records.`
          )
          .setFooter({ text: 'Vertex Cloud Infrastructure • Bolts System' })
          .setTimestamp();

        return interaction.editReply({ embeds: [notFoundEmbed] });
      }

      const servers = userRes.servers;
      const panelUser = userRes.user;

      // 2. Build the Multi-Select Menu for the Admin
      const selectMenuOptions = servers.slice(0, 25).map((server) => {
        const tierBadge = server.plan_tier === 'paid' ? '💎 Paid' : '🆓 Free';
        const label = `${server.hostname || server.name || 'VM #' + server.id}`.substring(0, 50);
        const description = `[${tierBadge}] ${server.cpu} Cores, ${server.memory_mb}MB RAM, ${server.disk_gb}GB Disk | ${server.node_name}`.substring(0, 100);

        return {
          label: `${label} (VMID: ${server.vmid})`,
          value: String(server.id),
          description: description,
          emoji: server.plan_tier === 'paid' ? '💎' : '⚡'
        };
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`backup_select_${interaction.id}`)
        .setPlaceholder(`⚡ Choose one or multiple virtual machines (${servers.length} available)...`)
        .setMinValues(1)
        .setMaxValues(Math.min(servers.length, 25))
        .addOptions(selectMenuOptions);

      const cancelBtn = new ButtonBuilder()
        .setCustomId(`backup_cancel_${interaction.id}`)
        .setLabel('Cancel')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Secondary);

      const selectRow = new ActionRowBuilder().addComponents(selectMenu);
      const buttonRow = new ActionRowBuilder().addComponents(cancelBtn);

      // 3. Render the stylized Interactive Selection Embed
      const vmListPreview = servers.map((s, idx) => {
        const tierBadge = s.plan_tier === 'paid' ? '💎 **PAID**' : '🆓 **FREE**';
        const lastBackupStr = s.last_backup ? `<t:${Math.floor(new Date(s.last_backup.created_at).getTime() / 1000)}:R>` : '*Never*';
        return `\`${idx + 1}.\` **${s.hostname || s.name}** (VMID: \`${s.vmid}\`)\n` +
               `   • Node: \`${s.node_name}\` | Tier: ${tierBadge}\n` +
               `   • Specs: \`${s.cpu} Cores\` | \`${s.memory_mb} MB RAM\` | \`${s.disk_gb} GB Storage\`\n` +
               `   • Total Backups: \`${s.backups_count}\` (Latest: ${lastBackupStr})`;
      }).join('\n\n');

      const selectionEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('⚡ Targeted Virtual Machine Backup')
        .setDescription(
          `Select the virtual machine(s) belonging to <@${targetUser.id}> that you wish to back up.\n` +
          `You can select **multiple VMs** at once using the dropdown menu below!\n\n` +
          `**User Details:**\n` +
          `• **Panel Name:** \`${panelUser.name}\` (\`${panelUser.email}\`)\n` +
          `• **Discord Tag:** <@${targetUser.id}> (\`${targetUser.id}\`)\n` +
          `• **Active Instances:** \`${servers.length}\` Virtual Machine(s)\n\n` +
          `**Available Virtual Machines:**\n${vmListPreview}`
        )
        .setFooter({ text: 'Select from dropdown below to initiate snapshot & Google Drive stream' })
        .setTimestamp();

      const response = await interaction.editReply({
        embeds: [selectionEmbed],
        components: [selectRow, buttonRow]
      });

      // 4. Await Admin Interaction via Component Collector
      const collector = response.createMessageComponentCollector({
        filter: (i) => i.user.id === interaction.user.id,
        time: 90000 // 90 seconds timeout
      });

      collector.on('collect', async (i) => {
        if (i.customId === `backup_cancel_${interaction.id}`) {
          const cancelEmbed = new EmbedBuilder()
            .setColor('#747F8D')
            .setTitle('✖️ Backup Cancelled')
            .setDescription('The targeted virtual machine backup operation was cancelled.')
            .setTimestamp();

          return i.update({ embeds: [cancelEmbed], components: [] });
        }

        if (i.isStringSelectMenu() && i.customId === `backup_select_${interaction.id}`) {
          const selectedServerIds = i.values;
          const selectedVMs = servers.filter((s) => selectedServerIds.includes(String(s.id)));

          // Update message with in-progress streaming status
          const inProgressEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle('⏳ Streaming Cloud Backups in Progress...')
            .setDescription(
              `Initiating Proxmox snapshot and instant Google Drive cloud sync for **${selectedVMs.length}** virtual machine(s):\n\n` +
              selectedVMs.map((v) => `• 📦 **${v.hostname || v.name}** (VMID: \`${v.vmid}\` on \`${v.node_name}\`)`).join('\n') +
              `\n\n⚡ *Streaming backup archives via SFTP directly to Google Drive...*`
            )
            .setFooter({ text: 'Vertex Backup Cloud Stream Engine • Please wait...' })
            .setTimestamp();

          await i.update({ embeds: [inProgressEmbed], components: [] });

          // 5. Trigger the backup & cloud stream
          try {
            const backupRes = await panelBridge.backupVMs(selectedServerIds, {
              sync: sync,
              name: `Discord Backup by ${interaction.user.tag}`
            });

            if (!backupRes.success) {
              const failEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('❌ Backup Failed')
                .setDescription(`**Error Details:**\n\`\`\`\n${backupRes.error || 'Unknown error'}\n\`\`\``)
                .setTimestamp();

              return interaction.editReply({ embeds: [failEmbed], components: [] });
            }

            const results = backupRes.results || [];
            const successCount = results.filter((r) => r.success).length;
            const failCount = results.filter((r) => !r.success).length;

            const resultsText = results.map((r) => {
              if (r.success) {
                const tierIcon = r.plan_tier === 'paid' ? '💎' : '⚡';
                return `✅ **${r.server_hostname}** (VMID: \`${r.vmid}\`)\n` +
                       `   • Node: \`${r.node_name}\` ${tierIcon}\n` +
                       `   • Backup UUID: \`${r.backup_uuid || 'Generated'}\`\n` +
                       `   • Cloud Sync: \`⚡ Uploaded to Google Drive (convoy-backups)\` ☁️`;
              } else {
                return `❌ **${r.server_hostname || 'Server #' + r.server_id}**: \`${r.error}\``;
              }
            }).join('\n\n');

            const completedEmbed = new EmbedBuilder()
              .setColor(failCount > 0 && successCount === 0 ? '#ED4245' : '#57F287')
              .setTitle('⚡ Virtual Machine Cloud Backup Complete')
              .setDescription(
                `**Backup Execution Summary for <@${targetUser.id}>:**\n` +
                `• **Target VMs:** \`${selectedVMs.length}\`\n` +
                `• **Successfully Backed Up & Streamed:** \`${successCount}\` ✅\n` +
                `• **Failed:** \`${failCount}\` ${failCount > 0 ? '⚠️' : ''}\n` +
                `• **Cloud Storage:** \`Google Drive (convoy-backups)\` ☁️\n\n` +
                `**Virtual Machine Results:**\n${resultsText}`
              )
              .addFields([
                { name: '🛡️ Cloud Redundancy', value: 'Archives are safely saved in Google Drive and ready for one-click restoration anytime.', inline: false }
              ])
              .setFooter({ text: `Targeted Backup • Triggered by ${interaction.user.tag}` })
              .setTimestamp();

            await interaction.editReply({ embeds: [completedEmbed], components: [] });

          } catch (execErr) {
            console.error('[BACKUP EXEC ERROR]', execErr);
            const errEmbed = new EmbedBuilder()
              .setColor('#ED4245')
              .setTitle('❌ Execution Error')
              .setDescription(`Failed while processing backups:\n\`\`\`\n${execErr.message}\n\`\`\``)
              .setTimestamp();

            await interaction.editReply({ embeds: [errEmbed], components: [] });
          }
        }
      });

      collector.on('end', async (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          const timeoutEmbed = new EmbedBuilder()
            .setColor('#747F8D')
            .setTitle('⏰ Backup Menu Timed Out')
            .setDescription('No virtual machines were selected within 90 seconds. Please run `/backup-vm` again when ready.')
            .setTimestamp();

          try {
            await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
          } catch (e) {}
        }
      });

    } catch (err) {
      console.error('[BACKUP-VM ERROR]', err);
      const errorEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('❌ Command Error')
        .setDescription(`An unexpected error occurred:\n\`\`\`\n${err.message}\n\`\`\``)
        .setTimestamp();

      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
};
