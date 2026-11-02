/**
 * TitanDriver — Avolites Titan (Quartz / Tiger Touch / Titan Mobile / Sapphire).
 *
 * Titan exposes OSC over UDP. Titan's "OSC In/Out" pane lets you choose
 * an RX port (default 8000). Address scheme uses '/avolites/...' prefix.
 *
 * Verified addresses (Titan v15+ OSC reference):
 *   /avolites/programmer/wheel/<n>   float +1/-1   — encoder wheel ticks
 *   /avolites/programmer/cmdlinekey  string        — command-line keystrokes
 *   /avolites/key/<keyname>          float 1/0     — front-panel keys
 *   /avolites/playback/<n>/<level>   float 0..1    — playback fader
 *
 * STATUS: scaffold — not live-tested. The wheel address is the most
 * uncertain; older Titan releases use /avolites/wheel/N. If yours errors
 * on the documented form, set `legacyWheelAddress: true` in console opts.
 *
 * Titan is Windows-only as a console; macOS users reach it over LAN.
 */
'use strict';

const ConsoleDriver = require('./console-driver');

let oscLib = null;
try { oscLib = require('osc'); } catch (_) { /* graceful */ }

class TitanDriver extends ConsoleDriver {
  static get id()           { return 'titan'; }
  static get displayName()  { return 'Avolites Titan (Quartz / Tiger Touch / Sapphire)'; }
  static get macSupported() { return false; }
  static get defaultPort()  { return 8000; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    this._udp = null;
  }

  async connect() {
    if (!oscLib) {
      this.log('osc package not loaded — Titan driver inert');
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
          this.log(`Titan OSC ready: send ${this.opts.host}:${this.opts.port || 8000}`);
          resolve(true);
        });
        this._udp.on('error', (err) => this.log(`Titan OSC error: ${err && err.message}`));
        this._udp.open();
      } catch (err) {
        this.log(`Titan connect failed: ${err.message}`);
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
    catch (err) { this.log(`Titan send failed: ${err.message}`); return false; }
  }

  encoderTick(slotIdx, _attrName, deltaPercent) {
    const addr = this.opts.legacyWheelAddress
      ? `/avolites/wheel/${slotIdx}`
      : `/avolites/programmer/wheel/${slotIdx}`;
    return this._send(addr, [{ type: 'f', value: deltaPercent }]);
  }

  bankSelect(_bankIdx, bankName) {
    // Titan attribute groups are: I (Intensity), P (Pan/Tilt), C (Colour),
    // G (Gobo), B (Beam), X (Effect), F (Focus), S (Shape).
    const map = {
      Dimmer: 'i', Position: 'p', Color: 'c',
      Gobo: 'g', Beam: 'b', Focus: 'f', Shapers: 's', Control: 'x',
    };
    const key = map[bankName] || 'i';
    return this._send(`/avolites/key/${key}`, [{ type: 'f', value: 1.0 }])
        && this._send(`/avolites/key/${key}`, [{ type: 'f', value: 0.0 }]);
  }

  subPageNext() { return this._send('/avolites/key/wheelpage_up', [{ type: 'f', value: 1.0 }]); }
  subPagePrev() { return this._send('/avolites/key/wheelpage_down', [{ type: 'f', value: 1.0 }]); }
  cmd(rawText) {
    return this._send('/avolites/programmer/cmdline', [{ type: 's', value: String(rawText) }]);
  }
}

module.exports = TitanDriver;
