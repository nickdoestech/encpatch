/**
 * PageBinder — auto-rebinds SD+ encoders when MA3's encoder page changes.
 *
 * How it works
 * ------------
 * 1. The MA3MapperWatcher.lua plugin (running inside MA3) sends an OSC
 *    message to MA3 Mapper whenever the user changes the encoder feature
 *    group:   /ma3/currentpage  ,s  "Position"
 * 2. PageBinder catches that, looks up the page in `ma3-attributes.json`
 *    `pageMap`, and produces 4 *overlay* mappings for /sd/enc/1..4 that
 *    point at the right attributes.
 * 3. The MappingEngine consults the overlay BEFORE user mappings, so a
 *    user-pinned encoder mapping always wins. No mutations to config.json.
 *
 * Disable by setting `pageBinder.enabled = false` in config.
 */

const fs = require('fs');
const path = require('path');

const ATTRIBUTES_PATH = path.join(__dirname, '..', '..', 'data', 'ma3-attributes.json');

class PageBinder {
  constructor({ config, transports = {}, hooks = {} } = {}) {
    this.config = config;
    this.transports = transports;   // for sending MA3 bank-select commands
    this.log = hooks.log || (() => {});
    this.onChange = hooks.onChange || (() => {});
    this._pageMap = null;
    this._bankOrder = null;
    this._currentPage = null;
    this._overlay = [];   // computed mapping objects (runtime only)
    this._currentFixtureType = null;   // v0.7: fixture type for encoder stack scoping
    this._loadAttributes();
  }

  _loadAttributes() {
    try {
      const raw = fs.readFileSync(ATTRIBUTES_PATH, 'utf8');
      const j = JSON.parse(raw);
      this._filePageMap = j.pageMap || null;
      this._bankOrder = j.bankOrder || null;
      this._allAttrs = j.groups || [];
      // featureAliases: MA3's internal feature names → our page names.
      // e.g. MA3 says "PanTilt", we want "Position".
      this._featureAliases = j.featureAliases || {};
    } catch (err) {
      this.log(`could not load attribute map: ${err.message}`);
      this._filePageMap = null;
    }
  }

  /** Map a raw MA3 feature group name (e.g. "PanTilt") to our internal
   *  page name (e.g. "Position"). Returns input unchanged if no alias. */
  _aliasFeature(rawName) {
    if (!rawName) return rawName;
    const aliases = this._featureAliases || {};
    return aliases[rawName] || rawName;
  }

  /** Effective pageMap: user overrides from config merged on top of file defaults. */
  get _pageMap() {
    const override = (this.config && this.config.get('pageBinder.pageMap')) || {};
    return Object.assign({}, this._filePageMap || {}, override);
  }
  set _pageMap(_) { /* read-only — derived from config + file */ }

  /** Replace the user's per-page attribute map for one page. */
  async setPageAttrs(pageName, attrs) {
    if (!Array.isArray(attrs) || attrs.length === 0) return false;
    const padded = [attrs[0] || null, attrs[1] || null, attrs[2] || null, attrs[3] || null];
    const current = (this.config && this.config.get('pageBinder.pageMap')) || {};
    current[pageName] = padded;
    this.config.set('pageBinder.pageMap', current);
    if (this.config.save) await this.config.save();
    // If the active page is the one we changed, rebuild the overlay live.
    if (this._currentPage === pageName) {
      this._currentPage = null;
      this._setPage(pageName);
    } else {
      this.onChange();
    }
    return true;
  }

  /** Catalog of attributes for the UI dropdowns. */
  attributeCatalog() {
    if (!this._allAttrs) return [];
    const out = [];
    for (const grp of this._allAttrs) {
      for (const a of grp.attributes || []) out.push({ name: a.name, label: a.label, group: grp.group });
    }
    return out;
  }

  /** All page names known (for UI). Returns a list, in bank order if available. */
  pages() {
    if (this._bankOrder) return [...this._bankOrder];
    return this._pageMap ? Object.keys(this._pageMap) : [];
  }

