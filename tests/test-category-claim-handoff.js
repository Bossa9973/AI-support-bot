const assert = require('assert');
const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { isStaffMember } = require('../src/utils/staffChecker');
const openrouter = require('../src/ai/openrouter');
const embedBuilder = require('../src/utils/embedBuilder');
const config = require('../src/config');

console.log('=== RUNNING TESTS FOR CATEGORY, CLAIMING & ESCALATION ===');

// 1. Test isStaffMember
console.log('\n--- Testing isStaffMember ---');

// 1a. Bot Owner ID
assert.strictEqual(isStaffMember(null, null, { id: config.ownerId }), true, 'Bot Owner ID should be staff');

// 1b. Guild Owner
const fakeGuild = {
  ownerId: '999888777',
  roles: { cache: new Map() },
  members: { cache: new Map() }
};
assert.strictEqual(isStaffMember({ id: '999888777' }, fakeGuild), true, 'Guild Owner should be staff');

// 1c. Administrator Permission BitField
const adminMember = {
  id: '111222333',
  permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
  roles: { cache: new Map() }
};
assert.strictEqual(isStaffMember(adminMember, fakeGuild), true, 'Admin with PermissionsBitField should be staff');

// 1d. Administrator Permission as string/number
const adminMemberString = {
  id: '111222334',
  permissions: String(PermissionFlagsBits.Administrator),
  roles: { cache: new Map() }
};
assert.strictEqual(isStaffMember(adminMemberString, fakeGuild), true, 'Admin with string permissions should be staff');

// 1e. Support Role in Array format
const roleArrayMember = {
  id: '222333444',
  roles: [config.tickets.supportRoleId || '1541516517269840034']
};
assert.strictEqual(isStaffMember(roleArrayMember, fakeGuild), true, 'Member with supportRoleId in array should be staff');

// 1f. Role by name (e.g. Founder / Admin) in cache
const roleCacheMap = new Map();
roleCacheMap.set('r1', { id: 'r1', name: 'Founder' });
const namedRoleMember = {
  id: '333444555',
  roles: { cache: roleCacheMap }
};
assert.strictEqual(isStaffMember(namedRoleMember, fakeGuild), true, 'Member with Founder role name should be staff');

// 1g. Regular User
const regularMember = {
  id: '555666777',
  permissions: new PermissionsBitField(0n),
  roles: { cache: new Map() }
};
assert.strictEqual(isStaffMember(regularMember, fakeGuild), false, 'Regular user should not be staff');
console.log('✅ isStaffMember tests passed!');

// 2. Test Staff Handoff Embeds
console.log('\n--- Testing Staff Handoff Embeds ---');
const redHandoff = embedBuilder.createStaffHandoffEmbed('Dashboard is down', 'red', '1541516517269840034');
assert.ok(redHandoff.embeds.length > 0, 'Red handoff embed should exist');
assert.ok(redHandoff.components.length > 0, 'Red handoff components should exist');

const purchaseHandoffEmbed = embedBuilder.createStaffHandoffEmbed('User wants to buy VPS', 'purchase', '1541516517269840034');
assert.ok(purchaseHandoffEmbed.embeds.length > 0, 'Purchase handoff embed should exist');
assert.ok(purchaseHandoffEmbed.components.length > 0, 'Purchase handoff components should exist');

console.log('✅ Staff Handoff Embeds tests passed!');
console.log('\n🎉 ALL VERIFICATION TESTS PASSED SUCCESSFULLY!');
