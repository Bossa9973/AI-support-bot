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
  tickets: {},       // channelId -> ticketData
  suggestions: {}    // suggestionId -> suggestion
};

// Load database from file
function loadDB() {
  try {
    if (fs.existsSync(dbFile)) {
      const data = fs.readFileSync(dbFile, 'utf8');
      database = JSON.parse(data);
    } else {
      saveDB();
    }
  } catch (err) {
    console.error('Error loading database:', err);
  }
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
  }
};
