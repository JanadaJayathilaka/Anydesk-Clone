const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getScreenSources: (opts) => ipcRenderer.invoke('desktop-capturer:get-sources', opts),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  startBackend: () => ipcRenderer.invoke('backend:start'),
  getBackendInfo: () => ipcRenderer.invoke('backend:info'),
  broadcastLanPresence: (info) => ipcRenderer.send('lan:broadcast-presence', info),
  scanSubnet: () => ipcRenderer.invoke('lan:scan-subnet'),
  onLanDeviceDiscovered: (callback) => {
    const handler = (event, dev) => callback(dev);
    ipcRenderer.on('lan:discovered-device', handler);
    return () => ipcRenderer.removeListener('lan:discovered-device', handler);
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  simulateInput: (inputEvent) => ipcRenderer.send('system:simulate-input', inputEvent),
  setActiveDisplay: (sourceId) => ipcRenderer.send('session:set-active-display', sourceId),
  startCursorBroadcast: () => ipcRenderer.send('session:start-cursor-broadcast'),
  stopCursorBroadcast: () => ipcRenderer.send('session:stop-cursor-broadcast'),
  onHostCursorPosition: (callback) => {
    const handler = (event, pos) => callback(pos);
    ipcRenderer.on('host:cursor-position', handler);
    return () => ipcRenderer.removeListener('host:cursor-position', handler);
  }
});
