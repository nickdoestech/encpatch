/**
 * Diagnostics — persistent event logging for crash/reconnect troubleshooting.
 *
 * Tracks:
 *   - Connection events (connect/disconnect)
 *   - Errors and crashes
 *   - Recovery events
 *
 * Stores in-memory with a fixed max size (max 500 events) to prevent
 * unbounded memory growth. Older events are dropped when limit exceeded.
 */

class Diagnostics {
  constructor(opts = {}) {
    this.maxEvents = opts.maxEvents ?? 500;
    this.events = [];
  }

  /**
   * Log an event to the diagnostics buffer.
   * @param {string} transport - transport name (osc, ma3lua, sdhid, etc.)
   * @param {string} type - event type (connect, disconnect, error, recover, etc.)
   * @param {object} details - optional event details
   */
  log(transport, type, details = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      transport,
      type,
      details,
    };
    this.events.push(event);

    // Keep only the most recent maxEvents
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Get recent events, optionally filtered by transport.
   * @param {string} transport - optional: filter by transport name
   * @param {number} limit - optional: max events to return (default: all)
   * @returns {array} events
   */
  getEvents(transport = null, limit = null) {
    let result = this.events;
    if (transport) {
      result = result.filter((e) => e.transport === transport);
    }
    if (limit && limit > 0) {
      result = result.slice(-limit);
    }
    return result;
  }

  /**
   * Get a summary of recent connection status for each transport.
   * @returns {object} { transport: { lastEvent, status, count } }
   */
  getStatusSummary() {
    const summary = {};
    for (const event of this.events) {
      if (!summary[event.transport]) {
        summary[event.transport] = { lastEvent: null, status: 'unknown', count: 0 };
      }
      summary[event.transport].lastEvent = event.timestamp;
      if (event.type === 'connect') summary[event.transport].status = 'connected';
      else if (event.type === 'disconnect') summary[event.transport].status = 'disconnected';
      else if (event.type === 'error' || event.type === 'crash') summary[event.transport].status = 'error';
      summary[event.transport].count++;
    }
    return summary;
  }

  /**
   * Clear all diagnostic events.
   */
  clear() {
    this.events = [];
  }
}

module.exports = Diagnostics;
