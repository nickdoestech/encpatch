// ENCpatch UI — vanilla JS, no build step.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  config: null,
  mappings: [],
  ws: null,
  monitorPaused: false,
  editing: null,
  searchQuery: '',
  bulkSelection: new Set(), // Set of selected mapping IDs
};

// ---- Tabs ----
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  const target = t.dataset.tab;
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${target}`));
}));

// ---- WebSocket ----
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => setConn(true, 'Connected');
  ws.onclose = () => { setConn(false, 'Disconnected — retrying…'); setTimeout(connectWs, 1500); };
  ws.onerror = () => setConn(false, 'WebSocket error');
  ws.onmessage = (e) => handleWsMessage(JSON.parse(e.data));
}
function setConn(ok, text) {
  $('#conn-dot').classList.toggle('ok', ok);
  $('#status-line').textContent = text;
}
function handleWsMessage(msg) {
  if (msg.type === 'event') addMonitor(msg.payload);
  else if (msg.type === 'log') addMonitor({ direction: 'log', transport: msg.payload.source, event: { line: msg.payload.message }, ts: msg.payload.ts });
  else if (msg.type === 'mappings') { state.mappings = msg.payload; state.bulkSelection.clear(); updateBulkActionsUI(); renderMappings(); if (typeof vbDecorateBindings === 'function') { vbDecorateBindings('console'); vbDecorateBindings('sd'); } if (typeof vbRenderEncoderBar === 'function') vbRenderEncoderBar(); }
  else if (msg.type === 'pageBinder') {
    const s = msg.payload || {};
    const el = $('#page-line');
    if (!s.enabled) el.textContent = '(page-aware off)';
    else if (s.currentPage) {
      const src = s.attrSource === 'live' ? '● LIVE' : (s.attrSource === 'static' ? '○ static' : '');
      el.textContent = `${s.currentPage}  ${src}`;
      el.style.color = s.attrSource === 'live' ? 'var(--good)' : 'var(--muted)';
      el.title = s.lastLiveStatus ? `live status: ${s.lastLiveStatus}` : '';
    } else el.textContent = 'pick a page →';
    // Highlight the active page button
    document.querySelectorAll('#vb-pages-row .page-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.page === s.currentPage);
    });
    if (typeof vbRenderEncoderBar === 'function') vbRenderEncoderBar();
  }
  else if (msg.type === 'config') { state.config = msg.payload; fillSettingsForm(); }
  else if (msg.type === 'hello') (msg.payload.recent || []).forEach(addMonitor);
}

// ---- Auto-updater (Electron only) ----
// Set up IPC listeners for electron-updater notifications
if (typeof window.electronAPI === 'undefined' && window.ipcRenderer) {
  // IPC is available from preload script
  const ipc = window.ipcRenderer;

  ipc.on('updater:checking', () => {
    const notif = $('#updater-notif');
    const status = $('#updater-status');
    status.textContent = 'Checking for updates…';
    notif.hidden = false;
    $('#updater-install').hidden = true;
    $('#updater-dismiss').hidden = true;
  });

  ipc.on('updater:update-available', (event, data) => {
    const status = $('#updater-status');
    status.textContent = `Update available: v${data.version}`;
    $('#updater-install').hidden = false;
    $('#updater-dismiss').hidden = false;
  });

  ipc.on('updater:download-progress', (event, data) => {
    const status = $('#updater-status');
    status.textContent = `Downloading: ${data.percent}%`;
  });

  ipc.on('updater:update-ready', (event, data) => {
    const status = $('#updater-status');
    status.textContent = `Ready to install v${data.version}`;
    $('#updater-install').textContent = 'Install now';
    $('#updater-install').hidden = false;
    $('#updater-dismiss').hidden = false;
  });

  ipc.on('updater:error', (event, data) => {
    const status = $('#updater-status');
    status.textContent = `Update failed: ${data.message}`;
    status.style.color = 'var(--bad)';
    $('#updater-install').hidden = true;
    $('#updater-dismiss').hidden = false;
  });

  $('#updater-install').addEventListener('click', () => {
    ipc.invoke('updater:install').catch(err => {
      console.error('Install failed:', err);
    });
  });

  $('#updater-dismiss').addEventListener('click', () => {
    $('#updater-notif').hidden = true;
  });
}

// ---- Initial load ----
async function loadState() {
  const r = await fetch('/api/state'); const j = await r.json();
  state.config = j.config;
  state.mappings = j.config.mappings || [];
  $('#version-tag').textContent = `v${j.version}`;
  fillSettingsForm();
  initSettingsConsoleQuickSwitch();
  renderMappings();
}

// ---- Settings ----
function fillSettingsForm() {
  if (!state.config) return;
  const form = $('#form-settings');
  for (const el of form.elements) {
    if (!el.name) continue;
    let val = getDotted(state.config, el.name);
    if (el.type === 'checkbox') {
      el.checked = !!val;
    } else if (el.name === 'eos.encoderParams' && Array.isArray(val)) {
      // v0.13.24: encoderParams is stored as array but rendered as
      // comma-separated string for editing.
      el.value = val.join(', ');
    } else {
      el.value = val ?? '';
    }
  }
  renderEncoderStacksEditor();
  renderEosCategoryParamsEditor();
  applySettingsConsoleVisibility();
  updateSettingsConsoleQuickSwitch();
}

// v0.13.41: Quick console switcher at the top of Settings tab. Populates
// the select with available consoles, shows current selection, and on change
// sends an immediate patch to /api/settings with hot-reload. No form Save
// required — users who skip welcome can still switch consoles here.
async function initSettingsConsoleQuickSwitch() {
  const sel = document.getElementById('settings-console-quick');
  if (!sel) return;

  // Fetch the list of available consoles
  let consoles = [];
  try {
    const r = await fetch('/api/consoles');
    if (r.ok) {
      const j = await r.json();
      consoles = Array.isArray(j) ? j : (j.drivers || j.consoles || []);
    }
  } catch (_) {}
  if (!consoles.length) {
    consoles = [
      { id: 'ma3', displayName: 'grandMA3 onPC' },
      { id: 'eos', displayName: 'ETC Eos' },
    ];
  }

  // Populate the select
  sel.innerHTML = consoles.map((c) => {
    const tag = c.tested === false ? ' (untested)' : '';
    return `<option value="${c.id}">${c.displayName}${tag}</option>`;
  }).join('');

  // Set current selection and attach change handler
  updateSettingsConsoleQuickSwitch();
  sel.addEventListener('change', async () => {
    const newConsole = sel.value;
    const statusEl = document.getElementById('settings-console-status');
    if (statusEl) statusEl.textContent = 'Switching…';
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ console: newConsole }),
      });
      if (r.ok) {
        const j = await r.json();
        state.config = j.config;
        if (statusEl) {
          statusEl.textContent = 'Switched ✓';
          setTimeout(() => { statusEl.textContent = '—'; }, 2000);
        }
        applySettingsConsoleVisibility();
        // Also update the main form's console select
        const formSel = document.getElementById('settings-console');
        if (formSel) formSel.value = newConsole;
      } else {
        if (statusEl) statusEl.textContent = 'Failed';
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Error';
    }
  });
}

function updateSettingsConsoleQuickSwitch() {
  const sel = document.getElementById('settings-console-quick');
  if (!sel || !state.config) return;
  sel.value = state.config.console || 'ma3';
}

// v0.13.28: per-category Eos encoder param editor. Each category gets a
// card with 4 inputs; user types a parameter name per slot. Saves to
// config.eos.encoderParamsByCategory on form submit. Drives the
// behavior in EosDriver._swapSubscriptions when a category button fires.
// Exactly Eos's encoder-display category strip (per ETC docs and Nick's
// testing on Nomad v3.x). No Beam/FX/Custom — those aren't canonical
// Eos categories and either silently failed or sent garbage commands.
const EOS_CATEGORIES = ['Intensity', 'Focus', 'Color', 'Shutter', 'Image', 'Form'];
// v0.13.35: total slots per category card — 12 = 3 pages of 4. Bumping
// from v0.13.34's 8. LCD swipe wraps through all configured pages.
const EOS_SLOTS_PER_CATEGORY = 12;
const EOS_PAGE_SIZE = 4;

function renderEosCategoryParamsEditor() {
  const grid = document.getElementById('eos-category-params-grid');
  if (!grid) return;
  const map = (state.config && state.config.eos && state.config.eos.encoderParamsByCategory) || {};
  grid.innerHTML = '';
  for (const cat of EOS_CATEGORIES) {
    const params = Array.isArray(map[cat]) ? map[cat] : [];
    const card = document.createElement('div');
    card.className = 'enc-stack-card';
    card.innerHTML = `<div class="enc-stack-feat">${cat}</div>`;
    for (let slot = 0; slot < EOS_SLOTS_PER_CATEGORY; slot++) {
      const val = params[slot] || '';
      const page = Math.floor(slot / EOS_PAGE_SIZE) + 1;
      const slotInPage = (slot % EOS_PAGE_SIZE) + 1;
      // Insert a divider between pages
      if (slot > 0 && slot % EOS_PAGE_SIZE === 0) {
        const sep = document.createElement('div');
        sep.className = 'enc-stack-row';
        sep.style.fontSize = '10px';
        sep.style.color = 'var(--text-soft)';
        sep.style.borderTop = '1px solid #2a2a2d';
        sep.style.paddingTop = '4px';
        sep.textContent = `— page ${page} (LCD swipe ${page > 2 ? '→ →' : '→'}) —`;
        card.appendChild(sep);
      }
      const row = document.createElement('div');
      row.className = 'enc-stack-row';
      const labelPrefix = page === 1 ? 'Enc' : `P${page}.`;
      row.innerHTML = `
        <label class="enc-stack-slot">${labelPrefix} ${slotInPage}</label>
        <input class="eos-cat-param-input" data-category="${cat}" data-slot="${slot}"
               value="${val}"
               placeholder="(unused)" />
      `;
      card.appendChild(row);
    }
    grid.appendChild(card);
  }
}

// Collect into the per-category map shape EosDriver expects.
function collectEosCategoryParams() {
  const out = {};
  document.querySelectorAll('.eos-cat-param-input').forEach((input) => {
    const cat = input.dataset.category;
    const slot = Number(input.dataset.slot);
    const v = (input.value || '').trim();
    // v0.13.35: up to 12 slots per category (3 pages of 4)
    if (!out[cat]) out[cat] = new Array(EOS_SLOTS_PER_CATEGORY).fill(null);
    out[cat][slot] = v || null;
  });
  // Strip trailing nulls per category so the array is just the
  // populated slots — keeps the JSON tidy and lets _categoryPageCount
  // compute the right number of pages.
  for (const cat of Object.keys(out)) {
    while (out[cat].length > 0 && (out[cat][out[cat].length - 1] === null)) {
      out[cat].pop();
    }
    if (out[cat].length === 0) delete out[cat];
  }
  return out;
}

// v0.13.2: hide MA3-only sections (OSC ports, bridge plugin, encoder
// stacks) when the chosen console isn't grandMA3. Also rewrites the
// page title + intro paragraph to match. Bound on console <select> change
// AND called once after fillSettingsForm so it runs on initial load.
function applySettingsConsoleVisibility() {
  const sel = document.getElementById('settings-console');
  if (!sel) return;
  const consoleId = sel.value || (state.config && state.config.console) || 'ma3';
  const isMa3 = consoleId === 'ma3';

  const title = document.getElementById('settings-title');
  const intro = document.getElementById('settings-intro');
  if (title) {
    title.textContent = isMa3 ? 'Network settings' : `Network settings — ${prettyConsoleName(consoleId)}`;
  }
  if (intro) {
    intro.innerHTML = isMa3
      ? 'Match these to MA3 → <em>Menu → Network → OSC</em>. The listen port here must match MA3\'s "Output port", and MA3\'s "Input port" must match what you set as MA3 send port.'
      : `Configure the OSC link to your console. Encoder ticks and bank selection route through ENCpatch's ${prettyConsoleName(consoleId)} driver.`;
  }
  for (const id of ['ma3-osc-section', 'ma3-bridge-section', 'encoder-stacks-section']) {
    const el = document.getElementById(id);
    if (el) el.hidden = !isMa3;
  }
  // Console host/port labels make more sense as "Eos host" / "MagicQ host"
  // than the generic "Console host" — relabel based on pick.
  const hostInputs = document.querySelectorAll('input[name="eos.host"], input[name="eos.port"], input[name="eos.localPort"]');
  hostInputs.forEach((input) => {
    const label = input.closest('label');
    if (!label) return;
    const text = label.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) return;
    const stem = text.nodeValue.trim().replace(/^.*?\s*(host|port|local port|listen port)$/i, '$1');
    if (input.name === 'eos.host')      text.nodeValue = `${prettyConsoleName(consoleId)} host `;
    if (input.name === 'eos.port')      text.nodeValue = `${prettyConsoleName(consoleId)} send port `;
    if (input.name === 'eos.localPort') text.nodeValue = `${prettyConsoleName(consoleId)} listen port `;
  });
}

