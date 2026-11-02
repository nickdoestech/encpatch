/**
 * StreamDeckRenderer — paints keys + SD+ LCD regions.
 *
 * Targets @elgato-stream-deck/node v7. The lib wants RAW RGBA pixel data
 * (Buffer of width*height*4 bytes), not JPEG/PNG. We use @napi-rs/canvas
 * (optional) to draw, then ctx.getImageData() to get raw pixels.
 *
 * Without @napi-rs/canvas, we fall back to solid colors (still valid via
 * fillKeyColor) — so the deck shows where bindings exist even without text.
 */

let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch (_) { /* optional */ }

// MA3 palette (mirrors styles.css). Used as RGB triples for fillKeyColor.
const COLOR_BOUND = [42, 138, 230];   // MA3 blue (#2a8ae6)
const COLOR_FLASH = [252, 211, 77];   // MA3 yellow active (#fcd34d)
const COLOR_BLANK = [22, 23, 27];     // tile dark
const COLOR_TILE_TOP = '#3a3a3c';
const COLOR_TILE_BOT = '#1a1a1c';
const COLOR_TILE_BORDER = '#0a0a0a';
const COLOR_TEXT = '#ffffff';
const COLOR_LABEL_ACTIVE = '#fcd34d'; // yellow for active attribute names
const COLOR_TEXT_DIM = '#7d8294';

// MA3 feature-group accent stripe colors (top-of-tile)
const GROUP_COLORS = {
  Dimmer:   '#fcd34d',
  Position: '#f59e0b',
  Gobo:     '#c026a8',
  Color:    '#ec4899',
  Beam:     '#3a8ee6',
  Focus:    '#84cc16',
  Control:  '#c026a8',
  Shapers:  '#f97316',
};
function groupColorFor(name) {
  if (!name) return null;
  for (const k of Object.keys(GROUP_COLORS)) if (name.includes(k)) return GROUP_COLORS[k];
  return null;
}

/** Given a mapping (typically an active encoder), return [r,g,b] for the
 *  SD+ encoder LED ring. Falls back to MA3 blue if no group match. */
function encoderRingColorFor(mapping) {
  const hex = (mapping && groupColorFor(mapping.name)) || '#3a8ee6';
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [58, 142, 230];
}

// v0.13.5: when the active console isn't MA3, the user's page-select
// mappings (saved as MA3 names like "Dimmer"/"Position"/"Gobo") get
// translated for display so the deck shows what the operator's console
// actually calls these categories. The TRANSLATION IS DISPLAY-ONLY — the
// underlying mapping name and bankSelect call still flow through the
// driver's name map (driver.bankSelect("Dimmer") → /eos/key/intens).
const CATEGORY_LABEL_BY_CONSOLE = {
  eos: {
    Dimmer: 'Intens', Position: 'Form', Gobo: 'Image', Color: 'Color',
    Beam: 'Beam', Focus: 'Focus', Control: 'FX', Shapers: 'Shape',
  },
  // MagicQ and Onyx mostly mirror MA3's English-y naming, no remap
  // needed. Hog/Titan/Vista do — fill in once those drivers are tested.
};
function translateCategoryLabel(label, consoleId) {
  if (!label || !consoleId || consoleId === 'ma3') return label;
  const map = CATEGORY_LABEL_BY_CONSOLE[consoleId];
  if (!map) return label;
  return map[label] || label;
}

