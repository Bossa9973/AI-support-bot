# 🎫 Discord AI Support Bot (Ticket Tool Style + OpenRouter OX Alpha)

An enterprise-ready Discord support ticketing bot inspired by **Ticket Tool**, integrated with **OpenRouter AI (`stealth/ox-alpha`)**, **3-Tier Priority Escalation**, **Owner DM Live Training**, and a **Structured Knowledge Library (Articles & Lessons)**.

---

## 👑 Owner DM Training & Executive Control

When you direct message (DM) the bot from your Discord account (`OWNER_ID` in `.env`), the bot recognizes you as the boss, respects your authority, and allows you to dynamically manage its knowledge, hotpatch rules, and train it on-the-fly:

### 1. 🚨 Live Overrides & Hotfixes (Top Priority)
Tell the bot real-time temporary instructions in plain English:
> *"Hey, Feature A does not work as intended right now, tell users to use the console instead. I will tell you when it's resolved."*
- The bot logs this into `active_overrides.json` and immediately prioritizes this directive over standard defaults in all ticket channels!
- Clear it anytime: *"Clear override 1"* or *"Clear all overrides"*.

### 2. 💡 Lessons (Fast Atomic Facts)
Quick, runnable facts and rules (e.g. pricing, node specs, locations):
> *"Add lesson: We have 3 plans: Basic ($5/mo, 2GB RAM), Pro ($15/mo, 6GB RAM), and Ultra ($30/mo, 16GB RAM)."*
- Instant retrieval and high-priority context weighting in tickets.

### 3. 📖 Articles (Comprehensive Structured Docs)
Deep multi-paragraph guides organized by category:
> *"Create article in category 'rewards-and-claims' titled 'Community Rewards' with content: Users must submit their invite links and order ID to receive bonus credits within 24 hours."*
- Full catalog view: *"List articles"*, *"Show me what you know"*.

---

## 🚦 3-Tier AI Priority System

When the AI determines that human staff intervention is needed, it evaluates severity dynamically using an LLM reasoning compass:

| Priority Tier | Color & Badge | Criteria & Scenarios | Embed Action & Alert |
|---|---|---|---|
| 🔴 **RED (Critical Emergency)** | `#ED4245` **Red** | Complete server/node downtime, active data loss, compromised VPS / security breach, cloud-init disk corruption | Urgent `@SupportRole` banner, glowing red embed, **"Claim Emergency Ticket"** button |
| 🟡 **YELLOW (Elevated)** | `#FEE75C` **Yellow** | Functional deployment blockers, unconfirmed crypto TxIDs, reseller ledger hurdles, performance slowdowns | Yellow alert embed, summary, **"Claim Ticket"** button |
| 🟢 **GREEN (Standard)** | `#57F287` **Green** | Routine refund/cancellation inquiries, cosmetic UI questions, small VPS setup tasks | Standard green embed, summary, **"Claim Ticket"** button |

---

## 📁 Structured Knowledge Base Hierarchy

```
knowledge-base/
├── articles/                        # 📖 Comprehensive in-depth documentation
│   ├── billing-and-reseller/        # Categorized folders
│   │   └── reseller-portal-guide.md
│   ├── rewards-and-claims/
│   │   └── community-reward-claims.md
│   └── vps-management/
│       └── dashboard-and-server-controls.md
├── lessons/                         # 💡 Fast, runnable atomic facts
│   └── lessons.json
└── (general .md files)              # General documentation & policies
```

---

## 🚀 Quick Setup

1. Configure [`.env`](file:///root/AI%20support%20bot/.env):
   ```env
   DISCORD_TOKEN=your_token
   CLIENT_ID=your_client_id
   GUILD_ID=your_guild_id
   OWNER_ID=your_personal_discord_id  # 👈 Enables Boss DMs
   OPENROUTER_API_KEY=your_key
   OPENROUTER_MODEL=stealth/ox-alpha
   SUPPORT_ROLE_ID=your_role_id
   ```
2. Start the bot:
   ```bash
   npm start
   ```
3. Send a DM to the bot from your owner account to test live executive commands or type `!help`!
