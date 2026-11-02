# ENCpatch — Draft Page Copy

Adapt tone to match the rest of the site. Facts are fixed; wording is flexible.

## Hero

**ENCpatch**
Real encoders for grandMA3 onPC.

Plug in a Stream Deck Plus and its four wheels become your console's encoder bar —
live labels on the LCD strip, any fixture, any page, zero configuration.

CTA: [Download for Mac] (Apple Silicon · free · MIT-licensed)
     ← placeholder, confirm download destination + pricing with Nick

## The pitch (short paragraph)

Running grandMA3 onPC without a wing means programming moving lights with a mouse.
ENCpatch gives you back physical wheels: a Stream Deck Plus on your desk mirrors
MA3's encoder bar in real time. Select a fixture and the deck's LCD strip shows
exactly what MA3 shows — Pan and Tilt, Color mixing, Gobo wheels — and turning a
knob drives that attribute on the console. Change feature groups, flip sub-pages,
swap fixture types: the wheels follow. No per-fixture setup, no mapping files.

## Feature list

- **Live encoder bar mirroring (grandMA3)** — the deck's 4 wheels and LCD labels
  track MA3's encoder bar automatically, including feature-group changes and
  sub-pages. What the label says is what the wheel drives.
- **Stacked attribute cycling** — tap an encoder's LCD cell to cycle stacked
  attributes (Color wheel → wheel spin → shake…), with an auto-discover that reads
  your actual patched fixtures.
- **Feature-group keys** — the deck's 8 buttons page between Dimmer / Position /
  Color / Gobo / Beam and friends.
- **ETC Eos support (beta)** — pure OSC. Mirror a Custom Encoder Map (Tab 40) or pin
  four parameters to the wheels; Ion and Nomad key layouts included.
- **Open OSC in and out** — TouchOSC, fader wings, and Bitfocus Companion can drive
  ENCpatch's mappings too.
- **Everything editable in a local web UI** — mappings, encoder stacks, console
  choice, live diagnostics at 127.0.0.1:8733. No cloud, nothing leaves your machine.
- **Free and open source** — MIT license.

## How it works (3 steps)

1. **Plug in** a Stream Deck Plus (quit Elgato's app first — ENCpatch drives the
   deck directly over USB).
2. **Import the bridge plugin** into grandMA3 onPC — one paste, one double-click.
   ENCpatch's status dot goes green when MA3 answers.
3. **Grab a fixture and turn a wheel.** The LCD strip is already showing MA3's
   encoder bar.

## Requirements

- Apple Silicon Mac (M1 or newer). Intel Macs and Windows are not supported.
- grandMA3 onPC 2.0 or newer (same Mac), or an Eos-family console/Nomad on the
  network with OSC enabled (TX port 8002).
- Elgato Stream Deck Plus recommended; other Stream Decks work for buttons only.

## Console support table

| Console | Status |
|---|---|
| grandMA3 onPC | Supported — flagship |
| ETC Eos / Ion / Nomad | Beta (OSC) |
| Onyx · Titan · Hog 5 · MagicQ · Vista 3 | Experimental scaffolds — not validated |

## Install note (must appear near the download)

ENCpatch is independently developed and not App Store-signed. After copying it to
Applications, run this once in Terminal, then open it normally:

    xattr -cr /Applications/ENCpatch.app

macOS otherwise shows a false "app is damaged" warning. Full guide: link to the
install guide (reference/INSTALL-copy.md has the complete text).

## FAQ drafts

**Does it work on Windows?** No — macOS on Apple Silicon only, for now.

**Do I need a Stream Deck Plus specifically?** For the encoders, yes — that's the
whole point. Regular Stream Decks can still run the button/key layouts.

**Does it work with a real grandMA3 console?** It's built and tested against
grandMA3 onPC on the same Mac. The bridge plugin can bind to a LAN address with a
token for remote setups, but console-hardware workflows aren't the target.

**Why does macOS say the app is damaged?** It isn't — that's Gatekeeper reacting to
an unsigned indie app. The one-line `xattr` command above fixes it permanently.

**Is my show data sent anywhere?** No. Everything runs locally: USB to the deck,
localhost TCP to MA3, LAN OSC to Eos. No accounts, no telemetry.

**What does it cost?** ← ask Nick; do not publish until confirmed.