function prettyConsoleName(id) {
  return ({
    ma3: 'grandMA3', eos: 'Eos', onyx: 'Onyx', titan: 'Titan',
    hog: 'Hog', magicq: 'MagicQ', vista: 'Vista',
  })[id] || id;
}

// Encoder stacks editor: per feature group, per slot, comma-separated
// attribute names. Saved into config.encoderStacks on form submit.
const STACK_FEATURES = ['Dimmer', 'Position', 'Gobo', 'Color', 'Beam', 'Focus', 'Control', 'Shapers'];
function renderEncoderStacksEditor() {
  const grid = document.getElementById('encoder-stacks-grid');
  if (!grid) return;
  const stacks = (state.config && state.config.encoderStacks) || {};
  grid.innerHTML = '';
  for (const feature of STACK_FEATURES) {
    const featStacks = stacks[feature] || {};
    const card = document.createElement('div');
    card.className = 'enc-stack-card';
    card.innerHTML = `<div class="enc-stack-feat">${feature}</div>`;
    for (let slot = 1; slot <= 4; slot++) {
      const list = featStacks[String(slot)] || [];
      const row = document.createElement('div');
      row.className = 'enc-stack-row';
      row.innerHTML = `
        <label class="enc-stack-slot">Slot ${slot}</label>
        <input class="enc-stack-input" data-feature="${feature}" data-slot="${slot}"
               value="${list.join(', ')}"
               placeholder="(no cycle)" />
      `;
      card.appendChild(row);
    }
    grid.appendChild(card);
  }
  bindStackEditorButtons();
}

// Wire Clear / Reset buttons. Clear empties every input; Reset asks the
// server for the built-in defaults and re-populates. Save still requires
// clicking the form's Save button afterward.
function bindStackEditorButtons() {
  const clear = document.getElementById('btn-stacks-clear');
  const reset = document.getElementById('btn-stacks-defaults');
  const discover = document.getElementById('btn-stacks-discover');
  const msg = document.getElementById('stacks-msg');

  if (discover) discover.addEventListener('click', async () => {
    if (msg) { msg.textContent = 'Querying MA3...'; msg.style.color = '#aab3c4'; }
    try {
      const r = await fetch('/api/bridge/discover-stacks', { method: 'POST' });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        if (msg) { msg.textContent = `Discover failed: ${j.error || 'HTTP ' + r.status}`; msg.style.color = '#ff5252'; }
        return;
      }
      const data = await r.json();
      const feature = data.feature;
      if (!feature || feature === 'null') {
        if (msg) { msg.textContent = 'No MA3 feature group selected — pick Color/Gobo/etc. on MA3 first.'; msg.style.color = '#fcd34d'; }
        return;
      }
      if (data.selCount === 0) {
        if (msg) { msg.textContent = 'No fixtures selected in MA3 — select fixtures first.'; msg.style.color = '#fcd34d'; }
        return;
      }
      // Write the discovered slots into THIS FEATURE'S inputs only —
      // don't clobber other features the user has already configured.
      const slots = data.slots || {};
      let totalFilled = 0;
      document.querySelectorAll('.enc-stack-input').forEach((input) => {
        if (input.dataset.feature !== feature) return;
        const list = slots[input.dataset.slot] || [];
        if (list.length > 0) {
          input.value = list.join(', ');
          totalFilled += list.length;
        }
      });
      if (msg) {
        const slotCounts = [1,2,3,4].map((s) => (slots[String(s)] || []).length);
        msg.textContent = `Found ${totalFilled} attrs for ${feature}: slot1=${slotCounts[0]} slot2=${slotCounts[1]} slot3=${slotCounts[2]} slot4=${slotCounts[3]}. Click Save settings to apply.`;
        msg.style.color = '#3fbf66';
      }
    } catch (err) {
      if (msg) { msg.textContent = `Error: ${err.message}`; msg.style.color = '#ff5252'; }
    }
  });
  if (clear) clear.addEventListener('click', () => {
    document.querySelectorAll('.enc-stack-input').forEach((i) => { i.value = ''; });
    if (msg) { msg.textContent = 'All entries cleared. Click Save settings to apply.'; msg.style.color = '#fcd34d'; }
  });
  if (reset) reset.addEventListener('click', async () => {
    // Fetch defaults via a tiny endpoint we don't have yet — fall back to
    // hardcoded copy of the defaults from config-store.
    const defaults = {
      Dimmer:   { "1": ["Dim"] },
      Position: { "1": ["Pan", "Pan_Phaser"], "2": ["Tilt", "Tilt_Phaser"] },
      Gobo:     { "1": ["Gobo1"], "2": ["Gobo2"], "3": ["Gobo3"] },
      Color:    { "1": ["Color1"], "2": ["Color2"], "3": ["Color3"] },
      Beam:     { "1": ["Iris"], "2": ["Zoom"], "3": ["Shutter1"], "4": ["Prism1"] },
      Focus:    { "1": ["Focus1"], "2": ["Frost1"] },
      Control:  { "1": ["Control1"] },
      Shapers:  { "1": ["Blade1A"], "2": ["Blade2A"], "3": ["Blade3A"], "4": ["Blade4A"] },
    };
    document.querySelectorAll('.enc-stack-input').forEach((i) => {
      const f = i.dataset.feature, s = i.dataset.slot;
      const list = (defaults[f] && defaults[f][s]) || [];
      i.value = list.join(', ');
    });
    if (msg) { msg.textContent = 'Reset to minimal defaults — one attribute per slot. Customize per fixture.'; msg.style.color = '#3fbf66'; }
  });
}

// Read encoder stacks from inputs into a clean config object.
function collectEncoderStacks() {
  const out = {};
  document.querySelectorAll('.enc-stack-input').forEach((input) => {
    const feature = input.dataset.feature;
    const slot = input.dataset.slot;
    const raw = (input.value || '').trim();
    if (!raw) return;
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    if (!out[feature]) out[feature] = {};
    out[feature][slot] = list;
  });
  return out;
}
$('#form-settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const patch = {};
  for (const el of e.target.elements) {
    if (!el.name) continue;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = v === '' ? null : Number(v);
    // v0.13.24: eos.encoderParams is a text input that we serialize as
    // a 4-element array. Empty/blank → null (auto-follow). Otherwise
    // split on commas, trim, drop empties.
    if (el.name === 'eos.encoderParams') {
      const list = String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
      v = list.length > 0 ? list.slice(0, 4) : null;
    }
    setDotted(patch, el.name, v);
  }
  // Encoder stacks live outside the named-input form, collect separately
  patch.encoderStacks = collectEncoderStacks();
  // v0.13.28: per-category Eos param map also lives outside named inputs
  if (state.config && state.config.console === 'eos') {
    if (!patch.eos) patch.eos = {};
    patch.eos.encoderParamsByCategory = collectEosCategoryParams();
  }
  const r = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
  const j = await r.json();
  state.config = j.config;
  $('#settings-saved-msg').textContent = 'Saved.';
  setTimeout(() => $('#settings-saved-msg').textContent = '', 1500);
  applySettingsConsoleVisibility();
});

// Live: re-render Settings panel visibility immediately when the console
// picker changes (no save needed — visual prep only). The actual driver
// hot-swap on the server side happens when the user clicks Save.
document.addEventListener('change', (ev) => {
  if (ev.target && ev.target.id === 'settings-console') {
    applySettingsConsoleVisibility();
  }
});

// "Run setup again" — clears the localStorage flag and force-shows the
// welcome modal. Useful after upgrades, or if the user closed it without
// finishing.
document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'btn-rerun-welcome') {
    try {
      localStorage.removeItem('encpatch.welcomed.v1');
      localStorage.removeItem('encpatch.welcomed.v2');
    } catch (_) {}
    welcomeInit();
  }
});

$('#btn-test-lua').addEventListener('click', async () => {
  const command = $('#test-lua-cmd').value.trim();
  if (!command) return;
  const r = await fetch('/api/test/ma3lua', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ command }) });
  const j = await r.json();
  alert(r.ok ? 'Sent.' : ('Failed: ' + (j.error || r.status)));
});

// Health pill — polls /api/health every 1s
async function refreshHealth() {
  try {
    const r = await fetch('/api/health'); const j = await r.json();
    const t = j.traffic || {}; const b = j.bridge || {};
    const pill = $('#health-pill');
    if (!pill) return;
    if (t.panic && t.panic.active) {
      pill.textContent = `PANIC ${Math.ceil(t.panic.msRemaining/1000)}s`;
      pill.style.color = 'var(--bad)';
    } else {
      const rate = t.ratePerSec || 0;
      const dropped = t.dropped || 0;
      const bridgeMs = b.lastMs ? `bridge ${b.lastMs.toFixed(1)}ms` : (j.luaConnected ? 'bridge ok' : 'bridge off');
      pill.textContent = `${rate}/s msgs  •  ${bridgeMs}${dropped ? `  •  ${dropped} dropped` : ''}`;
      pill.style.color = dropped > 0 ? 'var(--warn)' : (rate > 30 ? 'var(--warn)' : 'var(--text-soft)');
    }
  } catch (_) {}
}
setInterval(refreshHealth, 1000); refreshHealth();

$('#panic-btn').addEventListener('click', async () => {
  await fetch('/api/panic', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seconds: 5 }) });
});

