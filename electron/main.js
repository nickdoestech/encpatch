/**
 * Electron entry point.
 *
 * Wraps the existing Node server in-process (no separate node.exe / node
 * binary needed — Electron's main process IS Node). Opens a BrowserWindow
 * pointed at the local server. Adds a system-tray menu so the user can
 * quickly Open / Restart engine / Quit without clicks.
 *
 * Build:   npm run dist:mac     (electron-builder produces .app + .dmg)
 * Dev:     npm run dev:electron (runs electron . pointed at server)
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');
const { checkPermissions } = require('./permissions-assistant');
const { initUpdater } = require('./auto-updater');

// In packaged Electron apps stdout/stderr can be closed pipes; any
// console.log down the line will throw EPIPE and crash the process.
// Also: the node-hid native module can throw from its background AsyncWorker
// when the Stream Deck is yanked/sleeps/firmware hiccup — that throw goes
// through libc++abi and abort()s the whole app. Swallow these so the rest
// of the app keeps running. The renderer + hid module will detect the
// dead device on next poll and skip cleanly.
function isBenignNativeErr(err) {
  if (!err) return false;
  const msg = err.message || String(err);
  if (err.code === 'EPIPE' || /EPIPE/.test(msg)) return true;
  // node-hid / libusb errors when the HID device falls off the bus
  if (/HID|hid|libusb|could not write|could not read|device (?:disconnected|not found|timeout)|pipe error|cannot write|cannot read/i.test(msg)) return true;
  return false;
}

process.on('uncaughtException', (err) => {
  if (isBenignNativeErr(err)) {
    try { console.error('[electron] swallowed native err:', err.message); } catch (_) {}
    return;
  }
  try { console.error('[electron] uncaught:', err); } catch (_) {}
});
process.on('unhandledRejection', (err) => {
  if (isBenignNativeErr(err)) {
    try { console.error('[electron] swallowed rejection:', err && err.message); } catch (_) {}
    return;
  }
  try { console.error('[electron] unhandled rejection:', err); } catch (_) {}
});
// Also silence stdout if it was closed
try { process.stdout.on('error', () => {}); process.stderr.on('error', () => {}); } catch (_) {}

let mainWindow = null;
let tray = null;
let serverModule = null;
let serverStartPromise = null;

const SERVER_URL = 'http://127.0.0.1:8733';

// ─────────────────────────────────────────────────────────────────────────
// Boot the existing Node server in this same process. The server doesn't
// need to be modified — we just require it. It listens on its configured
// port (default 8733) and serves both the UI and the REST/WS API.
// ─────────────────────────────────────────────────────────────────────────
function startServer() {
  if (serverStartPromise) return serverStartPromise;
  serverStartPromise = new Promise((resolve) => {
    // Tell the server where to keep its config — must be writable.
    // ~/Library/Application Support/ENCpatch/config.json on macOS.
    // (env var name kept for backwards compat with existing server code.)
    const userDataDir = app.getPath('userData');
    process.env.MA3_MAPPER_CONFIG_PATH = path.join(userDataDir, 'config.json');
    try {
      serverModule = require(path.join(__dirname, '..', 'server', 'server.js'));
    } catch (err) {
      console.error('[electron] failed to start server:', err);
    }
    setTimeout(resolve, 800);
  });
  return serverStartPromise;
}

// ─────────────────────────────────────────────────────────────────────────
// Main window — just a frame around the existing web UI.
// ─────────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#1c1c1e',
    title: 'ENCpatch',
    titleBarStyle: 'hiddenInset',  // Mac: tighter window chrome
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links (e.g. nodejs.org from setup docs) in the system
  // browser, not inside the app frame.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─────────────────────────────────────────────────────────────────────────
// System-tray menu — lives in the menu bar.
// ─────────────────────────────────────────────────────────────────────────
function createTray() {
  // Tiny generic tray icon. macOS template images are monochrome and
  // adapt to dark/light menu bars automatically.
  const iconPath = path.join(__dirname, 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) trayIcon = nativeImage.createEmpty();
  } catch (_) {
    trayIcon = nativeImage.createEmpty();
  }
  // Mark as template so macOS auto-tints in the menu bar.
  if (trayIcon.setTemplateImage) trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('ENCpatch');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open ENCpatch',
      click: () => {
        if (!mainWindow) createWindow();
        else { mainWindow.show(); mainWindow.focus(); }
      },
    },
    {
      label: 'Open in browser',
      click: () => shell.openExternal(SERVER_URL),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]));
}

// ─────────────────────────────────────────────────────────────────────────
// App lifecycle
// ─────────────────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const userDataDir = app.getPath('userData');
  // Run permissions check first. This may show a window if Input Monitoring
  // is not granted or if Elgato is running.
  await checkPermissions(userDataDir);
  // Permissions are satisfied — proceed with startup.
  await startServer();
  createWindow();
  createTray();
  // Start auto-updater after window is created
  await initUpdater(mainWindow);
});

// macOS: don't quit when the last window closes — keep tray alive.
app.on('window-all-closed', (e) => {
  if (process.platform === 'darwin' && !app.isQuitting) e.preventDefault();
  else app.quit();
});

app.on('activate', () => {
  // Mac: clicking dock icon re-opens the window if hidden.
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// v0.13.20: Cmd+Q from macOS menubar fires before-quit BEFORE
// window-all-closed and doesn't go through our tray Quit handler — so
// isQuitting was never being set, the previous frame's preventDefault
// kept the app alive in the tray, and the background server's timers
// (especially the 250ms Eos subscribe loop) kept the Node event loop
// running indefinitely. Result: Cmd+Q felt like a no-op and users
// resorted to force-quit. Fix: explicitly handle before-quit to set
// the flag AND call the server's shutdown() so every socket + timer
// is closed gracefully.
let shutdownPromise = null;
app.on('before-quit', (event) => {
  app.isQuitting = true;
  if (shutdownPromise) return;   // already shutting down — let it finish
  if (!serverModule || typeof serverModule.shutdown !== 'function') return;
  event.preventDefault();   // let our async cleanup run before Electron exits
  shutdownPromise = (async () => {
    try { await serverModule.shutdown(); }
    catch (err) { try { console.error('[electron] shutdown error:', err); } catch (_) {} }
    // Now actually quit. Use app.exit(0) to bypass the before-quit
    // handler this time (no infinite loop) — all our async cleanup is
    // done and we just want the process to terminate.
    app.exit(0);
  })();
});
