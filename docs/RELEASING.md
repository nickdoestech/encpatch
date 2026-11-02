# Releasing ENCpatch on GitHub

Runbook for cutting public releases. Everything below is prepped in the repo; the only things that need Nick (GitHub auth + a Mac) are marked **[NICK]**.

## One-time setup

1. **[NICK] Create the public repo.** GitHub → New repository → name `encpatch`, public, MIT license (matches `package.json`). No need to seed it with a README — the push brings everything.

2. **[NICK] Push the source.**
   ```
   cd ~/Documents/Claud/ma3-int/ma3-mapper
   git init && git add -A && git commit -m "ENCpatch v0.13.43"
   git branch -M main
   git remote add origin https://github.com/nickdoestech/encpatch.git
   git push -u origin main
   ```
   `.gitignore` already excludes `node_modules/` and `dist/`. If `dist/` DMGs got tracked anyway, `git rm -r --cached dist` before committing — the repo should hold source, not 100+ MB of old DMGs.

3. **[NICK] Set the updater's repo target.** In `package.json` → `build.publish[0]`, done — set to `nickdoestech` (2026-11-02). Until this is done, the in-app auto-updater deliberately disables itself (guard in `electron/auto-updater.js`) so builds never 404 against the placeholder.

## Cutting a release (per version)

1. Bump `version` in `package.json` and the bridge Lua header (they must match for the app↔bridge handshake).

2. **[NICK, on the Mac]** Build:
   ```
   npm run dist:mac      # produces dist/ENCpatch-<v>-arm64.dmg + .zip + latest-mac.yml
   npm run share         # produces ~/Desktop/ENCpatch-v<v>.zip (DMG + Read Me First)
   ```
   The mac build target now includes `zip` alongside `dmg` — **required**: electron-updater on macOS downloads the `.zip` (not the DMG) when auto-updating, and `latest-mac.yml` is only useful if the zip it references is attached to the release.

3. **[NICK] Create the release** (gh CLI shown; the web UI works too):
   ```
   gh release create v0.13.43 \
     --title "ENCpatch v0.13.43" \
     --notes-file docs/release-notes/v0.13.43.md \
     ~/Desktop/ENCpatch-v0.13.43.zip \
     dist/ENCpatch-0.13.43-arm64.dmg \
     dist/ENCpatch-0.13.43-arm64.dmg.blockmap \
     dist/ENCpatch-0.13.43-arm64-mac.zip \
     dist/ENCpatch-0.13.43-arm64-mac.zip.blockmap \
     dist/latest-mac.yml
   ```
   Asset roles:
   - `ENCpatch-v<v>.zip` (Desktop share zip) — the human-facing download for the website CTA (DMG + install guide in one file).
   - `latest-mac.yml` + `-mac.zip` + blockmaps — what the in-app auto-updater reads. All three must be attached or updates silently fail.
   - The bare DMG — convenience for people who skip the share zip.

4. Optional stable-name asset for a permanent website URL: also upload a copy of the share zip named `ENCpatch-macOS.zip` (`gh release upload v<v> ENCpatch-macOS.zip`). Then `…/releases/latest/download/ENCpatch-macOS.zip` always fetches the newest release without touching the website.

Alternative: `electron-builder --mac --arm64 --publish always` with a `GH_TOKEN` env var builds *and* uploads the updater assets in one step; the share zip and release notes still need manual attachment.

## Canonical URLs (for the website CTAs)

With `nickdoestech` = the GitHub username from setup step 3:

| CTA | URL |
| --- | --- |
| Releases page | `https://github.com/nickdoestech/encpatch/releases` |
| Latest release | `https://github.com/nickdoestech/encpatch/releases/latest` |
| Hero download (stable name, needs step 4) | `https://github.com/nickdoestech/encpatch/releases/latest/download/ENCpatch-macOS.zip` |
| Install guide | `https://github.com/nickdoestech/encpatch/blob/main/INSTALL.md` |

The product site draft (`~/Desktop/6 PERSONAL/encpatch/site/index.html`) has three placeholder `href="#"` CTAs — hero download, install-guide link, footer download — that map to rows 3, 4, 3 above respectively (see the "publish the product site" backlog item).

## How the auto-updater works (for reference)

`electron/auto-updater.js` uses `electron-updater`, which reads `build.publish` (baked into the app as `app-update.yml` at build time), polls the GitHub Releases feed (`latest-mac.yml`) hourly and on launch, downloads the `-mac.zip` delta via blockmap, and prompts to relaunch. No server of ours involved. Checks are skipped in unpackaged dev runs and while the publish owner is the placeholder.
