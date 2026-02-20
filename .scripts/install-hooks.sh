#!/bin/bash
# Install project git hooks by symlinking from .scripts/ into .git/hooks/.
# Usage: bash .scripts/install-hooks.sh
set -e

HOOKS_DIR="$(git rev-parse --git-dir)/hooks"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# Install pre-commit hook
ln -sf "$SCRIPTS_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"

echo "✓ Git hooks installed:"
echo "  pre-commit → .scripts/pre-commit"
