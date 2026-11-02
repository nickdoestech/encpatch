/**
 * Auto-updater for ENCpatch.
 *
 * Uses electron-updater to check for releases on GitHub and download them.
 * Updates are checked on startup and then every hour. User is prompted
 * to install when an update is ready.
 *
 * Requires:
 * - package.json version field (used for version comparison)
 * - GitHub release artifacts named "latest-mac.yml" / "latest.yml"
 * - electron-builder config in package.json with proper appId
 */

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
let mainWindow = null;

// Track updater state
let updateAvailable = false;
let updateDownloaded = false;
let updateError = null;

/**
 * Initialize the auto-updater.
 * Call after app.whenReady() but before showing UI.
 */
async function initUpdater(window) {
  mainWindow = window;

  // Configure electron-updater logging. electron-log is optional (not a
  // declared dependency) — fall back to console so a missing module can
  // never crash startup.
  try {
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';
  } catch (_) {
    autoUpdater.logger = console;
  }

  // Update checks stay disabled until the GitHub publish config in
  // package.json (build.publish) points at the real public repo — see
  // docs/RELEASING.md. Prevents 404 noise from the placeholder owner.
  let updatesEnabled = false;
  try {
    const publish = (require('../package.json').build || {}).publish;
    const gh = Array.isArray(publish)
      ? publish.find((p) => p && p.provider === 'github')
      : null;
    updatesEnabled = !!(gh && gh.owner && gh.repo && !/TODO/i.test(gh.owner));
  } catch (_) {}

  if (!updatesEnabled) {
    console.warn(
      '[updater] GitHub publish config not set (build.publish in package.json, see docs/RELEASING.md) — update checks disabled'
    );
  } else {
    // Check for updates on startup
    autoUpdater.checkForUpdatesAndNotify();
  }

  // Set up event handlers
  autoUpdater.on('checking-for-update', () => {
    try {
      console.log('[updater] checking for updates...');
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('updater:checking');
      }
    } catch (_) {}
  });

  autoUpdater.on('update-available', (info) => {
    try {
      console.log('[updater] update available:', info.version);
      updateAvailable = true;
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('updater:update-available', {
          version: info.version,
          releaseDate: info.releaseDate,
        });
      }
    } catch (_) {}
  });

  autoUpdater.on('update-not-available', () => {
    try {
      console.log('[updater] up to date');
    } catch (_) {}
  });

  autoUpdater.on('error', (err) => {
    try {
      console.error('[updater] error:', err);
      updateError = err;
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('updater:error', {
          message: err.message || String(err),
        });
      }
    } catch (_) {}
  });

  autoUpdater.on('download-progress', (progress) => {
    try {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('updater:download-progress', {
          percent: Math.round(progress.percent),
          bytesPerSecond: progress.bytesPerSecond,
        });
      }
    } catch (_) {}
  });

  autoUpdater.on('update-downloaded', (info) => {
    try {
      console.log('[updater] update downloaded:', info.version);
      updateDownloaded = true;
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('updater:update-ready', {
          version: info.version,
        });
      }
    } catch (_) {}
  });

  // Expose IPC handlers for the UI to trigger install/dismiss
  ipcMain.handle('updater:install', async () => {
    try {
      if (updateDownloaded) {
        console.log('[updater] installing update...');
        autoUpdater.quitAndInstall();
      }
    } catch (err) {
      console.error('[updater] install failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('updater:check', async () => {
    try {
      if (!updatesEnabled) {
        console.warn('[updater] manual check ignored — publish config not set');
        return;
      }
      console.log('[updater] manual check requested');
      autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[updater] manual check failed:', err);
    }
  });

  // Check for updates every hour
  setInterval(() => {
    try {
      if (updatesEnabled) autoUpdater.checkForUpdates();
    } catch (err) {
      console.error('[updater] periodic check failed:', err);
    }
  }, 60 * 60 * 1000);  // 1 hour
}

/**
 * Get current updater state (for status API).
 */
function getUpdaterState() {
  return {
    updateAvailable,
    updateDownloaded,
    updateError: updateError ? updateError.message : null,
    version: app.getVersion(),
  };
}

module.exports = {
  initUpdater,
  getUpdaterState,
};
