/**
 * MappingEngine — the heart of the app.
 *
 * A "mapping" is a rule that connects a SOURCE event to a TARGET action,
 * optionally with a value transform and reverse "feedback" rule.
 *
 * Mapping shape (see mappings.example.json):
 * {
 *   id: "m_abc123",
 *   name: "Stream Deck button 1 -> Exec 201 Go",
 *   enabled: true,
 *   trigger: {
 *     type: "osc",                      // 'osc' | 'telnet' | 'internal'
 *     match: "/sd/page1/btn1",          // exact OSC address (or RegExp string in /.../)
 *     fromHost: null                    // optional: only accept if it came from this IP
 *   },
 *   transform: {
 *     // Operations applied to the first arg (or args[fromArgIndex])
 *     fromArgIndex: 0,
 *     inputRange: [0, 1],
 *     outputRange: [0, 1],
 *     curve: "linear",                  // 'linear' | 'log' | 'exp' | 'invert'
 *     onlyOn: null                      // optional: only fire when value === this
 *   },
 *   action: {
 *     type: "osc",                      // 'osc' | 'telnet' | 'multi'
 *     // For type=osc:
 *     address: "/Page1/Fader201",
 *     argType: "f"                      // 'f' | 'i' | 's' | 'T' | 'F' (unit toggles)
 *     // For type=telnet:
 *     // command: "Go Sequence 1"
 *     // For type=multi:
 *     // actions: [ ...nested action objects ]
 *   },
 *   feedback: {                         // optional reverse mapping
 *     enabled: true,
 *     ma3Source: { type: "osc", match: "/Page1/Fader201" },
 *     transform: { inputRange: [0, 1], outputRange: [0, 1], curve: "linear" },
 *     destination: {
 *       type: "osc",
 *       host: "127.0.0.1",
 *       port: 9000,
 *       address: "/sd/page1/btn1/state",
 *       argType: "f"
 *     }
 *   }
 * }
 */

class MappingEngine {
  constructor({ config, transports, onEvent }) {
    this.config = config;
    this.transports = transports;
    this.onEvent = onEvent || (() => {});
  }

  mappings() {
    const user = this.config.listMappings().filter((m) => m.enabled !== false);
    const overlay = (this.transports && this.transports.pageBinder && this.transports.pageBinder.overlayMappings) ? this.transports.pageBinder.overlayMappings() : [];
    if (!overlay.length) return user;
    // bridgeTick mappings ALWAYS win — they're fixture-agnostic and don't
    // need an overlay. Skip overlay for any address the user has
    // explicitly mapped to bridgeTick.
    const userBridgeTick = new Set(
      user.filter((m) => m.action && m.action.type === 'bridgeTick' && m.trigger && m.trigger.match)
          .map((m) => m.trigger.match)
    );
    const filteredOverlay = overlay.filter((m) => !userBridgeTick.has(m.trigger && m.trigger.match));
    const overlayKeys = new Set(filteredOverlay.map((m) => m.trigger && m.trigger.match));
    return [
      ...filteredOverlay,
      ...user.filter((m) => !overlayKeys.has(m.trigger && m.trigger.match)),
    ];
  }

