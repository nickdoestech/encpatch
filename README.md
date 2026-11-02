# ENCpatch

Encoder-driven control patching for grandMA3 — and, increasingly, other consoles. Originally "MA3 Mapper". Re-named because the hard problem we solved is the encoders, and "patching" was the closest word for what the user actually does (assigning physical knobs to console functions).

The short version: plug an Elgato Stream Deck Plus into your Mac, run ENCpatch, and the four physical encoders on the deck mirror whatever's on grandMA3's encoder bar — for any fixture, on any page, with no per-fixture configuration. Tap the LCD strip to cycle stacked attributes (Color1/Color2/Hue/Sat, etc.). Other consoles (ETC Eos as of v0.13.0; Onyx, Avolites, Hog 5, ChamSys MagicQ, Vista 3 planned) hook in through a driver abstraction without you having to relearn the workflow.

## What ships

- **macOS .app bundle** (`dist:mac` → DMG via electron-builder, ad-hoc codesigned in `build/afterPack.js`)
- **MA3 Lua bridge plugin** (`docs/ma3-plugin/ENCpatchMA3Bridge.lua` — versioned, downloadable from the running app at `/api/bridge/ma3.lua`)
- **Web UI** at `http://127.0.0.1:8733` for everything: mapping editor, encoder stack editor, console picker, live diagnostics

## How the pieces fit

```
  Stream Deck Plus              ENCpatch (Electron)              grandMA3 onPC
  ┌───────────────┐    USB-HID    ┌────────────────────┐    TCP 9001    ┌─────────────────┐
  │ 4 encoders +  │ ────────────► │ MappingEngine      │ ─────────────► │ Lua bridge plugin│
  │ LCD strip +   │ ◄──────────── │  ↳ ConsoleDriver   │ ◄───────────── │  (Object-Free   │
  │ 8 keys        │   renderer    │     (ma3 / eos /…) │    JSON wire   │   API: 2.0+)    │
  └───────────────┘               └────────────────────┘                └─────────────────┘
                                          ▲
                                          │ OSC
                                          ▼
                                  ┌────────────────────┐
                                  │ Other OSC senders  │
                                  │ (TouchOSC, fader   │
                                  │  wings, Companion) │
                                  └────────────────────┘
```

`MappingEngine` accepts triggers (OSC, Stream Deck buttons, encoder ticks) and dispatches actions (`bridgeTick`, `cmd`, `osc`, `setPage`, `multi`). For non-MA3 consoles the dispatch flows through the active `ConsoleDriver` which translates to that console's wire format.

## Install (for users, not devs)

See [`INSTALL.md`](./INSTALL.md). Friend-shareable build is `~/Desktop/ENCpatch-vX.Y.Z.zip` after `npm run dist:mac && npm run share`.

## Develop

```sh
npm install
npm run dev:electron      # windowed app, hot reload via --watch
# or
npm run start             # bare Node server, no Electron, no Stream Deck capture
```

Then open http://127.0.0.1:8733/ in a browser.

### Build a shareable DMG

```sh
npm run dist:mac          # → dist/ENCpatch-X.Y.Z-arm64.dmg (signed ad-hoc)
npm run share             # → ~/Desktop/ENCpatch-vX.Y.Z.zip (DMG + Read Me)
```

Builds are Apple Silicon only by default. Intel Macs not supported.

### Run the test suite

```sh
npm test
```

## Project layout

```
.
├── electron/             Electron main process (main.js, preload, permissions assistant, auto-updater)
├── server/               Node HTTP + WebSocket + mapping engine
│   ├── api/              http-server.js (routes), ws-hub.js (live state push)
│   └── core/             config-store, osc-client, mapping-engine, ma3lua-client,
│                         streamdeck-hid, streamdeck-renderer, page-binder, diagnostics,
│                         ma3-command-formatter, console-drivers/{console,ma3,eos,stub,index}
├── ui/                   Vanilla JS web UI (no build step)
├── data/                 Bundled console layouts, presets, attribute lookup
├── docs/
│   └── ma3-plugin/       ENCpatchMA3Bridge.lua (TCP server, runs inside MA3)
├── build/                electron-builder hooks (afterPack.js does ad-hoc signing)
├── scripts/              package-share.js (DMG → Desktop zip)
├── BACKLOG.md            Pending work (the runner skill reads this)
├── docs/PROGRESS.md      Per-version changelog
├── INSTALL.md            User-facing install guide
└── package.json          Includes electron-builder config + signing hook
```

## Console support

| Console        | Status       | Transport                  | Notes                                                            |
|----------------|--------------|----------------------------|------------------------------------------------------------------|
| grandMA3 onPC  | Production   | TCP+JSON via Lua plugin    | Object-Free API, MA3 2.0+. Encoder bar mirrored, stacks editable |
| ETC Eos family | Operational  | OSC over UDP               | Wired in v0.13.0. Awaits live validation against Nomad / console |
| Onyx           | Planned      | (TBD — likely OSC)         | Driver scaffold not yet started                                  |
| Avolites Titan | Planned      | (TBD — Titan API or OSC)   | Driver scaffold not yet started                                  |
| Hog 5          | Planned      | (TBD — OSC + Hognet maybe) | Driver scaffold not yet started                                  |
| ChamSys MagicQ | Planned      | OSC                        | Driver scaffold not yet started                                  |
| Vista 3        | Planned      | (TBD)                      | Driver scaffold not yet started                                  |

## License

MIT
