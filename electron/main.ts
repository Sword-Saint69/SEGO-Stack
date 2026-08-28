import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, existsSync } from 'fs'
import { ProviderRouter } from './providers/router.js'

// Portable mode: keep data next to exe if running as portable
// electron-builder portable sets PORTABLE_EXECUTABLE_DIR
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableData = join(process.env.PORTABLE_EXECUTABLE_DIR, 'SEGO-Stack-Data')
  try {
    app.setPath('userData', portableData)
    app.setPath('logs', join(portableData, 'logs'))
  } catch {}
} else if (!app.isPackaged) {
  // dev: keep near project
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null
const router = new ProviderRouter()
let isInstalling = false
let abortRequested = false

// Catalog is bundled at project root or dist - portable aware
function loadCatalog(): any[] {
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || ''
  const candidates = [
    portableDir ? join(portableDir, 'catalog.json') : '',
    join(process.cwd(), 'catalog.json'),
    join(__dirname, '../../catalog.json'),
    join(__dirname, '../catalog.json'),
    join(app.getAppPath(), 'catalog.json'),
    join(dirname(app.getPath('exe')), 'catalog.json'),
    join(dirname(app.getPath('exe')), 'resources', 'catalog.json')
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      const data = readFileSync(p, 'utf-8')
      return JSON.parse(data)
    } catch {}
  }
  console.error('Failed to load catalog.json from candidates:', candidates)
  return []
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'SEGO Stack - by SEGO',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    const indexPath = join(__dirname, '../dist/index.html')
    mainWindow.loadFile(indexPath)
  }

  // mainWindow.webContents.openDevTools()
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// IPC handlers
ipcMain.handle('get-providers', async () => {
  return router.getAvailableProviders()
})

ipcMain.handle('get-catalog', async () => {
  return loadCatalog()
})

ipcMain.handle('check-installed', async (_event, appId: string) => {
  const catalog = loadCatalog()
  const app = catalog.find((a) => a.id === appId)
  if (!app) return false
  return router.isAppInstalled(app)
})

ipcMain.handle('check-all-installed', async () => {
  const catalog = loadCatalog()
  const results: Record<string, boolean> = {}
  // check in parallel with limit
  const batchSize = 5
  for (let i = 0; i < catalog.length; i += batchSize) {
    const batch = catalog.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(async (app: any) => {
        try {
          const installed = await router.isAppInstalled(app)
          return { id: app.id, installed }
        } catch {
          return { id: app.id, installed: false }
        }
      })
    )
    for (const r of batchResults) results[r.id] = r.installed
    // notify progress for UI responsiveness
    mainWindow?.webContents.send('install-progress', { type: 'check-batch', checked: Object.keys(results).length, total: catalog.length })
  }
  return results
})

ipcMain.handle('install-apps', async (_event, appIds: string[]) => {
  if (isInstalling) return { success: false, message: 'Already installing' }
  isInstalling = true
  abortRequested = false

  const catalog = loadCatalog()
  const appsToInstall = catalog.filter((a) => appIds.includes(a.id))

  const results: any[] = []

  for (const app of appsToInstall) {
    if (abortRequested) {
      mainWindow?.webContents.send('install-progress', {
        appId: app.id,
        status: 'skipped',
        message: 'Cancelled'
      })
      results.push({ appId: app.id, status: 'skipped' })
      continue
    }

    mainWindow?.webContents.send('install-progress', {
      appId: app.id,
      status: 'installing',
      message: `Resolving provider for ${app.name}...`
    })

    const resolved = await router.resolveProvider(app)
    if (!resolved) {
      const msg = 'No available provider for this app'
      mainWindow?.webContents.send('install-progress', {
        appId: app.id,
        status: 'failed',
        message: msg
      })
      results.push({ appId: app.id, status: 'failed', message: msg })
      continue
    }

    const { provider, packageId } = resolved

    mainWindow?.webContents.send('install-progress', {
      appId: app.id,
      status: 'installing',
      provider: provider.id,
      message: `Installing via ${provider.id} (${packageId})...`
    })

    try {
      const result = await provider.install(packageId, (chunk) => {
        mainWindow?.webContents.send('install-log', { appId: app.id, chunk })
      })

      if (result.success) {
        mainWindow?.webContents.send('install-progress', {
          appId: app.id,
          status: 'success',
          provider: provider.id,
          message: `Installed via ${provider.id}`,
          output: result.output.slice(-2000)
        })
        results.push({ appId: app.id, status: 'success', provider: provider.id })
      } else {
        // fallback: try next provider if winget fails, try choco
        let fallbackDone = false
        const fallbackOrder = router.getPriorityOrder().filter((p) => p !== provider.id)
        for (const fallbackId of fallbackOrder) {
          const fallbackPkg = app.providers[fallbackId]
          if (!fallbackPkg) continue
          const fallbackProvider = (router.providers as any)[fallbackId]
          const avail = await fallbackProvider.isAvailable()
          if (!avail.available) continue

          mainWindow?.webContents.send('install-progress', {
            appId: app.id,
            status: 'installing',
            provider: fallbackId,
            message: `${provider.id} failed, trying ${fallbackId}...`
          })
          mainWindow?.webContents.send('install-log', { appId: app.id, chunk: `\n--- Fallback to ${fallbackId} ---\n` })
          const fbResult = await fallbackProvider.install(fallbackPkg, (chunk: string) => {
            mainWindow?.webContents.send('install-log', { appId: app.id, chunk })
          })
          if (fbResult.success) {
            mainWindow?.webContents.send('install-progress', {
              appId: app.id,
              status: 'success',
              provider: fallbackId,
              message: `Installed via ${fallbackId} (fallback)`,
              output: fbResult.output.slice(-2000)
            })
            results.push({ appId: app.id, status: 'success', provider: fallbackId })
            fallbackDone = true
            break
          }
        }
        if (!fallbackDone) {
          mainWindow?.webContents.send('install-progress', {
            appId: app.id,
            status: 'failed',
            provider: provider.id,
            message: `Failed via ${provider.id}`,
            output: result.output.slice(-3000)
          })
          results.push({ appId: app.id, status: 'failed', provider: provider.id, output: result.output.slice(-3000) })
        }
      }
    } catch (e: any) {
      mainWindow?.webContents.send('install-progress', {
        appId: app.id,
        status: 'failed',
        message: e.message
      })
      results.push({ appId: app.id, status: 'failed', message: e.message })
    }
  }

  isInstalling = false
  mainWindow?.webContents.send('install-progress', { type: 'done', results })
  return { success: true, results }
})

ipcMain.handle('cancel-install', async () => {
  abortRequested = true
  return { success: true }
})
