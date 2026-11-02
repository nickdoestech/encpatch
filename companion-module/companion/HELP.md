## ENCpatch (Companion module)

This module sends actions to a running ENCpatch desktop app via its HTTP API. ENCpatch then routes those actions through whatever console driver is configured (grandMA3, ETC Eos, Onyx, Titan, Hog, MagicQ, Vista, ...).

### Configuration

- **Host** — the IP of the machine running ENCpatch. Default `127.0.0.1` (same machine as Companion).
- **Port** — ENCpatch's HTTP port. Default `8733`.

### Actions

- **Encoder tick** — send a relative tick (positive = clockwise) to encoder slot 1–4 on whatever console is configured. Equivalent to spinning a Stream Deck Plus encoder.
- **Select encoder bank** — switch the encoder bar to a named feature bank (Dimmer / Position / Color / Beam / Gobo / Focus / Shapers / Control). Falls through to the active console's per-name softkey mapping (e.g. `/eos/key/intens` on Eos).
- **Console command line** — send a raw string to the console's command line (`Cmd` on MA3, `/eos/cmd` on Eos, etc.). Supports Companion variables.

### Status

- Green dot — last action returned 200.
- Yellow dot — ENCpatch responded with a non-2xx status; check ENCpatch's monitor tab.
- Red dot — couldn't reach ENCpatch at all. Verify host/port and that ENCpatch is running.