// Periodically refresh the Lua connection status badge
setInterval(async () => {
  if (!$('#tab-settings').classList.contains('active')) return;
  try {
    const r = await fetch('/api/state'); const j = await r.json();
    const lua = j.ma3lua || {};
    $('#ma3lua-status').value = !lua.enabled ? 'disabled' : (lua.connected ? `connected ${lua.host}:${lua.port}` : 'not connected');
    // v0.13.2: console driver status badge in the Console fieldset.
    const cs = j.console || {};
    const csEl = document.getElementById('console-status');
    if (csEl) {
      const where = cs.host ? `${cs.host}:${cs.port || '?'}` : '';
      csEl.value = cs.connected
        ? (where ? `connected ${where}` : 'connected')
        : (cs.driver ? `${cs.driver}: not connected` : '—');
    }
    const sd = j.sdhid || {};
    // also surface SD HID status under the brand area as a small chip if present
    const ver = $('#version-tag');
    if (sd.connected) ver.textContent = `v${j.version} • SD: ${sd.model || 'connected'}`;
    else ver.textContent = `v${j.version}`;
  } catch (_) {}
}, 1500);

$('#btn-test-osc').addEventListener('click', async () => {
  const address = $('#test-osc-addr').value.trim();
  const value = $('#test-osc-val').value.trim();
  const argType = $('#test-osc-type').value;
  if (!address) return;
  await fetch('/api/test/osc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, value, argType }) });
});

// ---- Mappings list ----
function renderMappings() {
  const list = $('#mapping-list'); list.innerHTML = '';
  // Filter mappings based on search query
  const filtered = state.mappings.filter((m) => {
    if (!state.searchQuery) return true;
    const q = state.searchQuery.toLowerCase();
    const name = (m.name || '').toLowerCase();
    const trigger = (m.trigger && m.trigger.match || '').toLowerCase();
    const action = (m.action && m.action.address || '').toLowerCase();
    return name.includes(q) || trigger.includes(q) || action.includes(q);
  });
  $('#mapping-empty').hidden = filtered.length > 0;
  for (const m of filtered) list.appendChild(mappingCard(m));
  updateBulkActionsUI();
}
function mappingCard(m) {
  const el = document.createElement('div');
  el.className = `mapping-card ${m.enabled !== false ? 'enabled' : 'disabled'}`;
  el.innerHTML = `
    <div class="card-header">
      <input type="checkbox" class="bulk-select" title="select for bulk actions" />
      <div class="toggle" title="enable/disable"></div>
    </div>
    <div class="info">
      <div class="name"></div>
      <div class="summary"></div>
    </div>
    <div class="actions">
      <button class="btn">Edit</button>
      <button class="btn danger">Delete</button>
    </div>`;
  el.querySelector('.name').textContent = m.name || '(unnamed mapping)';
  el.querySelector('.summary').textContent = summarize(m);

  const checkbox = el.querySelector('.bulk-select');
  checkbox.checked = state.bulkSelection.has(m.id);
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      state.bulkSelection.add(m.id);
    } else {
      state.bulkSelection.delete(m.id);
    }
    updateBulkActionsUI();
  });

  el.querySelector('.toggle').addEventListener('click', async () => {
    m.enabled = m.enabled === false ? true : false;
    await saveMapping(m);
  });
  el.querySelectorAll('.actions .btn')[0].addEventListener('click', () => openEditor(m));
  el.querySelectorAll('.actions .btn')[1].addEventListener('click', async () => {
    if (!confirm(`Delete mapping "${m.name || m.id}"?`)) return;
    await fetch(`/api/mappings/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
  });
  return el;
}
function summarize(m) {
  const t = m.trigger || {}, a = m.action || {};
  const trig = `${t.type || '?'}:${t.match || '?'}`;
  let act;
  if (a.type === 'osc') act = `osc → ${a.address || '?'}`;
  else if (a.type === 'telnet') act = `telnet → ${a.command || '?'}`;
  else act = a.type || '?';
  const fb = m.feedback && m.feedback.enabled ? ` ⇄ feedback` : '';
  return `${trig}   →   ${act}${fb}`;
}

// ---- Search/filter ----
$('#mapping-search').addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  renderMappings();
});

// ---- Bulk actions ----
function updateBulkActionsUI() {
  const count = state.bulkSelection.size;
  const bulkPanel = $('#bulk-actions');
  const countEl = $('#bulk-count');
  if (count > 0) {
    bulkPanel.hidden = false;
    countEl.textContent = `${count} selected`;
  } else {
    bulkPanel.hidden = true;
  }
}

$('#btn-bulk-enable').addEventListener('click', async () => {
  const selected = Array.from(state.bulkSelection);
  for (const id of selected) {
    const m = state.mappings.find((x) => x.id === id);
    if (m) {
      m.enabled = true;
      await saveMapping(m);
    }
  }
  state.bulkSelection.clear();
  updateBulkActionsUI();
  renderMappings();
});

$('#btn-bulk-disable').addEventListener('click', async () => {
  const selected = Array.from(state.bulkSelection);
  for (const id of selected) {
    const m = state.mappings.find((x) => x.id === id);
    if (m) {
      m.enabled = false;
      await saveMapping(m);
    }
  }
  state.bulkSelection.clear();
  updateBulkActionsUI();
  renderMappings();
});

$('#btn-bulk-clear').addEventListener('click', () => {
  state.bulkSelection.clear();
  updateBulkActionsUI();
  renderMappings();
});

// ---- Mapping editor ----
$('#btn-new-mapping').addEventListener('click', () => openEditor(null));
$('#mapping-modal-close').addEventListener('click', closeEditor);
$('#mapping-modal-cancel').addEventListener('click', closeEditor);
$('#mapping-modal-save').addEventListener('click', saveEditor);

function openEditor(m) {
  state.editing = m ? JSON.parse(JSON.stringify(m)) : blankMapping();
  $('#mapping-modal-title').textContent = m ? 'Edit mapping' : 'New mapping';
  const x = state.editing;
  $('#m-name').value = x.name || '';
  $('#m-enabled').checked = x.enabled !== false;
  $('#m-trigger-type').value = (x.trigger && x.trigger.type) || 'osc';
  $('#m-trigger-match').value = (x.trigger && x.trigger.match) || '';
  $('#m-trigger-host').value = (x.trigger && x.trigger.fromHost) || '';
  $('#m-tx-arg').value = (x.transform && x.transform.fromArgIndex) ?? 0;
  $('#m-tx-in').value = (x.transform && x.transform.inputRange || [0,1]).join(',');
  $('#m-tx-out').value = (x.transform && x.transform.outputRange || [0,1]).join(',');
  $('#m-tx-curve').value = (x.transform && x.transform.curve) || 'linear';
  $('#m-tx-onlyon').value = (x.transform && x.transform.onlyOn != null) ? String(x.transform.onlyOn) : '';
  $('#m-action-type').value = (x.action && x.action.type) || 'osc';
  $('#m-action-addr').value = (x.action && x.action.address) || '';
  $('#m-action-argtype').value = (x.action && x.action.argType) || 'f';
  $('#m-action-cmd').value = (x.action && x.action.command) || '';
  const fb = x.feedback || {};
  $('#m-fb-enabled').checked = !!fb.enabled;
  $('#m-fb-src').value = (fb.ma3Source && fb.ma3Source.match) || '';
  $('#m-fb-host').value = (fb.destination && fb.destination.host) || '';
  $('#m-fb-port').value = (fb.destination && fb.destination.port) || '';
  $('#m-fb-addr').value = (fb.destination && fb.destination.address) || '';
  $('#m-fb-argtype').value = (fb.destination && fb.destination.argType) || 'f';
  $('#mapping-modal').hidden = false;
}
function closeEditor() { $('#mapping-modal').hidden = true; state.editing = null; }
function blankMapping() {
  return { name: '', enabled: true, trigger: { type: 'osc', match: '' }, transform: { fromArgIndex: 0, inputRange: [0,1], outputRange: [0,1], curve: 'linear' }, action: { type: 'osc', address: '', argType: 'f' }, feedback: { enabled: false } };
}
async function saveEditor() {
  const x = state.editing || blankMapping();
  x.name = $('#m-name').value;
  x.enabled = $('#m-enabled').checked;
  x.trigger = { type: $('#m-trigger-type').value, match: $('#m-trigger-match').value.trim(), fromHost: $('#m-trigger-host').value.trim() || null };
  x.transform = {
    fromArgIndex: Number($('#m-tx-arg').value) || 0,
    inputRange: parseRange($('#m-tx-in').value, [0,1]),
    outputRange: parseRange($('#m-tx-out').value, [0,1]),
    curve: $('#m-tx-curve').value,
    onlyOn: $('#m-tx-onlyon').value === '' ? null : tryNumber($('#m-tx-onlyon').value),
  };
  x.action = { type: $('#m-action-type').value, address: $('#m-action-addr').value.trim(), argType: $('#m-action-argtype').value, command: $('#m-action-cmd').value };
  x.feedback = {
    enabled: $('#m-fb-enabled').checked,
    ma3Source: { type: 'osc', match: $('#m-fb-src').value.trim() },
    transform: { inputRange: [0,1], outputRange: [0,1], curve: 'linear' },
    destination: { type: 'osc', host: $('#m-fb-host').value.trim(), port: Number($('#m-fb-port').value) || null, address: $('#m-fb-addr').value.trim(), argType: $('#m-fb-argtype').value },
  };
  await saveMapping(x);
  closeEditor();
}
async function saveMapping(m) {
  const r = await fetch('/api/mappings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
  if (!r.ok) alert('Save failed: ' + (await r.text()));
}

// ---- Monitor ----
$('#monitor-pause').addEventListener('change', (e) => state.monitorPaused = e.target.checked);
$('#btn-clear-monitor').addEventListener('click', () => { $('#monitor').innerHTML = ''; });

function addMonitor(ev) {
  if (state.monitorPaused) return;
  const monitor = $('#monitor');
  const row = document.createElement('div');
  const dir = ev.direction || 'log';
  row.className = `ev ${dir}`;
  const time = new Date(ev.ts || Date.now()).toLocaleTimeString();
  const tx = (ev.transport || '').padEnd(6);
  let body = '';
  if (ev.event && ev.event.address) body = `${ev.event.address} ${JSON.stringify(ev.event.args || [])}`;
  else if (ev.event && ev.event.line) body = ev.event.line;
  else body = JSON.stringify(ev.event || {});
  if (ev.error) body = 'ERROR: ' + ev.error;
  row.innerHTML = `<span class="ts"></span><span class="dir"></span><span class="tx"></span><span class="body"></span>`;
  row.children[0].textContent = time;
  row.children[1].textContent = dir;
  row.children[2].textContent = tx;
  row.children[3].textContent = body;
  monitor.appendChild(row);
  while (monitor.children.length > 500) monitor.removeChild(monitor.firstChild);
  monitor.scrollTop = monitor.scrollHeight;
}

// ---- helpers ----
function getDotted(obj, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), obj); }
function setDotted(obj, p, v) { const parts = p.split('.'); let n = obj; for (let i = 0; i < parts.length - 1; i++) { n[parts[i]] ||= {}; n = n[parts[i]]; } n[parts[parts.length-1]] = v; }
function parseRange(s, fallback) { if (!s) return fallback; const parts = s.split(',').map((x) => Number(x.trim())); return parts.length === 2 && !parts.some(Number.isNaN) ? parts : fallback; }
function tryNumber(s) { const n = Number(s); return Number.isFinite(n) ? n : s; }

// ---- Presets (modal-based, intuitive) ----
$('#btn-save-preset').addEventListener('click', async () => {
  const name = prompt('Save current mappings as preset (name):', 'My MA3 setup');
  if (!name) return;
  const description = prompt('Optional description:') || '';
  const r = await fetch('/api/presets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, description }) });
  if (!r.ok) return alert('Save failed.');
  alert('Preset saved.');
});
$('#btn-load-presets').addEventListener('click', async () => {
  const r = await fetch('/api/presets'); const j = await r.json();
  const list = j.presets || [];
  if (!list.length) return alert('No presets yet. Use "Save as preset…" first, or drop JSON files into data/presets/.');
  // Build inline modal
  const overlay = document.createElement('div');
  overlay.className = 'modal'; overlay.innerHTML = `
    <div class="modal-card">
      <header><h3>Load preset</h3><button class="btn icon" data-close="1">×</button></header>
      <div class="modal-body">
        <div class="preset-modal-list" id="preset-list"></div>
      </div>
      <footer><span class="muted" style="margin-right:auto; font-size:11px;">Click a preset to load it. Hold Shift while clicking to merge instead of replace.</span><button class="btn" data-close="1">Cancel</button></footer>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close));
  const grid = overlay.querySelector('#preset-list');
  for (const p of list) {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.innerHTML = `<div class="pname"></div><div class="pdesc"></div><div class="pmeta"></div>`;
    card.children[0].textContent = p.name;
    card.children[1].textContent = p.description || '';
    card.children[2].textContent = `${p.count} mapping${p.count === 1 ? '' : 's'}  •  ${p.file}`;
    card.addEventListener('click', async (ev) => {
      const mode = ev.shiftKey ? 'merge' : 'replace';
      await fetch('/api/presets/load', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: p.file, mode }) });
      close();
    });
    grid.appendChild(card);
  }
});

