#!/usr/bin/env node
/**
 * Package the native Stream Deck plugin into a sideloadable
 * `com.encpatch.bridge.streamDeckPlugin` file.
 *
 * This is the open-source equivalent of Elgato's `streamdeck pack`
 * (which needs the proprietary `@elgato/cli`). It does two jobs:
 *
 *   1. Validate the manifest — every Icon / Image / CodePath /
 *      PropertyInspectorPath it references must exist on disk. This is
 *      the part that actually catches shipping mistakes (a typo'd icon
 *      name, a missing @2x, a stale CodePath).
 *   2. Zip the `.sdPlugin` folder (as the archive root, no parent dir)
 *      and write it next to the source with the `.streamDeckPlugin`
 *      extension. Double-clicking that file sideloads the plugin.
 *
 * Marketplace distribution still needs Elgato's signing step; this only
 * produces the unsigned, sideload-only bundle (see streamdeck-plugin/README.md).
 *
 * Usage:  node scripts/pack-streamdeck.js
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'streamdeck-plugin');
const SRC_DIRNAME = 'com.encpatch.bridge.sdPlugin';
const SRC = path.join(PLUGIN_ROOT, SRC_DIRNAME);
const OUT = path.join(PLUGIN_ROOT, 'com.encpatch.bridge.streamDeckPlugin');
const MANIFEST = path.join(SRC, 'manifest.json');

function fail(msg) {
  console.error(`[pack-streamdeck] ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SRC) || !fs.statSync(SRC).isDirectory()) {
  fail(`source folder not found: ${SRC}`);
}
if (!fs.existsSync(MANIFEST)) {
  fail(`manifest.json not found: ${MANIFEST}`);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (e) {
  fail(`manifest.json is not valid JSON: ${e.message}`);
}

// ── Collect every asset the manifest references ─────────────────────────
// Icon-style references in a Stream Deck manifest omit the extension and
// the @2x variant (e.g. "icons/plugin" -> icons/plugin.png + icons/plugin@2x.png).
// Code paths carry their own extension and have no @2x.
const iconRefs = new Set();   // base path, no extension
const exactRefs = new Set();  // full path with extension

function addIcon(ref) { if (typeof ref === 'string' && ref) iconRefs.add(ref); }
function addExact(ref) { if (typeof ref === 'string' && ref) exactRefs.add(ref); }

addIcon(manifest.Icon);
addIcon(manifest.CategoryIcon);
addExact(manifest.CodePath);
addExact(manifest.PropertyInspectorPath);

for (const action of manifest.Actions || []) {
  addIcon(action.Icon);
  addExact(action.PropertyInspectorPath);
  for (const state of action.States || []) addIcon(state.Image);
  if (action.Encoder) {
    addIcon(action.Encoder.Icon);
    addIcon(action.Encoder.background);
  }
}

const errors = [];
const warnings = [];

for (const ref of exactRefs) {
  if (!fs.existsSync(path.join(SRC, ref))) errors.push(`missing file referenced by manifest: ${ref}`);
}
for (const base of iconRefs) {
  const one = `${base}.png`;
  const two = `${base}@2x.png`;
  if (!fs.existsSync(path.join(SRC, one))) errors.push(`missing icon referenced by manifest: ${one}`);
  if (!fs.existsSync(path.join(SRC, two))) warnings.push(`missing @2x icon (recommended): ${two}`);
}

// Surface version drift between the plugin manifest and the app — not a
// hard error (sideload doesn't care), but Nick should know if they diverge.
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.version && manifest.Version && pkg.version !== manifest.Version) {
    warnings.push(`manifest Version (${manifest.Version}) != package.json version (${pkg.version})`);
  }
} catch (_) { /* package.json optional for validation */ }

for (const w of warnings) console.warn(`[pack-streamdeck] warning: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`[pack-streamdeck] error: ${e}`);
  fail(`manifest validation failed with ${errors.length} error(s) — package not produced`);
}

// ── Zip the .sdPlugin folder as the archive root ────────────────────────
// `zip` (Info-ZIP) ships on both macOS and Linux. -X drops extra file
// attributes, -r recurses, -q quiets. We zip from inside PLUGIN_ROOT so the
// archive contains "com.encpatch.bridge.sdPlugin/..." with no parent path,
// which is what Stream Deck expects when it unpacks a .streamDeckPlugin.
const TMP = path.join(PLUGIN_ROOT, `.pack-${process.pid}.zip`);
for (const f of [OUT, TMP]) {
  if (fs.existsSync(f)) fs.rmSync(f);
}

try {
  execFileSync(
    'zip',
    ['-X', '-r', '-q', TMP, SRC_DIRNAME, '-x', '*.DS_Store', '-x', '*/__MACOSX/*'],
    { cwd: PLUGIN_ROOT, stdio: ['ignore', 'inherit', 'inherit'] }
  );
} catch (e) {
  if (fs.existsSync(TMP)) fs.rmSync(TMP);
  fail(`zip failed (is the \`zip\` binary installed?): ${e.message}`);
}

fs.renameSync(TMP, OUT);

const bytes = fs.statSync(OUT).size;
const kib = (bytes / 1024).toFixed(1);
console.log(`[pack-streamdeck] validated ${exactRefs.size + iconRefs.size} manifest asset reference(s)`);
console.log(`[pack-streamdeck] wrote ${path.relative(ROOT, OUT)} (${kib} KiB)`);
console.log('[pack-streamdeck] sideload by double-clicking the file (unsigned; Marketplace upload still needs signing).');
