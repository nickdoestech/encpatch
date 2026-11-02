/**
 * Permissions Assistant — first-run flow for Input Monitoring and Stream Deck.
 *
 * On first launch (or when permissions are missing), shows a friendly window
 * guiding the user to:
 * 1. Grant Input Monitoring permission (required to access HID devices like Stream Deck)
 * 2. Quit Elgato Stream Deck app if running (it claims the device exclusively)
 *
 * After permissions are granted, the app can automatically restart to apply them.
 */

const { BrowserWindow, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ─────────────────────────────────────────────────────────────────────────
// Check if Input Monitoring permission is granted on macOS.
// ─────────────────────────────────────────────────────────────────────────
function isInputMonitoringGranted() {
  if (process.platform !== 'darwin') {
    // Not macOS — no Input Monitoring permission needed.
    return true;
  }

  try {
    // Attempt to enumerate HID devices. If Input Monitoring is denied, this
    // will throw with EPERM or similar. If it succeeds, permission is granted.
    // We use node-hid's low-level API to detect the permission state without
    // needing the full HID library.
    const HID = require('node-hid');
    HID.devices(); // This throws if Input Monitoring is not granted.
    return true;
  } catch (err) {
    const msg = String(err);
    // Common patterns when Input Monitoring is denied:
    // "EPERM" (Operation not permitted)
    // "could not enumerate"
    // "permission denied"
    if (
      /EPERM|permission denied|could not enumerate|access denied/i.test(msg)
    ) {
      return false;
    }
    // Some other error (device not found, etc.) — assume permission is OK
    // and the issue is something else (e.g., no device connected).
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Check if Elgato Stream Deck app is running.
// ─────────────────────────────────────────────────────────────────────────
function isElgatoRunning() {
  if (process.platform !== 'darwin') {
    // Not macOS — use tasklist / wmic on Windows if needed.
    return false;
  }

  try {
    // `lsof` lists open files/devices. If Elgato has the Stream Deck device,
    // it will appear here. We look for processes with 'Stream Deck' in their
    // command or searching for the USB device.
    const result = execSync("lsof -c 'Stream Deck' 2>/dev/null || true", {
      encoding: 'utf8',
    });
    // If the output is non-empty, Elgato is likely running.
    return result.trim().length > 0;
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Kill Elgato Stream Deck app by process name.
// ─────────────────────────────────────────────────────────────────────────
function killElgato() {
  try {
    execSync("pkill -f 'Stream Deck' || true", { encoding: 'utf8' });
    return true;
  } catch (_) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Check if this is the first run by looking for a marker file.
// ─────────────────────────────────────────────────────────────────────────
function isFirstRun(userDataDir) {
  const markerPath = path.join(userDataDir, '.permissions-assistant-done');
  return !fs.existsSync(markerPath);
}

// ─────────────────────────────────────────────────────────────────────────
// Mark the permissions flow as complete.
// ─────────────────────────────────────────────────────────────────────────
function markPermissionsComplete(userDataDir) {
  const markerPath = path.join(userDataDir, '.permissions-assistant-done');
  try {
    fs.writeFileSync(markerPath, 'v1', 'utf8');
  } catch (_) {
    // Ignore write errors; the next run will show the flow again.
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Create the permissions assistant window.
// ─────────────────────────────────────────────────────────────────────────
function createPermissionsWindow() {
  const permWindow = new BrowserWindow({
    width: 500,
    height: 600,
    resizable: false,
    minimizable: false,
    backgroundColor: '#1c1c1e',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'permissions-preload.js'),
    },
  });

  const htmlPath = path.join(__dirname, 'permissions-assistant.html');
  permWindow.loadFile(htmlPath);

  return permWindow;
}

// ─────────────────────────────────────────────────────────────────────────
// Main check: run the permissions flow if needed.
// Returns a Promise that resolves when permissions are satisfied (or skipped).
// ─────────────────────────────────────────────────────────────────────────
function checkPermissions(userDataDir) {
  return new Promise((resolve) => {
    // Skip if not first run and Input Monitoring is already granted.
    if (!isFirstRun(userDataDir) && isInputMonitoringGranted()) {
      resolve();
      return;
    }

    // We need to show the permissions flow.
    const permWindow = createPermissionsWindow();

    // Pass initial state to the window.
    permWindow.webContents.once('ready-to-show', () => {
      permWindow.webContents.send('permissions-check', {
        inputMonitoringGranted: isInputMonitoringGranted(),
        elgatoRunning: isElgatoRunning(),
      });
      permWindow.show();
    });

    // Listen for user actions from the permissions window.
    const handleAction = (event, action) => {
      if (action === 'openSettings') {
        // Open System Preferences → Security & Privacy → Input Monitoring.
        shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'
        );
      } else if (action === 'killElgato') {
        // Kill the Elgato process and update the status.
        const success = killElgato();
        permWindow.webContents.send('elgato-killed', success);
      } else if (action === 'checkPermissionsAgain') {
        // User has granted permission — check again.
        const inputMonitoringGranted = isInputMonitoringGranted();
        permWindow.webContents.send('permissions-check', {
          inputMonitoringGranted,
          elgatoRunning: isElgatoRunning(),
        });
      } else if (action === 'proceed') {
        // All checks passed — mark as done and close.
        markPermissionsComplete(userDataDir);
        permWindow.close();
        resolve();
      } else if (action === 'skip') {
        // User skipped — mark as done anyway (don't show again until uninstall).
        markPermissionsComplete(userDataDir);
        permWindow.close();
        resolve();
      } else if (action === 'quit') {
        // User wants to quit the app.
        app.quit();
      }
    };

    // IPC channel for the permissions window to send actions back.
    // Use .on() instead of .once() so the window can send multiple actions
    // (e.g., checkPermissionsAgain multiple times, openSettings, etc.).
    // We manually remove the listener when the window closes.
    require('electron').ipcMain.on('permissions-action', handleAction);

    permWindow.on('closed', () => {
      require('electron').ipcMain.removeListener(
        'permissions-action',
        handleAction
      );
      // If window closed without action, assume user wants to skip.
      markPermissionsComplete(userDataDir);
      resolve();
    });
  });
}

module.exports = {
  checkPermissions,
  isInputMonitoringGranted,
  isElgatoRunning,
  killElgato,
};
