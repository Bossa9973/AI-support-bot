const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');
const embedBuilder = require('../utils/embedBuilder');
const panelApi = require('../utils/panelApi');

const BACKUP_COLOR = 0x5865F2;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Admin: trigger VM backups and push to Google Drive')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    // ── Subcommand: all servers (optionally filtered by tier) ──────────────
    .addSubcommand((sub) =>
      sub
        .setName('all')
        .setDescription('Backup all VMs and upload to Google Drive')
        .addStringOption((opt) =>
          opt
            .setName('tier')
            .setDescription('Which plan tier to target')
            .setRequired(false)
            .addChoices(
              { name: 'All servers (free + paid)', value: 'all' },
              { name: 'Paid tier only', value: 'paid' },
              { name: 'Free tier only', value: 'free' }
            )
        )
    )

    // ── Subcommand: by node ────────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName('node')
        .setDescription('Backup all VMs on a specific Proxmox node')
        .addIntegerOption((opt) =>
          opt
            .setName('node_id')
            .setDescription('Node ID (find it in Admin → Nodes)')
            .setRequired(true)
            .setMinValue(1)
        )
        .addStringOption((opt) =>
          opt
            .setName('tier')
            .setDescription('Filter by plan tier')
            .setRequired(false)
            .addChoices(
              { name: 'All servers (free + paid)', value: 'all' },
              { name: 'Paid tier only', value: 'paid' },
              { name: 'Free tier only', value: 'free' }
            )
        )
    )

    // ── Subcommand: specific server IDs ───────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName('server')
        .setDescription('Backup one or more specific servers by their panel ID')
        .addStringOption((opt) =>
          opt
            .setName('ids')
            .setDescription('Server ID(s) — comma separated, e.g. 42 or 1,2,5')
            .setRequired(true)
        )
    )

    // ── Subcommand: list nodes (helper) ────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName('nodes')
        .setDescription('List all Proxmox nodes and their IDs')
    ),

  async execute(interaction) {
    if (!panelApi || !panelApi.triggerBackups) {
      return interaction.reply({
        embeds: [embedBuilder.createErrorEmbed('Panel Not Configured', 'Panel API is not connected. Check PANEL_URL and PANEL_BOT_SECRET in .env.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sub = interaction.options.getSubcommand();

    // ── /backup nodes ──────────────────────────────────────────────────────
    if (sub === 'nodes') {
      const nodes = await panelApi.getNodes();
      if (!nodes || nodes.length === 0) {
        return interaction.editReply({
          embeds: [embedBuilder.createErrorEmbed('No Nodes Found', 'Could not fetch nodes from the panel.')],
        });
      }

      const nodeList = nodes.map((n) => `\`#${n.id}\` — **${n.name}**`).join('\n');
      const embed = new EmbedBuilder()
        .setColor(BACKUP_COLOR)
        .setTitle('☁️ Proxmox Nodes')
        .setDescription(nodeList || 'No nodes available.')
        .setFooter({ text: 'Use /backup node node_id:<id> to backup a specific node' })
        .setTimestamp();
      return interaction.editReply({ embeds: [embed] });
    }

    // ── Build the trigger payload ──────────────────────────────────────────
    let serverIds = null;
    let nodeId = null;
    let tier = 'all';
    let description = '';

    if (sub === 'all') {
      tier = interaction.options.getString('tier') || 'all';
      description = tier === 'all'
        ? 'Triggering backup for **all servers**...'
        : `Triggering backup for all **${tier}** tier servers...`;

    } else if (sub === 'node') {
      nodeId = interaction.options.getInteger('node_id');
      tier = interaction.options.getString('tier') || 'all';
      const tierLabel = tier === 'all' ? 'all tiers' : `${tier} tier`;
      description = `Triggering backup for all servers on **node #${nodeId}** (${tierLabel})...`;

    } else if (sub === 'server') {
      const rawIds = interaction.options.getString('ids');
      serverIds = rawIds
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !isNaN(n) && n > 0);

      if (serverIds.length === 0) {
        return interaction.editReply({
          embeds: [embedBuilder.createErrorEmbed('Invalid IDs', 'No valid server IDs found. Use comma-separated integers, e.g. `1,2,5`.')],
        });
      }
      description = `Triggering backup for server ID(s): ${serverIds.map((id) => `\`#${id}\``).join(', ')}...`;
    }

    // Send "working" state so the admin knows it's running
    const workingEmbed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle('⏳ Backup Dispatching...')
      .setDescription(description + '\n\nBackups will stream to Google Drive once Proxmox finishes each snapshot.')
      .setTimestamp();
    await interaction.editReply({ embeds: [workingEmbed] });

    // ── Call the panel API ─────────────────────────────────────────────────
    const result = await panelApi.triggerBackups({
      serverIds,
      nodeId,
      tier,
      force: true, // always bypass 24h window when triggered manually from bot
    });

    if (!result || result.ok === false) {
      const errMsg = result?.error || result?.message || 'Unknown error from panel. Check PANEL_BOT_SECRET and panel logs.';
      return interaction.editReply({
        embeds: [embedBuilder.createErrorEmbed('Backup Trigger Failed', errMsg)],
      });
    }

    // ── Success ────────────────────────────────────────────────────────────
    const emoji = result.dispatched > 0 ? '☁️' : '⚠️';
    const embed = new EmbedBuilder()
      .setColor(result.dispatched > 0 ? 0x57F287 : 0xFEE75C)
      .setTitle(`${emoji} Backup Triggered`)
      .setDescription(result.message || 'Backup jobs dispatched.')
      .addFields(
        { name: '✅ Dispatched', value: `\`${result.dispatched ?? 0}\``, inline: true },
        { name: '⏭️ Skipped', value: `\`${result.skipped ?? 0}\``, inline: true },
        { name: '☁️ Drive Folder', value: '[Open Google Drive](https://drive.google.com/drive/folders/1wi6f02OkegTIlZDWUohgH4ohkhbDNbLK)', inline: true }
      )
      .setFooter({ text: 'Files upload immediately after each Proxmox snapshot completes' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  },
};