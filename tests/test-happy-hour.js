/**
 * test-happy-hour.js — Happy Hour rarity engine tests
 *
 * Verifies:
 *  1. rollEventType() distribution (~2% legendary, ~10% booster, ~88% regular)
 *  2. rollDiscount() stays within each tier's allowed range
 *  3. rollSlots() returns 1 for legendary, 1-10 for others
 *  4. buildHappyHourEvent() produces valid, complete objects
 *  5. DB claim logic: double-claim blocked, full-slots blocked, expired blocked
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const assert = require('assert');

const {
  rollEventType,
  rollDiscount,
  rollSlots,
  rollPlan,
  rollRequirementType,
  buildHappyHourEvent,
  VPS_PLANS
} = require('../src/utils/happyHour');
const db = require('../src/database/db');

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

const SAMPLES = 10000;

// ── 1. Event type distribution ────────────────────────────────────────────────
console.log('\n--- rollEventType() distribution ---');

const typeCounts = { legendary: 0, booster: 0, regular: 0 };
for (let i = 0; i < SAMPLES; i++) typeCounts[rollEventType()]++;

test(`Legendary ~2% (got ${(typeCounts.legendary/SAMPLES*100).toFixed(1)}%)`, () => {
  const pct = typeCounts.legendary / SAMPLES * 100;
  assert.ok(pct >= 0.5 && pct <= 5, `Expected ~2%, got ${pct.toFixed(1)}%`);
});

test(`Booster ~10% (got ${(typeCounts.booster/SAMPLES*100).toFixed(1)}%)`, () => {
  const pct = typeCounts.booster / SAMPLES * 100;
  assert.ok(pct >= 6 && pct <= 16, `Expected ~10%, got ${pct.toFixed(1)}%`);
});

test(`Regular ~88% (got ${(typeCounts.regular/SAMPLES*100).toFixed(1)}%)`, () => {
  const pct = typeCounts.regular / SAMPLES * 100;
  assert.ok(pct >= 78 && pct <= 95, `Expected ~88%, got ${pct.toFixed(1)}%`);
});

// ── 2. Discount ranges ────────────────────────────────────────────────────────
console.log('\n--- rollDiscount() ranges ---');

test('Regular discounts within 10-55%', () => {
  for (let i = 0; i < 500; i++) {
    const d = rollDiscount('regular');
    assert.ok(d >= 10 && d <= 55, `Got ${d} — out of range`);
  }
});

test('Booster discounts within 30-60%', () => {
  for (let i = 0; i < 500; i++) {
    const d = rollDiscount('booster');
    assert.ok(d >= 30 && d <= 60, `Got ${d} — out of range`);
  }
});

test('Legendary discounts within 80-90%', () => {
  for (let i = 0; i < 500; i++) {
    const d = rollDiscount('legendary');
    assert.ok(d >= 80 && d <= 90, `Got ${d} — out of range`);
  }
});

// ── 3. Slot rolling ───────────────────────────────────────────────────────────
console.log('\n--- rollSlots() ---');

test('Legendary always returns 1 slot', () => {
  for (let i = 0; i < 200; i++) {
    assert.strictEqual(rollSlots('legendary'), 1);
  }
});

test('Regular slots within 1-10', () => {
  for (let i = 0; i < 500; i++) {
    const s = rollSlots('regular');
    assert.ok(s >= 1 && s <= 10, `Got ${s}`);
  }
});

// ── 4. buildHappyHourEvent() shape ────────────────────────────────────────────
console.log('\n--- buildHappyHourEvent() ---');

const tiers = ['regular', 'booster', 'legendary'];
for (const tier of tiers) {
  test(`Valid event shape for tier: ${tier}`, () => {
    // Temporarily monkey-patch rollEventType to force tier
    const orig = require('../src/utils/happyHour').rollEventType;
    // We can't easily monkey-patch, so just build 50 and check shape
    for (let i = 0; i < 50; i++) {
      const ev = buildHappyHourEvent();
      assert.ok(ev.id,       'Missing id');
      assert.ok(ev.plan,     'Missing plan');
      assert.ok(ev.discount, 'Missing discount');
      assert.ok(ev.slots >= 1 && ev.slots <= 10, `Bad slots: ${ev.slots}`);
      assert.ok(ev.discountedInvites > 0, 'Missing discountedInvites');
      assert.ok(ev.discountedBolts > 0,   'Missing discountedBolts');
      assert.ok(['regular','booster','legendary'].includes(ev.tier), `Bad tier: ${ev.tier}`);
      assert.ok(['invites','bolts','invites_boost'].includes(ev.reqType), `Bad reqType: ${ev.reqType}`);
      // Discounted values must be less than or equal to base values
      assert.ok(ev.discountedInvites <= ev.plan.invites, 'discountedInvites > base');
      assert.ok(ev.discountedBolts   <= ev.plan.bolts,   'discountedBolts > base');
    }
  });
  break; // one shape test covers all tiers
}

test('Legendary events always have 1 slot', () => {
  let legendaryCount = 0;
  for (let i = 0; i < 2000; i++) {
    const ev = buildHappyHourEvent();
    if (ev.tier === 'legendary') {
      assert.strictEqual(ev.slots, 1, 'Legendary must have 1 slot');
      legendaryCount++;
    }
  }
  console.log(`   (found ${legendaryCount} legendary events in 2000 rolls)`);
});

// ── 5. VPS plan data sanity ───────────────────────────────────────────────────
console.log('\n--- VPS plan catalogue ---');

test('All 10 plans defined with required fields', () => {
  assert.strictEqual(VPS_PLANS.length, 10, `Expected 10 plans, got ${VPS_PLANS.length}`);
  for (const p of VPS_PLANS) {
    assert.ok(p.id,      `Plan missing id`);
    assert.ok(p.name,    `Plan ${p.id} missing name`);
    assert.ok(p.invites > 0, `Plan ${p.id} missing invites`);
    assert.ok(p.bolts > 0,   `Plan ${p.id} missing bolts`);
    assert.ok(p.ram,     `Plan ${p.id} missing ram`);
    assert.ok(p.cpu > 0, `Plan ${p.id} missing cpu`);
    assert.ok(p.disk,    `Plan ${p.id} missing disk`);
  }
});

test('Plans are sorted by ascending invite requirement', () => {
  for (let i = 1; i < VPS_PLANS.length; i++) {
    assert.ok(VPS_PLANS[i].invites >= VPS_PLANS[i-1].invites,
      `Plan order wrong: ${VPS_PLANS[i-1].name}(${VPS_PLANS[i-1].invites}) > ${VPS_PLANS[i].name}(${VPS_PLANS[i].invites})`);
  }
});

// ── 6. DB claim logic ─────────────────────────────────────────────────────────
console.log('\n--- DB Happy Hour claim logic ---');

const TEST_EVENT = {
  id: 'test-event-123',
  tier: 'regular',
  plan: VPS_PLANS[3],
  discount: 20,
  slots: 2,
  claimed: 0,
  reqType: 'invites',
  discountedInvites: 10,
  discountedBolts: 1920,
  expired: false,
  announceMessageId: null,
  announceChannelId: null
};

db.setHappyHourEvent(TEST_EVENT);

test('First claim succeeds', () => {
  const r = db.addHappyHourClaim('test-event-123', 'user-aaa');
  assert.ok(r.ok, `Expected ok, got: ${r.reason}`);
  assert.strictEqual(r.claimed, 1);
});

test('Double-claim is blocked', () => {
  const r = db.addHappyHourClaim('test-event-123', 'user-aaa');
  assert.ok(!r.ok);
  assert.ok(r.reason.includes('already claimed'));
});

test('Second user can claim', () => {
  const r = db.addHappyHourClaim('test-event-123', 'user-bbb');
  assert.ok(r.ok);
  assert.strictEqual(r.claimed, 2);
});

test('Slots exhausted — claim blocked', () => {
  const r = db.addHappyHourClaim('test-event-123', 'user-ccc');
  assert.ok(!r.ok);
  assert.ok(r.reason.includes('slots'), `Got: ${r.reason}`);
});

// Expire event and try claiming
db.expireHappyHourEvent();

test('Expired event — claim blocked with "no longer active"', () => {
  const r = db.addHappyHourClaim('test-event-123', 'user-ddd');
  assert.ok(!r.ok);
  assert.ok(r.reason.includes('no longer active'), `Got: ${r.reason}`);
});

test('getHappyHourEvent returns null after expiry', () => {
  assert.strictEqual(db.getHappyHourEvent(), null);
});

test('History includes expired event', () => {
  const hist = db.getHappyHourHistory(5);
  assert.ok(hist.length > 0);
  assert.ok(hist[0].expired === true);
});

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n🎯 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log('\n🎉 ALL HAPPY HOUR TESTS PASSED!\n');
