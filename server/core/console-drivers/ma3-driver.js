/**
 * Ma3Driver — grandMA3 onPC adapter via the Lua bridge plugin.
 *
 * Wraps the existing Ma3LuaClient so the engine can talk to it through
 * the canonical ConsoleDriver interface. No functional change for MA3
 * users — this is purely the abstraction boundary.
 *
 * Wire details (verified on MA3 onPC 2.3.x):
 *   - encoderTick → bridge `tick` action → `Cmd("Attribute X At + N")`
 *   - bankSelect  → `Cmd("Select EncoderBank N")` via OSC /cmd
 *   - subPageNext/Prev → `Cmd("EncoderPage +/-")` via OSC /cmd
 *
 * The bridge gives us live encoder bar reading via `getEncoderBar`,
 * which we surface through the 'encoderBar' event so the engine /
 * renderer don't need to poll directly.
 */

const ConsoleDriver = require('./console-driver');
const Ma3LuaClient = require('../ma3lua-client');

class Ma3Driver extends ConsoleDriver {
  static get id()          { return 'ma3'; }
  static get displayName() { return 'grandMA3 onPC'; }
  static get macSupported(){ return true; }
  static get defaultPort() { return 9001; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    // If server.js passes an already-instantiated Ma3LuaClient (the
    // common path — server has its own ma3lua transport for legacy
    // page-binder hooks), reuse it. Avoids double-connect on port 9001.
    if (opts.existingClient) {
      this._lua = opts.existingClient;
      this._ownsClient = false;
    } else {
      this._lua = new Ma3LuaClient(
        {
          enabled: true,
          host: opts.host || '127.0.0.1',
          port: opts.port || 9001,
          token: opts.token || '',
        },
        { log: (m) => this.log(m) }
      );
      this._ownsClient = true;
    }
    this._lua.on('error', (err) => this.emit('error', err));
  }

  async connect() {
    // If we don't own the client, server.js handles the connect lifecycle
    // and we just trust whatever state it's in.
    if (!this._ownsClient) {
      this.connected = !!this._lua.connected;
      return this.connected;
    }
    const ok = await this._lua.connect();
    this.connected = !!ok;
    return this.connected;
  }

  async disconnect() {
    this._lua.disconnect();
    this.connected = false;
  }

  status() {
    const base = super.status();
    const ls = this._lua.status();
    return {
      ...base,
      connected: ls.connected,
      consoleVersion: ls.ma3Version,
      bridgeVersion: ls.bridgeVersion,
      bridgeOutdated: ls.bridgeOutdated,
      bridgeStats: ls.bridgeStats,
    };
  }

  // ─── Direct passthrough to Lua client for engine compat ──────────
  // Existing engine code calls lua.send / lua.query / lua.cmd directly.
  // Until the engine is fully migrated to driver.encoderTick(), expose
  // these so we can introduce the driver alongside the old code path.
  get rawClient() { return this._lua; }
  send(msg)       { return this._lua.send(msg); }
  query(action, opts) { return this._lua.query(action, opts); }

  // ─── Canonical command surface ────────────────────────────────────

  encoderTick(slotIdx, attrName, deltaPercent) {
    if (!this._lua.connected) return false;
    // The bridge formats the actual `Cmd("Attribute X At + N")` line
    // server-side. We just send the tick intent.
    this._lua.send({
      action: 'tick',
      encoder: slotIdx,
      delta: deltaPercent,
    });
    return true;
  }

  bankSelect(bankIdx, _bankName) {
    if (!this._lua.connected) return false;
    this._lua.cmd(`Select EncoderBank ${bankIdx}`);
    return true;
  }

  subPageNext() {
    if (!this._lua.connected) return false;
    this._lua.cmd('EncoderPage +');
    return true;
  }

  subPagePrev() {
    if (!this._lua.connected) return false;
    this._lua.cmd('EncoderPage -');
    return true;
  }

  cmd(rawText) {
    if (!this._lua.connected) return false;
    this._lua.cmd(rawText);
    return true;
  }
}

module.exports = Ma3Driver;
