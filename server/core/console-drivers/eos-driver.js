/**
 * EosDriver — ETC Eos family (Eos / Element / Ion / Ti / Nomad).
 *
 * Pure OSC over UDP. ETC's OSC implementation is the cleanest in the
 * industry — well-documented, deterministic. No console-side plugin
 * needed (unlike MA3).
 *
 * Default ports:
 *   ENCpatch → Eos: UDP 8000 (Eos's "OSC RX Port")
 *   Eos → ENCpatch: UDP 8001 (Eos's "OSC TX Port", configurable in
 *                              Eos shell → Network → OSC settings)
 *
 * Reference: ETC Eos OSC reference doc (search "Eos OSC keys").
 * Verified syntax (as of Eos v3.x):
 *   /eos/wheel/<n>          float +1/-1     — encoder relative tick
 *   /eos/wheel/coarse/<n>   float +1/-1     — coarse mode tick
 *   /eos/wheel/fine/<n>     float +1/-1     — fine mode tick
 *   /eos/key/<keyname>      float 1.0/0.0   — softkey down/up
 *   /eos/cmd                string          — type into Eos command line
 *   /eos/newcmd             string          — clear + type into command line
 *   /eos/sub/<n>            float 0..1      — submaster value
 *
 * Eos exposes its current state by sending OSC messages back. We can
 * subscribe by sending /eos/subscribe = 1 once after connect.
 *
 * STATUS: skeleton only — has not been live-tested against an Eos
 * console. Expected to work but every console has surprises. Wrapped
 * in try/catch so failures don't crash the server.
 */

const ConsoleDriver = require('./console-driver');

let oscLib = null;
try { oscLib = require('osc'); } catch (_) { /* graceful — driver inert without it */ }

class EosDriver extends ConsoleDriver {
  static get id()          { return 'eos'; }
  static get displayName() { return 'ETC Eos (Eos / Element / Ion / Nomad)'; }
  static get macSupported(){ return true; }   // Eos Nomad runs on macOS
  static get defaultPort() { return 8000; }

  constructor(opts = {}, hooks = {}) {
    super(opts, hooks);
    this._udp = null;
  }