// ---- Help: searchable index ----
const HELP_TOPICS = [
  { topic: 'Quickstart — first mapping', tags: ['setup','intro','first'], blurb: 'Open MA3 → Network → OSC. Enable interface at 127.0.0.1, in 8000 / out 8001. Match in Settings here. Use the Quick Test field to send /Page1/Fader201 = 0.5.' },
  { topic: 'Stream Deck + setup', tags: ['streamdeck','sd+','hid'], blurb: 'Quit Elgato app. Plug deck in. ENCpatch claims it via USB-HID and auto-maps the 4 encoders + 8 keys (1=Dimmer, 2=Position, ... 8=Shapers).' },
  { topic: 'Page-aware encoders', tags: ['page','encoder','bank'], blurb: 'Click any page button at top of Visual Builder. Mapper sends Select EncoderBank N to MA3 AND rebinds the SD+ encoders. With Lua bridge installed, attributes are read live from MA3 instead of using static defaults.' },
  { topic: 'Coarse vs fine encoder mode', tags: ['encoder','coarse','fine','step'], blurb: 'Press the SD+ encoder to toggle. LCD turns YELLOW for fine. Per-mapping coarseStep/fineStep override the defaults (0.5 / 0.1).' },
  { topic: 'OSC /cmd address', tags: ['osc','cmd','protocol'], blurb: 'MA3 has a built-in OSC endpoint /cmd that takes a string command. Mapper uses this for all encoder ticks: Attribute "Dimmer" At + 0.5 etc.' },
  { topic: 'MA3 Lua bridge', tags: ['lua','bridge','plugin','tcp'], blurb: 'Install MA3MapperBridge.lua as a plugin in MA3. Listens on TCP 9001. Lets mapper run Cmd() and read live encoder attributes via getAttrs query.' },
  { topic: 'Bank-select command syntax', tags: ['cmd','bank','encoderbank'], blurb: 'Default: "Select EncoderBank $bank". Edit pageBinder.bankCommandTemplate in config.json if your MA3 needs different syntax. $bank = 1..8, $name = page name.' },
  { topic: 'LCD swipe to change page', tags: ['lcd','swipe','page'], blurb: 'Swipe right on the SD+ touch strip = next bank. Swipe left = previous bank.' },
  { topic: 'Per-page attribute editor', tags: ['page','editor','attribute'], blurb: 'In Visual Builder page row, click "edit page attributes". Pick the 4 encoder attributes per page from the catalog. Saves to config.json under pageBinder.pageMap.' },
  { topic: 'Multi-device support', tags: ['device','multi','3'], blurb: 'Click "+ Add device" in Visual Builder toolbar. Up to 3 devices total. Each device gets its own address prefix (/sd, /sd2, /sd3) so mappings can target a specific device.' },
  { topic: 'Companion module', tags: ['companion','bitfocus','module'], blurb: 'companion-module/ folder. Drop into Companion\'s developer modules path; restart Companion. Use "Fire mapping" actions to trigger any mapping by trigger address.' },
  { topic: 'Native Stream Deck plugin', tags: ['streamdeck','plugin','native'], blurb: 'streamdeck-plugin/ folder. Copy com.ma3mapper.bridge.sdPlugin into ~/Library/Application Support/com.elgato.StreamDeck/Plugins/. Lets SD coexist with Elgato app.' },
  { topic: 'Web Control test deck', tags: ['test','web','virtual'], blurb: 'Pick "Web Control" in the Stream Deck dropdown. Enable Test mode. Click anything to fire the corresponding /sd/key or /sd/enc OSC event. Lets you test mappings without hardware.' },
  { topic: 'Troubleshoot: HID can\'t claim', tags: ['hid','permission','blocked'], blurb: 'Run node diagnose-streamdeck.js. Most common: Elgato app still running (pkill -9 "Stream Deck"); macOS Input Monitoring not granted to Terminal.' },
  { topic: 'Troubleshoot: Illegal object Fixture mainTask', tags: ['error','maintask','illegal'], blurb: 'Old config had MainTask in the bank command. Restart server — it auto-migrates to "Select EncoderBank $bank". Or delete config.json and let it regenerate.' },
  { topic: 'MA3 attribute database', tags: ['attribute','catalog','reference'], blurb: 'data/ma3-attributes.json. Lists all common MA3 attribute names per group (Intensity, Position, Color RGB/CMY, Gobo, Beam, Prism, Shapers).' },
  { topic: 'Save & load presets', tags: ['preset','save','load'], blurb: 'Mappings tab → Save as preset (writes JSON to data/presets/) or Load preset (modal picker). Hold Shift on a preset to merge instead of replace.' },
];

function renderHelp(query) {
  const grid = document.getElementById('help-results');
  if (!grid) return;
  const q = (query || '').toLowerCase().trim();
  const matches = !q ? HELP_TOPICS : HELP_TOPICS.filter((t) =>
    t.topic.toLowerCase().includes(q) ||
    t.blurb.toLowerCase().includes(q) ||
    t.tags.some((tag) => tag.includes(q))
  );
  grid.innerHTML = '';
  if (!matches.length) { grid.innerHTML = '<div class="muted" style="padding:20px;">No topics match.</div>'; return; }
  for (const t of matches) {
    const card = document.createElement('div'); card.className = 'help-card';
    card.innerHTML = `<div class="topic"></div><div class="blurb"></div><div class="tags"></div>`;
    card.children[0].textContent = t.topic;
    card.children[1].textContent = t.blurb;
    for (const tag of t.tags) {
      const s = document.createElement('span'); s.className = 'tag'; s.textContent = tag;
      card.children[2].appendChild(s);
    }
    grid.appendChild(card);
  }
}
document.getElementById('help-search')?.addEventListener('input', (e) => renderHelp(e.target.value));
renderHelp('');

// ============================================================
// Visual builder
// ============================================================
const vb = {
  layouts: { consoles: [], streamDecks: [] },
  console: null,
  streamDeck: null,
  page: 1,
  selection: null,    // { side: 'console'|'sd', ctrl, label }
  states: {},         // mapping id -> live value
  prevStates: {},     // mapping id -> previous live value (for detecting changes)
  pushedFaders: {},   // mapping id -> timeout id for clearing .pushed class
};

const vbPageState = { catalog: [], pageMap: {}, editing: null };

async function vbReloadDevices() {
  try {
    const r = await fetch('/api/devices'); const j = await r.json();
    const devices = j.devices || [];
    const col = document.getElementById('vb-devices-col');
    if (!col) return;
    col.innerHTML = '';
    if (devices.length === 0) {
      // Fallback: render the legacy single Stream Deck pane
      const pane = vbBuildDevicePane({ id: 'slot1', addressPrefix: '/sd', name: 'Stream Deck', layoutId: (vb.streamDeck && vb.streamDeck.id) || 'sd-plus' }, false);
      col.appendChild(pane);
      vbRenderStreamDeckIntoSvg(pane.querySelector('svg'), '/sd');
      return;
    }
    for (const dev of devices) {
      const pane = vbBuildDevicePane(dev, devices.length > 1);
      col.appendChild(pane);
      const layout = vb.layouts.streamDecks.find((s) => s.id === dev.layoutId) || vb.streamDeck;
      vbRenderDeviceSvg(pane.querySelector('svg'), layout, dev.addressPrefix);
    }
  } catch (err) {
    console.warn('reloadDevices failed', err);
  }
}

function vbBuildDevicePane(dev, showRemove) {
  const pane = document.createElement('div'); pane.className = 'vb-pane';
  const head = document.createElement('div'); head.className = 'vb-device-pane-head';
  head.innerHTML = `<div class="vb-pane-title"></div><div class="device-actions"><span class="device-tag"></span></div>`;
  head.querySelector('.vb-pane-title').textContent = dev.name || 'Device';
  head.querySelector('.device-tag').textContent = dev.addressPrefix;
  if (showRemove) {
    const rm = document.createElement('button');
    rm.className = 'btn'; rm.textContent = '× remove';
    rm.style.fontSize = '10px';
    rm.addEventListener('click', async () => {
      if (!confirm(`Remove ${dev.name}? Mappings keyed at ${dev.addressPrefix}/... will stay in config.`)) return;
      await fetch(`/api/devices/${encodeURIComponent(dev.id)}`, { method: 'DELETE' });
      await vbReloadDevices();
    });
    head.querySelector('.device-actions').appendChild(rm);
  }
  pane.appendChild(head);
  const wrap = document.createElement('div'); wrap.className = 'vb-svg-wrap';
  wrap.innerHTML = `<svg preserveAspectRatio="xMidYMid meet"></svg>`;
  pane.appendChild(wrap);
  return pane;
}

function vbRenderDeviceSvg(svg, layout, addressPrefix) {
  if (!layout) return;
  const [vbX, vbY, vbW, vbH] = layout.viewBox || [0, 0, 540, 360];
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.innerHTML = '';
  for (const ctrl of layout.controls || []) {
    const node = buildControlNode('sd', { ...ctrl, addressTemplate: ctrl.addressTemplate.replace(/^\/sd/, addressPrefix) });
    svg.appendChild(node);
  }
}

function vbRenderStreamDeckIntoSvg(svg, addressPrefix) {
  if (!vb.streamDeck) return;
  vbRenderDeviceSvg(svg, vb.streamDeck, addressPrefix);
}

