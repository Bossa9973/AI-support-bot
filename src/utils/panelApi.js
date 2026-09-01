/**
 * panelApi.js — Vertex Panel Bot API client
 *
 * Communicates with the panel's /api/bot/* endpoints using the shared
 * BOT_API_SECRET. All calls are safe-to-fail: if the panel is unreachable,
 * methods return null/false rather than throwing.
 *
 * Authentication: Authorization: Bot <PANEL_BOT_SECRET>
 */

const config = require('../config');

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build the standard auth headers for every panel request.
 */
function authHeaders() {
  return {
    'Authorization': `Bot ${config.panel.botSecret}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

/**
 * Perform a fetch with a hard timeout. Returns null on any error.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<any|null>}
 */
async function panelFetch(url, options = {}) {
  if (!config.panel.enabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.panel.timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[PanelAPI] ${options.method || 'GET'} ${url} → ${res.status}: ${text.slice(0, 200)}`);
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          return { ok: false, ...parsed };
        }
      } catch (_) {}
      return { ok: false, error: `Panel returned HTTP status ${res.status}` };
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    // AbortError = timeout; TypeError = network down — both are expected in prod
    if (err.name !== 'AbortError') {
      console.warn(`[PanelAPI] Request failed: ${url} — ${err.message}`);
    }
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch the comprehensive account context for a Discord user.
 * Returns the full user-history payload or null if unavailable.
 *
 * @param {string} discordId
 * @returns {Promise<object|null>}
 */
async function getPanelContext(discordId) {
  if (!discordId) return null;
  const url = `${config.panel.url}/api/bot/user-history/${encodeURIComponent(discordId)}`;
  const data = await panelFetch(url, { method: 'GET', headers: authHeaders() });
  if (!data || !data.ok) return null;
  return data;
}

/**
 * Get the live power state of a specific server.
 * Returns { power_state, vmid, name } or null.
 *
 * @param {string} discordId — owner's Discord ID (for ownership validation)
 * @param {number|string} serverId — panel server ID
 * @returns {Promise<object|null>}
 */
async function getServerState(discordId, serverId) {
  if (!discordId || !serverId) return null;
  const url = `${config.panel.url}/api/bot/server-state/${encodeURIComponent(discordId)}/${encodeURIComponent(serverId)}`;
  const data = await panelFetch(url, { method: 'GET', headers: authHeaders() });
  if (!data || !data.ok) return null;
  return data;
}

/**
 * Perform a safe power action on a server (start / shutdown / reboot).
 * Returns { ok, message } or null on failure.
 *
 * @param {string} discordId — owner's Discord ID
 * @param {number|string} serverId — panel server ID
 * @param {'start'|'shutdown'|'reboot'} action
 * @returns {Promise<object|null>}
 */
async function performServerAction(discordId, serverId, action) {
  const allowed = ['start', 'shutdown', 'reboot'];
  if (!allowed.includes(action)) {
    console.warn(`[PanelAPI] Blocked disallowed action: ${action}`);
    return null;
  }
  if (!discordId || !serverId) return null;

  const url = `${config.panel.url}/api/bot/server-action`;
  return panelFetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ discord_id: String(discordId), server_id: Number(serverId), action })
  });
}

/**
 * Rename a server.
 * Returns { ok, name } or null on failure.
 *
 * @param {string} discordId — owner's Discord ID
 * @param {number|string} serverId — panel server ID
 * @param {string} newName — max 40 characters
 * @returns {Promise<object|null>}
 */
async function renameServer(discordId, serverId, newName) {
  if (!discordId || !serverId || !newName) return null;
  const safeName = String(newName).slice(0, 40).trim();
  if (!safeName) return null;

  const url = `${config.panel.url}/api/bot/server-rename`;
  return panelFetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ discord_id: String(discordId), server_id: Number(serverId), name: safeName })
  });
}

module.exports = {
  getPanelContext,
  getServerState,
  performServerAction,
  renameServer
};