  async connect() {
    if (!oscLib) {
      this.log('osc package not loaded — Eos driver inert');
      return false;
    }
    // Try the configured port first; if it's already bound (by ENCpatch's
    // own osc-client, by another OSC app, or by a leftover process), retry
    // with port=0 (ephemeral). Eos won't be able to send feedback to that
    // port unless the user updates Eos's TX setting, but at least the
    // sending direction (encoder ticks) keeps working — better than going
    // fully red.
    const tryBind = (lp) => new Promise((resolve) => {
      let settled = false;
      const udp = new oscLib.UDPPort({
        localAddress: '0.0.0.0',
        localPort: lp,
        remoteAddress: this.opts.host || '127.0.0.1',
        remotePort: this.opts.port || 8000,
        metadata: false,
      });
      udp.on('ready', () => { if (settled) return; settled = true; resolve({ ok: true, udp }); });
      udp.on('error', (err) => {
        const msg = (err && err.message) || String(err);
        if (settled) return;
        settled = true;
        resolve({ ok: false, err: msg });
      });
      try { udp.open(); }
      catch (err) { if (!settled) { settled = true; resolve({ ok: false, err: err.message }); } }
    });

    const desired = this.opts.localPort || 8002;
    let r = await tryBind(desired);
    if (!r.ok && /EADDRINUSE|in use|address already/i.test(r.err)) {
      this.log(`Eos OSC: port ${desired} busy (${r.err}); falling back to ephemeral`);
      r = await tryBind(0);
    }
    if (!r.ok) {
      this.log(`Eos connect failed: ${r.err}`);
      return false;
    }
    this._udp = r.udp;
    this._udp.on('message', (msg) => this._onIncoming(msg));
    this._udp.on('error', (err) => {
      this.log(`Eos OSC error: ${err && err.message}`);
      this.emit('error', err);
    });
    this.connected = true;
    const actualPort = this._udp.options && this._udp.options.localPort;
    this.log(`Eos OSC ready: send ${this.opts.host || '127.0.0.1'}:${this.opts.port || 8000}, listen :${actualPort}`);

    // v0.13.26: Rebuilt subscription model to match ETCLabs lighthack's
    // box_1 approach. Three steps:
    //
    //   1) /eos/filter/add ["/eos/out/param/*", "/eos/out/ping"]
    //      Tells Eos to ONLY send param updates and pings — suppresses
    //      every other /eos/out/* event we don't care about, dramatically
    //      reducing OSC chatter.
    //
    //   2) /eos/subscribe/param/<name> 1 — once per parameter we want to
    //      track. Eos will then push value updates on /eos/out/param/<name>
    //      whenever that param changes on the selected channels. This is
    //      WAY more targeted than /eos/subscribe 1 (global) which we used
    //      through v0.13.25 and which surfaced ML-Controls noise.
    //
    //   3) /eos/user N (kept from v0.13.10 — lighthack box_1 doesn't set
    //      it but our docs research suggested it matters for write paths).
    //      Cheap enough to keep as belt-and-suspenders.
    //
    // The wheel-tick path now uses /eos/wheel/coarse/<name> (lighthack
    // form) — coarse explicit in the address rather than relying on
    // Eos's global wheel mode. See encoderTick.
    const userNum = Number(this.opts.user || 1);
    this._send('/eos/user', [{ type: 'i', value: userNum }]);

    // v0.13.35: two subscription modes.
    //   autoFillFromEos=true → global subscribe, listen on
    //     /eos/out/active/wheel/<n>, fill SD encoders dynamically from
    //     whatever Eos says is currently on its display.
    //   autoFillFromEos=false (default) → per-param subscribe (lighthack
    //     model), bind SD encoders to encoderParamsByCategory entries
    //     that the user typed in Settings.
    this._activeParams = [];
    this._paramValues = new Map();
    this._activeCategoryParams = [];
    this._activeCategoryPage = 0;

    if (this.opts.autoFillFromEos) {
      // Filter to active-wheel feedback only (plus ping for keep-alive).
      this._send('/eos/filter/add', [
        { type: 's', value: '/eos/out/active/wheel/*' },
        { type: 's', value: '/eos/out/ping' },
      ]);
      this._send('/eos/subscribe', [{ type: 'i', value: 1 }]);
      // v0.13.39: seed the cache + _activeParams with a fallback param
      // list so encoders DO SOMETHING immediately, before Eos's first
      // /eos/out/active/wheel feedback arrives. Without this, encoders
      // tick nothing on a fresh boot until the user selects fixtures
      // AND a category — felt like everything was broken to the user.
      // Once Eos pushes real wheel state, the cache is overwritten and
      // encoders follow it; until then they control intens/pan/tilt/zoom.
      const byCat = this.opts.encoderParamsByCategory || {};
      const seed = (
        (Array.isArray(this.opts.encoderParams) && this.opts.encoderParams.length > 0 && this.opts.encoderParams)
        || byCat.Intensity
        || ['intens', 'pan', 'tilt', 'zoom']
      ).slice(0, 4);
      this._encoderBarCache = seed.slice();
      while (this._encoderBarCache.length < 4) this._encoderBarCache.push(null);
      this._activeParams = this._encoderBarCache.slice();
      this.emit('encoderBar', { feature: null, slots: this._renderBarLabels() });
      this.log(`Eos auto-fill mode: seeded with ${this._encoderBarCache.filter(Boolean).join(', ') || '(empty)'}; will follow /eos/out/active/wheel feedback`);
    } else {
      // Per-param model (lighthack-style)
      this._send('/eos/filter/add', [
        { type: 's', value: '/eos/out/param/*' },
        { type: 's', value: '/eos/out/ping' },
      ]);
      const params = Array.isArray(this.opts.encoderParams) && this.opts.encoderParams.length > 0
        ? this.opts.encoderParams
        : ['intens', 'pan', 'tilt', 'zoom'];
      this._activeCategoryParams = params;
      this._swapSubscriptions(this._currentPageSlice());
    }

    // v0.13.24: Custom Encoder Map mode (Eos Tab 40) is a separate UX
    // path. Kept as optional toggle. Most users now want fixed-param
    // mode with live feedback, which the lighthack approach gives us.
    if (this.opts.useCustomEncoderMap) {
      this._send('/eos/key/encoder_custom', [{ type: 'f', value: 1.0 }]);
      this._send('/eos/key/encoder_custom', [{ type: 'f', value: 0.0 }]);
      this.log('Custom Encoder Map mode toggled on (Eos Tab 40)');
    }

    return true;
  }

