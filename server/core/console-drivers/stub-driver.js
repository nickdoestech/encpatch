/**
 * StubDriver — placeholder for consoles that aren't implemented yet.
 *
 * Used for: Onyx, Avolites Titan, Hog 5, Chamsys MagicQ, Vista 3.
 *
 * The stub:
 *   - Logs a clear "not yet implemented" message instead of crashing
 *   - Reports its identity correctly (so the picker can still show it)
 *   - Returns false from every command so callers know nothing happened
 *
 * To replace a stub with a real driver:
 *   1. Create <name>-driver.js using EosDriver as a template
 *   2. Update REGISTRY in index.js to point at the new class
 *   3. Implement encoderTick / bankSelect / subPageNext / subPagePrev
 *      using the console's specific OSC dialect
 */

const ConsoleDriver = require('./console-driver');

class StubDriver extends ConsoleDriver {
  static get id()          { return 'stub'; }
  static get displayName() { return 'Unimplemented Console'; }
  static get macSupported(){ return false; }
  static get defaultPort() { return 0; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    this._meta = opts._stubMeta || {};
  }

  async connect() {
    const name = this._meta.displayName || 'this console';
    this.log(`${name} support is not implemented yet — driver inert`);
    this.log(`  See docs/CONSOLE_SUPPORT.md for the implementation plan.`);
    return false;
  }

  status() {
    return {
      ...super.status(),
      driver: this._meta.id || 'stub',
      displayName: this._meta.displayName || 'Stub',
      stub: true,
      reason: 'not implemented',
    };
  }

  encoderTick() { return false; }
  bankSelect()  { return false; }
  subPageNext() { return false; }
  subPagePrev() { return false; }
  cmd()         { return false; }
}

module.exports = StubDriver;