class StreamDeckRenderer {
  constructor(hid, hooks = {}) {
    this.hid = hid;
    this.log = hooks.log || (() => {});
    this._flashTimers = new Map();
    this._currentPage = null;   // updated by setCurrentPage() for live labels
    this._encoderValues = new Map();   // encoder index (1-4) -> normalized value 0-1
    this._consoleId = 'ma3';   // updated by setConsoleId() for label translation
  }
  setCurrentPage(name) { this._currentPage = name; }
  /** v0.13.5: which console the user is driving — switches LCD label
   *  vocabulary (Dimmer→Intens, Position→Form, etc. for Eos). */
  setConsoleId(id) { this._consoleId = id || 'ma3'; }
  /** server pushes health snapshot here so the LCD can render it. */
  setHealth(h) { this._health = h || {}; }
  /** array of 4 attribute names (or null) for the SD+ encoder bar */
  setEncoderBarSlots(arr) { this._encoderBarSlots = Array.isArray(arr) ? arr : [null,null,null,null]; }
  /** why the slots are empty (if they are): noBridge / oldBridge / noFeature / noSelection / ok */
  setEncoderBarReason(r) { this._encoderBarReason = r || 'ok'; }
  /** map of encoder index -> normalized value (0-1) for real-time feedback bars */
  setEncoderValues(valuesMap) { this._encoderValues = valuesMap instanceof Map ? valuesMap : new Map(); }

  /** Full-width SD+ LCD strip (800×100). Top half = MA MAPPER status,
   *  bottom half = per-encoder FINE/COARSE indicators with step size.
   *  byEnc: Map<1..4, mapping> so we can look up _encoderMode + step per slot.
   */
  _renderHealthStrip(w, h, byEnc) {
    if (!canvasLib) {
      // Fallback solid color — dim gray strip
      return this._solidBuffer(w, h, [22, 23, 27]);
    }
    const c = canvasLib.createCanvas(w, h);
    const g = c.getContext('2d');

    // Split LCD: top 38% = system header (compressed), bottom 62% = encoder
    // cells (more room for big readable text). The user couldn't read the
    // strip from arm's-length so we shrank the header and bumped every
    // font ~50-80%.
    const headerH = Math.round(h * 0.38);
    const stripH = h - headerH;

    // ----- HEADER REGION (system status) -----
    const grad = g.createLinearGradient(0, 0, 0, headerH);
    grad.addColorStop(0, COLOR_TILE_TOP);
    grad.addColorStop(1, COLOR_TILE_BOT);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, headerH);

    // Top accent stripe — MA3 blue
    g.fillStyle = '#3a8ee6';
    g.fillRect(0, 0, w, 3);

