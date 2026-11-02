/**
 * HogDriver — High End Systems Hog 4 / Hog 5 / Hog 4 PC / Nano Hog.
 *
 * Hog OS exposes OSC via the "OSC Out" widget in the Network preferences,
 * default RX port 7001. The address scheme uses '/hog/' prefix and
 * follows "hardware/<surface element>/<index>".
 *
 * Verified addresses (Hog OS 3.18 OSC reference):
 *   /hog/hardware/iwheel/<n>   float +1/-1   — encoder wheel (intensity wheels)
 *   /hog/hardware/wheel/<n>    float +1/-1   — main wheel set (Pan/Tilt/Color/etc.)
 *   /hog/hardware/key/<name>   float 1/0     — front-panel hardkeys (Open, Open10, Macro, etc.)
 *   /hog/keypad                string        — command-line keypad text
 *
 * STATUS: scaffold — not live-tested. Hog OS requires the OSC widget to
 * be enabled per show file (View → OSC Out, then click the green dot).
 * Without that, every send silently drops.
 *
 * Hog 4 PC runs on Windows; Hog Nano runs on Mac/Win/Linux.
 */
'use strict';

const ConsoleDriver = require('./console-driver');

let oscLib = null;
try { oscLib = require('osc'); } catch (_) { /* graceful */ }

class HogDriver extends ConsoleDriver {
  static get id()           { return 'hog'; }
  static get displayName()  { return 'Hog 4 / Hog 5 / Hog 4 PC / Nano'; }
  static get macSupported() { return true; }   // Hog Nano runs on macOS
  static get defaultPort()  { return 7001; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    this._udp = null;
  }

  async connect() {
    if (!oscLib) {
      this.log('osc package not loaded — Hog driver inert');
      return false;
    }
    return new Promise((resolve) => {
      try {
        this._udp = new oscLib.UDPPort({
          localAddress: '0.0.0.0',
          localPort: this.opts.localPort || 7002,
          remoteAddress: this.opts.host || '127.0.0.1',
          remotePort: this.opts.port || 7001,
          metadata: false,
        });
        this._udp.on('ready', () => {
          this.connected = true;
          this.log(`Hog OSC ready: send ${this.opts.host}:${this.opts.port || 7001}`);
          resolve(true);
        });
        this._udp.on('error', (err) => this.log(`Hog OSC error: ${err && err.message}`));
        this._udp.open();
      } catch (err) {
        this.log(`Hog connect failed: ${err.message}`);
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
    catch (err) { this.log(`Hog send failed: ${err.message}`); return false; }
  }

  encoderTick(slotIdx, _attrName, deltaPercent) {
    return this._send(`/hog/hardware/wheel/${slotIdx}`, [{ type: 'f', value: deltaPercent }]);
  }

  bankSelect(_bankIdx, bankName) {
    // Hog has 4 attribute banks toggled via I, P, C, B keys in the
    // Programmer. Best-effort name → key mapping.
    const map = { Dimmer: 'intensity', Position: 'position', Color: 'colour',
                  Gobo: 'beam', Beam: 'beam', Focus: 'beam' };
    const key = map[bankName] || 'intensity';
    return this._send(`/hog/hardware/key/${key}`, [{ type: 'f', value: 1.0 }])
        && this._send(`/hog/hardware/key/${key}`, [{ type: 'f', value: 0.0 }]);
  }

  subPageNext() { return this._send('/hog/hardware/key/next', [{ type: 'f', value: 1.0 }]); }
  subPagePrev() { return this._send('/hog/hardware/key/back', [{ type: 'f', value: 1.0 }]); }
  cmd(rawText) {
    return this._send('/hog/keypad', [{ type: 's', value: String(rawText) }]);
  }
}

module.exports = HogDriver;
