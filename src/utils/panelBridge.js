const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Panel Bridge Utility
 * Connects the Discord Bot to Vertex Panel's Laravel CLI and backup engine.
 */
class PanelBridge {
  constructor() {
    this.panelPath = this.resolvePanelPath();
  }

  /**
   * Automatically resolve the Vertex Panel root path on the server.
   */
  resolvePanelPath() {
    const candidates = [
      process.env.VERTEX_PANEL_PATH,
      '/var/www/vertex-panel',
      '/var/www/vertex',
      path.join(__dirname, '../../../Vertex-Panel'),
      path.join(__dirname, '../../../vertex-panel'),
      '/root/Vertex-Panel',
      '/root/vertex-panel'
    ].filter(Boolean);

    for (const cand of candidates) {
      if (fs.existsSync(path.join(cand, 'artisan'))) {
        return cand;
      }
    }

    return '/var/www/vertex-panel';
  }

  /**
   * Execute an artisan command and parse JSON output.
   */
  runArtisan(args = [], timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const artisanPath = path.join(this.panelPath, 'artisan');

      execFile('php', [artisanPath, ...args], { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && !stdout) {
          return reject(new Error(`Artisan execution failed: ${err.message}\n${stderr}`));
        }

        const rawOutput = (stdout || '').trim();

        // Extract JSON from output if other messages precede it
        const jsonStart = rawOutput.indexOf('{');
        const jsonEnd = rawOutput.lastIndexOf('}');

        if (jsonStart !== -1 && jsonEnd !== -1) {
          try {
            const parsed = JSON.parse(rawOutput.substring(jsonStart, jsonEnd + 1));
            return resolve(parsed);
          } catch (pe) {
            // If json parse fails, return raw
          }
        }

        resolve({ success: !err, raw: rawOutput, error: err ? err.message : null });
      });
    });
  }

  /**
   * List all Proxmox nodes configured in the panel.
   */
  async listNodes() {
    return this.runArtisan(['server:bot-helper', 'list-nodes', '--json']);
  }

  /**
   * Find a user by Discord ID, email, or database ID and list their virtual machines.
   */
  async getUserVMs(userQuery) {
    return this.runArtisan(['server:bot-helper', 'get-user-vms', `--user=${userQuery}`, '--json']);
  }

  /**
   * Backup one or more specific virtual machines by server ID with immediate cloud upload.
   */
  async backupVMs(serverIds = [], options = {}) {
    const ids = Array.isArray(serverIds) ? serverIds.join(',') : String(serverIds);
    const args = ['server:bot-helper', 'backup-vms', `--servers=${ids}`, '--json'];

    if (options.sync !== false) {
      args.push('--sync');
    }
    if (options.name) {
      args.push(`--name=${options.name}`);
    }

    return this.runArtisan(args, 180000); // 3-minute timeout for multi-VM backup
  }

  /**
   * Bulk backup across all nodes or a specific node filtered by tier (all, paid, free).
   */
  async backupBulk(options = {}) {
    const args = ['server:bot-helper', 'backup-bulk', '--json'];

    if (options.nodeId && options.nodeId !== 'all') {
      args.push(`--node=${options.nodeId}`);
    }
    if (options.tier) {
      args.push(`--tier=${options.tier}`);
    }
    if (options.sync !== false) {
      args.push('--sync');
    }

    return this.runArtisan(args, 300000); // 5-minute timeout for bulk operations
  }

  /**
   * Trigger immediate cloud upload of all pending backups.
   */
  async uploadPendingBackups() {
    return this.runArtisan(['server:upload-pending-backups', '--sync'], 300000);
  }
}

module.exports = new PanelBridge();
