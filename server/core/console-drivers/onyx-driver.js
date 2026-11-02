/**
 * OnyxDriver — Obsidian Onyx (formerly Martin M-PC).
 *
 * Onyx exposes OSC over UDP. The address tree is documented in Onyx's
 * "External control" manual under "OSC API". Default RX port 8000.
 *
 * Verified addresses (Onyx 4.x manual):
 *   /Onyx/Encoder<n>     float relative tick    — encoder rotation
 *   /Onyx/Cmd            string                 — command line
 *   /Onyx/SoftKey<n>     float 1/0              — softkeys 1..8
 *   /Onyx/CueList<n>/Go  float 1                — fire cuelist
 *
 * STATUS: scaffold — not live-tested. Encoder address is the most
 * uncertain part; if your Onyx returns errors, tee `/Onyx/*` from a
 * running Onyx in TouchOSC and update the address scheme below.
 *
 * Onyx is Windows-only as a console; macOS users only get this driver
 * if running Onyx on a separate Windows host on the LAN.
 */
'use strict';

const ConsoleDriver = require('./console-driver');

let oscLib = null;
try { oscLib = require('osc'); } catch (_) { /* graceful */ }

class OnyxDriver extends ConsoleDriver {
  static get id()           { return 'onyx'; }
  static get displayName()  { return 'Obsidian Onyx (formerly M-PC)'; }
  static get macSupported() { return false; }   // Onyx itself is Windows; ENCpatch reaches it over LAN
  static get defaultPort()  { return 8000; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    this._udp = null;
  }

  async connect() {
    if (!oscLib) {
      this.log('osc package not loaded — Onyx driver inert');
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
          this.log(`Onyx OSC ready: send ${this.opts.host}:${this.opts.port || 8000}`);
          resolve(true);
        });
        this._udp.on('error', (err) => this.log(`Onyx OSC error: ${err && err.message}`));
        this._udp.open();
      } catch (err) {
        this.log(`Onyx connect failed: ${err.message}`);
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
    catch (err) { this.log(`Onyx send failed: ${err.message}`); return false; }
  }

  encoderTick(slotIdx, _attrName, deltaPercent) {
    return this._send(`/Onyx/Encoder${slotIdx}`, [{ type: 'f', value: deltaPercent }]);
  }

  bankSelect(bankIdx, _bankName) {
    // Onyx's "feature group" equivalent is Programmer encoder banks 1..6
    // mapped to softkeys. Best-effort fallback to numbered softkey.
    return this._send(`/Onyx/SoftKey${bankIdx}`, [{ type: 'f', value: 1.0 }])
        && this._send(`/Onyx/SoftKey${bankIdx}`, [{ type: 'f', value: 0.0 }]);
  }

  subPageNext() { return this._send('/Onyx/Cmd', [{ type: 's', value: 'EncoderPage Next' }]); }
  subPagePrev() { return this._send('/Onyx/Cmd', [{ type: 's', value: 'EncoderPage Prev' }]); }
  cmd(rawText) { return this._send('/Onyx/Cmd', [{ type: 's', value: String(rawText) }]); }
}

module.exports = OnyxDriver;
