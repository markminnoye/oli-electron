# Changelog

All notable changes to the oli-electron shell are documented here.

## [0.4.1] — 2026-03-26

### Changed
- Dependency updates: `electron` 40.8.3→40.8.4, `tar` 7.5.11→7.5.13, `axios` 1.13.5→1.13.6, `joi` 18.0.2→18.1.1, `sax` 1.4.4→1.6.0, `minipass-flush` 1.0.5→1.0.6, and other minor patch bumps

---

## [0.4.0] — 2026-03-26

### Fixed
- `ipChanged` coerced to a strict boolean in `ElectronBridge.handleServerIp()` — prevents potential truthy/falsy issues when comparing IP strings
- Improved stability when the logger initializes in restricted contexts — prevents a crash at startup caused by missing log transports in the preload layer
- Robust `package.json` discovery via `findPackageJson()` — searches multiple paths to avoid `ENOENT` crashes across dev, packaged, and DMG environments
- `uncaughtException` / `unhandledRejection` handlers added before logger init to capture early startup crashes
- `simulateUpdate()` uses module-level `mainWindowGetter` so dev update simulation works without a real release

### Added
- `MapPanel` migrated from `console.log` to `createLogger` — map-layer events now persist to the log file alongside all other subsystems
- App warnings and errors from the player and network layers are now captured in the log file — previously these were only visible in DevTools and lost when the window closed
- `electron-log` integration — all log output now persists to OS log files in addition to the console, aiding crash diagnosis on end-user machines
- Checkpoint logging throughout `app.whenReady()` startup sequence for pinpointing macOS 26 crash location
- `checkForUpdates(manual)` exported from `AutoUpdater.ts` — triggered via new `update:check` IPC event
- `simulateUpdate()` — dev-mode mock of the full update flow (checking → available → progress → downloaded)
- `update:simulate` and `update:check` IPC handlers in `setupIpcHandlers()`
- `onUpdateNotAvailable` subscription in preload bridge
- `checkForUpdates` and `simulateUpdate` methods on `window.electronAPI`
- macOS build CI workflow (`.github/workflows/build-mac.yml`) — builds and publishes on push to `main`/`buildfix`

### Changed
- **About panel** replaced the custom Help › About dialog with the native macOS About panel (`app.setAboutPanelOptions` + `role: 'about'`); the Help menu is retained as an empty entry so macOS still adds its built-in search field
- Logger refactored to use `electron-log` for file persistence; dev logs written to `logs/main.log` in project root
- Logger init deferred to `app.whenReady()` to avoid preload context conflicts
- Auto-updater: recurring `setInterval` check (every 4h) now correctly guarded inside `app.isPackaged` block
- Production index path changed from `__dirname`-relative to `app.getAppPath()`-relative for correct DMG resolution
- `onUpdateAvailable` callback type simplified to `{ version: string }` (removed unused `releaseNotes`)
- `onUpdateProgress` callback type simplified to `{ percent, bytesPerSecond }` (removed `transferred`, `total`)
- CI: use `OLI_GH_TOKEN` for private submodule checkout
- CI: publish release assets directly via `electron-builder --publish always`

---

## [0.3.4] — 2026-03-21

### Fixed
- **macOS 26 Tahoe crash on startup** (`EXC_BREAKPOINT` / `SIGTRAP` in `ElectronMain`) — `allow-jit` is a restricted entitlement ignored by macOS for ad-hoc signed apps without a Developer ID. Real fix: disable Hardened Runtime (`hardenedRuntime: false`) so V8 JIT can allocate memory without W^X enforcement. `identity: null` makes the intent explicit (ad-hoc, no Developer ID). Right-click → Open still required on first launch.

### Added
- Auto-updater (`src/main/AutoUpdater.ts`) — checks GitHub Releases on startup (3 s delay) and every 4 h; downloads silently in the background; user triggers restart via the renderer's `UpdateNotificationBanner`
- `window.electronAPI.installUpdate()` IPC bridge for renderer-initiated restart & install
- Full set of auto-updater IPC subscriptions in preload (`onUpdateChecking`, `onUpdateAvailable`, `onUpdateProgress`, `onUpdateDownloaded`, `onUpdateError`)
- GitHub Releases publish config in `electron-builder.yml` (draft releases to `markminnoye/oli-electron`)

### Changed
- Electron `33.4.11` → `41.0.2` (bundles Chromium 130 + Node.js 24.14.0)
- electron-builder `25.0.0` → `26.8.1`
- electron-updater `6.3.9` → `6.8.3`
- TypeScript `5.6.0` → `5.9.3`
- `@types/node` `^22` → `^24` (aligned to Electron 41's bundled Node 24 runtime)
- App submodule updated to v0.13.1 — includes `UpdateNotificationBanner`, BakeOffView event listener accumulation fix, Vite 8 + `@vercel/*` v2 upgrades

### Fixed
- macOS 26 (Tahoe): added `com.apple.security.cs.disable-library-validation` entitlement to allow Electron Framework to load under stricter Team ID validation

---

## [0.3.3] — 2026-03-18

### Added
- External `http(s)` links now open in the system browser (`shell.openExternal`) instead of a new Electron window — applies to target="_blank" links such as the Sonic Rocket footer and CDN Calculator toolbox

### Changed
- **Product renamed** from "oli CDN Demo" to **"o|i Lab"** — updated `productName` in `electron-builder.yml`, window title in `main.ts`, `package.json` description, README, and release notes
- Default window size adjusted to 1800×1200 (was 1920×1080) for better fit on standard displays
- App submodule updated to v0.13.2 — delivery path RTT fix, glass-panel opacity restored to 0.92 for better legibility

---

## [0.3.2] — initial tracked release

### Added
- HTTP header interception via `session.webRequest` — captures response headers, TTFB, and CDN identity for all video requests
- Custom request header injection via IPC (`set-custom-headers` / `clear-custom-headers`)
- Server IP detection (`onCompleted` → `server-ip-resolved` IPC event)
- Streaming traceroute (`runTracerouteStreaming`) with per-hop real-time IPC events
- Geolocation permission grant via `setPermissionRequestHandler`
- Preload contextBridge exposing `window.electronAPI` with typed surface
- `web-security: false` CORS bypass (the core reason for the Electron shell)