  /**
   * v0.13.27: swap which parameters our encoders are subscribed to.
   * Used at connect-time AND every time the user presses a category
   * button — the per-category param list is reapplied so the SD
   * encoders auto-follow whatever Eos category is active.
   *
   * Unsubscribes from the OLD active params (so Eos stops pushing those
   * /eos/out/param updates we no longer need), then subscribes to the
   * new params and emits a fresh encoderBar so the LCD relabels.
   */
  /**
   * v0.13.34: pagination within a category. encoderParamsByCategory may
   * list more than 4 params per category (e.g. Focus has Pan/Tilt on
   * page 1 and X Focus / Y Focus / Z Focus / Position MSpeed on page 2).
   * Returns the 4-slot slice for the current page index.
   */
  _currentPageSlice() {
    const all = Array.isArray(this._activeCategoryParams) ? this._activeCategoryParams : [];
    const page = Math.max(0, this._activeCategoryPage | 0);
    const start = page * 4;
    return all.slice(start, start + 4);
  }

  _categoryPageCount() {
    const len = (this._activeCategoryParams && this._activeCategoryParams.length) || 0;
    return Math.max(1, Math.ceil(len / 4));
  }

  /** Move to next page of params within the current category. */
  nextCategoryPage() {
    const pages = this._categoryPageCount();
    const total = (this._activeCategoryParams && this._activeCategoryParams.length) || 0;
    this.log(`nextCategoryPage: total=${total} pages=${pages} currentPage=${this._activeCategoryPage}`);
    if (pages <= 1) {
      this.log(`nextCategoryPage: only 1 page available, skipping`);
      return false;
    }
    this._activeCategoryPage = (this._activeCategoryPage + 1) % pages;
    this.log(`Category page → ${this._activeCategoryPage + 1}/${pages}`);
    this._swapSubscriptions(this._currentPageSlice());
    return true;
  }

  /** Move to previous page of params within the current category. */
  prevCategoryPage() {
    const pages = this._categoryPageCount();
    this.log(`prevCategoryPage: pages=${pages} currentPage=${this._activeCategoryPage}`);
    if (pages <= 1) return false;
    this._activeCategoryPage = (this._activeCategoryPage - 1 + pages) % pages;
    this.log(`Category page → ${this._activeCategoryPage + 1}/${pages}`);
    this._swapSubscriptions(this._currentPageSlice());
    return true;
  }

  _swapSubscriptions(newParams) {
    if (!Array.isArray(newParams)) return;
    const next = newParams.slice(0, 4);
    while (next.length < 4) next.push(null);
    // Unsub the previous set
    if (Array.isArray(this._activeParams)) {
      for (const p of this._activeParams) {
        if (p) this._send(`/eos/subscribe/param/${p}`, [{ type: 'i', value: 0 }]);
      }
    }
    // Clear value cache for stale params
    this._paramValues = new Map();
    // Sub the new set
    for (const p of next) {
      if (p) this._send(`/eos/subscribe/param/${p}`, [{ type: 'i', value: 1 }]);
    }
    this._activeParams = next.slice();
    this._encoderBarCache = next.slice();
    this.emit('encoderBar', { feature: null, slots: this._renderBarLabels() });
    this.log(`Subscribed to params: ${next.filter(Boolean).join(', ') || '(none)'}`);
  }

