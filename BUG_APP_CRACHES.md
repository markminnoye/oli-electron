# Bug Report: Standalone App Crash

## Status: Root Cause Found — Fix in Progress

---

## Root Cause

**Electron 41.0.3 is incompatible with macOS 26 Tahoe (25D771280a).**

V8 (the JavaScript engine inside Electron) crashes with `EXC_BREAKPOINT (SIGTRAP)` — an ARM64 `brk #0` instruction, which is V8's internal assertion failure mechanism. This happens in V8's *compile hints* subsystem, a feature introduced in newer V8 versions bundled with Electron 32+.

**Confirmed by comparing both apps on the same machine (macOS 26.3.1):**

| App | Electron Version | Result |
|-----|-----------------|--------|
| `release/oli CDN Demo.app` (older build) | **33.4.11** | ✅ Launches fine |
| `/Applications/oi Lab.app` (current build) | **41.0.3** | ❌ Crashes immediately |

Both apps are ad-hoc signed with no entitlements — so **code signing / JIT entitlements are NOT the root cause**. The only meaningful difference is the Electron version.

---

## Evidence

### Crash Report (`~/Library/Logs/DiagnosticReports/oi Lab-2026-03-24-163218.ips`)

```
exception: EXC_BREAKPOINT (SIGTRAP)
signal: Trace/BPT trap: 5
esr: (Breakpoint) brk 0
```

Faulting stack (simplified):
```
ElectronMain
  → node::PrincipalRealm::tick_callback_function()
    → v8::Script::GetCompileHintsCollector()   ← compile hints crash
      → [V8 JIT code]
        → brk #0  ← ARM64 assertion failure
```

### Signing comparison (both apps — neither has entitlements)

```
Crashing:  flags=adhoc,linker-signed  Entitlements=none  Electron=41.0.3
Working:   flags=adhoc,linker-signed  Entitlements=none  Electron=33.4.11
```

Entitlements are **not** the issue. Both apps lack `allow-jit` yet only Electron 41 crashes.

### CI only runs on `main`

The `build-mac.yml` workflow triggers on `main` and `workflow_dispatch`. The `buildfix` branch changes (Electron downgrade) are never auto-built by CI.

---

## What Was Tried (and Why It Didn't Fully Work)

1. **Added `allow-jit` entitlement** (`7fa9bd8`) — Did not fix it, because entitlements are never embedded (linker-signed only, no codesign re-sign step applies them)
2. **Disabled hardened runtime** (`7f31117`) — Did not fix it, because the crash is in V8's compile hints logic, not W^X enforcement
3. **Downgraded Electron to 33.0.0** (current `buildfix` branch) — Correct direction, but hasn't been built in CI yet; `33.0.0` is pinned instead of `33.4.11` (the confirmed-working version)

---

## Fix Plan

### Step 1 — Pin confirmed-working Electron version (quick fix)

In `electron-builder.yml`, change:
```yaml
electronVersion: 33.0.0
```
to:
```yaml
electronVersion: 33.4.11
```

`33.4.11` is the exact version in the working `oli CDN Demo.app` release. Using `33.0.0` is risky as it may have other issues.

### Step 2 — Enable CI to build `buildfix` branch

In `.github/workflows/build-mac.yml`, add `buildfix` to the trigger branches:
```yaml
on:
  push:
    branches:
      - main
      - buildfix   # ← add this
  workflow_dispatch:
```

This lets GitHub Actions validate the fix before merging to `main`.

### Step 3 — Build and test locally

```bash
npm install          # installs electron@33.4.11 (satisfies ^33.0.0)
npm run build        # compile + electron-builder
```

Then install the DMG and verify it launches on macOS 26.

### Step 4 — Merge to `main` and monitor

Once confirmed working, merge `buildfix` → `main`. The CI will auto-build and publish.

---

## Additional Issues Found During Investigation

### `electronVersion: 33.0.0` vs `33.4.11`
`electron-builder`'s `electronVersion` pins the Electron binary that gets bundled. Using `33.0.0` bundles the oldest 33.x release; `33.4.11` is a known-good version with additional stability fixes.

### `productName: oi-Lab` (hyphen) vs original `o|i Lab` (pipe+space)
The pipe character `|` in `o|i Lab` is valid in macOS app names but has special meaning in shell/YAML. The `buildfix` branch changes it to `oi-Lab` (with hyphen), which changes the `.app` bundle name and may affect GitHub Release asset names. This is acceptable but worth documenting.

### `identity: "-"` vs `identity: null`
Both perform ad-hoc signing. `identity: null` tells electron-builder "do not sign"; `identity: "-"` tells it to sign with ad-hoc. In CI with `CSC_IDENTITY_AUTO_DISCOVERY: false`, the behaviour may differ. Needs verification.

### Entitlements are never embedded
Neither the working nor the crashing app has entitlements applied (both show `linker-signed` only). The `build/entitlements.mac.plist` file exists but is not being applied by the build process. For Electron 33 this doesn't matter — but if we ever upgrade past 33, we'll need a proper codesign step.

---

## Investigation Checklist

- [x] Read crash dumps — `~/Library/Logs/DiagnosticReports/oi Lab-2026-03-24-*.ips`
- [x] Verified production asset path — `app/app/dist/index.html` loads correctly (crash is in V8 before window opens)
- [x] Compared working vs crashing app signing — both ad-hoc, no entitlements
- [x] Identified Electron version difference (33.4.11 ✅ vs 41.0.3 ❌)
- [x] Pin `electronVersion: 33.4.11` in `electron-builder.yml`
- [x] Add `buildfix` to CI trigger branches
- [ ] Do a local build with Electron 33.4.11 and test on macOS 26
- [ ] Merge to `main` after local validation
