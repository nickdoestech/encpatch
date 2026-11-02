# ENCpatch Backlog

Format the autonomous runner expects (do not change without updating `~/Documents/Claude/Scheduled/ma3-mapper-backlog-runner/SKILL.md`):

- `[open]` — pickable
- `[in_progress]` — claimed by a runner pass
- `[done]` — finished
- `[blocked]` — runner couldn't proceed; reason follows on next line

`hw: no` items are pickable by the unattended runner. `hw: yes` items require Nick to be physically at a Stream Deck / MA3 / Eos console and are skipped by the runner.

---

## Active queue

- [open] hw: yes — Validate v0.13.43 on real MA3 onPC: sub-page encoder-bar follow (0.13.42 code) + sub-page-aware LCD-tap stack cycling (0.13.43), combined with the post-refactor user-acceptance pass (one sitting at the deck). Checklist: (1) build + install 0.13.43 (`npm run dist:mac && npm run share`), re-import ENCpatchMA3Bridge.lua 0.13.43 in MA3 — versions must match or page-binder flags oldBridge and skips getEncoderBar; (2) select a mover, flip Position to page 2 — LCD should show X Focus / Y Focus / Z Focus / Position MSpeed and the wheels should drive them; (3) tap an LCD cell on page 2 — it must cycle within that page's attribute stack, NOT snap back to Pan (the pre-0.13.43 bug); on page 1 the configured stacks (e.g. Pan → Pan_Phaser) should cycle as before; (4) if slots still read page 1, run `echo '{"id":1,"action":"probeEncoderBar"}' | nc -w 2 127.0.0.1 9001 > probe_pageN.json` on page 1 AND page 2 and diff (plain `nc` without -w exits before the reply — that's why the Aug probe files are 0 bytes); `setBarMode {mode:"legacy"}` reproduces pre-0.13.42 for A/B; (5) acceptance: encoder cycling on real fixtures still works with console-driver routing as the primary path — feature-group keys, manual stickies clearing on page flip.
- [in_progress] hw: no — GitHub Releases pipeline: stand up the public GitHub home for ENCpatch releases, cut a v0.13.43 release with the `npm run share` zip (DMG + Read Me) attached, point the auto-updater's GitHub check at that repo, and record the canonical Releases URL for the website CTAs.
  Unblocked 2026-11-02: owner confirmed (`nickdoestech`) and filled into package.json build.publish (auto-updater guard now disarms on real builds) and docs/RELEASING.md. Everything is scripted in `scripts/release-v0.13.43.command` — repo create + push, `dist:mac` + `share`, release v0.13.43 with all updater assets, GitHub Pages enable. [NICK] one double-click of that script (it signs into GitHub in the browser on first run). Mark [done] once the release page is live.
- [in_progress] hw: no — Publish the product site.
  Unblocked 2026-11-02: the approved draft was copied from `~/Desktop/6 PERSONAL/encpatch/site/index.html` into the repo as `docs/index.html` (GitHub Pages only serves `/` or `/docs`, so `docs/` beats the planned `website/`), version bumped to 0.13.43, and all three placeholder CTAs replaced with the canonical URLs (hero + footer → `releases/latest/download/ENCpatch-macOS.zip`, install link → `blob/main/INSTALL.md`, plus a source link in the page footer). Goes live at https://nickdoestech.github.io/encpatch/ when the release script enables Pages. Mark [done] once it loads.
- [done] hw: no — Ship the Companion module: take `companion-module/` from polished scaffold to an installable distributable — package per Bitfocus module tooling, README with install steps, version aligned with the app. Sideload-ready is the bar; Bitfocus registry submission is an optional follow-up.
- [open] hw: yes — Eos: complete the 5-test live validation (encoder tick, softkey, /eos/cmd line, subscribe state read, panic). Mark v0.13.x production once green.
- [open] hw: yes — Live-test the Onyx / Titan / Hog / MagicQ / Vista driver scaffolds against real consoles; correct any address mismatches uncovered.
- [done] hw: no — Setup wizard: detect missing Input Monitoring permission on launch and surface a clickable "Open System Settings → Privacy → Input Monitoring" deep-link instead of failing silently. Keep the permissions-assistant.html UI; just wire the auto-detection.
- [done] hw: no — Per-fixture-type encoder-stack profiles: when the user defines stacks while a "MAC Aura" is selected, scope those stacks to that fixture type. Auto-recall when any MAC Aura is selected. Storage: `config.encoderStacks.byFixtureType[fixtureType] = { feature: { slot: [...attrs] } }`.
- [done] hw: no — Settings tab: surface the v0.13.1 console picker in addition to the welcome modal version, so users who skip welcome can still switch consoles. Hot-reload is now wired in `/api/settings` so it's just a UI rendering change.
- [done] hw: no — `companion-module/` scaffold exists (v0.13.1) but needs polish: encoder feedback (subscribe to `/api/state`'s console.connected for green-dot-on-button), variable definitions for current console name + version, presets folder.
- [done] hw: no — `streamdeck-plugin/` scaffold exists (v0.13.1) but needs icons and a packaging pass through `streamdeck pack`. Sideload-only until we have an Elgato Marketplace cert. [runner: recovered orphaned in_progress 2026-05-26 — icons were already complete; finished the packaging pass via `npm run pack:streamdeck`]

## Hardware-only follow-ups (runner won't touch)

- [open] hw: yes — Validate auto-discover against a non-MA3 fixture profile on real hardware (currently only tested with MAC Aura).
- [open] hw: yes — Hand the v0.13.0 zip to a friend who has Eos Nomad and confirm encoder ticks land on `/eos/wheel/N`.

## Done (recent)

- [done] v0.13.1 — Eos-aware welcome modal (console picker + host/port form), hot-reload of console driver on `/api/settings` change, `ma3lua → ma3` legacy console-id migration, real driver scaffolds for Onyx/Titan/Hog/MagicQ/Vista (replacing stubs in registry), `bridgeTick`/`setPage` routing tests in `mapping-engine.test.mjs`, Companion module + native Stream Deck plugin scaffolds.
- [done] v0.13.0 — wire engine to console driver, make Eos operational
- [done] v0.12.4 — auto-discover encoder stacks from MA3 fixture patch
- [done] v0.12.3 — Clear/Reset buttons + slim default stacks
- [done] v0.12.2 — Copy Lua button + GetChannelFunction-based discovery
- [done] v0.12.1 — filter user's stack list to attributes actually on the fixture
- [done] v0.12.0 — manual encoder stack override (replaced broken auto-enumeration)
- [done] Recover project source after another chat session wiped the working folder. Source extracted from /Applications/ENCpatch.app/Contents/Resources/app.asar via @electron/asar.
