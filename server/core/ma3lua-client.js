/**
 * Ma3LuaClient — TCP client to the MA3 Lua plugin (Option 2).
 *
 * The MA3 Lua plugin runs INSIDE grandMA3 onPC and listens on a TCP port
 * (default 9001). Each line is a JSON message. The plugin executes the
 * MA3 Cmd(...) call inside MA3's programmer context — full command-line
 * power without Telnet.
 *
 * Wire protocol (newline-delimited JSON):
 *   client -> plugin:  { "cmd": "Attribute Dimmer At + 5" }
 *   client -> plugin:  { "cmd": "Go Sequence 1" }
 *   plugin -> client:  { "ok": true }                      (ack)
 *   plugin -> client:  { "selection": [...fixture ids...] } (state)
 *
 * v0.3 status: scaffold. The MA3 Lua plugin source ships in
 * docs/ma3-plugin/ and must be imported into MA3 once. Until that lands
 * this client just queues commands and logs them; nothing is sent.
 */

const net = require('net');
const EventEmitter = require('events');

class Ma3LuaClient extends EventEmitter {
  constructor(opts = {}, hooks = {}) {
    super();
    this.opts = opts;
    this.log = hooks.log || (() => {});
    this.socket = null;
    this.connected = false;
    this._buf = '';
    this._reconnectTimer = null;
    this._queue = [];    // priority queue: {payload, priority} where priority 0=critical, 10=normal
    this._nextPriority = 0;   // monotonic counter for stable ordering within same priority
  }

