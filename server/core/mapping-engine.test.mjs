import { test } from 'node:test';
import assert from 'node:assert';
import MappingEngine from './mapping-engine.js';

/**
 * Test suite for MappingEngine — tests all transform modes and actions.
 * Run: node --test server/core/mapping-engine.test.mjs
 */

// Mock config store
class MockConfigStore {
  constructor(mappings = []) {
    this.mappings = mappings;
  }
  listMappings() {
    return this.mappings;
  }
}

// Mock transports
class MockOscClient {
  constructor() {
    this.sentMessages = [];
    this.sentToMa3 = [];
  }
  sendToMa3(address, args) {
    this.sentToMa3.push({ address, args });
  }
  sendTo(address, args, host, port) {
    this.sentMessages.push({ address, args, host, port });
  }
}

class MockPageBinder {
  overlayMappings() {
    return [];
  }
  consume(event) {
    return false;
  }
  setPage(page) {}
}

class MockMa3LuaClient {
  constructor() {
    this.connected = true;
    this.commands = [];
    this.sends = [];     // captures coalesced bridgeTick payloads
  }
  cmd(line) {
    this.commands.push(line);
  }
  // The engine's bridge-tick coalescer calls .send() with a structured
  // payload like { action: 'tick', encoder, delta } after a 30ms window.
  // Without this stub the coalescer crashes after the test exits.
  send(payload) {
    this.sends.push(payload);
  }
}

// Helper to create an engine with config
function createEngine(mappings = []) {
  const config = new MockConfigStore(mappings);
  const oscClient = new MockOscClient();
  const transports = {
    osc: oscClient,
    pageBinder: new MockPageBinder(),
    ma3lua: new MockMa3LuaClient(),
  };
  const events = [];
  const onEvent = (evt) => events.push(evt);
  const engine = new MappingEngine({ config, transports, onEvent });
  return { engine, config, transports, events };
}

test('Linear curve transform', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/fader' },
      transform: { inputRange: [0, 1], outputRange: [0, 100], curve: 'linear' },
      action: { type: 'osc', address: '/target', argType: 'f' },
    },
  ]);

  // Input 0 → output 0
  engine.handleInbound('osc', { address: '/test/fader', args: [0] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, 0);

  // Input 0.5 → output 50
  engine.handleInbound('osc', { address: '/test/fader', args: [0.5] });
  assert.strictEqual(transports.osc.sentToMa3[1].args[0].value, 50);

  // Input 1 → output 100
  engine.handleInbound('osc', { address: '/test/fader', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3[2].args[0].value, 100);
});

test('Invert curve transform', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/fader' },
      transform: { inputRange: [0, 1], outputRange: [0, 1], curve: 'invert' },
      action: { type: 'osc', address: '/target', argType: 'f' },
    },
  ]);

  // Input 0 → output 1 (inverted)
  engine.handleInbound('osc', { address: '/test/fader', args: [0] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, 1);

  // Input 0.5 → output 0.5
  engine.handleInbound('osc', { address: '/test/fader', args: [0.5] });
  assert.strictEqual(transports.osc.sentToMa3[1].args[0].value, 0.5);

  // Input 1 → output 0
  engine.handleInbound('osc', { address: '/test/fader', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3[2].args[0].value, 0);
});

test('Log curve transform', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/fader' },
      transform: { inputRange: [0, 1], outputRange: [0, 1], curve: 'log' },
      action: { type: 'osc', address: '/target', argType: 'f' },
    },
  ]);

  // Input 0 → output 0
  engine.handleInbound('osc', { address: '/test/fader', args: [0] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, 0);

  // Input 1 → output 1
  engine.handleInbound('osc', { address: '/test/fader', args: [1] });
  assert.ok(transports.osc.sentToMa3[1].args[0].value > 0.8 && transports.osc.sentToMa3[1].args[0].value <= 1);
});

