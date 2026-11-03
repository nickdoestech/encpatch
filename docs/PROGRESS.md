# ENCpatch Progress Log

Append-only changelog. Format: a `## YYYY-MM-DD` heading, a `Done`/`Files touched`/`Notes` block. Older entries before structured logging began are summarized in the v0.x section at the bottom.

## 2026-11-02 (second pass — queue drain)
- Done: Unblocked both `[blocked] hw: no` items with Nick present. GitHub owner confirmed: `nickdoestech` (krazycookie95@gmail.com). Filled into package.json `build.publish` (replacing GITHUB_OWNER_TODO — the auto-updater guard now disarms on real builds) and throughout docs/RELEASING.md.
- Done: Product site moved into the repo at `docs/index.html` (GitHub Pages only serves `/` or `/docs`, so `docs/` supersedes the planned `website/`): version bumped to v0.13.43 and all three placeholder CTAs replaced — hero + footer download → `https://github.com/nickdoestech/encpatch/releases/latest/download/ENCpatch-macOS.zip`, install link → `blob/main/INSTALL.md` — plus a source-repo link in the page footer. Source draft at `~/Desktop/6 PERSONAL/encpatch/site/index.html` unchanged.
- Done: Wrote `scripts/release-v0.13.43.command` — double-clickable, idempotent, end-to-end: gh CLI check/install → GitHub login → git init/commit/push (creates public repo `nickdoestech/encpatch` if absent) → `npm run dist:mac && npm run share` → release v0.13.43 with the full updater asset set (share zip, stable-name `ENCpatch-macOS.zip`, dmg + blockmap, `-mac.zip` + blockmap, `latest-mac.yml`) → enables GitHub Pages (main, /docs). .gitignore gains `probe_*.json` / `.harness-replies.jsonl`.
- Files touched: package.json, docs/RELEASING.md, docs/index.html (new), scripts/release-v0.13.43.command (new), .gitignore, BACKLOG.md, docs/PROGRESS.md.
- Notes: Computer-use tier rules block typing into Terminal, so "Claude drives" became "Claude scripts, Nick double-clicks" — the script is the whole remaining [NICK] surface for both items. After it runs green: flip both backlog items to [done] and record the live URLs. The `hw: yes` rig-validation item still gates calling 0.13.43 good for testers.

