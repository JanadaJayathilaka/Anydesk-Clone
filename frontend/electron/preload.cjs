const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  getScreenSources: (opts) => ipcRenderer.invoke('desktop-capturer:get-sources', opts),
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),
  startBackend: () => ipcRenderer.invoke('backend:start'),
  getBackendInfo: () => ipcRenderer.invoke('backend:info'),
  startTunnel: () => ipcRenderer.invoke('tunnel:start'),
  getTunnelUrl: () => ipcRenderer.invoke('tunnel:get-url'),
  onTunnelUrl: (callback) => {
    ipcRenderer.on('tunnel:url-ready', (event, url) => callback(url));
  },
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized')
});