// Compute the data shape for the encoder bar — pure function, no DOM.
// Returns array of 4 cell descriptors: { attr, step, bound, fine, group }.
async function vbComputeEncoderBarData() {
  let mappings = state.mappings || [];
  try {
    const r = await fetch('/api/mappings/effective');
    if (r.ok) { const j = await r.json(); mappings = j.mappings || mappings; }
  } catch (_) {}

  let liveSlots = [null, null, null, null];
  try {
    const sr = await fetch('/api/state');
    if (sr.ok) {
      const sj = await sr.json();
      if (sj.pageBinder && Array.isArray(sj.pageBinder.encoderBarSlots)) {
        liveSlots = sj.pageBinder.encoderBarSlots;
      }
    }
  } catch (_) {}

  const byEnc = new Map();
  for (const m of mappings) {
    const t = m.trigger; if (!t || t.type !== 'osc') continue;
    const g = t.match && t.match.match(/^\/sd\/enc\/(\d+)$/);
    if (g) byEnc.set(Number(g[1]), m);
  }

  const cells = [];
  for (let i = 1; i <= 4; i++) {
    const m = byEnc.get(i);
    const live = liveSlots[i - 1];
    const bound = !!m;
    const fine = !!(m && m._encoderMode === 'fine');
    let attr = '—', step = '', group = null;
    if (m) {
      if (live && live !== 'null') {
        attr = live;
        // Try to find the group for this live attribute
        for (const cat of vbPageState.catalog) {
          if (cat.name === live) { group = cat.group; break; }
        }
      } else {
        const tpl = (m.action && m.action.template) || '';
        const am = tpl.match(/Attribute "([^"]+)"/);
        if (am) {
          attr = am[1];
          // Find group for this attribute
          for (const cat of vbPageState.catalog) {
            if (cat.name === attr) { group = cat.group; break; }
          }
        }
        else if (m.action && m.action.type === 'bridgeTick') attr = '—';
        else attr = m.name || `Enc ${i}`;
      }
      const t = m.transform || {};
      const stepVal = fine ? (t.fineStep ?? 0.1) : (t.coarseStep ?? t.step ?? 0.5);
      step = `${fine ? 'FINE' : 'coarse'}  ${stepVal}`;
    }
    cells.push({ attr, step, bound, fine, group });
  }
  return cells;
}

// Render encoder bar surgically — only updates what changed. Builds the
// cell DOM once on first call, then mutates classList + textContent on
// subsequent calls. No teardown = no flicker.
let _vbEncBarLast = null;
async function vbRenderEncoderBar(force = false) {
  const el = document.getElementById('vb-encoder-bar');
  if (!el) return;
  const cells = await vbComputeEncoderBarData();

  // Skip render if nothing changed (cheap diff via JSON.stringify).
  const sig = JSON.stringify(cells);
  if (!force && sig === _vbEncBarLast) return;
  _vbEncBarLast = sig;

  // Build cells once if missing, then mutate in place
  if (el.children.length !== 4) {
    el.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
      const cell = document.createElement('div');
      cell.className = 'enc-cell empty';
      cell.innerHTML = `<div class="num">Encoder ${i}</div><div class="name">—</div><div class="step"></div>`;
      el.appendChild(cell);
    }
  }
  cells.forEach((c, idx) => {
    const cell = el.children[idx];
    if (!cell) return;
    // Build class: enc-cell + (bound|empty) + (fine) + (group color)
    let grp = '';
    if (c.group) grp = ` grp-${c.group.toLowerCase().replace(/\s+/g, '-')}`;
    const wantClass = 'enc-cell' + (c.bound ? ' bound' : ' empty') + (c.fine ? ' fine' : '') + grp;
    if (cell.className !== wantClass) cell.className = wantClass;
    const nameEl = cell.children[1];
    const stepEl = cell.children[2];
    if (nameEl && nameEl.textContent !== c.attr) nameEl.textContent = c.attr;
    if (stepEl && stepEl.textContent !== c.step) stepEl.textContent = c.step;
  });
}

// Auto-refresh the encoder bar so it follows MA3 changes without the
// user clicking anywhere. 2s cadence (data only changes when MA3 user
// switches feature group — no need for tight polling). Surgical render
// inside vbRenderEncoderBar means no DOM thrash even if we polled faster.
function startEncoderBarAutoRefresh() {
  if (window._encBarTimer) return;
  window._encBarTimer = setInterval(() => {
    if (document.querySelector('#tab-visual.active')) {
      vbRenderEncoderBar().catch(() => {});
    }
  }, 2000);
}

async function vbLoadPages() {
  try {
    const [listR, mapR] = await Promise.all([fetch('/api/page/list'), fetch('/api/page/map')]);
    const j = await listR.json();
    const m = await mapR.json();
    vbPageState.catalog = m.catalog || [];
    vbPageState.pageMap = m.pageMap || {};
    const row = document.getElementById('vb-pages-row');
    if (!row) return;
    // v0.13.33: hide the MA3 page selector entirely when console is Eos.
    // Pages/feature-groups are MA3 concepts; Eos uses categories driven
    // by the SD top-row buttons (Intensity/Color/Image/...) which live
    // in the encoder-bar widget, not here.
    const consoleId = (state.config && state.config.console) || 'ma3';
    if (consoleId !== 'ma3') {
      row.hidden = true;
      const editor = document.getElementById('vb-page-editor');
      if (editor) editor.hidden = true;
      return;
    }
    row.innerHTML = '';
    if (!j.pages || j.pages.length === 0) { row.hidden = true; return; }
    row.hidden = false;
    for (let i = 0; i < j.pages.length; i++) {
      const p = j.pages[i];
      const b = document.createElement('button');
      b.className = 'page-btn' + (p === j.current ? ' active' : '');
      b.textContent = p;
      b.dataset.page = p;
      b.dataset.num = String(i + 1);
      b.addEventListener('click', async () => {
        await fetch('/api/page/set', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: p }) });
      });
      row.appendChild(b);
    }
    const editLink = document.createElement('span');
    editLink.className = 'edit-link';
    editLink.textContent = 'edit page attributes…';
    editLink.addEventListener('click', () => {
      // Read the currently-active page from the DOM at click time so we
      // always open the editor for whatever the user is looking at — not
      // whatever was active when this row was rendered.
      const activeBtn = document.querySelector('#vb-pages-row .page-btn.active');
      const target = (activeBtn && activeBtn.dataset.page) || j.pages[0];
      vbOpenPageEditor(target);
    });
    row.appendChild(editLink);
    const meta = document.createElement('span');
    meta.className = 'page-meta';
    meta.textContent = 'click a page to rebind encoders + tell MA3';
    row.appendChild(meta);
  } catch (_) {}
}

function vbOpenPageEditor(pageName) {
  const editor = document.getElementById('vb-page-editor');
  if (!editor) return;
  vbPageState.editing = pageName;
  const current = vbPageState.pageMap[pageName] || [null, null, null, null];
  editor.hidden = false;
  editor.innerHTML = '';
  const h = document.createElement('h4');
  h.textContent = `Configure encoders for "${pageName}"`;
  editor.appendChild(h);
  const row = document.createElement('div');
  row.className = 'row';
  for (let i = 0; i < 4; i++) {
    const wrap = document.createElement('label');
    wrap.innerHTML = `Encoder ${i + 1}`;
    const sel = document.createElement('select');
    sel.dataset.idx = i;
    const none = document.createElement('option'); none.value = ''; none.textContent = '— none —'; sel.appendChild(none);
    let lastGroup = null, og = null;
    for (const a of vbPageState.catalog) {
      if (a.group !== lastGroup) {
        og = document.createElement('optgroup'); og.label = a.group; sel.appendChild(og); lastGroup = a.group;
      }
      const o = document.createElement('option');
      o.value = a.name; o.textContent = `${a.label} — ${a.name}`;
      if (current[i] === a.name) o.selected = true;
      og.appendChild(o);
    }
    wrap.appendChild(sel);
    row.appendChild(wrap);
  }
  editor.appendChild(row);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const cancel = document.createElement('button'); cancel.className = 'btn'; cancel.textContent = 'Close';
  cancel.addEventListener('click', () => { editor.hidden = true; vbPageState.editing = null; });
  const save = document.createElement('button'); save.className = 'btn primary'; save.textContent = `Save "${pageName}"`;
  save.addEventListener('click', async () => {
    const attrs = Array.from(editor.querySelectorAll('select')).map((s) => s.value || null);
    await fetch('/api/page/map', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: pageName, attrs }) });
    vbPageState.pageMap[pageName] = attrs;
    save.textContent = 'Saved ✓';
    setTimeout(() => save.textContent = `Save "${pageName}"`, 1200);
  });
  actions.appendChild(cancel); actions.appendChild(save);
  editor.appendChild(actions);
}

async function vbInit() {
  const r = await fetch('/api/layouts');
  vb.layouts = await r.json();
  // Load MA3 attribute catalog for the cmd-tick attribute picker
  try {
    const ar = await fetch('/api/attributes');
    if (ar.ok) {
      const aj = await ar.json();
      const sel = $('#vb-attr');
      for (const grp of aj.groups || []) {
        const og = document.createElement('optgroup'); og.label = grp.group;
        for (const a of grp.attributes) {
          const o = document.createElement('option'); o.value = a.name; o.textContent = `${a.label} — ${a.name}`;
          og.appendChild(o);
        }
        sel.appendChild(og);
      }
    }
  } catch (_) {}

  const consoleSel = $('#vb-console');
  consoleSel.innerHTML = '';
  for (const c of vb.layouts.consoles) {
    const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; consoleSel.appendChild(o);
  }
  consoleSel.addEventListener('change', () => { vb.console = vb.layouts.consoles.find((c) => c.id === consoleSel.value); vbRenderConsole(); });

  const sdSel = $('#vb-streamdeck');
  sdSel.innerHTML = '';
  for (const s of vb.layouts.streamDecks) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; sdSel.appendChild(o);
  }
  sdSel.addEventListener('change', () => { vb.streamDeck = vb.layouts.streamDecks.find((s) => s.id === sdSel.value); vbRenderStreamDeck(); });

  const pageSel = $('#vb-page');
  pageSel.innerHTML = '';
  for (let p = 1; p <= 30; p++) { const o = document.createElement('option'); o.value = p; o.textContent = `Page ${p}`; pageSel.appendChild(o); }
  pageSel.addEventListener('change', () => { vb.page = Number(pageSel.value) || 1; vbRenderConsole(); });

  // Prefer "live" (auto-detected hardware) entries over emulators.
  vb.console = vb.layouts.consoles.find((c) => c.live) || vb.layouts.consoles[0] || null;
  vb.streamDeck = vb.layouts.streamDecks.find((s) => s.live) || vb.layouts.streamDecks.find((s) => s.id === 'sd-plus') || vb.layouts.streamDecks[0] || null;
  if (vb.console) consoleSel.value = vb.console.id;
  if (vb.streamDeck) sdSel.value = vb.streamDeck.id;
  pageSel.value = vb.page;

  vbRenderConsole();
  vbRenderStreamDeck();
  vbLoadPages();
  vbRenderEncoderBar();
  vbInitPanZoom();

  $('#vb-clear').addEventListener('click', vbClearSelection);
  $('#vb-add-device').addEventListener('click', async () => {
    const sd = vb.streamDeck;
    if (!sd) return alert('Pick a Stream Deck layout first.');
    const r = await fetch('/api/devices', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'streamdeck', layoutId: sd.id, name: sd.name }),
    });
    const j = await r.json();
    if (!r.ok) return alert('Failed to add device: ' + (j.error || r.status));
    await vbReloadDevices();
  });
  vbReloadDevices();
  $('#vb-bind-cancel').addEventListener('click', vbClearSelection);
  $('#vb-bind-save').addEventListener('click', vbCreateBinding);

  // Refresh live fader/encoder state every 250ms
  setInterval(vbRefreshStates, 250);
}

