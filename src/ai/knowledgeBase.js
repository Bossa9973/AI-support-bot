const fs = require('fs');
const path = require('path');
const knowledgeManager = require('./knowledgeManager');

const kbDir = path.join(__dirname, '../../knowledge-base');

/**
 * Compiles all active Boss Overrides, Lessons, Articles, and top-level KB docs into a structured context string.
 */
function getKnowledgeContext() {
  let context = '';

  // 1. ACTIVE BOSS OVERRIDES (HIGHEST PRIORITY)
  const overrides = knowledgeManager.getOverrides();
  if (overrides && overrides.length > 0) {
    context += `\n==================================================\n`;
    context += `🚨 ACTIVE BOSS DIRECTIVES (HIGHEST PRIORITY OVERRIDES):\n`;
    context += `The owner/boss has given these temporary real-time instructions. You MUST strictly obey these directives over any older defaults:\n`;
    overrides.forEach((o, i) => {
      context += `${i + 1}. [DIRECTIVE]: ${o.directive} ${o.reason ? `(Context: ${o.reason})` : ''}\n`;
    });
    context += `==================================================\n\n`;
  }

  // 2. FAST LESSONS (ATOMIC FACTS)
  const lessons = knowledgeManager.getLessons();
  const lessonKeys = Object.keys(lessons);
  if (lessonKeys.length > 0) {
    context += `\n--- 💡 FAST LESSONS & ATOMIC FACTS ---\n`;
    for (const key of lessonKeys) {
      context += `• ${key}: ${lessons[key].fact}\n`;
    }
    context += `--- END LESSONS ---\n\n`;
  }

  // 3. STRUCTURED ARTICLES (BY CATEGORY)
  const articlesByCategory = knowledgeManager.listArticles();
  const categories = Object.keys(articlesByCategory);
  if (categories.length > 0) {
    context += `\n--- 📖 KNOWLEDGE BASE ARTICLES ---\n`;
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

  // 4. TOP-LEVEL LEGACY / EXTRA MARKDOWN FILES
  try {
    const files = fs.readdirSync(kbDir);
    for (const file of files) {
      if (file.endsWith('.md') || file.endsWith('.txt')) {
        const filePath = path.join(kbDir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          const content = fs.readFileSync(filePath, 'utf8');
          context += `\n--- GENERAL DOC: ${file} ---\n${content.trim()}\n`;
        }
      }
    }
  } catch (err) {
    console.error('Error reading top-level KB docs:', err);
  }

  return context.trim() || 'No knowledge base loaded.';
}

module.exports = {
  loadKnowledgeBase: getKnowledgeContext,
  getKnowledgeContext
};
