# Installing ENCpatch

ENCpatch lets you control grandMA3 onPC from a Stream Deck — every encoder follows whatever's on MA3's encoder bar, no matter the fixture or page. As of v0.13.0 it also speaks OSC to ETC Eos.

## ⚠ Read this first — the "damaged" warning

When you open the app, macOS may say **"ENCpatch is damaged and can't be opened. You should move it to the Trash."**

**The app is not damaged.** macOS shows this warning for any app that wasn't downloaded through the App Store or signed by a paid Apple Developer account. ENCpatch is neither (yet). To fix it, open **Terminal** (Applications → Utilities → Terminal) and paste this exact line:

```
xattr -cr /Applications/ENCpatch.app
```

Press Enter. Now open ENCpatch normally — the warning is gone. You only have to do this once per install.

## What you need

- A Mac with Apple Silicon (M1/M2/M3/M4). Intel Macs are not supported by this build.
- For grandMA3: **grandMA3 onPC version 2.0 or newer** running on the same Mac. (The bridge plugin uses Object-Free APIs that landed in 2.0. On 1.9 or earlier you'll see a `self-check FAILED` line in MA3's System Monitor and no encoder control.)
- For ETC Eos: Eos / Element / Ion / Ti / Nomad on the same network, with OSC enabled in Eos shell → Network → OSC settings. **Set OSC TX Port to 8002, not the default 8001** — ENCpatch's general OSC listener already binds 8001 internally, so the Eos driver uses 8002 to avoid a same-process collision.
- An Elgato Stream Deck — **Stream Deck Plus** strongly recommended (the encoders + LCD strip are the whole point of the app).

## Install

1. Open the .dmg you received. A window pops up showing the ENCpatch icon next to an Applications folder shortcut.
2. **Drag the ENCpatch icon onto the Applications shortcut.** Wait for it to copy.
3. Eject the .dmg (right-click on the desktop → Eject "ENCpatch").
4. Run the `xattr -cr` command above. Skip this and you'll get the "damaged" warning.
5. Open ENCpatch from your Applications folder.

## First launch

The app shows a 3-step welcome screen.

**Step 1: Stream Deck**
Quit the Elgato Stream Deck app first (ENCpatch needs exclusive USB access). Plug in the deck. macOS will prompt you to grant **Input Monitoring** permission — say yes. Re-open ENCpatch. The "Stream Deck" status dot in the welcome screen turns green.

**Step 2: Install the MA3 bridge plugin** *(grandMA3 only — skip if you're using Eos)*
In ENCpatch, click **Copy bridge URL** and paste it into MA3's plugin import dialog (Menu → Plugins → +). Or click **Save Lua…** to save it as a file and import that. Double-click the new plugin row in MA3 to start it. You should see `[ENCpatch] listening on 127.0.0.1:9001` in MA3's System Monitor. The "MA3 bridge" dot in ENCpatch turns green within a second.

**Step 3: Pick a preset**
"Stream Deck Plus → MA3 encoders" is the default. Click **Apply**. Now turn an encoder on the deck and watch MA3's encoder bar move.

## Eos encoder mapping (recommended setup)

Eos's OSC doesn't expose the bottom-strip Encoder Display state, so the SD's 4 encoder labels won't automatically follow when you tap a category on the strip. Two ways to fix:

**Option A — Custom Encoder Map (recommended)**

1. In Eos, open **Tab 40 (Encoder Maps)**.
2. Click **New Map**, name it (e.g., "ENCpatch 4-wheel").
3. Drag the four parameters you want into slots 1–4. Common choices: Intens / Pan / Tilt / Zoom, or Color Select / Color Select 2 / Hue / Saturation, or whatever fits the show.
4. Save the map. Make it active (Tab 40 → set as Default, or press the **{Custom Encoder Map}** softkey).
5. In ENCpatch: **Settings → Console** → check **"Use Custom Encoder Map (Eos Tab 40)"** → Save.

ENCpatch's 4 SD encoders now mirror your custom map. LCD labels reflect what you put in slots 1–4.

**Option B — Fixed parameter mapping**

If you'd rather skip Eos-side setup and just lock each encoder to a specific parameter:

1. ENCpatch **Settings → Console** → **"Fixed encoder parameters (Eos)"** field.
2. Type 4 Eos parameter names separated by commas: `intens, pan, tilt, zoom`
3. Save.

LCD shows those 4 names statically; each encoder always ticks its assigned parameter regardless of Eos's category strip.

Valid parameter names come from Eos's parameter list — find them in **Tab 7 (Virtual Keyboard)** → bottom-right dropdown → "OSC /key Names", or check any patched fixture's parameter columns in the Patch tab.

## Switching consoles (v0.13.0+)

Settings → **Console**: pick `grandMA3` (default), `ETC Eos`, or `Stub` (no console — useful for testing UI changes). For Eos, set the host/port in Settings → Eos. ENCpatch sends `/eos/wheel/<n>` for encoder ticks and `/eos/key/<name>` for softkey selection.

## Troubleshooting

- **"Stream Deck not connecting"**: quit Elgato's Stream Deck app, then re-open ENCpatch.
- **No Input Monitoring prompt appeared**: macOS only asks once. Open System Settings → Privacy & Security → Input Monitoring → toggle ENCpatch on. Restart the app.
- **MA3 bridge keeps disconnecting**: make sure only ONE copy of `ENCpatchMA3Bridge` is loaded as a plugin in MA3. Multiple instances fight over port 9001. Delete the duplicates.
- **Encoders move the wrong attribute**: tap the LCD strip to cycle through stacked attributes for that encoder. Settings → Encoder Stacks → Auto-fill from selection re-discovers what's available on the currently selected fixture.
- **Damaged warning won't go away**: re-run `xattr -cr /Applications/ENCpatch.app`. If you moved the app somewhere else, point the path at the new location.

## Updating

ENCpatch checks GitHub for updates on launch and prompts when one's available. You can also drag a newer DMG onto Applications — macOS will replace the old version. You don't need to re-run `xattr -cr` after an update if the new build was downloaded by the auto-updater (it only triggers on manually-copied apps).