  /**
   * Called for every inbound event from any transport.
   * `transportName` is 'osc' or 'telnet'. `event` is transport-specific.
   */
  handleInbound(transportName, event) {
    // Page-binder gets first crack at OSC events (it consumes /ma3/currentpage).
    if (transportName === 'osc' && this.transports && this.transports.pageBinder) {
      const consumed = this.transports.pageBinder.consume(event);
      if (consumed) {
        this.onEvent({ direction: 'in', transport: 'pagebinder', event });
        return;
      }
    }
    // Encoder press → toggle that encoder's coarse/fine mode (then still
    // dispatch through normal triggers in case user has a press mapping).
    if (transportName === 'osc' && event && event.address) {
      const em = event.address.match(/^\/sd\/enc\/(\d+)\/press$/);
      if (em && Array.isArray(event.args) && Number(event.args[0]) === 1) {
        this._toggleEncoderMode(Number(em[1]));
      }
      // LCD short-press / tap on the encoder zone → advance that slot's
      // stacked-attribute pointer. Asks the bridge to filter the user's
      // configured list down to attributes that actually exist on the
      // current selection's first subfixture, then cycles through the
      // filtered list. Avoids "Failed:Attribute X" rejections when the
      // user's config has more entries than the fixture supports.
      const tm = event.address.match(/^\/sd\/lcd\/(\d+)\/touch$/);
      if (tm && Array.isArray(event.args)) {
        const x = Number(event.args[0]) || 0;
        const y = Number(event.args[1]) || 0;
        const slot = Math.min(4, Math.max(1, Math.floor(x / 200) + 1));
        // Fire async — handleInbound is sync but bridge filter is async.
        this._handleLcdTouchCycle(x, y, slot).catch((err) => {
          this.onEvent({ direction: 'in', transport: 'sdlcd', event: { lcdTouch: { error: err.message } } });
        });
      }
      // LCD swipe → page within current encoder bank. For MA3 this sends
      // "EncoderPage +/-" to the console. v0.13.34: for Eos (and other
      // non-MA3 drivers that implement nextCategoryPage/prevCategoryPage),
      // we page through the ENCpatch-side category param list — e.g.
      // Focus has Pan/Tilt on page 1 and X Focus/Y Focus/Z Focus/Position
      // MSpeed on page 2; swipe-right advances to page 2 and the SD's
      // LCD relabels with the new param set.
      // v0.13.36: relaxed regex — accept any path segment for the LCD
      // control id (was \d+; some SD library versions emit non-numeric
      // ids like "lcd-strip"). Also log every swipe so we can confirm
      // events are reaching the engine.
      const sm = event.address.match(/^\/sd\/lcd\/[^/]+\/swipe$/);
      if (sm && Array.isArray(event.args)) {
        const dir = String(event.args[0] || '').toLowerCase();
        this.onEvent({ direction: 'in', transport: 'sdhid', event: { lcdSwipe: dir, address: event.address } });
        if (dir === 'left' || dir === 'right') {
          const drv = this.transports && this.transports.console;
          const isMa3 = drv && drv.constructor && drv.constructor.id === 'ma3';
          if (!isMa3 && drv && typeof drv.nextCategoryPage === 'function') {
            const ok = (dir === 'right') ? drv.nextCategoryPage() : drv.prevCategoryPage();
            this.onEvent({ direction: 'out', transport: 'console', event: { driver: drv.constructor.id, categoryPage: dir, advanced: !!ok } });
          } else {
            const cfgKey = dir === 'right' ? 'pageBinder.subpageNextCommand' : 'pageBinder.subpagePrevCommand';
            const cmd = (this.config && this.config.get(cfgKey)) ||
              (dir === 'right' ? 'EncoderPage +' : 'EncoderPage -');
            if (this.transports.osc) {
              this.transports.osc.sendToMa3('/cmd', [{ type: 's', value: cmd }]);
              this.onEvent({ direction: 'out', transport: 'osc', event: { address: '/cmd', args: [cmd], note: 'swipe sub-page' } });
            }
          }
        }
      }
    }
    // Forward events that came FROM MA3 to feedback rules.
    if (transportName === 'osc' && event.fromMa3) {
      this._processFeedback(event);
    } else {
      this._processTriggers(transportName, event);
    }
    this.onEvent({ direction: 'in', transport: transportName, event });
  }

  _stepPage(delta) {
    const pb = this.transports.pageBinder;
    if (!pb) return;
    const pages = pb.pages();
    if (!pages.length) return;
    const cur = pb.currentPage();
    const idx = Math.max(0, pages.indexOf(cur));
    const next = ((idx + delta) % pages.length + pages.length) % pages.length;
    pb.setPage(pages[next]);
  }

