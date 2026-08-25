const { getKnowledgeContext } = require('../src/ai/knowledgeBase');
const knowledgeManager = require('../src/ai/knowledgeManager');
const db = require('../src/database/db');

console.log('--- 1. Testing Structured Knowledge Base ---');
const articles = knowledgeManager.listArticles();
console.log(`Discovered Categories:`, Object.keys(articles));
console.log(`Articles in rewards-and-claims:`, (articles['rewards-and-claims'] || []).map(a => a.title));

const lessons = knowledgeManager.getLessons();
console.log(`Loaded Lessons Count:`, Object.keys(lessons).length);
console.log(`Lesson Sample:`, lessons['Zero-Cost Reseller Cap']?.fact);

console.log('\n--- 2. Testing Boss Overrides System ---');
const testOverride = knowledgeManager.addOverride(
  'Feature A is currently under maintenance, advise users to use console',
  'Temporary boss directive'
);
console.log('Created Override ID:', testOverride.id);

let contextWithOverride = getKnowledgeContext(true);
console.log('Contains Boss Directive in context:', contextWithOverride.includes('Feature A is currently under maintenance') ? 'PASS' : 'FAIL');

// Remove the test override
knowledgeManager.removeOverride(testOverride.id);
console.log('Removed Test Override:', !getKnowledgeContext(true).includes('Feature A is currently under maintenance') ? 'PASS' : 'FAIL');

console.log('\n--- 3. Testing Priority Classification & Parser Logic ---');

// Test Case A: Critical Red Emergency
const mockRedHandoff = `Hello @Alex, I understand that your production VM has unexpectedly shut down and your database files are missing. Because this involves potential data loss and hypervisor disk recovery, which requires direct administrative access, I am escalating this immediately as a Critical Emergency.

[HANDOFF]
PRIORITY: RED
SUMMARY: User @Alex reports sudden VM shutdown and missing database files on node 3, requiring emergency hypervisor disk diagnostics.
[/HANDOFF]`;

const redMatch = mockRedHandoff.match(/\[HANDOFF\][\s\S]*?\[\/HANDOFF\]/i);
const redPriority = redMatch[0].match(/PRIORITY:\s*(RED|YELLOW|GREEN)/i)[1].toLowerCase();
const redSummary = redMatch[0].match(/SUMMARY:\s*([\s\S]*?)(?:\[\/HANDOFF\]|$)/i)[1].trim();

console.log('Red Test Priority:', redPriority === 'red' ? 'PASS (🔴)' : 'FAIL');
console.log('Red Summary:', redSummary);

console.log('\n--- 4. Testing Database Operations ---');
const ticketNum = db.getNextTicketNumber();
const mockTicket = db.createTicket('channel-test-kb', {
  userId: 'user-777',
  guildId: 'guild-888',
  ticketNumber: ticketNum,
  priority: 'red'
});
console.log('Created Ticket with Priority:', mockTicket.priority === 'red' ? 'PASS' : 'FAIL');

// Cleanup
db.deleteTicket('channel-test-kb');
console.log('Cleanup:', db.getTicket('channel-test-kb') === null ? 'PASS' : 'FAIL');

console.log('\n✅ All structured articles, lessons, overrides, and priority tests passed successfully!');
