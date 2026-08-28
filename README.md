<p align="center">
  <img src="public/icons/vscode.svg" width="72" height="72" alt="SEGO Stack" />
</p>

<h1 align="center">SEGO Stack</h1>

<p align="center">
  <strong>Portable Windows Package Manager — by SEGO</strong><br/>
  <em>Pick apps. Click Install. Done. No installer. No bloat.</em>
</p>

<p align="center">
  <a href="https://github.com/Sword-Saint69/SEGO-Stack/releases"><img src="https://img.shields.io/github/v/release/Sword-Saint69/SEGO-Stack?style=flat-square&label=version&color=1955A8" alt="Release"/></a>
  <a href="https://github.com/Sword-Saint69/SEGO-Stack"><img src="https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows"/></a>
  <a href="https://github.com/Sword-Saint69/SEGO-Stack"><img src="https://img.shields.io/badge/portable-single%20EXE-F6F6F7?style=flat-square&labelColor=19191C" alt="Portable"/></a>
  <a href="https://github.com/Sword-Saint69/SEGO-Stack/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-E1E1E4?style=flat-square&labelColor=ffffff&color=5B5B63" alt="License"/></a>
  <img src="https://img.shields.io/badge/providers-winget%20·%20choco%20·%20scoop-1955A8?style=flat-square" alt="Providers"/>
</p>

<p align="center">
  <code>SEGO-Stack-Portable-0.1.0-x64.exe</code> — one file, double-click, no admin for the app itself.<br/>
  UAC only when winget / choco actually installs something.
</p>

---

### Why SEGO Stack exists

Setting up a new Windows machine means typing 30 `winget install` commands, hunting silent flags, and hoping you didn't miss one. SEGO Stack is the **inventory-tool alternative** to an app store: dense, predictable, and inspectable. You see the real package ID (`Microsoft.VisualStudioCode` in `IBM Plex Mono`), the real provider, and the real outcome — never a fake hacker terminal.

Built for developers who would otherwise just script it themselves.

---

### Screenshot

