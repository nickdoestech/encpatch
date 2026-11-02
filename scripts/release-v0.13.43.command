#!/bin/bash
# =====================================================================
# ENCpatch v0.13.43 — one-shot release script
# Double-click this file (or run: bash scripts/release-v0.13.43.command)
#
# Does, in order, skipping anything already done:
#   1. Checks for the GitHub CLI (gh) — installs via Homebrew if missing
#   2. Logs into GitHub as needed (browser window opens, account
#      nickdoestech / krazycookie95@gmail.com)
#   3. Creates the public repo github.com/nickdoestech/encpatch and
#      pushes the source (or just pushes, if the repo exists)
#   4. Builds the app:  npm run dist:mac && npm run share
#   5. Creates GitHub release v0.13.43 with all assets the auto-updater
#      and the website need
#   6. Turns on GitHub Pages (main branch, /docs) → product site at
#      https://nickdoestech.github.io/encpatch/
#
# Safe to re-run after a failure — each step checks before acting.
# =====================================================================
set -euo pipefail

VERSION="0.13.43"
OWNER="nickdoestech"
REPO="encpatch"
cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"

step() { printf '\n\033[1;33m== %s ==\033[0m\n' "$1"; }
die()  { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$1"; read -r -p "Press Enter to close..."; exit 1; }
# Any unexpected failure: keep the window open so the error is readable.
trap 'code=$?; printf "\n\033[1;31mFAILED (exit %s) — the error is right above this line. Re-running me is safe: finished steps are skipped.\033[0m\n" "$code"; read -r -p "Press Enter to close..."' ERR

step "0/6 Sanity checks"
command -v npm >/dev/null || die "npm not found — install Node.js 18+ first"
[ -f package.json ] || die "run me from the ma3-mapper repo (scripts/ folder)"
grep -q "\"version\": \"$VERSION\"" package.json || die "package.json is not $VERSION"
echo "repo: $REPO_DIR  version: $VERSION"

step "1/6 GitHub CLI"
if ! command -v gh >/dev/null; then
  if command -v brew >/dev/null; then
    echo "installing gh via Homebrew..."
    brew install gh
  else
    # No Homebrew — fetch the official gh build straight from GitHub.
    # curl'd binaries carry no quarantine flag, so this just runs.
    TOOLS="$HOME/.encpatch-tools"
    GH_BIN="$(ls -d "$TOOLS"/gh_*/bin/gh 2>/dev/null | head -1 || true)"
    if [ -z "$GH_BIN" ]; then
      echo "downloading GitHub CLI (no Homebrew found)..."
      GHV="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null \
            | grep -m1 '"tag_name"' | sed 's/.*"v\([0-9.]*\)".*/\1/' || true)"
      [ -n "$GHV" ] || GHV="2.55.0"   # fallback pin if the API is rate-limited
      mkdir -p "$TOOLS"
      curl -fL -o "$TOOLS/gh.zip" \
        "https://github.com/cli/cli/releases/download/v${GHV}/gh_${GHV}_macOS_arm64.zip" \
        || die "could not download the GitHub CLI — check your internet connection and re-run"
      ditto -x -k "$TOOLS/gh.zip" "$TOOLS"
      rm -f "$TOOLS/gh.zip"
      GH_BIN="$(ls -d "$TOOLS"/gh_*/bin/gh 2>/dev/null | head -1 || true)"
      [ -n "$GH_BIN" ] || die "GitHub CLI download unpacked unexpectedly — re-run or install from https://cli.github.com"
    fi
    chmod +x "$GH_BIN"
    export PATH="$(dirname "$GH_BIN"):$PATH"
    echo "using gh at $GH_BIN ($(gh --version | head -1))"
  fi
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "Logging in to GitHub — a browser window will open. Use the"
  echo "account $OWNER (krazycookie95@gmail.com), approve, come back here."
  gh auth login --hostname github.com --git-protocol https --web
fi
gh auth status

step "2/6 Git repo + first commit"
if [ ! -d .git ]; then
  git init
fi
git add -A
if ! git diff --cached --quiet; then
  git commit -m "ENCpatch v$VERSION

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019tUmVexdeXmCLkNu646hYi"
else
  echo "nothing new to commit"
fi
git branch -M main

step "3/6 Push to github.com/$OWNER/$REPO"
if ! git remote get-url origin >/dev/null 2>&1; then
  if gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
    git remote add origin "https://github.com/$OWNER/$REPO.git"
    git push -u origin main
  else
    gh repo create "$OWNER/$REPO" --public --source=. --remote=origin --push \
      --description "Real encoders for grandMA3 onPC — Stream Deck Plus as a live encoder bar"
  fi
else
  git push -u origin main
fi

step "4/6 Build the app (this is the slow part)"
if [ -f "dist/ENCpatch-$VERSION-arm64.dmg" ] && [ -f "dist/ENCpatch-$VERSION-arm64-mac.zip" ] && [ -f "dist/latest-mac.yml" ]; then
  echo "build artifacts for $VERSION already in dist/ — skipping rebuild"
else
  if [ ! -d node_modules ]; then npm install --no-audit --no-fund; fi
  npm run dist:mac
fi
SHARE_ZIP="$HOME/Desktop/ENCpatch-v$VERSION.zip"
if [ -f "$SHARE_ZIP" ]; then
  echo "share zip already on Desktop — skipping"
else
  echo "(If macOS asks whether Terminal may access your Desktop — click Allow.)"
  npm run share
fi

step "5/6 GitHub release v$VERSION"
STABLE_ZIP="$(mktemp -d)/ENCpatch-macOS.zip"
cp "$SHARE_ZIP" "$STABLE_ZIP"
ASSETS=()
for f in \
  "$SHARE_ZIP" \
  "$STABLE_ZIP" \
  "dist/ENCpatch-$VERSION-arm64.dmg" \
  "dist/ENCpatch-$VERSION-arm64.dmg.blockmap" \
  "dist/ENCpatch-$VERSION-arm64-mac.zip" \
  "dist/ENCpatch-$VERSION-arm64-mac.zip.blockmap" \
  "dist/latest-mac.yml"; do
  if [ -f "$f" ]; then ASSETS+=("$f"); else echo "WARN: missing asset $f"; fi
done
if gh release view "v$VERSION" >/dev/null 2>&1; then
  echo "release exists — refreshing assets"
  gh release upload "v$VERSION" "${ASSETS[@]}" --clobber
else
  gh release create "v$VERSION" \
    --title "ENCpatch v$VERSION" \
    --notes-file "docs/release-notes/v$VERSION.md" \
    "${ASSETS[@]}"
fi

step "6/6 GitHub Pages (product site)"
if ! gh api "repos/$OWNER/$REPO/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/$OWNER/$REPO/pages" \
    -f "source[branch]=main" -f "source[path]=/docs" >/dev/null \
    && echo "Pages enabled" || echo "WARN: could not enable Pages automatically — repo Settings → Pages → main /docs"
else
  echo "Pages already enabled"
fi

printf '\n\033[1;32mALL DONE\033[0m\n'
echo "  Release:   https://github.com/$OWNER/$REPO/releases/tag/v$VERSION"
echo "  Download:  https://github.com/$OWNER/$REPO/releases/latest/download/ENCpatch-macOS.zip"
echo "  Site:      https://$OWNER.github.io/$REPO/   (takes a minute to go live)"
echo "  Tester zip: $SHARE_ZIP  — send this file directly to testers"
read -r -p "Press Enter to close..."
