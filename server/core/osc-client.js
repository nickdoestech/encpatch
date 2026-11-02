/**
 * OscClient — bidirectional UDP OSC bridge.
 *
 * Listens on `osc.listenPort` for messages from BOTH:
 *   - MA3 (when MA3 is configured to send OSC out — used for feedback)
 *   - Controllers (Stream Deck via Companion, OSC apps like TouchOSC, etc.)
 *
 * Sends OSC to:
 *   - MA3 (osc.ma3Host:osc.ma3SendPort)  -> command direction
 *   - Arbitrary controller addresses     -> feedback direction (LED states,
 *     fader positions, exec colors)
 *
 * MA3 OSC reference: each fader / executor / key can be addressed by its
 * physical/virtual page+number, e.g. "/Page1/Fader201" with a float arg
 * 0.0..1.0. See docs/MA3_OSC.md.
 */

const EventEmitter = require('events');
const osc = require('osc');

class OscClient extends EventEmitter {
  constructor(opts, hooks = {}) {
    super();
    this.opts = opts;
    this.log = hooks.log || (() => {});
    this.udpPort = null;
    this.lastMa3SeenAt = 0;
    // Rate limiter — bucket of tokens refilled at limits.maxMa3PerSec
    this._limits = { maxMa3PerSec: 50, queueMax: 100 };
    this._sendQueue = [];
    this._sendCounter = { ts: Date.now(), count: 0, lastSentAt: 0, dropped: 0, sentTotal: 0 };
    this._panicUntil = 0;
    this._lastSendError = null;
    this._drainTimer = null;
  }

  /** Update rate-limit settings at runtime. */
  setLimits(limits) {
    this._limits = { ...this._limits, ...(limits || {}) };
  }

  /** Suppress all sends to MA3 for `seconds` seconds (panic stop). */
  panic(seconds = 5) {
    this._panicUntil = Date.now() + seconds * 1000;
    this._sendQueue.length = 0;
    this.log(`PANIC — suppressing sends to MA3 for ${seconds}s`);
  }

  panicState() {
    const remain = Math.max(0, this._panicUntil - Date.now());
    return { active: remain > 0, msRemaining: remain };
  }

  /** Stats for the health panel. */
  trafficStats() {
    const now = Date.now();
    const winSec = Math.max(0.001, (now - this._sendCounter.ts) / 1000);
    return {
      ratePerSec: Math.round(this._sendCounter.count / winSec),
      dropped: this._sendCounter.dropped,
      sentTotal: this._sendCounter.sentTotal,
      queueDepth: this._sendQueue.length,
      lastSentAt: this._sendCounter.lastSentAt || null,
      lastError: this._lastSendError,
      panic: this.panicState(),
    };
  }

  async start() {
    if (this.udpPort) return;
    this.udpPort = new osc.UDPPort({
      localAddress: '0.0.0.0',
      localPort: this.opts.listenPort,
      remoteAddress: this.opts.ma3Host,
      remotePort: this.opts.ma3SendPort,
      metadata: true,
    });

    this.udpPort.on('message', (oscMsg, _timeTag, info) => {
      const fromMa3 = info && info.address === this.opts.ma3Host;
      if (fromMa3) this.lastMa3SeenAt = Date.now();
      this.emit('message', {
        address: oscMsg.address,
        args: (oscMsg.args || []).map((a) => (a && 'value' in a ? a.value : a)),
        rawArgs: oscMsg.args,
        from: info ? `${info.address}:${info.port}` : null,
        fromMa3,
      });
    });

    this.udpPort.on('error', (err) => {
      this.log(`error: ${err.message}`);
      if (this.listenerCount('error') > 0) this.emit('error', err);
    });

    await new Promise((resolve, reject) => {
      this.udpPort.once('ready', resolve);
      this.udpPort.once('error', reject);
      this.udpPort.open();
    });
    this.log(`listening on udp/${this.opts.listenPort}, MA3 -> ${this.opts.ma3Host}:${this.opts.ma3SendPort}`);
  }

  async stop() {
    if (!this.udpPort) return;
    this.udpPort.close();
    this.udpPort = null;
  }

  /** Send OSC to MA3 — goes through the rate limiter + drop-oldest queue. */
  sendToMa3(address, args = []) {
    if (Date.now() < this._panicUntil) {
      this._sendCounter.dropped++;
      this._lastSendError = 'panic-suppressed';
      return;
    }
    if (this._canSendNow()) {
      this._sendImmediate(address, args);
    } else {
      this._enqueue(address, args);
    }
  }

  _canSendNow() {
    const now = Date.now();
    if (now - this._sendCounter.ts >= 1000) {
      this._sendCounter.ts = now;
      this._sendCounter.count = 0;
    }
    return this._sendCounter.count < (this._limits.maxMa3PerSec || 50);
  }

  _sendImmediate(address, args) {
    try {
      this._send(address, args, this.opts.ma3Host, this.opts.ma3SendPort);
      this._sendCounter.count++;
      this._sendCounter.sentTotal++;
      this._sendCounter.lastSentAt = Date.now();
      this._lastSendError = null;
    } catch (err) {
      this._lastSendError = err.message;
      this.log(`send failed: ${err.message}`);
    }
  }

  _enqueue(address, args) {
    if (this._sendQueue.length >= (this._limits.queueMax || 100)) {
      this._sendQueue.shift();
      this._sendCounter.dropped++;
      this._lastSendError = `dropped (queue ${this._limits.queueMax || 100} full @ ${this._limits.maxMa3PerSec || 50} msg/s)`;
    }
    this._sendQueue.push({ address, args });
    this._scheduleDrain();
  }

  _scheduleDrain() {
    if (this._drainTimer) return;
    const waitMs = Math.ceil(1000 / (this._limits.maxMa3PerSec || 50));
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      while (this._sendQueue.length && this._canSendNow()) {
        const m = this._sendQueue.shift();
        this._sendImmediate(m.address, m.args);
      }
      if (this._sendQueue.length) this._scheduleDrain();
    }, waitMs);
  }

  /** Send OSC to an arbitrary controller (used for feedback). */
  sendTo(address, args, host, port) {
    return this._send(address, args, host, port);
  }

  _send(address, args, host, port) {
    if (!this.udpPort) throw new Error('OSC port not started');
    const packet = {
      address,
      args: (Array.isArray(args) ? args : [args]).map(coerceArg),
    };
    this.udpPort.send(packet, host, port);
  }

  reconfigure(newOpts) {
    this.opts = { ...this.opts, ...newOpts };
    if (this.udpPort) {
      this.udpPort.options.remoteAddress = this.opts.ma3Host;
      this.udpPort.options.remotePort = this.opts.ma3SendPort;
    }
  }

  status() {
    return {
      listening: !!this.udpPort,
      listenPort: this.opts.listenPort,
      ma3Host: this.opts.ma3Host,
      ma3SendPort: this.opts.ma3SendPort,
      lastMa3MessageAt: this.lastMa3SeenAt || null,
    };
  }
}

function coerceArg(v) {
  if (v && typeof v === 'object' && 'type' in v && 'value' in v) return v;
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'i', value: v } : { type: 'f', value: v };
  if (typeof v === 'boolean') return { type: v ? 'T' : 'F' };
  if (typeof v === 'string') return { type: 's', value: v };
  return { type: 's', value: String(v) };
}

module.exports = OscClient;