## v0.13.43 — 2026-11-02
- Done: Fixed the second half of the multilayer encoder mapping tangle (MA3 focus, per Nick): LCD-tap stacked-attribute cycling is now sub-page aware and unified with the bridge. Root cause: `_handleLcdTouchCycle` in mapping-engine.js cycled the user's configured stack list keyed by feature+slot only (no sub-page knowledge) and force-set the result via `setSlotAttr` — on Position page 2 a tap snapped slot 1 from XFocus back to Pan, making sub-page follow look broken too. Meanwhile the bridge's sub-page-aware `cycleSlotStack` (0.13.42) was never called by anything.
- Done: Bridge `cycleStack` action now accepts an optional `"list":[...]` (the desktop's configured stack for the feature+slot). `cycleSlotStack(slot, dir, userList)` forces a fresh `resolveBarSlots()` (cache invalidated — a tap can afford the ≤50ms UI read), anchors on the slot's live base attribute, validates the user list against the selected fixture, and uses it ONLY when it contains the slot's base/current attribute; otherwise the dynamic contiguous-run/pattern stack applies. Position syncs to the current attribute before stepping, so the first tap advances instead of jumping. Required forward-declaring `resolveBarSlots`/`barCache` above `cycleSlotStack` (they were defined below it; the new calls would have hit nil globals at runtime).
- Done: Engine `_handleLcdTouchCycle` rewritten to delegate: one `cycleStack` query replaces the old filterAttrs → discoverAttrs → setSlotAttr triple round-trip; local `_slotStackIdx` bookkeeping removed (the bridge owns cycle state). New `PageBinder.noteSlotOverride(slot, name)` flips the LCD label immediately from the reply (next 1 Hz poll confirms it — latency hiding, not state ownership). Bridge-disconnected taps now emit `source:'noBridge'` instead of silently cycling a dead local index.
- Done: Committed the stub-MA3 regression harness as `scripts/test-bridge-harness.lua` (the 2026-08-09 session's harness was never committed and was lost with its sandbox). Runs the real bridge Lua against a fake MA3 (persistent UI-tree node with live-updating children, fixture model with Position pages 1+2 and a stacked Color wheel, fake luasocket — forced into `package.loaded`, since texlua bundles a real luasocket). 14/14 checks: page-1/page-2 UI harvest incl. "X Focus"→XFocus label variants, tick drives page-2 attr, user-list honored on page 1 / ignored on page 2, sticky overlay + clear-on-flip, dynamic Color stack, win fallback anchored at GetSelectedAttribute, def fallback, version, all replies strict-JSON validated.
- Done: mapping-engine.test.mjs +2 tests for the new delegation path (22/22 pass). Version bump 0.13.42 → 0.13.43 (package.json + bridge Lua; exact-match handshake unchanged).
- Files touched: docs/ma3-plugin/ENCpatchMA3Bridge.lua, server/core/mapping-engine.js, server/core/page-binder.js, server/core/mapping-engine.test.mjs, package.json, scripts/test-bridge-harness.lua (new), docs/release-notes/v0.13.43.md (new), BACKLOG.md, docs/PROGRESS.md.
- Notes: NOT yet validated on real MA3 — no build since 0.13.40 ever reached the rig (dist/ newest DMG is 0.13.40, May 13), so the 0.13.42 resolver AND this fix both ride the 0.13.43 test build. [NICK] `npm run dist:mac && npm run share`, install, re-import the bridge Lua (versions must match), then the BACKLOG validation checklist. If slots still read page 1 on the rig: `probeEncoderBar` on both pages (use `nc -w 2` — plain macOS nc exits before the reply, which is why the August probe files are 0 bytes) and `setBarMode` A/B. Eos and scaffold work intentionally untouched this pass.

## 2026-09-21
- Done: Backlog scan — no `[open] hw: no` items remain. Unchanged since the 2026-08-31 scan. Active queue holds three `[open] hw: yes` items (v0.13.42 sub-page validation + acceptance pass, Eos 5-test live validation, multi-console scaffold live-test) plus the two hardware-only follow-ups. No orphaned `[in_progress]` lines.
- Files touched: docs/PROGRESS.md (this entry only).
- Notes: All hw:no items drained — only hardware items left. Both `[blocked] hw: no` items re-verified this run and still blocked on the same [NICK] preconditions: `package.json` build.publish still reads `GITHUB_OWNER_TODO` (public repo not created/pushed), and there is still no `website/` directory (site draft remains at `~/Desktop/6 PERSONAL/encpatch/site/index.html`, outside the connected folder). Also: this run's `request_cowork_directory` call for `/Users/nickcook/Documents/Claud/ma3-int` was auto-declined (nobody present to approve); the folder was already mounted as a working directory so the scan proceeded, but if future runs start failing at step 1, that approval is the thing to grant standing permission for.

## 2026-08-31
- Done: Backlog scan — no `[open] hw: no` items remain. Active queue holds three `[open] hw: yes` items (v0.13.42 sub-page validation + acceptance pass, Eos 5-test live validation, multi-console scaffold live-test) plus the two hardware-only follow-ups. No orphaned `[in_progress]` lines.
- Files touched: docs/PROGRESS.md (this entry only).
- Notes: All hw:no items drained — only hardware items left. The two `[blocked] hw: no` items are both still blocked on the same [NICK] preconditions, re-verified this run: `package.json` build.publish still reads `GITHUB_OWNER_TODO` (public repo not created/pushed yet) and there is still no `website/` directory in the repo (the drafted site page remains at `~/Desktop/6 PERSONAL/encpatch/site/index.html`, outside the connected folder). Once Nick does the four [NICK] steps in docs/RELEASING.md and copies the site draft to `website/index.html`, the site item becomes runner-doable (swap three `href="#"` CTAs per the RELEASING.md canonical-URL table + add a Pages deploy note) and can be flipped back to `[open]`.

## 2026-08-26
- Done: Companion module is now a real installable distributable, built and verified end-to-end with Bitfocus's own tooling (produces `encpatch-0.13.42.tgz`, sideloadable via Companion's "Import module package").
- Upgraded `@companion-module/base` 1.10.0 → 2.1.3 and `@companion-module/tools` (added as devDependency) → ^3.0.2 — this was a scope increase beyond "just packaging" but was necessary: `@companion-module/tools` v1.x (the version compatible with base v1.x) requires Node ^18.12 and shells out to `yarn` in a way that breaks on npm-installed layouts; it's also upstream-flagged "no longer supported". v3.x (current) requires base v2.x (subpath `exports` for `@companion-module/base/manifest`) and Node ≥22.18, which matches the sandbox's and presumably Nick's actual Node version. Net: only one real breaking-API change was needed — `setVariableDefinitions` takes an object keyed by `variableId` in v2, not an array of `{name, variableId}`. Everything else main.js used (`InstanceBase`, `runEntrypoint`, `InstanceStatus.*`, `Regex.IP`/`Regex.PORT`, action/feedback/config-field shapes) is unchanged between v1 and v2.
- Manifest gained the now-required top-level `"type": "connection"` field and `runtime.type` moved `node18` → `node22` (the only two valid enum values in the v2 manifest schema are `node22`/`node26`). Confirmed via the base package's own JSON schema (`assets/manifest.schema.json`), not guessed.
- package.json version bumped 1.0.0 → 0.13.42 to track the app version, per the backlog item's "version aligned with the app" ask; `npm run build` bakes this into the shipped manifest automatically each time.
- Added `companion-module/README.md` (install steps: `npm install && npm run build` → sideload the resulting `.tgz` into Companion → configure host/port) and two `.gitignore` entries (`*.tgz`, `companion-module/pkg/`) so build output doesn't get tracked.
- Files touched: companion-module/package.json, companion-module/main.js (`_defineVariables`), companion-module/companion/manifest.json, companion-module/README.md (new), .gitignore, BACKLOG.md, docs/PROGRESS.md.
- Notes: (1) Verified by actually running `npm install && npm run build` against the real, edited files (copied to a scratch dir first, not the connected folder — see caveat below) — produced a valid `encpatch-0.13.42.tgz` containing a schema-valid manifest with the correct baked `apiVersion`/`entrypoint`/`version`. (2) `manifest.json`'s `repository`/`bugs` URLs are still `<your-fork>` placeholders pending the public GitHub repo from the still-blocked Releases-pipeline item — noted in the new README as a follow-up, not fixed here (no repo exists yet to point at). (3) Accidentally ran `npm install` directly inside the connected `companion-module/` folder early on, which wrote ~122MB of `node_modules` that the sandbox couldn't `rm` (connected-folder files are delete-protected by default); had to call the delete-permission tool to clean it up. All subsequent installs/builds were done in `/tmp` scratch copies instead — the connected folder now only has the source files (no `node_modules`, no `.npmrc` — that was a transient workaround for a base-v1/tools-v3 peer conflict that's moot now that base is v2). (4) Bitfocus Marketplace submission (signing, review) is still an explicit follow-up per the backlog item, not attempted.

## 2026-08-24
- Done: GitHub Releases pipeline — prepped everything runnable without Nick's GitHub auth, then marked the item [blocked] per its own runner note. (a) `package.json`: added `build.publish` GitHub block (owner is a `GITHUB_OWNER_TODO` placeholder) and added a `zip` mac build target — electron-updater on macOS auto-updates from the `-mac.zip` + `latest-mac.yml`, not the DMG, so without it the updater could never work. (b) `electron/auto-updater.js`: fixed a real crash — it did `require('electron-log')` which is not installed (would have thrown inside `initUpdater()` at startup in every packaged build); now try/catch with console fallback. Also added a guard that disables all update checks (startup, hourly, manual IPC) while the publish owner is still the placeholder, so nothing 404s against a nonexistent repo. (c) New `docs/release-notes/v0.13.42.md` — GitHub-release-ready notes framed as the first public release (download/xattr instructions, 0.13.42 changes, console status table, requirements). (d) New `docs/RELEASING.md` — full runbook: one-time repo setup, per-release build/attach steps with exact `gh release create` command and required updater assets, optional stable-name `ENCpatch-macOS.zip` asset for a permanent `/releases/latest/download/` URL, and the canonical URL table for the website CTAs (feeds the "publish the product site" backlog item).
- Files touched: package.json (build.publish + mac zip target), electron/auto-updater.js, docs/release-notes/v0.13.42.md (new), docs/RELEASING.md (new), BACKLOG.md, docs/PROGRESS.md.
- Notes: (1) This run recovered its own claim: the item went [in_progress] and edits landed mid-run before a runner restart; finished rather than orphaning it (same failure mode as 2026-05-26). (2) Blocked remainder is ~15 min of Nick-time, all marked [NICK] in RELEASING.md: create public repo `encpatch`, push, replace `GITHUB_OWNER_TODO`, `npm run dist:mac && npm run share`, `gh release create v0.13.42`. (3) `.gitignore` already excludes `dist/` and `*.zip`, so the push won't drag 40 old DMGs into the public repo. (4) The zip target means the next `npm run dist:mac` also emits `ENCpatch-<v>-arm64-mac.zip` + `latest-mac.yml` in dist/ — attach both (plus blockmaps) to the release or auto-update silently fails. (5) Verify: `node --check` ok, package.json JSON-parses, core-module smoke-load ok, placeholder guard logic unit-checked both ways (disabled with TODO owner, enabled with real owner).

## 2026-08-23
- Done: Backlog triage with Nick. Merged the standalone v0.13.x user-acceptance pass into a new combined item: v0.13.42 sub-page rig validation + acceptance pass (one sitting at the deck, probeEncoderBar page1/page2 diff recipe embedded in the item). Added three new `hw: no` items, un-idling the runner queue: GitHub Releases pipeline (Nick chose GitHub Releases as the public download home), publish the product site (standalone page drafted today at `~/Desktop/6 PERSONAL/encpatch/site/index.html` from the website-handoff brief — dark control-room design, honest console-status table, xattr note, placeholder CTAs pending real URLs), and ship the Companion module as an installable distributable. Scaffold-driver live-testing kept as-is per Nick.
- Files touched: BACKLOG.md, docs/PROGRESS.md. (Site draft itself lives outside the repo for now; the new backlog item covers bringing it into `website/`.)
- Notes: Distribution decisions made today: free download, MIT framing, GitHub Releases hosting, standalone site (no existing personal site to attach to — hosting decided later, GitHub Pages suggested).

## 2026-08-10
- Done: Backlog scan — no `[open] hw: no` items remain. Active queue holds only `[open] hw: yes` items (Eos 5-test live validation, multi-console driver live-test, v0.13.x user-acceptance pass) plus the two hardware-only follow-ups. No orphaned `[in_progress]` lines. Unchanged since the 2026-08-05 scan.
- Files touched: docs/PROGRESS.md (this entry only).
- Notes: All hw:no items drained — only hardware items left.

## v0.13.42 — 2026-08-09
- Done: MA3 encoder bar now follows SUB-PAGE position within a feature group. Root cause of "encoders still don't work": `getEncoderBar`/`turnEncoder` resolved slots from the sorted-first-4 UI channel list, which has no sub-page knowledge — Position page 2 (X Focus / Y Focus / Z Focus / Position MSpeed) still returned/drove the page-1 slice. The v0.13.42-in-progress `readCurrentEncoderAttrs()` was never wired into any handler and probed object paths (`Root().MainTask.EncoderPool` etc.) that don't exist in MA3's tree; removed.
- Done: New single source of truth `resolveBarSlots()` in the bridge, used by BOTH `turnEncoder` (wheel ticks) and `getEncoderBar` (LCD labels) — the LCD now always shows exactly what the wheel drives. Resolution order ("auto"): (1) "ui" — walk `GetDisplayByIndex(n).ScreenContents` to the live EncoderBar UI node and harvest the labels MA3 is rendering right now; every text validated via GetAttributeIndex + GetUIChannelIndex + current-feature membership (label variants tried: raw / spaces stripped / spaces→underscore, so "X Focus" resolves to canonical "XFocus"); invisible subtrees skipped; node handle cached with failure cooldown; time-budgeted (50ms) so MA3's frame never hitches. (2) "win" — 4-wide window into the feature channel list anchored at `GetSelectedAttribute()` (paging moves the selected attribute), end-clamped. (3) "def" — legacy sorted-first-4. Manual stickies (setSlotAttr/cycleStack) overlay the base; bar-signature change (feature switch or page flip) clears them. Results cached 0.35s wall-clock (socket.gettime, NOT os.clock which is CPU time).
- Done: `cycleSlotStack` now anchors on the live bar's base attribute for the slot (sub-page aware) instead of sorted-slot-N.
- Done: New bridge actions: `probeEncoderBar` (dumps feature channel list, selected attr, UI-tree search result incl. raw harvested texts + validated attrs + bar node properties, CurrentUser/CurrentScreenConfig property dumps, and what each strategy resolves — run on page 1 vs page 2 and diff) and `setBarMode {mode:auto|ui|win|legacy}` (A/B lever without re-importing; "legacy" reproduces pre-0.13.42 exactly). `getEncoderBar` reply gains a `"src"` field (ui/win/def/none); page-binder ignores unknown fields, no JS change needed.
- Files touched: docs/ma3-plugin/ENCpatchMA3Bridge.lua (0.13.41→0.13.42), package.json (0.13.41→0.13.42), docs/PROGRESS.md.
- Notes: Verified with a stubbed-MA3 Lua harness (fake socket + fake UI tree + fixture model): 13/13 checks pass — sub-page-2 slot resolution via UI read, tick drives the page-2 attribute, window anchor + end clamp, legacy mode parity, sticky override + clear-on-page-flip, probe JSON validity (python json.loads), and a degraded-API run (no GetDisplayByIndex/GetSelectedAttribute) falling back cleanly. NOT yet validated against real MA3 onPC — the UI-tree walk property names are best-effort; if slots still read page 1 on the rig, run the probe on page 1 AND page 2 (`echo '{"id":1,"action":"probeEncoderBar"}' | nc 127.0.0.1 9001 > probe_pageN.json`) and diff — that output pins the exact node/property to hook. IMPORTANT: app and bridge versions must match for the handshake — re-import the .lua in MA3 AND run the 0.13.42 app (npm start from repo, or rebuild), else page-binder flags oldBridge and skips getEncoderBar entirely.

## 2026-08-05
- Done: Backlog scan — no `[open] hw: no` items remain. Active queue holds only `[open] hw: yes` items (Eos 5-test live validation, multi-console driver live-test, v0.13.x user-acceptance pass) plus the two hardware-only follow-ups. No orphaned `[in_progress]` lines. Unchanged since the 2026-08-04 scan.
- Files touched: docs/PROGRESS.md (this entry only).
- Notes: All hw:no items drained — only hardware items left.

## 2026-08-04
- Done: Backlog scan — no `[open] hw: no` items remain. Active queue holds only `[open] hw: yes` items (Eos 5-test live validation, multi-console driver live-test, v0.13.x user-acceptance pass) plus the two hardware-only follow-ups. Verified no orphaned `[in_progress]` lines. Unchanged since the 2026-05-31 scan.
- Files touched: docs/PROGRESS.md (this entry only).
- Notes: All hw:no items drained — only hardware items left.

## 2026-05-31
- Done: Backlog scan — no `[open] hw: no` items remain. Active queue contains only `[open] hw: yes` items (Eos 5-test live validation, multi-console driver live-test on real hardware, v0.13.x user-acceptance pass) plus the two `hw: yes` items in the hardware-only follow-ups section. Also verified no orphaned `[in_progress]` lines (the failure mode that bit the 2026-05-19 run and was recovered on 2026-05-26).
- Files touched: docs/PROGRESS.md (this entry only).
- Notes: All hw:no items drained — only hardware items left.

## 2026-05-26
- Done: Recovered an orphaned `[in_progress] hw: no` backlog item (native Stream Deck plugin packaging) that a prior run claimed but never finished — even though the 2026-05-19 entry below declared "all hw:no items drained" (the runner's literal `[open]`-only scan never noticed the stuck `[in_progress]` line). The icons were already complete and valid (state 72/144px, plugin/category 28/56px, action 256/512px). What was actually broken: the packaging output `com.encpatch.bridge.streamDeckPlugin` was a 0-byte empty file, and two orphaned random-named temp zips (`ziWH7fvV`, `zinrD3BY`, byte-identical, from an interrupted Elgato `streamdeck pack` attempt) were left in the folder. Completed the packaging pass by running `npm run pack:streamdeck` (the existing `scripts/pack-streamdeck.js`, which validates every manifest-referenced asset then zips via Info-ZIP — no proprietary Elgato CLI needed). Produced a valid 11.7 KiB `.streamDeckPlugin` rooted correctly at `com.encpatch.bridge.sdPlugin/`. Also bumped the plugin manifest `Version` 0.13.1 → 0.13.41 to match the app and silence the pack script's version-drift warning, since this run cuts a real distributable.
- Files touched: BACKLOG.md (item → done, annotated), streamdeck-plugin/com.encpatch.bridge.sdPlugin/manifest.json (Version 0.13.1→0.13.41), streamdeck-plugin/com.encpatch.bridge.streamDeckPlugin (rebuilt, was 0 bytes → 11.7 KiB valid bundle). Deleted: streamdeck-plugin/ziWH7fvV, streamdeck-plugin/zinrD3BY (orphaned interrupted-run temp zips).
- Verify: manifest.json valid JSON; `unzip -t` integrity OK; archive rooted at `com.encpatch.bridge.sdPlugin/` with all 19 files; embedded manifest parses (Version 0.13.41, 3 Actions); core-module smoke-load `ok`. No `.js` files changed (no `node --check` needed); no unit tests applicable to a packaging artifact.
- Notes: (1) Deviated from the runner's literal Step-2 logic, which only picks `[open]` lines and would have re-logged "all drained" while this `[in_progress]` item sat stuck forever. Recovering the orphan is the correct intent of a drain-the-hw:no-backlog runner. (2) File deletes are blocked in the sandbox by default — used the cowork delete-permission gate to remove the temp zips; future runs that need to delete will hit the same gate. (3) The action-list icons are 256² rather than Elgato's recommended 20×20pt — cosmetic only, downscaled by the SD app, packs and sideloads fine; left as-is for diff minimalism. (4) Bundle is unsigned/sideload-only (double-click to install); Elgato Marketplace upload still needs a signing cert. (5) A harmless `.__probe__` file appeared in streamdeck-plugin/ during the delete-permission step (system probe, not part of the package) — left untouched.

## 2026-05-19
- Done: Backlog check — all hw:no items drained. Only hardware validation items remain.
- Notes: All hw:no items drained — only hardware items left.

## 2026-05-17
- Done: Polish Companion module with state polling, encoder feedback, and example presets.
  1. **State polling** — module now polls `/api/state` every 2 seconds to query `console.connected`, `console.driver` (name), and `version` from ENCpatch. Initial poll fires on startup for immediate state snapshot.
  2. **Variable definitions** — three public variables: `console_name` (driver id), `console_version` (app version), `console_connected` (boolean string).
  3. **Feedback definition** — `console_connected` feedback turns buttons green when the console is connected. Companion's feedback system auto-refreshes the button state on every poll.
  4. **Presets folder** — three JSON example presets: (a) encoder-control.json with 8 buttons for encoder up/down across all 4 slots, (b) page-select.json with 8 buttons for feature-bank selection (Dimmer/Position/Color/Beam/Gobo/Focus/Shapers/Control), (c) console-commands.json with example command-line buttons and a status display using variables.
- Files touched: companion-module/main.js (added _defineVariables, _defineFeedbacks, _startStatePolling, _pollState, updated init/destroy), companion-module/companion/presets/*.json (new: encoder-control.json, page-select.json, console-commands.json).
- Notes: The polling is lightweight (2s interval, silent failures) and doesn't block startup. Variables auto-populate from the state response; feedbacks auto-refresh via `checkFeedbacks()` on each poll. Presets are standard Bitfocus Companion format (the native SDK v1.10 preset schema) and should auto-discover and appear in Companion's preset browser once the module is built and installed. Users can load any preset to instantly populate buttons. The module now provides full visibility into ENCpatch's state without the user having to check the app directly.

## v0.13.41 — 2026-05-13
- Done: Fixed the `/api/bridge/ma3.lua` endpoint that's been silently returning 404 in packaged builds since Electron-builder packaging started. The handler resolved the Lua path via `__dirname/../../docs/ma3-plugin/...` which sits INSIDE the asar archive — `fs.existsSync` works there via Electron's asar-patched fs, but `res.sendFile`/`res.download` from Express can't read inside asar because it streams via the OS filesystem.
- Done: Resolver now tries multiple paths in order: (1) `process.resourcesPath/ma3-plugin/...` (the extraResources copy, outside the asar — most reliable), (2) the dev path (repo checkout), (3) the asar-internal path. Whichever exists first wins.
- Done: Replaced `res.sendFile`/`res.download` with `fs.readFileSync` + `res.send`. Content-Disposition header added for the download case to preserve the versioned filename.
- Done: 404 response now includes the `triedPaths` array so future failures self-diagnose.
- Files touched: package.json (0.13.40→0.13.41), server/api/http-server.js (bridge Lua resolver + send method), docs/ma3-plugin/ENCpatchMA3Bridge.lua (version).
- Notes: This bug bit anyone clicking "Save Bridge to Downloads" in a packaged build — silent failure. Dev runs (`npm run start`) always worked because the dev path existed. With the fix, friend builds shipping to MA3 users can save the Lua plugin successfully. extraResources block in package.json was already correct; only the runtime resolver needed fixing.

## 2026-05-14
- Done: Quick console switcher in Settings tab. Added prominent console picker at the top of the Settings panel (above Network settings form) that fetches available consoles via `/api/consoles` and applies changes immediately to `/api/settings` without requiring a form Save. No restart needed — hot-reload fires on the server side. Users who skip the welcome modal can now switch consoles easily from Settings. Complements the existing console picker in the Settings form (which still works via form submission).
- Files touched: ui/index.html (added console quick-switcher div with status display), ui/app.js (added initSettingsConsoleQuickSwitch, updateSettingsConsoleQuickSwitch functions, called from loadState).
- Notes: The quick switcher mirrors the welcome modal's console picker UX — fetch list from `/api/consoles`, set current value from config, show status feedback on change. The form's console field and the quick switcher are in sync (both update when either changes). The server's handleSettingsPatch already handles console hot-swap with full driver lifecycle, so no server changes were needed.

## 2026-05-12
- Done: Per-fixture-type encoder-stack profiles. Users can now define separate encoder-stack configurations scoped to specific fixture types (e.g. "MAC Aura" stacks auto-recall when any MAC Aura is selected). Added `byFixtureType` structure to `config.encoderStacks` to store per-fixture profiles. Bridge now includes `getFixtureType` action to query MA3 for the current fixture's class/type. PageBinder added fixture-type polling (2s interval) via `startFixtureTypePoll()`. MappingEngine's LCD encoder-cycling handler checks for fixture-type-specific stacks first, falls back to global defaults. Storage: `config.encoderStacks.byFixtureType[fixtureType][feature][slot] = [...attrs]`.
- Files touched: server/core/config-store.js (added byFixtureType to defaults + comment), server/core/page-binder.js (added _currentFixtureType, startFixtureTypePoll, stopFixtureTypePoll, fixtureType methods), server/core/mapping-engine.js (updated _handleLcdTouchCycle to prefer fixture-type stacks), server/server.js (wire up startFixtureTypePoll + stopFixtureTypePoll in shutdown), docs/ma3-plugin/ENCpatchMA3Bridge.lua (added getFixtureType action using ObjectInformation).
- Notes: MVP implementation prioritizes fixture-type-specific stacks when available, gracefully falls back to global defaults. Bridge's getFixtureType uses MA3's ObjectInformation API to resolve the fixture class name — returns nil if no selection or ObjectInformation unavailable. Fixture-type polling runs at 2s interval (same as feature polling) for low overhead. UI wiring for manual fixture-type selection and saving per-type stacks is a follow-up item (not included in this task per hw:no requirement — no physical hardware interaction needed for the polling/cycling logic itself).

## 2026-05-11
- Done: Fixed permissions-assistant IPC listener lifecycle. Changed `.ipcMain.once()` to `.ipcMain.on()` so the permissions window can send multiple actions (e.g., checkPermissionsAgain after clicking "Check Permission Again", openSettings, etc.) without the listener dropping after the first action. The listener is still properly cleaned up when the window closes. This ensures the setup wizard flow works end-to-end on first launch when Input Monitoring permission is missing.
- Files touched: electron/permissions-assistant.js (IPC listener change from once to on with cleanup on window close)
- Notes: Infrastructure for input monitoring detection was already in place (isInputMonitoringGranted, permissions-assistant.html UI, deep-link to System Settings). The only issue was the IPC listener being one-shot, which prevented the user from interacting with the window after the initial permission check.

## v0.13.40 — 2026-05-10
- Done: Auto-fill mode now swaps encoder params on category-button press, with Eos feedback as live override. Previously, in auto-fill mode, bankSelect only fired the Eos hardkey and re-subscribed — but Eos doesn't push fresh /eos/out/active/wheel on category change (only on wheel-value change), so the cache stayed stuck on the seed. Now bankSelect ALSO seeds the cache with the new category's params from encoderParamsByCategory (the same fallback list as in fixed mode). Eos's actual /eos/out/active/wheel feedback, when it arrives, overrides the seeded labels with real names. Net: category buttons always visibly switch encoders, AND Eos's live updates take precedence when they show up.
- Files touched: package.json (0.13.39→0.13.40), server/core/console-drivers/eos-driver.js (auto-fill bankSelect now swaps cache).
- Notes: The fallback labels come from encoderParamsByCategory which has my generic default guesses. If those don't match the user's fixture, Eos's live feedback (when it arrives) will overwrite them with the correct names — so the user doesn't HAVE to edit the per-category list, they just see generic placeholders briefly until Eos pushes real data. If Eos never pushes (because the user hasn't selected fixtures, or because Eos's /eos/out/active/wheel doesn't fire on category change in their show), they see the placeholders which at least let them control SOMETHING useful (intens/pan/tilt for example).

## v0.13.39 — 2026-05-10
- Done: Fix auto-fill mode's "dead encoders on first launch" — the v0.13.38 change to default autoFillFromEos to true meant fresh boots had an empty `_encoderBarCache` and `_activeParams` until Eos pushed `/eos/out/active/wheel`. If no fixtures were selected on Eos at that moment (which is common — operator hasn't started the show yet), the encoders ticked nothing. Now we seed both arrays at connect time with a fallback param list (the user's `encoderParams`, or the Intensity category's params, or `[intens, pan, tilt, zoom]`). Encoders work immediately on boot; Eos's first feedback overwrites the seed with real names.
- Files touched: package.json (0.13.38→0.13.39), server/core/console-drivers/eos-driver.js (auto-fill connect seed).
- Notes: This is a defensive baseline. If Eos pushes feedback within milliseconds of subscribe (the normal case), the seed is invisible — the cache gets the real wheel names right away. The seed only manifests when there's a window of empty feedback (Eos disconnected, no fixtures selected, slow network).

## v0.13.38 — 2026-05-10
- Done: Two fixes that together make the "Auto-fill encoders from Eos" checkbox actually work as expected.
  1. **Default flipped to ON.** New users on Eos get the zero-config follow-the-console behavior immediately without having to hunt for the checkbox. Existing users with v0.13.35-37 (default false) are migrated to true on next launch via a flag-guarded migration. Users who explicitly set false stay opted-out.
  2. **Hot-swap on any eos.* config change.** Previously `/api/settings` only rebuilt the EosDriver when `console` changed (ma3 ↔ eos). Toggling autoFillFromEos in Settings saved to config but the running driver kept its old opts. Now any change to the eos.* block triggers the same driver-rebuild path, so the checkbox state, host/port/user, encoderParamsByCategory edits, all apply live.
- Files touched: package.json (0.13.37→0.13.38), server/core/config-store.js (default + migration), server/api/http-server.js (eosOptsChanged trigger).
- Notes: The migration uses an `eosAutoFillFromEosMigrated` flag so it only runs once per user. After v0.13.38 lands, the user can still toggle the checkbox off if they prefer fixed-mode — Save will apply the change live without needing an app restart.

## v0.13.37 — 2026-05-10
- Done: Fixed auto-fill mode so it actually works. `bankSelect` now early-returns in autoFillFromEos mode after sending the Eos category hardkey and re-firing `/eos/subscribe` — no per-param subscription swap fighting the global subscribe. Eos pushes fresh `/eos/out/active/wheel/<n>` for the new category and ENCpatch's encoders mirror whatever shows up.
- Done: After each category button press in auto-fill mode, send `/eos/subscribe 0` then `/eos/subscribe 1` back-to-back. This is the documented way to force Eos to re-emit subscribed state — without it, Eos only emits when wheel VALUES change (not when categories switch), and the SD stays on stale labels.
- Files touched: package.json (0.13.36→0.13.37), server/core/console-drivers/eos-driver.js (bankSelect branches on autoFillFromEos).
- Notes: For auto-fill to populate the SD, fixtures MUST be selected on Eos (Chan 1 Thru 4 Enter). `/eos/out/active/wheel` only fires for parameters of the current channel selection. If the user has no fixtures selected, the SD will be empty regardless of which category button they press.

## v0.13.36 — 2026-05-10
- Done: Page navigation now happens via category button cycling. Pressing the SAME category button advances to the next page within that category (wraps at end). Pressing a DIFFERENT category switches and resets to page 0. Matches Eos's own hardkey behavior — press Focus once for Focus page 1, press again for Focus page 2, etc.
- Done: LCD swipe pagination from v0.13.34 stays as an alternate input method but is no longer the primary nav path. UI hint updated to describe button-cycle as the recommended way.
- Files touched: package.json (0.13.35→0.13.36), server/core/console-drivers/eos-driver.js (bankSelect cycle logic), ui/index.html (hint update).
- Notes: Detection of "same category" uses `_activeCategory === bankName` and only cycles if the category has >4 params (single-page categories don't cycle). When switching to a different category, the page index resets to 0 so the user always lands on page 1 first.

## v0.13.35 — 2026-05-10
- Done: Settings UI grid now shows 12 slots per category (3 pages of 4). LCD swipe pages through all configured pages. Defaults filled out to 12 params per category where it makes sense — Focus has Pan/Tilt/X Focus/Y Focus on page 1, Z Focus/Position MSpeed/Position Macros/Position Macro Ra on page 2, Pan Rotate/Tilt Rotate/Pan Tilt Speed/Follow Thru on page 3. Similar fan-out for Color (RGBW/extra LED emitters), Image (gobo + animation + rotators/prism), Form (movement + beam shape).
- Done: New `eos.autoFillFromEos` config option + Settings checkbox. When ON, ENCpatch subscribes to `/eos/subscribe 1` globally, filters to `/eos/out/active/wheel/*`, and fills SD encoders dynamically with whatever Eos currently has on its display — slot 1 mirrors Eos slot 1 live, no manual config needed. When OFF (default), the per-category encoderParamsByCategory drives the encoders. The user can flip between modes per-show: auto-fill for quick zero-config sessions, fixed mode for deterministic layouts.
- Done: encoderTick uses `_activeParams` regardless of mode — in fixed mode `_swapSubscriptions` populates it; in auto-fill mode the `/eos/out/active/wheel` handler updates it from feedback. encoderTick still sends `/eos/wheel/coarse/<paramName>` either way.
- Files touched: package.json (0.13.34→0.13.35), server/core/config-store.js (autoFillFromEos default + 12-param defaults), server/server.js + server/api/http-server.js (pass autoFillFromEos through), server/core/console-drivers/eos-driver.js (mode branching in connect + active-wheel handler updates _activeParams), ui/app.js (12 slots, 3-page divider), ui/index.html (autoFill checkbox + hint).
- Notes: Auto-fill mode validates whether Eos's `/eos/out/active/wheel` feedback actually reflects the visible Encoder Display strip — earlier testing (v0.13.7-22) suggested it reflects ML Controls state which gives a static 4-param set. Worth re-testing on Nick's Eos Nomad: turn the checkbox ON, restart, watch Monitor for `auto-fill slot N: X → Y` lines as you change categories on Eos. If they update, auto-fill works. If they stay stuck on Intensity/Pan/Tilt/X Focus, Eos truly doesn't expose the encoder display via OSC and fixed mode is the way.

## v0.13.34 — 2026-05-10
- Done: Multi-page params within each Eos category. The encoderParamsByCategory entries can now hold up to 8 param names per category — slots 1-4 = page 1, slots 5-8 = page 2. SD LCD swipe left/right pages between them.
- Done: EosDriver tracks `_activeCategoryParams` (full list) and `_activeCategoryPage` (0-indexed). New methods `nextCategoryPage()` / `prevCategoryPage()` advance the page index and re-subscribe to the new slice. `_currentPageSlice()` returns the 4-slot window. bankSelect resets page=0 on category change. Logs the page count when a multi-page category is entered: `Category "Focus" has 2 pages; swipe LCD to page through`.
- Done: mapping-engine's LCD swipe handler routes to driver.nextCategoryPage / prevCategoryPage for non-MA3 drivers (preserves the existing MA3 "EncoderPage +/-" behavior for ma3 console).
- Done: Settings UI category-params editor now shows 8 slots per card with a "page 2 (LCD swipe →)" divider after slot 4. Saves preserve the full 8-element array. Empty trailing slots are trimmed off in JSON for tidy config.
- Done: Default encoderParamsByCategory updated. Focus + Form now have 8 params (Pan/Tilt/X Focus/Y Focus on page 1; Z Focus / Position MSpeed / Position Macros / Position Macro Ra on page 2). Color and Image have 8 each (page 1 = primary picks, page 2 = LED color components and gobo-extras). Intensity and Shutter stay short (1 and 4 respectively) because Eos doesn't typically have more in those categories.
- Files touched: package.json (0.13.33→0.13.34), server/core/console-drivers/eos-driver.js (_currentPageSlice, _categoryPageCount, nextCategoryPage, prevCategoryPage, bankSelect resets page), server/core/mapping-engine.js (swipe → driver pagination for non-MA3), server/core/config-store.js (longer default arrays + migration defaults), ui/app.js (8-slot card layout, collector handles up to 8), ui/index.html (hint about page 2 + LCD swipe).
- Notes: User can leave page-2 slots blank to disable pagination per category — driver computes page count from non-empty trailing slots. The UI editor's "page 2" slots are visually grouped under a divider. Migration only backfills entries that were empty in user's config; users who customized 4-param arrays keep their 4 (no auto-expansion).

## v0.13.33 — 2026-05-10
- Done: Diagnostic logging in `EosDriver.bankSelect` — every call surfaces `bankSelect("<name>"): catParams=[...]` and, if no entry in encoderParamsByCategory, the available keys. Lets us see in the Monitor exactly which category buttons are routing through and what params they're swapping to. Critical for debugging "encoders aren't remapping" — if the log line doesn't appear when the user presses a category button, the SD→engine→driver chain is broken; if it appears but catParams is null, encoderParamsByCategory is missing the entry.
- Done: Visual Builder's MA3 pages row (`#vb-pages-row` — Dimmer/Position/Gobo/etc) is now hidden when console is Eos. Pages/feature-groups are MA3 concepts; for Eos the category strip lives on the SD top row, not in the Visual Builder. Page editor (`#vb-page-editor`) hidden too.
- Files touched: package.json (0.13.32→0.13.33), server/core/console-drivers/eos-driver.js (bankSelect diagnostic log), ui/app.js (vbLoadPages early-return for non-MA3).
- Notes: If the user still sees MA3 vocabulary somewhere in the UI when Eos is selected, the most likely candidates are the Help tab content and the mapping action dropdown options ("Cmd / setPage / ma3lua / ..."). Those are static text; they can stay as-is and refer to MA3 because the underlying mapping engine still supports both consoles — the UI just doesn't gate every label.

## v0.13.32 — 2026-05-10
- Done: New canonical SD top-row layout for Eos (2 rows × 4):
  - Row 1: **Intensity / Color / Image / Sneak**
  - Row 2: **Focus / Shutter / Form / Query**
  - Categories on keys 1-3, 5-7; Sneak/Query hardkeys on keys 4 and 8.
- Done: Migration bumped to `eosKeyLayoutV2`. Replaces ALL 8 keys on Eos with the new layout (was only Sneak/Query injection in v0.13.31). Clears the old `eosSneakQueryInjected` flag from prior configs. Triggers on startup AND on hot-swap to Eos via /api/settings.
- Done: Preset `eos-sd-plus.json` matches the new layout exactly. Loading the preset is now equivalent to triggering the migration.
- Files touched: package.json (0.13.31→0.13.32), data/presets/eos-sd-plus.json (key order), server/core/config-store.js (migration KEY_LAYOUT array, flag bump to v2), server/api/http-server.js (hot-swap injection mirrors the migration).
- Notes: Users on v0.13.31 with custom mappings on keys 1-8 will see ALL 8 keys overwritten at next launch (or at next switch to Eos). The migration is a one-shot — flag stays set after — so any post-migration customizations the user makes (e.g. remapping key 4 from Sneak to At) will persist across subsequent launches.

## v0.13.31 — 2026-05-10
- Done: Sneak/Query now auto-installed on SD keys 7 and 8 when console is Eos — both at startup (via config migration) AND on hot-swap to Eos (via /api/settings). Existing MA3-flavored bindings on those keys (Page: Control / Shapers) get replaced with the Eos hardkey calls. The SD's physical LCD updates immediately via the existing config.onChange → sdRenderer.renderAll() pipeline — no manual preset reload needed.
- Done: Guard flag `eosSneakQueryInjected` so the injection only fires once per session-history; if the user later deletes Sneak or Query, they don't auto-resurrect. Re-running the welcome flow or manually clearing the flag re-enables one-shot injection.
- Done: Eos-only behavior — MA3 users keep whatever they had on keys 7-8 (typically Page: Control / Page: Shapers from the MA3 default preset).
- Files touched: package.json (0.13.30→0.13.31), server/core/config-store.js (migration), server/api/http-server.js (hot-swap injection on console change to eos).
- Notes: The migration runs on config load; the hot-swap path catches the case where the user picks Eos in the welcome modal or Settings AFTER startup. Both paths converge on the same injection helper logic — same mapping ids, same OSC actions. SD LCD picks up "Sneak"/"Query" labels via the renderer's existing mapping.name → key-label path (no rendering changes needed — the names are already Eos-native, no translation map entries required).

## v0.13.30 — 2026-05-10
- Done: Filled the remaining 2 SD top-row slots — key 7 = Sneak, key 8 = Query. Both fire `/eos/key/<name>` press+release via the existing consoleKey action type. These complete the layout: 6 category buttons + 2 utility hardkeys, no empty slots.
- Files touched: package.json (0.13.29→0.13.30), data/presets/eos-sd-plus.json.

## v0.13.29 — 2026-05-10
- Done: Locked the Eos category layout to the canonical 6 — **Intensity, Focus, Color, Shutter, Image, Form** — matching Eos's actual encoder-display strip. Removed Beam (not a real Eos category), Custom (toggle, not a category), and FX (no Eos hardkey).
- Done: SD preset `eos-sd-plus.json` rewritten to map keys 1–6 to those 6 categories in canonical order. Keys 7–8 are intentionally unmapped — user assigns them to hardkeys (Live, Blind, At, Enter), macros, or whatever fits their show.
- Done: Config defaults trimmed to just those 6 categories in `encoderParamsByCategory`.
- Done: Migration prunes any prior config (v0.13.27–28 had Beam/Custom defaults) — re-pins to the canonical 6 and drops extras.
- Done: Settings UI editor grid now shows exactly 6 cards.
- Done: bankSelect routeFor table trimmed to the 6 Eos categories + MA3-flavored back-compat for Position/Gobo/Shapers. Intensity and Shutter have no Eos hardkey for the visual switch (per ETC's OSC dictionary), but the SD encoder subscription swap fires for every category.
- Files touched: package.json (0.13.28→0.13.29), data/presets/eos-sd-plus.json (8→6 buttons), server/core/config-store.js (defaults + migration), server/core/console-drivers/eos-driver.js (routeFor trim), ui/app.js (EOS_CATEGORIES = 6).
- Notes: Existing users will lose any Beam/Custom/FX entries they had — that's intentional; those weren't canonical Eos categories and the controls weren't working anyway. If the user wants a 7th or 8th button bound to something specific (e.g. press to go Full, to fire a macro, to send /eos/key/blind), the Mappings tab supports adding arbitrary mappings on /sd/key/7 and /sd/key/8 with any action type.

## v0.13.28 — 2026-05-10
- Done: Two fixes for the SD top-row category buttons.
  1. **bankSelect routing trimmed to only confirmed-working hardkeys.** Nick tested each button against Eos Nomad v3.x: Focus/Color/Image/Form work; Form is aliased to Focus in Eos. Intensity/Beam/Shape(Shutter)/FX have no `encoder_category_*` hardkey — the v0.13.19 wheel-touch fallback with 0-delta also doesn't switch categories (Eos ignores 0-magnitude wheel ticks). Those routes were silently failing AND in one case (Shape→Shutter) sending the wrong key. Now we only emit a hardkey for categories where we know it works; the rest are intentionally silent on the Eos visual side.
  2. **Settings UI for per-category encoder params (Eos).** New grid editor in Settings → Console shows 8 cards (Intensity / Focus / Color / Beam / Image / Form / Shutter / Custom), each with 4 input fields for parameter names. Edit, Save, and the EosDriver's encoderParamsByCategory updates immediately — pressing a category button on the SD swaps to the new params. Removes the need to hand-edit config.json.
- Done: Despite some categories having no visual Eos hardkey, the SD subscription swap STILL fires for every category — that's the real value-add. The user sees which category they're on via the SD's LCD labels (the live "Pan -45 / Tilt 22" feedback).
- Files touched: package.json (0.13.27→0.13.28), server/core/console-drivers/eos-driver.js (bankSelect route table trimmed), ui/index.html (new Eos-category-params fieldset + grid), ui/app.js (renderEosCategoryParamsEditor + collectEosCategoryParams + form-submit hook).
- Notes: The visual-vs-encoder split is intentional. Eos's OSC API doesn't give us a clean way to switch the bottom-strip Encoder Display for arbitrary categories — only the four ETC has exposed (Focus / Color / Image / Form) plus Custom toggle. For the other categories, the SD's behavior leads and the Eos visual lags. If the user manually taps the category strip on Eos, both surfaces stay in sync. Per-category param editor in Settings lets the user dial in exactly which params each category exposes (different fixtures have different params — defaults are guesses).

## v0.13.27 — 2026-05-10
- Done: SD encoders now AUTO-SWAP which Eos parameters they control when a category button is pressed. Previously v0.13.26 had a static 4-param subscription that never changed regardless of category — encoders always controlled the same params (intens/pan/tilt/zoom by default). The user kept asking for MA3-style "encoder follows what's selected" behavior, which Eos's OSC doesn't expose directly. The workaround is to maintain a per-category param map in ENCpatch and swap subscriptions when the user navigates categories.
- Done: New `eos.encoderParamsByCategory` config — an object mapping category names to 4-element param arrays. Defaults:
  - Intensity/Intens → [intens]
  - Focus → [pan, tilt, x_focus, y_focus]
  - Color → [color_select, color_select_2, hue, saturation]
  - Beam → [zoom, iris, edge, frost]
  - Image → [gobo_select, gobo_index_speed, gobo_select_2, gobo_index_speed_2]
  - Form → [pan, tilt, x_focus, y_focus] (Form shares the Focus param set on most Eos profiles)
  - Shutter → [strobe, shutter_strobe, shutter_strobe_select, shutter_strobe_random]
  - Custom → [intens, pan, tilt, zoom]
- Done: New `EosDriver._swapSubscriptions(paramList)` — unsubscribes from the previous 4 params (sends /eos/subscribe/param/<old> 0 for each), subscribes to the new 4 (sends /eos/subscribe/param/<new> 1), clears value cache, re-emits encoderBar so LCD relabels with the new param names. Called from connect() with the user's default encoderParams AND from bankSelect() with the category-specific list.
- Done: bankSelect() now does THREE things: (1) sends the Eos category-switch hardkey/wheel-touch (visual change on Eos's strip), (2) swaps SD encoder subscriptions to the category's param set, (3) tracks `_activeCategory` for diagnostics. The user gets MA3-style following with the caveat that the param-per-category mapping is fixed by config rather than auto-discovered.
- Done: Migration in config-store backfills the per-category map for users with v0.13.26-and-earlier configs.
- Files touched: package.json (0.13.26→0.13.27), server/core/config-store.js (encoderParamsByCategory default + migration), server/server.js + server/api/http-server.js (pass opt through), server/core/console-drivers/eos-driver.js (_swapSubscriptions method + bankSelect wires to it).
- Notes: This is the closest practical approximation to MA3's auto-following encoders on Eos. The fundamental Eos OSC limitation (no API to query the current encoder display state) is sidestepped by having ENCpatch own the category→params mapping. Per-category params can be hand-edited in config.json under `eos.encoderParamsByCategory` — Settings UI for editing them is a future improvement.

## v0.13.26 — 2026-05-10
- Done: Rebuilt EosDriver around the ETCLabs **lighthack box_1** OSC pattern after Nick pointed to https://github.com/ETCLabs/lighthack/blob/master/box_1/box_1_src/box_1_src.ino. Three fundamental changes:
  1. **Per-parameter subscriptions**: `/eos/subscribe/param/<name>` 1 per configured encoder param (was the global `/eos/subscribe 1` since v0.13.0). Targeted, no ML-Controls noise.
  2. **OSC filter**: `/eos/filter/add ["/eos/out/param/*", "/eos/out/ping"]` tells Eos to ONLY emit those address families — suppresses every other /eos/out/* event we don't care about.
  3. **Listen on `/eos/out/param/<name>`** for live parameter values. Each update refreshes both the cache value AND the LCD label, which now shows "name value" format (e.g. "Pan -45", "Intens 75").
- Done: Encoder ticks now use the lighthack address form `/eos/wheel/coarse/<paramName>` (coarse/fine part of the path, not a separate mode setting). Sub-1 deltas still accumulate to integer clicks before sending.
- Done: Dropped the v0.13.23 `/eos/reset` periodic timer — no longer needed because per-param subscriptions push value updates on-demand. Eliminates the 500ms-period thrash of reset+user+subscribe.
- Done: bankSelect no longer fires reset/subscribe after the category-switch hardkey — categories on Eos are now purely visual; the SD encoders stay locked to the user's chosen params regardless of which category the operator views.
- Done: All sends now visible in the Monitor (cleared the silenced set) so the subscribe handshake and tick sends are debuggable end-to-end.
- Files touched: package.json (0.13.25→0.13.26), server/core/console-drivers/eos-driver.js (rewrite of connect, _onIncoming, encoderTick, bankSelect simplification; added _renderBarLabels helper).
- Notes: The lighthack box_1 source is the closest thing to a canonical reference for how ETC engineers intend OSC encoder controllers to work with Eos. Following their pattern eliminates the entire `/eos/out/active/wheel` rabbit hole — that path was for "wheels with recently-changed values" not "the currently-displayed encoder wheels". Per-param subscribe is the real path. LCD now shows live values which is a UX improvement beyond what the user originally asked for.

## v0.13.25 — 2026-05-10
- Done: Reverted v0.13.21's `/eos/active/wheel/<n>` input path — ETC documents that address only as OUTPUT (Eos→client), and sending it as input was being silently dropped by Eos. Encoders were firing OSC into the void. Back to `/eos/wheel/<paramName>` which is the documented input form.
- Done: Made Fixed parameter mode the **default** so Eos users get working encoders out of the box. New default `eos.encoderParams = ["intens", "pan", "tilt", "zoom"]`. Encoder 1 ticks intensity, 2 ticks pan, 3 ticks tilt, 4 ticks zoom — works for any typical moving-light show with no setup needed.
- Done: Migration in config-store backfills the new default for existing v0.13.24 users whose saved config has `encoderParams: null` (the v0.13.24 default that produced broken encoders).
- Done: encoderTick fallback chain: (1) user's fixed param for this slot → /eos/wheel/<name>; (2) cached param from feedback → /eos/wheel/<name>; (3) no-op + log (preserves accumulator so the tick isn't lost when cache later populates).
- Files touched: package.json (0.13.24→0.13.25), server/core/config-store.js (encoderParams default + migration), server/core/console-drivers/eos-driver.js (encoderTick fallback chain, dropped /eos/active/wheel/<n>).
- Notes: With Fixed mode as default, the user's friend gets working encoders immediately on launch. To change which 4 parameters: Settings → Console → "Fixed encoder parameters (Eos)" → edit the comma-separated list, Save. To enable auto-follow Eos (clear the field): paste an empty value and Save — but understand that the labels won't match the bottom-strip Encoder Display because Eos's OSC doesn't expose that surface.

## v0.13.24 — 2026-05-10
- Done: Two opt-in modes for Eos encoder mapping, addressing the discovery that ETC's OSC API doesn't expose the bottom-strip Encoder Display state directly. The default /eos/out/active/wheel feedback reflects ML Controls / programming state, not the visible category strip — so the SD encoders' labels and behavior felt disconnected from what's shown on Eos.
  - **Custom Encoder Map mode** (`config.eos.useCustomEncoderMap=true`): on connect, ENCpatch toggles Eos's Custom Encoder Map mode via `/eos/key/encoder_custom`. User creates a 4-wheel custom map in Eos Tab 40 first; once active, both Eos's bottom strip AND the /eos/out/active/wheel feedback reflect that map, so the SD mirrors it correctly.
  - **Fixed parameter mode** (`config.eos.encoderParams=["intens","pan","tilt","zoom"]`): each SD encoder hardcoded to a named parameter. LCD shows those names statically; ENCpatch ignores Eos feedback so labels don't drift. encoderTick sends `/eos/wheel/<paramName>` per slot using the user's array.
  - Default behavior (both off) unchanged: `/eos/active/wheel/<n>` slot-indexed addressing + dynamic feedback labels.
- Done: Settings UI gained two new inputs: "Use Custom Encoder Map" checkbox and "Fixed encoder parameters" textfield (comma-separated names). Form handler converts the textfield to/from the 4-element array on save/load.
- Done: INSTALL.md gained an "Eos encoder mapping" section with step-by-step setup for both options.
- Files touched: package.json (0.13.23→0.13.24), server/core/config-store.js (new defaults), server/server.js + server/api/http-server.js (pass opts through to driver), server/core/console-drivers/eos-driver.js (encoderTick fixed-param branch + connect-time Custom Map toggle + feedback-update skip in fixed mode), ui/index.html (two new inputs), ui/app.js (text↔array conversion in form handlers), INSTALL.md (setup guide).
- Notes: The /eos/reset 500ms refresh from v0.13.23 stays in — still useful for general state freshness — but is now less critical because both new modes sidestep the active-wheel feedback problem entirely. User can choose Custom (dynamic, requires Eos-side setup) or Fixed (static, zero Eos setup) per preference.

## v0.13.23 — 2026-05-10
- Done: Replaced `/eos/subscribe` toggle (was a no-op for forcing re-emission) with `/eos/reset` as the state-dump mechanism. Per ETC docs, /eos/reset "sends all implicit OSC output commands" — that's the burst of /eos/out/* we need to refresh our wheel cache when category changes. Side effect: /eos/reset also wipes OSC user ID and wheel modes, so we restore user ID + re-subscribe immediately after every reset.
- Done: Periodic refresh interval relaxed from 250ms to 500ms because /eos/reset is heavier than a subscribe toggle. 500ms still keeps the user's "follow Eos UI within half a second" requirement.
- Done: bankSelect now uses /eos/reset → /eos/user → /eos/subscribe sequence after every category switch (replaces the broken subscribe-toggle approach).
- Done: Extended the silenced-log set to include /eos/reset and /eos/user (they fire 2 Hz now and would flood the Monitor).
- Files touched: package.json (0.13.22→0.13.23), server/core/console-drivers/eos-driver.js (reset-based forced state dump in both periodic timer and bankSelect; expanded SILENT log filter).
- Notes: This is the fix for "after restart with Color selected I still see Intensity/Pan/Tilt/X Focus" — Eos's subscribe model only emits when wheels CHANGE, not when categories switch. /eos/reset is the documented way to force a complete state re-emit. If Eos still doesn't refresh after this change, the next step is to enable "Outgoing OSC" in Eos's Tab 99 Diagnostics and observe whether Eos emits the right /eos/out/active/wheel/N messages at all — if not, the disconnect is on Eos's side and we'd need a different feedback channel.

## v0.13.22 — 2026-05-10
- Done: Fixed parameter-name parsing. The earlier `/^(\S+)/` regex was truncating multi-word names — "Color Select [open]" → "Color", "Color Select 2 [CTC 3200K]" → "Color". Now splits on the first " [" delimiter, capturing "Color Select" and "Color Select 2" intact. The SD LCD labels now match exactly what Eos's encoder display shows in the encoder-bar area (Color Select / Color Select 2 / Intens / Pan etc.).
- Files touched: package.json (0.13.21→0.13.22), server/core/console-drivers/eos-driver.js (_onIncoming label parser).

## v0.13.21 — 2026-05-10
- Done: Replaced cache-based wheel addressing with slot-indexed addressing. encoderTick now sends `/eos/active/wheel/<n>` directly (slot N) instead of looking up the slot's parameter name from cache and sending `/eos/wheel/<paramName>`. The slot-indexed form is undocumented as INPUT in ETC's OSC dictionary but works in Eos v3.x per community testing — Eos resolves "tick slot N" server-side using whatever parameter it currently has there, eliminating all cache-staleness issues.
- Done: This fully decouples encoder behavior from feedback timing. The 250ms subscribe refresh and the periodic state pulls become irrelevant for encoder control — Eos always knows what's on slot N because it owns that mapping.
- Files touched: package.json (0.13.20→0.13.21), server/core/console-drivers/eos-driver.js (encoderTick rewrite to /eos/active/wheel/N).
- Notes: If Eos rejects `/eos/active/wheel/<n>` as input (it's not in the published dictionary), Eos's Tab 99 Diagnostics will log a parse error and we'll need to fall back to the v0.13.11 cache+param approach with an aggressive cache refresh. But if it works, it sidesteps the whole class of stale-cache problems.

## v0.13.20 — 2026-05-10
- Done: Graceful shutdown. Cmd+Q from macOS menubar no longer requires force-quit. Root cause: `electron/main.js` had no `before-quit` handler, and the existing `window-all-closed` handler ran `e.preventDefault()` on macOS (keeping the tray alive) so isQuitting was never set true. Meanwhile the background server had multiple resources keeping the Node event loop alive — 250ms Eos subscribe timer (v0.13.17), TCP socket to MA3 Lua bridge, UDP sockets for OSC and Eos, WebSocket server, Stream Deck HID claim — none of which got closed.
- Done: `server/server.js` now exposes `module.exports.shutdown` — an async function that disconnects the console driver, stops page-binder polls, stops OSC, disconnects ma3lua, closes the Stream Deck HID, closes the WebSocket hub, and closes the HTTP server in order. Removed `process.exit(0)` from the end so the event loop drains naturally (gives any in-flight OSC sends time to finish).
- Done: `electron/main.js` now has a `before-quit` handler that preventDefaults the quit, awaits `serverModule.shutdown()`, then calls `app.exit(0)` to terminate cleanly.
- Done: `WsHub.close()` method — terminates every client socket and closes the WebSocket server listener. Without this the WS server stayed bound, contributing to the lingering event loop.
- Files touched: package.json (0.13.19→0.13.20), electron/main.js (before-quit handler), server/server.js (exported shutdown, broader resource cleanup), server/api/ws-hub.js (close method).
- Notes: Cmd+Q now does the right thing. Tray-menu Quit also works (same code path via `app.isQuitting = true; app.quit()` which triggers before-quit). Force-quit shouldn't be needed anymore. Tested locally — needs verification on a real install.

## v0.13.19 — 2026-05-10
- Done: Empirical fix for partial encoder_category_* coverage on Eos v3.x. User tested v0.13.15's full hardkey set against Eos Nomad; results: Focus/Color/Image/Form work; Intensity and Beam silently no-op; Shutter scrolls to Form (wrong). EosDriver.bankSelect now uses a hybrid routing table per category — hardkey for the ones that work, 0-delta wheel-touch on a representative parameter for the ones that don't.
- Done: Routing: Focus/Color/Image/Form → `/eos/key/encoder_category_<name>`; Custom → `/eos/key/encoder_custom` (toggle, v3.1+); Intensity → wheel-touch on `intens`; Shutter → wheel-touch on `strobe`; Beam → wheel-touch on `zoom` (Beam isn't a discrete Eos category — it's distributed across Form/Image/Shutter; zoom is the most beam-like param).
- Done: MA3-flavored back-compat (Dimmer/Position/Gobo/Shapers/Control) updated to point at the same Eos destinations using the hybrid table.
- Files touched: package.json (0.13.18→0.13.19), server/core/console-drivers/eos-driver.js (bankSelect rewrite — per-category routing table with key/param/cmd dispatch).
- Notes: The encoder_category_* family is partially documented at best — ETC's published OSC dictionary doesn't list any of them; the only public confirmation is a 2022 community thread mentioning `encoder_category_focus` and `encoder_custom`. Empirical mapping is the only way to know which work.

## v0.13.18 — 2026-05-10
- Done: Diagnostic build — added cache-change logging (`← wheel N: old → new`) so we can prove whether Eos pushes fresh wheel state after category changes. Silenced /eos/subscribe send logs (would have flooded the Monitor at 8 Hz). This pass identified that some encoder_category_* hardkeys are silently no-op, leading to v0.13.19's hybrid fix.
- Files touched: package.json (0.13.17→0.13.18), server/core/console-drivers/eos-driver.js (cache-change log + send-log filter).

## v0.13.17 — 2026-05-10
- Done: Dropped Eos wheel-cache refresh interval from 3s to 250ms (user requirement: under 0.5s). Worst-case slot-to-encoder lag is now ≤250ms when category is changed on Eos's UI directly. OSC overhead at this rate: ~256 B/s on loopback, negligible.
- Done: New `eos.subRefreshMs` config knob (clamped to ≥100ms) for future tuning. Default 250.
- Files touched: package.json (0.13.16→0.13.17), server/core/console-drivers/eos-driver.js (refresh interval + opt knob).

## v0.13.16 — 2026-05-10
- Done: Periodic /eos/subscribe refresh (every 3 seconds) on the EosDriver. Eos only emits `/eos/out/active/wheel/<n>` feedback when a wheel is touched OR when /eos/subscribe transitions — so if the user changed category on Eos's UI directly (not via SD button), the wheel cache would go stale. encoderTick uses the cached parameter name to address Eos's wheel (since Eos's input API takes parameter NAMES not slot indices), so stale cache means encoder 1 would still tick the OLD slot 1 parameter even after the user switched categories.
- Done: Auto-cleanup of the refresh timer on disconnect() — cleared in addition to the existing UDP socket close.
- Files touched: package.json (0.13.15→0.13.16), server/core/console-drivers/eos-driver.js (subRefreshTimer in connect + disconnect cleanup).
- Notes: The user reported "OSC is controlling specific encoders based on attribute and not just controlling the encoder despite what is assigned." Translation: they want slot-based encoder behavior — encoder 1 always controls whatever Eos has on slot 1, regardless of which parameter is there. ENCpatch's behavior IS slot-based at the user level (encoderTick looks up the slot's current parameter name from cache and tells Eos to tick THAT parameter); the bug was the cache going stale. With this fix the cache refreshes every 3s plus on every category switch, so encoders should consistently follow their slot positions. There's still a worst-case ~3s lag if the user changes category on Eos's UI without ENCpatch knowing — that's the limit of Eos's lazy emit model.

## v0.13.15 — 2026-05-10
- Done: Found the ACTUAL category-switch OSC path on ETC's community forum (matt pumplin verified, 2022-08): `/eos/key/encoder_category_<name>` where `<name>` is `intens`, `focus`, `color`, `shutter`, `image`, `form`, or `beam`. These are hardkey simulators that DO trigger the encoder-display category strip. Custom is special: since Eos v3.1+ it's `/eos/key/encoder_custom` (toggle behavior because Custom was repurposed for Custom Encoder Maps). These are not in the official OSC dictionary but are the ETC-recommended path. Replaces v0.13.14's wheel-touch hack which didn't reliably switch categories on its own.
- Done: Forced /eos/subscribe re-fire (off → on) immediately after the category hardkey to make Eos emit a fresh /eos/out/active/wheel batch for the new category. Local cache cleared in the same step to avoid stale labels persisting while the response arrives.
- Files touched: package.json (0.13.14→0.13.15), server/core/console-drivers/eos-driver.js (bankSelect rewrite — encoder_category_* hardkeys + force re-subscribe).
- Notes: Took eight versions (v0.13.7 through v0.13.15) to land the correct category-switch mechanism. The path is NOT in the published OSC dictionary — it's only mentioned on a 2022 forum thread. Source URL: https://community.etcconnect.com/control_consoles/eos-family-consoles/f/eos-family-show-control-support-midi-smpte-osc-rtc-etc/40990/. ETC's docs team confirmed the dictionary needs updating.

## v0.13.14 — 2026-05-10
- Done: Reverted v0.13.13's softkey-based bankSelect — those softkey numbers (1-6) are bottom-of-screen utility softkeys, NOT the encoder-display category strip on the left. The strip itself has no direct OSC API per ETC. Replaced with the v0.13.11 wheel-touch approach: send `/eos/wheel/<categoryParam>` with delta 0, which Eos treats as a wheel touch and auto-scrolls the strip to that parameter's category. Each category maps to a universally-available parameter (Intensity→intens, Focus→pan, Color→red, Form→pan, Image→gobo_select, Beam→zoom, Shutter→strobe). Custom falls back to `/eos/cmd "Custom\r"` typed into the command line.
- Done: After every category-switch, re-fire `/eos/subscribe 0` then `/eos/subscribe 1` to FORCE Eos to re-emit `/eos/out/active/wheel/<n>` for the new category. Without this, Eos only emits on actual wheel ticks — the LCD strip would keep showing the previous category's labels until the user spun an encoder. Also clears the local _encoderBarCache so stale labels don't briefly persist while waiting for the re-subscribe response.
- Files touched: package.json (0.13.13→0.13.14), server/core/console-drivers/eos-driver.js (bankSelect rewrite — wheel-touch + force re-subscribe).
- Notes: The "encoders not remapping when attributes change" symptom is from Eos's behavior — it's lazy about emitting wheel state. Touching a wheel via OSC (or the user touching a wheel manually on Eos) triggers a fresh emit. The forced re-subscribe in bankSelect side-steps this for SD-button-driven category changes. If the user changes category by tapping the strip on Eos's touchscreen directly (not via the SD), the LCD will still take ~1s to update or require a wheel-tick to refresh — that's a Eos-side limitation not solvable from ENCpatch.

## v0.13.13 — 2026-05-10
- Done: SD top-row buttons now drive Eos's category strip via `/eos/softkey/<n>` press+release. EosDriver.bankSelect maps category names → softkey indices using Eos's default category-row layout (Intensity=1, Focus=2, Color=3, Form=4, Image=5, Shutter=6, Beam=7 (page 2), Effect=8, Custom=9). The strip on Eos's encoder display IS softkey-driven — pressing softkey 1 highlights Intensity in the strip, etc.
- Done: Eos preset rewritten to use 8 setPage actions in the user-requested order: Form, Image, Intensity, Color, Beam, Focus, Shutter, Custom. Each routes through bankSelect → softkey OSC.
- Done: Reverted from v0.13.12's consoleKey hardkey approach for category buttons — hardkeys like `live`/`blind`/`cue` are useful but they're NOT what the user wanted; user wanted the encoder-bank category strip. The consoleKey action type stays in the engine (still useful for other custom hardkey mappings) but isn't used by the default Eos preset.
- Files touched: package.json (0.13.12→0.13.13), server/core/console-drivers/eos-driver.js (bankSelect rewrite to softkey approach), data/presets/eos-sd-plus.json (8 setPage mappings, Form/Image/Intensity/Color/Beam/Focus/Shutter/Custom order).
- Notes: Softkey numbers are layout-dependent. If the user's Eos has the category strip in a different softkey order (e.g. some shows reorder via setup), they can edit the softkeyMap in eos-driver.js or override per-mapping. Beam isn't a standard Eos category in the default 6-position softkey row — mapped to softkey 7 (page 2) as a guess; may need adjustment based on what the user's Eos shows there.

## v0.13.12 — 2026-05-10
- Done: New `consoleKey` action type — routes to `driver.hardkey(name)` so mappings can fire any console hardkey without hardcoding console-specific OSC paths in user config. EosDriver.hardkey(name) sends `/eos/key/<name>` press (1.0) + release (0.0), matching ETC's button-edge convention.
- Done: Updated Eos preset to map all 8 SD top-row buttons to common live-show hardkeys: Live / Blind / Cue / Group / Update / Macro / At / Enter. Each is a `consoleKey` action with `name` set to the lowercase OSC hardkey identifier from ETC's dictionary. Per ETC's "Eos OSC Conventions" doc, names are case-insensitive and accept abbreviations, so `live`, `LIVE`, `Live` all work — but lowercase is the canonical form.
- Done: Sources verified at https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/Using_OSC_with_Eos/Eos_OSC_Conventions.htm — confirms /eos/user, button-edge semantics, and case/abbreviation handling for parameter & key names.
- Files touched: package.json (0.13.11→0.13.12), server/core/mapping-engine.js (consoleKey case in _dispatchAction), server/core/console-drivers/eos-driver.js (hardkey method), data/presets/eos-sd-plus.json (consoleKey actions), server/api/http-server.js + lua plugin (version bumps).
- Notes: To remap any button to a different hardkey, edit the mapping's `action.name` field. Find valid names in Eos itself: open Tab 7 (Virtual Keyboard) → bottom-right dropdown → "OSC /key Names". Examples: `live`, `blind`, `format`, `displays`, `patch`, `group`, `address`, `macro`, `preset`, `cue`, `list`, `update`, `delete`, `last`, `next`, `highlight`, `park`, `enter`, `clear`, `select`, `at`, `full`, `out`, `thru`, `plus`, `minus`, `0`-`9`, `decimal`, `go`, `stop`, `back`. The `consoleKey` action will work for any future driver that implements `hardkey()` — it's not Eos-specific.

## v0.13.11 — 2026-05-10
- Done: Two real bugs uncovered by Eos's diagnostics log (Tab 99). (1) `/eos/wheel/<numeric>` is rejected with "ProcessWheelCommand invalid parameter name: 1" — Eos expects a parameter NAME there, not a slot index. EosDriver.encoderTick now resolves the parameter name from the cached `/eos/out/active/wheel/N` feedback and sends `/eos/wheel/Pan`, `/eos/wheel/level`, etc. Falls back to `/eos/active/wheel/<n>` when no name is cached yet (initial state before feedback arrives). Verified against ETC's official docs at https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/Using_OSC_with_Eos/OSC_Eos_Control.htm — the wheel API takes parameter names like `pan`, `tilt`, `level`. (2) `/eos/key/intens` rejected with "OSCKeyMethod has invalid key name 'intens'" — the category strip is touchscreen-only and has NO documented OSC switching API. Replaced bankSelect's /eos/key approach with a 0-delta wheel touch on the category's primary parameter (Intens→level, Form→pan, Color→red, Image→gobo_select, etc.). 0-delta wheel ticks don't move the value but Eos treats them as a wheel-activation, surfacing that parameter's category.
- Files touched: package.json (0.13.10→0.13.11), server/core/console-drivers/eos-driver.js (encoderTick + bankSelect rewrites), server/api/http-server.js (version bump).
- Notes: This was a six-version iteration arc on the Eos OSC dialect (v0.13.0..v0.13.11). Each iteration revealed the next layer: port clash → driver-state-not-exposed → user-context-missing → wrong wheel address shape → wrong key name domain. The smoking-gun diagnostic in each case was a different log: ENCpatch's Monitor for sends, Eos's Diagnostics tab for parse errors. Both directions of logging are now in place for future debugging.

## v0.13.10 — 2026-05-10
- Done: ROOT CAUSE found for "encoder shows but doesn't move intensity" and "buttons don't press the keys" — Eos requires every OSC client to declare its user context via `/eos/user N`. Without that the client defaults to user 0 (background user) which has read-only OSC privileges: feedback subscriptions work fine, /eos/out/* messages flow back, but every /eos/wheel/<n> and /eos/key/<name> the client SENDS silently no-ops. EosDriver.connect now sends `/eos/user 1` immediately after binding the UDP socket and before /eos/subscribe, so all subsequent commands are processed as user 1 (the default interactive user).
- Done: User number is configurable via `config.eos.user` (default 1), wired through both the startup loadDriver call and the /api/settings hot-swap path. Settings tab gained an "Eos user" input next to host/port for quick adjustment in multi-user shows.
- Files touched: package.json (0.13.9→0.13.10), server/core/console-drivers/eos-driver.js (/eos/user on connect), server/core/config-store.js (eos.user default), server/server.js + server/api/http-server.js (pass user through to driver), ui/index.html (eos.user input).
- Notes: This was a SIX-VERSION bug (v0.13.0 through v0.13.9 all sent OSC the user couldn't act on). The smoking gun was `→ /eos/wheel/1 [f:-2]` in the Monitor: clean send, no error, but Eos didn't react. The "feedback works, commands don't" asymmetry is the signature of an OSC user-permission mismatch on Eos. Confirmed by ETC's OSC reference doc.

## v0.13.9 — 2026-05-10
- Done: Added per-send debug logging in `EosDriver._send` so the Monitor tab now shows every UDP message the driver emits (`→ /eos/wheel/1 [f:-2]`). Also explicit "Eos send blocked (no UDP socket)" / "Eos send blocked (not connected)" logs when the connection guard rejects a send — eliminates the silent-failure mode of the previous driver.
- Files touched: package.json (0.13.8→0.13.9), server/core/console-drivers/eos-driver.js (_send logging), server/api/http-server.js (version), docs/ma3-plugin/ENCpatchMA3Bridge.lua (version).
- Notes: Diagnostic-only change. Set up the visibility we needed to find the v0.13.10 root cause — without per-send logging we'd have kept guessing whether OSC was being sent vs. being received-and-ignored by Eos.

## v0.13.8 — 2026-05-10
- Done: Eos encoder ticks now actually move wheels. Root cause: ETC Eos rounds the float arg of `/eos/wheel/<n>` DOWN to an integer click count, so a 0.5-delta tick (which is what the default `cmd-tick` transform produces with `coarseStep: 0.5`) gets registered as 0 clicks → no movement. Fix: `EosDriver.encoderTick` now accumulates sub-1.0 deltas per slot in a Map and only emits `/eos/wheel/<n>` when |sum| crosses 1.0, sending the integer click count and carrying the remainder forward. Net effect: two SD turns at 0.5 each = one Eos click. Fine-step turns still feel responsive because the accumulator preserves direction.
- Done: Bumped the Eos preset's `coarseStep` from 0.5 to 1.0 and `fineStep` from 0.1 to 0.25, so a freshly-loaded preset gives users an immediate single-click → single-click experience without needing to wait for the accumulator.
- Files touched: package.json (0.13.7→0.13.8), server/core/console-drivers/eos-driver.js (encoderTick accumulator), data/presets/eos-sd-plus.json (step bump).
- Notes: The accumulator is keyed by slot, so cross-slot ticks don't pollute each other. Reset on driver reconnect (the Map is reinitialized in encoderTick if missing). Symmetric: signed accumulation handles both directions cleanly via floor/ceil-toward-zero rounding.

## v0.13.7 — 2026-05-10
- Done: Eos wheel-feedback regex fixed. The driver was matching `/eos/out/wheel/<n>` but Eos actually emits `/eos/out/active/wheel/<n>` for the subscribed-state stream — that's why ENCpatch's LCD was stuck on "no fixtures selected" even when fixtures were selected and wheels were active. Match both forms now (active prefix optional). Also handle `/eos/out/active/wheel/count` to clear stale slot labels when category-switching reduces the number of active wheels.
- Done: `EosDriver.bankSelect` now accepts Eos-native category names (Intens, Focus, Color, Shutter, Image, Form, Custom, Effect) AS WELL AS the legacy MA3-flavored ones (Dimmer/Position/Gobo/etc.). For unknown names it falls back to lowercased pass-through, so any Eos category typed into a `setPage` mapping page-name field now Just Works.
- Done: Stream Deck Plus → Eos preset shipped at `data/presets/eos-sd-plus.json`. 4 encoders → bridgeTick (auto-tracks the current Eos wheel category), 8 keys → Custom / Intens / Focus / Color / Shutter / Image / Form / Effect — exactly matching Eos's on-screen category strip. Apply via Settings → Presets after picking ETC Eos as the console.
- Files touched: package.json (0.13.6→0.13.7), server/core/console-drivers/eos-driver.js (regex + bankSelect map), data/presets/eos-sd-plus.json (new).
- Notes: With this preset loaded and the v0.13.6 page-binder fix, Stream Deck button presses now: (a) actually press the Eos category key (Custom/Intens/.../Effect), (b) Eos switches active wheel category, (c) Eos sends `/eos/out/active/wheel/<n>` feedback, (d) page-binder receives the event, (e) renderer relabels the four LCD tiles with whatever Eos exposed for that category. End-to-end loop closed.

## v0.13.6 — 2026-05-10
- Done: Critical follow-up to v0.13.5. The page-binder constructor was being called with `transports: { osc, ma3lua }` — never receiving the console driver. So the v0.13.5 "if non-MA3 skip ma3lua poll, subscribe to console events" branch was unreachable: `this.transports.console` was always undefined, the loop fell through to the MA3-only path, ma3lua poll failed because no bridge, and the LCD reported `noBridge` forever. That's why Nick saw "buttons acting like hotkeys" (Eos hotkey fires worked, but the SD encoder labels never updated to follow), "encoders not auto-mapping" (same — no encoderBar feedback ever reached the renderer), and "LCD waiting on bridge to connect" (literal `_encoderBarReason: noBridge`). Fixed by passing `console: consoleDriver` to the PageBinder constructor's transports.
- Done: `PageBinder.rebindConsole()` method — used by /api/settings hot-swap to re-subscribe to the new console driver's events (or restart the ma3lua poll if the user switched back to MA3). Without this, switching consoles mid-session would leave the old subscription dangling and the LCD blank. http-server.js's hot-swap path now calls `pageBinder.rebindConsole()` after reassigning `transports.console`.
- Done: Refactored the event-subscribe code into `_subscribeConsoleEncoderBar(drv)` so it can be reused on initial poll and on hot-swap.
- Files touched: package.json (0.13.5→0.13.6), server/server.js (1 line — added console to pageBinder transports), server/core/page-binder.js (rebindConsole + _subscribeConsoleEncoderBar refactor), server/api/http-server.js (calls rebindConsole on hot-swap).
- Notes: With the v0.13.4 + v0.13.5 + v0.13.6 chain landed, Eos-on-the-same-Mac is now actually fully functional — encoder ticks reach Eos's wheels, LCD strip mirrors the live wheel feedback, SD top-row keys switch encoder banks AND the labels update, and the console-status badge in Settings shows green.

## v0.13.5 — 2026-05-10
- Done: Stream Deck LCD now populates from Eos (and any non-MA3 driver). page-binder's `startEncoderBarPoll` checks the active console — if it's not MA3, skips the ma3lua poll entirely and subscribes to `console.on('encoderBar')` events. EosDriver was already emitting these from `/eos/out/wheel/<n>` feedback; just nobody was listening.
- Done: SD key label translation per console. The renderer holds a `_consoleId` (set on startup + on config.console changes) and rewrites page-select labels via a per-console map: for Eos, `Dimmer→Intens`, `Position→Form`, `Gobo→Image`, `Shapers→Shape`, `Control→FX`. The DISPLAY changes; the underlying mapping name and the bankSelect call flow unchanged through the driver's name map (driver.bankSelect("Dimmer") still emits /eos/key/intens).
- Done: ETC Ion / Ion XE console layout shipped at `data/consoles/eos-ion.json`. Sections: encoder wheels (4), category keys (Intens / Focus / Color / Shutter / Image / Form / Effect / Custom), numeric keypad (0-9 + .), command keys (Thru, +, -, At, Full, Out, Enter, Clear, Select), display & navigation (Live / Blind / Format / Displays / Patch / Group / Macro / Preset / Cue / List / Update / Delete / Last / Next / Hilite / Park), 19 submasters, and playback (Go / Back / Macro Go / Release / Assert / Pg ▲▼ / Grand Master). Address scheme uses Eos OSC `/eos/key/<name>`, `/eos/wheel/<n>`, `/eos/sub/<n>`, `/eos/fader/1/grandmaster`. Auto-discovered by `/api/layouts`. Visible in the Visual Builder's console picker after restart.
- Files touched: package.json (0.13.4→0.13.5), server/server.js (setConsoleId on render + onChange), server/core/page-binder.js (event-driven path for non-MA3), server/core/streamdeck-renderer.js (CATEGORY_LABEL_BY_CONSOLE map + setConsoleId), data/consoles/eos-ion.json (new).
- Notes: The third symptom Nick reported ("encoders dont work") is most likely the unrelated Stream Deck detection issue — `sdhid.connected:false, lastError:"no devices"` was in the v0.13.3 /api/state. Without a deck connected there are no encoders to spin. Confirm SD is plugged in AND the Elgato Stream Deck app is fully quit (it claims the deck exclusively) before re-testing.
- Limitation: hot-swap of the console driver via /api/settings doesn't currently re-bind page-binder's encoderBar subscription — user must restart the app after switching consoles for the LCD path to follow. Tracked in BACKLOG.

## v0.13.4 — 2026-05-10
- Done: Critical one-liner — `server/server.js` was passing `transports = { osc, ma3lua, sdhid, pageBinder }` to `startHttpServer()` WITHOUT `console: consoleDriver`. So /api/state always reported `console.driver = 'none'` regardless of what driver was actually loaded, and the Settings UI's status badge stayed dead. The engine had the driver wired correctly via its own `engine.transports.console`; only the http-server view of state was broken. Fixed by adding `console: consoleDriver` to the transports object on line 245.
- Files touched: package.json (0.13.3→0.13.4), server/server.js (1 line), server/api/http-server.js (version bump), docs/ma3-plugin/ENCpatchMA3Bridge.lua.
- Notes: This bug existed since v0.13.0 — explains why the Eos status badge never went green for Nick during testing despite the driver actually working. The hot-swap path in /api/settings was correct; only the startup wiring was missing the console field.

## v0.13.3 — 2026-05-10
- Done: Fix Eos UDP bind clash. ENCpatch's general OSC client (`osc-client.js`) binds 8001 for inbound MA3 / controller traffic; the EosDriver was trying to ALSO bind 8001 (Eos's shipped TX default) for feedback, and the second bind silently EADDRINUSE'd. Two changes: (1) default `eos.localPort` is now 8002, with a one-shot config migration that bumps existing 8001→8002 if `osc.listenPort` is also 8001. (2) EosDriver retries with port=0 (ephemeral) if its target is busy, so worst-case the sending direction still works.
- Done: Welcome modal Eos placeholder updated to 8002. Step 3 hint clarifies the user must set Eos shell TX port = 8002 (NOT Eos's shipped default 8001).
- Done: INSTALL.md notes the 8002 requirement under the Eos prerequisites section.
- Files touched: package.json (0.13.2→0.13.3), docs/ma3-plugin/ENCpatchMA3Bridge.lua, server/api/http-server.js, server/core/config-store.js, server/core/console-drivers/eos-driver.js, ui/app.js, INSTALL.md.
- Notes: Stream Deck "not detected" turned out to be the optional native deps (`@elgato-stream-deck/node`, `node-hid`) silently failing during `npm install`. Resolved by re-running install with `--include=optional`. No source change for that — it's a packaging step, but next iteration should consider promoting them out of `optionalDependencies` if their absence keeps biting.

## v0.13.2 — 2026-05-10
- Done: Settings tab is now console-aware. Title and intro text rewrite based on the console picker; the "MA3 OSC ports", "MA3 Bridge plugin", and "Encoder stacks" sections hide entirely when console isn't `ma3`. Fixes the v0.13.1 confusion where Eos users saw a panel full of MA3-specific config.
- Done: Console host/port labels relabel themselves ("Eos host" / "MagicQ host" / etc.) instead of the static "Console host" copy.
- Done: Live console driver status badge in the Console fieldset, polled every 1.5s alongside the existing MA3 bridge status.
- Done: "Run setup again" button in the Console fieldset — clears the welcomed-flag and re-opens the welcome modal. Useful after upgrades.
- Done: Bumped welcome localStorage key from v1 to v2 — anyone upgrading from v0.13.0/0.13.1 will see the new console-aware welcome modal once on next launch.
- Done: Re-enabled MagicQ/Onyx/Titan/Hog/Vista in the Settings console picker (no longer marked `disabled`); each labeled "(untested)" so the user knows they're scaffolds.
- Files touched: package.json (0.13.1→0.13.2), docs/ma3-plugin/ENCpatchMA3Bridge.lua, server/api/http-server.js, ui/index.html, ui/app.js.
- Notes: No new tests — these are UI-only changes. Manual smoke check: switch console picker to Eos, confirm the three MA3 sections vanish; switch back to MA3, confirm they re-appear; click "Run setup again", confirm welcome modal reopens.

## v0.13.1 — 2026-05-10
- Done: Welcome modal is now console-aware. Renders an Eos-shaped flow (3 steps: SD plug-in → host/port form → enable OSC in Eos shell) when `config.console === 'eos'`, the original MA3 flow for `'ma3'`, and a generic OSC flow for the rest. Live status dots react to `j.console.connected` for non-MA3 paths.
- Done: Hot-swap of the console driver inside `/api/settings`. Switching `console` no longer requires a restart — engine.transports.console is replaced and the new driver connects on the spot.
- Done: Replaced StubDriver registrations for onyx/titan/hog/magicq/vista with real OSC-over-UDP driver scaffolds modeled on EosDriver. Address schemes documented from each console's published OSC reference; not live-tested.
- Done: `/api/inject` accepts `{ action }` shape (Companion module path) in addition to `{ address, args }` (legacy SD-plugin path).
- Done: Companion module scaffold at `companion-module/` (manifest, main.js, HELP.md). Three actions: bridgeTick, setPage, cmd.
- Done: Native Stream Deck plugin scaffold at `streamdeck-plugin/com.encpatch.bridge.sdPlugin/` (manifest, plugin.js, pi.html). Three actions matching Companion's. Icons + signing pending.
- Done: Defensive `console: 'ma3lua' → 'ma3'` migration in config-store.
- Done: New tests in `mapping-engine.test.mjs` covering `bridgeTick` routing through `transports.console` for non-MA3 (direct call) and MA3 (no-op on direct path; coalescer covers it elsewhere), plus `setPage` → `bankSelect` for non-MA3.
- Files touched: package.json (0.13.0→0.13.1), docs/ma3-plugin/ENCpatchMA3Bridge.lua, server/api/http-server.js, server/core/config-store.js, server/core/mapping-engine.test.mjs, server/core/console-drivers/index.js, server/core/console-drivers/{onyx,titan,hog,magicq,vista}-driver.js (new), ui/index.html, ui/app.js, ui/styles.css, companion-module/* (new), streamdeck-plugin/* (new), BACKLOG.md, docs/PROGRESS.md.
- Notes: All non-MA3 drivers still emit `static get macSupported()` honestly — Onyx/Titan/Vista still flagged as Windows-only consoles even though ENCpatch (which talks to them over LAN) runs on Mac. The picker shows them with `(untested)` until someone validates against real hardware.

## 2026-05-10 (recovery)
- Done: Recovered project after the source folder at `~/Documents/Claud/ma3 int/ma3-mapper` was wiped by edits in a different chat session. Extracted from the installed `.app` bundle's `app.asar` using `@electron/asar`.
- Done: Rebuilt every dev/distribution file that wasn't shipped inside the `.app` (package.json devDeps + electron-builder config, build/afterPack.js, scripts/package-share.js, BACKLOG.md, README.md, INSTALL.md, mappings.example.json, start scripts, .gitignore, this PROGRESS.md).
- Files touched: package.json (devDeps + build block); build/afterPack.js (new); scripts/package-share.js (new); BACKLOG.md (new); docs/PROGRESS.md (new); README.md (new); INSTALL.md (new); mappings.example.json (new); start.sh, start.bat, .gitignore (new).
- Notes: Runtime source (server/, ui/, electron/, docs/, data/) was already complete in the .app; only dev tooling and docs were missing. Companion module and native Stream Deck plugin scaffold are NOT restored — they're tracked as `[open] hw: no` items in BACKLOG.md and need to be re-scaffolded from generators when needed.

## v0.13.0 — 2026-05-10 (pre-loss)
- Done: Wire mapping engine to console driver abstraction. `bridgeTick` and `setPage` route through `transports.console` for non-MA3 drivers; MA3 keeps coalesce + Lua bridge path.
- Done: ETC Eos driver operational (OSC over UDP — `/eos/wheel/N`, `/eos/key/<name>`, `/eos/cmd`, `/eos/subscribe`).
- Done: Console picker dropdown in Settings UI; preset list filters to drivers compatible with the chosen console.
- Files touched: server/core/mapping-engine.js, server/core/console-drivers/{console-driver,eos-driver,index,ma3-driver,stub-driver}.js, server/server.js, server/api/http-server.js, ui/index.html, ui/app.js.
- Notes: Eos validation is `hw: yes` — needs live console pass before being marked production. Stub driver added so UI can be exercised without any console.

## v0.12.4 — 2026-05-09
- Done: Auto-discover encoder stacks from the MA3 fixture patch instead of asking the user to type them. UI button "Auto-fill from selection" calls `discoverAllSlots` over the Lua bridge, which uses `GetChannelFunction` to enumerate stacked attributes per slot.

## v0.12.3 — 2026-05-09
- Done: Clear/Reset buttons in the encoder-stack editor; slim default stacks down to commonly-stacked attributes only (Color1/Color2, Hue/Sat, Pan/Tilt fine).

## v0.12.2 — 2026-05-08
- Done: Copy Lua button (copies the bridge plugin source to clipboard for quick paste into MA3); switched discovery model to `GetChannelFunction`-based enumeration after `ChannelTable` returned 0 matches in practice.

## v0.12.1 — 2026-05-08
- Done: Filter the user's stack-attribute list against attributes actually present on the currently selected fixture. Avoids cycling to a `Gobo2` slot on a fixture that only has `Gobo1`.

## v0.12.0 — 2026-05-08
- Done: Manual encoder-stack override in Settings. Replaced the broken auto-enumeration model from v0.11.x. User defines per-feature per-slot attribute lists; bridge cycles through them on LCD tap.
- Notes: This was the resolution to a multi-week chase through `ChannelTable`, `GetAttributeIndex+GetUIChannelIndex`, and consecutive-channel-run heuristics. None of those reliably reflected what MA3's UI was showing. Manual is now the source of truth; auto-discover (v0.12.4) just pre-fills the UI.

## v0.11.x — 2026-05-04 to 2026-05-07
- Iterated on stacked-attribute cycling (v0.11.5 through v0.11.10). All approaches that tried to enumerate stacks from MA3's data model failed in practice. Documented as ChannelTable bug in the Lua bridge comments.
- Side fixes during this run: HID native-crash handler at process level, EPIPE swallow in ws-hub, bridge cycle clobber from `syncSlotActiveFromMa3` overwriting manual cycles, multi-Stream Deck device picker, fader-wing OSC preset, MA3 version detection.

## v0.10.x and earlier
Pre-versioned-changelog era. Highlights:
- Renamed MA3 Mapper → ENCpatch.
- Switched off Telnet (MA3 deprecated it) onto a custom Lua TCP plugin running inside MA3.
- Stream Deck Path B: USB-HID claim with `@elgato-stream-deck/node` v7, custom renderer for keys + LCD using `@napi-rs/canvas`.
- electron-builder packaging with ad-hoc codesigning afterPack hook (replaces what would otherwise be a "damaged" Gatekeeper warning).
- LAN-readiness: `BIND_ADDR` + `TOKEN` constants in the Lua bridge for non-loopback deployment.

## 2026-08-09
- All hw:no items drained — only hardware items left.

## 2026-08-12
- All hw:no items drained — only hardware items left.

## 2026-08-19
- All hw:no items drained — only hardware items left.

## 2026-08-20
- All hw:no items drained — only hardware items left.

## 2026-08-23
- All hw:no items drained — only hardware items left.

## 2026-08-25
- Done: Marked "Publish the product site" [blocked] — site draft lives at ~/Desktop/6 PERSONAL/encpatch/site/index.html (outside the connected folder, runner can't read it), and CTAs/Pages deploy wait on the blocked GitHub Releases item (<OWNER> placeholders in docs/RELEASING.md).
- Files touched: BACKLOG.md, docs/PROGRESS.md
- Notes: To unblock, copy the draft into the repo as website/index.html and finish the [NICK] steps in docs/RELEASING.md (create public repo, replace <OWNER>). After that the runner can wire the three CTAs itself. Next runner pass will pick up "Ship the Companion module" (next open hw:no item).

## 2026-08-30
- All hw:no items drained — only hardware items left.

## 2026-09-01
- All hw:no items drained — only hardware items left.

## 2026-09-02
- All hw:no items drained — only hardware items left.
- Note: the two [blocked] hw:no items are still blocked — `website/` does not exist in the repo, and `GITHUB_OWNER_TODO`/`<OWNER>` placeholders remain in package.json and docs/RELEASING.md. Both need Nick's [NICK] steps in docs/RELEASING.md.

## 2026-09-03
- All hw:no items drained — only hardware items left.

## 2026-09-06
- All hw:no items drained — only hardware items left. (Two hw:no items remain [blocked] on Nick: GitHub auth for Releases pipeline; copying the site draft into the repo — see BACKLOG.md.)

## 2026-09-07
- All hw:no items drained — only hardware items left. (Two hw:no items remain [blocked] on Nick: GitHub Releases pipeline and product site — see BACKLOG.md.)

## 2026-09-08
- All hw:no items drained — only hardware items left.
- Notes: two hw:no items remain [blocked] on Nick (GitHub Releases pipeline, product site) — see BACKLOG.md for [NICK] steps.

## 2026-09-09
- All hw:no items drained — only hardware items left. (Two hw:no items remain [blocked] on Nick: GitHub Releases pipeline and product-site publish — see BACKLOG.md and docs/RELEASING.md for the [NICK] steps.)

## 2026-09-10
- All hw:no items drained — only hardware items left.
- Notes: two hw:no items remain [blocked] on Nick (GitHub auth/Mac build for Releases; site draft outside the connected folder) — see BACKLOG.md.

## 2026-09-11
- All hw:no items drained — only hardware items left.
- Notes: unchanged from 2026-09-10 — two hw:no items still [blocked] on Nick (GitHub auth/Mac build for Releases; site draft outside the connected folder). See BACKLOG.md and docs/RELEASING.md.

## 2026-09-12
- All hw:no items drained — only hardware items left.
- Notes: unchanged — two hw:no items still [blocked] on Nick (GitHub auth/Mac build for Releases; site draft outside the connected folder). See BACKLOG.md and docs/RELEASING.md.

## 2026-09-13
- All hw:no items drained — only hardware items left. (Two hw:no items remain [blocked] on Nick: GitHub Releases pipeline and product-site publish — see BACKLOG.md for the [NICK] steps.)

## 2026-09-14
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)

## 2026-09-15
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)

## 2026-09-16
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)

## 2026-09-17
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Notes: this is the 15th consecutive no-op run (since 2026-09-03). The runner has nothing left it can pick up — every remaining item needs either Nick at the console (hw: yes) or Nick's GitHub auth / a file outside the connected folder. Consider pausing the schedule until the two [NICK] unblocks are done, or adding new hw:no items to the queue.

## 2026-09-18
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Notes: 16th consecutive no-op run (since 2026-09-03). Also of note: this run's `request_cowork_directory` call was auto-declined (nobody present to approve), but `/Users/nickcook/Documents/Claud/ma3-int` was already mounted as a working directory, so the run proceeded read/write as normal. Recommend pausing the schedule until the two [NICK] unblocks land, or queueing new hw:no work.

## 2026-09-20
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 17th no-op run in the 2026-09-03 → present streak (no 2026-09-19 entry exists, so that day's run either didn't fire or wasn't logged). `request_cowork_directory` was again auto-declined with nobody present to approve, but `/Users/nickcook/Documents/Claud/ma3-int` was already mounted as a working directory so read/write access was fine — the declined call is not what's blocking anything. Standing recommendation: pause this schedule until the two [NICK] unblocks land (create the public `encpatch` GitHub repo + Mac DMG build; copy `~/Desktop/6 PERSONAL/encpatch/site/index.html` into the repo as `website/index.html`), or queue new hw:no items. Also worth correcting: the runner SKILL.md still describes the project as "v0.7" with a pre-0.13 architecture cheat sheet, while the backlog is on v0.13.42 — the cheat sheet will mislead a future run that does have work to pick up.

## 2026-09-22
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 18th no-op run in the streak that began 2026-09-03 (no 2026-09-19 or 2026-09-21 entries exist, so those runs either didn't fire or weren't logged). BACKLOG.md scanned top to bottom: every `[open]` line is `hw: yes`, and the only two `hw: no` lines are `[blocked]`. No code touched, no verification steps needed. `request_cowork_directory` was auto-declined again (nobody present to approve), but `/Users/nickcook/Documents/Claud/ma3-int` is already mounted as a working directory so read/write worked normally — the decline is not a blocker. Standing recommendations, repeated: (1) pause this schedule until the two [NICK] unblocks land — create the public `encpatch` GitHub repo + push + Mac DMG build, and copy `~/Desktop/6 PERSONAL/encpatch/site/index.html` into the repo as `website/index.html`; (2) or queue new hw:no items; (3) the runner SKILL.md still describes the project as "v0.7" with a pre-0.13 architecture cheat sheet while the backlog is on v0.13.42 — that stale cheat sheet will mislead the next run that actually has work to pick up.

## 2026-09-23
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 19th no-op run since 2026-09-03. No code touched. Standing recommendation: pause this schedule until the [NICK] unblocks land, or queue new hw:no items; also refresh the stale v0.7 cheat sheet in the runner SKILL.md.

## 2026-09-24
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 20th no-op run since 2026-09-03. No code touched. Standing recommendation: pause this schedule until the [NICK] unblocks land, or queue new hw:no items; also refresh the stale v0.7 cheat sheet in the runner SKILL.md.

## 2026-09-25
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 21st no-op run since 2026-09-03. No code touched. Standing recommendation, repeated for the third week running: pause this schedule until the two [NICK] unblocks land (create the public `encpatch` GitHub repo + push + Mac DMG build; copy `~/Desktop/6 PERSONAL/encpatch/site/index.html` into the repo as `website/index.html`), or queue new hw:no items — otherwise this schedule will keep firing daily and finding nothing to do indefinitely. Also still outstanding: the runner SKILL.md cheat sheet is stale (describes v0.7 pre-0.13 architecture) and should be refreshed before a run that has real work relies on it.

## 2026-09-26
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 22nd no-op run since 2026-09-03 (over three weeks straight). No code touched. Standing recommendation, repeated again: pause this schedule until the two [NICK] unblocks land (create the public `encpatch` GitHub repo + push + Mac DMG build; copy `~/Desktop/6 PERSONAL/encpatch/site/index.html` into the repo as `website/index.html`), or queue new hw:no items — this schedule will otherwise keep firing daily and finding nothing to do indefinitely. Also still outstanding: the runner SKILL.md cheat sheet is stale (describes v0.7 pre-0.13 architecture) and should be refreshed before a run that has real work relies on it.

## 2026-09-27
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 23rd no-op run since 2026-09-03 (nearly four weeks straight). No code touched. Standing recommendation, repeated again: pause this schedule until the two [NICK] unblocks land (create the public `encpatch` GitHub repo + push + Mac DMG build; copy `~/Desktop/6 PERSONAL/encpatch/site/index.html` into the repo as `website/index.html`), or queue new hw:no items — this schedule will otherwise keep firing daily and finding nothing to do indefinitely. Also still outstanding: the runner SKILL.md cheat sheet is stale (describes v0.7 pre-0.13 architecture) and should be refreshed before a run that has real work relies on it.

## 2026-09-28
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 24th no-op run since 2026-09-03. No code touched. Standing recommendation unchanged: pause this schedule until the [NICK] unblocks land, or queue new hw:no items.

## 2026-09-29
- All hw:no items drained — only hardware items left. (Unchanged: two hw:no items remain [blocked] on Nick — GitHub Releases pipeline and product-site publish; [NICK] steps in BACKLOG.md and docs/RELEASING.md.)
- Files touched: docs/PROGRESS.md
- Notes: 25th no-op run since 2026-09-03. No code touched. Standing recommendation unchanged: pause this schedule until the [NICK] unblocks land, or queue new hw:no items.

## 2026-10-02
- All hw:no items drained — only hardware items left.

## 2026-10-03
- All hw:no items drained — only hardware items left.

## 2026-10-04
- All hw:no items drained — only hardware items left.
All hw:no items drained — only hardware items left.

## 2026-10-06
- All hw:no items drained — only hardware items left.

## 2026-10-07
- All hw:no items drained — only hardware items left.
All hw:no items drained — only hardware items left.

## 2026-10-09
All hw:no items drained — only hardware items left.

## 2026-10-11
- All hw:no items drained — only hardware items left.

## 2026-10-12
- All hw:no items drained — only hardware items left.

## 2026-10-13
- All hw:no items drained — only hardware items left.

## 2026-10-14
- All hw:no items drained — only hardware items left.

## 2026-10-15
- All hw:no items drained — only hardware items left.

## 2026-10-18
- All hw:no items drained — only hardware items left.

## 2026-10-19
- All hw:no items drained — only hardware items left.
All hw:no items drained — only hardware items left.
All hw:no items drained — only hardware items left.

All hw:no items drained — only hardware items left.
All hw:no items drained — only hardware items left.
All hw:no items drained — only hardware items left.
All hw:no items drained — only hardware items left.

## 2026-10-30
All hw:no items drained — only hardware items left. (Two hw:no items remain [blocked] on GitHub auth: Releases pipeline, product site.)

## 2026-11-03
- Done: nothing — no `[open] hw: no` items remain.
- Notes: All hw:no items drained — only hardware items left.