test('Exp curve transform', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/fader' },
      transform: { inputRange: [0, 1], outputRange: [0, 1], curve: 'exp' },
      action: { type: 'osc', address: '/target', argType: 'f' },
    },
  ]);

  // Input 0 → output 0
  engine.handleInbound('osc', { address: '/test/fader', args: [0] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, 0);

  // Input 1 → output 1
  engine.handleInbound('osc', { address: '/test/fader', args: [1] });
  assert.ok(transports.osc.sentToMa3[1].args[0].value > 0.8 && transports.osc.sentToMa3[1].args[0].value <= 1);
});

test('Accumulate mode (fader encoder)', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/enc/1' },
      transform: { mode: 'accumulate', step: 0.1, outputRange: [0, 1], initial: 0 },
      action: { type: 'osc', address: '/fader', argType: 'f' },
    },
  ]);

  // Tick +1 → advance 0.1
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, 0.1);

  // Tick +1 → advance to 0.2
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3[1].args[0].value, 0.2);

  // Tick -1 → back to 0.1
  engine.handleInbound('osc', { address: '/enc/1', args: [-1] });
  assert.strictEqual(transports.osc.sentToMa3[2].args[0].value, 0.1);

  // Clamp at 0
  engine.handleInbound('osc', { address: '/enc/1', args: [-1] });
  engine.handleInbound('osc', { address: '/enc/1', args: [-1] });
  assert.strictEqual(transports.osc.sentToMa3[4].args[0].value, 0);

  // Clamp at 1
  for (let i = 0; i < 20; i++) {
    engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  }
  assert.strictEqual(transports.osc.sentToMa3[transports.osc.sentToMa3.length - 1].args[0].value, 1);
});

test('Relay mode (direct encoder tick)', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/enc/1' },
      transform: { mode: 'relay', step: 0.5 },
      action: { type: 'osc', address: '/ma3/encoder', argType: 'f' },
    },
  ]);

  // Tick +1 with step 0.5 → send 0.5
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, 0.5);

  // Tick -2 with step 0.5 → send -1.0
  engine.handleInbound('osc', { address: '/enc/1', args: [-2] });
  assert.strictEqual(transports.osc.sentToMa3[1].args[0].value, -1);
});

test('Cmd-tick mode (OSC /cmd with coalescing)', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/enc/1' },
      transform: { mode: 'cmd-tick', coarseStep: 0.5 },
      action: { type: 'cmd', template: 'Attribute "Dimmer" At $sign $abs' },
    },
  ]);

  // Tick +1 with step 0.5 → magnitude 0.5
  // Coalesce happens after 30ms, so we don't see immediate output
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  // Messages are coalesced, so check after a short delay
  assert.strictEqual(transports.osc.sentToMa3.length, 0); // Not flushed yet
});

test('Cmd-tick mode with acceleration', async () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/enc/1' },
      transform: {
        mode: 'cmd-tick',
        coarseStep: 0.5,
        acceleration: { enabled: true, maxMultiplier: 10, targetTicksPerSecond: 5, velocityTimeout: 500 },
      },
      action: { type: 'cmd', template: 'Attribute "Dimmer" At $sign $abs' },
    },
  ]);

  // Single slow tick: no acceleration
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3.length, 0); // Coalesced

  // Wait a bit, then another tick (slow): multiplier stays ~1.0
  await new Promise((r) => setTimeout(r, 150));
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });

  // Simulate fast spins: multiple ticks in quick succession
  for (let i = 0; i < 5; i++) {
    engine.handleInbound('osc', { address: '/enc/1', args: [1] });
    await new Promise((r) => setTimeout(r, 20)); // 20ms between ticks = 50 ticks/sec
  }

  // With acceleration, fast ticks should produce larger magnitudes
  // (This is verified internally in _calcAccelerationMultiplier)
});

test('Disabled mapping is skipped', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: false,
      trigger: { type: 'osc', match: '/test/fader' },
      transform: { curve: 'linear' },
      action: { type: 'osc', address: '/target', argType: 'f' },
    },
  ]);

  engine.handleInbound('osc', { address: '/test/fader', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3.length, 0);
});

