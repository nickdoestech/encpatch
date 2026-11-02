/**
 * ENCpatch - main entry point.
 * (Internal module names still reference "MA3 Mapper" / "ma3lua" for
 * backwards compat with existing config files and APIs.)
 *
 * Wires together:
 *   - Config store (mappings.json on disk)
 *   - OSC client (bidirectional with MA3 + with controllers)
 *   - Mapping engine (routes events through user-defined rules)
 *   - HTTP + WebSocket server (serves the web UI and live state)
 *
 * v0.3: Telnet removed (MA3 deprecated it). The future MA3 Lua plugin
 * transport (TCP into a plugin running inside MA3 that calls Cmd(...))
 * will plug in alongside OscClient when that ships.
 */

const path = require('path');
const ConfigStore = require('./core/config-store');
const OscClient = require('./core/osc-client');
const Ma3LuaClient = require('./core/ma3lua-client');
const StreamDeckHID = require('./core/streamdeck-hid');
const StreamDeckRenderer = require('./core/streamdeck-renderer');
const PageBinder = require('./core/page-binder');
const MappingEngine = require('./core/mapping-engine');
const Diagnostics = require('./core/diagnostics');
const startHttpServer = require('./api/http-server');
const WsHub = require('./api/ws-hub');

// When packaged as an Electron app, the project dir lives inside a
// read-only asar archive — we can't write config.json next to it. Electron
// sets MA3_MAPPER_CONFIG_PATH to the user data dir before requiring this.
const CONFIG_PATH = process.env.MA3_MAPPER_CONFIG_PATH
  || path.join(__dirname, '..', 'config.json');

/**
 * FeedbackTracker — maps OSC feedback messages from MA3 to encoder values.
 * Normalizes feedback values to 0-1 for display on the LCD value bars.
 */
class FeedbackTracker {
  constructor() {
    this.values = new Map();  // encoder index (1-4) -> normalized value 0-1
    this.feedbackRules = new Map();  // OSC address -> { encoderIndex, transform }
  }

  /** Register an OSC feedback address that should update an encoder value. */
  registerFeedback(oscAddress, encoderIndex, transformRule = {}) {
    if (encoderIndex < 1 || encoderIndex > 4) return;
    this.feedbackRules.set(oscAddress, {
      encoderIndex,
      inputRange: transformRule.inputRange || [0, 1],
      outputRange: transformRule.outputRange || [0, 1],
    });
  }

  /** Process an inbound OSC message, extract encoder values if matched. */
  handleOscMessage(msg) {
    if (!msg || !msg.address) return;
    const rule = this.feedbackRules.get(msg.address);
    if (!rule) return;
    if (!Array.isArray(msg.args) || !msg.args.length) return;
    const rawVal = Number(msg.args[0]);
    if (isNaN(rawVal)) return;
    // Normalize: map from input range to 0-1
    const [inMin, inMax] = rule.inputRange;
    const [outMin, outMax] = rule.outputRange;
    let normalized = (rawVal - inMin) / (inMax - inMin);
    normalized = Math.max(0, Math.min(1, normalized));  // clamp to 0-1
    // Scale to output range
    const value = outMin + normalized * (outMax - outMin);
    this.values.set(rule.encoderIndex, value);
  }

  /** Get all encoder values as a Map for the renderer. */
  getValues() {
    return this.values;
  }

  /** Clear all tracked values. */
  clear() {
    this.values.clear();
  }
}

