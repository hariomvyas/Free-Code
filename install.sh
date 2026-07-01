#!/usr/bin/env bash
# Free Code installer for macOS / Linux.
#   curl -fsSL https://raw.githubusercontent.com/hariomvyas/Free-Code/main/install.sh | bash
set -e

REPO="https://github.com/hariomvyas/Free-Code.git"
DIR="${FREECODE_DIR:-$HOME/.freecode-app}"
MODEL="${FREECODE_MODEL:-qwen2.5-coder:3b}"

echo "==> Installing Free Code"

if ! command -v node >/dev/null 2>&1; then
  echo "!! Node.js 18+ is required. Install it from https://nodejs.org and re-run."
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "!! git is required. Install git and re-run."
  exit 1
fi

if [ -d "$DIR/.git" ]; then
  echo "==> Updating existing install in $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "==> Cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"
echo "==> Linking the 'fcode' command"
if ! npm link >/dev/null 2>&1; then
  echo "   npm link needs elevated permissions; retrying with sudo…"
  sudo npm link
fi

if command -v ollama >/dev/null 2>&1; then
  echo "==> Pulling model $MODEL (this can take a few minutes)"
  ollama pull "$MODEL" || echo "   (model pull failed — run 'ollama pull $MODEL' later)"
else
  echo "!! Ollama not found. Install it from https://ollama.com, then run: ollama pull $MODEL"
fi

echo ""
echo "==> Done. Start it with:  fcode"
echo "    Free Code auto-updates itself on future launches."