    // Left: E|N|C three-cell split badge (was M|A two-cell — bumped for new
    // brand). Each cell 22px wide, alternating gray/dark/gray. The MA3-blue
    // accent stripe at the top of the LCD already brands this as ENCpatch.
    const badgeX = 18;
    const badgeY = headerH / 2;
    const badgeH = Math.round(headerH * 0.55);
    const cellSlotW = 22;
    const cells = [
      { letter: 'E', bg: '#5a5a5c' },
      { letter: 'N', bg: '#2a2a2c' },
      { letter: 'C', bg: '#5a5a5c' },
    ];
    cells.forEach((cell, i) => {
      const x = badgeX + i * (cellSlotW + 2);
      g.fillStyle = cell.bg;
      g.fillRect(x, badgeY - badgeH/2, cellSlotW, badgeH);
    });
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(badgeH * 0.7)}px -apple-system, "Helvetica Neue", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    cells.forEach((cell, i) => {
      const cx = badgeX + i * (cellSlotW + 2) + cellSlotW / 2;
      g.fillText(cell.letter, cx, badgeY + 1);
    });

    // Center: title + status line — bigger so it's legible at arm's length
    g.fillStyle = '#fff';
    g.font = `700 ${Math.round(headerH * 0.55)}px -apple-system, "Helvetica Neue", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ENCpatch', w / 2, headerH * 0.34);

    g.font = `${Math.round(headerH * 0.30)}px "SF Mono", monospace`;
    g.fillStyle = '#aab3c4';
    const health = this._health || {};
    const bridge = health.bridge && typeof health.bridge.lastMs === 'number'
      ? `bridge ${health.bridge.lastMs.toFixed(1)}ms`
      : (health.luaConnected ? 'bridge OK' : 'bridge OFF');
    const page = this._currentPage ? `page: ${this._currentPage}` : 'no page';
    // MA3 version shown when known — useful for spotting cross-version
    // issues at a glance (e.g. 2.3.2 vs 2.3.0 differences).
    const ma3v = health.ma3Version ? `MA3 ${shortVersion(health.ma3Version)}` : null;
    const status = [bridge, page, ma3v].filter(Boolean).join('   •   ');
    g.fillText(status, w / 2, headerH * 0.74);

    // Right: status dot indicators (LUA + SD), side-by-side, scaled up
    const dotR = 8;
    const dotY = badgeY;
    const luaOk = !!(health.luaConnected || (health.bridge && health.bridge.lastMs != null));
    const sdOk  = !!health.sdConnected;
    // Group anchors near right edge: SD pill outermost, LUA pill to its left.
    // Each "pill" = dot + label, kept tight together.
    const fontPx = Math.round(headerH * 0.36);
    g.font = `700 ${fontPx}px "SF Mono", monospace`;
    const sdLabelW = g.measureText('SD').width;
    const luaLabelW = g.measureText('LUA').width;
    const dotLabelGap = 6;
    const groupGap = 16;
    const rightPad = 14;
    // SD pill (right-most)
    const sdLabelX = w - rightPad - sdLabelW;
    const sdDotX = sdLabelX - dotLabelGap - dotR;
    // LUA pill (to the left of SD)
    const luaLabelX = sdDotX - dotR - groupGap - luaLabelW;
    const luaDotX = luaLabelX - dotLabelGap - dotR;
    // Draw dots
    g.fillStyle = luaOk ? '#3fbf66' : '#ff5252';
    g.beginPath(); g.arc(luaDotX, dotY, dotR, 0, Math.PI * 2); g.fill();
    g.fillStyle = sdOk ? '#3fbf66' : '#ff5252';
    g.beginPath(); g.arc(sdDotX, dotY, dotR, 0, Math.PI * 2); g.fill();
    // Draw labels
    g.fillStyle = '#e0e0e2';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('LUA', luaLabelX, dotY);
    g.fillText('SD',  sdLabelX, dotY);

    // ----- ENCODER MODE STRIP (4 cells across the bottom) -----
    // Cell width = w/4. Each cell shows "FINE 0.1" or "COARSE 0.5" for
    // that encoder slot. Yellow when fine (active), dim gray when coarse.
    const cellW = w / 4;
    // Background — slightly darker than header so the strip reads as separate
    g.fillStyle = '#0f1014';
    g.fillRect(0, headerH, w, stripH);
    // Thin separator between header and strip
    g.fillStyle = '#000';
    g.fillRect(0, headerH, w, 1);

    const slotNames = this._encoderBarSlots || [null, null, null, null];
    const reason = this._encoderBarReason || 'ok';

    // If the reason is not "ok", show a single full-width banner across
    // the encoder cell strip explaining what's wrong, instead of four
    // useless dashes. Banner takes the place of the per-cell rendering.
    if (reason !== 'ok') {
      const health = this._health || {};
      // Build the version-mismatch line dynamically so the user can see
      // exactly which version is in MA3 vs the app — the most common
      // "I forgot to re-import the .lua" failure mode.
      const oldBridgeLine2 = (health.bridgeVersion && health.appVersion)
        ? `MA3 has v${health.bridgeVersion} — app needs v${health.appVersion} — re-import .lua`
        : 'Re-install ENCpatchMA3Bridge.lua from Settings';
      const messages = {
        noBridge:    { line1: 'BRIDGE NOT CONNECTED', line2: 'Install ENCpatchMA3Bridge.lua in MA3', color: '#ff5252' },
        oldBridge:   { line1: 'OLD BRIDGE — UPDATE',   line2: oldBridgeLine2, color: '#ff8a3a' },
        noFeature:   { line1: 'NO FEATURE GROUP',      line2: 'Pick Dimmer / Position / Color in MA3', color: '#fcd34d' },
        noSelection: { line1: 'NO FIXTURES SELECTED',  line2: 'Type "Fixture 1 Thru 8 Please" in MA3', color: '#fcd34d' },
      };
      const m = messages[reason] || messages.noBridge;
      g.fillStyle = m.color;
      g.font = `800 ${Math.round(stripH * 0.36)}px -apple-system, "Helvetica Neue", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(m.line1, w / 2, headerH + stripH * 0.36);
      g.fillStyle = '#aab3c4';
      g.font = `${Math.round(stripH * 0.20)}px -apple-system, "Helvetica Neue", sans-serif`;
      g.fillText(m.line2, w / 2, headerH + stripH * 0.72);
      // Bottom bar matches the severity color
      g.fillStyle = m.color;
      g.fillRect(0, h - 4, w, 4);
      const data = g.getImageData(0, 0, w, h).data;
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }

    for (let i = 0; i < 4; i++) {
      const x = i * cellW;
      const m = byEnc && byEnc.get ? byEnc.get(i + 1) : null;
      const t = (m && m.transform) || {};
      const fine = m && m._encoderMode === 'fine';
      const step = fine
        ? (t.fineStep ?? 0.1)
        : (t.coarseStep ?? t.step ?? 0.5);
      const slotName = slotNames[i];

      // Vertical separator between cells (skip first)
      if (i > 0) {
        g.fillStyle = '#1f2128';
        g.fillRect(x, headerH + 4, 1, stripH - 8);
      }

      // Cell layout: 2 rows. Big-text rebuild — dropped E# corner labels
      // (encoder position is obvious) and step size (mode label carries
      // the info), freeing pixels for chunkier attribute name + mode.
      // Row 1 (top, ~62% of strip): attribute name — DOMINANT
      // Row 2 (bottom, ~38% of strip): FINE/COARSE pill, full-width
      const rowATop = headerH + 2;
      const rowAH = Math.round(stripH * 0.62);
      const rowBTop = headerH + rowAH;
      const rowBH = stripH - rowAH;

      if (!m) {
        // Empty mapping — show "—" centered, full strip
        g.fillStyle = '#3a3a3c';
        g.font = `600 ${Math.round(stripH * 0.65)}px "SF Mono", monospace`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('—', x + cellW / 2, headerH + stripH / 2);
        continue;
      }

      // Row 1: attribute name — biggest text on the LCD, fills the cell width
      const showName = slotName && slotName !== 'null' ? slotName : '—';
      g.fillStyle = slotName ? COLOR_LABEL_ACTIVE : '#5a5a5c';
      // Start at a chunky size, then shrink only if it overflows the cell
      let nameFontPx = Math.round(rowAH * 0.85);
      const maxNameW = cellW - 14;
      g.font = `800 ${nameFontPx}px -apple-system, "Helvetica Neue", sans-serif`;
      while (g.measureText(showName).width > maxNameW && nameFontPx > 14) {
        nameFontPx -= 2;
        g.font = `800 ${nameFontPx}px -apple-system, "Helvetica Neue", sans-serif`;
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(showName, x + cellW / 2, rowATop + rowAH / 2);

      // Row 2: FINE / COARSE + value bar
      const modeColor = fine ? COLOR_LABEL_ACTIVE : '#3a8ee6';
      const modeLabel = fine ? 'FINE' : 'COARSE';
      const rowBCY = rowBTop + rowBH / 2;

      // Real-time value bar (if feedback value available for this encoder)
      // Draw bar behind the mode label (lighter background, darker text)
      const hasValue = this._encoderValues && this._encoderValues.has(i + 1);
      if (hasValue) {
        const val = this._encoderValues.get(i + 1);
        const barH = Math.round(rowBH * 0.3);
        const barY = rowBTop + (rowBH - barH) / 2;
        const barMaxW = cellW - 14;
        // Dark background bar
        g.fillStyle = '#1a1a1c';
        g.fillRect(x + 7, barY, barMaxW, barH);
        // Bright foreground bar (same color as mode indicator)
        g.fillStyle = modeColor;
        const barFillW = Math.max(0, Math.min(1, val)) * barMaxW;
        if (barFillW > 0) {
          g.fillRect(x + 7, barY, barFillW, barH);
        }
      }

      g.fillStyle = modeColor;
      g.font = `800 ${Math.round(rowBH * 0.78)}px -apple-system, "Helvetica Neue", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(modeLabel, x + cellW / 2, rowBCY);

      // Bottom mode bar — yellow for fine, blue for coarse. Thicker now.
      g.fillStyle = modeColor;
      g.fillRect(x + 2, h - 4, cellW - 4, 4);
    }

    const data = g.getImageData(0, 0, w, h).data;
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  hasText() { return !!canvasLib; }

  async renderAll(mappings) {
    const dev = this.hid && this.hid.device;
    if (!dev || (this.hid && this.hid._dead)) return;
    let controls;
    try { controls = dev.CONTROLS || []; }
    catch (_) { return; }

    // Index bindings by trigger address
    const byKey = new Map();    // 1-based index -> mapping
    const byEnc = new Map();
    for (const m of mappings || []) {
      const t = m.trigger; if (!t || t.type !== 'osc' || !t.match) continue;
      let g = t.match.match(/^\/sd\/key\/(\d+)$/);
      if (g) byKey.set(Number(g[1]), m);
      g = t.match.match(/^\/sd\/enc\/(\d+)$/);
      if (g) byEnc.set(Number(g[1]), m);
    }

    // Paint buttons
    for (const c of controls) {
      if (this.hid && this.hid._dead) return;
      if (c.type !== 'button') continue;
      const m = byKey.get(c.index + 1);
      try {
        if (m && c.feedbackType === 'lcd') {
          await dev.fillKeyBuffer(c.index, this._renderKeyImage(m, c.pixelSize), { format: 'rgba' }).catch((e) => { throw e; });
        } else if (m && c.feedbackType === 'rgb') {
          await dev.fillKeyColor(c.index, ...COLOR_BOUND).catch((e) => { throw e; });
        } else if (c.feedbackType === 'lcd') {
          await dev.fillKeyBuffer(c.index, this._blankBuffer(c.pixelSize), { format: 'rgba' }).catch((e) => { throw e; });
        } else if (c.feedbackType === 'rgb') {
          await dev.fillKeyColor(c.index, ...COLOR_BLANK).catch((e) => { throw e; });
        }
      } catch (e) {
        this.log(`paint button ${c.index} failed: ${e && e.message}`);
        // If the device errored mid-paint, mark it dead and bail out of
        // the frame entirely — don't keep poking a corpse.
        if (this.hid && /HID|hid|libusb|cannot|could not|disconnect|pipe/i.test(e && e.message || '')) {
          this.hid._markDead && this.hid._markDead(e.message);
          return;
        }
      }
    }

    // Paint LCD segment(s) for SD+ — single full-width "MA Mapper" health strip.
    const lcds = controls.filter((c) => c.type === 'lcd-segment');
    const encoders = controls.filter((c) => c.type === 'encoder');
    for (const lcd of lcds) {
      if (this.hid && this.hid._dead) return;
      const totalW = lcd.pixelSize.width;
      const h = lcd.pixelSize.height;
      try {
        const buf = this._renderHealthStrip(totalW, h, byEnc);
        await dev.fillLcd(lcd.id, buf, { format: 'rgba' });
      } catch (e) {
        this.log(`paint lcd failed: ${e && e.message}`);
        if (this.hid && /HID|hid|libusb|cannot|could not|disconnect|pipe/i.test(e && e.message || '')) {
          this.hid._markDead && this.hid._markDead(e.message);
          return;
        }
      }
    }
    // Encoder LED rings — color matches feature group when active, off when inactive
    for (const enc of encoders) {
      if (this.hid && this.hid._dead) return;
      const m = byEnc.get(enc.index + 1);
      try {
        if (m) {
          // Active encoder: light the ring with the feature-group color
          const rgb = encoderRingColorFor(m);
          if (typeof dev.setEncoderRingSingleColor === 'function') {
            await dev.setEncoderRingSingleColor(enc.index, rgb[0], rgb[1], rgb[2]);
          }
        } else {
          // Inactive encoder: turn the ring fully off
          if (typeof dev.setEncoderRingSingleColor === 'function') {
            await dev.setEncoderRingSingleColor(enc.index, 0, 0, 0);
          }
        }
      } catch (e) {
        // Ring control not on every SD+ firmware — usually benign.
        // But if it's a real HID failure, mark dead so we stop touching it.
        if (this.hid && /HID|hid|libusb|cannot|could not|disconnect|pipe/i.test(e && e.message || '')) {
          this.hid._markDead && this.hid._markDead(e.message);
          return;
        }
      }
    }

    this.log(`rendered ${byKey.size}/${controls.filter(c => c.type === 'button').length} keys, ${byEnc.size}/${encoders.length} encoders`);
  }

  _blankBuffer(size) {
    const buf = Buffer.alloc(size.width * size.height * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = COLOR_BLANK[0]; buf[i + 1] = COLOR_BLANK[1]; buf[i + 2] = COLOR_BLANK[2]; buf[i + 3] = 255;
    }
    return buf;
  }

  _renderKeyImage(mapping, pixelSize) {
    const w = pixelSize.width, h = pixelSize.height;
    if (!canvasLib) return this._solidBuffer(w, h, COLOR_BOUND);
    const c = canvasLib.createCanvas(w, h);
    const g = c.getContext('2d');

    // MA3 pool-tile background: vertical gradient + 1px border
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, COLOR_TILE_TOP);
    grad.addColorStop(1, COLOR_TILE_BOT);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = COLOR_TILE_BORDER;
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, w - 1, h - 1);

    // Detect feature-group color from mapping name (e.g. "Page: Color")
    const stripeColor = groupColorFor(mapping.name) || '#3a8ee6';

    // Top accent stripe (3px) — feature-group color or generic blue
    g.fillStyle = stripeColor;
    g.fillRect(0, 0, w, 3);

    // Numbered key index in top-left corner (MA3 pool style)
    const keyIdx = (/sd\/key\/(\d+)/.exec(mapping.trigger.match || '') || [])[1];
    if (keyIdx) {
      g.fillStyle = COLOR_TEXT_DIM;
      g.font = `${Math.round(h * 0.10)}px "SF Mono", monospace`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(keyIdx, 6, 6);
    }

    // Main label — centered, bold, white. Strip "Page: " prefix, then
    // translate to the active console's vocabulary if needed (v0.13.5+).
    let label = (mapping.name || `Key ${keyIdx || ''}`).replace(/^Page:\s*/i, '');
    label = translateCategoryLabel(label, this._consoleId);
    g.fillStyle = COLOR_TEXT;
    g.font = `600 ${Math.round(h * 0.18)}px -apple-system, "Helvetica Neue", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    wrapText(g, label, w / 2, h / 2 + 4, w - 12, Math.round(h * 0.20));

    const data = g.getImageData(0, 0, w, h).data;
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  _renderEncoderRegion(mapping, w, h, encoderIndex = null) {
    if (!canvasLib) {
      return this._solidBuffer(w, h, mapping ? COLOR_BOUND : COLOR_BLANK);
    }
    const c = canvasLib.createCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = '#0a0c11';
    g.fillRect(0, 0, w, h);
    if (mapping) {
      let label = mapping.name || 'Encoder';
      const tpl = (mapping.action && mapping.action.template) || '';
      const attr = tpl.match(/Attribute "([^"]+)"/);
      if (attr) label = attr[1];
      // bridgeTick: use the live MA3 feature group + slot number
      if (mapping.action && mapping.action.type === 'bridgeTick') {
        const slot = mapping.action.encoder || index + 1;
        label = `${this._currentPage || 'Live'} ${slot}`;
      }

      // MA3 pool-tile look: gradient + accent stripe + yellow active label
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, COLOR_TILE_TOP);
      grad.addColorStop(1, COLOR_TILE_BOT);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);

      // Top accent stripe (4px) — feature-group color if known, else MA3 blue
      const stripeColor = groupColorFor(mapping.name) || '#3a8ee6';
      g.fillStyle = stripeColor;
      g.fillRect(0, 0, w, 4);

      // Encoder index in top-left corner (mono, dim)
      const encIdx = (/sd\/enc\/(\d+)/.exec((mapping.trigger && mapping.trigger.match) || '') || [])[1];
      if (encIdx) {
        g.fillStyle = COLOR_TEXT_DIM;
        g.font = `${Math.round(h * 0.14)}px "SF Mono", monospace`;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        g.fillText(`Encoder ${encIdx}`, 8, 9);
      }

      // Attribute label — large, YELLOW (MA3 active label color)
      g.fillStyle = COLOR_LABEL_ACTIVE;
      g.font = `600 ${Math.round(h * 0.34)}px -apple-system, "Helvetica Neue", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, w / 2, h * 0.50);

      // Coarse / fine indicator at bottom — yellow for fine, dim for coarse
      const t = mapping.transform || {};
      const fine = mapping._encoderMode === 'fine';
      const step = fine ? (t.fineStep ?? 0.1) : (t.coarseStep ?? t.step ?? 0.5);
      g.fillStyle = fine ? COLOR_LABEL_ACTIVE : COLOR_TEXT_DIM;
      g.font = `${Math.round(h * 0.14)}px "SF Mono", monospace`;
      g.fillText(`${fine ? 'FINE' : 'coarse'}  ${step}`, w / 2, h - 16);

      // Real-time value bar (if feedback value available for this encoder)
      if (encoderIndex && this._encoderValues && this._encoderValues.has(encoderIndex)) {
        const val = this._encoderValues.get(encoderIndex);
        const barH = 6;
        const barY = h - 12;
        // Normalized value bar (dark background + bright foreground)
        g.fillStyle = '#1a1a1c';
        g.fillRect(2, barY, w - 4, barH);
        g.fillStyle = stripeColor;  // Same color as top stripe for visual cohesion
        const barFillW = Math.max(0, Math.min(1, val)) * (w - 4);
        if (barFillW > 0) {
          g.fillRect(2, barY, barFillW, barH);
        }
      }

      // Bottom mode bar — yellow for fine, blue for coarse
      g.fillStyle = fine ? COLOR_LABEL_ACTIVE : '#3a8ee6';
      g.fillRect(0, h - 3, w, 3);
    } else {
      // Inactive encoder — MA3 isn't showing anything here right now.
      // Render as solid black, no text, no stripe. Reads as "this encoder
      // is dead" instead of "encoder exists but has no binding".
      g.fillStyle = '#000000';
      g.fillRect(0, 0, w, h);
    }
    const data = g.getImageData(0, 0, w, h).data;
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  _solidBuffer(w, h, [r, g, b]) {
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
    return buf;
  }

  /** Briefly flash a key when its mapping fires (yellow → blue). */
  flashKey(addr) {
    const dev = this.hid && this.hid.device;
    if (!dev || (this.hid && this.hid._dead)) return;
    const m = addr && addr.match(/^\/sd\/key\/(\d+)$/);
    if (!m) return;
    const idx = Number(m[1]) - 1;
    let ctrl;
    try { ctrl = (dev.CONTROLS || []).find((c) => c.type === 'button' && c.index === idx); }
    catch (_) { return; }
    if (!ctrl) return;
    if (ctrl.feedbackType === 'rgb') {
      try { dev.fillKeyColor(idx, ...COLOR_FLASH).catch(() => {}); } catch (_) {}
      clearTimeout(this._flashTimers.get(idx));
      this._flashTimers.set(idx, setTimeout(() => {
        try { dev.fillKeyColor(idx, ...COLOR_BOUND).catch(() => {}); } catch (_) {}
      }, 120));
    }
  }
}

/** Trim a verbose MA3 version string ("2.3.2.0-build-12345") to the
 *  short "2.3.2" form for the LCD status line. */
function shortVersion(raw) {
  if (!raw || typeof raw !== 'string') return raw || '';
  const m = raw.match(/^(\d+)\.(\d+)\.?(\d+)?/);
  if (!m) return raw.slice(0, 8);
  const parts = [m[1], m[2]];
  if (m[3] != null) parts.push(m[3]);
  return parts.join('.');
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const totalH = lines.length * lineHeight;
  let cy = y - totalH / 2 + lineHeight / 2;
  for (const ln of lines) { ctx.fillText(ln, x, cy); cy += lineHeight; }
}

module.exports = StreamDeckRenderer;