  /**
   * Async handler for LCD-touch encoder cycling.
   *
   * v0.13.43: delegates the cycle to the bridge's cycleStack action,
   * which anchors on the LIVE encoder bar's base attribute for the slot
   * (sub-page aware since 0.13.42) and uses the user's configured list
   * only when it actually contains that slot's current base/active
   * attribute. The pre-0.13.43 desktop-side version cycled the config
   * list blind (keyed by feature+slot only) and force-set the sticky
   * via setSlotAttr — on MA3 sub-page 2 that snapped the wheel back to
   * the page-1 attribute (e.g. Pan while the bar showed X Focus).
   *
   * v0.7+: fixture-type-specific stacks still take precedence over the
   * global defaults when choosing the list we OFFER the bridge.
   */
  async _handleLcdTouchCycle(x, y, slot) {
    const lua = this.transports && this.transports.ma3lua;
    const pb = this.transports && this.transports.pageBinder;
    const feature = pb ? (pb.encoderBarFeature() || pb.currentPage()) : null;

    const stacks = (this.config && this.config.get('encoderStacks')) || {};
    const fixtureType = pb ? pb.fixtureType() : null;

    // Prefer fixture-type-specific stacks over global defaults
    let featStacks = {};
    if (fixtureType && stacks.byFixtureType && stacks.byFixtureType[fixtureType]) {
      featStacks = stacks.byFixtureType[fixtureType][feature] || {};
    }
    if (Object.keys(featStacks).length === 0) {
      featStacks = stacks[feature] || {};
    }
    const userList = featStacks[String(slot)] || [];

    if (!lua || !lua.connected) {
      // No bridge → nothing to cycle against (the sticky lives bridge-
      // side). Surface why instead of silently cycling a local index.
      this.onEvent({
        direction: 'in',
        transport: 'sdlcd',
        event: { lcdTouch: { x, y, slot, feature, userListLen: userList.length, source: 'noBridge', sentToBridge: false } },
      });
      return;
    }

    let reply = null;
    try {
      reply = await lua.query('cycleStack', {
        payload: { slot, dir: 1, list: userList },
        timeoutMs: 1500,
      });
    } catch (err) {
      this.onEvent({
        direction: 'in',
        transport: 'sdlcd',
        event: { lcdTouch: { x, y, slot, feature, error: err.message, source: 'bridgeTimeout', sentToBridge: true } },
      });
      return;
    }

    const nextName = (reply && reply.name) || '';
    // Instant LCD label update — the next 1 Hz getEncoderBar poll
    // confirms it (the bridge overlays the same sticky), this just
    // hides the poll latency.
    if (nextName && pb && typeof pb.noteSlotOverride === 'function') {
      pb.noteSlotOverride(slot, nextName);
    }

    this.onEvent({
      direction: 'in',
      transport: 'sdlcd',
      event: { lcdTouch: {
        x, y, slot, feature,
        userListLen: userList.length,
        nextName,
        stackIdx: reply && reply.idx,
        stackTotal: reply && reply.total,
        source: 'bridge',
        sentToBridge: true,
      }},
    });
  }

  _toggleEncoderMode(encoderIdx) {
    const addr = `/sd/enc/${encoderIdx}`;
    const list = this.mappings();
    let touched = false;
    for (const m of list) {
      if (m.trigger && m.trigger.match === addr) {
        m._encoderMode = (m._encoderMode === 'fine') ? 'coarse' : 'fine';
        touched = true;
        this.onEvent({ direction: 'mode', transport: 'engine', event: { encoder: encoderIdx, mode: m._encoderMode }, mapping: m.id });
      }
    }
    if (touched && this.onModeChange) this.onModeChange();
  }