  /**
   * v0.13.26: build the 4-element slot label array combining cached
   * parameter names with live values from /eos/out/param/<name> feedback.
   * Format: "Pan -45" / "Intens 75". When no value has arrived yet we
   * just show the name.
   */
  _renderBarLabels() {
    const slots = (this._encoderBarCache || [null, null, null, null]).slice(0, 4);
    return slots.map((name) => {
      if (!name) return null;
      const v = this._paramValues ? this._paramValues.get(name) : undefined;
      if (v === undefined || v === null) return name;
      // Format the value: integers stay clean, floats truncated to 1 decimal.
      const num = Number(v);
      if (Number.isFinite(num)) {
        return Number.isInteger(num) ? `${name} ${num}` : `${name} ${num.toFixed(1)}`;
      }
      return `${name} ${v}`;
    });
  }

  async disconnect() {
    if (this._subRefreshTimer) { clearInterval(this._subRefreshTimer); this._subRefreshTimer = null; }
    if (this._udp) {
      try { this._udp.close(); } catch (_) {}
      this._udp = null;
    }
    this.connected = false;
  }

  _send(address, args = []) {
    if (!this._udp) {
      this.log(`Eos send blocked (no UDP socket): ${address}`);
      return false;
    }
    if (!this.connected) {
      this.log(`Eos send blocked (not connected): ${address}`);
      return false;
    }
    try {
      this._udp.send({ address, args });
      // v0.13.9 diagnostic: log every send so the Monitor tab can prove
      // the driver is actually emitting UDP. Without this we can see the
      // engine call encoderTick but can't tell whether the driver's
      // socket write happened — that's the gap that hid the real bug
      // in v0.13.7/0.13.8 testing.
      // v0.13.26: nothing is on a hot loop anymore (the v0.13.23 reset
      // timer is gone). All sends are user-action-triggered or one-shot
      // at connect. Keep the silent set empty so every send is visible
      // in the Monitor — useful for diagnosing on real consoles.
      const SILENT = new Set();
      if (!SILENT.has(address)) {
        const argRepr = args.map((a) => `${a.type}:${a.value}`).join(',');
        this.log(`→ ${address} ${argRepr ? '[' + argRepr + ']' : ''}`);
      }
      return true;
    } catch (err) {
      this.log(`Eos send failed: ${err.message}`);
      return false;
    }
  }