function vbAddrFor(side, ctrl) {
  const tpl = ctrl.addressTemplate || '';
  return tpl.replace('{P}', String(vb.page));
}

function vbRenderConsole() {
  const svg = $('#vb-console-svg');
  if (!vb.console) return;
  $('#vb-console-title').textContent = vb.console.name;
  const [vbX, vbY, vbW, vbH] = vb.console.viewBox || [0, 0, 1100, 500];
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.innerHTML = '';
  for (const sec of vb.console.sections || []) {
    for (const ctrl of sec.controls || []) {
      svg.appendChild(buildControlNode('console', ctrl));
    }
  }
  vbDecorateBindings('console');
}

function vbRenderStreamDeck() {
  const svg = $('#vb-sd-svg');
  if (!vb.streamDeck) return;
  $('#vb-sd-title').textContent = vb.streamDeck.name;
  const [vbX, vbY, vbW, vbH] = vb.streamDeck.viewBox || [0, 0, 540, 360];
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.innerHTML = '';
  for (const ctrl of vb.streamDeck.controls || []) {
    svg.appendChild(buildControlNode('sd', ctrl));
  }
  vbDecorateBindings('sd');
}

function buildControlNode(side, ctrl) {
  const NS = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'ctrl');
  g.dataset.side = side;
  g.dataset.id = ctrl.id;

  if (ctrl.kind === 'encoder') {
    const cx = ctrl.x + ctrl.w / 2, cy = ctrl.y + ctrl.h / 2, r = Math.min(ctrl.w, ctrl.h) / 2 - 2;
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'body');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    g.appendChild(c);
    addLabel(g, ctrl.label, cx, cy + 4, 'middle');
  } else if (ctrl.kind === 'fader') {
    const body = document.createElementNS(NS, 'rect');
    body.setAttribute('class', 'body');
    body.setAttribute('x', ctrl.x); body.setAttribute('y', ctrl.y);
    body.setAttribute('width', ctrl.w); body.setAttribute('height', ctrl.h);
    body.setAttribute('rx', 6);
    g.appendChild(body);
    // value fill (driven by live state if present)
    const fill = document.createElementNS(NS, 'rect');
    fill.setAttribute('class', 'value-fill');
    fill.setAttribute('x', ctrl.x + 4); fill.setAttribute('y', ctrl.y + ctrl.h - 4);
    fill.setAttribute('width', ctrl.w - 8); fill.setAttribute('height', 0);
    g.appendChild(fill);
    addLabel(g, ctrl.label, ctrl.x + ctrl.w / 2, ctrl.y + 14, 'middle');
  } else if (ctrl.kind === 'lcd') {
    const body = document.createElementNS(NS, 'rect');
    body.setAttribute('class', 'body');
    body.setAttribute('x', ctrl.x); body.setAttribute('y', ctrl.y);
    body.setAttribute('width', ctrl.w); body.setAttribute('height', ctrl.h);
    body.setAttribute('rx', 4);
    g.appendChild(body);
    addLabel(g, ctrl.label, ctrl.x + ctrl.w / 2, ctrl.y + ctrl.h / 2 + 4, 'middle');
  } else { // key, flash, generic
    const body = document.createElementNS(NS, 'rect');
    body.setAttribute('class', 'body');
    body.setAttribute('x', ctrl.x); body.setAttribute('y', ctrl.y);
    body.setAttribute('width', ctrl.w); body.setAttribute('height', ctrl.h);
    body.setAttribute('rx', 6);
    g.appendChild(body);
    addLabel(g, ctrl.label, ctrl.x + ctrl.w / 2, ctrl.y + ctrl.h / 2 + 4, 'middle');
  }

  g.addEventListener('click', (e) => {
    if (document.getElementById('vb-test-mode')?.checked) {
      vbInject(side, ctrl, e);
    } else {
      vbSelect(side, ctrl, g);
    }
  });
  return g;
}

// Test-mode: inject a live OSC event into the engine. Ticks for encoders,
// press+release for keys, half-value for faders.
async function vbInject(side, ctrl, e) {
  const addr = vbAddrFor(side, ctrl);
  let args = [1];
  if (ctrl.kind === 'encoder') {
    args = [(e.ctrlKey || e.metaKey || e.altKey) ? -1 : 1];
  } else if (ctrl.kind === 'fader') {
    args = [0.5];
  } else if (ctrl.kind === 'key' || ctrl.kind === 'flash') {
    args = [1];
  }
  await fetch('/api/inject', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: addr, args }),
  });
  // For keys, send a release after 80 ms so press-only mappings fire cleanly.
  if (ctrl.kind === 'key' || ctrl.kind === 'flash') {
    setTimeout(() => fetch('/api/inject', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: addr, args: [0] }),
    }), 80);
  }
}

function addLabel(g, text, x, y, anchor) {
  const NS = 'http://www.w3.org/2000/svg';
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', x); t.setAttribute('y', y); t.setAttribute('text-anchor', anchor || 'middle');
  t.textContent = text;
  g.appendChild(t);
}

function vbSelect(side, ctrl, node) {
  // toggle if clicking same side again
  $$('#vb-console-svg .ctrl, #vb-sd-svg .ctrl').forEach((n) => {
    if (n.dataset.side === side) n.classList.remove('selected');
  });
  node.classList.add('selected');

  const newSel = { side, ctrl, label: `${ctrl.label} (${vbAddrFor(side, ctrl)})` };
  if (!vb.selection || vb.selection.side === side) {
    vb.selection = { primary: newSel, secondary: null };
    $('#vb-hint').textContent = `Now click a target on the ${side === 'console' ? 'Stream Deck' : 'console'} side.`;
    $('#vb-binding-card').hidden = true;
  } else {
    vb.selection.secondary = newSel;
    showBindingCard();
  }
}

function vbClearSelection() {
  vb.selection = null;
  $$('#vb-console-svg .ctrl, #vb-sd-svg .ctrl').forEach((n) => n.classList.remove('selected'));
  $('#vb-binding-card').hidden = true;
  $('#vb-hint').textContent = 'Click a control on either side to start a binding.';
}

function showBindingCard() {
  const { primary, secondary } = vb.selection;
  const consoleSide = primary.side === 'console' ? primary : secondary;
  const sdSide      = primary.side === 'sd'      ? primary : secondary;
  $('#vb-bind-label').textContent = `${sdSide.ctrl.label} (Stream Deck) ⇄ ${consoleSide.ctrl.label} (MA3)`;

  // Auto-pick a sensible behavior
  const sdK = sdSide.ctrl.kind, csK = consoleSide.ctrl.kind;
  let mode = 'button';
  let warn = '';
  if (sdK === 'encoder' && csK === 'encoder') mode = 'cmd-tick';     // recommended
  else if (sdK === 'encoder' && csK === 'fader') mode = 'cmd-tick';  // works via /cmd Fader
  else if (sdK === 'key' && csK === 'fader') {
    mode = 'button';
    warn = 'Stream Deck keys send press/release (1/0). To get continuous 0–100 fader control, use an SD+ encoder instead. With this binding, pressing the key will set the fader to full and release sets it to 0.';
  } else if (sdK === 'key') mode = 'button';
  $('#vb-mode').value = 'auto';
  $('#vb-mode').dataset.suggested = mode;
  $('#vb-hint').textContent = warn || `Suggested mode: ${mode}.`;

  $('#vb-binding-card').hidden = false;
}

async function vbCreateBinding() {
  if (!vb.selection || !vb.selection.secondary) return;
  const { primary, secondary } = vb.selection;
  const consoleSide = primary.side === 'console' ? primary : secondary;
  const sdSide      = primary.side === 'sd'      ? primary : secondary;

  let modeRaw = $('#vb-mode').value;
  if (modeRaw === 'auto') modeRaw = $('#vb-mode').dataset.suggested || 'button';

  const sdAddr = vbAddrFor('sd', sdSide.ctrl);
  const consoleAddr = vbAddrFor('console', consoleSide.ctrl);
  const argType = $('#vb-argtype').value;
  const curve = $('#vb-curve').value;
  const step = Number($('#vb-step').value) || 0.01;
  const wantsFb = $('#vb-feedback').checked;

  const m = {
    name: `${sdSide.ctrl.label} → ${consoleSide.ctrl.label}`,
    enabled: true,
    trigger: { type: 'osc', match: sdAddr, fromHost: null },
    transform: {
      fromArgIndex: 0,
      inputRange: [0, 1],
      outputRange: [0, 1],
      curve,
    },
    action: {
      type: 'osc',
      address: consoleAddr,
      argType,
    },
  };
  if (modeRaw === 'button') {
    m.transform.onlyOn = 1;
    m.action.argType = 'f';
  } else if (modeRaw === 'fader') {
    // straight pass-through (default)
  } else if (modeRaw === 'accumulate') {
    m.transform.mode = 'accumulate';
    m.transform.step = step;
  } else if (modeRaw === 'relay') {
    m.transform.mode = 'relay';
    m.transform.step = step;
  } else if (modeRaw === 'cmd-tick') {
    // Use OSC /cmd path. Pick attribute from the dropdown (or default to Dimmer).
    const attr = ($('#vb-attr').value || 'Dimmer');
    m.transform = { mode: 'cmd-tick', step };
    m.action = { type: 'cmd', template: `Attribute "${attr}" At $sign $abs` };
  }
  if (wantsFb) {
    m.feedback = {
      enabled: true,
      ma3Source: { type: 'osc', match: consoleAddr },
      transform: { inputRange: [0, 1], outputRange: [0, 1], curve: 'linear' },
      destination: { type: 'osc', host: '127.0.0.1', port: 9000, address: sdAddr + '/state', argType: 'f' },
    };
  }

  await saveMapping(m);
  vbClearSelection();
  // Optional toast
  $('#vb-hint').textContent = 'Mapping created. Use Companion (or your OSC controller) to send to the trigger address.';
}

function vbDecorateBindings(side) {
  const svg = side === 'console' ? $('#vb-console-svg') : $('#vb-sd-svg');
  const list = state.mappings || [];
  for (const node of svg.querySelectorAll('.ctrl')) {
    const ctrl = vbFindCtrl(side, node.dataset.id);
    if (!ctrl) continue;
    const addr = vbAddrFor(side, ctrl);
    const isBound = list.some((m) => mappingTouches(m, addr));
    node.classList.toggle('bound', isBound);
  }
}
function mappingTouches(m, addr) {
  if (m.trigger && m.trigger.match === addr) return true;
  if (m.action && m.action.address === addr) return true;
  if (m.feedback && m.feedback.enabled && m.feedback.ma3Source && m.feedback.ma3Source.match === addr) return true;
  if (m.feedback && m.feedback.enabled && m.feedback.destination && m.feedback.destination.address === addr) return true;
  return false;
}
function vbFindCtrl(side, id) {
  if (side === 'console') {
    for (const sec of (vb.console && vb.console.sections) || []) {
      const c = sec.controls.find((c) => c.id === id);
      if (c) return c;
    }
    return null;
  }
  return (vb.streamDeck && vb.streamDeck.controls || []).find((c) => c.id === id);
}

