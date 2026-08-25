const assert = require('assert');
const path = require('path');
const db = require('../src/database/db');
const knowledgeManager = require('../src/ai/knowledgeManager');
const { handleButton } = require('../src/handlers/buttonHandler');

console.log('=== RUNNING ADVANCED DM & INTERACTIVE DRAFT TEST SUITE ===\n');

// 1. Test Database Draft Operations
console.log('--- 1. Testing DB Draft CRUD Operations ---');
const testDraft = db.saveDraft({
  type: 'article',
  category: 'vps-management',
  title: 'NAT Port Forwarding Guide',
  slug: 'nat-port-forwarding-guide',
  content: '# NAT Port Forwarding\nFree users get 5 ports, paid users get 20 ports.',
  gapId: 'GAP-TEST',
  changesSummary: 'Initial draft for NAT port forwarding limits'
});

assert(testDraft.id.startsWith('DRAFT-'), 'Draft ID should start with DRAFT-');
assert.strictEqual(testDraft.status, 'pending', 'Draft status should be pending');
assert.strictEqual(testDraft.category, 'vps-management', 'Category should match');
console.log(`✅ Draft Created: ${testDraft.id}`);

const retrievedDraft = db.getDraft(testDraft.id);
assert.strictEqual(retrievedDraft.title, 'NAT Port Forwarding Guide', 'Retrieved draft should match title');

const pendingDrafts = db.listPendingDrafts();
assert(pendingDrafts.some(d => d.id === testDraft.id), 'Pending drafts list must contain the draft');
console.log(`✅ Pending Drafts Count: ${pendingDrafts.length}`);

// 2. Test Iterative Update of Draft
console.log('\n--- 2. Testing Iterative Draft Refinement ---');
const updatedDraft = db.saveDraft({
  id: testDraft.id,
  type: 'article',
  category: 'vps-management',
  title: 'NAT Port Forwarding Policy & Ranges',
  slug: 'nat-port-forwarding-policy-and-ranges',
  content: '# NAT Port Forwarding Policy\nFree: 5 ports. Paid: 50 ports. Port range: 10000-20000. Restart server after applying.',
  changesSummary: 'Updated paid port limit to 50 and added port range 10000-20000'
});

assert.strictEqual(updatedDraft.id, testDraft.id, 'Draft ID must remain identical on update');
assert.strictEqual(updatedDraft.title, 'NAT Port Forwarding Policy & Ranges', 'Draft title must update');
assert(updatedDraft.content.includes('10000-20000'), 'Draft content must contain new instructions');
console.log(`✅ Iterative Update Verified on [${updatedDraft.id}]: ${updatedDraft.changesSummary}`);

// 3. Test Knowledge Base Fuzzy Article Finder
console.log('\n--- 3. Testing knowledgeManager.findArticle ---');
const foundArticle = knowledgeManager.findArticle('dashboard-server-controls');
assert(foundArticle !== null, 'Should find existing article dashboard-server-controls');
assert.strictEqual(foundArticle.category, 'vps-management', 'Category should be vps-management');
console.log(`✅ Found Article by slug: "${foundArticle.title}" in category [${foundArticle.category}]`);

// 4. Test Button Interaction: Accept & Save Draft
console.log('\n--- 4. Testing Button Interaction (dm_accept_draft) ---');

// Mock pending question in DB to test gap resolution
db.savePendingQuestion('GAP-TEST', {
  topic: 'NAT Port Limits',
  question: 'What are the NAT port limits?',
  userQuery: 'How many ports can I open?'
});

let updatedMessage = null;
const mockInteraction = {
  customId: `dm_accept_draft_${testDraft.id}`,
  guild: null,
  user: { id: '123456789' },
  member: null,
  deferUpdate: async () => {},
  editReply: async (data) => {
    updatedMessage = data;
    return data;
  },
  reply: async (data) => {
    updatedMessage = data;
    return data;
  },
  followUp: async (data) => {
    updatedMessage = data;
    return data;
  }
};

(async () => {
  await handleButton(mockInteraction);

  assert(updatedMessage !== null, 'Button handler should produce an updated reply');
  assert(updatedMessage.content.includes('Successfully published'), 'Should confirm successful publication');

  const approvedDraft = db.getDraft(testDraft.id);
  assert.strictEqual(approvedDraft.status, 'approved', 'Draft status must be updated to approved');

  // Verify it exists in knowledge base
  const publishedDoc = knowledgeManager.getArticle('vps-management', 'nat-port-forwarding-policy-and-ranges');
  assert(publishedDoc !== null, 'Article must exist in knowledge-base articles folder');
  assert(publishedDoc.includes('10000-20000'), 'Published article must have updated content');
  console.log(`✅ Draft [${testDraft.id}] Successfully Approved & Saved to Disk!`);

  // Clean up test article
  knowledgeManager.deleteArticle('vps-management', 'nat-port-forwarding-policy-and-ranges');
  console.log('✅ Cleaned up test article');

  // 5. Test Button Interaction: Decline Draft
  console.log('\n--- 5. Testing Button Interaction (dm_decline_draft) ---');
  const declineDraft = db.saveDraft({
    type: 'lesson',
    key: 'Test Temporary Fact',
    fact: 'This fact will be declined.',
    changesSummary: 'Test fact draft'
  });

  let declineMessage = null;
  const mockDeclineInteraction = {
    customId: `dm_decline_draft_${declineDraft.id}`,
    guild: null,
    user: { id: '123456789' },
    member: null,
    update: async (data) => {
      declineMessage = data;
      return data;
    },
    reply: async (data) => {
      declineMessage = data;
      return data;
    }
  };

  await handleButton(mockDeclineInteraction);
  const rejectedDraft = db.getDraft(declineDraft.id);
  assert.strictEqual(rejectedDraft.status, 'rejected', 'Draft status must be rejected');
  console.log(`✅ Draft [${declineDraft.id}] Successfully Rejected & Discarded!`);

  console.log('\n🎉 ALL ADVANCED DM & INTERACTIVE DRAFT TESTS PASSED!');
})();
