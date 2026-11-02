/**
 * Preload script for permissions assistant window.
 * Provides safe IPC channel for the HTML window to communicate with Electron main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('permissionsAPI', {
  onPermissionsCheck: (callback) => {
    ipcRenderer.on('permissions-check', (event, data) => {
      callback(data);
    });
  },
  onElgatoKilled: (callback) => {
    ipcRenderer.on('elgato-killed', (event, success) => {
      callback(success);
    });
  },
  sendAction: (action) => {
    ipcRenderer.send('permissions-action', action);
  },
});