async function vbRefreshStates() {
  if (!$('#tab-visual').classList.contains('active')) return;
  try {
    const r = await fetch('/api/mappings/state'); const j = await r.json();
    vb.states = Object.fromEntries((j.states || []).map((s) => [s.id, s.state]));
  } catch (_) { return; }
  // Update fader fill rects on console side based on the address values they track
  for (const node of $('#vb-console-svg').querySelectorAll('.ctrl')) {
    const ctrl = vbFindCtrl('console', node.dataset.id);
    if (!ctrl || ctrl.kind !== 'fader') continue;
    const addr = vbAddrFor('console', ctrl);
    // Find a mapping whose action targets this addr; use its accumulator state
    let val = null, mappingId = null;
    for (const m of state.mappings || []) {
      if (m.action && m.action.address === addr && vb.states[m.id] != null) { val = vb.states[m.id]; mappingId = m.id; break; }
    }
    if (val == null) continue;
    const fill = node.querySelector('rect.value-fill');
    if (!fill) continue;
    const h = Math.max(0, Math.min(1, val)) * (ctrl.h - 8);
    fill.setAttribute('y', ctrl.y + ctrl.h - 4 - h);
    fill.setAttribute('height', h);

    // Track fader "pushed" state — if the value changed, mark it as active/pushed
    if (mappingId && vb.prevStates[mappingId] !== val) {
      vb.prevStates[mappingId] = val;
      // Clear any existing timeout for this fader
      if (vb.pushedFaders[mappingId]) clearTimeout(vb.pushedFaders[mappingId]);
      // Add .pushed class
      node.classList.add('pushed');
      // Remove .pushed class after 300ms of inactivity
      vb.pushedFaders[mappingId] = setTimeout(() => {
        node.classList.remove('pushed');
        delete vb.pushedFaders[mappingId];
      }, 300);
    }
  }
}

// ---- Pan/Zoom/Resize support ----
// Store pan/zoom state per SVG
const vbPanZoom = {
  'vb-console-svg': { offsetX: 0, offsetY: 0, scale: 1 },
  'vb-sd-svg': { offsetX: 0, offsetY: 0, scale: 1 },
};

function vbInitPanZoom() {
  // Pan/zoom for console SVG
  vbSetupSvgPanZoom('vb-console-svg');
  // Pan/zoom for Stream Deck SVG
  vbSetupSvgPanZoom('vb-sd-svg');
  // Pan/zoom for additional device SVGs (added dynamically)
  setInterval(() => {
    $$('.vb-svg-wrap svg').forEach((svg) => {
      if (!svg.dataset.panZoomInitialized) {
        vbSetupSvgPanZoom(svg);
        svg.dataset.panZoomInitialized = 'true';
      }
    });
  }, 500);

  // Canvas resizer (drag to resize console vs devices columns)
  vbSetupCanvasResizer();
}

function vbSetupSvgPanZoom(svgIdOrElement) {
  const svg = typeof svgIdOrElement === 'string' ? $(`#${svgIdOrElement}`) : svgIdOrElement;
  if (!svg || svg.dataset.panZoomInitialized) return;
  svg.dataset.panZoomInitialized = 'true';

  let isPanning = false, panStartX = 0, panStartY = 0;

  svg.addEventListener('mousedown', (e) => {
    // Only pan if Shift+click or middle mouse, but NOT on a control element
    const isOnControl = e.target.closest('.ctrl');
    const isShiftDrag = e.shiftKey && e.button === 0;
    const isMiddleDrag = e.button === 1;

    if ((isShiftDrag || isMiddleDrag) && !isOnControl) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      svg.classList.add('panning');
      e.preventDefault();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    panStartX = e.clientX;
    panStartY = e.clientY;

    // Get or init pan/zoom state for this SVG
    const id = svg.id;
    if (!vbPanZoom[id]) vbPanZoom[id] = { offsetX: 0, offsetY: 0, scale: 1 };
    vbPanZoom[id].offsetX += dx;
    vbPanZoom[id].offsetY += dy;
    vbApplySvgTransform(svg);
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      svg.classList.remove('panning');
    }
  });

  // Zoom with mouse wheel (Ctrl/Cmd + scroll, or just scroll if not a control)
  svg.addEventListener('wheel', (e) => {
    const isMacCtrl = (e.metaKey || e.ctrlKey);
    const isOnControl = e.target.closest('.ctrl');

    // Only zoom if Ctrl/Cmd is held, or if not hovering a control
    if (!isMacCtrl && isOnControl) return;

    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const id = svg.id;
    if (!vbPanZoom[id]) vbPanZoom[id] = { offsetX: 0, offsetY: 0, scale: 1 };

    // Get mouse position in SVG coordinates (for zoom centering)
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / vbPanZoom[id].scale - vbPanZoom[id].offsetX / vbPanZoom[id].scale;
    const mouseY = (e.clientY - rect.top) / vbPanZoom[id].scale - vbPanZoom[id].offsetY / vbPanZoom[id].scale;

    // Apply zoom
    vbPanZoom[id].scale *= zoomFactor;
    vbPanZoom[id].scale = Math.max(0.25, Math.min(4, vbPanZoom[id].scale)); // Clamp 0.25x to 4x

    // Adjust pan to keep mouse position stable
    vbPanZoom[id].offsetX = mouseX * vbPanZoom[id].scale - (e.clientX - rect.left) / vbPanZoom[id].scale;
    vbPanZoom[id].offsetY = mouseY * vbPanZoom[id].scale - (e.clientY - rect.top) / vbPanZoom[id].scale;

    vbApplySvgTransform(svg);
  });
}

function vbApplySvgTransform(svg) {
  const id = svg.id;
  if (!vbPanZoom[id]) return;
  const { offsetX, offsetY, scale } = vbPanZoom[id];
  svg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  svg.style.transformOrigin = '0 0';
  svg.style.transformBox = 'fill-box';
}

function vbSetupCanvasResizer() {
  const canvas = $('.vb-canvas');
  if (!canvas) return;

  // Create resizer handle if it doesn't exist
  let resizer = canvas.querySelector('.vb-canvas-resizer');
  if (!resizer) {
    resizer = document.createElement('div');
    resizer.className = 'vb-canvas-resizer';
    canvas.appendChild(resizer);
  }

  let isResizing = false, startX = 0, startRatio = 0.6;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startRatio = canvas.style.gridTemplateColumns ?
      parseFloat(canvas.style.gridTemplateColumns.split('fr')[0]) / 5 : 0.6;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const dx = e.clientX - startX;
    const rect = canvas.getBoundingClientRect();
    const delta = dx / rect.width;
    const newRatio = Math.max(0.3, Math.min(0.7, startRatio + delta));
    const left = (newRatio * 5).toFixed(2);
    const right = ((1 - newRatio) * 5).toFixed(2);
    canvas.style.gridTemplateColumns = `minmax(0, ${left}fr) minmax(0, ${right}fr)`;
    resizer.style.left = `calc(${newRatio * 100}% - 4px)`;
  });

  document.addEventListener('mouseup', () => {
    isResizing = false;
  });
}

// ---- bridge plugin download (Settings tab + welcome modal share this) ----
// Smarter than a bare anchor: probes the endpoint first, surfaces a clear
// error if the file isn't bundled (so users don't get a silent 0-byte
// download), and reports success status inline.
async function downloadBridge(statusEl, btnEl) {
  if (statusEl) { statusEl.textContent = 'checking…'; statusEl.style.color = ''; }
  // Probe first — if 404, the bridge isn't bundled in this build.
  try {
    const probe = await fetch('/api/bridge/ma3.lua?inline=1', { method: 'HEAD' });
    if (!probe.ok) {
      const msg = `bridge not bundled (HTTP ${probe.status}) — rebuild app`;
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = '#ff5252'; }
      return false;
    }
  } catch (err) {
    if (statusEl) { statusEl.textContent = `error: ${err.message}`; statusEl.style.color = '#ff5252'; }
    return false;
  }
  // Trigger the download. Server returns a Content-Disposition header
  // with a versioned filename ("ENCpatchMA3Bridge-vX.Y.Z.lua") — the
  // browser respects that, so we don't override with `a.download`.
  const a = document.createElement('a');
  a.href = '/api/bridge/ma3.lua';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Read the version from /api/state for the status message
  let appVersion = '';
  try {
    const sr = await fetch('/api/state');
    const sj = await sr.json();
    appVersion = sj.version || '';
  } catch (_) {}
  if (statusEl) {
    statusEl.textContent = appVersion
      ? `✓ saved ENCpatchMA3Bridge-v${appVersion}.lua to Downloads — now import it in MA3`
      : '✓ saved to Downloads — now import it in MA3';
    statusEl.style.color = '#3fbf66';
  }
  if (btnEl) {
    const orig = btnEl.textContent;
    btnEl.textContent = '✓ Saved';
    setTimeout(() => { btnEl.textContent = orig; }, 4000);
  }
  return true;
}

// Wire the Settings-tab download + view-source + copy buttons.
function bridgeButtonsInit() {
  const dl = document.getElementById('btn-download-bridge');
  const copy = document.getElementById('btn-copy-bridge');
  const view = document.getElementById('btn-view-bridge');
  const status = document.getElementById('bridge-download-status');
  if (dl) dl.addEventListener('click', () => downloadBridge(status, dl));
  if (view) view.addEventListener('click', () => {
    window.open('/api/bridge/ma3.lua?inline=1', '_blank');
  });
  if (copy) copy.addEventListener('click', async () => {
    // Fetch the .lua as text, push to clipboard. Lets user paste straight
    // into MA3's plugin editor without going through Downloads + import.
    try {
      const r = await fetch('/api/bridge/ma3.lua?inline=1');
      if (!r.ok) {
        if (status) { status.textContent = `error: HTTP ${r.status}`; status.style.color = '#ff5252'; }
        return;
      }
      const text = await r.text();
      // navigator.clipboard requires HTTPS or localhost — we're on localhost:8733 so OK
      await navigator.clipboard.writeText(text);
      const orig = copy.textContent;
      copy.textContent = '✓ Copied';
      if (status) {
        statusEl_ok(status, `Lua source copied (${text.length.toLocaleString()} chars). Paste into MA3 → Plugins → Edit.`);
      }
      setTimeout(() => { copy.textContent = orig; }, 2500);
    } catch (err) {
      if (status) { status.textContent = `copy failed: ${err.message}`; status.style.color = '#ff5252'; }
    }
  });
}

function statusEl_ok(el, msg) {
  el.textContent = msg;
  el.style.color = '#3fbf66';
}

// ---- first-run welcome modal ----
// Shown on first app launch. Console-aware: MA3 users see the bridge plugin
// step + bridge-status dot; Eos / Onyx / Titan / Hog / MagicQ / Vista users
// see an OSC host+port form + an "OSC reachable" status dot. Tracks live
// connection state so the user sees green dots flip on as they wire things
// up.