  /**
   * User-driven page change. Updates the overlay AND sends the configured
   * bank-select command to MA3 so MA3 follows. Returns true on success.
   */
  setPage(name) {
    if (!this.enabled() || !this._pageMap || !this._pageMap[name]) {
      this.log(`setPage("${name}") rejected (unknown page or disabled)`);
      return false;
    }
    this._setPage(name);
    // Send bank-select to MA3
    const bank = this._bankFor(name);
    const tplRaw = (this.config && this.config.get('pageBinder.bankCommandTemplate')) || 'Select EncoderBank $bank';
    const line = tplRaw.replace(/\$bank/g, String(bank)).replace(/\$name/g, name);
    if (this.transports && this.transports.osc && bank) {
      try {
        this.transports.osc.sendToMa3('/cmd', [{ type: 's', value: line }]);
        this.log(`-> MA3: ${line}`);
      } catch (err) {
        this.log(`MA3 send failed: ${err.message}`);
      }
    }
    // Live attribute read: ask MA3 (via Lua bridge) what the encoder bar
    // actually shows now. Replaces the static pageMap if available.
    this._refreshLiveAttrs(name).catch(() => {});
    return true;
  }

  async _refreshLiveAttrs(pageName) {
    const lua = this.transports && this.transports.ma3lua;
    this._lastLiveStatus = null;
    if (!lua) {
      this._lastLiveStatus = 'no-ma3lua-transport';
      this.log(`live attrs: ma3lua transport not initialised — using static pageMap`);
      return;
    }
    if (!lua.connected) {
      this._lastLiveStatus = 'lua-not-connected';
      this.log(`live attrs: Lua bridge not connected — install MA3MapperBridge plugin to enable live encoder reading`);
      return;
    }
    // Two attempts: MA3 needs ~250-400ms to actually switch banks.
    // Use getEncoderBar (current bridge action) — getAttrs was the
    // pre-0.9 name and was removed in the bridge rewrite.
    let reply = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 1 ? 350 : 250));
      try {
        reply = await lua.query('getEncoderBar', { timeoutMs: 1500 });
        break;
      } catch (err) {
        this.log(`live attrs attempt ${attempt} failed: ${err.message}`);
        if (attempt === 2) {
          this._lastLiveStatus = 'query-timeout';
          return;
        }
      }
    }
    if (!reply) { this._lastLiveStatus = 'no-reply'; return; }
    if (reply.err) {
      this._lastLiveStatus = `lua-err:${reply.err}`;
      this.log(`live attrs: MA3 plugin error: ${reply.err}`);
      return;
    }
    // getEncoderBar returns { feature, slots:[a,b,c,d] }; old shape was
    // { attrs:[...] }. Accept either for backwards compat with old bridges.
    const rawList = Array.isArray(reply.slots) ? reply.slots
                  : Array.isArray(reply.attrs) ? reply.attrs
                  : null;
    if (!rawList) {
      this._lastLiveStatus = 'bad-reply-shape';
      this.log(`live attrs: malformed reply: ${JSON.stringify(reply).slice(0, 100)}`);
      return;
    }
    const liveAttrs = rawList.map((a) => (a == null || a === 'null' ? null : String(a)));
    if (!liveAttrs.some((a) => a)) {
      this._lastLiveStatus = 'all-empty';
      this.log(`live attrs: MA3 returned empty attrs — using static pageMap`);
      return;
    }
    this._lastLiveStatus = 'live';
    this.log(`live attrs from MA3: ${liveAttrs.map((a) => a || '—').join(', ')}`);
    this._buildOverlayFromAttrs(pageName, liveAttrs, true);
  }

  _buildOverlayFromAttrs(name, attrs, isLive = false) {
    this._overlay = [];
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (!attr) continue;
      this._overlay.push({
        id: `__page_${name}_${i + 1}`,
        name: `${name} → ${attr}${isLive ? ' (live)' : ''}`,
        enabled: true,
        _autoPage: true,
        _live: isLive,
        trigger: { type: 'osc', match: `/sd/enc/${i + 1}` },
        transform: { mode: 'cmd-tick', coarseStep: 0.5, fineStep: 0.1 },
        action: { type: 'cmd', template: `Attribute "${attr}" At $sign $abs` },
      });
    }
    this.onChange();
  }

  _bankFor(name) {
    if (!this._bankOrder) return null;
    const idx = this._bankOrder.indexOf(name);
    return idx >= 0 ? idx + 1 : null;
  }

  /**
   * Poll MA3 for the active feature group (Color/Beam/Position/etc.) via
   * the bridge's getCurrentFeature query. When MA3's feature group changes,
   * automatically switch to that page so the SD+ rebinds. Combined with
   * the per-page attribute editor, this gives full automatic page-following.
   */
  startFeaturePoll(intervalMs = 2000) {
    if (this._featureTimer) return;
    const tick = async () => {
      this._featureTimer = setTimeout(tick, intervalMs);
      const lua = this.transports && this.transports.ma3lua;
      if (!lua || !lua.connected) return;
      try {
        const r = await lua.query('getCurrentFeature', { timeoutMs: 1500 });
        const rawF = r && r.feature;
        // Translate MA3's internal name (e.g. "PanTilt") to our page
        // name (e.g. "Position") via the featureAliases table.
        const f = this._aliasFeature(rawF);
        if (f && f !== 'unknown' && f !== this._currentPage) {
          // Only set if we know about that page (have a pageMap entry)
          const map = this._pageMap || {};
          if (map[f]) {
            const note = (rawF !== f) ? ` (aliased from "${rawF}")` : '';
            this.log(`MA3 feature changed to "${f}"${note} — switching page`);
            this.setPage(f);
          } else {
            this.log(`MA3 feature "${rawF}" → "${f}" has no pageMap entry — not switching (add to data/ma3-attributes.json featureAliases)`);
          }
        }
      } catch (_) { /* poll silently */ }
    };
    this._featureTimer = setTimeout(tick, intervalMs);
  }
  stopFeaturePoll() {
    if (this._featureTimer) clearTimeout(this._featureTimer);
    this._featureTimer = null;
  }

  /**
   * Start polling MA3's live encoder bar contents. Keeps the SD+ encoders
   * in sync even when YOU change the bank / selection from MA3's screen
   * (not from mapper). Each poll is one tiny query through the bridge.
   * Cheap because the bridge is now event-driven (no MA3 stall).
   */
  startLivePoll(intervalMs = 2000) {
    if (this._liveTimer) return;
    const tick = async () => {
      this._liveTimer = setTimeout(tick, intervalMs);
      const lua = this.transports && this.transports.ma3lua;
      if (!lua || !lua.connected) return;
      try {
        const r = await lua.query('getAttrs', { timeoutMs: 1500 });
        if (!r || !Array.isArray(r.attrs)) return;
        const liveAttrs = r.attrs.map((a) => (a == null ? null : String(a)));
        // Only rebuild if attrs differ from current overlay.
        const cur = this._overlay.map((m) => {
          const tpl = (m.action && m.action.template) || '';
          const am = tpl.match(/Attribute "([^"]+)"/);
          return am ? am[1] : null;
        });
        // Pad cur to liveAttrs.length with nulls
        while (cur.length < liveAttrs.length) cur.push(null);
        const differ = liveAttrs.some((a, i) => a !== cur[i]) || cur.length > liveAttrs.length;
        if (differ) {
          // Use the current page name as the label key, or "Live" if none set
          const label = this._currentPage || 'Live';
          this.log(`live poll: bar changed to [${liveAttrs.map(a => a || '—').join(', ')}]`);
          this._buildOverlayFromAttrs(label, liveAttrs, true);
        }
      } catch (_) { /* ignore poll failures, just retry next tick */ }
    };
    this._liveTimer = setTimeout(tick, intervalMs);
  }
  stopLivePoll() {
    if (this._liveTimer) clearTimeout(this._liveTimer);
    this._liveTimer = null;
  }

  /**
   * Poll the bridge's getEncoderBar action — returns the live attribute
   * name for each of the 4 SD+ encoder slots based on MA3's current
   * selection + feature group. Cheap (~one TCP round-trip per second).
   * The renderer reads from encoderBarSlots() to label each LCD cell.
   */
  startEncoderBarPoll(intervalMs = 1000) {
    if (this._encBarTimer) return;
    this._encoderBarSlots = this._encoderBarSlots || [null, null, null, null];
    this._encoderBarFeature = this._encoderBarFeature || null;
    this._encoderBarReason = this._encoderBarReason || 'noBridge';
    this._encBarPollInterval = intervalMs;

    // v0.13.5: when the active console isn't MA3, skip the ma3lua poll
    // and instead subscribe to the console driver's encoderBar events.
    // EosDriver (and the other OSC drivers, when they wire feedback) emits
    // 'encoderBar' with { feature, slots: [...] } whenever the console
    // sends back wheel updates over OSC. No polling needed.
    const drv = this.transports && this.transports.console;
    const isNonMa3 = drv && drv.constructor && drv.constructor.id !== 'ma3'
                       && drv.constructor.id !== 'abstract';
    if (isNonMa3) {
      this._subscribeConsoleEncoderBar(drv);
      return;
    }

    const tick = async () => {
      this._encBarTimer = setTimeout(tick, intervalMs);
      const lua = this.transports && this.transports.ma3lua;
      // Branch by reason so the LCD can show an actionable hint instead
      // of a blank cell. Five states the user might be in:
      //   noBridge     — bridge not connected
      //   oldBridge    — bridge connected but pre-0.9 (no getEncoderBar)
      //   noFeature    — bridge OK, no feature group active in MA3
      //   noSelection  — bridge OK, feature picked, but no fixtures selected
      //   ok           — slots populated normally
      let nextReason = 'ok';
      let nextSlots = [null, null, null, null];
      let nextFeature = null;

      if (!lua || !lua.connected) {
        nextReason = 'noBridge';
      } else if (lua.bridgeOutdated) {
        nextReason = 'oldBridge';
      } else {
        try {
          const r = await lua.query('getEncoderBar', { timeoutMs: 1500 });
          if (!r) {
            nextReason = 'noBridge';     // socket dropped mid-poll
          } else if (r.err || !Array.isArray(r.slots)) {
            // New bridge always returns slots[]; missing it = old bridge
            nextReason = 'oldBridge';
          } else {
            const slots = r.slots;
            // Alias raw MA3 name ("PanTilt") → friendly name ("Position")
            const feature = this._aliasFeature(r.feature || null);
            nextFeature = feature;
            nextSlots = [slots[0] ?? null, slots[1] ?? null, slots[2] ?? null, slots[3] ?? null];
            if (!feature) nextReason = 'noFeature';
            else if (nextSlots.every((s) => !s || s === 'null')) nextReason = 'noSelection';
            else nextReason = 'ok';
          }
        } catch (_) {
          nextReason = 'noBridge';
        }
      }

      const same = nextReason === this._encoderBarReason
                && nextFeature === this._encoderBarFeature
                && nextSlots.every((v, i) => v === this._encoderBarSlots[i]);
      if (!same) {
        this._encoderBarSlots = nextSlots;
        this._encoderBarFeature = nextFeature;
        this._encoderBarReason = nextReason;
        this.onChange();
      }
    };
    this._encBarTimer = setTimeout(tick, intervalMs);
  }
  /**
   * v0.13.6: subscribe to a non-MA3 console driver's `encoderBar` event.
   * Idempotent (detaches prior handler before re-binding) so it's safe
   * to call from rebindConsole() during a hot-swap.
   */
  _subscribeConsoleEncoderBar(drv) {
    if (!drv) return;
    if (this._consoleBarHandler && this._consoleBarSubject && typeof this._consoleBarSubject.removeListener === 'function') {
      try { this._consoleBarSubject.removeListener('encoderBar', this._consoleBarHandler); } catch (_) {}
    }
    this._encoderBarReason = drv.connected ? 'noSelection' : 'noConsole';
    const onConsoleBar = (payload) => {
      const slots = (payload && Array.isArray(payload.slots)) ? payload.slots : [null, null, null, null];
      const feature = (payload && payload.feature) || null;
      const nextReason = slots.every((s) => !s) ? 'noSelection' : 'ok';
      const same = nextReason === this._encoderBarReason
                && feature === this._encoderBarFeature
                && slots.every((v, i) => v === this._encoderBarSlots[i]);
      if (!same) {
        this._encoderBarSlots = [slots[0] ?? null, slots[1] ?? null, slots[2] ?? null, slots[3] ?? null];
        this._encoderBarFeature = feature;
        this._encoderBarReason = nextReason;
        this.onChange();
      }
    };
    try { drv.on('encoderBar', onConsoleBar); } catch (_) {}
    this._consoleBarHandler = onConsoleBar;
    this._consoleBarSubject = drv;
    // Cancel any active MA3 poll loop — this driver is event-driven now.
    if (this._encBarTimer) { clearTimeout(this._encBarTimer); this._encBarTimer = null; }
    this.onChange();
  }

  /**
   * v0.13.6: called by /api/settings hot-swap when the console driver
   * is replaced mid-session. Detaches old subscription, attaches to
   * new one (or restarts the MA3 poll if the new driver is ma3).
   */
  rebindConsole() {
    const drv = this.transports && this.transports.console;
    const isNonMa3 = drv && drv.constructor && drv.constructor.id !== 'ma3'
                       && drv.constructor.id !== 'abstract';
    if (isNonMa3) {
      this._subscribeConsoleEncoderBar(drv);
    } else {
      // Detach console subscription if any, restart MA3 poll
      if (this._consoleBarHandler && this._consoleBarSubject && typeof this._consoleBarSubject.removeListener === 'function') {
        try { this._consoleBarSubject.removeListener('encoderBar', this._consoleBarHandler); } catch (_) {}
      }
      this._consoleBarHandler = null;
      this._consoleBarSubject = null;
      this._encoderBarReason = 'noBridge';
      this._encoderBarSlots = [null, null, null, null];
      this._encoderBarFeature = null;
      this.onChange();
      // Re-arm the poll loop. startEncoderBarPoll is idempotent (returns if
      // _encBarTimer already exists), so clear first then start fresh.
      if (this._encBarTimer) { clearTimeout(this._encBarTimer); this._encBarTimer = null; }
      this.startEncoderBarPoll(this._encBarPollInterval || 1000);
    }
  }

  stopEncoderBarPoll() {
    if (this._encBarTimer) clearTimeout(this._encBarTimer);
    this._encBarTimer = null;
  }
  encoderBarSlots() {
    return this._encoderBarSlots ? this._encoderBarSlots.slice() : [null, null, null, null];
  }
  /**
   * v0.13.43: instant LCD label update after a bridge-side stack cycle.
   * The next getEncoderBar poll confirms it (the bridge overlays the
   * same sticky), so this is latency hiding, not state ownership.
   */
  noteSlotOverride(slot, name) {
    if (!this._encoderBarSlots) this._encoderBarSlots = [null, null, null, null];
    const i = Number(slot) - 1;
    if (i >= 0 && i < 4 && name && this._encoderBarSlots[i] !== String(name)) {
      this._encoderBarSlots[i] = String(name);
      this.onChange();
    }
  }
  encoderBarFeature() {
    return this._encoderBarFeature || null;
  }
  encoderBarReason() {
    return this._encoderBarReason || 'noBridge';
  }

  /** v0.7: Start polling for the current fixture type (for encoder stack
   * scoping). Calls the bridge's getFixtureType action periodically to
   * detect when the selected fixture changes and auto-recall fixture-type-
   * specific encoder stacks. Cheap (~one TCP round-trip per 2 seconds). */
  startFixtureTypePoll(intervalMs = 2000) {
    if (this._fixtureTypeTimer) return;
    this._currentFixtureType = this._currentFixtureType || null;
    this._fixtureTypePollInterval = intervalMs;

    const tick = async () => {
      this._fixtureTypeTimer = setTimeout(tick, intervalMs);
      const lua = this.transports && this.transports.ma3lua;
      if (!lua || !lua.connected) {
        if (this._currentFixtureType !== null) {
          this._currentFixtureType = null;
          this.onChange();
        }
        return;
      }
      try {
        const r = await lua.query('getFixtureType', { timeoutMs: 1500 });
        const nextType = (r && r.fixtureType) || null;
        if (nextType !== this._currentFixtureType) {
          this._currentFixtureType = nextType;
          if (nextType) {
            this.log(`fixture type changed to "${nextType}"`);
          }
          this.onChange();
        }
      } catch (_) {
        /* poll silently */
      }
    };
    this._fixtureTypeTimer = setTimeout(tick, intervalMs);
  }

  stopFixtureTypePoll() {
    if (this._fixtureTypeTimer) clearTimeout(this._fixtureTypeTimer);
    this._fixtureTypeTimer = null;
  }

  fixtureType() {
    return this._currentFixtureType || null;
  }

  /** Called by the engine for every inbound OSC event. Returns true if consumed. */
  consume(event) {
    if (!event || !event.address) return false;
    // Watcher-driven sync is opt-in (off by default for stability — MA3
    // doesn't need to be polled when mapper drives page changes itself).
    const watcherOn = this.config && this.config.get('pageBinder.useWatcher');
    // Heartbeat: track that the watcher is alive even when no page changes.
    if (event.address === '/ma3/heartbeat') {
      if (!watcherOn) return true;   // consume silently
      this._lastHeartbeat = Date.now();
      const raw = (event.args && event.args[0] != null) ? String(event.args[0]) : '';
      const name = raw.replace(/[^A-Za-z0-9 _\-]/g, '').slice(0, 64);
      if (name && name !== '?' && name !== this._currentPage && this.enabled()) {
        this._setPage(name);
      } else {
        this.onChange();
      }
      return true;
    }
    if (event.address !== '/ma3/currentpage') return false;
    if (!watcherOn) return true;          // consume silently when watcher disabled
    if (!this.enabled()) return true;
    try {
      const raw = (event.args && event.args[0] != null) ? String(event.args[0]) : '';
      const name = raw.replace(/[^A-Za-z0-9 _\-]/g, '').slice(0, 64);
      if (!name) return true;
      const now = Date.now();
      if (this._lastSeenAt && (now - this._lastSeenAt) < 50 && name === this._lastSeenName) return true;
      this._lastSeenAt = now; this._lastSeenName = name;
      this.log(`page event received: "${name}"`);
      this._setPage(name);
    } catch (err) {
      this.log(`consume error: ${err.message}`);
    }
    return true;
  }

  _setPage(name) {
    this._currentPage = name;
    const map = this._pageMap;
    if (!map) {
      this.log(`page changed to "${name}" but no pageMap loaded`);
      this._overlay = [];
      this.onChange();
      return;
    }
    const attrs = map[name];
    if (!attrs) {
      this.log(`no pageMap entry for "${name}" — clearing overlay`);
      this._overlay = [];
      this.onChange();
      return;
    }
    this._overlay = [];
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs[i];
      if (!attr) continue;
      this._overlay.push({
        id: `__page_${name}_${i + 1}`,
        name: `${name} → ${attr}`,
        enabled: true,
        _autoPage: true,
        trigger: { type: 'osc', match: `/sd/enc/${i + 1}` },
        transform: { mode: 'cmd-tick', coarseStep: 0.5, fineStep: 0.1 },
        action: { type: 'cmd', template: `Attribute "${attr}" At $sign $abs` },
      });
    }
    this.log(`page "${name}" → bound encoders: ${attrs.filter(Boolean).join(', ')}`);
    this.onChange();
  }

  /** Runtime-only mappings that overlay the user's config. */
  overlayMappings() {
    return this.enabled() ? this._overlay : [];
  }

  currentPage() { return this._currentPage; }

  enabled() {
    const v = this.config && this.config.get('pageBinder.enabled');
    return v === undefined ? true : !!v;  // default ON
  }

  status() {
    const ageSec = this._lastHeartbeat ? Math.round((Date.now() - this._lastHeartbeat) / 1000) : null;
    const map = this._pageMap;
    const isLiveOverlay = this._overlay.some((m) => m._live);
    return {
      enabled: this.enabled(),
      currentPage: this._currentPage,
      overlayCount: this._overlay.length,
      pagesKnown: map ? Object.keys(map) : [],
      watcherAlive: ageSec !== null && ageSec < 15,
      lastHeartbeatSecAgo: ageSec,
      attrSource: isLiveOverlay ? 'live' : (this._overlay.length ? 'static' : 'none'),
      lastLiveStatus: this._lastLiveStatus,
      // Live encoder bar (from getEncoderBar poll). Used by web UI's
      // Visual Builder to show the same attribute names as the LCD.
      encoderBarSlots: this.encoderBarSlots(),
      encoderBarFeature: this.encoderBarFeature(),
      encoderBarReason: this.encoderBarReason(),
    };
  }

  /** Full effective pageMap (file + user overrides) for the UI editor. */
  pageMap() {
    return JSON.parse(JSON.stringify(this._pageMap || {}));
  }
}

module.exports = PageBinder;
