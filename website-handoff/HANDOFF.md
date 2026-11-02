# ENCpatch → Website Handoff Brief

You are helping Nick add an ENCpatch product page to his EXISTING personal website.
This folder is self-contained — everything you need to write the page is here. Do not
invent product facts; everything claimable is in this file and the two reference docs.

## First: ask Nick these before touching anything

1. Where does the website live? Ask him to connect that folder (or point you at the
   repo/host). Match the site's existing stack, style, and nav exactly — this is a page
   ADDED to his site, not a redesign.
2. How is it deployed (static host, GitHub Pages, Netlify, CMS…)? Follow the site's
   existing deploy path.
3. Where should downloads live? ENCpatch currently ships as a friend-shared zip
   (`ENCpatch-vX.Y.Z.zip` containing a DMG + Read Me). There is no public download
   host yet. Options to offer Nick: GitHub Releases link, a hosted file on the site,
   or a "request a build" email link. Do NOT fabricate a download URL.
4. Is the page free-download, paid, or "in beta — contact me"? Not decided as of this
   writing. Ask.

## What ENCpatch is (the true facts)

- Mac desktop app (Electron) that turns an Elgato Stream Deck Plus into a live control
  surface for lighting consoles. The four physical encoders + LCD strip on the deck
  mirror the console's encoder bar in real time.
- The killer feature (grandMA3): zero-configuration mirroring. Select any fixture in
  MA3, and the deck's wheels + LCD labels follow whatever is on MA3's encoder bar —
  any fixture type, any feature group, any page. Tap the LCD to cycle stacked
  attributes (Color1 / Color1WheelSpin etc.). As of v0.13.42 it also follows MA3's
  sub-pages within a feature group.
- Works via a companion Lua plugin that runs inside grandMA3 onPC (TCP, localhost).
  One-time import; the app serves the plugin file itself and shows a green status dot
  when connected.
- ETC Eos support (v0.13.0+): pure OSC over UDP. Two modes — mirror a Custom Encoder
  Map (Eos Tab 40) or fixed per-encoder parameters. Category keys, keypad, and common
  hardkeys on the deck's buttons. Ion/Nomad layouts included.
- Web UI at http://127.0.0.1:8733 for mapping editor, encoder stacks, console picker,
  live diagnostics. Also accepts OSC from TouchOSC / fader wings / Companion.
- Open source, MIT license. Name origin: "ENC" = encoders (the hard problem solved),
  "patch" = assigning physical wheels to console functions.

## Claims policy — IMPORTANT, do not oversell

- grandMA3 onPC: PRODUCTION. Safe to present as the flagship.
- ETC Eos: OPERATIONAL but not yet validated on a live console — say "Eos support
  (beta)" or similar, never "fully supported".
- Onyx, Avolites Titan, Hog 5, ChamSys MagicQ, Vista 3: driver scaffolds exist but are
  UNTESTED. Say "planned / experimental" at most, or omit.
- Requirements (state plainly on the page): Apple Silicon Mac only (no Intel, no
  Windows). grandMA3 onPC 2.0+. Stream Deck Plus recommended (other Stream Decks work
  for buttons, but encoders are the point). Elgato's own Stream Deck app must be quit
  while ENCpatch runs.
- The app is ad-hoc signed (no paid Apple Developer cert): first launch needs
  `xattr -cr /Applications/ENCpatch.app`. The install guide covers it — the page's
  install section MUST mention it or users will think the download is broken.
- Current version: v0.13.42.

## What's in this folder

- `HANDOFF.md` — this file.
- `COPY.md` — draft page copy (hero, features, how-it-works, install, FAQ). Adapt the
  voice to match the rest of Nick's site; the facts must stay as-is.
- `ASSETS.md` — checklist of screenshots/media to request from Nick. Don't ship the
  page with stock photos of consoles; ask him for real captures.
- `reference/README-copy.md`, `reference/INSTALL-copy.md` — snapshots of the project's
  README and user install guide, the source of truth for any detail not in COPY.md.

## Suggested page structure

Hero (one-liner + deck photo/GIF) → "How it works" (3 steps: plug in deck → import
plugin → wheels follow MA3) → Feature grid → Console support table (with honest
status column) → Requirements → Install (link or inline, incl. the xattr note) →
FAQ → Download/contact CTA (per Nick's answer to question 3/4 above).