  _onIncoming(msg) {
    if (!msg || !msg.address) return;
    // v0.13.26: New primary path — `/eos/out/param/<paramName>` carries
    // live values for each subscribed parameter. Args[0] is a float
    // with the current value (intensity 0-100, pan/tilt in degrees, etc).
    // The lighthack approach: subscribe per-param, receive per-param
    // updates, refresh the LCD label with "name value" format.
    const paramMatch = msg.address.match(/^\/eos\/out\/param\/(.+)$/);
    if (paramMatch) {
      const paramName = paramMatch[1];
      const value = msg.args && msg.args[0];
      if (!this._paramValues) this._paramValues = new Map();
      const before = this._paramValues.get(paramName);
      this._paramValues.set(paramName, value);
      if (before !== value) {
        // Only log when value actually changes — avoids noise from Eos
        // resending unchanged state.
        this.log(`← param ${paramName} = ${value}`);
      }
      this.emit('encoderBar', { feature: null, slots: this._renderBarLabels() });
      return;
    }
    // v0.13.35: /eos/out/active/wheel/<n> is the PRIMARY feedback channel
    // when autoFillFromEos mode is on. Each /n/ message carries the
    // current parameter name + value for slot N on Eos's encoder display.
    // We populate _encoderBarCache directly from these — SD encoder N
    // will tick whatever's currently in slot N.
    //
    // In fixed-param mode (autoFillFromEos=false), we ignore these in
    // favor of the per-param subscribes which have richer formatting.
    const wheelMatch = msg.address.match(/^\/eos\/out\/(?:active\/)?wheel\/(\d+)$/);
    if (wheelMatch) {
      if (!this.opts.autoFillFromEos) {
        // Fixed-param mode — ignore active-wheel feedback.
        return;
      }
      const slot = Number(wheelMatch[1]);
      const raw = (msg.args && msg.args[0]) ? String(msg.args[0]) : '';
      let attrName = null;
      const bracketIdx = raw.indexOf(' [');
      if (bracketIdx > 0) attrName = raw.slice(0, bracketIdx).trim();
      else attrName = (raw.match(/^(\S.+?)\s*$/) || [, raw])[1] || null;
      this._encoderBarCache = this._encoderBarCache || [null, null, null, null];
      if (slot >= 1 && slot <= 4) {
        const before = this._encoderBarCache[slot - 1];
        if (before !== attrName) {
          this.log(`auto-fill slot ${slot}: ${before || '(empty)'} → ${attrName || '(empty)'}`);
        }
        this._encoderBarCache[slot - 1] = attrName;
        // In auto-fill mode the activeParams (used by encoderTick) IS
        // the cache — encoder 1 ticks whatever's in slot 1.
        this._activeParams = this._encoderBarCache.slice();
      }
      this.emit('encoderBar', { feature: null, slots: this._encoderBarCache.slice() });
      return;
    }
    // `/eos/out/active/wheel/count i N` — Eos reports how many wheels are
    // active for the current category. When that drops below 4 we clear
    // the trailing slot labels so the LCD doesn't show stale text.
    if (msg.address === '/eos/out/active/wheel/count') {
      const n = Number((msg.args && msg.args[0]) || 0);
      this._encoderBarCache = this._encoderBarCache || [null, null, null, null];
      for (let i = n; i < 4; i++) this._encoderBarCache[i] = null;
      this.emit('encoderBar', { feature: null, slots: this._encoderBarCache.slice() });
      return;
    }
    // /eos/out/cmd = "Live: ..."  — current command line
    if (msg.address === '/eos/out/cmd') {
      const line = msg.args && msg.args[0];
      this.emit('cmdLine', { text: line });
    }
  }

  // ─── Canonical command surface ────────────────────────────────────

