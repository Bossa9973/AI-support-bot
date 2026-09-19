const knowledgeManager = require('./knowledgeManager');
const fs = require('fs');
const path = require('path');

const kbDir = path.join(__dirname, '../../knowledge-base');

// ─── CACHE ───────────────────────────────────────────────────────────────────
let _cachedLegacyDocs = null;
let _cachedFullContext = null;
let _fullContextTime = 0;
const FULL_CONTEXT_TTL = 60_000;

function getCachedLegacyDocs() {
  if (_cachedLegacyDocs !== null) return _cachedLegacyDocs;
  let docs = '';
  try {
    if (fs.existsSync(kbDir)) {
      const files = fs.readdirSync(kbDir);
      for (const file of files) {
        if (file.endsWith('.md') || file.endsWith('.txt')) {
          const filePath = path.join(kbDir, file);
          const stats = fs.statSync(filePath);
          if (stats.isFile() && stats.size < 3072) {
            const content = fs.readFileSync(filePath, 'utf8');
            docs += `\n--- GENERAL DOC: ${file} ---\n${content.trim()}\n`;
          }
        }
      }
    }
  } catch (err) {
    console.error('Error reading legacy KB docs:', err);
  }
  _cachedLegacyDocs = docs;
  return docs;
}

// ─── KEYWORD EXTRACTION ───────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could',
  'should','may','might','can','shall','to','of','in','for',
  'on','with','at','by','from','as','or','and','but','not',
  'what','how','why','when','where','who','my','your','i',
  'it','its','this','that','they','we','me','him','her','us'
]);

function extractKeywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function scoreArticle(articleContent, keywords) {
  if (!articleContent || keywords.length === 0) return 0;
  const lower = articleContent.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    let pos = 0;
    while ((pos = lower.indexOf(kw, pos)) !== -1) {
      score++;
      pos += kw.length;
    }
  }
  return score;
}

function invalidateContextCache() {
  _cachedFullContext = null;
  _fullContextTime = 0;
  _cachedLegacyDocs = null;
}

/**
 * Returns the full compiled knowledge context (cached, rebuilt max once/minute).
 */
function getKnowledgeContext(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _cachedFullContext && now - _fullContextTime < FULL_CONTEXT_TTL) {
    return _cachedFullContext;
  }

  let context = '';

  // 1. Overrides
  const overrides = knowledgeManager.getOverrides();
  if (overrides && overrides.length > 0) {
    context += `🚨 ACTIVE BOSS DIRECTIVES (HIGHEST PRIORITY):\n`;
    overrides.forEach((o, i) => {
      context += `${i + 1}. [DIRECTIVE]: ${o.directive}${o.reason ? ` (Context: ${o.reason})` : ''}\n`;
    });
    context += `\n`;
  }

  // 2. Lessons
  const lessons = knowledgeManager.getLessons();
  const lessonKeys = Object.keys(lessons);
  if (lessonKeys.length > 0) {
    context += `--- FAST LESSONS ---\n`;
    for (const key of lessonKeys) {
      context += `• ${key}: ${lessons[key].fact}\n`;
    }
    context += `--- END LESSONS ---\n\n`;
  }

  // 3. Articles
  const articlesByCategory = knowledgeManager.listArticles();
  const categories = Object.keys(articlesByCategory);
  if (categories.length > 0) {
    context += `--- KNOWLEDGE BASE ARTICLES ---\n`;
    for (const cat of categories) {
      context += `\n[CATEGORY: ${cat.toUpperCase()}]\n`;
      for (const art of articlesByCategory[cat]) {
        const fullContent = knowledgeManager.getArticle(cat, art.slug);
        if (fullContent) {
          context += `\n--- ARTICLE: ${art.title} ---\n${fullContent.trim()}\n`;
        }
      }
    }
    context += `\n--- END ARTICLES ---\n\n`;
  }

  // 4. Legacy docs
  context += getCachedLegacyDocs();

  _cachedFullContext = context.trim() || 'No knowledge base loaded.';
  _fullContextTime = now;
  return _cachedFullContext;
}

const TICKET_CATEGORY_FOLDER_MAPPING = {
  purchase_vps: ['vps-plans', 'vps-billing', 'billing-and-reseller', 'reseller-program', 'hosting-features'],
  account_issue: ['dashboard-maintenance', 'vps-management', 'admin-operations'],
  report_bug: ['known-issues', 'dashboard-maintenance', 'vps-management', 'admin-operations'],
  technical_questions: ['vps-management', 'hosting-features', 'known-issues', 'discord-bots'],
  general_support: ['vps-management', 'dashboard-maintenance', 'vps-plans', 'hosting-features'],
  general_question: ['hosting-features', 'service-quality', 'vps-plans', 'giveaway-rules'],
  claim_giveaway: ['rewards-and-claims', 'reward-claiming', 'giveaway-rules', 'boost-rewards', 'bolts-rewards', 'invites']
};

/**
 * Returns a fast, focused knowledge context (top articles prioritized by query & ticket category).
 */
function getFocusedKnowledgeContext(query = '', maxArticles = 5, ticketCategory = '') {
  const keywords = extractKeywords(query);
  const preferredFolders = TICKET_CATEGORY_FOLDER_MAPPING[ticketCategory] || [];
  let context = '';

  // 1. Overrides
  const overrides = knowledgeManager.getOverrides();
  if (overrides && overrides.length > 0) {
    context += `🚨 ACTIVE DIRECTIVES:\n`;
    overrides.forEach((o, i) => {
      context += `${i + 1}. ${o.directive}\n`;
    });
    context += `\n`;
  }

  // 2. Lessons
  const lessons = knowledgeManager.getLessons();
  const lessonKeys = Object.keys(lessons);
  if (lessonKeys.length > 0) {
    context += `--- FAST LESSONS & ATOMIC FACTS ---\n`;
    for (const key of lessonKeys) {
      context += `• ${key}: ${lessons[key].fact}\n`;
    }
    context += `--- END LESSONS ---\n\n`;
  }

  // 3. Score and select top articles with category-affinity boosting
  const articlesByCategory = knowledgeManager.listArticles();
  const scoredArticles = [];

  for (const cat of Object.keys(articlesByCategory)) {
    const isPreferredCategory = preferredFolders.includes(cat);
    const categoryBoost = isPreferredCategory ? 4 : 0;

    for (const art of articlesByCategory[cat]) {
      const content = knowledgeManager.getArticle(cat, art.slug);
      if (!content) continue;
      const baseScore = keywords.length > 0 ? scoreArticle(content, keywords) : 1;
      const finalScore = baseScore + categoryBoost;

      if (finalScore > 0) {
        scoredArticles.push({ cat, art, content, score: finalScore });
      }
    }
  }

  scoredArticles.sort((a, b) => b.score - a.score);
  const selected = scoredArticles.slice(0, maxArticles);

  if (selected.length > 0) {
    context += `--- RELEVANT KNOWLEDGE ARTICLES ---\n`;
    for (const { cat, art, content } of selected) {
      const trimmed = content.trim();
      const snippet = trimmed.length > 1500 ? trimmed.slice(0, 1500) + '\n...' : trimmed;
      context += `\n[CATEGORY: ${cat.toUpperCase()}] ${art.title}\n${snippet}\n`;
    }
    context += `--- END ARTICLES ---\n\n`;
  }

  return context.trim();
}

module.exports = {
  getKnowledgeContext,
  getFocusedKnowledgeContext,
  invalidateContextCache,
  TICKET_CATEGORY_FOLDER_MAPPING
};