async function main() {
  const config = new ConfigStore(CONFIG_PATH);
  await config.load();

  const diagnostics = new Diagnostics({ maxEvents: 500 });
  const wsHub = new WsHub();
  const feedbackTracker = new FeedbackTracker();

  const osc = new OscClient(config.get('osc'), { log: (m) => wsHub.log('osc', m) });
  osc.setLimits(config.get('oscLimits') || {});
  const ma3lua = new Ma3LuaClient(config.get('ma3lua'), { log: (m) => wsHub.log('ma3lua', m) });

  // Console driver — picks the right protocol layer for the configured
  // console (MA3, Eos, MagicQ, etc.). Engine actions like encoderTick +
  // bankSelect route through this driver instead of MA3-specific code.
  // Default ma3 keeps backwards compat. Driver doesn't replace ma3lua;
  // for MA3 it WRAPS it. For Eos / others, it owns its own OSC dialect.
  const { loadDriver } = require('./core/console-drivers');
  const consoleId = config.get('console') || 'ma3';
  let consoleDriver;
  if (consoleId === 'ma3') {
    // Reuse the existing ma3lua client so we don't double-connect
    const Ma3Driver = require('./core/console-drivers/ma3-driver');
    consoleDriver = new Ma3Driver({ existingClient: ma3lua }, { log: (m) => wsHub.log('console', m) });
  } else {
    consoleDriver = loadDriver(consoleId, {
      host: config.get('eos.host') || '127.0.0.1',
      port: config.get('eos.port') || 8000,
      localPort: config.get('eos.localPort') || 8002,
      user: config.get('eos.user') || 1,
      useCustomEncoderMap: !!config.get('eos.useCustomEncoderMap'),
      autoFillFromEos: !!config.get('eos.autoFillFromEos'),
      encoderParams: config.get('eos.encoderParams') || null,
      encoderParamsByCategory: config.get('eos.encoderParamsByCategory') || null,
    }, { log: (m) => wsHub.log('console', m) });
  }
  if (consoleDriver && typeof consoleDriver.connect === 'function') {
    consoleDriver.connect().catch((err) => wsHub.log('console', `connect failed: ${err && err.message}`));
  }
  wsHub.log('console', `loaded driver: ${consoleId}`);
  const sdhid = new StreamDeckHID(
    { deviceIndex: config.get('streamDeck.deviceIndex') || 0 },
    { log: (m) => wsHub.log('sdhid', m) }
  );

  // Page-aware encoder overlay. Either user-driven (UI button or SD+ key)
  // or driven by MA3MapperWatcher.lua. Engine consults overlayMappings()
  // before user mappings.
  const pageBinder = new PageBinder({
    config,
    // v0.13.6: pass `console` so page-binder can subscribe to non-MA3
    // drivers' encoderBar events. Without it, the v0.13.5 "if non-MA3
    // skip ma3lua poll" branch was never entered (this.transports.console
    // was undefined), and Eos users got "waiting on bridge" forever.
    transports: { osc, ma3lua, console: consoleDriver },
    hooks: {
      log: (m) => wsHub.log('pagebinder', m),
      onChange: () => {
        if (sdRenderer) sdRenderer.renderAll(engine.mappings());
        wsHub.broadcast({ type: 'pageBinder', payload: pageBinder.status() });
      },
    },
  });

  const engine = new MappingEngine({
    config,
    transports: { osc, ma3lua, pageBinder, console: consoleDriver },
    onEvent: (e) => wsHub.broadcast({ type: 'event', payload: e }),
  });
  engine.onModeChange = () => { if (sdRenderer) sdRenderer.renderAll(engine.mappings()); };

  // Inbound OSC from controllers OR from MA3 (we listen on one port; messages
  // are tagged with source IP so the engine can distinguish).
  osc.on('message', (msg) => {
    engine.handleInbound('osc', msg);
    feedbackTracker.handleOscMessage(msg);  // Track feedback values for LCD bars
  });
  osc.on('error', (err) => wsHub.log('osc', `error: ${err && err.message}`));

  await osc.start();

  // Path B: try to claim a Stream Deck via USB-HID. Quietly no-ops if the
  // optional dep isn't installed or no device is present.
  const claimed = await sdhid.open(({ address, args }) => engine.handleInbound('osc', { address, args, fromMa3: false, from: 'sdhid' }));
  let sdRenderer = null;
  if (claimed) {
    sdRenderer = new StreamDeckRenderer(sdhid, { log: (m) => wsHub.log('sdrender', m) });
    if (!sdRenderer.hasText()) {
      wsHub.log('sdrender', 'text labels disabled — install @napi-rs/canvas to enable: npm install @napi-rs/canvas');
    }
    sdRenderer.setConsoleId(consoleId);   // v0.13.5: switch label vocabulary per console
    config.onChange(() => {
      sdRenderer.setConsoleId(config.get('console') || 'ma3');
      sdRenderer.renderAll(engine.mappings());
    });
    await maybeAutoMapEncoders(config, wsHub);
    sdRenderer.renderAll(engine.mappings());
    // Periodic health refresh to the LCD strip (every 1s).
    // Wrapped: a HID hiccup must NOT crash the whole server.
    setInterval(() => {
      try {
        // If the SD+ has gone offline (yanked, sleep, firmware glitch), the
        // hid module marks itself dead and renderAll short-circuits. Don't
        // even build the snapshot in that case — it's pointless.
        if (sdhid._dead || !sdhid.device) {
          sdRenderer.setHealth({
            traffic: osc.trafficStats(),
            bridge: ma3lua.status().bridgeStats,
            luaConnected: ma3lua.connected,
            sdConnected: false,
          });
          return;
        }
        const luaStatus = ma3lua.status();
        sdRenderer.setHealth({
          traffic: osc.trafficStats(),
          bridge: luaStatus.bridgeStats,
          luaConnected: ma3lua.connected,
          sdConnected: true,
          ma3Version: luaStatus.ma3Version,
          bridgeVersion: luaStatus.bridgeVersion,
          bridgeOutdated: luaStatus.bridgeOutdated,
          appVersion: require('../package.json').version,
        });
        sdRenderer.setCurrentPage(pageBinder.currentPage());
        // Live attribute name per encoder slot, from the bridge poll.
        sdRenderer.setEncoderBarSlots(pageBinder.encoderBarSlots());
        // Why the slots are empty, if they are. Lets the LCD show
        // "OLD BRIDGE" / "SELECT FIXTURES" / etc instead of "—".
        sdRenderer.setEncoderBarReason(pageBinder.encoderBarReason());
        // Real-time feedback values for LCD value bars.
        sdRenderer.setEncoderValues(feedbackTracker.getValues());
        // renderAll is async — chain a catch so a rejection from a stale
        // device handle doesn't escape as an unhandledRejection.
        const p = sdRenderer.renderAll(engine.mappings());
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            try { wsHub.log('sdrender', `render skipped: ${err && err.message}`); } catch (_) {}
            if (sdhid && typeof sdhid._markDead === 'function') sdhid._markDead(err && err.message);
          });
        }
      } catch (err) {
        try { wsHub.log('sdrender', `render tick failed: ${err && err.message}`); } catch (_) {}
        if (sdhid && typeof sdhid._markDead === 'function') sdhid._markDead(err && err.message);
      }
    }, 1000);
  }

  // Option 2: connect to MA3 Lua plugin if enabled. Currently a stub
  // pending the plugin shipping (see docs/ma3-plugin/).
  if (config.get('ma3lua.enabled')) {
    ma3lua.connect().catch((err) => wsHub.log('ma3lua', `connect failed: ${err.message}`));
  }
  // Stats poll: 30s (was 5s). MA3 doesn't need to be queried often;
  // health pill updates from local /api/health which doesn't hit MA3.
  ma3lua.startStatsPoll(30000);

  // Live encoder poll: keeps SD+ encoders in sync with MA3's actual
  // encoder bar contents (changes when you select different fixtures or
  // change banks from MA3 directly). 2s interval.
  pageBinder.transports = pageBinder.transports || {};
  pageBinder.transports.ma3lua = ma3lua;
  // Disabled: getAttrs (GetAttributeByUIChannel) returns fixture UI channels
  // not the live encoder bar contents. We can re-enable when we find the
  // right MA3 API for live encoder slots.
  // pageBinder.startLivePoll(2000);
  pageBinder.startFeaturePoll(2000);
  // Live encoder-bar attribute names from the bridge (1Hz). Powers the
  // per-slot labels on the SD+ LCD strip.
  pageBinder.startEncoderBarPoll(1000);
  // v0.7: poll for current fixture type to scope encoder stacks per fixture.
  pageBinder.startFixtureTypePoll(2000);

  const { httpServer } = startHttpServer({
    config,
    engine,
    transports: { osc, ma3lua, sdhid, pageBinder, console: consoleDriver },
    wsHub,
    diagnostics,
  });

  wsHub.attach(httpServer);

  const port = config.get('http.port') || 8733;
  httpServer.listen(port, () => {
    console.log(`\n  ENCpatch running`);
    console.log(`  Open http://localhost:${port} to configure mappings.\n`);
  });

  // v0.13.20: Graceful shutdown. Must close EVERY resource that keeps
  // the Node event loop alive — UDP sockets, TCP sockets, HID claims,
  // HTTP server, WebSocket hub, and any setInterval/setTimeout the
  // subsystems hold. The Eos driver's 250ms subscribe-refresh timer
  // was the proximate cause of the "needs force quit" problem in
  // v0.13.17+; before that the long-poll loops did similar damage.
  const shutdown = async () => {
    console.log('\nShutting down...');
    try { if (consoleDriver && typeof consoleDriver.disconnect === 'function') await consoleDriver.disconnect(); } catch (_) {}
    try { if (pageBinder && typeof pageBinder.stopEncoderBarPoll === 'function') pageBinder.stopEncoderBarPoll(); } catch (_) {}
    try { if (pageBinder && typeof pageBinder.stopFixtureTypePoll === 'function') pageBinder.stopFixtureTypePoll(); } catch (_) {}
    try { if (pageBinder && typeof pageBinder.stopLivePoll === 'function') pageBinder.stopLivePoll(); } catch (_) {}
    try { await osc.stop(); } catch (_) {}
    try { ma3lua.disconnect(); } catch (_) {}
    try { await sdhid.close(); } catch (_) {}
    try { if (wsHub && typeof wsHub.close === 'function') wsHub.close(); } catch (_) {}
    try { httpServer.close(); } catch (_) {}
    // Don't process.exit(0) — let the event loop drain naturally now
    // that all resources are released. process.exit kills any in-flight
    // OSC sends mid-flight; the natural drain finishes them.
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // v0.13.20: Expose the shutdown handle so the Electron main process
  // can call it on `before-quit`. Without this, Cmd+Q leaves the
  // background timers and sockets alive and the app needs force-quit.
  // Note: this assignment happens inside main() AFTER the resources are
  // wired; the Electron startup script awaits ~800ms post-require to
  // ensure this property is set before any quit handler can fire.
  module.exports.shutdown = shutdown;
}