  /**
   * Calculate velocity-based step multiplier for acceleration.
   * Tracks inter-tick timing to derive spin speed; faster spins get larger multipliers.
   * @param {object} m - mapping object
   * @param {number} value - tick value (1 or -1)
   * @returns {number} multiplier (1.0 to maxAccel), capped
   */
  _calcAccelerationMultiplier(m, value) {
    const config = m.transform || {};
    const accelConfig = config.acceleration || {};
    const enabled = accelConfig.enabled !== false; // default: enabled
    if (!enabled) return 1.0;

    const maxAccel = accelConfig.maxMultiplier ?? 10;
    const velocityTimeout = accelConfig.velocityTimeout ?? 500; // ms
    const now = Date.now();

    // Initialize velocity state if missing
    if (!m._velocityState) {
      m._velocityState = { lastTickTime: now, buffer: [] };
    }

    const state = m._velocityState;
    const timeSinceLast = now - state.lastTickTime;

    // If idle for too long, reset buffer
    if (timeSinceLast > velocityTimeout) {
      state.buffer = [];
    }

    // Record this tick's delta time and update last tick time
    if (timeSinceLast > 0) {
      state.buffer.push(timeSinceLast);
      // Keep only last 10 ticks in buffer (rolling window)
      if (state.buffer.length > 10) {
        state.buffer.shift();
      }
    }
    state.lastTickTime = now;

    // Calculate average inter-tick time
    if (state.buffer.length < 2) return 1.0; // need at least 2 ticks for velocity

    const avgDelta = state.buffer.reduce((a, b) => a + b, 0) / state.buffer.length;
    // Velocity: ticks per second. Higher velocity → faster spinner
    const ticksPerSecond = 1000 / avgDelta;

    // Map ticks-per-second to multiplier. Sensible defaults:
    // 1 tick/sec = 1.0x (no accel)
    // 5 ticks/sec = 2.0x (moderate spin)
    // 10+ ticks/sec = maxAccel (fast spin)
    // Formula: multiplier = 1 + (ticksPerSecond - 1) / targetTicksPerSecond
    const targetTicksPerSecond = accelConfig.targetTicksPerSecond ?? 5;
    let multiplier = 1.0 + Math.max(0, ticksPerSecond - 1) / targetTicksPerSecond;
    multiplier = Math.min(multiplier, maxAccel);

    return multiplier;
  }

  _processTriggers(transportName, event) {
    for (const m of this.mappings()) {
      const trig = m.trigger || {};
      if (trig.type !== transportName) continue;
      if (!this._matches(trig, event)) continue;

      // Check rate limiting before processing
      if (!this._checkRateLimit(m)) continue;

      const value = this._extractValue(m, event);
      if (m.transform && m.transform.onlyOn != null && value !== m.transform.onlyOn) continue;

      const transformed = this._applyOrAccumulate(m, value);
      if (transformed === SKIP) continue;
      this._dispatchAction(m.action, transformed, m);
    }
  }

  /**
   * Check if a mapping is allowed to dispatch now based on rate limiting.
   * @param {object} m - mapping object
   * @returns {boolean} true if dispatch is allowed, false if rate-limited
   */
  _checkRateLimit(m) {
    const config = m.transform || {};
    const maxTicksPerSecond = config.maxTicksPerSecond ?? null;

    // No rate limit configured
    if (!maxTicksPerSecond || maxTicksPerSecond <= 0) return true;

    const minIntervalMs = 1000 / maxTicksPerSecond;
    const now = Date.now();

    // Initialize rate-limit state if missing
    if (!m._rateLimitState) {
      m._rateLimitState = { lastDispatchTime: 0 };
    }

    const state = m._rateLimitState;
    const timeSinceLast = now - state.lastDispatchTime;

    // Allow dispatch if enough time has passed
    if (timeSinceLast >= minIntervalMs) {
      state.lastDispatchTime = now;
      return true;
    }

    // Rate-limited; skip this event
    return false;
  }

  _processFeedback(event) {
    for (const m of this.mappings()) {
      const fb = m.feedback;
      if (!fb || !fb.enabled) continue;
      const src = fb.ma3Source || {};
      if (src.type !== 'osc') continue;
      if (!this._matches(src, event)) continue;

      const value = (event.args && event.args[0] != null) ? event.args[0] : 0;
      // Sync our accumulator state to MA3's actual value so the next encoder
      // tick continues from where the fader really is.
      if (typeof value === 'number') m._state = value;
      const transformed = this._applyTransform(fb.transform, value);
      this._dispatchAction({ ...fb.destination }, transformed, m, true);
    }
  }

  /**
   * Coalesce repeated cmd-tick events. We accumulate magnitude per mapping
   * and flush after ~30 ms so spinning an encoder hits MA3 at a sane rate.
   * Single isolated ticks still feel instant.
   */
  _coalesceCmd(key, template, value, mapping) {
    if (!this._coalesce) this._coalesce = new Map();
    const entry = this._coalesce.get(key) || { sum: 0, template, mapping, timer: null };
    entry.sum += value;
    entry.template = template;
    entry.mapping = mapping;
    if (entry.timer) {
      this._coalesce.set(key, entry);
      return;
    }
    const FLUSH_MS = 30;
    entry.timer = setTimeout(() => this._flushCoalesce(key), FLUSH_MS);
    this._coalesce.set(key, entry);
  }

