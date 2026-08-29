import { useEffect, useMemo, useState, useRef } from 'react'
import './App.css'
import type { CatalogApp, ProviderId } from './types'

type ActivityEntry = {
  id: string
  time: string
  pkg: string
  appName: string
  provider?: ProviderId
  status: 'success' | 'failed' | 'installing' | 'queued'
  message: string
  raw?: string
  expanded?: boolean
  progress?: number
}

const REMOTE_CATALOG_URL = 'https://raw.githubusercontent.com/Sword-Saint69/SEGO-Stack/main/catalog.json'
const REMOTE_CATALOG_FALLBACK_URL = 'https://cdn.jsdelivr.net/gh/Sword-Saint69/SEGO-Stack@main/catalog.json'

declare global {
  interface Window {
    api: {
      getProviders: () => Promise<{ id: ProviderId; available: boolean; version?: string }[]>
      getCatalog: () => Promise<CatalogApp[]>
      getCatalogMeta: () => Promise<{ remoteUrl: string; cachePath: string; cachedAt: string | null; cachedCount: number }>
      refreshCatalog: () => Promise<{ success: boolean; catalog: CatalogApp[]; source: string }>
      checkAllInstalled: () => Promise<Record<string, boolean>>
      installApps: (appIds: string[]) => Promise<any>
      onInstallProgress: (cb: (data: any) => void) => () => void
      onInstallLog: (cb: (data: any) => void) => () => void
      cancelInstall: () => Promise<any>
    }
  }
}

type AppState = CatalogApp & {
  selected: boolean
  installed: boolean | null
  installStatus: 'idle' | 'installed' | 'queued' | 'installing' | 'success' | 'failed' | 'skipped'
  installMessage?: string
  installProgress?: number
  installOutput?: string
  expanded?: boolean
}

