#!/usr/bin/env node
/**
 * Bundle the freshly built DMG + Read Me First into a single zip on the
 * user's Desktop, named `ENCpatch-vX.Y.Z.zip`. That zip is what we share
 * with friends — one file, with the install instructions sitting right
 * next to the DMG.
 *
 * Run AFTER `npm run dist:mac`. Reads version from package.json and the
 * DMG path from the dist/ directory.
 */
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const DIST = path.join(ROOT, 'dist');
const DMG_NAME = `ENCpatch-${VERSION}-arm64.dmg`;
const DMG_PATH = path.join(DIST, DMG_NAME);

if (!fs.existsSync(DMG_PATH)) {
  console.error(`[share] expected DMG at ${DMG_PATH} — run \`npm run dist:mac\` first`);
  process.exit(1);
}

const README = path.join(ROOT, 'INSTALL.md');
if (!fs.existsSync(README)) {
  console.error(`[share] expected INSTALL.md at ${README}`);
  process.exit(1);
}

const STAGING = path.join(DIST, `share-staging-${VERSION}`);
const STAGE_FOLDER = path.join(STAGING, `ENCpatch v${VERSION}`);
const READ_ME_DEST = path.join(STAGE_FOLDER, 'Read Me First.md');
const DMG_DEST = path.join(STAGE_FOLDER, DMG_NAME);

fs.rmSync(STAGING, { recursive: true, force: true });
fs.mkdirSync(STAGE_FOLDER, { recursive: true });

// Copy the DMG and the install guide
fs.copyFileSync(DMG_PATH, DMG_DEST);
fs.copyFileSync(README, READ_ME_DEST);

const DESKTOP = path.join(os.homedir(), 'Desktop');
const ZIP_NAME = `ENCpatch-v${VERSION}.zip`;
const ZIP_PATH = path.join(DESKTOP, ZIP_NAME);

if (fs.existsSync(ZIP_PATH)) {
  fs.rmSync(ZIP_PATH);
}

// macOS `ditto -c -k --sequesterRsrc` produces a Finder-friendly zip
// (no __MACOSX/ junk that Linux unzip throws into a mess).
execSync(
  `ditto -c -k --sequesterRsrc --keepParent "${STAGE_FOLDER}" "${ZIP_PATH}"`,
  { cwd: STAGING, stdio: 'inherit' }
);

// Cleanup staging
fs.rmSync(STAGING, { recursive: true, force: true });

const sizeMb = (fs.statSync(ZIP_PATH).size / (1024 * 1024)).toFixed(1);
console.log(`[share] wrote ${ZIP_PATH} (${sizeMb} MB)`);
