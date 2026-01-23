# AI Agent Guide - oli-electron

> **For human-readable documentation, see [README.md](./README.md)**

## Project Overview

This is an **Electron desktop application** wrapping the o|i CDN Demo webapp. The primary purpose is to bypass browser CORS restrictions and enable comprehensive network monitoring including full HTTP header capture.

## Architecture

```
oli-electron/                 # Electron shell
├── src/main/                 # Electron main process
│   ├── main.ts              # App entry, window creation, header capture
│   └── preload.ts           # IPC bridge to renderer (compiled to .cjs)
├── app/                      # Git submodule: o-i-demo webapp
│   └── app/src/
│       ├── services/
│       │   ├── DeepPacketAnalyser.ts   # CDN detection from headers
│       │   └── ElectronBridge.ts       # IPC receiver for Electron headers
│       └── components/scenarios/
│           ├── BakeOffView.ts          # Scenario A: Player comparison
│           └── ContentSteering.ts      # Scenario B: CDN orchestration
└── release/                  # Built DMG/app output
```

## Key Technologies

- **Electron 33.x** - Desktop shell with CORS bypass
- **TypeScript** - All source code
- **Vite** - Web app bundler
- **electron-builder** - Packaging

## Critical Implementation Details

### Header Capture Flow (Phase 2)

```
[Electron Main Process]
    └── session.webRequest.onHeadersReceived() captures ALL headers
    └── Sends via IPC: webContents.send('http-headers', data)
            ↓
[Preload Script]
    └── ipcRenderer.on('http-headers') listener
    └── Exposes via contextBridge as window.electronAPI.onHttpHeaders()
            ↓
[ElectronBridge.ts]
    └── Subscribes to window.electronAPI.onHttpHeaders()
    └── Calls DeepPacketAnalyser.analyzeFromElectron()
            ↓
[DeepPacketAnalyser.ts]
    └── analyzeFromElectron() parses headers, detects CDN, notifies listeners
```

### CDN Detection Logic

Located in `DeepPacketAnalyser.ts`, the `analyzeFromElectron()` method detects CDNs via:

| Header | CDN |
|--------|-----|
| `x-cdn: oli` | o\|i |
| `x-cdn: akamai` or `Server: AkamaiGHost` | Akamai |
| `x-cdn: gcore` | G-Core |
| `x-cdn: fastly` or `Server: *Varnish*` | Fastly |
| `Server: MediaPackage` or `x-amz-cf-pop` present | AWS |
| URL contains `telenet-ops.be` | Telenet |
| Any other `x-cdn` value | Uses header value directly |

### Location Parsing

- **CloudFront**: `x-amz-cf-pop` → `parseLocationFromCfPop()` (e.g., "AMS1" → "Amsterdam")
- **Fastly**: `x-served-by` → `parseLocationFromServedBy()` (e.g., "cache-ams..." → "Amsterdam")

## Module System

- **Main process**: CommonJS (`tsconfig.main.json` with `"module": "CommonJS"`)
- **Preload**: CommonJS (renamed to `.cjs` post-compile)
- **Webapp**: ES Modules (Vite handles bundling)

## Build Commands

```bash
npm run dev          # Dev mode with hot reload
npm run build        # Full production build
npm run compile      # TypeScript only (main + preload)
npm run build:vite   # Vite build only (webapp)
npm run build:electron  # Package to DMG
```

## Environment Configuration

- `.env` - Development (localhost)
- `.env.production` - Production API URL (`https://server.lab.oli-cdn.io/api`)

## Git Workflow

- **main** - Production releases
- **develop** - Active development
- **feature/*** - Feature branches from develop

The webapp is a **git submodule** at `app/`. Always use:
```bash
git submodule update --remote --merge  # Sync webapp
```

## Important Files for AI Agents

| File | Purpose |
|------|---------|
| `src/main/main.ts` | Header capture, window creation |
| `src/main/preload.ts` | IPC bridge API |
| `app/app/src/services/ElectronBridge.ts` | Receives headers from Electron |
| `app/app/src/services/DeepPacketAnalyser.ts` | CDN detection logic |
| `electron-builder.yml` | Build configuration |
| `.env.production` | API endpoints |

## Common Tasks

### Add a new CDN detection pattern
Edit `DeepPacketAnalyser.ts` in the `analyzeFromElectron()` method's CDN detection logic.

### Add a new IPC channel
1. Add handler in `main.ts`
2. Expose in `preload.ts` via `contextBridge`
3. Use in webapp via `window.electronAPI`

### Change default scenario
Edit `app/app/src/main.ts` - change `currentScenario` default value.