  /** Enqueue a message with optional priority (lower = higher priority, 0=critical). */
  _enqueueMessage(msg, priority = 10) {
    this._queue.push({
      payload: msg,
      priority,
      order: this._nextPriority++,
    });
    // Keep queue sorted by priority (ascending), then by insertion order
    this._queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.order - b.order;
    });
  }

  connect() {
    if (!this.opts.enabled) return Promise.resolve(false);
    return new Promise((resolve) => {
      const sock = net.createConnection({ host: this.opts.host, port: this.opts.port }, () => {
        this.connected = true;
        this._reconnectAttempt = 0;   // reset backoff after a clean connect
        this.log(`connected to MA3 Lua plugin at ${this.opts.host}:${this.opts.port}`);
        // flush queue in priority order (critical first, then normal)
        for (const item of this._queue) this._writeRaw(item.payload);
        this._queue = [];
        // Start heartbeat monitor — detect stale connections fast
        this._startHeartbeatMonitor();
        resolve(true);
        // Handshake: ask the bridge what version it is. Old bridges
        // (pre-0.9 MA3MapperBridge) don't have getVersion and reply with
        // {err:'unknown'} — that's our signal to flag it as outdated.
        this._handshakeVersion().catch(() => {});
      });
      sock.setEncoding('utf8');
      sock.on('data', (chunk) => this._onData(chunk));
      sock.on('close', () => {
        this.connected = false;
        this.bridgeVersion = null;
        this.bridgeOutdated = false;
        this.log('connection closed');
        this._scheduleReconnect();
      });
      sock.on('error', (err) => {
        this.log(`socket error: ${err.message}`);
        if (this.listenerCount('error') > 0) this.emit('error', err);
      });
      this.socket = sock;
    });
  }

  /**
   * Detect bridge version. New bridge (≥0.9.0) replies {version:"0.9.0"};
   * old bridge replies {err:"unknown"} or times out. Either way we mark
   * it outdated so the renderer can show "OLD BRIDGE — UPDATE" instead
   * of mysterious blank cells.
   *
   * Also asks the bridge for the running MA3 version so we can route
   * version-specific command syntax + show it in the UI / LCD header.
   */
  async _handshakeVersion() {
    // Read OUR version from the desktop package so we can check for
    // mismatches against what the bridge plugin reports. If they don't
    // match exactly, flag bridge as outdated even if it's recent enough
    // to support getVersion — common case is user updates the .app but
    // forgets to re-import the .lua plugin in MA3.
    let expectedVersion = '?';
    try { expectedVersion = require('../../package.json').version; } catch (_) {}

    try {
      const r = await this.query('getVersion', { timeoutMs: 1500 });
      if (r && r.version) {
        this.bridgeVersion = r.version;
        if (r.version === expectedVersion) {
          this.bridgeOutdated = false;
          this.log(`bridge version ${r.version} (matches app)`);
        } else {
          this.bridgeOutdated = true;
          this.log(`bridge version MISMATCH: bridge=${r.version}, app=${expectedVersion} — please re-import ENCpatchMA3Bridge.lua in MA3`);
        }
      } else if (r && r.err) {
        this.bridgeVersion = null;
        this.bridgeOutdated = true;
        this.log(`bridge appears OUTDATED (no getVersion support) — please re-install ENCpatchMA3Bridge.lua`);
      }
    } catch (err) {
      // Timeout — old bridge may swallow unknown actions silently. Treat
      // as outdated.
      this.bridgeVersion = null;
      this.bridgeOutdated = true;
      this.log(`bridge handshake timed out — likely outdated`);
    }
    // Ask MA3 what version it is. Not fatal if it fails — the bridge
    // may be too old to support getMa3Version, or the MA3 Lua APIs we
    // try might not exist in older builds. We default to null and the
    // command formatter falls back to the most-compatible syntax.
    try {
      const r = await this.query('getMa3Version', { timeoutMs: 1500 });
      if (r && r.ma3Version) {
        this.ma3Version = r.ma3Version;
        this.log(`MA3 version ${r.ma3Version}`);
      }
    } catch (_) { /* non-fatal */ }
  }

  send(message, priority = 10) {
    // Auto-attach the auth token to every outbound message when one is
    // configured. Bridge validates by string match — only required when
    // bridge BIND_ADDR isn't loopback, but harmless to always send.
    const token = this.opts.token || '';
    const payload = token ? { ...message, token } : message;
    const line = JSON.stringify(payload) + '\n';
    if (this.connected && this.socket) this._writeRaw(line);
    else this._enqueueMessage(line, priority);
  }

  /** Convenience: send a single MA3 console command with optional priority. */
  cmd(commandLine, priority = 10) {
    this.send({ cmd: commandLine }, priority);
  }

  /** Query currently selected fixture IDs. Returns promise that resolves with array of IDs. */
  async getSelection() {
    const r = await this.query('getSelection', { timeoutMs: 1500 });
    return (r && r.selection) || [];
  }

  /**
   * Send a query and return the matching reply (correlated by id).
   * Resolves with the full reply object or rejects on timeout.
   * Priority: 0=critical (page changes), 10=normal (encoder ticks), 20+=background.
   */
  query(action, opts = {}) {
    if (!this.connected) return Promise.reject(new Error('not connected'));
    if (!this._pending) this._pending = new Map();
    if (!this._nextId) this._nextId = 1;
    const id = this._nextId++;
    const timeoutMs = opts.timeoutMs || 1500;
    const priority = opts.priority || 10;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`query timeout (${action})`));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      // opts.payload merges extra fields into the request — needed for
      // actions like filterAttrs that take a list argument.
      this.send({ id, action, ...(opts.payload || {}) }, priority);
    });
  }

  _writeRaw(line) {
    try { this.socket.write(line); } catch (_) {}
  }

  _onData(chunk) {
    this._buf += chunk;
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx).trim();
      this._buf = this._buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { msg = { raw: line }; }
      // Track heartbeats to detect connection drops fast
      if (msg && msg.heartbeat) {
        this._lastHeartbeatAt = Date.now();
        // Don't emit heartbeats as regular messages — they're internal
        continue;
      }
      // Resolve pending query if this reply has a matching id.
      if (msg && typeof msg.id === 'number' && this._pending && this._pending.has(msg.id)) {
        const p = this._pending.get(msg.id);
        clearTimeout(p.timer);
        this._pending.delete(msg.id);
        p.resolve(msg);
      } else {
        this.emit('message', msg);
      }
    }
  }

  _startHeartbeatMonitor() {
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    this._lastHeartbeatAt = Date.now();
    const HEARTBEAT_TIMEOUT = 10000;  // 10 seconds — if no heartbeat, consider disconnected
    this._heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.socket) {
        if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = null;
        return;
      }
      const timeSinceLastBeat = Date.now() - (this._lastHeartbeatAt || Date.now());
      if (timeSinceLastBeat > HEARTBEAT_TIMEOUT) {
        this.log('heartbeat timeout — closing stale connection');
        try { this.socket.destroy(); } catch (_) {}
      }
    }, 5000);  // Check every 5 seconds
  }

  _scheduleReconnect() {
    if (!this.opts.enabled || this._reconnectTimer) return;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, then capped at 30s.
    // Resets to 1s on a successful connect (see connect() resolve path).
    this._reconnectAttempt = (this._reconnectAttempt || 0) + 1;
    const delayMs = Math.min(30000, 1000 * Math.pow(2, this._reconnectAttempt - 1));
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connect().catch(() => {});
    }, delayMs);
  }

  disconnect() {
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);
    if (this.socket) { try { this.socket.destroy(); } catch (_) {} }
    this.socket = null;
    this.connected = false;
    this._heartbeatTimer = null;
  }

  status() {
    return {
      enabled: !!this.opts.enabled,
      connected: this.connected,
      host: this.opts.host,
      port: this.opts.port,
      bridgeStats: this._stats || null,
      bridgeVersion: this.bridgeVersion || null,
      bridgeOutdated: !!this.bridgeOutdated,
      ma3Version: this.ma3Version || null,
    };
  }

  /** Periodically poll the bridge for tick stats (call from server.js). */
  startStatsPoll(intervalMs = 5000) {
    if (this._statsTimer) return;
    const tick = async () => {
      this._statsTimer = setTimeout(tick, intervalMs);
      if (!this.connected) return;
      try {
        const r = await this.query('getStats', { timeoutMs: 1500 });
        if (r && r.stats) this._stats = { ...r.stats, ts: Date.now() };
      } catch (_) { /* ignore */ }
    };
    this._statsTimer = setTimeout(tick, intervalMs);
  }
  stopStatsPoll() {
    if (this._statsTimer) clearTimeout(this._statsTimer);
    this._statsTimer = null;
  }
}

module.exports = Ma3LuaClient;
