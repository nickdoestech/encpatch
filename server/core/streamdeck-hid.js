/**
 * StreamDeckHID — USB-HID direct mode (Path B "takeover").
 *
 * Targets `@elgato-stream-deck/node` v7.x. The library exposes a
 * `device.CONTROLS` array of typed controls (button / encoder / lcd-segment)
 * and emits `down`, `up`, `rotate`, `lcdShortPress` events with the
 * control object as the first argument.
 *
 * v0.4: drives MA3 Mapper's engine via /sd/key/N and /sd/enc/N events.
 */

const EventEmitter = require('events');

class StreamDeckHID extends EventEmitter {
  constructor(opts = {}, hooks = {}) {
    super();
    this.opts = opts;
    this.log = hooks.log || (() => {});
    this.device = null;
    this.model = null;
    this._engineInject = null;
    this._lastError = null;
    this._dead = false;
    // Process-level safety net: any throw from node-hid's background async
    // worker (HID device yanked, USB hub power glitch, etc.) bubbles up
    // here. Mark ourselves dead so the renderer stops calling fillKeyBuffer
    // on a corpse, and don't propagate.
    this._installNativeErrGuard();
  }

  _installNativeErrGuard() {
    if (StreamDeckHID._guardInstalled) return;
    StreamDeckHID._guardInstalled = true;
    const swallow = (err) => {
      const msg = (err && (err.message || String(err))) || '';
      if (/HID|hid|libusb|cannot (?:read|write)|could not (?:read|write)|device (?:disconnected|not found|timeout)|pipe/i.test(msg)) {
        try { console.error('[sdhid] swallowed native err:', msg); } catch (_) {}
        // Mark every live instance dead. Cheap; we only ever have one.
        if (StreamDeckHID._instances) for (const inst of StreamDeckHID._instances) inst._markDead(msg);
        return true;
      }
      return false;
    };
    process.on('uncaughtException', (e) => { swallow(e); });
    process.on('unhandledRejection', (e) => { swallow(e); });
  }

  _markDead(reason) {
    if (this._dead) return;
    this._dead = true;
    this._lastError = reason || 'device error';
    try { this.log(`device went offline: ${this._lastError}`); } catch (_) {}
    // Drop the device handle so renderer's `if (!dev)` short-circuit fires.
    try { if (this.device && this.device.removeAllListeners) this.device.removeAllListeners(); } catch (_) {}
    try { if (this.device && typeof this.device.close === 'function') this.device.close().catch(() => {}); } catch (_) {}
    this.device = null;
    // Start hot-plug monitor to re-claim device when reinserted
    this._scheduleHotplugRetry();
  }

  _scheduleHotplugRetry() {
    if (this._reconnectTimer) return;
    const RETRY_INTERVAL = 3000;  // Try every 3 seconds
    this._reconnectTimer = setInterval(async () => {
      if (!this._dead || !this._engineInject) return;
      try {
        const lib = require('@elgato-stream-deck/node');
        const devices = await lib.listStreamDecks();
        if (devices && devices.length > 0) {
          const idx = Math.max(0, Math.min(devices.length - 1, this.opts.deviceIndex || 0));
          const targetDev = devices[idx];
          try {
            this.device = await lib.openStreamDeck(targetDev.path);
            this._dead = false;
            this._lastError = null;
            this.model = this.device.MODEL || targetDev.model;
            this.log(`device re-claimed after hot-plug: ${this.model}`);
            // Re-wire events
            this._wireEvents();
            clearInterval(this._reconnectTimer);
            this._reconnectTimer = null;
          } catch (_) { /* try again next interval */ }
        }
      } catch (_) { /* swallow errors during retry */ }
    }, RETRY_INTERVAL);
  }

