# SEGO Stack v0.1.0 — Portable Windows Package Manager

**Download:** `SEGO-Stack-Portable-0.1.0-x64.exe` (74.4 MB, single EXE, no install) — `release/SEGO-Stack-Portable-0.1.0-x64.exe` · Data in `SEGO-Stack-Data/` next to the EXE · Alt: `release/win-unpacked/SEGO Stack.exe`

---

## Highlights

- **33 curated apps** (20 + 13 new OSS): `GIMP` `Inkscape` `Blender` `Audacity` `LibreOffice` `Thunderbird` `FileZilla` `qBittorrent` `HandBrake` `ShareX` `KeePassXC` `Bitwarden` `Joplin` + `VS Code` `Chrome` `Firefox` `Brave` `7-Zip` `VLC` `Spotify` `Discord` `Git` `Node LTS` `Python` `Notepad++` `Steam` `OBS Studio` `PowerToys` `Docker Desktop` `Zoom` `Slack` `Malwarebytes` `Everything` — `catalog.json` live from `https://raw.githubusercontent.com/Sword-Saint69/SEGO-Stack/main/catalog.json` (jsDelivr fallback, cached `userData/catalog-cache.json`, offline bundled fallback, portable `catalog.json` override).

- **Wraps what you trust:** Priority `winget → choco → scoop` per app (`electron/providers/router.ts:1`), auto-detects providers, falls back if one fails. Safe spawn `spawn(cmd, args, {shell:false})` + `SAFE_ID_REGEX /^[a-zA-Z0-9._\-]+$/`.

- **Grid built for scanning:** `4-per-row` (responsive `3/2/1`) `68px` original brand logos (`public/icons/*.svg` `35` files, now colour via `https://cdn.simpleicons.org`), `11px IBM Plex Mono` package ID, `6px` cards, `68px→46px` centred, accent `#1955A8` reserved for actions (`src/App.css:150`, `src/index.css:3` `bg-canvas #F6F6F7`).

- **Install UX:** Strict `isInstalled` (`winget list --id --exact` exact-token + version check `winget.ts:16`, `choco list --limit-output` `choco.ts:16`), GUI installers auto-start interactive (`winget --interactive` for `Discord/VLC/Steam/OBS/Zoom/Slack/Notepad++` etc. `winget.ts:44` — fixes `Squirrel` `4294967295`/`AggregateException` file-lock), `Discord.exe`/`DiscordUpdater.exe` pre-kill (`main.ts:313`), progress **in card** (`card-progress` `11.48kB CSS` `163kB JS` `App.tsx:391`, `main.ts:324` `curProgress` parses `12%`/`Downloading`→25% `Verifying`→55% `Installing`→75% → `100%`), `View log` expandable tail (`2500` chars) + `humanizeError` (`cannot access file` → `Close Discord…`).

- **Fixes:** `tsconfig.electron.json:7` `rootDir:electron` → `dist-electron/main.js 18538` flat (was `dist-electron/electron/main.js` nested, `main: dist-electron/main.js` loaded stale `8550B`), `preload.cjs` CJS (`const {contextBridge}=require('electron')` `preload.cjs:1`, `main.ts:154` `sandbox:false` + `preloadCandidates` + `existsSync` log) fixes `hasWindowApi=false` (`08:57` `preload failed`), `Activity` bar removed (progress now in card per request, `App.tsx:410`), `· Installing…` header removed, `catalog.json` BOM stripped, `D:\` + `release` Defender exclusions for `d3dcompiler_47.dll` / portable `output file is locked` wait.

- **Docs:** `README.md:2` logo `public/icons/vscode.svg` → `public/icons/main.png` `72×72`, removed `### Screenshot` `docs/screenshot.png` block (`README.md:35`), `public/icons` 14 colour fixes via `cdn.simpleicons.org` (brand `fill="#..."` vs `currentColor` black).

---

## Quick Start

**You just want to install apps:**

1. Download `SEGO-Stack-Portable-0.1.0-x64.exe` from [Releases](https://github.com/Sword-Saint69/SEGO-Stack/releases)
2. Double-click — no install
3. Search, tick apps, click **Install N apps** (or **Install** on a single card) — watch card `Installing… 42%` + bar + `View log` → `Installed`

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

## Project Structure

```
sego-stack/
├── catalog.json              # 33 apps, live via GitHub Raw
├── public/icons/             # 35 original brand SVGs/PNGs (colour)
│   └── main.png, vscode.svg, gimp.svg, ...
├── electron/
│   ├── main.ts               # window + portable userData + catalog loader + progress + Discord kill
│   ├── preload.cjs           # CJS secure IPC bridge (contextIsolation)
│   └── providers/
│       ├── base.ts           # safe spawn, ID validation
│       ├── winget.ts         # strict isInstalled + interactive GUI
│       ├── choco.ts          # strict --limit-output
│       └── router.ts         # winget > choco > scoop
├── src/
│   ├── App.tsx               # 4-per-row grid + card progress/log
│   └── App.css / index.css   # tokens, IBM Plex Sans/Mono
└── release/
    └── SEGO-Stack-Portable-0.1.0-x64.exe
```

---

## Development

```bash
npm install
npm run dev              # http://localhost:5173 (browser preview, simulated)
npm run build && npm start   # full desktop (Vite + Electron 32.3.3)
npm run build && npm run package:portable  # → release/SEGO-Stack-Portable-*.exe
```

---

## Known Issues

- Discord Squirrel fails if `Discord.exe` running — now auto `taskkill /IM Discord.exe /F` + 1.5s wait, else close via Task Manager and `Retry` (fallback to `choco`).
- Some icons still monochrome (`vscode/chrome/vlc` 404 on colour CDN) — next will use `devicon` colour.
- First portable build downloads Electron ~113 MB once (cached `%LOCALAPPDATA%/electron/Cache`).

---

**Commits:** `d145574` docs logo + colour icons · `1b7a1c4` strict/progress/OSS · `b19aa01` live catalog · `48fcca6` merge · `4f9418c` v0.1.0 portable

**Publish:**

```bash
gh release create v0.1.0 release/SEGO-Stack-Portable-0.1.0-x64.exe --title "SEGO Stack v0.1.0" --notes-file release.md
```

<p align="center"><strong>SEGO</strong> — tools that feel like system utilities, not marketing pages.<br/><a href="https://github.com/Sword-Saint69/SEGO-Stack">github.com/Sword-Saint69/SEGO-Stack</a></p>
