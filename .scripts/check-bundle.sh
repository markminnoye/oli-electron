#!/bin/bash
# Check webapp bundle for Electron code leakage and enforce size budget.
# Usage: bash .scripts/check-bundle.sh [--skip-build]
#
# Exit codes:
#   0 — all checks pass
#   1 — Electron code leaked into webapp bundle
#   2 — bundle exceeds size budget
set -e

BUDGET_BYTES=$((2500000))  # 2.5 MB
DIST_DIR="app/app/dist"
ASSETS_DIR="$DIST_DIR/assets"

# ── Option parsing ───────────────────────────────────────────────────────────
SKIP_BUILD=false
for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

# ── Build ────────────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo "Building webapp…"
  (cd app/app && npm run build)
  echo ""
fi

if [ ! -d "$ASSETS_DIR" ]; then
  echo "✗ dist/assets/ not found — build may have failed"
  exit 1
fi

# ── Check 1: Electron code leakage (build output) ───────────────────────────
echo "Checking for Electron code leakage in webapp bundle…"

# ElectronTopologyService should ALWAYS be a separate chunk, never in the
# main entry bundle. If it appears in index-*.js, it was statically imported.
# Note: ElectronBridge's isElectron() helper IS expected in the main chunk
# (it's a tiny guard function), so we only flag ElectronTopologyService here.
MAIN_CHUNK=$(find "$ASSETS_DIR" -name 'index-*.js' -type f)

LEAKED=false
if [ -n "$MAIN_CHUNK" ]; then
  if grep -q 'ElectronTopologyService' "$MAIN_CHUNK"; then
    echo "✗ ElectronTopologyService found in main entry chunk!"
    LEAKED=true
  fi
fi

if [ "$LEAKED" = true ]; then
  echo ""
  echo "  Electron-specific code was statically imported into the main bundle."
  echo "  Use dynamic imports inside an isElectron() guard instead."
  echo "  See: app/docs/ELECTRON_BUNDLE_OPTIMIZATION.md"
  exit 1
fi

echo "✓ No Electron code leakage in main entry chunk"

# ── Check 2: Bundle size budget ──────────────────────────────────────────────
echo ""
echo "Checking bundle size budget…"

# macOS stat uses -f%z, Linux uses -c%s
TOTAL_BYTES=$(find "$ASSETS_DIR" -name '*.js' -type f -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s}' || \
              find "$ASSETS_DIR" -name '*.js' -type f -exec stat -c%s {} + 2>/dev/null | awk '{s+=$1} END {print s}')

TOTAL_MB=$(echo "scale=2; $TOTAL_BYTES / 1048576" | bc)
BUDGET_MB=$(echo "scale=2; $BUDGET_BYTES / 1048576" | bc)

echo "  JS chunks:"
find "$ASSETS_DIR" -name '*.js' -type f -exec stat -f"%z %N" {} + 2>/dev/null | sort -rn | head -5 | \
  awk '{printf "    %6.0f KB  %s\n", $1/1024, $2}' || \
find "$ASSETS_DIR" -name '*.js' -type f -exec stat -c"%s %n" {} + 2>/dev/null | sort -rn | head -5 | \
  awk '{printf "    %6.0f KB  %s\n", $1/1024, $2}'
echo ""

if [ "$TOTAL_BYTES" -gt "$BUDGET_BYTES" ]; then
  echo "✗ Bundle size ${TOTAL_MB} MB exceeds budget of ${BUDGET_MB} MB"
  exit 2
fi

echo "✓ Bundle size ${TOTAL_MB} MB is within budget of ${BUDGET_MB} MB"

# ── Check 3: Static import lint (source code) ───────────────────────────────
echo ""
echo "Checking for static imports of Electron modules in app source…"

# Look for non-dynamic, non-type imports of Electron-specific modules.
# Allowed exceptions:
#   - import type (stripped at build time)
#   - { isElectron } from ElectronBridge (tiny guard, tree-shakeable)
#   - Files within the Electron modules themselves
OFFENDING=$(grep -rn "^import " app/app/src/ \
  --include='*.ts' --include='*.tsx' \
  | grep -v "import type" \
  | grep -v "ElectronBridge.ts" \
  | grep -v "ElectronTopologyService.ts" \
  | grep -v "{ isElectron }" \
  | grep -E "ElectronBridge|ElectronTopologyService" \
  || true)

if [ -n "$OFFENDING" ]; then
  echo "✗ Found static imports of Electron modules:"
  echo "$OFFENDING"
  echo ""
  echo "  Use dynamic imports instead:"
  echo "    if (isElectron()) {"
  echo "      const { ElectronBridge } = await import('./ElectronBridge');"
  echo "    }"
  exit 1
fi

echo "✓ All Electron module imports are dynamic or type-only"

echo ""
echo "All bundle checks passed ✓"