  /**
   * Coalesce bridge-tick events per encoder slot. Sum deltas over the
   * window, fire one tick per slot. Cuts the bridge call rate by ~3-5x
   * during a fast spin without losing any movement.
   */
  _coalesceBridgeTick(encoder, delta, mapping) {
    if (!this._bridgeCoalesce) this._bridgeCoalesce = new Map();
    const key = `enc${encoder}`;
    const entry = this._bridgeCoalesce.get(key) || { sum: 0, encoder, mapping, timer: null };
    entry.sum += delta;
    entry.encoder = encoder;
    entry.mapping = mapping;
    if (entry.timer) {
      this._bridgeCoalesce.set(key, entry);
      return;
    }
    const FLUSH_MS = 30;
    entry.timer = setTimeout(() => this._flushBridgeTick(key), FLUSH_MS);
    this._bridgeCoalesce.set(key, entry);
  }

  _flushBridgeTick(key) {
    const entry = this._bridgeCoalesce && this._bridgeCoalesce.get(key);
    if (!entry) return;
    this._bridgeCoalesce.delete(key);
    const { sum, encoder, mapping } = entry;
    if (sum === 0) return;
    const lua = this.transports && this.transports.ma3lua;
    if (!lua || !lua.connected) return;
    // Round to 4 decimals — Lua-side cmd is "Attribute X At + N.NNNN".
    const delta = Math.round(sum * 10000) / 10000;
    lua.send({ action: 'tick', encoder, delta });
    this.onEvent({
      direction: 'out',
      transport: 'ma3lua',
      event: { tick: { enc: encoder, delta, coalescedFrom: 'multi' } },
      mapping: mapping && mapping.id,
    });
  }

  _flushCoalesce(key) {
    const entry = this._coalesce && this._coalesce.get(key);
    if (!entry) return;
    this._coalesce.delete(key);
    const { sum, template, mapping } = entry;
    if (sum === 0) return;
    const sign = sum >= 0 ? '+' : '-';
    const absStr = (Math.round(Math.abs(sum) * 100) / 100).toString();
    const valStr = (Math.round(sum * 100) / 100).toString();
    const line = template
      .replace(/\$sign/g, sign)
      .replace(/\$abs/g, absStr)
      .replace(/\$value/g, valStr);
    try {
      this.transports.osc.sendToMa3('/cmd', [{ type: 's', value: line }]);
      this.onEvent({ direction: 'out', transport: 'osc', event: { address: '/cmd', args: [line] }, mapping: mapping && mapping.id });
    } catch (e) {
      this.onEvent({ direction: 'out', error: e.message, mapping: mapping && mapping.id });
    }
  }

  /** Returns the live state for a mapping (used by the visual builder). */
  stateFor(id) {
    const m = this.config.listMappings().find((x) => x.id === id);
    return m ? (m._state ?? null) : null;
  }

  _matches(trig, event) {
    const target = event.address || event.line || '';
    if (!trig.match) return false;
    if (trig.match.startsWith('/') && trig.match.length > 2 && trig.match.endsWith('/')) {
      // Regex form: "/^\/sd\/.*$/"
      try {
        const re = new RegExp(trig.match.slice(1, -1));
        if (!re.test(target)) return false;
      } catch (_) { return false; }
    } else if (trig.match !== target) {
      return false;
    }
    if (trig.fromHost && event.from && !event.from.startsWith(trig.fromHost)) return false;
    return true;
  }

  _extractValue(mapping, event) {
    if (event.args && event.args.length > 0) {
      const i = (mapping.transform && mapping.transform.fromArgIndex) || 0;
      return event.args[i] != null ? event.args[i] : event.args[0];
    }
    return event.line || 1; // bare trigger -> "1"
  }

