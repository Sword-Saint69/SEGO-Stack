import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getProviders: () => ipcRenderer.invoke('get-providers'),
  getCatalog: () => ipcRenderer.invoke('get-catalog'),
  checkInstalled: (appId: string) => ipcRenderer.invoke('check-installed', appId),
  checkAllInstalled: () => ipcRenderer.invoke('check-all-installed'),
  installApps: (appIds: string[]) => ipcRenderer.invoke('install-apps', appIds),
  cancelInstall: () => ipcRenderer.invoke('cancel-install'),
  onInstallProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('install-progress', handler)
    return () => ipcRenderer.removeListener('install-progress', handler)
  },
  onInstallLog: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('install-log', handler)
    return () => ipcRenderer.removeListener('install-log', handler)
  }
})