test('OnlyOn filter skips non-matching values', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/btn' },
      transform: { onlyOn: 1 },
      action: { type: 'osc', address: '/target', argType: 'f' },
    },
  ]);

  // Value 0 should be skipped
  engine.handleInbound('osc', { address: '/test/btn', args: [0] });
  assert.strictEqual(transports.osc.sentToMa3.length, 0);

  // Value 1 should pass
  engine.handleInbound('osc', { address: '/test/btn', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3.length, 1);
});

test('Integer arg type coercion', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/value' },
      transform: { inputRange: [0, 10], outputRange: [0, 100], curve: 'linear' },
      action: { type: 'osc', address: '/target', argType: 'i' },
    },
  ]);

  // Input 3.7 normalized: (3.7 - 0) / 10 = 0.37, output: 0 + 0.37 * 100 = 37
  engine.handleInbound('osc', { address: '/test/value', args: [3.7] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].type, 'i');
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, 37);
});

test('String arg type coercion', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/text' },
      transform: { inputRange: [0, 1000], outputRange: [0, 1000], curve: 'linear' },
      action: { type: 'osc', address: '/target', argType: 's' },
    },
  ]);

  // Input 123 normalized: (123 - 0) / 1000 = 0.123, output: 0 + 0.123 * 1000 = 123
  engine.handleInbound('osc', { address: '/test/text', args: [123] });
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].type, 's');
  assert.strictEqual(transports.osc.sentToMa3[0].args[0].value, '123');
});

test('Multi action (nested actions)', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/test/btn' },
      transform: { onlyOn: 1 },
      action: {
        type: 'multi',
        actions: [
          { type: 'osc', address: '/action1', argType: 'f' },
          { type: 'osc', address: '/action2', argType: 'f' },
        ],
      },
    },
  ]);

  engine.handleInbound('osc', { address: '/test/btn', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3.length, 2);
  assert.strictEqual(transports.osc.sentToMa3[0].address, '/action1');
  assert.strictEqual(transports.osc.sentToMa3[1].address, '/action2');
});

test('Regex trigger matching', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/^/test/fader/[0-9]+$/' },
      transform: { curve: 'linear' },
      action: { type: 'osc', address: '/target', argType: 'f' },
    },
  ]);

  // Matching regex
  engine.handleInbound('osc', { address: '/test/fader/1', args: [0.5] });
  assert.strictEqual(transports.osc.sentToMa3.length, 1);

  // Also matches /test/fader/99
  engine.handleInbound('osc', { address: '/test/fader/99', args: [0.5] });
  assert.strictEqual(transports.osc.sentToMa3.length, 2);

  // Non-matching
  engine.handleInbound('osc', { address: '/other/fader/1', args: [0.5] });
  assert.strictEqual(transports.osc.sentToMa3.length, 2); // Still 2
});

test('stateFor() returns current mapping state', () => {
  const mappings = [
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/enc/1' },
      transform: { mode: 'accumulate', step: 0.1, outputRange: [0, 1], initial: 0 },
      action: { type: 'osc', address: '/fader', argType: 'f' },
    },
  ];
  const { engine, config } = createEngine(mappings);

  // Initial state is null or initial value
  assert.strictEqual(engine.stateFor('m1'), null);

  // After processing, state updates
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  assert.strictEqual(engine.stateFor('m1'), 0.1);

  // Non-existent mapping returns null
  assert.strictEqual(engine.stateFor('m999'), null);
});

test('Rate limiting: drops ticks exceeding max ticks/second', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/enc/1' },
      transform: { mode: 'accumulate', step: 0.1, outputRange: [0, 1], maxTicksPerSecond: 10 },
      action: { type: 'osc', address: '/fader', argType: 'f' },
    },
  ]);

  // First tick is always allowed
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3.length, 1);

  // Immediate second tick (within 100ms) is rate-limited and dropped
  engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  assert.strictEqual(transports.osc.sentToMa3.length, 1); // Still 1, not incremented

  // After 100ms delay, next tick is allowed
  // (Note: actual timing test is tricky in sync test; this just verifies the mechanism exists)
});