  encoderTick(slotIdx, _attrName, deltaPercent) {
    // v0.13.21: Cache-based addressing (look up param name then send
    // /eos/wheel/<name>) had inherent staleness — when category changed
    // on Eos's UI, the cache lagged ~250ms and the encoder ticked the
    // OLD slot's parameter. The user's whole complaint about "encoders
    // not tracking what's selected" stemmed from this.
    //
    // Replaced with `/eos/wheel/<paramName>` ALWAYS-fresh lookup AT
    // tick time. If the cache says slot 1 is Pan we send /eos/wheel/Pan.
    // If the cache doesn't have it, fall back to `/eos/active/wheel/<n>`
    // (slot-indexed). The active/wheel/N form isn't in ETC's published
    // OSC dictionary as INPUT but per community testing it does work in
    // v3.x — Eos treats it as "tick whatever's at slot N right now"
    // which is exactly what we want. Critically, this path doesn't
    // depend on our cache at all — Eos does the slot→parameter mapping
    // server-side.
    //
    // Decision: PREFER /eos/active/wheel/N (slot-based, no cache
    // staleness) over /eos/wheel/<param> (param-based, cache-dependent).
    // Even if /eos/active/wheel/N is undocumented input, the Eos OSC
    // parser appears to accept it. Worst case: Eos logs a parse error
    // and we fall back to the param-name path on the next tick.
    if (typeof deltaPercent !== 'number' || deltaPercent === 0) return false;
    // Accumulator (v0.13.8): sum sub-1 deltas, only emit when |sum| ≥ 1
    // because Eos truncates the float arg to integer clicks.
    if (!this._wheelAccum) this._wheelAccum = new Map();
    const key = String(slotIdx);
    const next = (this._wheelAccum.get(key) || 0) + deltaPercent;
    const clicks = next > 0 ? Math.floor(next) : Math.ceil(next);
    const remainder = next - clicks;
    this._wheelAccum.set(key, remainder);
    if (clicks === 0) return true;
    // v0.13.26: lighthack address form — /eos/wheel/coarse/<paramName>
    // or /eos/wheel/fine/<paramName>. Coarse/fine is part of the path,
    // not a separate mode setting. Resolution order:
    //   1) Active param list from connect() (the one we subscribed to)
    //   2) Cached name from /eos/out/active/wheel legacy feedback
    //   3) Skip — preserve the accumulated tick so we don't drop it
    const params = this._activeParams || this.opts.encoderParams;
    const fixed = Array.isArray(params) ? params[slotIdx - 1] : null;
    if (fixed && typeof fixed === 'string') {
      // Default to coarse mode (matches lighthack's normal-mode behavior).
      // Fine mode is exposed via fineStep transform on the mapping side
      // — when ENCpatch sends sub-1 deltas we accumulate and emit
      // integer clicks via coarse. The user can override at the OSC
      // level later if a per-encoder fine toggle is wanted.
      return this._send(`/eos/wheel/coarse/${fixed}`, [{ type: 'f', value: clicks }]);
    }
    // Legacy fallback to cache (won't usually fire under v0.13.26+ since
    // encoderParams provides activeParams above).
    const cached = this._encoderBarCache && this._encoderBarCache[slotIdx - 1];
    if (cached && typeof cached === 'string') {
      const name = cached.split(' [')[0].trim();
      if (/^[A-Za-z][A-Za-z0-9 _]*$/.test(name)) {
        return this._send(`/eos/wheel/coarse/${name}`, [{ type: 'f', value: clicks }]);
      }
    }
    // Nothing to address — preserve the accumulator and return.
    this._wheelAccum.set(key, next);
    this.log(`encoderTick slot ${slotIdx}: no param resolved`);
    return false;
  }

