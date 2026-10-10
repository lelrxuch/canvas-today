'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Valor de un argumento --nombre=valor que el proceso principal pasa en additionalArguments. */
function arg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

contextBridge.exposeInMainWorld('canvas', {
  locale: { lang: arg('canvas-today-lang'), intlLocale: arg('canvas-today-intl') },
  platform: arg('canvas-today-platform'),
  getState: () => ipcRenderer.invoke('get-state'),
  refresh: () => ipcRenderer.invoke('refresh'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDetails: (id) => ipcRenderer.invoke('get-details', id),
  setComplete: (id, complete) => ipcRenderer.invoke('set-complete', id, complete),
  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  openCanvas: () => ipcRenderer.invoke('open-canvas'),
  openLogin: () => ipcRenderer.invoke('open-login'),
  hide: () => ipcRenderer.invoke('hide'),
  minimize: () => ipcRenderer.invoke('minimize'),
  togglePin: () => ipcRenderer.invoke('toggle-pin'),
  quit: () => ipcRenderer.invoke('quit'),
  onState: (cb) => listen('state', cb),
  onWallpaper: (cb) => listen('wallpaper', cb),
  onGeometry: (cb) => listen('geometry', cb),
});

function listen(channel, cb) {
  const handler = (_e, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