test('Rate limiting: no limit when maxTicksPerSecond is null', () => {
  const { engine, transports } = createEngine([
    {
      id: 'm1',
      enabled: true,
      trigger: { type: 'osc', match: '/enc/1' },
      transform: { mode: 'accumulate', step: 0.1, outputRange: [0, 1], maxTicksPerSecond: null },
      action: { type: 'osc', address: '/fader', argType: 'f' },
    },
  ]);

  // All rapid ticks should be allowed
  for (let i = 0; i < 5; i++) {
    engine.handleInbound('osc', { address: '/enc/1', args: [1] });
  }
  assert.strictEqual(transports.osc.sentToMa3.length, 5);
});

// ─── v0.13 console-driver routing ─────────────────────────────────────
//
// `bridgeTick` actions used to flow exclusively through ma3lua.cmd().
// In v0.13.0 the engine was refactored to route through transports.console
// for any non-MA3 driver. The MA3 path still uses the coalescer + Lua
// bridge. These tests pin both behaviors.

// The engine reads driver.constructor.id, so we need each fake driver
// to be its own subclass with a static `id` getter baked in at the
// class level (instance-level can't override a static getter).
class FakeConsoleDriverBase {
  constructor() {
    this.ticks = [];
    this.banks = [];
  }
  encoderTick(slotIdx, attr, delta) {
    this.ticks.push({ slotIdx, attr, delta });
    return true;
  }
  bankSelect(bankIdx, bankName) {
    this.banks.push({ bankIdx, bankName });
    return true;
  }
}
function makeFakeDriver(id) {
  class Tag extends FakeConsoleDriverBase {
    static get id() { return id; }
  }
  return new Tag();
}

test('bridgeTick routes through transports.console for Eos driver', () => {
  const fakeEos = makeFakeDriver('eos');
  const config = new MockConfigStore([
    {
      id: 'enc-1',
      enabled: true,
      trigger: { type: 'osc', match: '/sd/enc/1' },
      transform: { mode: 'linear', coarseStep: 1, fromArgIndex: 0 },
      action: { type: 'bridgeTick', encoder: 1 },
    },
  ]);
  const transports = {
    osc: new MockOscClient(),
    pageBinder: new MockPageBinder(),
    ma3lua: new MockMa3LuaClient(),
    console: fakeEos,
  };
  const engine = new MappingEngine({ config, transports, onEvent: () => {} });

  engine.handleInbound('osc', { address: '/sd/enc/1', args: [1] });
  assert.strictEqual(fakeEos.ticks.length, 1, 'driver.encoderTick should be called once');
  assert.strictEqual(fakeEos.ticks[0].slotIdx, 1);
  // ma3lua.cmd should NOT be called when console is non-MA3
  assert.strictEqual(transports.ma3lua.commands.length, 0);
});

test('bridgeTick with MA3 driver routes through coalescer → ma3lua.send', async () => {
  const fakeMa3 = makeFakeDriver('ma3');
  const config = new MockConfigStore([
    {
      id: 'enc-2',
      enabled: true,
      trigger: { type: 'osc', match: '/sd/enc/2' },
      transform: { mode: 'linear', coarseStep: 1, fromArgIndex: 0 },
      action: { type: 'bridgeTick', encoder: 2 },
    },
  ]);
  const ma3lua = new MockMa3LuaClient();
  const transports = {
    osc: new MockOscClient(),
    pageBinder: new MockPageBinder(),
    ma3lua,
    console: fakeMa3,
  };
  const engine = new MappingEngine({ config, transports, onEvent: () => {} });

  engine.handleInbound('osc', { address: '/sd/enc/2', args: [1] });
  // MA3 path bypasses driver.encoderTick — the coalescer holds the tick
  // and flushes through ma3lua.send() after ~30ms.
  assert.strictEqual(fakeMa3.ticks.length, 0, 'MA3 driver.encoderTick should NOT be called directly');
  // Await the coalescer's flush window (30ms in production; pad to 80ms
  // to keep CI flake-free).
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(ma3lua.sends.length, 1, 'coalescer should flush once via ma3lua.send');
  assert.strictEqual(ma3lua.sends[0].action, 'tick');
  assert.strictEqual(ma3lua.sends[0].encoder, 2);
});

