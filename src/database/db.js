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
  tickets: {} // channelId -> ticketData
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
  }
};
