import { app, BrowserWindow, ipcMain } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { ProviderRouter } from './providers/router.js'

// ── Remote catalog (GitHub Raw) — single source of truth ──
// Users get catalog updates without rebuilding the EXE.
// Local catalog.json is only a fallback for offline / first run.
const REMOTE_CATALOG_URL = 'https://raw.githubusercontent.com/Sword-Saint69/SEGO-Stack/main/catalog.json'
const REMOTE_CATALOG_FALLBACK_URL = 'https://cdn.jsdelivr.net/gh/Sword-Saint69/SEGO-Stack@main/catalog.json'
const CATALOG_CACHE_FILE = 'catalog-cache.json'
const CATALOG_FETCH_TIMEOUT_MS = 6000

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

// Catalog is bundled at project root or dist - portable aware (local fallback)
function loadLocalCatalog(): any[] {
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
      const parsed = JSON.parse(data)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {}
  }
  return []
}

function getCachePath(): string {
  try {
    return join(app.getPath('userData'), CATALOG_CACHE_FILE)
  } catch {
    return join(process.cwd(), CATALOG_CACHE_FILE)
  }
}

function loadCachedCatalog(): any[] | null {
  try {
    const p = getCachePath()
    if (!existsSync(p)) return null
    const raw = readFileSync(p, 'utf-8')
    const obj = JSON.parse(raw)
    if (obj && Array.isArray(obj.catalog) && obj.catalog.length > 0) return obj.catalog
    if (Array.isArray(obj) && obj.length > 0) return obj // legacy plain array cache
  } catch {}
  return null
}

function saveCachedCatalog(catalog: any[]) {
  try {
    const p = getCachePath()
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify({ catalog, fetchedAt: new Date().toISOString(), source: REMOTE_CATALOG_URL }, null, 2), 'utf-8')
  } catch (e) { console.warn('Failed to cache catalog', e) }
}

function isValidCatalog(data: any): boolean {
  return Array.isArray(data) && data.length > 0 && data.every((a: any) => a && typeof a.id === 'string' && typeof a.name === 'string' && a.providers)
}

async function fetchRemoteCatalog(): Promise<any[] | null> {
  const urls = [REMOTE_CATALOG_URL, REMOTE_CATALOG_FALLBACK_URL]
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        // @ts-ignore — Node 18+ has timeout via signal
        signal: AbortSignal.timeout(CATALOG_FETCH_TIMEOUT_MS),
        headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' }
      } as any)
      if (!res.ok) continue
      const data = await res.json()
      if (isValidCatalog(data)) {
        saveCachedCatalog(data)
        console.log(`Catalog fetched from ${url} — ${data.length} apps`)
        return data
      }
    } catch (e) { console.warn(`Catalog fetch failed ${url}`, (e as any)?.message || e) }
  }
  return null
}

// Best-possible fetch: remote → cache → bundled fallback
async function getCatalog(): Promise<any[]> {
  // 1. Try remote (fast, always fresh)
  const remote = await fetchRemoteCatalog()
  if (remote) return remote
  // 2. Try disk cache from previous successful fetch (offline after first run)
  const cached = loadCachedCatalog()
  if (cached) {
    console.log(`Using cached catalog — ${cached.length} apps`)
    return cached
  }
  // 3. Fall back to bundled local catalog (first run offline)
  const local = loadLocalCatalog()
  if (local.length > 0) {
    console.log(`Using bundled catalog — ${local.length} apps`)
    return local
  }
  console.error('No catalog available (remote, cache, and local all failed)')
  return []
}

// Sync wrapper for places that must remain sync (kept for backwards-compat, prefers cache)
function loadCatalog(): any[] {
  return loadCachedCatalog() || loadLocalCatalog()
}

function getAppIconPath(): string | undefined {
  // Prefer main.png next to catalog (portable dir), then public/icons, then dist/icons
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'public', 'icons', 'main.png') : '',
    join(process.cwd(), 'public', 'icons', 'main.png'),
    join(process.cwd(), 'public', 'icons', 'main.ico'),
    join(__dirname, '../../public/icons/main.png'),
    join(__dirname, '../dist/icons/main.png'),
    join(app.getAppPath(), 'public', 'icons', 'main.png'),
    join(dirname(app.getPath('exe')), 'resources', 'app.asar.unpacked', 'public', 'icons', 'main.png'),
  ].filter(Boolean) as string[]
  for (const p of candidates) { try { if (existsSync(p)) return p } catch {} }
  return undefined
}

function createWindow() {
  const iconPath = getAppIconPath()
  if (iconPath) console.log('Using app icon:', iconPath)
  // Prefer CJS preload (works with type:module), fallback to .js
  const preloadCandidates = [join(__dirname, 'preload.cjs'), join(__dirname, 'preload.js')]
  let preloadPath = preloadCandidates[0]
  for (const p of preloadCandidates) { if (existsSync(p)) { preloadPath = p; break } }
  console.log('Preload path:', preloadPath, 'exists:', existsSync(preloadPath))
  console.log('__dirname:', __dirname, 'isPackaged:', app.isPackaged, 'candidates:', preloadCandidates.map(p => `${p}:${existsSync(p)}`).join(' '))
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'SEGO Stack - by SEGO',
    backgroundColor: '#ffffff',
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
  return getCatalog()
})