  bankSelect(bankIdx, bankName) {
    // v0.13.19: Hybrid approach based on observed Eos v3.x behavior.
    // The `encoder_category_<name>` hardkey family is partial in v3.1+ —
    // only some category names have working hardkeys; others got
    // repurposed (Custom in v3.1) or never existed (Beam isn't a real
    // Eos category — it's distributed across Form/Image/Shutter).
    //
    // Empirically tested mapping from the user's Eos Nomad:
    //   - Focus, Color, Image, Form: encoder_category_* hardkey works
    //   - Intensity:                  hardkey silent — use wheel-touch on intens
    //   - Shutter:                    hardkey scrolls to Form (wrong) — wheel-touch on strobe
    //   - Beam:                       no real category — wheel-touch on zoom
    //   - Custom:                     encoder_custom (toggle, v3.1+ only)
    //
    // For each entry: { key } uses /eos/key/<key>; { param } uses a
    // 0-delta /eos/wheel/<param> touch (which makes Eos scroll the
    // strip to that parameter's category). { cmd } types into command
    // line. Pick whichever empirically works for that category.
    // v0.13.28: Trim the route table to only hardkeys CONFIRMED working
    // against Eos Nomad v3.x via user testing. The "0-delta wheel touch"
    // approach for Intensity/Beam/Shutter doesn't actually do anything
    // on Eos (Eos ignores 0-magnitude wheel ticks), so those entries
    // were silently failing AND confusing the Form category by sending
    // the wrong key for Shape (Shutter). Now we ONLY emit the visual
    // hardkey when we know it works — the SD's encoder subscription
    // swap (below) is the real value-add and happens regardless.
    // v0.13.29: locked to Eos's canonical 6-category strip. Of those:
    //   - Focus/Color/Image/Form: send the encoder_category_* hardkey
    //     (Form collapses to Focus visually on Eos but the hardkey is
    //     valid and the SD's subscription swap fires regardless).
    //   - Intensity/Shutter: no working Eos hardkey for the visual
    //     switch, only the SD subscription swap. The user sees which
    //     category they're on via the SD LCD labels.
    const routeFor = {
      Focus:     { key: 'encoder_category_focus' },
      Color:     { key: 'encoder_category_color' },
      Image:     { key: 'encoder_category_image' },
      Form:      { key: 'encoder_category_form' },
      // MA3-flavored back-compat → equivalent Eos categories
      Position:  { key: 'encoder_category_focus' },
      Gobo:      { key: 'encoder_category_image' },
      Shapers:   { key: 'encoder_category_form' },
      // No hardkey on Eos — SD subscription swap only:
      //   Intensity, Shutter (+ Dimmer back-compat)
    };
    const route = routeFor[bankName];
    if (route && route.key) {
      this._send(`/eos/key/${route.key}`, [{ type: 'f', value: 1.0 }]);
      this._send(`/eos/key/${route.key}`, [{ type: 'f', value: 0.0 }]);
    }
    // Categories without a hardkey are intentionally silent on the Eos
    // visual side — only the SD encoder subscription swap below fires.
    // The user sees which category they're on via the SD's LCD labels.
    // v0.13.27: Swap which Eos parameters our SD encoders control
    // based on the chosen category. encoderParamsByCategory is a map
    // like { Color: ['color_select','color_select_2','hue','saturation'],
    // Beam: ['zoom','iris','edge','frost'], ... }. Pressing the Color
    // button now does TWO things:
    //   1. Sends the Eos category-switch hardkey (visual on Eos's strip)
    //   2. Unsubscribes from the previous 4 params, subscribes to the
    //      Color category's 4 params, and relabels the SD LCD.
    //
    // The SD encoders now "follow" Eos category in a meaningful way —
    // not by reading Eos's encoder-display state (which OSC doesn't
    // expose), but by ENCpatch maintaining its own per-category map
    // and swapping subscriptions on user input. Result is the MA3-like
    // UX the user asked for, with one tradeoff: the per-category param
    // list is fixed by config rather than auto-discovered.
    const byCategory = this.opts.encoderParamsByCategory || {};
    const catParams = byCategory[bankName]
      || byCategory[bankName && bankName.toLowerCase()]
      || null;
    // v0.13.33 diagnostic: surface every bankSelect call. If the user
    // presses Color and we don't see this line in the Monitor, the SD
    // mapping isn't routing to bankSelect at all. If we see it but no
    // "Subscribed to params" follow-up, the category isn't in
    // encoderParamsByCategory.
    // v0.13.37: bankSelect behavior splits on autoFillFromEos.
    //   - Auto-fill ON: just fire the Eos category hardkey (which we
    //     already did above). Don't touch subscriptions — Eos pushes
    //     fresh /eos/out/active/wheel/<n> for the new category. The
    //     /eos/subscribe re-fire forces Eos to emit a state dump even
    //     if no wheel value actually changed.
    //   - Auto-fill OFF: use the per-category fixed list with button-
    //     cycle pagination (same category twice = next page).
    if (this.opts.autoFillFromEos) {
      // v0.13.40: auto-fill mode now ALSO swaps the cache to the
      // category's params from encoderParamsByCategory on button press.
      // Eos doesn't push fresh /eos/out/active/wheel on category change
      // (only on wheel-value change), so without this the encoders
      // stayed stuck on the seed. With this swap:
      //   - Category buttons immediately swap encoders + LCD labels.
      //   - Eos's actual feedback (if/when it arrives) overrides the
      //     swap with real param names and live values.
      // Net: category buttons always work visibly, AND Eos's live
      // updates take precedence when they show up.
      const fallback = catParams || ['intens', 'pan', 'tilt', 'zoom'];
      this._activeCategory = bankName;
      this._activeCategoryParams = fallback;
      this._activeCategoryPage = 0;
      this._encoderBarCache = fallback.slice(0, 4);
      while (this._encoderBarCache.length < 4) this._encoderBarCache.push(null);
      this._activeParams = this._encoderBarCache.slice();
      this._paramValues = new Map();
      this.emit('encoderBar', { feature: null, slots: this._renderBarLabels() });
      // Force Eos to re-emit /eos/out/active/wheel/<n> for the new
      // category — if it does, those override our fallback labels.
      this._send('/eos/subscribe', [{ type: 'i', value: 0 }]);
      this._send('/eos/subscribe', [{ type: 'i', value: 1 }]);
      this.log(`Auto-fill: "${bankName}" — seeded ${this._encoderBarCache.filter(Boolean).join(', ') || '(empty)'}, awaiting Eos feedback`);
      return true;
    }

    this.log(`bankSelect("${bankName}"): catParams=${JSON.stringify(catParams)}`);
    if (Array.isArray(catParams) && catParams.length > 0) {
      // v0.13.36: button-cycle navigation in fixed mode.
      if (this._activeCategory === bankName
          && Array.isArray(this._activeCategoryParams)
          && this._activeCategoryParams.length > 4) {
        // Same category → advance page (wrap to 0 at end)
        const pages = Math.max(1, Math.ceil(this._activeCategoryParams.length / 4));
        this._activeCategoryPage = (this._activeCategoryPage + 1) % pages;
        this.log(`Same category "${bankName}" pressed again → page ${this._activeCategoryPage + 1}/${pages}`);
        this._swapSubscriptions(this._currentPageSlice());
      } else {
        this._activeCategoryParams = catParams;
        this._activeCategoryPage = 0;
        this._activeCategory = bankName;
        this._swapSubscriptions(this._currentPageSlice());
        const pages = this._categoryPageCount();
        if (pages > 1) this.log(`Category "${bankName}" has ${pages} pages; press the button again to advance`);
      }
    } else {
      this.log(`bankSelect("${bankName}"): no entry in encoderParamsByCategory; keys are [${Object.keys(byCategory).join(', ')}]`);
    }
    return true;
  }

