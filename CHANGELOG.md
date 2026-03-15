# Changelog

All notable changes to the oli-electron shell are documented here.

## [Unreleased]

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
- macOS build temporarily set to **unsigned** (`identity: null`) while investigating Electron 41 + macOS 26 (Tahoe) V8 crash at startup; users must run `xattr -cr` and right-click → Open

### Fixed
- macOS 26 (Tahoe): added `com.apple.security.cs.disable-library-validation` entitlement to allow Electron Framework to load under stricter Team ID validation (`electron-builder.yml` + `build/entitlements.mac.plist`)

---

## [0.3.3] — 2025-01-xx

### Added
- External `http(s)` links now open in the system browser (`shell.openExternal`) instead of a new Electron window — applies to target="_blank" links such as the Sonic Rocket footer and CDN Calculator toolbox

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
