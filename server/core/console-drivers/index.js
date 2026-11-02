/**
 * Console driver registry.
 *
 * `loadDriver(id, opts, hooks)` returns a driver instance for the
 * console named in config.console (one of: ma3, eos, onyx, titan,
 * hog, magicq, vista, stub). Falls back to MA3 if unknown.
 *
 * `availableDrivers()` returns metadata used by the welcome modal
 * picker — display name, mac compatibility, default port, etc.
 *
 * As of v0.13.1: every entry is a real driver. Onyx/Titan/Hog/MagicQ/
 * Vista are scaffolds — OSC wired, address schemes documented, but not
 * live-tested against real consoles. They WILL connect and emit OSC; the
 * remaining unknown is whether each console's address-tree assumption
 * matches what they actually expose (per-version OSC drift is common).
 */
'use strict';

const Ma3Driver    = require('./ma3-driver');
const EosDriver    = require('./eos-driver');
const OnyxDriver   = require('./onyx-driver');
const TitanDriver  = require('./titan-driver');
const HogDriver    = require('./hog-driver');
const MagicQDriver = require('./magicq-driver');
const VistaDriver  = require('./vista-driver');
const StubDriver   = require('./stub-driver');

const REGISTRY = [
  { id: 'ma3',    cls: Ma3Driver,    tested: true  },
  { id: 'eos',    cls: EosDriver,    tested: false },   // operational, awaiting live validation
  { id: 'onyx',   cls: OnyxDriver,   tested: false },
  { id: 'titan',  cls: TitanDriver,  tested: false },
  { id: 'hog',    cls: HogDriver,    tested: false },
  { id: 'magicq', cls: MagicQDriver, tested: false },
  { id: 'vista',  cls: VistaDriver,  tested: false },
  { id: 'stub',   cls: StubDriver,   tested: true  },   // explicit stub for UI testing
];

function loadDriver(id, opts = {}, hooks = {}) {
  const entry = REGISTRY.find((e) => e.id === id) || REGISTRY[0];   // default to MA3
  if (entry.cls === StubDriver) {
    return new StubDriver({ ...opts, _stubMeta: entry }, hooks);
  }
  return new entry.cls(opts, hooks);
}

function availableDrivers() {
  return REGISTRY.map((e) => {
    const cls = e.cls;
    return {
      id: e.id,
      displayName: cls.displayName,
      macSupported: cls.macSupported,
      defaultPort: cls.defaultPort,
      isStub: cls === StubDriver,
      tested: !!e.tested,
    };
  });
}

module.exports = { loadDriver, availableDrivers };
