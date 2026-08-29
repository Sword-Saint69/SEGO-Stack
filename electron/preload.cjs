const { contextBridge, ipcRenderer } = require('electron')

console.log('[SEGO] preload CJS loaded — exposing window.api')

contextBridge.exposeInMainWorld('api', {
  getProviders: () => ipcRenderer.invoke('get-providers'),
  getCatalog: () => ipcRenderer.invoke('get-catalog'),
  getCatalogMeta: () => ipcRenderer.invoke('get-catalog-meta'),
  refreshCatalog: () => ipcRenderer.invoke('refresh-catalog'),
  checkInstalled: (appId) => ipcRenderer.invoke('check-installed', appId),
  checkAllInstalled: () => ipcRenderer.invoke('check-all-installed'),
  installApps: (appIds) => ipcRenderer.invoke('install-apps', appIds),
  cancelInstall: () => ipcRenderer.invoke('cancel-install'),
  onInstallProgress: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('install-progress', handler)
    return () => ipcRenderer.removeListener('install-progress', handler)
  },
  onInstallLog: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('install-log', handler)
    return () => ipcRenderer.removeListener('install-log', handler)
  }
})
