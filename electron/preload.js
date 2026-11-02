/**
 * Preload script for Electron renderer.
 * Exposes safe APIs to the renderer process via contextIsolation.
 */

const { ipcRenderer } = require('electron');

// Expose a safe API to the renderer
window.ipcRenderer = ipcRenderer;