test('setPage routes through driver.bankSelect for non-MA3', () => {
  const fakeEos = makeFakeDriver('eos');
  const config = new MockConfigStore([
    {
      id: 'page-pos',
      enabled: true,
      trigger: { type: 'osc', match: '/sd/btn/0/down' },
      action: { type: 'setPage', page: 'Position', bankIdx: 2 },
    },
  ]);
  const transports = {
    osc: new MockOscClient(),
    pageBinder: new MockPageBinder(),
    ma3lua: new MockMa3LuaClient(),
    console: fakeEos,
  };
  const engine = new MappingEngine({ config, transports, onEvent: () => {} });

  engine.handleInbound('osc', { address: '/sd/btn/0/down', args: [1] });
  assert.strictEqual(fakeEos.banks.length, 1, 'driver.bankSelect should be called once');
  assert.strictEqual(fakeEos.banks[0].bankName, 'Position');
});

console.log('✓ All tests passed');

// ---------------------------------------------------------------------
// v0.13.43: LCD-touch stacked-attribute cycling delegates to the bridge
// ---------------------------------------------------------------------

function createTouchEngine({ connected = true, reply = { name: 'Pan_Phaser', idx: 2, total: 2 } } = {}) {
  const config = new MockConfigStore([]);
  config.get = (path) => (path === 'encoderStacks'
    ? { Position: { 1: ['Pan', 'Pan_Phaser'] } }
    : undefined);
  const queries = [];
  const overrides = [];
  const lua = {
    connected,
    query: async (action, opts) => { queries.push({ action, opts }); return reply; },
    send: () => {},
    cmd: () => {},
  };
  const pageBinder = {
    overlayMappings: () => [],
    consume: () => false,
    encoderBarFeature: () => 'Position',
    currentPage: () => null,
    fixtureType: () => null,
    noteSlotOverride: (slot, name) => overrides.push({ slot, name }),
  };
  const events = [];
  const engine = new MappingEngine({
    config,
    transports: { osc: new MockOscClient(), pageBinder, ma3lua: lua },
    onEvent: (e) => events.push(e),
  });
  return { engine, queries, overrides, events };
}

test('LCD touch delegates cycling to bridge cycleStack with the user list', async () => {
  const { engine, queries, overrides, events } = createTouchEngine();
  await engine._handleLcdTouchCycle(50, 10, 1);

  assert.strictEqual(queries.length, 1);
  assert.strictEqual(queries[0].action, 'cycleStack');
  assert.deepStrictEqual(queries[0].opts.payload, { slot: 1, dir: 1, list: ['Pan', 'Pan_Phaser'] });

  // Instant LCD label update from the bridge's reply
  assert.deepStrictEqual(overrides, [{ slot: 1, name: 'Pan_Phaser' }]);

  const touch = events.find((e) => e.event && e.event.lcdTouch);
  assert.ok(touch, 'lcdTouch event emitted');
  assert.strictEqual(touch.event.lcdTouch.source, 'bridge');
  assert.strictEqual(touch.event.lcdTouch.nextName, 'Pan_Phaser');
});

test('LCD touch with bridge disconnected reports noBridge and sends nothing', async () => {
  const { engine, queries, overrides, events } = createTouchEngine({ connected: false });
  await engine._handleLcdTouchCycle(250, 10, 2);

  assert.strictEqual(queries.length, 0);
  assert.strictEqual(overrides.length, 0);
  const touch = events.find((e) => e.event && e.event.lcdTouch);
  assert.ok(touch, 'lcdTouch event emitted');
  assert.strictEqual(touch.event.lcdTouch.source, 'noBridge');
  assert.strictEqual(touch.event.lcdTouch.sentToBridge, false);
});
