/**
 * HTTP server: serves the static UI under /ui and a small JSON API under /api.
 *
 * REST endpoints:
 *   GET    /api/state                  - full snapshot (config + transport status + diagnostics summary)
 *   GET    /api/diagnostics            - crash/reconnect event log (query: ?transport=osc&limit=50)
 *   GET    /api/mappings               - list mappings
 *   POST   /api/mappings               - create or update (body = mapping object)
 *   DELETE /api/mappings/:id           - delete one
 *   POST   /api/settings               - patch network settings (body = partial config)
 *   POST   /api/test/osc               - send a test OSC message
 *   GET    /api/layouts                - all console + Stream Deck layout JSONs
 *   GET    /api/presets                - list saved preset files
 *   POST   /api/presets                - save current mappings as a named preset
 *   POST   /api/presets/load           - load a preset (replace or merge)
 *   POST   /api/inject                 - inject synthetic OSC (for plugin / web control)
 *   GET    /api/mappings/state         - live in-memory state per mapping (for visual builder)
 */

const path = require('path');
const http = require('http');
const fs = require('fs');
const express = require('express');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function loadLayouts(subdir) {
  const out = [];
  const dir = path.join(DATA_DIR, subdir);
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
    catch (e) { console.warn(`[layouts] skipping ${f}: ${e.message}`); }
  }
  return out;
}

