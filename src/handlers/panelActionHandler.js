/**
 * panelActionHandler.js
 *
 * Handles AI-requested panel actions:
 *   1. Detects [ACTION: <type>|<serverId>|<param>] blocks in AI output.
 *   2. Strips them from the visible reply.
 *   3. Posts a Confirm/Cancel embed into the ticket channel.
 *   4. Executes the action when the ticket owner (or staff) clicks Confirm.
 *
 * Supported actions (SAFE ONLY — no destructive operations):
 *   server_power   — start | shutdown | reboot
 *   server_rename  — new name (max 40 chars)
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags
} = require('discord.js');
const panelApi = require('../utils/panelApi');
const db = require('../database/db');
const config = require('../config');

const embedBuilder = require('../utils/embedBuilder');

// ── Regex to detect [ACTION: type|serverId|param] ─────────────────────────
const ACTION_BLOCK_RE = /\[ACTION:\s*([a-z_]+)\|(\d+)\|([^\]]+)\]/gi;

// Human-readable labels
const ACTION_LABELS = {
  start:    'Power On',
  shutdown: 'Shut Down',
  reboot:   'Reboot',
  rename:   'Rename'
};

const ACTION_EMOJIS = {
  start:    '▶️',
  shutdown: '⏹️',
  reboot:   '🔄',
  rename:   '✏️'
};

// ── Parse & strip ──────────────────────────────────────────────────────────

/**
 * Scan the AI reply for [ACTION:] blocks, extract them, and return the
 * cleaned reply alongside a list of pending actions.
 *
 * @param {string} aiReply
 * @returns {{ cleanReply: string, actions: Array<{type,serverId,param}> }}
 */
function extractActions(aiReply) {
  const actions = [];
  const cleanReply = (aiReply || '').replace(ACTION_BLOCK_RE, (match, type, serverId, param) => {
    const t = type.toLowerCase().trim();
    const p = param.trim();

    // Only allow whitelisted actions
    if (t === 'server_power' && ['start', 'shutdown', 'reboot'].includes(p.toLowerCase())) {
      actions.push({ type: 'server_power', serverId: Number(serverId), param: p.toLowerCase() });
    } else if (t === 'server_rename') {
      const safeName = p.slice(0, 40);
      if (safeName) actions.push({ type: 'server_rename', serverId: Number(serverId), param: safeName });
    }
    return ''; // Remove the block from the visible reply
  }).trim();

  return { cleanReply, actions };
}

// ── Confirmation embed ─────────────────────────────────────────────────────

/**
 * Post a confirmation request into the ticket channel for a pending action.
 *
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticket — DB ticket row
 * @param {{ type: string, serverId: number, param: string }} action
 * @param {string} serverName — human-readable name from context
 */
