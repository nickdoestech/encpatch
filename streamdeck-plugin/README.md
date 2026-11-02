# ENCpatch — Native Stream Deck Plugin

This is the Elgato-native Stream Deck plugin scaffold. It's an alternative path to using ENCpatch's USB-HID Path B (which claims the Stream Deck for exclusive access). The plugin sends actions to a running ENCpatch desktop app over HTTP.

## Status

Manifest, plugin entry, property inspector, and the full icon set are wired. The bundle is **sideload-only** until we have an Elgato Marketplace signing cert.

### Packaging

Produce the sideloadable `com.encpatch.bridge.streamDeckPlugin` with:

```
npm run pack:streamdeck
```

That runs `scripts/pack-streamdeck.js`, which validates every asset the manifest references (icons, `@2x` variants, code paths) and then zips `com.encpatch.bridge.sdPlugin` into the `.streamDeckPlugin` file beside it. It only needs the `zip` binary (preinstalled on macOS and Linux) — no proprietary tooling.

If you have Elgato's official CLI (`npm install --global @elgato/cli`) you can instead run `streamdeck pack streamdeck-plugin/com.encpatch.bridge.sdPlugin`; both produce an equivalent unsigned bundle.

### Icons

The `icons/` folder is complete:
- `plugin` / `category` — 28×28 (56×56 @2x)
- `state-encoder` / `state-bank` / `state-cmd` — 72×72 (144×144 @2x)
- `action-encoder` / `action-bank` / `action-cmd` — 256×256 (512×512 @2x)

Source for the plugin/category glyphs is ENCpatch's `electron/icon-512.png`.

## Signing

Elgato's Marketplace requires plugins to be signed. For local-only use you can sideload the unsigned plugin by double-clicking the produced `.streamDeckPlugin`.

## How it works

```
Stream Deck    →   plugin.js    →   HTTP POST /api/inject   →   ENCpatch    →   Console (MA3 / Eos / etc.)
                  (Node.js)         (action: { type, ... })       (engine)         (driver)
```

The plugin doesn't speak any console-specific protocol. It only knows how to forward action payloads to ENCpatch, which already abstracts every supported console behind a common driver interface.
