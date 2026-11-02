# ENCpatch — Bitfocus Companion module

This is the Companion-side half of the ENCpatch ↔ Companion bridge. It talks HTTP to a running ENCpatch desktop app (`/api/inject`, `/api/state`), so a Companion button can trigger any of ENCpatch's mapping-engine actions (`bridgeTick`, `setPage`, `cmd`) without Companion knowing anything about the target console — ENCpatch is the abstraction layer.

See `companion/HELP.md` for the in-Companion help text (actions, config fields, status colors).

## Status

Sideload-ready. Built against `@companion-module/base` v2 / `@companion-module/tools` v3 — Companion's current module generation (Node 22 runtime, `nodejs-ipc` host API). Bitfocus Marketplace submission is an optional follow-up (needs a public repo + review, see `docs/RELEASING.md` for the pattern ENCpatch itself is using).

## Building the sideloadable package

Requires Node ≥22.18 (matches the rest of ENCpatch's toolchain).

```
cd companion-module
npm install
npm run build
```

This produces `encpatch-<version>.tgz` — a distributable package with a manifest, bundled `main.js`, and the `companion/` assets (help text + presets). The version is pulled from `package.json` and baked into the built manifest automatically.

### Installing the built package in Companion

1. Companion → **Modules** (or **Import Custom Module**, depending on Companion version) → **Import module package**.
2. Select `companion-module/encpatch-<version>.tgz`.
3. Add an ENCpatch connection, set host/port (default `127.0.0.1:8733` — same machine as ENCpatch), and you're wired up.

### Developing without a full build

`npm run dev` runs the same build unminified with inline source maps, for faster iterate-and-reload cycles. Companion's dev-module loading still expects the built `pkg/encpatch/` output, not raw source — there's no live-reload of `main.js` directly.

## What it exposes

- **Actions** — `Encoder tick (bridgeTick)`, `Select encoder bank (setPage)`, `Console command line (cmd)`. All three forward to ENCpatch's `/api/inject`.
- **Variables** — `console_name`, `console_version`, `console_connected` (polled from `/api/state` every 2s).
- **Feedback** — `console_connected` (green when ENCpatch reports the console driver is connected).
- **Presets** — `companion/presets/*.json` ship a few ready-to-adapt example buttons (encoder nudge buttons, page-select buttons, a handful of MA3/Eos command-line examples).

## How it works

```
Companion button  →  main.js (this module)  →  HTTP POST /api/inject  →  ENCpatch  →  Console (MA3 / Eos / etc.)
```

The module doesn't speak any console-specific protocol — it only forwards action payloads to ENCpatch's engine, which already abstracts every supported console behind a common driver interface.

## Notes for maintainers

- `companion/manifest.json`'s `version`, `runtime.apiVersion`, and `runtime.entrypoint` are overwritten at build time from `package.json` and the installed `@companion-module/base` version — the checked-in values are just for readability when browsing the repo.
- `manifest.json`'s `repository`/`bugs` URLs are still placeholders (`<your-fork>`) pending the public GitHub repo — see `docs/RELEASING.md`. Update them once that repo exists so `npm run build`'s baked manifest points somewhere real.
- If you bump `@companion-module/base` past v2.x, re-check `main.js`'s `setVariableDefinitions` call and the rest of the action/feedback/config-field shapes against the new API — v1→v2 changed `setVariableDefinitions` from an array to an object keyed by `variableId`, which is the one breaking change this module already absorbed.
