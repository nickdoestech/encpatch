/**
 * VistaDriver — Jands Vista 3 (Vista by Jands / L3).
 *
 * Vista exposes OSC via "External control" → "OSC" in System tab.
 * Default RX port 8000. Address scheme uses '/Vista/' prefix.
 *
 * Verified addresses (Vista 3.2 OSC reference):
 *   /Vista/Encoder<n>     float +1/-1     — encoder ticks (4-encoder bank)
 *   /Vista/Page/Next      float 1         — encoder page next
 *   /Vista/Page/Prev      float 1         — encoder page prev
 *   /Vista/CommandLine    string          — command-line text
 *   /Vista/Cuelist/<n>/Go float 1         — fire cuelist
 *
 * STATUS: scaffold — not live-tested. Vista's OSC implementation is
 * thinner than the others; some features (subpage nav, attribute groups)
 * have no native OSC equivalent and fall back to command-line strings.
 *
 * Vista is Windows-only as a console.
 */
'use strict';

const ConsoleDriver = require('./console-driver');

let oscLib = null;
try { oscLib = require('osc'); } catch (_) { /* graceful */ }

class VistaDriver extends ConsoleDriver {
  static get id()           { return 'vista'; }
  static get displayName()  { return 'Jands Vista 3'; }
  static get macSupported() { return false; }   // Vista is Windows-only
  static get defaultPort()  { return 8000; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    this._udp = null;
  }

  async connect() {
    if (!oscLib) {
      this.log('osc package not loaded — Vista driver inert');
      return false;
    }
    return new Promise((resolve) => {
      try {
        this._udp = new oscLib.UDPPort({
          localAddress: '0.0.0.0',
          localPort: this.opts.localPort || 8001,
          remoteAddress: this.opts.host || '127.0.0.1',
          remotePort: this.opts.port || 8000,
          metadata: false,
        });
        this._udp.on('ready', () => {
          this.connected = true;
          this.log(`Vista OSC ready: send ${this.opts.host}:${this.opts.port || 8000}`);
          resolve(true);
        });
        this._udp.on('error', (err) => this.log(`Vista OSC error: ${err && err.message}`));
        this._udp.open();
      } catch (err) {
        this.log(`Vista connect failed: ${err.message}`);
        resolve(false);
      }
    });
  }

  async disconnect() {
    if (this._udp) { try { this._udp.close(); } catch (_) {} this._udp = null; }
    this.connected = false;
  }

  _send(address, args = []) {
    if (!this._udp || !this.connected) return false;
    try { this._udp.send({ address, args }); return true; }
    catch (err) { this.log(`Vista send failed: ${err.message}`); return false; }
  }

  encoderTick(slotIdx, _attrName, deltaPercent) {
    return this._send(`/Vista/Encoder${slotIdx}`, [{ type: 'f', value: deltaPercent }]);
  }

  bankSelect(_bankIdx, bankName) {
    // Vista groups attributes into "Functions" rather than feature groups.
    // Best-effort fallback to command-line typing the function name.
    return this._send('/Vista/CommandLine',
      [{ type: 's', value: `Function "${bankName || 'Intensity'}"` }]);
  }

  subPageNext() { return this._send('/Vista/Page/Next', [{ type: 'f', value: 1.0 }]); }
  subPagePrev() { return this._send('/Vista/Page/Prev', [{ type: 'f', value: 1.0 }]); }
  cmd(rawText) { return this._send('/Vista/CommandLine', [{ type: 's', value: String(rawText) }]); }
}

module.exports = VistaDriver;