  async open(engineInject) {
    this._engineInject = engineInject;
    this._reconnectTimer = null;
    let lib;
    try {
      lib = require('@elgato-stream-deck/node');
    } catch (err) {
      this.log('===========================================================');
      this.log('Stream Deck takeover NOT active — `@elgato-stream-deck/node`');
      this.log('did not load. Most likely the optional native dep failed to');
      this.log('compile. Fix:');
      this.log('  1) Install Xcode Command Line Tools:  xcode-select --install');
      this.log('  2) Reinstall:  npm install @elgato-stream-deck/node --force');
      this.log('  3) Restart MA3 Mapper.');
      this.log(`Underlying error: ${err.message}`);
      this.log('===========================================================');
      this._lastError = err.message;
      return false;
    }

    let devices;
    try {
      devices = await lib.listStreamDecks();
    } catch (err) {
      this.log(`HID list failed: ${err.message}`);
      this._lastError = err.message;
      return false;
    }
    if (!devices || !devices.length) {
      this.log('no Stream Deck device found. Is the deck plugged in?');
      this._lastError = 'no devices';
      return false;
    }

    // Pick which physical SD to claim. Default 0 = first plugged in.
    // Users with 2+ SDs set deviceIndex in config to pick a specific one.
    // (Full multi-device parallel rendering is on the roadmap; for now
    // ENCpatch drives one SD at a time.)
    const idx = Math.max(0, Math.min(devices.length - 1, this.opts.deviceIndex || 0));
    const targetDev = devices[idx];

    this.log(`saw ${devices.length} device(s)${devices.length > 1 ? ' (config.deviceIndex=' + idx + ')' : ''}; attempting to claim ${targetDev.model || 'unknown'} at ${targetDev.path}`);
    if (devices.length > 1) {
      devices.forEach((d, i) => {
        this.log(`  [${i}] ${d.model || '?'} at ${d.path}${i === idx ? '  ← claimed' : ''}`);
      });
    }

    StreamDeckHID._instances = StreamDeckHID._instances || new Set();
    StreamDeckHID._instances.add(this);

    try {
      this.device = await lib.openStreamDeck(targetDev.path);
    } catch (err) {
      this.log('===========================================================');
      this.log(`Could not claim Stream Deck: ${err.message}`);
      this.log('Almost always means: the Elgato Stream Deck app is still running');
      this.log('OR macOS Input Monitoring permission is not granted to Terminal.');
      this.log('  Fix 1: pkill -9 -f "Stream Deck"');
      this.log('  Fix 2: System Settings -> Privacy & Security -> Input Monitoring');
      this.log('         -> add Terminal, enable, then quit + reopen Terminal.');
      this.log('===========================================================');
      this._lastError = err.message;
      return false;
    }
    this.model = this.device.MODEL || targetDev.model;
    const controls = this.device.CONTROLS || [];
    const counts = controls.reduce((a, c) => { a[c.type] = (a[c.type] || 0) + 1; return a; }, {});
    this.log(`claimed ${this.device.PRODUCT_NAME || this.model} — ${(counts.button || 0)} buttons, ${(counts.encoder || 0)} encoders, ${(counts['lcd-segment'] || 0)} LCD segment(s)`);

    // Wire events
    this._wireEvents();
    return true;
  }

  _wireEvents() {
    if (!this.device) return;
    // v7 emits the full control object (and amount for rotate).
    this.device.on('down', (ctrl) => {
      if (ctrl.type === 'button')  this._inject(`/sd/key/${ctrl.index + 1}`, [1]);
      else if (ctrl.type === 'encoder') this._inject(`/sd/enc/${ctrl.index + 1}/press`, [1]);
    });
    this.device.on('up', (ctrl) => {
      if (ctrl.type === 'button')  this._inject(`/sd/key/${ctrl.index + 1}`, [0]);
      else if (ctrl.type === 'encoder') this._inject(`/sd/enc/${ctrl.index + 1}/press`, [0]);
    });
    this.device.on('rotate', (ctrl, amount) => {
      this._inject(`/sd/enc/${ctrl.index + 1}`, [amount]);
    });
    this.device.on('lcdShortPress', (ctrl, pos) => {
      this._inject(`/sd/lcd/${ctrl.id}/touch`, [pos.x, pos.y]);
    });
    this.device.on('lcdSwipe', (ctrl, from, to) => {
      const dx = (to && from) ? (to.x - from.x) : 0;
      const dir = dx > 0 ? 'right' : (dx < 0 ? 'left' : 'tap');
      this._inject(`/sd/lcd/${ctrl.id}/swipe`, [dir, dx]);
    });
    this.device.on('error', (e) => {
      this.log(`device error: ${e && e.message}`);
      this._markDead(e && e.message);
    });
    if (typeof this.device.on === 'function') {
      // Some lib versions emit 'disconnect' / 'close'. Treat as dead.
      try { this.device.on('disconnect', () => this._markDead('disconnect')); } catch (_) {}
      try { this.device.on('close', () => this._markDead('close')); } catch (_) {}
    }
  }

  _inject(address, args) {
    if (!this._engineInject) return;
    this._engineInject({ address, args });
  }

  async close() {
    if (this._reconnectTimer) clearInterval(this._reconnectTimer);
    this._reconnectTimer = null;
    if (this.device) { try { await this.device.close(); } catch (_) {} }
    this.device = null;
    if (StreamDeckHID._instances) StreamDeckHID._instances.delete(this);
  }

  status() {
    if (!this.device || this._dead) return { connected: false, model: this.model, lastError: this._lastError || null };
    const controls = this.device.CONTROLS || [];
    const counts = controls.reduce((a, c) => { a[c.type] = (a[c.type] || 0) + 1; return a; }, {});
    return {
      connected: true,
      model: this.model,
      productName: this.device.PRODUCT_NAME,
      counts,
    };
  }
}

module.exports = StreamDeckHID;
