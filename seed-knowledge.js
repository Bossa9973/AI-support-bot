const knowledgeManager = require('./src/ai/knowledgeManager');

console.log('Seeding initial Structured Articles and Lessons...');

// 1. Seed Lessons (Atomic Facts)
knowledgeManager.saveLesson(
  'Standard Support Hours',
  'AI assistance is active 24/7. Human staff review tickets Monday through Friday 9 AM to 6 PM EST.'
);
knowledgeManager.saveLesson(
  'Accepted Payment Methods',
  'Stripe, PayPal, Credit/Debit cards, and Cryptocurrencies (USDT, SOL, BTC, LTC, ETH).'
);
knowledgeManager.saveLesson(
  'Zero-Cost Reseller Cap',
  'Strictly capped at 30.00% markup over base price. System retains base cost and credits markup profit to reseller balance.'
);
knowledgeManager.saveLesson(
  'Reseller Minimum Withdrawal',
  'Minimum $10 USD equivalent in crypto (USDT: 10, SOL: 0.05, BTC: 0.0002, LTC: 0.15, ETH: 0.003).'
);
knowledgeManager.saveLesson(
  'Web Terminal 1-Click Repair',
  'Automated diagnostic toolbar button that fixes QEMU Guest Agent serial sockets and DNS host mappings in 30 seconds.'
);

// 2. Seed Articles (Deep Knowledge Docs)
knowledgeManager.saveArticle(
  'rewards-and-claims',
  'Community Reward Claims',
  `# Community Reward Claims & Bonus Credits

### How do users claim community rewards?
1. Open a support ticket using the **📩 Create Ticket** button on the support panel.
2. Provide your registered account email and proof of activity (e.g. invite screenshot, server booster status, or community event participation).
3. A support team member will verify your submission and credit the bonus reward directly to your dashboard balance or coin wallet within 24 hours.

### Reward Eligibility Rules
- Each Discord account can claim booster rewards once per active 30-day cycle.
- Rewards cannot be combined across duplicate accounts.`
);

knowledgeManager.saveArticle(
  'vps-management',
  'Dashboard & Server Controls',
  `# Vertex Panel: Dashboard & Server Management

### Navigating the Client Dashboard
- View all active, provisioning, and stopped VPS instances at \`/servers\`.
- Power controls include **Start**, **Stop** (ACPI graceful signal), **Reboot**, and force **Kill** (for unresponsive VMs).
- **Web Terminal**: Launches on-demand tmate SSH sessions over private NAT networks. If unresponsive, use the **1-Click Repair** button or switch to the **Console** tab for native noVNC frame buffer access.`
);

knowledgeManager.saveArticle(
  'billing-and-reseller',
  'Reseller Portal & Crypto Payment Links',
  `# Reseller Hub & Payment Links

### Reseller Models
- **Zero-Cost Model (\`zero_cost\`)**: Reseller applies up to 30.00% markup over system base price without owning node inventory.
- **Own Inventory Model (\`own_inventory\`)**: Reseller owns dedicated node capacity and sets arbitrary custom pricing with 100% payout.

### Generating Payment Links
- Create public checkout links at \`/pay/{uuid}\` bound to plan specs and target crypto (\`USDT\`, \`SOL\`, \`BTC\`, \`LTC\`, \`ETH\`).
- Automated VM provisioning triggers immediately upon blockchain payment confirmation.`
);

console.log('✅ Structured Articles and Lessons seeded successfully!');