  /**
   * Decide whether the trigger should produce a value at all, and if so what.
   * Adds two new modes on top of curve transforms:
   *   - 'accumulate' : SD+ encoder tick -> advance a 0..1 fader value
   *   - 'relay'      : SD+ encoder tick -> pass tick straight through (for
   *                    MA3 encoders that already accept relative deltas)
   * Returns SKIP if the event should be discarded.
   */
  _applyOrAccumulate(m, value) {
    const t = m.transform || {};
    if (t.mode === 'accumulate') {
      if (typeof value !== 'number') return SKIP;
      const step = t.step ?? 0.01;
      const [oLo, oHi] = t.outputRange || [0, 1];
      const cur = (typeof m._state === 'number') ? m._state : (t.initial ?? oLo);
      let next = cur + value * step;
      next = Math.max(oLo, Math.min(oHi, next));
      m._state = next;
      return next;
    }
    if (t.mode === 'relay') {
      if (typeof value !== 'number') return SKIP;
      const step = t.step ?? 1;
      return value * step;
    }
    if (t.mode === 'cmd-tick') {
      // Encoder tick → MA3 OSC /cmd. Returns the (signed) magnitude;
      // the action layer formats the actual command string.
      if (typeof value !== 'number' || value === 0) return SKIP;
      const fine = m._encoderMode === 'fine';
      const step = fine
        ? (t.fineStep ?? 0.1)
        : (t.coarseStep ?? t.step ?? 0.5);
      // Apply acceleration multiplier based on encoder spin velocity
      const accelMultiplier = this._calcAccelerationMultiplier(m, value);
      return value * step * accelMultiplier;
    }
    return this._applyTransform(t, value);
  }

  _applyTransform(t, value) {
    if (!t) return value;
    if (typeof value !== 'number') return value;
    let v = value;
    const [iLo, iHi] = t.inputRange || [0, 1];
    const [oLo, oHi] = t.outputRange || [0, 1];
    const span = (iHi - iLo) || 1;
    let norm = (v - iLo) / span;
    if (t.curve === 'invert') norm = 1 - norm;
    else if (t.curve === 'log') norm = norm <= 0 ? 0 : Math.log10(1 + 9 * norm);
    else if (t.curve === 'exp') norm = (Math.pow(10, norm) - 1) / 9;
    norm = Math.max(0, Math.min(1, norm));
    return oLo + norm * (oHi - oLo);
  }

