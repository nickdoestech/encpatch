/**
 * Native Stream Deck plugin for ENCpatch.
 *
 * Why this exists alongside ENCpatch's USB-HID Path B: not every user
 * wants a separate desktop app. Some prefer the Stream Deck stays
 * "officially" managed by Elgato's software with this plugin reaching
 * out to a running ENCpatch over HTTP for the actual console control.
 *
 * Communication is one-way: this plugin sends actions to ENCpatch's
 * `/api/inject` endpoint. Configuration (host/port) is per-action via
 * the property inspector. Defaults: 127.0.0.1:8733.
 *
 * To package for distribution, run:
 *   streamdeck pack streamdeck-plugin/com.encpatch.bridge.sdPlugin
 * (requires Elgato's `streamdeck` CLI from npm: @elgato/cli)
 */
'use strict';

const streamDeck = require('@elgato/streamdeck');

// Default ENCpatch endpoint (matches the desktop app's HTTP server).
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8733;

function endpoint(settings) {
  const host = (settings && settings.host) || DEFAULT_HOST;
  const port = (settings && settings.port) || DEFAULT_PORT;
  return `http://${host}:${port}/api/inject`;
}

async function inject(settings, action) {
  try {
    const resp = await fetch(endpoint(settings), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    return resp.ok;
  } catch (_) {
    return false;
  }
}

// ─── Encoder tick action ───────────────────────────────────────────────
class EncoderTickAction extends streamDeck.action.SingletonAction {
  async onDialRotate(ev) {
    const { settings } = ev.payload;
    const slot = Number(settings && settings.slot) || 1;
    await inject(settings, {
      type: 'bridgeTick',
      encoder: slot,
      delta: ev.payload.ticks,
    });
  }
  async onDialDown(ev) {
    // Toggle fine/coarse — reuse the existing fine-mode behavior of
    // ENCpatch's mapping engine by injecting a no-op tick with a flag.
    // (Implementation matches the SD+ Path B push-to-toggle convention.)
    await inject(ev.payload.settings, {
      type: 'cmd',
      text: '__encpatch_toggle_fine__',
    });
  }
  async onTouchTap(ev) {
    const slot = Number(ev.payload.settings && ev.payload.settings.slot) || 1;
    await inject(ev.payload.settings, {
      type: 'cmd',
      text: `__encpatch_cycle_stack__ ${slot}`,
    });
  }
}

// ─── Bank select action ────────────────────────────────────────────────
class BankSelectAction extends streamDeck.action.SingletonAction {
  async onKeyDown(ev) {
    const settings = ev.payload.settings || {};
    await inject(settings, {
      type: 'setPage',
      page: settings.bank || 'Dimmer',
      bankIdx: Number(settings.bankIdx) || 1,
    });
  }
}

// ─── Console command action ───────────────────────────────────────────
class CmdAction extends streamDeck.action.SingletonAction {
  async onKeyDown(ev) {
    const settings = ev.payload.settings || {};
    await inject(settings, {
      type: 'cmd',
      text: settings.text || '',
    });
  }
}

streamDeck.actions.registerAction(new EncoderTickAction({ UUID: 'com.encpatch.bridge.encodertick' }));
streamDeck.actions.registerAction(new BankSelectAction({ UUID: 'com.encpatch.bridge.bankselect' }));
streamDeck.actions.registerAction(new CmdAction({ UUID: 'com.encpatch.bridge.cmd' }));

streamDeck.connect();
