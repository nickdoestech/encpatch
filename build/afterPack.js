/**
 * electron-builder afterPack hook.
 *
 * Why this exists: ENCpatch is not signed with a paid Apple Developer
 * certificate. By default macOS Gatekeeper flags any unsigned app as
 * "damaged" because it has no signature at all (worse than ad-hoc).
 *
 * `codesign --force --deep --sign -` (the dash means ad-hoc identity)
 * gives the bundle a *valid* signature that's trusted on the same Mac
 * it was built on, and only fails Gatekeeper for users who haven't run
 * `xattr -cr /Applications/ENCpatch.app` after install (we document that
 * step in INSTALL.md / Read Me First.md).
 *
 * Without this hook, the user gets the "ENCpatch is damaged and can't
 * be opened" dialog with no way past it short of disabling Gatekeeper
 * globally.
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  // Only on macOS — Windows/Linux builds skip this.
  if (process.platform !== 'darwin') return;
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename + '.app';
  const appPath = path.join(context.appOutDir, appName);

  if (!fs.existsSync(appPath)) {
    console.warn('[afterPack] no .app bundle at', appPath, '— skipping ad-hoc sign');
    return;
  }

  console.log('[afterPack] ad-hoc codesigning', appPath);

  // --force: replace any existing signature
  // --deep: descend into nested helpers / frameworks (Electron has plenty)
  // --sign -: ad-hoc (unsigned but with a valid empty signature)
  // --options runtime omitted on purpose — hardenedRuntime=false in build
  //   config, and adding it here without an entitlements plist breaks
  //   the helper processes.
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
    // Strip extended attributes that survived the build (Finder dot-underscore
    // files + Gatekeeper quarantine bit if present). xattr -cr is the same
    // command we tell users to run post-install — doing it here too means
    // builds shared via local AirDrop / Sharing don't need it either.
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
    console.log('[afterPack] signed and cleaned', appName);
  } catch (err) {
    console.error('[afterPack] codesign failed:', err.message);
    // Don't throw — let the build complete. The DMG will still work,
    // user just has to run xattr -cr themselves.
  }
};
