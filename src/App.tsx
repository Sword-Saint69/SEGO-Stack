import { useEffect, useMemo, useState } from 'react'
import './App.css'
import type { CatalogApp, ProviderId } from './types'

declare global {
  interface Window {
    api: {
      getProviders: () => Promise<{ id: ProviderId; available: boolean; version?: string }[]>
      getCatalog: () => Promise<CatalogApp[]>
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
}

function humanizeError(raw: string): string {
  const low = raw.toLowerCase()
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

  const apiAvailable = !!(window as any).api?.getCatalog

  useEffect(() => {
    const init = async () => {
      try {
        if (!apiAvailable) {
          const res = await fetch('/catalog.json')
          const catalog = await res.json()
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
      setApps(prev => prev.map(a => a.id !== data.appId ? a : { ...a, installStatus: data.status, installMessage: humanMessage }))
    })
    // log no longer needed for activity bar — kept only for debugging
    const off2 = window.api.onInstallLog(() => {})
    return () => { off1(); off2() }
  }, [])

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
      setInstalling(true)
      for (const id of ids) {
        setApps(prev => prev.map(a => a.id === id ? { ...a, installStatus: 'installing' as const } : a))
        await new Promise(r => setTimeout(r, 600))
        setApps(prev => prev.map(a => a.id === id ? { ...a, installStatus: 'success' as const, installed: true } : a))
      }
      setInstalling(false)
      return
    }
    setInstalling(true)
    setApps(prev => prev.map(a => ids.includes(a.id) ? { ...a, installStatus: 'queued' as const } : a))
    try { await window.api.installApps(ids) } catch (e: any) {
      const msg = humanizeError(e?.message || String(e))
      setApps(prev => prev.map(a => ids.includes(a.id) ? { ...a, installStatus: 'failed' as const, installMessage: msg } : a))
      setInstalling(false)
    }
  }

  const handleRefresh = async () => {
    if (!apiAvailable) { setLastSync(formatTime()); return }
    setChecking(true)
    try {
      const [prov, installedMap] = await Promise.all([window.api.getProviders(), window.api.checkAllInstalled()])
      setProviders(prov)
      setApps(prev => prev.map(a => ({ ...a, installed: installedMap[a.id] ?? false, installStatus: installedMap[a.id] ? 'installed' : 'idle' })))
      setLastSync(formatTime())
    } catch {}
    setChecking(false)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand"><span className="brand-mark">S</span> SEGO <span className="brand-stack">Stack</span></div>
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
            else if (isInstalling) statusLine = { text: 'Installing…', cls: 'queued', icon: '⋯' }

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
                    {isInstalling && <span className="inline-bar" style={{ marginLeft: 8 }}><span /></span>}
                  </div>
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