function startHttpServer({ config, engine, transports, wsHub, diagnostics }) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  app.use('/', express.static(path.join(__dirname, '..', '..', 'ui')));

  // Bridge plugin download — friend-shareable. Serves the bundled
  // ENCpatchMA3Bridge.lua under a VERSIONED filename so:
  //   - MA3's plugin list shows "ENCpatchMA3Bridge-v0.9.12" → visual confirmation
  //   - re-imports won't collide with the previous version's row
  //   - user can spot a stale plugin instantly
  // Inline ?inline=1 returns it as text/plain (preview); default forces
  // attachment so the browser saves directly to ~/Downloads.
  let pkgVersion = '0.0.0';
  try { pkgVersion = require('../../package.json').version; } catch (_) {}
  const versionedFilename = `ENCpatchMA3Bridge-v${pkgVersion}.lua`;
  app.get('/api/bridge/ma3.lua', (req, res) => {
    // v0.13.41: try multiple resolution paths so this works whether
    // ENCpatch is running in dev (asar disabled, source on disk),
    // packaged (file inside app.asar — express.sendFile can't always
    // read from there), or extraResources-bundled (Contents/Resources
    // outside the asar, the most reliable location post-build).
    const candidates = [
      // extraResources copy — outside the asar, always served reliably
      process.resourcesPath && path.join(process.resourcesPath, 'ma3-plugin', 'ENCpatchMA3Bridge.lua'),
      // dev path — repo checkout
      path.join(__dirname, '..', '..', 'docs', 'ma3-plugin', 'ENCpatchMA3Bridge.lua'),
      // packaged path — inside asar (works via fs.readFileSync but not always sendFile)
      path.join(__dirname, '..', '..', 'app.asar', 'docs', 'ma3-plugin', 'ENCpatchMA3Bridge.lua'),
    ].filter(Boolean);
    let luaPath = null;
    for (const p of candidates) {
      try { if (fs.existsSync(p)) { luaPath = p; break; } } catch (_) {}
    }
    if (!luaPath) {
      return res.status(404).json({
        error: 'bridge file not bundled',
        triedPaths: candidates,
      });
    }
    // Read into memory and send directly — sidesteps express.sendFile's
    // asar incompatibility entirely.
    let content;
    try { content = fs.readFileSync(luaPath, 'utf8'); }
    catch (err) { return res.status(500).json({ error: err.message, path: luaPath }); }
    if (req.query.inline) {
      res.type('text/plain').send(content);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${versionedFilename}"`);
      res.type('text/plain').send(content);
    }
  });

  // Expose list of available console drivers for the welcome modal /
  // settings picker. Each entry: { id, displayName, macSupported,
  // defaultPort, isStub }.
  app.get('/api/consoles', (req, res) => {
    try {
      const { availableDrivers } = require('../core/console-drivers');
      res.json({ drivers: availableDrivers() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-discover encoder stacks from MA3's current selection. UI
  // "Auto-fill from selection" button calls this. Returns per-slot
  // attribute lists based on what's actually patched on the fixture.
  app.post('/api/bridge/discover-stacks', async (req, res) => {
    try {
      const lua = transports && transports.ma3lua;
      if (!lua || !lua.connected) {
        return res.status(503).json({ error: 'bridge not connected' });
      }
      const r = await lua.query('discoverAllSlots', { timeoutMs: 3000 });
      res.json(r);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Diagnostic: send probeStacked to bridge and return the result. Used
  // by Settings tab "Probe stacked attrs" button to dump current MA3
  // state for debugging tab-click tracking.
  app.post('/api/bridge/probe-stacked', async (req, res) => {
    try {
      const lua = transports && transports.ma3lua;
      if (!lua || !lua.connected) {
        return res.status(503).json({ error: 'bridge not connected' });
      }
      const r = await lua.query('probeStacked', { timeoutMs: 1500 });
      res.json(r);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/state', (req, res) => {
    res.json({
      version: '0.13.41',
      config: config.get(),
      osc: transports.osc.status(),
      health: {
        traffic: transports.osc.trafficStats(),
        bridge: transports.ma3lua && transports.ma3lua.status().bridgeStats,
      },
      ma3lua: transports.ma3lua ? transports.ma3lua.status() : { enabled: false, connected: false },
      sdhid: transports.sdhid ? transports.sdhid.status() : { connected: false },
      pageBinder: transports.pageBinder ? transports.pageBinder.status() : { enabled: false },
      // v0.13.1: surface the active console driver's status so the welcome
      // modal (and Settings tab) can show the green dot for non-MA3 paths.
      // For MA3 the relevant connection signal is `ma3lua` above; the
      // console driver wraps it. For Eos / others, this is the only signal.
      console: transports.console && typeof transports.console.status === 'function'
        ? transports.console.status()
        : { driver: 'none', connected: false },
      diagnostics: diagnostics ? diagnostics.getStatusSummary() : {},
    });
  });

  // Alias used by the welcome modal — same body as /api/settings but
  // semantically clearer ("save config snippet" vs "patch network
  // settings"). Implementation is identical; both flow through the
  // same handler so console-driver hot-reload happens either way.
  app.post('/api/config', async (req, res) => {
    return handleSettingsPatch(req, res);
  });

  app.get('/api/mappings', (req, res) => {
    res.json({ mappings: config.listMappings() });
  });

  // Effective view (overlay + user) for the UI encoder bar widget.
  app.get('/api/mappings/effective', (req, res) => {
    res.json({ mappings: engine.mappings ? engine.mappings() : config.listMappings() });
  });

  app.post('/api/mappings', async (req, res) => {
    const body = req.body || {};
    if (!body.trigger || !body.action) {
      return res.status(400).json({ error: 'mapping requires trigger and action' });
    }
    const saved = config.upsertMapping(body);
    await config.save();
    wsHub.broadcast({ type: 'mappings', payload: config.listMappings() });
    res.json({ mapping: saved });
  });

  app.delete('/api/mappings/:id', async (req, res) => {
    config.deleteMapping(req.params.id);
    await config.save();
    wsHub.broadcast({ type: 'mappings', payload: config.listMappings() });
    res.json({ ok: true });
  });

  // Shared handler for /api/settings + /api/config (the welcome modal uses
  // the latter alias). Patches config in-place, persists, then reconciles
  // any live transport that needs to react to the change (osc, ma3lua,
  // and the console driver itself if `console` was switched).
  async function handleSettingsPatch(req, res) {
    const patch = req.body || {};
    const consoleChanged = (
      typeof patch.console === 'string'
      && patch.console !== config.get('console')
    );
    // v0.13.38: detect any eos.* change so the driver picks up new opts
    // (autoFillFromEos toggle, host, port, user, encoderParamsByCategory).
    // Without this, the user could check "Auto-fill" in Settings → Save,
    // but the running EosDriver instance kept its constructor opts and
    // continued in fixed-param mode. Now any change to the eos.* block
    // triggers the same hot-swap path as a console flip.
    const eosOptsChanged = (
      patch.eos && typeof patch.eos === 'object'
      && config.get('console') === 'eos'
    );
    for (const [key, val] of Object.entries(patch)) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        for (const [k2, v2] of Object.entries(val)) {
          config.set(`${key}.${k2}`, v2);
        }
      } else {
        config.set(key, val);
      }
    }
    await config.save();
    transports.osc.reconfigure(config.get('osc'));
    // React to ma3lua enable/disable + host/port changes
    if (transports.ma3lua) {
      const newOpts = config.get('ma3lua') || {};
      transports.ma3lua.opts = newOpts;
      if (newOpts.enabled && !transports.ma3lua.connected) {
        transports.ma3lua.connect().catch((err) => wsHub.log('ma3lua', `connect failed: ${err.message}`));
      } else if (!newOpts.enabled && transports.ma3lua.connected) {
        transports.ma3lua.disconnect();
      }
    }
    // v0.13.1+v0.13.38: hot-swap the console driver if `console` was
    // switched OR if any eos.* opt was changed (so toggling autoFillFromEos,
    // editing the encoderParamsByCategory map, etc. all apply live).
    if ((consoleChanged || eosOptsChanged) && engine && engine.transports) {
      try {
        const old = engine.transports.console;
        if (old && typeof old.disconnect === 'function') {
          await old.disconnect();
        }
        const { loadDriver } = require('../core/console-drivers');
        const newId = config.get('console');
        let next;
        if (newId === 'ma3') {
          const Ma3Driver = require('../core/console-drivers/ma3-driver');
          next = new Ma3Driver(
            { existingClient: transports.ma3lua },
            { log: (m) => wsHub.log('console', m) }
          );
        } else {
          next = loadDriver(newId, {
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
        if (next && typeof next.connect === 'function') {
          next.connect().catch((err) => wsHub.log('console', `connect failed: ${err && err.message}`));
        }
        engine.transports.console = next;
        transports.console = next;
        // v0.13.6: page-binder also holds a reference; update it AND
        // re-bind the encoderBar event subscription so the LCD/labels
        // follow without an app restart.
        if (transports.pageBinder && transports.pageBinder.transports) {
          transports.pageBinder.transports.console = next;
          if (typeof transports.pageBinder.rebindConsole === 'function') {
            transports.pageBinder.rebindConsole();
          }
        }
        // v0.13.32: when switching TO Eos mid-session, force the
        // canonical Eos 8-button layout (Intensity / Color / Image /
        // Sneak / Focus / Shutter / Form / Query). Same flag-guarded
        // behavior as the startup migration so user customizations
        // after-the-fact don't get auto-restored.
        if (newId === 'eos' && !config.get('eosKeyLayoutV2')) {
          const KEY_LAYOUT = [
            { key: '/sd/key/1', name: 'Intensity', action: { type: 'setPage', page: 'Intensity' } },
            { key: '/sd/key/2', name: 'Color',     action: { type: 'setPage', page: 'Color'     } },
            { key: '/sd/key/3', name: 'Image',     action: { type: 'setPage', page: 'Image'     } },
            { key: '/sd/key/4', name: 'Sneak',     action: { type: 'consoleKey', name: 'sneak' } },
            { key: '/sd/key/5', name: 'Focus',     action: { type: 'setPage', page: 'Focus'     } },
            { key: '/sd/key/6', name: 'Shutter',   action: { type: 'setPage', page: 'Shutter'   } },
            { key: '/sd/key/7', name: 'Form',      action: { type: 'setPage', page: 'Form'      } },
            { key: '/sd/key/8', name: 'Query',     action: { type: 'consoleKey', name: 'query' } },
          ];
          for (const slot of KEY_LAYOUT) {
            const list = config.listMappings();
            const existing = list.find((m) => m && m.trigger && m.trigger.match === slot.key);
            const merged = {
              id: existing ? existing.id : `eos-key-${slot.key.split('/').pop()}`,
              name: slot.name, enabled: true,
              trigger: { type: 'osc', match: slot.key },
              transform: { onlyOn: 1 },
              action: slot.action,
            };
            config.upsertMapping(merged);
          }
          config.set('eosKeyLayoutV2', true);
          config.set('eosSneakQueryInjected', undefined);   // clean old flag
          await config.save();
          wsHub.broadcast({ type: 'mappings', payload: config.listMappings() });
          wsHub.log('console', 'Eos key layout: Intensity/Color/Image/Sneak/Focus/Shutter/Form/Query');
        }
        wsHub.log('console', `hot-swapped driver: ${newId}`);
      } catch (err) {
        wsHub.log('console', `driver swap failed: ${err && err.message}`);
      }
    }
    wsHub.broadcast({ type: 'config', payload: config.get() });
    res.json({ config: config.get() });
  }

  app.post('/api/settings', async (req, res) => {
    return handleSettingsPatch(req, res);
  });

  app.post('/api/test/osc', (req, res) => {
    const { address, value, argType, host, port } = req.body || {};
    if (!address) return res.status(400).json({ error: 'address required' });
    const arg = coerceTyped(value, argType);
    try {
      if (host && port) transports.osc.sendTo(address, [arg], host, Number(port));
      else transports.osc.sendToMa3(address, [arg]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/layouts', (req, res) => {
    const consoles = loadLayouts('consoles');
    const streamDecks = loadLayouts('streamdecks');
    // Prepend a "(connected)" entry for any hardware actually claimed.
    const sdStatus = transports.sdhid && transports.sdhid.status();
    if (sdStatus && sdStatus.connected) {
      // Reuse the matching emulator layout if we have one (sd-plus, sd-mk2…)
      const modelId = (sdStatus.model || '').toLowerCase();
      const match = streamDecks.find((d) => d.id.includes(modelId)) || streamDecks.find((d) => d.id === 'sd-plus');
      if (match) {
        const live = JSON.parse(JSON.stringify(match));
        live.id = `live-${match.id}`;
        live.name = `${sdStatus.productName || 'Stream Deck'} (CONNECTED)`;
        live.live = true;
        streamDecks.unshift(live);
      }
    }
    // Same idea for MA3 — flag it connected if we've recently received any
    // OSC packets from it.
    const oscStatus = transports.osc && transports.osc.status();
    if (oscStatus && oscStatus.lastMa3MessageAt && (Date.now() - oscStatus.lastMa3MessageAt < 30000)) {
      const onpc = consoles.find((c) => c.id === 'ma3-onpc');
      if (onpc) {
        const live = JSON.parse(JSON.stringify(onpc));
        live.id = 'live-ma3-onpc';
        live.name = 'grandMA3 onPC (CONNECTED)';
        live.live = true;
        consoles.unshift(live);
      }
    }
    res.json({ consoles, streamDecks });
  });

  app.post('/api/page/set', (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!transports.pageBinder) return res.status(500).json({ error: 'pageBinder not initialised' });
    const ok = transports.pageBinder.setPage(name);
    if (!ok) return res.status(400).json({ error: `unknown page "${name}"` });
    res.json({ ok: true, page: name });
  });

  // Devices: up to 3 mappable surfaces (Stream Decks / fader wings / etc.)
  app.get('/api/devices', (req, res) => {
    res.json({ devices: config.get('devices') || [] });
  });
  app.post('/api/devices', async (req, res) => {
    const { type, layoutId, name } = req.body || {};
    if (!type || !layoutId) return res.status(400).json({ error: 'type + layoutId required' });
    const list = config.get('devices') || [];
    if (list.length >= 3) return res.status(400).json({ error: 'max 3 devices' });
    const idx = list.length + 1;
    const slot = {
      id: `slot${Date.now().toString(36)}`,
      type, layoutId,
      addressPrefix: idx === 1 ? '/sd' : `/sd${idx}`,
      name: name || `Device ${idx}`,
    };
    list.push(slot);
    config.set('devices', list);
    await config.save();
    res.json({ device: slot, devices: list });
  });
  app.delete('/api/devices/:id', async (req, res) => {
    const list = (config.get('devices') || []).filter((d) => d.id !== req.params.id);
    config.set('devices', list);
    await config.save();
    res.json({ ok: true, devices: list });
  });

  app.get('/api/page/list', (req, res) => {
    res.json({
      pages: transports.pageBinder ? transports.pageBinder.pages() : [],
      current: transports.pageBinder ? transports.pageBinder.currentPage() : null,
    });
  });

  app.get('/api/page/map', (req, res) => {
    res.json({
      pageMap: transports.pageBinder ? transports.pageBinder.pageMap() : {},
      catalog: transports.pageBinder ? transports.pageBinder.attributeCatalog() : [],
    });
  });

  app.post('/api/page/map', async (req, res) => {
    const { name, attrs } = req.body || {};
    if (!name || !Array.isArray(attrs)) return res.status(400).json({ error: 'name + attrs[] required' });
    if (!transports.pageBinder) return res.status(500).json({ error: 'pageBinder not initialised' });
    const ok = await transports.pageBinder.setPageAttrs(name, attrs);
    if (!ok) return res.status(400).json({ error: 'invalid attrs' });
    res.json({ ok: true });
  });

  app.get('/api/attributes', (req, res) => {
    const p = path.join(DATA_DIR, 'ma3-attributes.json');
    if (!fs.existsSync(p)) return res.json({ groups: [] });
    try { res.json(JSON.parse(fs.readFileSync(p, 'utf8'))); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  // PANIC STOP — suppress all sends to MA3 for N seconds (default 5).
  app.post('/api/panic', (req, res) => {
    const seconds = Number(req.body && req.body.seconds) || 5;
    transports.osc.panic(seconds);
    wsHub.broadcast({ type: 'panic', payload: transports.osc.panicState() });
    res.json({ ok: true, ...transports.osc.panicState() });
  });

  // Compact health snapshot (used by topbar pill polling).
  app.get('/api/health', (req, res) => {
    res.json({
      traffic: transports.osc.trafficStats(),
      bridge: transports.ma3lua && transports.ma3lua.status().bridgeStats,
      luaConnected: transports.ma3lua && transports.ma3lua.connected,
      sdConnected: transports.sdhid && transports.sdhid.status().connected,
    });
  });

  // Send a Lua command to MA3 (via the running TCP plugin). Useful as a
  // test from the Settings tab to verify the bridge is reachable.
  app.post('/api/test/ma3lua', (req, res) => {
    const { command } = req.body || {};
    if (!command) return res.status(400).json({ error: 'command required' });
    if (!transports.ma3lua) return res.status(500).json({ error: 'ma3lua transport not initialised' });
    if (!transports.ma3lua.connected) return res.status(503).json({ error: 'not connected — enable + check plugin in MA3' });
    transports.ma3lua.cmd(command);
    res.json({ ok: true });
  });

  // Inject a synthetic OSC event into the engine. Used by the native
  // Stream Deck plugin (which can't speak UDP from a sandboxed context)
  // and any other in-process integrations.
  //
  // Two body shapes are accepted:
  //   1) { address: "/sd/enc/1", args: [1] }
  //        → matches against user mappings (legacy path; what the SD plugin uses)
  //   2) { action: { type: "bridgeTick", encoder: 1, delta: 1 } }
  //        → runs the action directly (the v0.13.1 path; what the
  //          Companion module uses so it doesn't need to know what
  //          OSC addresses the user has wired up).
  app.post('/api/inject', (req, res) => {
    const body = req.body || {};
    if (body.action && typeof body.action === 'object' && body.action.type) {
      // Action-shape — synthesize a stub mapping just to satisfy the
      // engine's dispatch signature and run it. value defaults to 1
      // (matches a typical encoder tick / button-down) but can be
      // overridden by `delta` for bridgeTick.
      const value = (typeof body.action.delta === 'number')
        ? body.action.delta
        : (typeof body.value === 'number' ? body.value : 1);
      const stubMapping = { id: '__inject__', name: 'inject', enabled: true };
      try {
        engine._dispatchAction(body.action, value, stubMapping, false);
        return res.json({ ok: true, mode: 'action' });
      } catch (err) {
        return res.status(500).json({ error: err && err.message });
      }
    }
    const { address, args = [] } = body;
    if (!address) return res.status(400).json({ error: 'address or action required' });
    engine.handleInbound('osc', { address, args, fromMa3: false, from: '127.0.0.1:0' });
    res.json({ ok: true, mode: 'osc' });
  });

  // Preset save/load: presets are JSON files in data/presets/.
  // Each file is { name, description, mappings: [...] }.
  const PRESETS_DIR = path.join(__dirname, '..', '..', 'data', 'presets');
  app.get('/api/presets', (req, res) => {
    if (!fs.existsSync(PRESETS_DIR)) return res.json({ presets: [] });
    const out = [];
    for (const f of fs.readdirSync(PRESETS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, f), 'utf8'));
        out.push({ file: f, name: meta.name || f, description: meta.description || '', count: (meta.mappings || []).length });
      } catch (_) {}
    }
    res.json({ presets: out });
  });
  app.post('/api/presets', async (req, res) => {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!fs.existsSync(PRESETS_DIR)) fs.mkdirSync(PRESETS_DIR, { recursive: true });
    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '_');
    const file = path.join(PRESETS_DIR, `${safeName}.json`);
    const payload = { name, description: req.body.description || '', mappings: config.listMappings() };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    res.json({ ok: true, file: path.basename(file) });
  });
  app.post('/api/presets/load', async (req, res) => {
    const { file, mode = 'replace' } = req.body || {};
    if (!file) return res.status(400).json({ error: 'file required' });
    const p = path.join(PRESETS_DIR, file);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'preset not found' });
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const incoming = data.mappings || [];
    if (mode === 'replace') config.set('mappings', incoming);
    else for (const m of incoming) config.upsertMapping(m);
    await config.save();
    wsHub.broadcast({ type: 'mappings', payload: config.listMappings() });
    res.json({ ok: true, count: incoming.length });
  });

  app.get('/api/mappings/state', (req, res) => {
    const list = config.listMappings().map((m) => ({
      id: m.id,
      state: (typeof m._state === 'number') ? m._state : null,
    }));
    res.json({ states: list });
  });

  // Diagnostics: crash + reconnect logging for troubleshooting
  app.get('/api/diagnostics', (req, res) => {
    if (!diagnostics) return res.status(503).json({ error: 'diagnostics not available' });
    const transport = req.query.transport || null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json({
      events: diagnostics.getEvents(transport, limit),
      summary: diagnostics.getStatusSummary(),
    });
  });

  const httpServer = http.createServer(app);
  return { app, httpServer };
}

function coerceTyped(value, argType) {
  switch (argType) {
    case 'i': return { type: 'i', value: Math.round(Number(value) || 0) };
    case 's': return { type: 's', value: String(value ?? '') };
    case 'T': return { type: 'T' };
    case 'F': return { type: 'F' };
    case 'f':
    default:  return { type: 'f', value: Number(value) || 0 };
  }
}

module.exports = startHttpServer;