  _dispatchAction(action, value, mapping, isFeedback = false) {
    if (!action || !action.type) return;
    try {
      if (action.type === 'osc') {
        const arg = coerceTyped(value, action.argType);
        if (action.host && action.port) {
          this.transports.osc.sendTo(action.address, [arg], action.host, action.port);
        } else {
          this.transports.osc.sendToMa3(action.address, [arg]);
        }
        this.onEvent({
          direction: 'out',
          transport: 'osc',
          event: { address: action.address, args: [valueOfTyped(arg)], host: action.host, port: action.port },
          mapping: mapping.id,
          isFeedback,
        });
      } else if (action.type === 'panic') {
        const sec = Number(action.seconds) || 5;
        if (this.transports.osc && this.transports.osc.panic) this.transports.osc.panic(sec);
        this.onEvent({ direction: 'out', transport: 'osc', event: { panic: true, seconds: sec }, mapping: mapping.id });
      } else if (action.type === 'setPage') {
        // Drive the page-binder for MA3 (handles bank-select cmd + overlay
        // rebinding). For other consoles, route through driver.bankSelect
        // which translates to the right protocol (e.g. /eos/key/intens).
        const pb = this.transports.pageBinder;
        const drv = this.transports.console;
        if (drv && drv.constructor.id !== 'ma3' && typeof drv.bankSelect === 'function') {
          // Other consoles: skip page-binder (MA3-specific), use driver
          drv.bankSelect(action.bankIdx || 1, action.page);
          this.onEvent({
            direction: 'out',
            transport: 'console',
            event: { driver: drv.constructor.id, bankSelect: action.page },
            mapping: mapping.id,
          });
        } else if (pb && action.page) {
          pb.setPage(action.page);
          this.onEvent({ direction: 'out', transport: 'pagebinder', event: { setPage: action.page }, mapping: mapping.id });
        }
      } else if (action.type === 'bridgeTick') {
        // Fixture-agnostic encoder tick. Routes through the active console
        // driver (MA3 / Eos / etc.) — driver translates to the right wire
        // format (Lua bridge for MA3, /eos/wheel/N for Eos, etc.).
        // Coalescing happens for MA3 only (its command parser floods);
        // Eos's UDP OSC tolerates higher rates fine.
        if (typeof value !== 'number' || value === 0) {
          // skip
        } else if (this.transports.console && this.transports.console.constructor.id === 'ma3') {
          // Existing MA3 path: coalesce + Lua bridge
          this._coalesceBridgeTick(action.encoder || 1, value, mapping);
        } else if (this.transports.console && typeof this.transports.console.encoderTick === 'function') {
          // Other consoles (Eos etc.) — direct OSC, no coalescing needed
          this.transports.console.encoderTick(action.encoder || 1, null, value);
          this.onEvent({
            direction: 'out',
            transport: 'console',
            event: { driver: this.transports.console.constructor.id, tick: { enc: action.encoder, delta: value } },
            mapping: mapping.id,
          });
        }
      } else if (action.type === 'cmd') {
        // Coalesce numeric (encoder tick) values within a small time window
        // so a fast spin produces ONE batched command instead of dozens.
        const tpl = action.template || action.command || '';
        if (typeof value === 'number') {
          this._coalesceCmd(mapping.id, tpl, value, mapping);
        } else {
          this.transports.osc.sendToMa3('/cmd', [{ type: 's', value: tpl }]);
          this.onEvent({ direction: 'out', transport: 'osc', event: { address: '/cmd', args: [tpl] }, mapping: mapping.id });
        }
      } else if (action.type === 'ma3lua') {
        const line = (action.command || '').replace(/\$value/g, String(value));
        const lua = this.transports.ma3lua;
        if (lua && lua.connected) {
          // Prioritize page/encoder bank changes over encoder ticks. Page changes
          // should preempt a flood of encoder adjustments for snappy UI response.
          const isPageChange = /\b(?:Select EncoderBank|Select Page|GoTo|Go Page)\b/i.test(line);
          const priority = isPageChange ? 0 : 10;  // 0=critical, 10=normal
          lua.cmd(line, priority);
          this.onEvent({ direction: 'out', transport: 'ma3lua', event: { line, sent: true }, mapping: mapping.id });
        } else {
          this.onEvent({ direction: 'out', transport: 'ma3lua', event: { line, sent: false, note: 'Lua plugin not connected' }, mapping: mapping.id });
        }
      } else if (action.type === 'multi' && Array.isArray(action.actions)) {
        for (const sub of action.actions) this._dispatchAction(sub, value, mapping, isFeedback);
      } else if (action.type === 'consoleKey') {
        // v0.13.12: route through the driver. Each console driver
        // implements hardkey(name) to send the appropriate key press —
        // for Eos that's /eos/key/<name> press+release; for MA3 it's
        // a Cmd("Pressed <Hardkey>"). This keeps the mapping config
        // console-agnostic — the user writes `consoleKey: live` and
        // ENCpatch translates per the active driver.
        const drv = this.transports && this.transports.console;
        if (drv && typeof drv.hardkey === 'function' && action.name) {
          drv.hardkey(action.name);
          this.onEvent({
            direction: 'out',
            transport: 'console',
            event: { driver: drv.constructor.id, hardkey: action.name },
            mapping: mapping.id,
          });
        } else {
          this.onEvent({
            direction: 'out',
            transport: 'console',
            event: { error: 'consoleKey action requires a driver with hardkey() method', name: action.name },
            mapping: mapping.id,
          });
        }
      }
    } catch (err) {
      this.onEvent({ direction: 'out', error: err.message, mapping: mapping.id });
    }
  }
}

const SKIP = Symbol('skip');

function coerceTyped(value, argType) {
  switch (argType) {
    case 'i': return { type: 'i', value: Math.round(Number(value) || 0) };
    case 's': return { type: 's', value: String(value) };
    case 'T': return { type: 'T' };
    case 'F': return { type: 'F' };
    case 'f':
    default:  return { type: 'f', value: Number(value) || 0 };
  }
}
function valueOfTyped(a) { return a && 'value' in a ? a.value : a.type; }

module.exports = MappingEngine;
