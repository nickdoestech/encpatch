/**
 * ConfigStore — atomic JSON-file backed configuration with simple
 * dotted-path getters / setters. Used to persist:
 *   - network settings (osc, telnet, http)
 *   - user-defined mappings
 *   - per-mapping options (curves, ranges, transforms)
 */

const fs = require('fs/promises');
const path = require('path');

const DEFAULT_CONFIG = {
  // Which lighting console driver to load. One of: ma3, eos, onyx,
  // titan, hog, magicq, vista. Drives which OSC dialect and command
  // syntax ENCpatch uses. Default ma3 = grandMA3 onPC.
  // (See server/core/console-drivers/ for available drivers.)
  console: 'ma3',
  http: { port: 8733 },
  osc: {
    // Where MA3 is reachable. MA3 OSC is configured in
    // Menu -> Network -> OSC. The "remote" addr+port is where MA3 listens
    // for incoming OSC; the "local" port is where this app listens for
    // OSC coming back FROM MA3 (and from controllers like Companion).
    ma3Host: '127.0.0.1',
    ma3SendPort: 8000,
    listenPort: 8001,
  },
  // Telnet was removed in v0.3 — MA3 deprecated the command-line port.
  // Future versions will replace it with a Lua plugin running inside MA3
  // that receives commands over TCP. Settings live here when that lands.
  streamDeck: {
    // When multiple Stream Decks are plugged in, claim this one (0-based).
    // ENCpatch lists each detected SD with its index in the Monitor tab
    // on startup so you can pick the right number. Default 0 = first SD.
    deviceIndex: 0,
  },
  // ETC Eos network config — only used when console === 'eos'.
  // Eos default: RX 8000 (we send to here), TX 8001 (Eos sends feedback here).
  // Configurable in Eos shell → Network → Show Control → OSC.
  //
  // localPort is 8002 (NOT Eos's default 8001) because the general OSC
  // client (osc-client.js) already binds 8001 for inbound MA3 / controller
  // traffic. Two binds of 8001 inside the same process → EADDRINUSE and
  // the Eos driver dies silently. 8002 sidesteps it; you must also set
  // Eos's TX port to 8002 in the shell (it defaults to 8001 — change it).
  eos: {
    host: '127.0.0.1',
    port: 8000,        // where ENCpatch sends OSC TO Eos
    localPort: 8002,   // where ENCpatch listens for Eos's feedback (was 8001)
    // v0.13.10: which Eos user our OSC commands take effect as. Eos's
    // `/eos/user N` declares the OSC client's user identity. User 0 is
    // the background/read-only user — feedback flows back but wheels
    // and keys silently no-op. User 1 is the first interactive user
    // (default for single-operator Eos sessions). For multi-user shows
    // set this to whichever User the operator is logged in as.
    user: 1,
    // v0.13.24: two ways to drive the SD encoders. Eos's OSC doesn't
    // expose the Encoder Display (the category-strip-driven wheels);
    // /eos/out/active/wheel reflects ML Controls / programming state
    // which often shows a default 4-wheel set (Intens/Pan/Tilt/X Focus)
    // regardless of the visible category. Two workarounds:
    //
    //   1. CUSTOM ENCODER MAP MODE (recommended). User creates a
    //      custom map in Eos Tab 40 with desired 4 wheels. ENCpatch
    //      toggles Custom Map mode on connect via /eos/key/encoder_custom.
    //      The bottom-strip Encoder Display reflects the custom map and
    //      so does ENCpatch's LCD via /eos/out/active/wheel feedback.
    //   2. FIXED PARAMETER MAPPING. Encoder N hardcoded to a specific
    //      parameter name. Doesn't follow Eos's category strip — but
    //      always works. Set `encoderParams` to a 4-element array of
    //      parameter names; encoder 1 sends /eos/wheel/<encoderParams[0]>
    //      and the LCD label shows that name.
    //
    // Leave both off to fall through to the default behavior (slot-
    // indexed /eos/active/wheel/N + dynamic feedback labels).
    // v0.13.38: default ON. ENCpatch listens to Eos's /eos/out/active/wheel
    // feedback and dynamically fills the SD's encoders with whatever Eos
    // currently has in slots 1-4. Zero-config — labels and routing follow
    // Eos's encoder display in real time without the user having to hand-
    // write per-fixture param lists. The fixed encoderParamsByCategory map
    // is only used when this is explicitly turned off.
    autoFillFromEos: true,
    useCustomEncoderMap: false,
    // v0.13.25: default to a sensible 4-wheel fixed mapping so Eos
    // users get working encoders out of the box, even without setting
    // up a Custom Encoder Map in Eos Tab 40 or hand-editing config.
    encoderParams: ['intens', 'pan', 'tilt', 'zoom'],
    // v0.13.27: per-category encoder mapping. When the user presses a
    // category button (Form / Image / Intensity / Color / Beam / Focus /
    // Shutter / Custom), the SD encoders auto-swap to the params listed
    // here for that category — unsubscribing the old four and
    // subscribing to the new four. Each entry is a 4-element array of
    // Eos parameter names. Names are case-insensitive (per ETC OSC
    // Conventions); use underscores for spaces (e.g. x_focus).
    // v0.13.35: each entry is a flat list of param names. The first 4
    // are page 1, next 4 are page 2, then page 3 — LCD swipe pages
    // through them. Up to 12 params (3 pages) per category.
    encoderParamsByCategory: {
      Intensity: ['intens'],
      Focus: [
        // page 1
        'pan', 'tilt', 'x_focus', 'y_focus',
        // page 2
        'z_focus', 'position_mspeed', 'position_macros', 'position_macro_ra',
        // page 3
        'pan_rotate', 'tilt_rotate', 'pan_tilt_speed', 'follow_thru',
      ],
      Color: [
        // page 1: standard color selection
        'color_select', 'color_select_2', 'hue', 'saturation',
        // page 2: RGBW
        'red', 'green', 'blue', 'white',
        // page 3: extra LED emitters / color temp
        'amber', 'lime', 'cyan_2', 'color_temp',
      ],
      Shutter: [
        // page 1
        'strobe', 'shutter_strobe', 'shutter_strobe_select', 'shutter_strobe_random',
        // page 2
        'strobe_rate', 'shutter_strobe_speed', 'shutter_open', 'shutter_close',
      ],
      Image: [
        // page 1: primary gobo
        'gobo_select', 'gobo_index_speed', 'gobo_select_2', 'gobo_index_speed_2',
        // page 2: animation
        'animation', 'animation_rotate', 'animation_index_speed', 'effect_index',
        // page 3: rotators / prism
        'gobo_rotate', 'gobo_rotate_2', 'prism', 'prism_rotate',
      ],
      Form: [
        // page 1
        'pan', 'tilt', 'x_focus', 'y_focus',
        // page 2
        'z_focus', 'position_mspeed', 'position_macros', 'position_macro_ra',
        // page 3
        'iris', 'zoom', 'edge', 'frost',
      ],
    },
  },
  ma3lua: {
    // Enabled by default — the bridge is the primary control path now
    // (encoder fixture-agnostic ticks). The desktop app prompts the user
    // to install the bridge plugin in MA3 on first launch.
    enabled: true,
    host: '127.0.0.1',
    port: 9001,
    // Optional shared secret for LAN deployments. Empty = no auth (fine
    // for 127.0.0.1). When the bridge .lua has a TOKEN set, this MUST
    // match. See INSTALL.md → Network section.
    token: '',
  },
  // Connected device slots (max 3). The first slot is the SD+ at /sd.
  // Additional slots use /sd2, /sd3 for more decks, or /wing for an OSC
  // fader wing. Each slot:
  //   { type: 'streamdeck', layoutId: 'sd-plus', addressPrefix: '/sd' }
  //   { type: 'fader-wing', layoutId: 'osc-wing-24', addressPrefix: '/wing' }
  devices: [
    { id: 'slot1', type: 'streamdeck', layoutId: 'sd-plus', addressPrefix: '/sd', name: 'Primary' },
  ],
  pageBinder: {
    enabled: true,    // page-aware encoders ON by default
    // OFF by default — mapper-driven page selection is the primary path.
    // Turn on only if you change pages directly from MA3's screen and want
    // mapper to follow.
    useWatcher: false,
    // MA3 command sent when a page-select button is pressed.
    // Default: `Select EncoderBank N` — selects bank by 1-based index.
    // Verified working on MA3 onPC 2.x.
    // Placeholders: $bank = numeric index (1..8), $name = "Dimmer", etc.
    bankCommandTemplate: 'Select EncoderBank $bank',
    // Sent to MA3 when you swipe LEFT or RIGHT on the SD+ LCD strip.
    // Navigates the encoder SUB-PAGE within the current bank
    // (e.g. "Dimmer 1 of 2" -> "Dimmer 2 of 2") rather than switching banks.
    // Edit if your MA3 uses a different keyword (Subpage / Page +1 / etc.)
    subpageNextCommand: 'EncoderPage +',
    subpagePrevCommand: 'EncoderPage -',
  },
  // OSC traffic safety
  oscLimits: {
    // Hard cap on messages/sec from mapper to MA3. Bursts beyond this go
    // into a small queue; if queue fills, oldest are dropped.
    maxMa3PerSec: 50,
    queueMax: 100,
  },
  // Manual encoder-stack override.
  //
  // MA3's Lua API doesn't reliably expose which stacked attributes are
  // available per encoder slot, so we let the user define them explicitly.
  // Per feature group, per slot (1-4), an ordered list of attribute names.
  // LCD tap on the encoder zone advances through the list. If a slot has
  // no entry here, tap is a no-op (single-attribute slot).
  //
  // Minimal defaults — one attribute per slot, matching MA3's typical
  // encoder bar layout. Add more per slot for fixtures with stacked
  // tabs you want to cycle through (e.g. add "Gobo1Pos" to Gobo slot 1
  // for a fixture with rotating gobo wheel). Customize in Settings →
  // Encoder Stacks per fixture profile.
  //
  // v0.7+: per-fixture-type overrides via byFixtureType. When stacks are
  // defined for a specific fixture type (e.g. "MAC Aura"), they take
  // precedence over the global defaults. Storage:
  //   encoderStacks.byFixtureType[fixtureType][feature][slot] = [...attrs]
  encoderStacks: {
    Dimmer:   { "1": ["Dim"] },
    Position: { "1": ["Pan"], "2": ["Tilt"] },
    Gobo:     { "1": ["Gobo1"], "2": ["Gobo2"], "3": ["Gobo3"] },
    Color:    { "1": ["Color1"], "2": ["Color2"], "3": ["Color3"] },
    Beam:     { "1": ["Iris"], "2": ["Zoom"], "3": ["Shutter1"], "4": ["Prism1"] },
    Focus:    { "1": ["Focus1"], "2": ["Frost1"] },
    Control:  { "1": ["Control1"] },
    Shapers:  { "1": ["Blade1A"], "2": ["Blade2A"], "3": ["Blade3A"], "4": ["Blade4A"] },
    byFixtureType: {},
  },
  mappings: [
    // See mappings.example.json for the supported shape.
  ],
};