<p align="center">
  <img src="docs/screenshot.png" alt="SEGO Stack — 4-per-row grid with original icons" width="920" />
  <br/>
  <em>4-per-row grid · original brand logos · 6px cards · single accent (#1955A8) reserved for actions only</em>
</p>

> No sidebar. No activity dump. Just search, tick, and install.

---

### Features

| | Detail |
|---|---|
| **Portable** | Single EXE `release/SEGO-Stack-Portable-*.exe` (~73 MB). Run from Desktop, USB, or network share. Data in `SEGO-Stack-Data/` next to the EXE. |
| **Wraps what you trust** | Priority `winget → choco → scoop` per app. Auto-detects what's available, falls back if one fails. Silent flags handled for you (`--silent --accept-package-agreements`). |
| **Curated but yours** | 20 apps pre-mapped (VS Code, Chrome, Firefox, Brave, 7-Zip, VLC, Spotify, Discord, Git, Node LTS, Python, Notepad++, Steam, OBS Studio, PowerToys, Docker Desktop, Zoom, Slack, Malwarebytes, Everything). **Live catalog** — `catalog.json` is fetched from GitHub Raw [`raw.githubusercontent.com/Sword-Saint69/SEGO-Stack/main/catalog.json`](https://raw.githubusercontent.com/Sword-Saint69/SEGO-Stack/main/catalog.json) with jsDelivr fallback, cached to `userData/catalog-cache.json`, and falls back to bundled file offline. Ship catalog updates without rebuilding the EXE — just push `catalog.json`. Override locally with a `catalog.json` next to the EXE. |
| **Grid built for scanning** | 4 cards per row (responsive 3 / 2 / 1), 68px original icon, mono package ID (`11px IBM Plex Mono`), status tints only when it matters (`Installed` green, `Failed` red, `Installing…` indeterminate). No pills, no avatar bubbles. |
| **Safe by default** | IDs validated `^[a-zA-Z0-9._\-]+$`, spawned as arg arrays (no shell), installs from official vendor only. Errors are human sentences (`Package not found on configured sources.`), raw trace only on demand. |

---

### Quick Start

**You just want to install apps:**

1. Download `SEGO-Stack-Portable-0.1.0-x64.exe` from [Releases](../../releases)
2. Double-click — no install
3. Search, tick apps, click **Install N apps** (or **Install** on a single card)

**You want to add your own app:**

Create `catalog.json` next to the EXE:

```json
[
  {
    "id": "myapp",
    "name": "My App",
    "description": "Does useful stuff",
    "category": "Utilities",
    "icon": "icons/myapp.svg",
    "providers": {
      "winget": "Publisher.MyApp",
      "choco": "myapp",
      "scoop": "myapp"
    }
  }
]
```

Find IDs with `winget search <name>` or `choco search <name>`.

---

### Project Structure

```
sego-stack/
├── catalog.json              # ← source of truth, served live via GitHub Raw
├── public/icons/             # original brand SVGs (local, offline)
│   └── vscode.svg, chrome.svg, ...
├── electron/
│   ├── main.ts               # window + portable userData + GitHub Raw catalog loader (remote → cache → local)
│   ├── preload.ts            # secure IPC bridge (contextIsolation) + getCatalogMeta/refreshCatalog
│   └── providers/
│       ├── base.ts           # safe spawn, ID validation
│       ├── winget.ts         # winget --silent
│       ├── choco.ts          # choco -y
│       ├── scoop.ts
│       └── router.ts         # winget > choco > scoop
├── src/
│   ├── App.tsx               # grid-only 4-per-row UI
│   ├── App.css               # tokens: 4px/6px radius, no shadows, tabular nums
│   └── index.css             # --bg-canvas #F6F6F7, IBM Plex Sans/Mono
└── release/
    └── SEGO-Stack-Portable-0.1.0-x64.exe
```

**Design tokens** are in `src/index.css:3` — `bg-canvas #F6F6F7`, `accent #1955A8` (action-only), `text-primary #19191C`, 4px everywhere (6px at card size so 4px doesn't read clipped).

---

### Development

```bash
# install
npm install

# browser preview (mock providers, no Electron)
npm run dev
# → http://localhost:5173

# full desktop (Vite + Electron)
npm run build
npm start
# or: npx electron dist-electron/main.js

# build portable (first run downloads Electron ~113 MB once)
npm run build
npm run package:portable   # → release/SEGO-Stack-Portable-*.exe
npm run package:all        # portable + NSIS installer
```

> The grid and icon work is in `src/App.css:150` and `public/icons/` — cards are `repeat(4, minmax(0,1fr))` with original logos at 46px inside 68px, centered. To change density, edit `grid-template-columns`.

---

### Security Notes

- **No shell:** `spawn(cmd, args)` with `shell: false`, never string interpolation
- **No hosting:** provider downloads from official vendor, we only orchestrate silent flags
- **Inspectable:** package ID shown in mono, copyable; last sync time in top bar (`Catalog synced 10:42:03 · Refresh`)

---

### Roadmap

- [x] Windows portable, winget/choco/scoop
- [ ] Update-available detection (`winget list --upgrade-available`)
- [ ] Brew / apt / flatpak providers (same `BaseProvider` interface + OS priority)
- [ ] Export / Import selection as `sego-stack.json` for dotfiles

See `electron/providers/base.ts:1` and `electron/providers/router.ts:1` for extension points.

---

### Contributing

PRs welcome. Keep the palette restrained, keep rows dense, keep errors human. Run `npm run build` before committing.

---

<p align="center">
  <strong>SEGO</strong> — tools that feel like system utilities, not marketing pages.<br/>
  <a href="https://github.com/Sword-Saint69/SEGO-Stack">github.com/Sword-Saint69/SEGO-Stack</a>
</p>
