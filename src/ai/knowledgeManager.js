const fs = require('fs');
const path = require('path');

const kbRoot = path.join(__dirname, '../../knowledge-base');
const articlesDir = path.join(kbRoot, 'articles');
const lessonsFile = path.join(kbRoot, 'lessons/lessons.json');
const overridesFile = path.join(__dirname, '../../data/active_overrides.json');

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

  // Initialize lessons file if missing
  if (!fs.existsSync(lessonsFile)) {
    fs.writeFileSync(lessonsFile, JSON.stringify({}, null, 2), 'utf8');
  }

  // Initialize overrides file if missing
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
  saveArticle(category, title, content) {
    ensureDirs();
    const catSlug = sanitizeName(category) || 'general';
    const titleSlug = sanitizeName(title) || 'article';
    const catDir = path.join(articlesDir, catSlug);

    if (!fs.existsSync(catDir)) {
      fs.mkdirSync(catDir, { recursive: true });
    }

    const filePath = path.join(catDir, `${titleSlug}.md`);
    const fileData = `# Category: ${category.trim()}\n# Title: ${title.trim()}\n# Last Updated: ${new Date().toISOString()}\n\n${content.trim()}\n`;

    fs.writeFileSync(filePath, fileData, 'utf8');
    return {
      success: true,
      category: catSlug,
      title: title.trim(),
      slug: titleSlug,
      path: filePath
    };
  },

  listArticles() {
    ensureDirs();
    const categories = {};
    if (!fs.existsSync(articlesDir)) return categories;

    const catFolders = fs.readdirSync(articlesDir);
    for (const folder of catFolders) {
      const folderPath = path.join(articlesDir, folder);
      if (fs.statSync(folderPath).isDirectory()) {
        const files = fs.readdirSync(folderPath).filter((f) => f.endsWith('.md'));
        categories[folder] = files.map((f) => {
          const raw = fs.readFileSync(path.join(folderPath, f), 'utf8');
          const titleMatch = raw.match(/# Title:\s*(.*)/i);
          return {
            filename: f,
            slug: f.replace('.md', ''),
            title: titleMatch ? titleMatch[1].trim() : f.replace('.md', ''),
            preview: raw.slice(0, 150)
          };
        });
      }
    }
    return categories;
  },

  getArticle(category, titleOrSlug) {
    ensureDirs();
    const catSlug = sanitizeName(category);
    const slug = sanitizeName(titleOrSlug);
    const filePath = path.join(articlesDir, catSlug, `${slug}.md`);

    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
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
      return true;
    }
    return false;
  },

  // ==========================================
  // 2. LESSONS (Fast, Atomic Facts)
  // ==========================================
  getLessons() {
    ensureDirs();
    try {
      if (fs.existsSync(lessonsFile)) {
        return JSON.parse(fs.readFileSync(lessonsFile, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading lessons:', e);
    }
    return {};
  },

  saveLesson(key, fact) {
    ensureDirs();
    const lessons = this.getLessons();
    const cleanKey = key.trim();
    lessons[cleanKey] = {
      fact: fact.trim(),
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(lessonsFile, JSON.stringify(lessons, null, 2), 'utf8');
    return { key: cleanKey, fact: fact.trim() };
  },

  deleteLesson(key) {
    ensureDirs();
    const lessons = this.getLessons();
    if (lessons[key]) {
      delete lessons[key];
      fs.writeFileSync(lessonsFile, JSON.stringify(lessons, null, 2), 'utf8');
      return true;
    }
    return false;
  },

  // ==========================================
  // 3. BOSS OVERRIDES (High-Priority Directives)
  // ==========================================
  getOverrides() {
    ensureDirs();
    try {
      if (fs.existsSync(overridesFile)) {
        return JSON.parse(fs.readFileSync(overridesFile, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading overrides:', e);
    }
    return [];
  },

  addOverride(directive, reason = '') {
    ensureDirs();
    const overrides = this.getOverrides();
    const newOverride = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      directive: directive.trim(),
      reason: reason.trim(),
      createdAt: new Date().toISOString(),
      active: true
    };
    overrides.push(newOverride);
    fs.writeFileSync(overridesFile, JSON.stringify(overrides, null, 2), 'utf8');
    return newOverride;
  },

  removeOverride(idOrIndex) {
    ensureDirs();
    let overrides = this.getOverrides();
    const initialLen = overrides.length;

    // Filter by id or 1-based index
    overrides = overrides.filter((o, idx) => {
      if (o.id === idOrIndex) return false;
      if (String(idx + 1) === String(idOrIndex)) return false;
      return true;
    });

    if (overrides.length < initialLen) {
      fs.writeFileSync(overridesFile, JSON.stringify(overrides, null, 2), 'utf8');
      return true;
    }
    return false;
  },

  clearAllOverrides() {
    ensureDirs();
    fs.writeFileSync(overridesFile, JSON.stringify([], null, 2), 'utf8');
    return true;
  }
};
