/**
 * test-panel-integration.js
 *
 * Verifies:
 *  1. panelContextFormatter output for online / offline panel
 *  2. [ACTION:] block extraction (whitelist only)
 *  3. Ownership + whitelist safety (no destructive actions leak through)
 *  4. Config panel block exists and is typed correctly
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');

const { formatPanelContext } = require('../src/utils/panelContextFormatter');
const { extractActions } = require('../src/handlers/panelActionHandler');
const config = require('../src/config');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}`);
    console.error('   ', err.message);
    failed++;
  }
}

// ── 1. formatPanelContext — offline ──────────────────────────────────────────
console.log('\n--- Testing panelContextFormatter (offline) ---');

test('Offline context contains connectivity notice', () => {
  const ctx = formatPanelContext(null, true);
  assert.ok(ctx.includes('Panel connection issue'), `Got: ${ctx.slice(0, 100)}`);
  assert.ok(ctx.includes('=== VERTEX PANEL CONTEXT ==='));
  assert.ok(!ctx.includes('Balance:'), 'Should not show balance when offline');
});

test('null panelData triggers offline mode', () => {
  const ctx = formatPanelContext(null);
  assert.ok(ctx.includes('Panel connection issue'));
});

// ── 2. formatPanelContext — online ────────────────────────────────────────────
console.log('\n--- Testing panelContextFormatter (online) ---');

const mockPanelData = {
  ok: true,
  user: { id: 5, name: 'TestUser', credits: 42.50, is_reseller: false },
  servers: [
    {
      id: 17,
      name: 'My Web Server',
      status: 'in_use',
      memory_mb: 4096,
      disk_mb: 51200,
      cpu_cores: 2,
      vmid: 105,
      hostname: 'web.example.com',
      node_name: 'US-East-1',
      expires_at: new Date(Date.now() + 86400000 * 14).toISOString() // 14 days out
    },
    {
      id: 22,
      name: 'Old Game Server',
      status: 'suspended',
      memory_mb: 8192,
      disk_mb: 102400,
      cpu_cores: 4,
      vmid: 110,
      hostname: 'game.example.com',
      node_name: 'EU-West-1',
      expires_at: new Date(Date.now() - 86400000 * 5).toISOString() // expired 5 days ago
    }
  ],
  transactions: [
    { id: 1, amount: -12.00, type: 'server_renewal', description: 'Server renewal', created_at: new Date().toISOString() },
    { id: 2, amount: 30.00,  type: 'topup',          description: 'Top-up',         created_at: new Date().toISOString() }
  ],
  discord_stats: { messages: 142, boosts: 1 }
};

test('Online context shows user name and balance', () => {
  const ctx = formatPanelContext(mockPanelData, false);
  assert.ok(ctx.includes('TestUser'), `Missing username. Got: ${ctx.slice(0, 200)}`);
  assert.ok(ctx.includes('42.50 BOLTs'), `Missing balance. Got: ${ctx.slice(0, 200)}`);
});

test('Online context shows both servers', () => {
  const ctx = formatPanelContext(mockPanelData, false);
  assert.ok(ctx.includes('My Web Server'), 'Missing server 1 name');
  assert.ok(ctx.includes('Old Game Server'), 'Missing server 2 name');
  assert.ok(ctx.includes('ACTIVE'), 'Missing active badge');
  assert.ok(ctx.includes('SUSPENDED'), 'Missing suspended badge');
});

test('Online context includes AI instruction reminder', () => {
  const ctx = formatPanelContext(mockPanelData, false);
  assert.ok(ctx.includes('INSTRUCTIONS FOR EON:'), 'Missing AI instructions');
  assert.ok(ctx.includes('=== END PANEL CONTEXT ==='), 'Missing end marker');
});

test('Online context includes transaction info', () => {
  const ctx = formatPanelContext(mockPanelData, false);
  assert.ok(ctx.includes('Top-up') || ctx.includes('Server renewal'), 'Missing transaction descriptions');
});

// ── 3. extractActions — whitelist ─────────────────────────────────────────────
console.log('\n--- Testing extractActions (action block parsing) ---');

test('Extracts server_power reboot', () => {
  const { actions, cleanReply } = extractActions(
    'Sure, I\'ll reboot your server now.\n[ACTION: server_power|17|reboot]'
  );
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'server_power');
  assert.strictEqual(actions[0].serverId, 17);
  assert.strictEqual(actions[0].param, 'reboot');
  assert.ok(!cleanReply.includes('[ACTION:'), 'Block not stripped from reply');
});

test('Extracts server_power start', () => {
  const { actions } = extractActions('[ACTION: server_power|22|start]');
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].param, 'start');
});

test('Extracts server_power shutdown', () => {
  const { actions } = extractActions('[ACTION: server_power|22|shutdown]');
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].param, 'shutdown');
});

test('Extracts server_rename', () => {
  const { actions } = extractActions('[ACTION: server_rename|17|My New Server]');
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].type, 'server_rename');
  assert.strictEqual(actions[0].param, 'My New Server');
});

test('Server rename is capped at 40 chars', () => {
  const { actions } = extractActions('[ACTION: server_rename|17|A very long server name that exceeds forty characters easily]');
  assert.strictEqual(actions[0].param.length, 40, `Expected 40 chars, got ${actions[0].param.length}`);
});

// ── 4. Destructive actions are blocked ────────────────────────────────────────
console.log('\n--- Testing destructive action blocking ---');

test('Disallowed action "delete" is blocked', () => {
  const { actions } = extractActions('[ACTION: server_power|17|delete]');
  assert.strictEqual(actions.length, 0, 'delete action should be blocked');
});

test('Disallowed action "reinstall" is blocked', () => {
  const { actions } = extractActions('[ACTION: server_power|17|reinstall]');
  assert.strictEqual(actions.length, 0);
});

test('Unknown action type is blocked', () => {
  const { actions } = extractActions('[ACTION: server_destroy|17|now]');
  assert.strictEqual(actions.length, 0);
});

test('No actions in normal reply', () => {
  const { actions, cleanReply } = extractActions('Here is how to connect via SSH:\n```bash\nssh root@x.x.x.x\n```');
  assert.strictEqual(actions.length, 0);
  assert.ok(cleanReply.includes('ssh root@'), 'Normal reply should be unchanged');
});

// ── 5. Config panel block ─────────────────────────────────────────────────────
console.log('\n--- Testing config.panel block ---');

test('config.panel block exists', () => {
  assert.ok(config.panel, 'config.panel missing');
});

test('config.panel.enabled is boolean', () => {
  assert.strictEqual(typeof config.panel.enabled, 'boolean');
});

test('config.panel.timeoutMs is a number', () => {
  assert.strictEqual(typeof config.panel.timeoutMs, 'number');
  assert.ok(config.panel.timeoutMs > 0, 'timeoutMs should be > 0');
});

test('config.panel.url has no trailing slash', () => {
  assert.ok(!config.panel.url.endsWith('/'), `URL should not end with /: "${config.panel.url}"`);
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed === 0 ? '⚠️  No tests ran' : `🎯 Results: ${passed} passed, ${failed} failed`}`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 ALL PANEL INTEGRATION TESTS PASSED!\n');
}
