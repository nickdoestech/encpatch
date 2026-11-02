/**
 * MagicQDriver — ChamSys MagicQ (consoles + MagicQ PC).
 *
 * MagicQ OSC is well-documented in MagicQ's Setup → OSC pane. Default RX
 * port 8000 (configurable). Address scheme is '/exec/<bank>/<row>' for
 * playbacks and '/wheel/<n>' for the encoder set.
 *
 * Verified addresses (MagicQ v1.9.x SDK reference):
 *   /wheel/<n>            float +1/-1     — encoder relative tick (1..6)
 *   /cmd                  string          — command line
 *   /softkey/<n>          float 1/0       — softkeys
 *   /exec/pb/<n>/<level>  float 0..1      — playback fader
 *   /pb/<n>/go            float 1         — playback go
 *
 * MagicQ PC runs on macOS (M-series via Rosetta works fine), so this is
 * one of the more useful non-MA3 paths for Mac users.
 *
 * STATUS: scaffold — not live-tested.
 */
'use strict';

const ConsoleDriver = require('./console-driver');

let oscLib = null;
try { oscLib = require('osc'); } catch (_) { /* graceful */ }

class MagicQDriver extends ConsoleDriver {
  static get id()           { return 'magicq'; }
  static get displayName()  { return 'ChamSys MagicQ (consoles + PC)'; }
  static get macSupported() { return true; }
  static get defaultPort()  { return 8000; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    this._udp = null;
  }

  async connect() {
    if (!oscLib) {
      this.log('osc package not loaded — MagicQ driver inert');
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
          this.log(`MagicQ OSC ready: send ${this.opts.host}:${this.opts.port || 8000}`);
          resolve(true);
        });
        this._udp.on('error', (err) => this.log(`MagicQ OSC error: ${err && err.message}`));
        this._udp.open();
      } catch (err) {
        this.log(`MagicQ connect failed: ${err.message}`);
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
    catch (err) { this.log(`MagicQ send failed: ${err.message}`); return false; }
  }

  encoderTick(slotIdx, _attrName, deltaPercent) {
    return this._send(`/wheel/${slotIdx}`, [{ type: 'f', value: deltaPercent }]);
  }

  bankSelect(_bankIdx, bankName) {
    // MagicQ encoder pages: I, P, C, B, S, F. Selected via softkey on the
    // encoder bank toolbar (softkeys 1–6 on the encoder strip).
    const map = { Dimmer: 1, Position: 2, Color: 3, Beam: 4, Shapers: 5, Focus: 6,
                  Gobo: 4, Control: 5 };
    const sk = map[bankName] || 1;
    return this._send(`/softkey/${sk}`, [{ type: 'f', value: 1.0 }])
        && this._send(`/softkey/${sk}`, [{ type: 'f', value: 0.0 }]);
  }

  subPageNext() { return this._send('/cmd', [{ type: 's', value: 'PAGE+ ENTER' }]); }
  subPagePrev() { return this._send('/cmd', [{ type: 's', value: 'PAGE- ENTER' }]); }
  cmd(rawText) { return this._send('/cmd', [{ type: 's', value: String(rawText) }]); }
}

module.exports = MagicQDriver;
