const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const dbFile = path.join(dataDir, 'tickets.json');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initial DB state
let database = {
  counter: 0,
  tickets: {},          // channelId -> ticketData
  suggestions: {},      // suggestionId -> suggestion
  pendingQuestions: {}, // gapId -> question
  drafts: {},           // draftId -> draft
  happyHour: {          // happy hour event tracking
    active: null,
    claims: {},
    history: []
  }
};

// Load database from file
function loadDB() {
  try {
    if (fs.existsSync(dbFile)) {
      const data = fs.readFileSync(dbFile, 'utf8');
      database = JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading database:', err);
  }
  if (!database.tickets) database.tickets = {};
  if (!database.suggestions) database.suggestions = {};
  if (!database.drafts) database.drafts = {};
  if (!database.happyHour) database.happyHour = { active: null, scheduled: null, claims: {}, history: [] };
  if (database.happyHour.scheduled === undefined) database.happyHour.scheduled = null;
  if (!database.happyHour.claims) database.happyHour.claims = {};
  if (!database.happyHour.history) database.happyHour.history = [];
  saveDB();
}

// Save database to file
function saveDB() {
  try {
    fs.writeFileSync(dbFile, JSON.stringify(database, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving database:', err);
  }
}

loadDB();

module.exports = {
  getNextTicketNumber() {
    database.counter = (database.counter || 0) + 1;
    saveDB();
    return database.counter;
  },

  createTicket(channelId, data) {
    database.tickets[channelId] = {
      channelId,
      userId: data.userId,
      guildId: data.guildId,
      ticketNumber: data.ticketNumber,
      createdAt: new Date().toISOString(),
      status: 'open',
      claimedBy: null,
      ...data
    };
    saveDB();
    return database.tickets[channelId];
  },

  getTicket(channelId) {
    return database.tickets[channelId] || null;
  },

  getUserActiveTicket(userId, guildId) {
    return Object.values(database.tickets).find(
      (t) => t.userId === userId && t.guildId === guildId && t.status === 'open'
    );
  },

  updateTicket(channelId, updates) {
    if (database.tickets[channelId]) {
      database.tickets[channelId] = { ...database.tickets[channelId], ...updates };
      saveDB();
      return database.tickets[channelId];
    }
    return null;
  },

  closeTicket(channelId) {
    return this.updateTicket(channelId, { status: 'closed', closedAt: new Date().toISOString() });
  },

  deleteTicket(channelId) {
    if (database.tickets[channelId]) {
      delete database.tickets[channelId];
      saveDB();
      return true;
    }
    return false;
  },

  claimTicket(channelId, staffId) {
    return this.updateTicket(channelId, { claimedBy: staffId, claimedAt: new Date().toISOString() });
  },

  unclaimTicket(channelId) {
    return this.updateTicket(channelId, {
      claimedBy: null,
      continueWithAi: false,
      unclaimedAt: new Date().toISOString(),
      status: 'unclaimed'
    });
  },

  // ─── SELF-LEARNING SUGGESTIONS ──────────────────────────────────────────────

  saveSuggestion(suggestion) {
    if (!database.suggestions) database.suggestions = {};
    database.suggestions[suggestion.id] = suggestion;
    saveDB();
    return suggestion;
  },

  getSuggestion(id) {
    return (database.suggestions || {})[id] || null;
  },

  listPendingSuggestions() {
    return Object.values(database.suggestions || {}).filter(s => s.status === 'pending');
  },

  approveSuggestion(id) {
    if (database.suggestions && database.suggestions[id]) {
      database.suggestions[id].status = 'approved';
      database.suggestions[id].approvedAt = new Date().toISOString();
      saveDB();
      return database.suggestions[id];
    }
    return null;
  },

  rejectSuggestion(id) {
    if (database.suggestions && database.suggestions[id]) {
      database.suggestions[id].status = 'rejected';
      database.suggestions[id].rejectedAt = new Date().toISOString();
      saveDB();
      return database.suggestions[id];
    }
    return null;
  },

  // ─── PENDING OWNER KNOWLEDGE QUESTIONS ──────────────────────────────────────

  savePendingQuestion(id, data) {
    if (!database.pendingQuestions) database.pendingQuestions = {};
    database.pendingQuestions[id] = {
      id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...data
    };
    saveDB();
    return database.pendingQuestions[id];
  },

  listPendingQuestions() {
    return Object.values(database.pendingQuestions || {}).filter(q => q.status === 'pending');
  },

  resolvePendingQuestion(id, resolution = {}) {
    if (database.pendingQuestions && database.pendingQuestions[id]) {
      database.pendingQuestions[id].status = 'resolved';
      database.pendingQuestions[id].resolvedAt = new Date().toISOString();
      database.pendingQuestions[id].resolution = resolution;
      saveDB();
      return database.pendingQuestions[id];
    }
    return null;
  },

  // ─── INTERACTIVE DRAFTS (DM ITERATIVE COLLABORATION) ───────────────────────

  saveDraft(draft) {
    if (!database.drafts) database.drafts = {};
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let rand = '';
    for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
    const id = draft.id || `DRAFT-${rand}`;
    const now = new Date().toISOString();
    const existing = database.drafts[id] || {};

    database.drafts[id] = {
      ...existing,
      ...draft,
      id,
      status: draft.status || existing.status || 'pending',
      createdAt: existing.createdAt || now,
      updatedAt: now
    };
    saveDB();
    return database.drafts[id];
  },

  getDraft(id) {
    return (database.drafts || {})[id] || null;
  },

  getLatestPendingDraft() {
    const list = this.listPendingDrafts();
    if (list.length === 0) return null;
    return list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
  },

  listPendingDrafts() {
    return Object.values(database.drafts || {}).filter((d) => d.status === 'pending');
  },

  approveDraft(id) {
    if (database.drafts && database.drafts[id]) {
      database.drafts[id].status = 'approved';
      database.drafts[id].approvedAt = new Date().toISOString();
      saveDB();
      return database.drafts[id];
    }
    return null;
  },

  rejectDraft(id) {
    if (database.drafts && database.drafts[id]) {
      database.drafts[id].status = 'rejected';
      database.drafts[id].rejectedAt = new Date().toISOString();
      saveDB();
      return database.drafts[id];
    }
    return null;
  },

  // ───────────────────────────────────────────────
  // HAPPY HOUR EVENT SYSTEM
  // ───────────────────────────────────────────────

  /** Store a new active happy hour event. */
  setHappyHourEvent(event) {
    if (!database.happyHour) database.happyHour = { active: null, claims: {}, history: [] };
    database.happyHour.active = event ? { ...event, startedAt: new Date().toISOString() } : null;
    saveDB();
    return database.happyHour.active;
  },

  /** Get current active event or null. */
  getHappyHourEvent() {
    return (database.happyHour || {}).active || null;
  },

  /**
   * Reserve a claim slot for a user.
   * Returns { ok: true } or { ok: false, reason }
   */
  addHappyHourClaim(eventId, userId) {
    const event = this.getHappyHourEvent();
    if (!event || event.id !== eventId) return { ok: false, reason: 'Event no longer active.' };
    if (event.expired) return { ok: false, reason: 'This Happy Hour has ended.' };
    if (!database.happyHour.claims[eventId]) database.happyHour.claims[eventId] = [];
    const claims = database.happyHour.claims[eventId];
    if (claims.includes(userId)) return { ok: false, reason: 'You already claimed this event!' };
    if (claims.length >= event.slots) return { ok: false, reason: 'All claim slots are taken!' };
    claims.push(userId);
    database.happyHour.active.claimed = claims.length;
    saveDB();
    return { ok: true, claimed: claims.length, total: event.slots };
  },

  /** Get list of user IDs who claimed a specific event. */
  getHappyHourClaims(eventId) {
    return (database.happyHour.claims || {})[eventId] || [];
  },

  /** Mark active event expired and archive it to history. */
  expireHappyHourEvent() {
    if (!database.happyHour || !database.happyHour.active) return;
    database.happyHour.active.expired = true;
    database.happyHour.active.expiredAt = new Date().toISOString();
    database.happyHour.history.unshift({ ...database.happyHour.active });
    if (database.happyHour.history.length > 20) database.happyHour.history.length = 20;
    database.happyHour.active = null;
    saveDB();
  },

  /** Get last N archived happy hour events. */
  getHappyHourHistory(limit = 10) {
    return (database.happyHour.history || []).slice(0, limit);
  },

  /** Save a scheduled happy hour event to fire in the future. */
  setScheduledHappyHour(scheduledData) {
    if (!database.happyHour) database.happyHour = { active: null, scheduled: null, claims: {}, history: [] };
    database.happyHour.scheduled = scheduledData;
    saveDB();
    return database.happyHour.scheduled;
  },

  /** Get upcoming scheduled event or null. */
  getScheduledHappyHour() {
    return (database.happyHour || {}).scheduled || null;
  },

  /** Clear scheduled event. */
  clearScheduledHappyHour() {
    if (!database.happyHour) database.happyHour = { active: null, scheduled: null, claims: {}, history: [] };
    database.happyHour.scheduled = null;
    saveDB();
  }
};