ipcMain.handle('get-catalog-meta', async () => {
  const cachePath = getCachePath()
  let cachedAt: string | null = null
  let cachedCount = 0
  try {
    const raw = readFileSync(cachePath, 'utf-8')
    const obj = JSON.parse(raw)
    cachedAt = obj.fetchedAt || null
    cachedCount = obj.catalog?.length || 0
  } catch {}
  return { remoteUrl: REMOTE_CATALOG_URL, cachePath, cachedAt, cachedCount }
})

ipcMain.handle('refresh-catalog', async () => {
  // Force re-fetch from GitHub Raw (bypass cache by fetching remote directly)
  const remote = await fetchRemoteCatalog()
  if (remote) return { success: true, catalog: remote, source: 'remote' }
  const cached = loadCachedCatalog()
  if (cached) return { success: true, catalog: cached, source: 'cache' }
  const local = loadLocalCatalog()
  return { success: local.length > 0, catalog: local, source: 'local' }
})

ipcMain.handle('check-installed', async (_event, appId: string) => {
  const catalog = await getCatalog()
  const app = catalog.find((a) => a.id === appId)
  if (!app) return false
  return router.isAppInstalled(app)
})

ipcMain.handle('check-all-installed', async () => {
  const catalog = await getCatalog()
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

  const catalog = await getCatalog()
  const appsToInstall = catalog.filter((a) => appIds.includes(a.id))

  const results: any[] = []

  // Helper: kill known conflicting processes before Squirrel-based installs (Discord, etc.)
  const tryKillProcess = async (imageName: string) => {
    try {
      const { exec } = await import('child_process')
      await new Promise<void>((res) => {
        exec(`taskkill /IM "${imageName}" /F`, { windowsHide: true } as any, () => res())
      })
    } catch {}
  }

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

    // Pre-close known lock holders for Squirrel installers (Discord is notorious)
    if (app.id === 'discord') {
      mainWindow?.webContents.send('install-log', { appId: app.id, chunk: `\n--- Closing Discord.exe if running (Squirrel lock fix) ---\n` })
      await tryKillProcess('Discord.exe')
      await tryKillProcess('DiscordUpdater.exe')
      // also killUpdate via Squirrel temp
      await new Promise(r => setTimeout(r, 1500))
    }

    let curProgress = 10
    const sendProgress = (chunk: string) => {
      // Estimate progress from chunk text
      let next: number | undefined
      const pctMatch = chunk.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
      if (pctMatch) {
        const v = parseFloat(pctMatch[1])
        if (!isNaN(v) && v >= 0 && v <= 100) next = Math.min(95, Math.max(5, v))
      } else if (/downloading/i.test(chunk)) next = Math.max(curProgress, 25)
      else if (/downloaded|verif|hash/i.test(chunk)) next = Math.max(curProgress, 55)
      else if (/starting.*install|extract|apply|installing/i.test(chunk)) next = Math.max(curProgress, 75)
      else if (/bytes|received/i.test(chunk)) next = Math.min(90, curProgress + 2)
      if (next !== undefined && next > curProgress) {
        curProgress = next
        mainWindow?.webContents.send('install-progress', {
          appId: app.id,
          status: 'installing',
          provider: provider.id,
          message: `Installing via ${provider.id} (${packageId})... ${Math.round(curProgress)}%`,
          progress: curProgress
        })
      }
      mainWindow?.webContents.send('install-log', { appId: app.id, chunk })
    }

    mainWindow?.webContents.send('install-progress', {
      appId: app.id,
      status: 'installing',
      provider: provider.id,
      message: `Installing via ${provider.id} (${packageId})...`,
      progress: curProgress
    })

    try {
      const result = await provider.install(packageId, (chunk) => sendProgress(chunk))

      if (result.success) {
        mainWindow?.webContents.send('install-progress', {
          appId: app.id,
          status: 'success',
          provider: provider.id,
          message: `Installed via ${provider.id}`,
          output: result.output.slice(-2000),
          progress: 100
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
            message: `${provider.id} failed, trying ${fallbackId}...`,
            progress: curProgress
          })
          mainWindow?.webContents.send('install-log', { appId: app.id, chunk: `\n--- Fallback to ${fallbackId} ---\n` })
          let fbProgress = curProgress
          const fbSend = (chunk: string) => {
            const m = chunk.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
            if (m) { const v = parseFloat(m[1]); if (!isNaN(v) && v >=0 && v <=100) fbProgress = Math.min(95, Math.max(fbProgress, v)) ; mainWindow?.webContents.send('install-progress', { appId: app.id, status: 'installing', provider: fallbackId, message: `Installing via ${fallbackId} (${fallbackPkg})... ${Math.round(fbProgress)}%`, progress: fbProgress }) }
            mainWindow?.webContents.send('install-log', { appId: app.id, chunk })
          }
          const fbResult = await fallbackProvider.install(fallbackPkg, (chunk: string) => fbSend(chunk))
          if (fbResult.success) {
            mainWindow?.webContents.send('install-progress', {
              appId: app.id,
              status: 'success',
              provider: fallbackId,
              message: `Installed via ${fallbackId} (fallback)`,
              output: fbResult.output.slice(-2000),
              progress: 100
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
            output: result.output.slice(-3000),
            progress: curProgress
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
