/**
 * ChannelLock — Per-channel concurrency guard.
 *
 * Problem: A user sends 2 messages rapidly in the same ticket.
 * Without a guard, both trigger simultaneous AI calls → duplicate/garbled replies.
 *
 * Solution: For each channel, allow ONE active AI call at a time.
 * If a second message arrives while the first is still processing,
 * hold it as "pending" and run it immediately after the first finishes.
 * Only the LATEST pending message is kept (older ones are dropped — if someone
 * sends 5 messages in 2 seconds, only the last one matters).
 *
 * All 100+ channels run FULLY CONCURRENTLY — there is NO global cap.
 * Node.js async/await handles this natively; each awaited API call
 * releases the event loop so all other channels progress in parallel.
 *
 * Usage:
 *   const channelLock = require('./channelLock');
 *   await channelLock.run(channelId, async () => { ... });
 */

class ChannelLock {
  constructor() {
    this.active = new Set();   // channelIds currently processing
    this.pending = new Map();  // channelId -> { fn, resolve, reject }
  }

  run(channelId, fn) {
    if (!this.active.has(channelId)) {
      // Nothing running for this channel — start immediately
      return this._execute(channelId, fn);
    }

    // Already running — store as pending (replaces any previous pending for this channel)
    return new Promise((resolve, reject) => {
      this.pending.set(channelId, { fn, resolve, reject });
    });
  }

  async _execute(channelId, fn) {
    this.active.add(channelId);
    try {
      return await fn();
    } finally {
      this.active.delete(channelId);
      // If a message arrived while we were processing, run it now
      if (this.pending.has(channelId)) {
        const { fn: nextFn, resolve, reject } = this.pending.get(channelId);
        this.pending.delete(channelId);
        this._execute(channelId, nextFn).then(resolve, reject);
      }
    }
  }

  /** How many channels are currently processing */
  stats() {
    return {
      active: this.active.size,
      pending: this.pending.size
    };
  }
}

module.exports = new ChannelLock();
