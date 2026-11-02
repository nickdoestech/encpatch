/**
 * MA3 command formatter — chooses the right MA3 command-line syntax
 * for the detected MA3 version. Today this is largely a passthrough
 * because MA3 2.3.x is consistent for the commands we care about.
 *
 * Why this exists: each MA3 release has historically tweaked one or two
 * keywords (Telnet → Lua bridge, "Select EncoderBank" semantics, the
 * Encoder N parser change in 2.3.2.0, etc). When 2.4 ships and breaks
 * something, we change the formatter — not every call site.
 *
 * Usage:
 *   const fmt = new Ma3CommandFormatter(ma3Version);
 *   fmt.encoderTick(slotIdx, attrName, deltaPercent);
 *   fmt.bankSelect(bankIdx, bankName);
 *   fmt.subPageNext();
 *   fmt.subPagePrev();
 *
 * Pass null for ma3Version to get the "safe default" syntax (works on
 * the broadest range of MA3 builds we know about — 2.3.0 through 2.3.2).
 */

class Ma3CommandFormatter {
  constructor(ma3Version) {
    this.version = parseVersion(ma3Version);
  }

  /**
   * Relative encoder change. attrName is the MA3 attribute name
   * (e.g. "Dim", "Pan"). delta is signed percentage.
   *
   * 2.3.x: `Attribute "Pan" At + 0.5` — verified on 2.3.0..2.3.2.
   * Slot-based addressing ('Encoder N At + V') was tried in 0.9.2 but
   * MA3 silently no-ops it (parses as EncoderBar UI object, not a slot
   * reference). Removed in 0.9.7.
   */
  encoderTick(_slotIdx, attrName, deltaPercent) {
    const sign = deltaPercent >= 0 ? '+' : '-';
    const mag = Math.abs(deltaPercent);
    return `Attribute "${attrName}" At ${sign} ${mag.toFixed(4)}`;
  }

  /**
   * Switch the encoder bar to the Nth bank. Both bankIdx (1-based) and
   * bankName (e.g. "Dimmer") are passed so a future version can pick
   * either form without touching callers.
   *
   * 2.3.x: `Select EncoderBank N` (numeric, 1-based) — verified working.
   * Named form `Feature "Dimmer"` does NOT work in 2.3.x — MA3 logs
   * "Illegal object: FeatureGroup '...'".
   */
  bankSelect(bankIdx, _bankName) {
    return `Select EncoderBank ${bankIdx}`;
  }

  /** Sub-page nav within the current bank. Used by LCD swipe. */
  subPageNext() { return 'EncoderPage +'; }
  subPagePrev() { return 'EncoderPage -'; }

  /** Returns a short human-readable label for the UI. */
  describe() {
    if (!this.version) return 'MA3 (version unknown — using safe defaults)';
    return `MA3 ${this.version.raw}`;
  }
}

function parseVersion(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const m = raw.match(/(\d+)\.(\d+)\.?(\d+)?\.?(\d+)?/);
  if (!m) return { raw, major: null, minor: null, patch: null, build: null };
  return {
    raw,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] != null ? Number(m[3]) : 0,
    build: m[4] != null ? Number(m[4]) : 0,
  };
}

module.exports = Ma3CommandFormatter;