function deepMerge(target, source) {
  if (typeof source !== 'object' || source === null) return source;
  if (typeof target !== 'object' || target === null) return source;
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    out[key] = deepMerge(target[key], source[key]);
  }
  return out;
}

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.listeners = new Set();
  }

  async load() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = deepMerge(DEFAULT_CONFIG, parsed);
      this._migrate();
    } catch (err) {
      if (err.code === 'ENOENT') {
        await this.save(); // bootstrap with defaults
      } else {
        throw err;
      }
    }
  }

  /** One-shot migrations on load. Bumps stale fields without forcing the
   *  user to delete config.json. */
  _migrate() {
    let changed = false;
    // v0.13 -> v0.13.1: rename pre-v0.13 `console: 'ma3lua'` (the legacy
    // pseudo-driver name from when the only console was MA3) to the
    // canonical `console: 'ma3'`. Defensive — no shipping config sets
    // 'ma3lua' explicitly, but old hand-edited configs from internal
    // testing might.
    const legacyConsole = this.get('console');
    if (legacyConsole === 'ma3lua') {
      this.set('console', 'ma3');
      console.log(`[config] migrated console: 'ma3lua' -> 'ma3'`);
      changed = true;
    }
    // v0.13.2 -> v0.13.3: existing eos.localPort=8001 collides with
    // osc.listenPort (also 8001) — both bind UDP and the second one
    // EADDRINUSEs, killing the Eos driver. Bump 8001 → 8002 once. User
    // must also update Eos shell TX port to match. Safe because: nobody
    // SHIPPING used a non-default 8001, only the bundled default did.
    const oscListen = this.get('osc.listenPort');
    if (this.get('eos.localPort') === 8001 && oscListen === 8001) {
      this.set('eos.localPort', 8002);
      console.log(`[config] migrated eos.localPort: 8001 -> 8002 (avoids osc-client clash)`);
      changed = true;
    }
    // v0.13.24 -> v0.13.25: backfill the new default Eos encoderParams
    // for users whose config has the v0.13.24-era null value (which gave
    // them broken encoders out of the box because /eos/active/wheel/<n>
    // isn't a valid input path). Set to a sensible 4-wheel default so
    // they can spin encoders immediately. Users who specifically cleared
    // the array to enable auto-follow mode get re-defaulted too — but
    // they can re-clear in Settings if needed.
    const epRaw = this.get('eos.encoderParams');
    if (epRaw === null || epRaw === undefined || (Array.isArray(epRaw) && epRaw.length === 0)) {
      this.set('eos.encoderParams', ['intens', 'pan', 'tilt', 'zoom']);
      console.log(`[config] migrated eos.encoderParams: defaulted to intens/pan/tilt/zoom`);
      changed = true;
    }
    // v0.13.26 -> v0.13.29: backfill per-category encoder param map for
    // users whose config was saved before this option existed AND prune
    // off the non-Eos-canonical categories (Beam, Custom, Intens alias)
    // that got into v0.13.27's defaults. Eos's actual category strip is
    // exactly: Intensity, Focus, Color, Shutter, Image, Form.
    const epbcRaw = this.get('eos.encoderParamsByCategory') || {};
    const CANON = ['Intensity', 'Focus', 'Color', 'Shutter', 'Image', 'Form'];
    const DEFAULTS = {
      Intensity: ['intens'],
      Focus: [
        'pan', 'tilt', 'x_focus', 'y_focus',
        'z_focus', 'position_mspeed', 'position_macros', 'position_macro_ra',
        'pan_rotate', 'tilt_rotate', 'pan_tilt_speed', 'follow_thru',
      ],
      Color: [
        'color_select', 'color_select_2', 'hue', 'saturation',
        'red', 'green', 'blue', 'white',
        'amber', 'lime', 'cyan_2', 'color_temp',
      ],
      Shutter: [
        'strobe', 'shutter_strobe', 'shutter_strobe_select', 'shutter_strobe_random',
        'strobe_rate', 'shutter_strobe_speed', 'shutter_open', 'shutter_close',
      ],
      Image: [
        'gobo_select', 'gobo_index_speed', 'gobo_select_2', 'gobo_index_speed_2',
        'animation', 'animation_rotate', 'animation_index_speed', 'effect_index',
        'gobo_rotate', 'gobo_rotate_2', 'prism', 'prism_rotate',
      ],
      Form: [
        'pan', 'tilt', 'x_focus', 'y_focus',
        'z_focus', 'position_mspeed', 'position_macros', 'position_macro_ra',
        'iris', 'zoom', 'edge', 'frost',
      ],
    };
    let epbcChanged = false;
    const next = {};
    for (const cat of CANON) {
      next[cat] = Array.isArray(epbcRaw[cat]) && epbcRaw[cat].length > 0
        ? epbcRaw[cat]
        : DEFAULTS[cat];
      if (next[cat] !== epbcRaw[cat]) epbcChanged = true;
    }
    // Detect any extra non-canonical keys (Beam, Custom, Intens, FX...)
    for (const k of Object.keys(epbcRaw)) {
      if (!CANON.includes(k)) { epbcChanged = true; break; }
    }
    if (epbcChanged) {
      this.set('eos.encoderParamsByCategory', next);
      console.log(`[config] migrated eos.encoderParamsByCategory: pinned to canonical 6 (Intensity/Focus/Color/Shutter/Image/Form)`);
      changed = true;
    }
    // v0.13.35-37 -> v0.13.38: flip eos.autoFillFromEos default from
    // false to true. Migrate existing users who had the v0.13.35 false
    // default (and never explicitly toggled it). Guarded by a flag so
    // users who explicitly set it to false stay opted-out.
    if (this.get('eos.autoFillFromEos') === false && !this.get('eosAutoFillFromEosMigrated')) {
      this.set('eos.autoFillFromEos', true);
      this.set('eosAutoFillFromEosMigrated', true);
      console.log(`[config] migrated eos.autoFillFromEos: false -> true (new default)`);
      changed = true;
    }
    // v0.13.30 -> v0.13.32: when console=eos, force the canonical
    // 8-button layout for SD keys 1-8: Intensity / Color / Image / Sneak,
    // Focus / Shutter / Form / Query. Replaces any prior bindings (old
    // MA3 page names, the v0.13.31 Sneak/Query-on-7-and-8 layout, etc).
    // Guarded by a versioned flag so user customizations after this
    // point aren't auto-overwritten on launch.
    if (this.get('console') === 'eos' && !this.get('eosKeyLayoutV2')) {
      const list = this.data.mappings || [];
      const findIdx = (trig) => list.findIndex((m) => m && m.trigger && m.trigger.match === trig);
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
        const m = {
          id: `eos-key-${slot.key.split('/').pop()}`,
          name: slot.name,
          enabled: true,
          trigger: { type: 'osc', match: slot.key },
          transform: { onlyOn: 1 },
          action: slot.action,
        };
        const i = findIdx(slot.key);
        if (i === -1) list.push(m); else list[i] = { ...list[i], ...m };
      }
      this.data.mappings = list;
      this.set('eosKeyLayoutV2', true);
      // Clear the older flag from v0.13.31 so it doesn't linger in config.json
      this.set('eosSneakQueryInjected', undefined);
      console.log(`[config] migrated Eos key layout: Intensity/Color/Image/Sneak/Focus/Shutter/Form/Query`);
      changed = true;
    }
    // v0.6 -> v0.7: drop "MainTask " prefix from bank-select template.
    const tpl = this.get('pageBinder.bankCommandTemplate');
    if (typeof tpl === 'string' && /^MainTask\s+/i.test(tpl)) {
      const fixed = tpl.replace(/^MainTask\s+/i, '');
      this.set('pageBinder.bankCommandTemplate', fixed);
      console.log(`[config] migrated bankCommandTemplate: "${tpl}" -> "${fixed}"`);
      changed = true;
    }
    // v0.9.4 -> v0.9.5: REVERT the well-intentioned but broken switch to
    // 'Feature "X"'. Real-world testing showed MA3 onPC 2.x doesn't
    // accept that syntax; it logs "Illegal object: FeatureGroup ...".
    // The original 'Select EncoderBank $bank' (numeric index) is correct
    // and works. Auto-undo any of the bad templates we shipped.
    const tpl2 = this.get('pageBinder.bankCommandTemplate');
    if (tpl2 === 'Feature "$name"' || tpl2 === 'Feature "$bank"') {
      this.set('pageBinder.bankCommandTemplate', 'Select EncoderBank $bank');
      console.log(`[config] reverted bankCommandTemplate: '${tpl2}' -> 'Select EncoderBank $bank'`);
      changed = true;
    }
    // v0.9.5 -> v0.9.6: REVERT 0.9.3's sub-page nav for keys 7+8. User
    // wants all 8 keys back as feature-group selectors. Convert any auto-
    // assigned sub-page nav mappings back to Page: <name> based on the
    // configured bankOrder. Skips user-customized mappings.
    if (!this.get('revertedSubpageNavToPages')) {
      const list = this.data.mappings || [];
      const fs = require('fs');
      const path = require('path');
      let bankOrder = [];
      try {
        const attrsPath = path.join(__dirname, '..', '..', 'data', 'ma3-attributes.json');
        const attrs = JSON.parse(fs.readFileSync(attrsPath, 'utf8'));
        bankOrder = attrs.bankOrder || [];
      } catch (_) { /* fall back to leaving keys alone */ }

      for (const idx of [7, 8]) {
        const m = list.find((x) => x.trigger && x.trigger.match === `/sd/key/${idx}`);
        // Only touch ones we autogenerated (sub-page nav mappings)
        if (m && m.action && m.action.type === 'ma3lua'
              && /^Sub-page/.test(m.name || '')) {
          const page = bankOrder[idx - 1];
          if (page) {
            m.name = `Page: ${page}`;
            m.action = { type: 'setPage', page };
            console.log(`[config] reverted /sd/key/${idx} from sub-page nav back to Page: ${page}`);
            changed = true;
          }
        }
      }
      this.set('revertedSubpageNavToPages', true);
      changed = true;
    }
    // v0.8 -> v0.9: add sub-page swipe commands if missing.
    if (this.get('pageBinder.subpageNextCommand') === undefined) {
      this.set('pageBinder.subpageNextCommand', 'EncoderPage +');
      changed = true;
    }
    if (this.get('pageBinder.subpagePrevCommand') === undefined) {
      this.set('pageBinder.subpagePrevCommand', 'EncoderPage -');
      changed = true;
    }
    // v0.9 -> v0.10: bridge-tick is now the only sane encoder action because
    // it's fixture-agnostic and reads MA3's live encoder bar. Any leftover
    // cmd-tick / setProgPhaser / OSC encoder mapping for /sd/enc/N from old
    // presets shadows the new bridge-tick mappings (engine matches first
    // user mapping it sees). Strip them once. Only runs ONCE, gated by the
    // `migratedToBridgeTick` flag, so user-edited cmd-tick mappings won't
    // get re-killed if they intentionally re-add them later.
    if (!this.get('migratedToBridgeTick')) {
      const list = this.data.mappings || [];
      const before = list.length;
      this.data.mappings = list.filter((m) => {
        const trig = m && m.trigger && m.trigger.match;
        if (!trig || !/^\/sd\/enc\/\d+$/.test(trig)) return true;       // not an encoder mapping → keep
        const t = m.action && m.action.type;
        if (t === 'bridgeTick') return true;                              // already bridgeTick → keep
        return false;                                                     // legacy encoder mapping → drop
      });
      const removed = before - this.data.mappings.length;
      if (removed > 0) {
        console.log(`[config] migrated: removed ${removed} legacy /sd/enc/* mapping(s) (replaced by bridge-tick)`);
      }
      this.set('migratedToBridgeTick', true);
      changed = true;
    }
    // Always-on dedup: if BOTH bridgeTick AND another action type exist
    // for the same /sd/enc/N trigger, drop the non-bridgeTick one. Runs
    // every load (not flag-gated) to catch new dupes from preset imports
    // or manual editing. Without this, both fire per encoder turn — the
    // user sees the bridge tick AND a phantom legacy command (e.g.
    // "Attribute Dimmer At + 0.01") going to MA3.
    {
      const list = this.data.mappings || [];
      const bridgeTriggers = new Set();
      for (const m of list) {
        if (m && m.action && m.action.type === 'bridgeTick'
            && m.trigger && /^\/sd\/enc\/\d+$/.test(m.trigger.match || '')) {
          bridgeTriggers.add(m.trigger.match);
        }
      }
      if (bridgeTriggers.size > 0) {
        const before = list.length;
        this.data.mappings = list.filter((m) => {
          const trig = m && m.trigger && m.trigger.match;
          if (!bridgeTriggers.has(trig)) return true;     // not a /sd/enc/N with bridgeTick → keep
          return m.action && m.action.type === 'bridgeTick'; // keep only the bridgeTick one
        });
        const removed = before - this.data.mappings.length;
        if (removed > 0) {
          console.log(`[config] deduped ${removed} legacy mapping(s) shadowed by bridgeTick`);
          changed = true;
        }
      }
    }
    if (changed) this.save().catch(() => {});
  }

  async save() {
    const tmp = this.filePath + '.tmp';
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
    this._emit();
  }

  get(dottedPath) {
    if (!dottedPath) return this.data;
    return dottedPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), this.data);
  }

  set(dottedPath, value) {
    const parts = dottedPath.split('.');
    let node = this.data;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (node[k] == null || typeof node[k] !== 'object') node[k] = {};
      node = node[k];
    }
    node[parts[parts.length - 1]] = value;
  }

  // Mapping CRUD helpers
  listMappings() {
    return this.data.mappings || [];
  }
  upsertMapping(mapping) {
    if (!mapping.id) mapping.id = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const list = this.data.mappings || (this.data.mappings = []);
    const idx = list.findIndex((m) => m.id === mapping.id);
    if (idx >= 0) list[idx] = mapping;
    else list.push(mapping);
    return mapping;
  }
  deleteMapping(id) {
    const list = this.data.mappings || [];
    const idx = list.findIndex((m) => m.id === id);
    if (idx >= 0) list.splice(idx, 1);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  _emit() {
    for (const fn of this.listeners) {
      try { fn(this.data); } catch (_) {}
    }
  }
}

module.exports = ConfigStore;