function humanizeError(raw: string): string {
  const low = raw.toLowerCase()
  if (low.includes('cannot access the file') && low.includes('being used by another process')) return 'Close Discord completely (check Task Manager → Discord.exe) and retry — installer files are locked.'
  if (low.includes('squirrel') && low.includes('aggregateexception')) return 'Close Discord and retry — Squirrel installer files are in use.'
  if (low.includes('4294967295') || low.includes('0xffffffff')) return 'Installer failed — close the app (Discord) and retry, or try “Retry” to use fallback.'
  if (low.includes('no installed package found') || low.includes('no package found') || low.includes('0x8a150061') || low.includes('package not found')) return 'Package not found on configured sources.'
  if (low.includes('0x80073cf9') || low.includes('already installed')) return 'Already installed or blocked.'
  if (low.includes('0x8a150014') || low.includes('manifest')) return 'Manifest not found.'
  if (low.includes('access is denied') || low.includes('elevation') || low.includes('administrator')) return 'Administrator approval required.'
  if (low.includes('internet') || low.includes('network') || low.includes('0x80072ee7')) return 'Network unavailable.'
  if (low.includes('unsafe package id')) return 'Invalid package ID.'
  if (low.includes('cannot read properties') || low.includes('undefined')) return 'Internal error — retry.'
  if (raw.trim().length > 0 && raw.trim().length < 120) return raw.trim()
  return 'Install failed.'
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export default function App() {
  const [apps, setApps] = useState<AppState[]>([])
  const [providers, setProviders] = useState<{ id: ProviderId; available: boolean; version?: string }[]>([])
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState(false)
  const [checking, setChecking] = useState(true)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [activityCollapsed, setActivityCollapsed] = useState(false)
  const activityRef = useRef<HTMLDivElement>(null)

  const [apiAvailable, setApiAvailable] = useState<boolean>(() => !!(window as any).api?.getCatalog)
  const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron')

  // Re-check after mount — preload may attach slightly after first render in some Electron builds
  useEffect(() => {
    const check = !!(window as any).api?.getCatalog
    if (check !== apiAvailable) setApiAvailable(check)
    // Also poll once after 500ms in case preload is delayed
    const t = setTimeout(() => {
      const now = !!(window as any).api?.getCatalog
      if (now !== apiAvailable) setApiAvailable(now)
    }, 500)
    return () => clearTimeout(t)
  }, [apiAvailable])

  // Best-possible catalog fetch for browser (vite dev) — GitHub Raw first
  async function fetchRemoteCatalogBrowser(): Promise<CatalogApp[] | null> {
    for (const url of [REMOTE_CATALOG_URL, REMOTE_CATALOG_FALLBACK_URL]) {
      try {
        const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) } as any)
        if (!res.ok) continue
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0 && data[0].id) return data as CatalogApp[]
      } catch {}
    }
    return null
  }

  useEffect(() => {
    const init = async () => {
      try {
        if (!apiAvailable) {
          if (isElectron) {
            // Preload failed inside Electron — surface it, don't silently fall back to browser catalog
            setActivity(prev => [...prev, { id: 'preload-'+Date.now(), time: formatTime(), pkg: 'system', appName: 'SEGO Stack', status: 'failed', message: 'Preload failed — API not available inside Electron.', raw: `userAgent=${navigator.userAgent} hasWindowApi=${!!(window as any).api} apiKeys=${(window as any).api ? Object.keys((window as any).api).join(',') : 'none'} — try closing and re-running SEGO-Stack-Portable.exe directly, or use win-unpacked/SEGO Stack.exe`, expanded: true }])
            setProviders([])
            setChecking(false)
            // Still load catalog via browser fetch so UI is not empty, but installs will be blocked with error above
            const remote = await fetchRemoteCatalogBrowser()
            const catalog = remote || await (await fetch('/catalog.json')).json()
            setApps(catalog.map((a: CatalogApp) => ({ ...a, selected: false, installed: null, installStatus: 'idle' as const })))
            setLastSync(formatTime() + ' (preload failed)')
            return
          }
          // Browser dev: GitHub Raw → local fallback (same priority as Electron)
          const remote = await fetchRemoteCatalogBrowser()
          const catalog = remote || await (await fetch('/catalog.json')).json()
          setApps(catalog.map((a: CatalogApp) => ({ ...a, selected: false, installed: null, installStatus: 'idle' as const })))
          setProviders([{ id: 'winget', available: true }, { id: 'choco', available: false }, { id: 'scoop', available: false }])
          setChecking(false)
          setLastSync(formatTime())
          return
        }
        const [prov, catalog] = await Promise.all([window.api.getProviders(), window.api.getCatalog()])
        setProviders(prov)
        const initial: AppState[] = catalog.map((a: CatalogApp) => ({ ...a, selected: false, installed: null, installStatus: 'idle' }))
        setApps(initial)
        setLastSync(formatTime())
        try {
          const installedMap = await window.api.checkAllInstalled()
          setApps(prev => prev.map(a => ({ ...a, installed: installedMap[a.id] ?? false, installStatus: installedMap[a.id] ? 'installed' : 'idle' })))
        } catch (e) { console.error(e) }
        setChecking(false)
      } catch (e) { console.error(e); setChecking(false) }
    }
    init()
    if (!apiAvailable) return
    const off1 = window.api.onInstallProgress((data: any) => {
      if (data.type === 'done') { setInstalling(false); return }
      if (data.type === 'check-batch') return
      const humanMessage = data.status === 'failed' ? humanizeError(data.message || data.output || '') : data.message
      setApps(prev => prev.map(a => a.id !== data.appId ? a : { ...a, installStatus: data.status, installMessage: humanMessage, installProgress: data.progress, installOutput: data.output ? (a.installOutput || '') + data.output.slice(-2000) : a.installOutput, expanded: data.status === 'failed' ? true : a.expanded }))
      // Activity entries for testing/debug
      const now = formatTime()
      if (data.status === 'installing') {
        setActivity(prev => {
          const existing = prev.find(p => p.pkg === data.appId && p.status === 'installing')
          if (existing) {
            // update progress/message in place
            return prev.map(p => p.pkg === data.appId && p.status === 'installing' ? { ...p, message: data.message || p.message, progress: data.progress ?? p.progress, provider: data.provider || p.provider } : p)
          }
          return [...prev, { id: data.appId + '-' + Date.now(), time: now, pkg: data.appId, appName: apps.find(a=>a.id===data.appId)?.name || data.appId, provider: data.provider, status: 'installing', message: data.message || 'Installing…', raw: '', progress: data.progress ?? 5 }]
        })
      } else if (data.status === 'success') {
        setActivity(prev => [...prev.filter(p => !(p.pkg === data.appId && p.status === 'installing')), { id: data.appId + '-' + Date.now(), time: now, pkg: data.appId, appName: apps.find(a=>a.id===data.appId)?.name || data.appId, provider: data.provider, status: 'success', message: 'Installed', raw: data.output?.slice(0,4000), progress: 100 }])
      } else if (data.status === 'failed') {
        setActivity(prev => [...prev.filter(p => !(p.pkg === data.appId && p.status === 'installing')), { id: data.appId + '-' + Date.now(), time: now, pkg: data.appId, appName: apps.find(a=>a.id===data.appId)?.name || data.appId, provider: data.provider, status: 'failed', message: humanMessage, raw: (data.output || data.message || '').slice(0,6000), expanded: true, progress: data.progress }])
      } else if (data.status === 'queued') {
        setActivity(prev => {
          if (prev.find(p => p.pkg === data.appId && p.status === 'queued')) return prev
          return [...prev, { id: data.appId + '-' + Date.now(), time: now, pkg: data.appId, appName: apps.find(a=>a.id===data.appId)?.name || data.appId, status: 'queued', message: data.message || 'Queued', raw: '', progress: 0 }]
        })
      }
    })
    const off2 = window.api.onInstallLog((data: any) => {
      setActivity(prev => {
        const idx = [...prev].reverse().findIndex(p => p.pkg === data.appId && p.status === 'installing')
        if (idx === -1) return prev
        const realIdx = prev.length - 1 - idx
        const copy = [...prev]
        const chunk: string = data.chunk || ''
        let prog: number | undefined
        const pctMatch = chunk.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
        if (pctMatch) {
          const v = parseFloat(pctMatch[1])
          if (!isNaN(v) && v >= 0 && v <= 100) prog = Math.min(95, Math.max(5, v))
        } else if (/downloading/i.test(chunk)) prog = 30
        else if (/verif|hash/i.test(chunk)) prog = 60
        else if (/starting.*install|apply|extract/i.test(chunk)) prog = 80
        copy[realIdx] = { ...copy[realIdx], raw: (copy[realIdx].raw || '') + chunk, progress: prog ?? copy[realIdx].progress }
        return copy
      })
      // also bump card progress + output from log chunks
      const chunk: string = data.chunk || ''
      let prog: number | undefined
      const m = chunk.match(/(\d{1,3}(?:\.\d+)?)\s*%/)
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v) && v >=0 && v <=100) prog = Math.min(95, v) }
      else if (/downloading/i.test(chunk)) prog = 35
      else if (/verif|hash/i.test(chunk)) prog = 65
      else if (/starting.*install|apply|extract/i.test(chunk)) prog = 85
      setApps(prev => prev.map(a => a.id === data.appId ? { ...a, installProgress: prog !== undefined && a.installStatus === 'installing' ? prog : a.installProgress, installOutput: a.id === data.appId ? (a.installOutput || '') + chunk.slice(-4000) : a.installOutput } : a))
    })
    return () => { off1(); off2() }
  }, [apiAvailable, isElectron])

  useEffect(() => {
    if (activityRef.current) activityRef.current.scrollTop = activityRef.current.scrollHeight
  }, [activity])

  const filtered = useMemo(() => {
    return apps.filter(a => {
      if (search) {
        const q = search.toLowerCase()
        if (!a.name.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q) && !(a.providers.winget || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [apps, search])

  const selectedToInstall = apps.filter(a => a.selected && !a.installed)
  const anyProvider = providers.some(p => p.available)

  const toggleSelect = (id: string) => setApps(prev => prev.map(a => a.id === id ? { ...a, selected: !a.selected } : a))
  const clearAll = () => setApps(prev => prev.map(a => ({ ...a, selected: false })))
  const selectAllFiltered = () => {
    const ids = new Set(filtered.filter(a => !a.installed).map(a => a.id))
    setApps(prev => prev.map(a => ids.has(a.id) ? { ...a, selected: true } : a))
  }

  const handleInstall = async (specificId?: string) => {
    const ids = specificId ? [specificId] : selectedToInstall.map(a => a.id)
    if (ids.length === 0) return
    if (!apiAvailable) {
      if (isElectron) {
        // Electron but preload failed — do NOT simulate, surface the real error so it can be fixed
        const msg = 'Electron API not available — preload failed. Close and re-run SEGO-Stack-Portable.exe (not via browser) and check Activity for details.'
        setActivity(prev => [...prev, { id: 'preload-fail-'+Date.now(), time: formatTime(), pkg: 'system', appName: 'SEGO Stack', status: 'failed', message: msg, raw: `isElectron=${isElectron} apiAvailable=${apiAvailable} userAgent=${typeof navigator!=='undefined'?navigator.userAgent:'n/a'} hasWindowApi=${!!(window as any).api} preloadPath should be dist-electron/preload.js — if this persists try win-unpacked/SEGO Stack.exe or run as admin.`, expanded: true }])
        // also mark the clicked card as failed so user sees it inline
        setApps(prev => prev.map(a => ids.includes(a.id) ? { ...a, installStatus: 'failed' as const, installMessage: msg } : a))
        return
      }
      // Browser preview — simulate and log to activity bar so tester sees full flow
      setInstalling(true)
      for (const id of ids) {
        const name = apps.find(a=>a.id===id)?.name || id
        setApps(prev => prev.map(a => a.id === id ? { ...a, installStatus: 'installing' as const, installMessage: 'Preview — not actually installing. Use Portable EXE.' } : a))
        setActivity(prev => [...prev, { id: id+Date.now(), time: formatTime(), pkg: id, appName: name, status: 'installing', message: 'Preview — simulating install…', raw: 'Browser preview — no winget here. Use SEGO-Stack-Portable.exe for real install.' }])
        await new Promise(r => setTimeout(r, 1800))
        setApps(prev => prev.map(a => a.id === id ? { ...a, installStatus: 'success' as const, installMessage: 'Preview — download Portable EXE for real install.' } : a))
        setActivity(prev => [...prev.filter(p=>!(p.pkg===id && p.status==='installing')), { id: id+Date.now()+'-done', time: formatTime(), pkg: id, appName: name, status: 'success', message: 'Preview — simulated success', raw: 'This was a browser preview. No files were changed.' }])
        await new Promise(r => setTimeout(r, 500))
      }
      setInstalling(false)
      return
    }
    setInstalling(true)
    const now = formatTime()
    setActivity(prev => [...prev, ...ids.map(id => ({ id: id+Date.now()+Math.random(), time: now, pkg: id, appName: apps.find(a=>a.id===id)?.name || id, status: 'queued' as const, message: 'Queued', raw: '' }))])
    setApps(prev => prev.map(a => ids.includes(a.id) ? { ...a, installStatus: 'queued' as const } : a))
    try { await window.api.installApps(ids) } catch (e: any) {
      const msg = humanizeError(e?.message || String(e))
      setApps(prev => prev.map(a => ids.includes(a.id) ? { ...a, installStatus: 'failed' as const, installMessage: msg } : a))
      setActivity(prev => [...prev, { id: 'err-'+Date.now(), time: formatTime(), pkg: 'system', appName: 'SEGO Stack', status: 'failed', message: msg, raw: String(e?.stack || e?.message || e), expanded: true }])
      setInstalling(false)
    }
  }

  const handleRetry = (pkg: string) => handleInstall(pkg)

  const handleRefresh = async () => {
    setChecking(true)
    try {
      if (!apiAvailable) {
        const remote = await fetchRemoteCatalogBrowser()
        const catalog = remote || await (await fetch('/catalog.json')).json()
        setApps(catalog.map((a: CatalogApp) => ({ ...a, selected: false, installed: null, installStatus: 'idle' as const })))
        setLastSync(formatTime())
      } else {
        // Force remote re-fetch via main process, then re-check installed
        const refreshed = await (window.api as any).refreshCatalog?.()
        const catalog: CatalogApp[] = refreshed?.catalog || await window.api.getCatalog()
        const [prov, installedMap] = await Promise.all([window.api.getProviders(), window.api.checkAllInstalled()])
        setProviders(prov)
        setApps(catalog.map(a => ({ ...a, selected: false, installed: installedMap[a.id] ?? false, installStatus: installedMap[a.id] ? 'installed' : 'idle' })))
        setLastSync(formatTime())
      }
    } catch {}
    setChecking(false)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand"><img src="icons/main.png" alt="SEGO" width="26" height="26" style={{ borderRadius: 6, objectFit: 'contain' }} onError={e => (e.currentTarget.style.display='none')} /> SEGO <span className="brand-stack">Stack</span></div>
          <div className="topbar-meta">
            <span>Catalog synced {lastSync ? `${lastSync}` : '—'}</span>
            <span>·</span>
            <button className="link-btn" onClick={handleRefresh} disabled={checking}>{checking ? 'Syncing…' : 'Refresh'}</button>
          </div>
        </div>
        <div className="provider-toggles" role="group" aria-label="Providers">
          {providers.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{checking ? 'Detecting…' : 'No providers'}</span>
          ) : providers.map(p => {
            const active = p.available
            return (
              <span key={p.id} className={`provider-chip ${active ? 'active available' : 'inactive'}`} title={active ? `Active — installs use ${p.id} when an app supports it` : `${p.id} not found`}>
                <span className="dot" /> {p.id}
              </span>
            )
          })}
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" title="Refresh" onClick={handleRefresh} aria-label="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v7h-7"/></svg>
          </button>
        </div>
      </header>

      {!apiAvailable && !isElectron && (
        <div style={{ background: '#FEF3C7', borderBottom: '1px solid #FDE68A', padding: '8px 20px', fontSize: 12.5, color: '#92400E', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>⚠ Preview mode — you are in the browser. Installs are <strong>simulated</strong> and take ~2s. For real installs, download and run <code style={{ background: '#fff', padding: '1px 6px', borderRadius: 4, border: '1px solid #FDE68A' }}>SEGO-Stack-Portable.exe</code> from Releases.</span>
          <a href="https://github.com/Sword-Saint69/SEGO-Stack/releases" target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: '#92400E', fontWeight: 600, textDecoration: 'underline' }}>Get Portable</a>
        </div>
      )}
      {isElectron && !apiAvailable && (
        <div style={{ background: '#FEE2E2', borderBottom: '1px solid #FECACA', padding: '8px 20px', fontSize: 12.5, color: '#991B1B', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>⚠ Electron detected but API not available — <strong>preload failed</strong>. Close this window and run <code style={{ background: '#fff', padding: '1px 6px', borderRadius: 4, border: '1px solid #FECACA' }}>SEGO-Stack-Portable.exe</code> directly (not via browser). If it persists, try <code style={{ background: '#fff', padding: '1px 6px', borderRadius: 4, border: '1px solid #FECACA' }}>win-unpacked/SEGO Stack.exe</code> or Run as Administrator. Check Activity below for details.</span>
        </div>
      )}

      <main className="content">
        <div className="content-toolbar">
          <div className="search-wrap">
            <span className="search-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
            <input placeholder="Search apps, package IDs…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search apps" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}><strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{selectedToInstall.length}</strong> selected</span>
            <span style={{ color: 'var(--border-default)' }}>·</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{filtered.length} shown</span>
            <button className="btn btn-ghost btn-sm" onClick={selectAllFiltered} disabled={installing}>Select all</button>
            <button className="btn btn-ghost btn-sm" onClick={clearAll} disabled={installing || selectedToInstall.length===0}>Clear</button>
            <button className="btn btn-primary" onClick={() => handleInstall()} disabled={installing || selectedToInstall.length===0 || !anyProvider}>
              {selectedToInstall.length===0 ? 'Select apps to install' : `Install ${selectedToInstall.length} ${selectedToInstall.length===1?'app':'apps'}`}
            </button>
          </div>
        </div>

        <div className="grid">
          {filtered.map(app => {
            const pkgId = app.providers.winget || app.providers.choco || app.providers.scoop || ''
            const isInstalled = !!app.installed || app.installStatus === 'success'
            const isFailed = app.installStatus === 'failed'
            const isInstalling = app.installStatus === 'installing' || app.installStatus === 'queued'
            let cardTint = ''
            if (isInstalled) cardTint = 'tint-installed'
            else if (isFailed) cardTint = 'tint-failed'
            let statusLine: { text: string; cls: string; icon: string } | null = null
            if (isInstalled) statusLine = { text: 'Installed', cls: 'installed', icon: '✓' }
            else if (isFailed) statusLine = { text: app.installMessage || 'Failed', cls: 'failed', icon: '⚠' }
            else if (isInstalling) {
              const pct = app.installProgress
              const label = pct !== undefined && pct > 0 && pct < 100 ? `Installing… ${Math.round(pct)}%` : 'Installing…'
              statusLine = { text: label, cls: 'queued', icon: '⋯' }
            }

            return (
              <div key={app.id} className={`grid-card ${cardTint} ${app.selected ? 'selected' : ''}`}>
                <div className="grid-card-top">
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{app.category}</span>
                  <input type="checkbox" className="row-check" checked={app.selected} disabled={isInstalled || installing} onChange={() => toggleSelect(app.id)} aria-label={`Select ${app.name}`} />
                </div>
                <div className="grid-card-icon">
                  <img src={app.icon} alt={app.name} loading="lazy" onError={e => { const t = e.currentTarget; t.style.display='none'; const p=t.parentElement; if(p) p.textContent=app.name.slice(0,2).toUpperCase() }} />
                </div>
                <div className="grid-card-name">{app.name}</div>
                <div className="mono grid-card-id" title={pkgId}>{pkgId}</div>
                {statusLine && (
                  <div className={`grid-card-status ${statusLine.cls}`}>
                    <span aria-hidden>{statusLine.icon}</span> {statusLine.text}
                    {isInstalling && (
                      app.installProgress !== undefined && app.installProgress > 0 && app.installProgress < 100 ? (
                        <span className="inline-bar determinate" style={{ marginLeft: 8 }}><span style={{ width: `${app.installProgress}%`, animation: 'none', transform: 'none' }} /></span>
                      ) : (
                        <span className="inline-bar" style={{ marginLeft: 8 }}><span /></span>
                      )
                    )}
                  </div>
                )}
                {isInstalling && (
                  <div className="card-progress"><div className="card-progress-fill" style={{ width: `${app.installProgress !== undefined ? Math.min(100, Math.max(0, app.installProgress)) : 12}%`, animation: app.installProgress === undefined ? 'indeterminate 1.2s ease-in-out infinite' : undefined }} /></div>
                )}
                {(app.installOutput || isFailed || isInstalling) && app.installProgress !== undefined && (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{app.installProgress !== undefined ? `${Math.round(app.installProgress)}%` : ''} {isInstalling ? 'downloading…' : ''}</div>
                )}
                {(app.installOutput || isFailed) && (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 2 }}>
                    <button className="link-btn" style={{ fontSize: 11 }} onClick={() => setApps(prev => prev.map(a => a.id === app.id ? { ...a, expanded: !a.expanded } : a))}>{app.expanded ? 'Hide log' : 'View log'}</button>
                    {isFailed && <button className="link-btn" style={{ fontSize: 11 }} onClick={() => handleInstall(app.id)} disabled={installing}>Retry</button>}
                  </div>
                )}
                {app.expanded && app.installOutput && (
                  <div className="card-details" style={{ maxHeight: 90, overflow: 'auto', background: 'var(--bg-sunken)', border: '1px solid var(--border-default)', borderRadius: 6, padding: '6px 8px', fontSize: 10.5, lineHeight: '14px', fontFamily: 'IBM Plex Mono, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>{app.installOutput.slice(-2500)}</div>
                )}
                <div className="grid-card-action">
                  {isInstalled ? (
                    <button className="btn btn-ghost" style={{ width: '100%' }} disabled>Installed</button>
                  ) : isFailed ? (
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => handleInstall(app.id)} disabled={installing}>Retry</button>
                  ) : isInstalling ? (
                    <button className="btn btn-ghost" style={{ width: '100%' }} disabled>Installing…</button>
                  ) : (
                    <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => handleInstall(app.id)} disabled={installing}>Install</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {filtered.length === 0 && <div className="empty-state">No apps match “{search}”. Try a different name.</div>}
      </main>
    </div>
  )
}
