const fs = require('fs');
const path = require('path');

const kbRoot = path.join(__dirname, '../../knowledge-base');
const articlesDir = path.join(kbRoot, 'articles');
const lessonsFile = path.join(kbRoot, 'lessons/lessons.json');
const overridesFile = path.join(__dirname, '../../data/active_overrides.json');

// ─── IN-MEMORY CACHES FOR ZERO-DISK LATENCY ──────────────────────────────────
let _cachedArticleList = null;
let _cachedArticlesContent = new Map(); // "cat/slug" -> content
let _cachedLessons = null;
let _cachedOverrides = null;

function invalidateMemoryCaches() {
  _cachedArticleList = null;
  _cachedArticlesContent.clear();
  _cachedLessons = null;
  _cachedOverrides = null;
}

// Ensure directories exist
function ensureDirs() {
  const dirs = [
    kbRoot,
    articlesDir,
    path.join(kbRoot, 'lessons'),
    path.join(__dirname, '../../data')
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  if (!fs.existsSync(lessonsFile)) {
    fs.writeFileSync(lessonsFile, JSON.stringify({}, null, 2), 'utf8');
  }

  if (!fs.existsSync(overridesFile)) {
    fs.writeFileSync(overridesFile, JSON.stringify([], null, 2), 'utf8');
  }
}

ensureDirs();

function sanitizeName(str) {
  return str.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').trim();
}

module.exports = {
  // ==========================================
  // 1. ARTICLES (Deep, Structured Documents)
  // ==========================================
  saveArticle(category, title, content, customSlug = null) {
    ensureDirs();
    const catSlug = sanitizeName(category) || 'general';
    const titleSlug = sanitizeName(customSlug || title) || 'article';
    const catDir = path.join(articlesDir, catSlug);

    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }

    const filePath = path.join(catDir, `${titleSlug}.md`);
    const fileData = `# Category: ${category.trim()}\n# Title: ${title.trim()}\n# Last Updated: ${new Date().toISOString()}\n\n${content.trim()}\n`;

    fs.writeFileSync(filePath, fileData, 'utf8');
    invalidateMemoryCaches();

    return {
      success: true,
      category: catSlug,
      title: title.trim(),
      slug: titleSlug,
      path: filePath
    };
  },

  listArticles() {
    if (_cachedArticleList) return _cachedArticleList;

    ensureDirs();
    const categories = {};
    if (!fs.existsSync(articlesDir)) return categories;

    try {
      const catFolders = fs.readdirSync(articlesDir);
      for (const folder of catFolders) {
        const folderPath = path.join(articlesDir, folder);
        if (fs.statSync(folderPath).isDirectory()) {
          const files = fs.readdirSync(folderPath).filter((f) => f.endsWith('.md'));
          categories[folder] = files.map((f) => {
            const filePath = path.join(folderPath, f);
            const raw = fs.readFileSync(filePath, 'utf8');
            const titleMatch = raw.match(/# Title:\s*(.*)/i);
            const slug = f.replace('.md', '');
            _cachedArticlesContent.set(`${folder}/${slug}`, raw);

            return {
              filename: f,
              slug,
              title: titleMatch ? titleMatch[1].trim() : slug,
              preview: raw.slice(0, 150)
            };
          });
        }
      }
      _cachedArticleList = categories;
    } catch (err) {
      console.error('Error listing articles:', err);
    }
    return categories;
  },

  getArticle(category, titleOrSlug) {
    const catSlug = sanitizeName(category);
    const slug = sanitizeName(titleOrSlug);
    const cacheKey = `${catSlug}/${slug}`;

    if (_cachedArticlesContent.has(cacheKey)) {
      return _cachedArticlesContent.get(cacheKey);
    }

    ensureDirs();
    const filePath = path.join(articlesDir, catSlug, `${slug}.md`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      _cachedArticlesContent.set(cacheKey, content);
      return content;
    }
    return null;
  },

  deleteArticle(category, titleOrSlug) {
    ensureDirs();
    const catSlug = sanitizeName(category);
    const slug = sanitizeName(titleOrSlug);
    const filePath = path.join(articlesDir, catSlug, `${slug}.md`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      invalidateMemoryCaches();
      return true;
    }
    return false;
  },

  findArticle(queryOrSlug) {
    if (!queryOrSlug) return null;
    const cleanQuery = sanitizeName(queryOrSlug);
    const articles = this.listArticles();
    for (const [cat, list] of Object.entries(articles)) {
      for (const item of list) {
        if (item.slug === cleanQuery || sanitizeName(item.title) === cleanQuery || item.slug.includes(cleanQuery) || cleanQuery.includes(item.slug)) {
          const content = this.getArticle(cat, item.slug);
          return {
            category: cat,
            slug: item.slug,
            title: item.title,
            content
          };
        }
      }
    }
    return null;
  },

  // ==========================================
  // 2. LESSONS (Fast, Atomic Facts)
  // ==========================================
  saveLesson(key, fact) {
    ensureDirs();
    const lessons = this.getLessons();
    lessons[key.trim()] = {
      fact: fact.trim(),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(lessonsFile, JSON.stringify(lessons, null, 2), 'utf8');
    _cachedLessons = lessons;
    return { success: true, key: key.trim(), fact: fact.trim() };
  },

  getLessons() {
    if (_cachedLessons) return _cachedLessons;
    ensureDirs();
    try {
      const raw = fs.readFileSync(lessonsFile, 'utf8');
      _cachedLessons = JSON.parse(raw);
      return _cachedLessons;
    } catch {
      return {};
    }
  },

  deleteLesson(key) {
    ensureDirs();
    const lessons = this.getLessons();
    const cleanKey = key.trim();
    if (lessons[cleanKey]) {
      delete lessons[cleanKey];
      fs.writeFileSync(lessonsFile, JSON.stringify(lessons, null, 2), 'utf8');
      _cachedLessons = lessons;
      return true;
    }
    return false;
  },

  // ==========================================
  // 3. OVERRIDES (Temporary Real-Time Status)
  // ==========================================
  setOverride(directive, reason = '') {
    ensureDirs();
    const overrides = this.getOverrides();
    const newEntry = {
      id: Date.now().toString(36),
      directive: directive.trim(),
      reason: reason.trim(),
      createdAt: new Date().toISOString()
    };
    overrides.push(newEntry);
    fs.writeFileSync(overridesFile, JSON.stringify(overrides, null, 2), 'utf8');
    _cachedOverrides = overrides;
    return newEntry;
  },

  addOverride(directive, reason = '') {
    return this.setOverride(directive, reason);
  },

  getOverrides() {
    if (_cachedOverrides) return _cachedOverrides;
    ensureDirs();
    try {
      const raw = fs.readFileSync(overridesFile, 'utf8');
      _cachedOverrides = JSON.parse(raw);
      return _cachedOverrides;
    } catch {
      return [];
    }
  },

  removeOverride(idOrIndex) {
    ensureDirs();
    let overrides = this.getOverrides();
    const beforeCount = overrides.length;

    if (typeof idOrIndex === 'number' || !isNaN(parseInt(idOrIndex, 10))) {
      const idx = parseInt(idOrIndex, 10) - 1;
      if (idx >= 0 && idx < overrides.length) {
        overrides.splice(idx, 1);
      }
    } else {
      overrides = overrides.filter((o) => o.id !== idOrIndex);
    }

    if (overrides.length !== beforeCount) {
      fs.writeFileSync(overridesFile, JSON.stringify(overrides, null, 2), 'utf8');
      _cachedOverrides = overrides;
      return true;
    }
    return false;
  },

  clearOverrides() {
    ensureDirs();
    fs.writeFileSync(overridesFile, JSON.stringify([], null, 2), 'utf8');
    _cachedOverrides = [];
    return true;
  }
};
