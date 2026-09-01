/**
 * test-inactivity-auto-close.js
 *
 * Verifies:
 *  1. onStaffReply schedules 1h user inactivity warning
 *  2. Inactivity warning tags user and schedules close/delete grace period
 *  3. onUserMessage clears user inactivity timer
 *  4. onTeamHandoff schedules 1h recurring team pings and 3h unclaimed timeout
 *  5. onTicketClaimed cancels team pings and unclaimed timeout
 *  6. toggleNoAutoClose disables/enables auto-close protection
 *  7. /no_auto_close command execution
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');
const db = require('../src/database/db');
const resolutionManager = require('../src/utils/resolutionManager');
const noAutoCloseCommand = require('../src/commands/no_auto_close');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

(async () => {
  console.log('\n--- 1. Staff Reply & User Inactivity Flow ---');

  const channelId1 = 'test-chan-inact-1';
  db.createTicket(channelId1, {
    userId: 'user_alice',
    guildId: 'guild_1',
    ticketNumber: 101,
    status: 'open'
  });

  const sentMessages1 = [];
  const mockChannel1 = {
    id: channelId1,
    client: { user: { id: 'bot_id', tag: 'Bot#0001' } },
    send: async (payload) => {
      sentMessages1.push(payload);
      return { id: 'msg_1' };
    },
    delete: async () => {},
    permissionOverwrites: { edit: async () => {} },
    setName: async () => {}
  };

  await asyncTest('Staff reply starts user inactivity timer', async () => {
    await resolutionManager.onStaffReply(mockChannel1, { id: 'staff_bob', username: 'Bob' });
    const ticket = db.getTicket(channelId1);
    assert.strictEqual(ticket.lastMessageIsStaff, true);
    assert.ok(resolutionManager.hasActivePrompt(channelId1));
  });

  await asyncTest('Inactivity warning tags user with 1h reminder', async () => {
    await resolutionManager._handleUserInactivityWarning(mockChannel1, 'user_alice');
    const ticket = db.getTicket(channelId1);
    assert.strictEqual(ticket.userInactivityWarned, true);
    assert.ok(sentMessages1.length > 0);
    const lastMsg = sentMessages1[sentMessages1.length - 1];
    const content = typeof lastMsg === 'string' ? lastMsg : lastMsg.content;
    assert.ok(content.includes('<@user_alice>'));
    assert.ok(content.includes('1 hour ago'));
  });

  await asyncTest('User message clears user inactivity timer', async () => {
    resolutionManager.onUserMessage(mockChannel1, { id: 'user_alice', username: 'Alice' });
    const ticket = db.getTicket(channelId1);
    assert.strictEqual(ticket.lastMessageIsStaff, false);
    assert.strictEqual(ticket.userInactivityWarned, false);
  });

  console.log('\n--- 2. Team Handoff & Unclaimed Inactivity Flow ---');

  const channelId2 = 'test-chan-inact-2';
  db.createTicket(channelId2, {
    userId: 'user_charlie',
    guildId: 'guild_1',
    ticketNumber: 102,
    status: 'open'
  });

  const sentMessages2 = [];
  const mockChannel2 = {
    id: channelId2,
    client: { user: { id: 'bot_id', tag: 'Bot#0001' } },
    send: async (payload) => {
      sentMessages2.push(payload);
      return { id: 'msg_2' };
    },
    delete: async () => {},
    permissionOverwrites: { edit: async () => {} },
    setName: async () => {}
  };

  await asyncTest('Team handoff starts recurring pings and unclaimed timeout', async () => {
    await resolutionManager.onTeamHandoff(mockChannel2);
    const ticket = db.getTicket(channelId2);
    assert.ok(ticket.handedOverToTeamAt);
    assert.ok(resolutionManager.hasActivePrompt(channelId2));
  });

  await asyncTest('Staff claiming ticket cancels team unclaimed pings', async () => {
    resolutionManager.onTicketClaimed(mockChannel2, { id: 'staff_dan' });
    assert.strictEqual(resolutionManager.hasActivePrompt(channelId2), false);
  });

  console.log('\n--- 3. /no_auto_close Command & Protection ---');

  const channelId3 = 'test-chan-inact-3';
  db.createTicket(channelId3, {
    userId: 'user_eve',
    guildId: 'guild_1',
    ticketNumber: 103,
    status: 'open'
  });

  await asyncTest('toggleNoAutoClose enables protection and clears timers', async () => {
    const newState = resolutionManager.toggleNoAutoClose(channelId3, true);
    assert.strictEqual(newState, true);
    const ticket = db.getTicket(channelId3);
    assert.strictEqual(ticket.noAutoClose, true);
  });

  await asyncTest('Protected ticket ignores onStaffReply and onTeamHandoff', async () => {
    const mockChannel3 = {
      id: channelId3,
      client: { user: { id: 'bot_id' } },
      send: async () => {}
    };
    await resolutionManager.onStaffReply(mockChannel3, { id: 'staff_1' });
    await resolutionManager.onTeamHandoff(mockChannel3);
    assert.strictEqual(resolutionManager.hasActivePrompt(channelId3), false);
  });

  await asyncTest('/no_auto_close command execution in ticket channel', async () => {
    let replyEmbed = null;
    const mockInteraction = {
      channel: { id: channelId3 },
      user: { id: 'user_eve' },
      member: { permissions: { has: () => false }, roles: { cache: new Map() } },
      guild: { id: 'guild_1' },
      options: {
        getString: (name) => name === 'action' ? 'status' : null
      },
      reply: async (payload) => {
        replyEmbed = payload.embeds?.[0];
      }
    };

    await noAutoCloseCommand.execute(mockInteraction);
    assert.ok(replyEmbed, 'Expected embed response');
    assert.ok(replyEmbed.data.description.includes('Auto-Close Protection: ACTIVE'));
  });

  await asyncTest('toggleNoAutoClose can re-enable auto-closing', async () => {
    const newState = resolutionManager.toggleNoAutoClose(channelId3, false);
    assert.strictEqual(newState, false);
    const ticket = db.getTicket(channelId3);
    assert.strictEqual(ticket.noAutoClose, false);
  });

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n🎯 Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  else console.log('\n🎉 ALL INACTIVITY & AUTO-CLOSE TESTS PASSED!\n');
})();