/**
 * If the user has zero `/sd/enc/N` and `/sd/key/N` mappings, load the
 * starter preset (4 encoders) AND auto-add 6 page-select keys (1=Dimmer,
 * 2=Position, 3=Gobo, 4=Color, 5=Beam, 6=Control). Won't touch any
 * existing mappings.
 */
async function maybeAutoMapEncoders(config, wsHub) {
  const fs = require('fs');
  const list = config.listMappings();
  const haveEnc = list.some((m) => m.trigger && /^\/sd\/enc\//.test(m.trigger.match || ''));
  const haveKey = list.some((m) => m.trigger && /^\/sd\/key\//.test(m.trigger.match || ''));
  let added = 0;

  if (!haveEnc) {
    // Bridge-tick is the right default — fixture-agnostic, follows MA3's
    // live encoder bar. Falls back to the static cmd-tick preset only if
    // bridge-tick file is missing (older installs).
    const bridgePath = path.join(__dirname, '..', 'data', 'presets', 'bridge-tick-encoders.json');
    const fallbackPath = path.join(__dirname, '..', 'data', 'presets', 'ma3-attribute-encoders.json');
    const presetPath = fs.existsSync(bridgePath) ? bridgePath : fallbackPath;
    if (fs.existsSync(presetPath)) {
      try {
        const j = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
        for (const m of j.mappings || []) { config.upsertMapping(m); added++; }
        wsHub.log('automap', `loaded encoder preset: ${path.basename(presetPath)}`);
      } catch (err) { wsHub.log('automap', `encoder preset failed: ${err.message}`); }
    }
  }

  if (!haveKey) {
    // Default SD+ key layout: all 8 keys = feature group selectors.
    // Sub-page nav lives on the LCD swipe gesture (left/right) instead.
    const attrsPath = path.join(__dirname, '..', 'data', 'ma3-attributes.json');
    try {
      const attrs = JSON.parse(fs.readFileSync(attrsPath, 'utf8'));
      const order = attrs.bankOrder || [];
      for (let i = 0; i < Math.min(order.length, 8); i++) {
        const page = order[i];
        config.upsertMapping({
          name: `Page: ${page}`,
          enabled: true,
          trigger: { type: 'osc', match: `/sd/key/${i + 1}` },
          transform: { onlyOn: 1 },
          action: { type: 'setPage', page },
        });
        added++;
      }
    } catch (err) { wsHub.log('automap', `page-key preset failed: ${err.message}`); }
  }

  if (added > 0) {
    await config.save();
    wsHub.log('automap', `auto-mapped ${added} mapping(s) on first SD+ claim`);
  }
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