// Per-console step content. The shape is { id, title, hint, html } where
// `html` is optional inline action markup. Status dots are listed in the
// `dots` array at the parent level.
const WELCOME_FLOWS = {
  ma3: {
    intro: 'Three steps to get the encoders following grandMA3.',
    steps: [
      {
        title: 'Plug in your Stream Deck.',
        hint: 'Quit the Elgato Stream Deck app first — ENCpatch needs exclusive control. macOS will ask for Input Monitoring permission the first time.',
      },
      {
        title: 'In grandMA3, install the bridge plugin.',
        hint: 'Click the button below to save it to your Downloads. Then in MA3: <em>Menu → Plugins → +</em> → pick the file → double-click the row to start.',
        html: '<button class="btn btn-primary" id="welcome-download-bridge">Save Bridge to Downloads</button>',
      },
      {
        title: 'Make sure MA3 OSC is enabled.',
        hint: 'In MA3: <em>Menu → Network → OSC</em> → enable interface at <code>127.0.0.1</code>, in <code>8000</code> / out <code>8001</code>.',
      },
    ],
    dots: [
      { id: 'welcome-sd-dot',     label: 'Stream Deck', source: 'sdhid' },
      { id: 'welcome-bridge-dot', label: 'MA3 Bridge',  source: 'ma3lua' },
    ],
  },
  eos: {
    intro: 'Three steps to get the encoders driving an ETC Eos console (or Nomad).',
    steps: [
      {
        title: 'Plug in your Stream Deck.',
        hint: 'Quit the Elgato Stream Deck app first — ENCpatch needs exclusive control. macOS will ask for Input Monitoring permission the first time.',
      },
      {
        title: 'Tell ENCpatch where Eos is.',
        hint: 'Same Mac → leave host as <code>127.0.0.1</code>. Different machine → enter the IP your Eos console reports under <em>Network → Settings</em>.',
        html: `<div class="welcome-form-row">
          <label>Host <input id="welcome-eos-host" type="text" placeholder="127.0.0.1" /></label>
          <label>Send port <input id="welcome-eos-port" type="number" min="1" max="65535" placeholder="8000" /></label>
          <label>Listen port <input id="welcome-eos-localport" type="number" min="1" max="65535" placeholder="8002" /></label>
          <button class="btn btn-primary" id="welcome-eos-save">Save</button>
        </div>`,
      },
      {
        title: 'Enable OSC in Eos.',
        hint: 'In Eos: <em>Shell → Settings → Show Control → OSC</em> → enable both Rx and Tx. Rx port matches the "Send port" above (default 8000). Tx port matches "Listen port" (default 8002 — note: NOT Eos\'s shipped default 8001, which collides with ENCpatch\'s general OSC listener).',
      },
    ],
    dots: [
      { id: 'welcome-sd-dot',  label: 'Stream Deck',   source: 'sdhid' },
      { id: 'welcome-eos-dot', label: 'Eos OSC ready', source: 'console' },
    ],
  },
  // Generic OSC console — same shape as Eos but slightly looser copy.
  // Used as fallback for onyx / titan / hog / magicq / vista.
  generic_osc: {
    intro: 'Three steps to get the encoders driving your console over OSC.',
    steps: [
      {
        title: 'Plug in your Stream Deck.',
        hint: 'Quit the Elgato Stream Deck app first — ENCpatch needs exclusive control. macOS will ask for Input Monitoring permission the first time.',
      },
      {
        title: 'Tell ENCpatch where the console is.',
        hint: 'Enter the IP your console reports under its network settings, plus the OSC RX port it listens on. The defaults usually work for first-try.',
        html: `<div class="welcome-form-row">
          <label>Host <input id="welcome-eos-host" type="text" placeholder="127.0.0.1" /></label>
          <label>Send port <input id="welcome-eos-port" type="number" min="1" max="65535" /></label>
          <label>Listen port <input id="welcome-eos-localport" type="number" min="1" max="65535" /></label>
          <button class="btn btn-primary" id="welcome-eos-save">Save</button>
        </div>`,
      },
      {
        title: 'Enable OSC on the console.',
        hint: 'Each console hides this differently — search the manual for "OSC" or "External control". You\'ll typically need to enable both an RX (input) and TX (output) port.',
      },
    ],
    dots: [
      { id: 'welcome-sd-dot',  label: 'Stream Deck',   source: 'sdhid' },
      { id: 'welcome-eos-dot', label: 'Console OSC',   source: 'console' },
    ],
  },
};

function welcomeFlowFor(consoleId) {
  if (consoleId === 'ma3') return WELCOME_FLOWS.ma3;
  if (consoleId === 'eos') return WELCOME_FLOWS.eos;
  // onyx / titan / hog / magicq / vista all share the generic OSC flow
  return WELCOME_FLOWS.generic_osc;
}

async function welcomeInit() {
  const overlay = document.getElementById('welcome-overlay');
  if (!overlay) return;

  // Bumped to v2 in v0.13.2 — the welcome flow added a console picker, so
  // anyone upgrading from v0.13.0/0.13.1 should see it once with the new
  // shape. Bumping the key forces re-onboarding for them.
  const WELCOME_KEY = 'encpatch.welcomed.v2';
  const seen = (() => { try { return localStorage.getItem(WELCOME_KEY); } catch (_) { return null; } })();
  if (seen) return;   // already onboarded — never show again

  // Pull the available console list (so we render the picker correctly)
  // and the current saved choice. /api/consoles is exposed by the server.
  let consoles = [];
  let currentConsole = 'ma3';
  try {
    const [listResp, stateResp] = await Promise.all([
      fetch('/api/consoles').catch(() => null),
      fetch('/api/state').catch(() => null),
    ]);
    if (listResp && listResp.ok) {
      const j = await listResp.json();
      // /api/consoles returns { drivers: [...] }; accept bare arrays too
      // for forward-compat with future shape changes.
      consoles = Array.isArray(j) ? j : (j.drivers || j.consoles || []);
    }
    if (stateResp && stateResp.ok) {
      const j = await stateResp.json();
      currentConsole = (j.config && j.config.console) || 'ma3';
    }
  } catch (_) { /* fall through with defaults */ }
  if (!consoles.length) {
    consoles = [
      { id: 'ma3', displayName: 'grandMA3 onPC' },
      { id: 'eos', displayName: 'ETC Eos' },
    ];
  }

  const sel = document.getElementById('welcome-console-select');
  const hint = document.getElementById('welcome-console-hint');
  if (sel) {
    sel.innerHTML = consoles.map((c) => {
      const tag = c.tested === false ? ' (untested)' : '';
      return `<option value="${c.id}">${c.displayName}${tag}</option>`;
    }).join('');
    sel.value = currentConsole;
    sel.addEventListener('change', async () => {
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ console: sel.value }),
        });
      } catch (_) {}
      welcomeRender(sel.value);
      if (hint) {
        const found = consoles.find((c) => c.id === sel.value);
        hint.textContent = found && found.tested === false
          ? 'Heads-up: this driver scaffold has not been live-tested. Wire format documented; please report back what works.'
          : '';
      }
    });
  }

  overlay.hidden = false;
  welcomeRender(currentConsole);

  document.getElementById('welcome-skip')?.addEventListener('click', () => {
    overlay.hidden = true;
  });
  document.getElementById('welcome-done')?.addEventListener('click', () => {
    try { localStorage.setItem(WELCOME_KEY, String(Date.now())); } catch (_) {}
    overlay.hidden = true;
  });
}

// Render the steps + dots for the chosen console, then wire any inline
// buttons (bridge download for MA3, host/port save for OSC consoles).
function welcomeRender(consoleId) {
  const overlay = document.getElementById('welcome-overlay');
  if (!overlay) return;
  const flow = welcomeFlowFor(consoleId);
  const subEl = overlay.querySelector('.welcome-sub');
  if (subEl) subEl.textContent = flow.intro;

  const stepsEl = document.getElementById('welcome-steps');
  if (stepsEl) {
    stepsEl.innerHTML = flow.steps.map((s, i) => `
      <li>
        <strong>${i + 1}. ${s.title}</strong>
        <span class="welcome-hint">${s.hint}</span>
        ${s.html || ''}
      </li>
    `).join('');
  }

  const statusEl = document.getElementById('welcome-status');
  if (statusEl) {
    statusEl.innerHTML = flow.dots.map((d) =>
      `<div class="welcome-check"><span class="dot" id="${d.id}"></span> ${d.label}</div>`
    ).join('');
  }

  // ─── Wire inline actions ────────────────────────────────────────────
  // MA3: bridge plugin save button
  const dlBtn = document.getElementById('welcome-download-bridge');
  if (dlBtn) {
    dlBtn.addEventListener('click', async () => {
      dlBtn.disabled = true;
      dlBtn.textContent = 'Saving…';
      const ok = await downloadBridge(null, null);
      dlBtn.textContent = ok ? '✓ Saved to Downloads' : '⚠ Couldn\'t save — check console';
      setTimeout(() => { dlBtn.disabled = false; dlBtn.textContent = 'Save Bridge to Downloads'; }, 4000);
    });
  }

  // Eos / generic OSC: host+port form
  const hostInp = document.getElementById('welcome-eos-host');
  const portInp = document.getElementById('welcome-eos-port');
  const lpInp   = document.getElementById('welcome-eos-localport');
  const saveBtn = document.getElementById('welcome-eos-save');
  if (hostInp && portInp && lpInp && saveBtn) {
    // Pre-fill from saved config (best-effort; falls back to placeholders)
    fetch('/api/state').then((r) => r.json()).then((j) => {
      const eos = (j && j.config && j.config.eos) || {};
      hostInp.value = eos.host || '127.0.0.1';
      portInp.value = eos.port || 8000;
      lpInp.value   = eos.localPort || 8001;
    }).catch(() => {});
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            eos: {
              host: hostInp.value || '127.0.0.1',
              port: Number(portInp.value) || 8000,
              localPort: Number(lpInp.value) || 8001,
            },
          }),
        });
        saveBtn.textContent = '✓ Saved';
      } catch (_) {
        saveBtn.textContent = '⚠ Save failed';
      }
      setTimeout(() => { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }, 3000);
    });
  }

  // Live dot polling — runs continuously, reads /api/state, flips dots
  // on or off based on each dot's `source` mapping.
  const tick = async () => {
    if (overlay.hidden) return;
    try {
      const r = await fetch('/api/state');
      const j = await r.json();
      const sdConn = !!(j.sdhid && j.sdhid.connected);
      const ma3Conn = !!(j.ma3lua && j.ma3lua.connected);
      const consoleConn = !!(j.console && j.console.connected);
      for (const d of flow.dots) {
        const el = document.getElementById(d.id);
        if (!el) continue;
        let ok = false;
        if (d.source === 'sdhid')   ok = sdConn;
        if (d.source === 'ma3lua')  ok = ma3Conn;
        if (d.source === 'console') ok = consoleConn;
        el.classList.toggle('ok', ok);
      }
    } catch (_) {}
    setTimeout(tick, 2000);
  };
  tick();
}

// ---- boot ----
loadState().then(() => {
  vbInit();
  connectWs();
  bridgeButtonsInit();
  welcomeInit();
  startEncoderBarAutoRefresh();
});