async function postActionConfirmation(channel, ticket, action, serverName = '') {
  const { type, serverId, param } = action;

  let actionLabel = '';
  let emoji = '⚙️';

  if (type === 'server_power') {
    actionLabel = ACTION_LABELS[param] || param;
    emoji = ACTION_EMOJIS[param] || '⚙️';
  } else if (type === 'server_rename') {
    actionLabel = 'Rename';
    emoji = '✏️';
  }

  // Encode the action into the button customId (max 100 chars)
  // Format: panel_action_confirm|<type>|<serverId>|<param>|<ownerDiscordId>
  const ownerId = ticket.userId;
  const customIdPayload = `panel_action_confirm|${type}|${serverId}|${param}|${ownerId}`;
  const cancelPayload   = `panel_action_cancel`;

  // Guard: customId must be ≤100 chars
  if (customIdPayload.length > 100) {
    console.warn('[PanelAction] customId too long, skipping confirm embed');
    return;
  }

  const confirmBtn = new ButtonBuilder()
    .setCustomId(customIdPayload)
    .setLabel(`${emoji} Confirm`)
    .setStyle(ButtonStyle.Success);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(cancelPayload)
    .setLabel('✖ Cancel')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);

  const embed = new EmbedBuilder()
    .setColor(embedBuilder.BRAND_COLOR || 0x00d285)
    .setAuthor({ name: 'Vertex Nodes • Automated Server Control' })
    .setTitle(`${emoji} Confirm Action: ${actionLabel}`)
    .setDescription(
      `Eon requested to execute an automated action on your server.\n\n` +
      `Please confirm below to proceed with this operation.`
    )
    .addFields([
      { name: '🖥️ Target Server', value: `\`${serverName || `#${serverId}`}\``, inline: true },
      { name: '⚙️ Operation', value: `\`${actionLabel}\`${type === 'server_rename' ? ` ➔ \`${param}\`` : ''}`, inline: true },
      { name: '👤 Owner', value: `<@${ownerId}>`, inline: true },
      { name: '🛡️ Safety Verification', value: 'This action is safe and non-destructive. Click **Confirm** to execute, or **Cancel** to abort.', inline: false }
    ])
    .setFooter({ text: 'Only the ticket owner or staff can confirm this action.' })
    .setTimestamp();

  await channel.send({
    content: `<@${ownerId}>`,
    embeds: [embed],
    components: [row]
  }).catch(console.error);
}

// ── Execute confirmed action ───────────────────────────────────────────────

/**
 * Execute a confirmed panel action and send a result reply.
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {{ type: string, serverId: number, param: string, ownerDiscordId: string }} action
 */
async function executeConfirmedAction(interaction, action) {
  const { type, serverId, param, ownerDiscordId } = action;

  await interaction.deferReply().catch(() => {});

  let resultEmbed;

  try {
    if (type === 'server_power') {
      const result = await panelApi.performServerAction(ownerDiscordId, serverId, param);

      if (result && result.ok) {
        const label = ACTION_LABELS[param] || param;
        const emoji = ACTION_EMOJIS[param] || '✅';
        resultEmbed = new EmbedBuilder()
          .setColor(0x57F287) // green
          .setTitle(`${emoji} ${label} Command Sent`)
          .setDescription(`The **${label}** command was sent to your server successfully.\n\n` +
                          `It may take a few seconds to take effect.`);
      } else {
        resultEmbed = new EmbedBuilder()
          .setColor(0xED4245) // red
          .setTitle('❌ Action Failed')
          .setDescription(
            (result && result.error) ||
            'The panel returned an error. The server may be in a transitional state — try again in a moment.'
          );
      }

    } else if (type === 'server_rename') {
      const result = await panelApi.renameServer(ownerDiscordId, serverId, param);

      if (result && result.ok) {
        resultEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('✏️ Server Renamed')
          .setDescription(`Your server has been renamed to \`${result.name || param}\` successfully.`);
      } else {
        resultEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('❌ Rename Failed')
          .setDescription(
            (result && result.error) ||
            'The panel returned an error while renaming the server. Please try again.'
          );
      }
    } else {
      resultEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('⚠️ Unknown Action')
        .setDescription('This action type is not recognised. No changes were made.');
    }
  } catch (err) {
    console.error('[PanelAction] executeConfirmedAction error:', err);
    resultEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setTitle('❌ Connection Error')
      .setDescription('Could not reach the panel right now. Please try again later.');
  }

  if (resultEmbed) {
    resultEmbed
      .setAuthor({ name: 'Vertex Nodes • Panel Operations' })
      .setFooter({ text: 'Automated Infrastructure Management' })
      .setTimestamp();
  }

  await interaction.editReply({ embeds: [resultEmbed] }).catch(console.error);
}

// ── Handle Cancel ──────────────────────────────────────────────────────────

/**
 * Handle the Cancel button — acknowledge and dismiss.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleActionCancel(interaction) {
  await interaction.reply({
    content: '↩️ Action cancelled.',
    flags: MessageFlags.Ephemeral
  }).catch(() => {});

  // Remove the confirm/cancel buttons from the original message
  await interaction.message.edit({ components: [] }).catch(() => {});
}

// ── Post-all-actions orchestrator ──────────────────────────────────────────

/**
 * After the AI generates a reply, call this to handle any [ACTION:] blocks.
 * Returns the cleaned reply string (with action blocks removed).
 *
 * @param {string} aiReply
 * @param {import('discord.js').TextChannel} channel
 * @param {object} ticket — DB ticket row
 * @param {object|null} panelContext — data from panelApi.getPanelContext()
 * @returns {Promise<string>} cleaned reply
 */
async function processAiActions(aiReply, channel, ticket, panelContext) {
  if (!config.panel.enabled) return aiReply;

  const { cleanReply, actions } = extractActions(aiReply);

  if (actions.length === 0) return cleanReply;

  // Build a quick server name lookup from context
  const serverNameMap = {};
  const servers = (panelContext && (panelContext.servers || panelContext.owned_servers)) || [];
  for (const srv of servers) {
    serverNameMap[srv.id] = srv.name;
  }

  // Post one confirmation embed per action
  for (const action of actions) {
    const serverName = serverNameMap[action.serverId] || '';
    await postActionConfirmation(channel, ticket, action, serverName);
  }

  return cleanReply;
}

module.exports = {
  extractActions,
  processAiActions,
  executeConfirmedAction,
  handleActionCancel
};
