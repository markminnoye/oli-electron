#!/bin/bash
# Verify the app/ submodule is on the same branch as the main repository.
# Usage: bash .scripts/check-submodule.sh
set -e

MAIN_BRANCH=$(git rev-parse --abbrev-ref HEAD)
SUB_BRANCH=$(git -C app rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")

if [ "$SUB_BRANCH" = "HEAD" ]; then
  # Detached HEAD is normal in CI (actions/checkout does this for submodules)
  echo "✓ app/ submodule is in detached HEAD (CI mode) — skipping branch check"
  exit 0
fi

if [ "$MAIN_BRANCH" != "$SUB_BRANCH" ]; then
  echo "✗ Branch mismatch:"
  echo "  Main repo : $MAIN_BRANCH"
  echo "  app/      : $SUB_BRANCH"
  echo ""
  echo "  Fix: cd app && git checkout $MAIN_BRANCH"
  exit 1
fi

echo "✓ app/ submodule branch matches main repo: '$MAIN_BRANCH'"
