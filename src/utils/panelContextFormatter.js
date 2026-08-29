/**
 * panelContextFormatter.js — Converts raw Vertex panel API data into a
 * compact, AI-readable text block injected into Eon's system prompt.
 *
 * Rules:
 * - Never include raw JSON; always human-readable prose/table.
 * - Never include email addresses (privacy).
 * - Keep it concise — the AI's context window is finite.
 * - If panel is unreachable, return an offline notice string.
 */

/**
 * Format a bytes value to a human-readable MB/GB string.
 * The panel stores memory/disk in bytes OR in MiB (legacy).
 * Values > 100,000 are treated as bytes; smaller values as MiB.
 */
function fmtStorage(raw) {
  if (!raw && raw !== 0) return '?';
  const mb = raw > 100000 ? Math.round(raw / (1024 * 1024)) : raw;
  return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

/**
 * Format a credit/bolts number.
 */
function fmtBolts(n) {
  const v = parseFloat(n) || 0;
  return `${v.toFixed(2)} BOLTs`;
}

/**
 * Relative time label: "3 days ago", "in 12 days", "today", etc.
 */
function relativeDate(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    const now = Date.now();
    const diff = d.getTime() - now; // positive = future
    const days = Math.round(Math.abs(diff) / 86400000);
    if (days === 0) return 'today';
    if (diff < 0) return `${days}d ago`;
    return `in ${days}d`;
  } catch {
    return null;
  }
}

/**
 * Status badge for a server.
 */
function serverStatusBadge(status) {
  const map = {
    in_use: '🟢 ACTIVE',
    installing: '🔄 INSTALLING',
    install_failed: '❌ INSTALL FAILED',
    suspended: '🔴 SUSPENDED',
    expired: '⚫ EXPIRED',
    restoring_backup: '🔄 RESTORING BACKUP',
    deleting: '🗑️ DELETING',
    deletion_failed: '❌ DELETION FAILED'
  };
  return map[status] || `❓ ${(status || 'unknown').toUpperCase()}`;
}

/**
 * Build the compact panel context string to inject into the AI system prompt.
 *
 * @param {object|null} panelData — response from panelApi.getPanelContext()
 * @param {boolean} [offline=false] — set true when panel was unreachable
 * @returns {string}
 */
function formatPanelContext(panelData, offline = false) {
  if (offline || !panelData) {
    return [
      '=== VERTEX PANEL CONTEXT ===',
      '⚠️  Panel connection issue — Proxmox/panel may be experiencing connectivity problems.',
      '    Live account data is unavailable. Do NOT claim to see the user\'s account.',
      '    Tell the user: "I\'m having trouble reaching the panel right now — it may be a temporary connectivity issue."',
      '=== END PANEL CONTEXT ==='
    ].join('\n');
  }

  const lines = ['=== VERTEX PANEL CONTEXT (live data) ==='];

  // ── Account ───────────────────────────────────────────────────────────────
  const user = panelData.user;
  if (user) {
    lines.push(`Account:  ${user.name} (Panel ID #${user.id})`);
    lines.push(`Balance:  ${fmtBolts(user.credits)}`);
    if (user.is_reseller) lines.push('Role:     Reseller');
  } else {
    lines.push('Account:  ⚠️  No panel account linked to this Discord ID.');
    lines.push('          The user must sign into the panel and link their Discord in Account Settings.');
  }

  // ── Servers ───────────────────────────────────────────────────────────────
  const servers = panelData.servers || panelData.owned_servers || [];
  if (servers.length > 0) {
    lines.push(`\nServers (${servers.length}):`);
    for (const srv of servers) {
      const badge    = serverStatusBadge(srv.status);
      const ram      = fmtStorage(srv.memory_mb ?? srv.memory);
      const disk     = fmtStorage(srv.disk_mb ?? srv.disk);
      const cpu      = srv.cpu_cores ?? srv.cpu ?? '?';
      const exp      = relativeDate(srv.expires_at);
      const expLabel = exp ? ` | Expires: ${exp}` : '';
      const node     = srv.node_name || 'Node';
      lines.push(
        `  • [${badge}] ID:${srv.id} "${srv.name}" — ${cpu} vCPU / ${ram} RAM / ${disk} SSD | ${node}${expLabel}`
      );
      if (srv.hostname) lines.push(`    Hostname: ${srv.hostname}  VMID: ${srv.vmid ?? 'N/A'}`);
    }
  } else if (user) {
    lines.push('\nServers: None');
  }

  // ── Spending summary ──────────────────────────────────────────────────────
  const spending = panelData.spending_summary || panelData.summary || null;
  if (spending) {
    const spent   = fmtBolts(spending.total_spent   ?? spending.totalSpent   ?? 0);
    const depo    = fmtBolts(spending.total_deposited ?? spending.totalDeposited ?? 0);
    const bonus   = fmtBolts(spending.total_bonus   ?? spending.totalBonus   ?? 0);
    lines.push(`\nFinancials: Spent ${spent} | Deposited ${depo} | Bonus earned ${bonus}`);
  }

  // ── Recent transactions (last 5) ──────────────────────────────────────────
  const txs = panelData.transactions || [];
  if (txs.length > 0) {
    lines.push(`\nRecent Transactions (last ${Math.min(txs.length, 5)} of ${txs.length}):`);
    for (const tx of txs.slice(0, 5)) {
      const sign = parseFloat(tx.amount) >= 0 ? '+' : '';
      const when = relativeDate(tx.created_at) || 'unknown date';
      const desc = (tx.description || tx.type || '').slice(0, 60);
      lines.push(`  ${sign}${fmtBolts(tx.amount)} — ${desc} (${when})`);
    }
  }

  // ── Discord activity ──────────────────────────────────────────────────────
  const stats = panelData.discord_stats || panelData.discordStats || null;
  if (stats) {
    lines.push(`\nDiscord Activity: ${stats.messages ?? 0} messages | ${stats.boosts ?? 0} boosts`);
    const invites = panelData.invite_stats || panelData.invites || null;
    if (invites) {
      lines.push(`Invites: ${invites.valid ?? invites.joined ?? 0} valid | ${invites.left ?? 0} left`);
    }
  }

  // ── Prompt reminder for the AI ────────────────────────────────────────────
  lines.push('');
  lines.push('INSTRUCTIONS FOR EON:');
  lines.push('- Use this data to give personalised answers. Do NOT re-ask for info already visible above.');
  lines.push('- If the user\'s account shows no servers or a low balance relevant to their question, mention it naturally.');
  lines.push('- You can perform safe actions (power on/off/reboot, rename). See SAFE ACTIONS section below.');
  lines.push('=== END PANEL CONTEXT ===');

  return lines.join('\n');
}

module.exports = { formatPanelContext };
