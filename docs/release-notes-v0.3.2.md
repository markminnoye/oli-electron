# Release Notes - v0.3.2 (oli-electron)

## Summary

Minor maintenance release focusing on security and framework shelf updates.

## Technical Improvements

- **App Update**: Synchronized with `app` submodule version `0.12.1` (commit `2dadde6`).
- **Framework Update**: Updated Electron to version `33.4.11` to include the latest security patches and performance improvements.
- **Version Bump**: Bumped project version to `0.3.2`.

## Distributables

- `oli CDN Demo-0.3.2-arm64.dmg`
- `oli CDN Demo-0.3.2-arm64-mac.zip`

## Installation & Troubleshooting

### macOS "App is damaged" Error

When opening the downloaded `.dmg` or `.zip`, macOS Gatekeeper may show a strict error: _"oli CDN Demo is damaged and can't be opened. You should move it to the Trash."_
This happens because the application is not codesigned or notarized by Apple.

**The Fix:**
Drag the app to your `Applications` folder, open your **Terminal**, and run the following command to remove the quarantine flag:

```bash
xattr -cr "/Applications/oli CDN Demo.app"
```