  subPageNext() {
    // Eos uses Page Up/Down on the encoder page. Wheel mode page nav
    // is via the page softkeys.
    this._send('/eos/key/page_up', [{ type: 'f', value: 1.0 }]);
    this._send('/eos/key/page_up', [{ type: 'f', value: 0.0 }]);
    return true;
  }

  subPagePrev() {
    this._send('/eos/key/page_down', [{ type: 'f', value: 1.0 }]);
    this._send('/eos/key/page_down', [{ type: 'f', value: 0.0 }]);
    return true;
  }

  cmd(rawText) {
    return this._send('/eos/cmd', [{ type: 's', value: String(rawText) }]);
  }

  /**
   * v0.13.12: Send an Eos hardkey press+release. `name` is the OSC
   * hardkey name as listed in Eos Tab 7 → "OSC /key Names" dropdown
   * (lowercase with underscores for spaces — e.g. `live`, `blind`,
   * `select_active`, `stop_back_main_cuelist`). Invalid names are
   * silently rejected by Eos and surface in Tab 99 Diagnostics.
   *
   * Standard hardkeys (verified from ETC's OSC docs):
   *   live, blind, format, displays, patch, group, address, macro,
   *   preset, cue, list, update, delete, last, next, highlight, park,
   *   enter, clear, select, at, full, out, thru, plus, minus,
   *   0..9, decimal, go, stop, back, recall_from, copy_to, label,
   *   query, learn, time
   */
  hardkey(name) {
    if (!name) return false;
    // Eos accepts press (1.0) and release (0.0) on /eos/key/<name>.
    // Sending both back-to-back simulates a physical button click.
    const path = `/eos/key/${name}`;
    this._send(path, [{ type: 'f', value: 1.0 }]);
    return this._send(path, [{ type: 'f', value: 0.0 }]);
  }
}

module.exports = EosDriver;
