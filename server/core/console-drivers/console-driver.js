/**
 * ConsoleDriver — abstract base for all lighting console integrations.
 *
 * Each subclass adapts ENCpatch's canonical commands (encoderTick,
 * bankSelect, subPageNext/Prev, cmd) to the wire format that specific
 * console understands. The engine talks ONLY to the driver interface —
 * no MA3-specific assumptions in calling code.
 *
 * To add a new console:
 *   1. Create server/core/console-drivers/<name>-driver.js
 *   2. Subclass ConsoleDriver, implement the methods marked as
 *      "MUST OVERRIDE" below.
 *   3. Register it in console-drivers/index.js
 *   4. Add detection signature so auto-detect can find it.
 */

const EventEmitter = require('events');

class ConsoleDriver extends EventEmitter {
  /**
   * @param {object} opts  console-specific options (host, port, token, etc.)
   * @param {object} hooks { log: fn }
   */
  constructor(opts = {}, hooks = {}) {
    super();
    this.opts = opts;
    this.log = hooks.log || (() => {});
    this.connected = false;
    this.consoleVersion = null;
  }

  // ─── Identity ──────────────────────────────────────────────────────
  /** Short ID — must be lowercase, used in config.console field */
  static get id() { return 'abstract'; }
  /** Human-readable name shown in UI */
  static get displayName() { return 'Abstract Console'; }
  /** Whether the console software runs natively on macOS */
  static get macSupported() { return true; }
  /** Default network port for OSC/bridge communication */
  static get defaultPort() { return 0; }

  // ─── Lifecycle (MUST OVERRIDE) ─────────────────────────────────────

  /** Open transport. Resolves true on success, false on failure. */
  // eslint-disable-next-line no-unused-vars
  async connect() {
    throw new Error(`${this.constructor.name}.connect() not implemented`);
  }

  async disconnect() {
    this.connected = false;
  }

  // ─── Status (MAY OVERRIDE) ─────────────────────────────────────────

  status() {
    return {
      driver: this.constructor.id,
      connected: !!this.connected,
      consoleVersion: this.consoleVersion,
      host: this.opts.host || null,
      port: this.opts.port || null,
    };
  }

  // ─── Commands (MUST OVERRIDE — the actual control surface) ────────

  /** Apply a relative encoder tick to slot N of the current encoder bar. */
  // eslint-disable-next-line no-unused-vars
  encoderTick(slotIdx, attrName, deltaPercent) {
    throw new Error(`${this.constructor.name}.encoderTick() not implemented`);
  }

  /** Switch the encoder bar to bank N (1-based). bankName provided as hint. */
  // eslint-disable-next-line no-unused-vars
  bankSelect(bankIdx, bankName) {
    throw new Error(`${this.constructor.name}.bankSelect() not implemented`);
  }

  /** Advance to next sub-page within the current encoder bank. */
  subPageNext() {
    throw new Error(`${this.constructor.name}.subPageNext() not implemented`);
  }

  /** Step back to previous sub-page within the current encoder bank. */
  subPagePrev() {
    throw new Error(`${this.constructor.name}.subPagePrev() not implemented`);
  }

  /** Raw command-line passthrough — for when the user wants to send
   *  something we don't have a canonical method for. */
  // eslint-disable-next-line no-unused-vars
  cmd(rawText) {
    throw new Error(`${this.constructor.name}.cmd() not implemented`);
  }

  // ─── Feedback (MAY OVERRIDE — emit events when console reports) ───
  //
  // Drivers SHOULD emit these events when they have a way to know:
  //   this.emit('encoderBar', { feature: 'Position', slots: ['Pan', 'Tilt', null, null] })
  //   this.emit('selection',  { count: 8, fixtures: [...] })
  //   this.emit('error',      err)
  //
  // The engine subscribes to update the LCD + UI without polling.
}

module.exports = ConsoleDriver;
