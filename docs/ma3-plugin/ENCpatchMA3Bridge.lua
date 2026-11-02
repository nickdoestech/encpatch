-- =====================================================================
-- ENCpatch — grandMA3 Bridge Plugin
-- ---------------------------------------------------------------------
-- Runs INSIDE grandMA3 onPC. Listens on TCP 127.0.0.1:9001 for
-- newline-delimited JSON requests from the ENCpatch desktop app, executes
-- them inside MA3's Lua context (Cmd / Selection / encoder bar reads),
-- and replies one JSON line per request.
--
-- Wire protocol (all messages are single lines, terminated by '\n'):
--   { "id":N, "action":"ping" }                              -> { "id":N, "pong":true }
--   { "id":N, "action":"tick", "encoder":1..4, "delta":N }    -> { "id":N, "ok":true,  "info":"..." }
--   { "id":N, "action":"getCurrentFeature" }                  -> { "id":N, "feature":"Dimmer" }
--   { "id":N, "action":"getEncoderBar" }                      -> { "id":N, "feature":"Dimmer", "slots":["Dim",null,null,null] }
--   { "id":N, "action":"getStats" }                           -> { "id":N, "stats":{ "ticks":12, "lastMs":0.4, "uptimeS":120 } }
--   { "id":N, "action":"getVersion" }                         -> { "id":N, "version":"0.9.0" }
--   { "id":N, "action":"probeEncoderBar" }                    -> { "id":N, ...big diagnostic dump... }
--   { "id":N, "action":"setBarMode", "mode":"auto" }          -> { "id":N, "mode":"auto" }  (auto|ui|win|legacy)
--   { "id":N, "cmd":"Fixture 1" }                             -> { "id":N, "ok":true }
--
-- Install: import this file via MA3 → Menu → Plugins → +. Double-click
-- the row to start it. You should see "[ENCpatch] listening on
-- 127.0.0.1:9001" in System Monitor.
-- =====================================================================

local PLUGIN_VERSION = "0.13.43"

-- =====================================================================
-- USER-EDITABLE NETWORK SETTINGS
-- ---------------------------------------------------------------------
-- Most users leave these alone — defaults work for "ENCpatch and MA3 on
-- the same Mac." Edit if you want ENCpatch to control MA3 across a LAN.
--
-- BIND_ADDR:
--   "127.0.0.1" → only accepts connections from the same machine (safe default)
--   "0.0.0.0"   → accepts from anywhere on the network (requires TOKEN)
--   "10.0.0.5"  → accepts only on a specific NIC IP
--
-- TOKEN:
--   ""          → no authentication (fine for 127.0.0.1)
--   "abc123"    → every message from ENCpatch must include "token":"abc123"
--                 Set the same value in ENCpatch's Settings → MA3 Bridge → Token.
--                 STRONGLY recommended whenever BIND_ADDR is not 127.0.0.1.
-- =====================================================================
local BIND_ADDR = "127.0.0.1"
local TOKEN     = ""
local PORT      = 9001

local socket = require("socket")
local server, clients, running = nil, {}, true

-- Stats (optional — surfaces in the desktop app's health pill)
local stats = {
  ticks = 0,           -- count of "tick" actions handled since start
  lastMs = nil,        -- ms taken for the most recent tick handler
  startedAt = os.time(),
}

-- Heartbeat tracking — send periodic heartbeat to all clients
-- so the desktop app can detect connection drops quickly
local lastHeartbeat = 0
local HEARTBEAT_INTERVAL = 3  -- seconds between heartbeats

local function logf(s)
  if Echo then Echo("[ENCpatch] " .. s)
  elseif Printf then Printf("[ENCpatch] %s", s)
  else print("[ENCpatch] " .. s) end
end

-- =====================================================================
-- Networking
-- =====================================================================
local function setup()
  local s = socket.tcp()
  pcall(function() s:setoption("reuseaddr", true) end)
  local ok, err = s:bind(BIND_ADDR, PORT)
  if not ok then logf("bind FAILED on " .. BIND_ADDR .. ":" .. PORT .. " — " .. tostring(err)); return false end
  ok, err = s:listen(5)
  if not ok then logf("listen FAILED: " .. tostring(err)); return false end
  s:settimeout(0)
  server = s
  local authNote = (TOKEN ~= "") and " [auth: token required]" or ""
  logf("listening on " .. BIND_ADDR .. ":" .. PORT .. authNote .. " (v" .. PLUGIN_VERSION .. ")")
  if BIND_ADDR ~= "127.0.0.1" and TOKEN == "" then
    logf("WARNING: bound to non-loopback without TOKEN — anyone on the LAN can send Cmd() to MA3")
  end
  return true
end

-- Returns true if the request is authenticated (or auth disabled).
-- Looks for "token":"<TOKEN>" anywhere in the JSON line.
local function checkToken(data)
  if TOKEN == "" then return true end
  local got = string.match(data, '"token"%s*:%s*"([^"]*)"')
  return got == TOKEN
end

-- =====================================================================
-- MA3 helpers — feature group + selection + UI channels
-- =====================================================================
local function getFeatureName()
  if not SelectedFeature then return nil end
  local ok, f = pcall(SelectedFeature)
  if not ok or not f then return nil end
  return tostring(f.Name or f.name or f)
end

-- Returns array of subfixture INDICES (integers) for the current selection.
-- Uses Object-Free SelectionTable (preferred), falls back to SelectionFirst/Next.
local function getSelectionSubfixtures()
  local subs = {}
  if SelectionTable then
    local ok, t = pcall(SelectionTable)
    if ok and type(t) == "table" then
      for _, idx in ipairs(t) do table.insert(subs, idx) end
    end
  end
  if #subs == 0 and SelectionFirst then
    local ok, idx = pcall(SelectionFirst)
    while ok and idx and idx > 0 do
      table.insert(subs, idx)
      ok, idx = pcall(SelectionNext, idx)
    end
  end
  return subs
end

-- For one subfixture, return UI channel indices whose attribute belongs
-- to the current feature group, sorted ascending by channel index.
-- The sort matters: GetUIChannels can return channels in non-monotonic
-- order on some fixture types, which makes our "slot N = Nth match" map
-- unstable across selections. Sorting gives us a deterministic mapping
-- that matches MA3's encoder bar in the common case.
local function uiChannelsForFeature(subfix, featureName)
  local out = {}
  local ok, channels = pcall(GetUIChannels, subfix)
  if not ok or not channels then return out end
  for _, chIdx in ipairs(channels) do
    local okA, attr = pcall(GetAttributeByUIChannel, chIdx)
    if okA and attr then
      local fname = nil
      pcall(function() fname = attr.Feature and (attr.Feature.Name or attr.Feature.name) end)
      if not fname then pcall(function() fname = attr.FeatureName end) end
      if not fname then pcall(function() fname = attr.featureGroup end) end
      if fname and tostring(fname) == featureName then
        table.insert(out, chIdx)
      end
    end
  end
  -- Stable ordering — channel index ascending
  table.sort(out, function(a, b) return a < b end)
  return out
end

-- =====================================================================
-- v0.13.42: LIVE ENCODER BAR READING
-- ---------------------------------------------------------------------
-- The uiChannelsForFeature path sorts channels ascending and takes the
-- first 4 — which doesn't know about MA3's sub-page position within a
-- feature group. If the user is on Position page 2 (X Focus / Y Focus /
-- Z Focus / Position MSpeed), the sort-based approach still returns
-- page 1 (Pan / Tilt / ...). Two new read paths fix this:
--
--   "ui"  — walk MA3's UI object tree (GetDisplayByIndex → ScreenContents)
--           to the EncoderBar node and read the labels it is rendering
--           RIGHT NOW. Every harvested text is validated against the
--           selected fixture's real attributes (GetAttributeIndex +
--           GetUIChannelIndex + current-feature membership), so stray UI
--           text can't leak into the slots. This is the only place MA3
--           actually stores sub-page state.
--   "win" — fallback: anchor a 4-wide window into the feature's channel
--           list at the position of GetSelectedAttribute(). Paging in
--           MA3 moves the selected attribute, so the window follows.
--   "def" — last resort: the pre-0.13.42 sorted-first-4 behavior.
--
-- BAR_MODE picks the strategy: "auto" tries ui → win → def. Nick can
-- A/B test without re-importing via the setBarMode action:
--   echo '{"id":1,"action":"setBarMode","mode":"win"}' | nc 127.0.0.1 9001
-- =====================================================================
local BAR_MODE = "auto"          -- "auto" | "ui" | "win" | "legacy"

-- Wall-clock seconds with ms precision. os.clock() is CPU time (advances
-- slower than wall time when MA3 idles) — useless for cache staleness.
local function nowS()
  local ok, t = pcall(socket.gettime)
  if ok and type(t) == "number" then return t end
  return os.time()
end

local function classOf(h)
  local ok, c = pcall(function() return h:GetClass() end)
  if ok and c then return tostring(c) end
  return nil
end

local function nameOf(h)
  local n = nil
  pcall(function() n = h.Name or h.name end)
  if n then return tostring(n) end
  return nil
end

-- Read a property off a UI handle: dot access first, then :Get(name).
local function getProp(h, propName)
  local v = nil
  local ok = pcall(function() v = h[propName] end)
  if ok and v ~= nil then return v end
  ok = pcall(function() v = h:Get(propName) end)
  if ok and v ~= nil then return v end
  return nil
end

-- Enumerate children of a UI handle. Tries :Children() (returns a table
-- of handles) then :Count()/:Ptr(i).
local function childrenOf(h)
  local out = {}
  local ok, kids = pcall(function() return h:Children() end)
  if ok and type(kids) == "table" then
    for _, k in ipairs(kids) do out[#out + 1] = k end
    if #out > 0 then return out end
  end
  local okC, n = pcall(function() return h:Count() end)
  if okC and type(n) == "number" and n > 0 and n < 512 then
    for i = 1, n do
      local okP, c = pcall(function() return h:Ptr(i) end)
      if okP and c then out[#out + 1] = c end
    end
  end
  return out
end

-- Dump up to `cap` properties of a handle as a JSON object string.
-- Handles both 0-based and 1-based PropertyName indexing.
local function dumpProps(h, cap)
  cap = cap or 40
  local parts = {}
  local okN, n = pcall(function() return h:PropertyCount() end)
  if not okN or type(n) ~= "number" then return "{}" end
  local base = 1
  local okT, t = pcall(function() return h:PropertyName(1) end)
  if not okT or t == nil then base = 0 end
  for i = base, math.min(n - 1 + base, cap - 1 + base) do
    local okP, pn = pcall(function() return h:PropertyName(i) end)
    if okP and pn then
      local v = getProp(h, tostring(pn))
      local vs = (v ~= nil) and tostring(v) or "nil"
      if #vs > 48 then vs = vs:sub(1, 48) .. ".." end
      parts[#parts + 1] = "{\"n\":" .. "\"" .. tostring(pn):gsub('"', '') .. "\"" .. ",\"v\":" .. "\"" .. vs:gsub("\\", ""):gsub('"', "'"):gsub("\n", " ") .. "\"" .. "}"
    end
  end
  return "[" .. table.concat(parts, ",") .. "]"
end

-- Validate a candidate attribute name against the selected fixture:
-- returns the UI channel index if the name resolves to a real attribute
-- that exists on subfixture `sub`, else nil.
local function attrValidForSelection(name, sub)
  if not name or name == "" or not sub then return nil end
  if not (GetAttributeIndex and GetUIChannelIndex) then return nil end
  local ok, idx = pcall(GetAttributeIndex, name)
  if not ok or not idx or idx <= 0 then return nil end
  local okC, ch = pcall(GetUIChannelIndex, sub, idx)
  if not okC or not ch or ch <= 0 then return nil end
  return ch
end

-- Find the EncoderBar node in MA3's UI tree. Direct named paths first,
-- then a bounded breadth-first search for a node whose class or name
-- contains "ncoder" (EncoderBar / AttributeEncoderBar / etc).
local function findEncoderBarNode(budgetEnd)
  if not GetDisplayByIndex then return nil end
  -- Cheap direct paths
  for d = 1, 6 do
    local okD, disp = pcall(GetDisplayByIndex, d)
    if okD and disp then
      local paths = {
        function() return disp.ScreenContents.EncoderBar end,
        function() return disp.EncoderBar end,
      }
      for _, p in ipairs(paths) do
        local ok, n = pcall(p)
        if ok and n then return n end
      end
    end
  end
  -- BFS (parents visited before children, so we find the bar container
  -- before its buttons). Node + time bounded so MA3's frame never hitches.
  local queue, head, visited = {}, 1, 0
  for d = 1, 6 do
    local okD, disp = pcall(GetDisplayByIndex, d)
    if okD and disp then
      local sc = nil
      pcall(function() sc = disp.ScreenContents end)
      queue[#queue + 1] = sc or disp
    end
  end
  while queue[head] do
    if nowS() > budgetEnd then return nil end
    local node = queue[head]; head = head + 1
    visited = visited + 1
    if visited > 2500 then return nil end
    local cls = classOf(node) or ""
    local nm = nameOf(node) or ""
    if string.find(cls, "ncoder", 1, true) or string.find(nm, "ncoderBar", 1, true) then
      return node
    end
    local kids = childrenOf(node)
    if #kids <= 64 then
      for _, k in ipairs(kids) do queue[#queue + 1] = k end
    end
  end
  return nil
end

-- Harvest attribute names from the encoder bar subtree, in visual (tree)
-- order. Every text is validated: it must resolve to a real attribute
-- (label variants tried: raw, spaces stripped, spaces→underscore — MA3
-- renders "X Focus" for canonical "XFocus"), that attribute must exist
-- on the selected fixture, AND its channel must belong to the current
-- feature group. Invisible subtrees are skipped so hidden pages don't
-- pollute the result. Returns up to 4 names + collects raw texts for
-- the probe when rawOut is given.
local TEXT_PROPS = { "Attribute", "AttributeName", "Text", "Caption", "Label", "Content" }
local function collectBarAttrs(bar, sub, featureChSet, budgetEnd, rawOut)
  local out, seen, visited = {}, {}, 0
  local function isHidden(h)
    local v = getProp(h, "Visible")
    if v == false or v == 0 or v == "No" or v == "false" then return true end
    return false
  end
  local function visit(h, depth)
    if #out >= 4 or depth > 6 or visited > 500 then return end
    if nowS() > budgetEnd then return end
    visited = visited + 1
    if isHidden(h) then return end
    for _, p in ipairs(TEXT_PROPS) do
      local v = getProp(h, p)
      if type(v) == "string" and #v > 0 and #v < 48 then
        if rawOut and #rawOut < 60 then rawOut[#rawOut + 1] = p .. "=" .. v end
        local variants = { v, (v:gsub("%s+", "")), (v:gsub("%s+", "_")) }
        for _, cand in ipairs(variants) do
          if not seen[cand] then
            local ch = attrValidForSelection(cand, sub)
            if ch and not seen["ch" .. ch]
               and (not featureChSet or featureChSet[ch]) then
              seen[cand] = true
              seen["ch" .. ch] = true
              out[#out + 1] = cand
              break
            end
            seen[cand] = true   -- don't re-test rejected strings
          end
        end
      end
      if #out >= 4 then return end
    end
    for _, k in ipairs(childrenOf(h)) do visit(k, depth + 1) end
  end
  visit(bar, 0)
  return out
end

-- Cached UI-bar handle + failure cooldown so a missing/renamed node
-- doesn't cost a full tree search on every poll.
local uiBarCache = { node = nil, missCount = 0, cooldownUntil = 0 }

local function computeSlotsUI(sub, featureChSet, budgetS)
  local budgetEnd = nowS() + (budgetS or 0.05)
  local bar = uiBarCache.node
  if bar and not classOf(bar) then bar = nil; uiBarCache.node = nil end  -- stale handle
  if not bar then
    if nowS() < uiBarCache.cooldownUntil then return nil end
    bar = findEncoderBarNode(budgetEnd)
    if bar then
      uiBarCache.node = bar
      uiBarCache.missCount = 0
      logf("encoder bar UI node found: class=" .. tostring(classOf(bar)) .. " name=" .. tostring(nameOf(bar)))
    else
      uiBarCache.missCount = uiBarCache.missCount + 1
      uiBarCache.cooldownUntil = nowS() + math.min(30, 5 * uiBarCache.missCount)
      return nil
    end
  end
  local attrs = collectBarAttrs(bar, sub, featureChSet, budgetEnd, nil)
  if #attrs >= 1 then return attrs end   -- 1 is legit (Dimmer page = just Dim)
  return nil
end

-- Fallback: 4-wide window into the feature's sorted channel list,
-- anchored at the selected attribute. When MA3 pages to sub-page 2 the
-- selected attribute moves onto that page, so the window follows.
-- Clamped so the window never runs off the end of the list.
local function computeSlotsWindow(sub, chans)
  if not chans or #chans == 0 then return nil end
  local pos = 1
  if GetSelectedAttribute then
    local ok, attr = pcall(GetSelectedAttribute)
    if ok and attr then
      local nm = nil
      pcall(function() nm = tostring(attr.Name or attr.name) end)
      local ch = nm and attrValidForSelection(nm, sub)
      if ch then
        for i, c in ipairs(chans) do
          if c == ch then pos = i; break end
        end
      end
    end
  end
  local start = math.max(1, math.min(pos, #chans - 3))
  local out = {}
  for i = 0, 3 do
    local ch = chans[start + i]
    if ch then
      local okA, attr = pcall(GetAttributeByUIChannel, ch)
      if okA and attr then
        local nm = nil
        pcall(function() nm = tostring(attr.Name or attr.name) end)
        out[i + 1] = nm
      end
    end
  end
  return out
end

-- Resolve the DEFAULT attribute name for slot N (the primary attribute
-- on that slot's UI channel — what shows when nothing else is "selected").
local function attrNameForSlot(slotIdx)
  local feature = getFeatureName()
  if not feature then return nil, "no SelectedFeature" end
  local subs = getSelectionSubfixtures()
  if #subs == 0 then return nil, "empty selection" end
  local matches = uiChannelsForFeature(subs[1], feature)
  local ch = matches[slotIdx]
  if not ch then return nil, "no slot " .. slotIdx end
  local ok, attr = pcall(GetAttributeByUIChannel, ch)
  if not ok or not attr then return nil, "no attr" end
  local nm = nil
  pcall(function() nm = tostring(attr.Name or attr.name) end)
  return nm, nm and "ok" or "attr has no name"
end

-- ============================================================
-- STACKED ATTRIBUTES — track which sub-attribute is active per slot.
-- ============================================================
-- MA3 lets multiple attributes "stack" on a single encoder slot
-- (e.g. Color1 + Color1WheelSpin both ride encoder 1). The user clicks
-- the LCD label area in MA3 to cycle which one the encoder drives.
--
-- We mirror this on our side: a sticky table of "active attribute per
-- slot" that we update by polling GetSelectedAttribute(). When the user
-- clicks a stacked attribute in MA3, GetSelectedAttribute() returns it.
-- We figure out which slot's UI channel it lives on, and remember.
-- Subsequent encoder ticks for that slot use the sticky attribute.
local slotActiveAttr = { nil, nil, nil, nil }
local slotStackIdx   = { 1, 1, 1, 1 }    -- per-slot index into the stacked-attr list
local lastFeatureSeen = nil              -- detect feature group changes → reset stickies
-- v0.13.42: base (pre-sticky) attribute per slot from the last
-- resolveBarSlots() pass. cycleSlotStack anchors its stack on this so
-- LCD-tap cycling works on sub-page 2's attributes, not sorted-slot-N.
local lastBarBase = { nil, nil, nil, nil }
-- Forward declaration — resolveBarSlots is defined further down but
-- called from cycleSlotStack (v0.13.43). Without this, the call inside
-- cycleSlotStack would resolve to a nil global at runtime. barCache
-- lives up here for the same reason (cycleSlotStack invalidates it).
local resolveBarSlots
local barCache = { at = -1e9, slots = nil, src = "none" }
local lastBarSig = nil

-- Hardcoded "stacked attribute" patterns. MA3's Lua API doesn't tell us
-- which sub-tab is active, so ENCpatch carries this list and the user
-- cycles through them by tapping the SD+ LCD on that encoder's column.
-- KEY = the base/default attribute name. VALUE = ordered list of names
-- the user might want on that same slot.
--
-- Add common stacks here as they come up. The lookup is a substring
-- match against the base name (so "Gobo1" matches base "Gobo", "Color2"
-- matches base "Color", etc.) — keeps this small and predictable.
local STACK_PATTERNS = {
  -- Gobo wheel: position + spin + shake (+ index for indexable wheels)
  { match = "^Gobo(%d+)$",                stack = function(n) return {
      "Gobo" .. n,
      "Gobo" .. n .. "WheelSpin",
      "Gobo" .. n .. "WheelShake",
      "Gobo" .. n .. "Pos",
  } end },
  -- Color wheel
  { match = "^Color(%d+)$",               stack = function(n) return {
      "Color" .. n,
      "Color" .. n .. "WheelSpin",
      "Color" .. n .. "WheelShake",
      "Color" .. n .. "WheelIndex",
  } end },
  -- Position attributes: base + phaser variant
  { match = "^Pan$",                      stack = function() return { "Pan", "Pan_Phaser" } end },
  { match = "^Tilt$",                     stack = function() return { "Tilt", "Tilt_Phaser" } end },
  -- Beam attributes
  { match = "^Iris$",                     stack = function() return { "Iris", "IrisStrobe", "IrisShake" } end },
  { match = "^Zoom$",                     stack = function() return { "Zoom", "ZoomMSpeed" } end },
  { match = "^Shutter(%d+)$",             stack = function(n) return {
      "Shutter" .. n,
      "Shutter" .. n .. "Strobe",
      "Shutter" .. n .. "StrobePulse",
      "Shutter" .. n .. "StrobeRandom",
  } end },
  -- Shapers (blade rotation alternates)
  { match = "^Blade(%d+)([AB])$",         stack = function(n, ab) return {
      "Blade" .. n .. ab,
      "Blade" .. n .. ab .. "Rot",
  } end },
}

-- Common suffixes we strip to find the "core" attribute name.
local SUFFIXES_TO_STRIP = {
  "WheelSpin", "WheelShake", "WheelIndex", "WheelMode",
  "Pos", "Index", "Mode", "Speed",
  "Phaser", "_Phaser",
  "Strobe", "Shake",
  "MSpeed",
  "Rot", "Rotate",
}

-- A SEED list of candidate attribute names — covers the common stacked
-- attributes across MA3's standard fixture profiles. Bridge tests each
-- against the fixture's actual UI channel via ChannelTable() and only
-- keeps the ones that are real. Adds more here over time as we
-- encounter fixtures with novel stacked attributes.
--
-- Rule of thumb: any attribute that might appear on an encoder slot
-- belongs here. We over-include; the per-fixture filter trims it.
local CANDIDATE_ATTRS = {
  -- Dimmer
  "Dim", "Dimmer", "DimMSpeed", "DimPhaser",
  -- Position
  "Pan", "Tilt", "Pan_Phaser", "Tilt_Phaser",
  "PanRotate", "TiltRotate", "PositionMSpeed",
  "XYZ_X", "XYZ_Y", "XYZ_Z", "XYZ_Rotation",
  -- Gobo (1, 2, 3)
  "Gobo1", "Gobo1Pos", "Gobo1WheelSpin", "Gobo1WheelShake", "Gobo1WheelIndex", "Gobo1WheelMode",
  "Gobo1SelectShake", "Gobo1SelectSpin", "Gobo1PosShake", "Gobo1PosRotate", "Gobo1PosIndex",
  "Gobo2", "Gobo2Pos", "Gobo2WheelSpin", "Gobo2WheelShake", "Gobo2WheelIndex", "Gobo2WheelMode",
  "Gobo2SelectShake", "Gobo2SelectSpin", "Gobo2PosShake", "Gobo2PosRotate", "Gobo2PosIndex",
  "Gobo3", "Gobo3Pos", "AnimationWheel", "AnimationWheelPos",
  -- Color
  "Color1", "Color1WheelSpin", "Color1WheelShake", "Color1WheelIndex", "Color1WheelMode", "Color1WheelSelectShake",
  "Color2", "Color2WheelSpin", "Color2WheelShake", "Color2WheelIndex", "Color2WheelMode",
  "Color3", "Color4",
  "ColorRGB_R", "ColorRGB_G", "ColorRGB_B", "ColorRGB_W", "ColorRGB_A", "ColorRGB_UV",
  "ColorRGB_C", "ColorRGB_M", "ColorRGB_Y",
  "ColorMacro", "ColorMacroFlash", "ColorTemperature", "ColorTint",
  "ColorMixCMY_C", "ColorMixCMY_M", "ColorMixCMY_Y",
  "HSI_H", "HSI_S", "HSI_I",
  "ColorEffects1", "ColorEffects2",
  -- Beam
  "Iris", "IrisStrobe", "IrisStrobeRandom", "IrisShake", "IrisPulseClose", "IrisPulseOpen",
  "Zoom", "ZoomMSpeed",
  "Shutter1", "Shutter1Strobe", "Shutter1StrobePulse", "Shutter1StrobePulseClose", "Shutter1StrobePulseOpen",
  "Shutter1StrobeRandom", "Shutter1StrobeRandomPulseClose", "Shutter1StrobeRandomPulseOpen",
  "Strobe1", "Strobe2",
  "Prism1", "Prism1Pos", "Prism1Macro", "Prism1PosShake",
  "Prism2", "Prism2Pos", "Prism2Macro",
  -- Focus
  "Focus1", "Focus2", "AutoFocus", "FocusMSpeed",
  "Frost1", "Frost2", "Frost1Strobe", "Frost1Pulse",
  "Haze",
  -- Shapers / Blade
  "Blade1A", "Blade1B", "Blade2A", "Blade2B", "Blade3A", "Blade3B", "Blade4A", "Blade4B",
  "Blade1Rot", "Blade2Rot", "Blade3Rot", "Blade4Rot",
  "BladeAll", "BladeAllRot",
  "Knife", "Mask", "Frame", "FrameRotation",
  -- Control / Function
  "Control1", "Control2", "Function", "Macros", "Reset",
  "Lamp", "LampControl", "DisplayIntensity", "Fan", "FanMode",
  "Effect1", "Effect2", "Effect3",
}

-- Test whether an attribute name maps to a specific UI channel on the
-- user's fixture. Uses GetAttributeIndex + GetUIChannelIndex — the
-- same APIs we use in findSlotForAttr, which we know work reliably.
-- (ChannelTable was tried in 0.11.7 but returned 0 matches in practice
-- on real fixtures.)
local function attrIsOnSubfixChannel(attrName, subfix, expectedChIdx)
  if not GetAttributeIndex or not GetUIChannelIndex then return false end
  local ok, attrIdx = pcall(GetAttributeIndex, attrName)
  if not ok or not attrIdx or attrIdx <= 0 then return false end
  local okCh, chIdx = pcall(GetUIChannelIndex, subfix, attrIdx)
  return okCh and chIdx == expectedChIdx
end

-- Build the REAL list of attributes the user can cycle through on slot
-- N. In MA3, stacked tabs on one encoder slot are actually MULTIPLE UI
-- CHANNELS, not one channel with multiple attributes. So we look for
-- channels that are "siblings" of this slot's primary channel within
-- the feature group's channel list.
--
-- Heuristic: feature channels come back from GetUIChannels in fixture-
-- profile order. Stacked tabs appear consecutively. Slot N's stack is
-- the contiguous run starting at slot N's primary channel, ending just
-- before the next slot's primary.
local function getStackForAttr(baseName, slotChIdx, subfix, allFeatureChs, slotIdx)
  if not baseName then return {} end

  local diag = "getStackForAttr(" .. tostring(baseName) ..
               ", chIdx=" .. tostring(slotChIdx) ..
               ", sub=" .. tostring(subfix) ..
               ", slot=" .. tostring(slotIdx) ..
               ", featChs=" .. (allFeatureChs and #allFeatureChs or 0) .. ")"

  -- Path 1: contiguous-channel-run within feature. Find slotChIdx's
  -- position in allFeatureChs, walk forward until we hit the next
  -- slot's primary (or end of list). Each channel in that run is a
  -- stacked tab; resolve each to its primary attribute name.
  if slotChIdx and allFeatureChs and #allFeatureChs > 0 and GetAttributeByUIChannel then
    -- Find the bounds of this slot's run
    local startIdx = nil
    for i, ch in ipairs(allFeatureChs) do
      if ch == slotChIdx then startIdx = i; break end
    end
    if startIdx then
      -- We expect 4 slots per feature, so slot N's primary is roughly
      -- at position N if every slot has 1 channel, or N×K if K stacked
      -- tabs each. Detect the run length by total/4 (rounded).
      local runLen = math.max(1, math.floor((#allFeatureChs / 4) + 0.5))
      local endIdx = math.min(startIdx + runLen - 1, #allFeatureChs)
      local found = {}
      local matched = {}
      for i = startIdx, endIdx do
        local ch = allFeatureChs[i]
        local ok, attr = pcall(GetAttributeByUIChannel, ch)
        if ok and attr then
          local nm = nil
          pcall(function() nm = tostring(attr.Name or attr.name) end)
          if nm and nm ~= "" then
            table.insert(found, nm)
            table.insert(matched, "ch" .. ch .. "=" .. nm)
          end
        end
      end
      diag = diag .. " runStart=" .. startIdx .. " runLen=" .. runLen .. " stack=[" .. table.concat(matched, ",") .. "]"
      logf(diag)
      if #found > 0 then return found end
    else
      diag = diag .. " slotChNotInList"
      logf(diag)
    end
  else
    diag = diag .. " skipDynamic"
    logf(diag)
  end

  -- Path 2 (fallback): pattern-based hardcoded stacks.
  local candidates = { baseName }
  for _, suffix in ipairs(SUFFIXES_TO_STRIP) do
    local stripped = string.match(baseName, "^(.+)" .. suffix .. "$")
    if stripped then table.insert(candidates, stripped) end
  end
  for _, candidate in ipairs(candidates) do
    for _, pat in ipairs(STACK_PATTERNS) do
      local m1, m2 = string.match(candidate, pat.match)
      if m1 then
        local ok, list = pcall(pat.stack, m1, m2)
        if ok and type(list) == "table" and #list > 0 then
          logf("  fallback stack: " .. table.concat(list, ","))
          return list
        end
      end
    end
  end
  logf("  no stack found, using just baseName")
  return { baseName }
end

-- Cycle slot N's stack to the next attribute. Returns the new
-- attribute name (and 1-based stack index for UI feedback).
--
-- v0.13.43: the cycle is anchored on the LIVE bar's base attribute for
-- the slot — resolveBarSlots() runs first so sub-page position is
-- current. An optional userList (the desktop app's configured stack
-- for this feature+slot) is used as the cycle list ONLY when it
-- actually contains the slot's current base or active attribute —
-- i.e. the user's Position config of ["Pan","Pan_Phaser"] applies on
-- Position page 1 but is ignored on page 2 where the base is XFocus,
-- instead of snapping the wheel back to Pan (the pre-0.13.43 bug: the
-- desktop cycled its config list blind and force-set the sticky).
-- Entries are validated against the selected fixture before use.
--
-- When the slot starts on a non-default stack member, we sync the
-- position to the current attribute's place in the list BEFORE
-- stepping, so the first tap advances rather than jumping.
local function cycleSlotStack(slotIdx, direction, userList)
  -- Refresh the live bar first — lastBarBase must reflect the CURRENT
  -- sub-page, not whatever the last poll saw. Force a fresh resolve:
  -- a tap is a deliberate gesture, it can afford the ≤50ms UI read.
  barCache.at = -1e9
  resolveBarSlots()
  local default = lastBarBase[slotIdx] or attrNameForSlot(slotIdx)
  if not default then return nil, 0, 0 end
  -- Find slot's UI channel + reference subfixture + the FULL list of
  -- feature channels (for the stack-run heuristic).
  local slotCh, refSub, featureChs = nil, nil, nil
  do
    local subs = getSelectionSubfixtures()
    local feat = getFeatureName()
    if #subs > 0 and feat then
      refSub = subs[1]
      featureChs = uiChannelsForFeature(refSub, feat)
      -- Channel of the base attribute itself (sub-page aware), not the
      -- legacy sorted slot position.
      slotCh = attrValidForSelection(default, refSub) or featureChs[slotIdx]
    end
  end

  local currentAttr = slotActiveAttr[slotIdx] or default

  -- Candidate 1: the user's configured list, validated + applicable.
  local stack = nil
  if type(userList) == "table" and #userList > 0 and refSub then
    local valid, seenNm, applies = {}, {}, false
    for _, nm in ipairs(userList) do
      if type(nm) == "string" and nm ~= "" and not seenNm[nm]
         and attrValidForSelection(nm, refSub) then
        seenNm[nm] = true
        valid[#valid + 1] = nm
        if nm == default or nm == currentAttr then applies = true end
      end
    end
    if applies and #valid > 0 then
      stack = valid
      logf("cycle slot " .. slotIdx .. ": using user list (" .. #valid .. " valid)")
    end
  end

  -- Candidate 2: dynamic stack derived from the live base attribute.
  if not stack then
    stack = getStackForAttr(default, slotCh, refSub, featureChs, slotIdx)
  end
  if #stack == 0 then return default, 1, 1 end

  -- Find what we're currently on in the stack
  local current = nil
  for i, name in ipairs(stack) do
    if name == currentAttr then current = i; break end
  end
  if not current then
    -- Not in the list (e.g. fresh page): start from the base if present.
    for i, name in ipairs(stack) do
      if name == default then current = i; break end
    end
  end
  if not current then current = slotStackIdx[slotIdx] or 1 end

  local step = (direction and direction < 0) and -1 or 1
  local next = ((current - 1 + step) % #stack) + 1
  if next < 1 then next = #stack end
  slotStackIdx[slotIdx] = next
  slotActiveAttr[slotIdx] = stack[next]
  logf("slot " .. slotIdx .. " stack → " .. stack[next] .. " (" .. next .. "/" .. #stack .. ")")
  return stack[next], next, #stack
end

-- Find which slot a given attribute belongs to in the current selection.
-- Returns nil if not on any of the 4 slots in the current feature.
local function findSlotForAttr(attrName)
  if not attrName or attrName == "" then return nil end
  if not GetAttributeIndex or not GetUIChannelIndex then return nil end
  local subs = getSelectionSubfixtures()
  if #subs == 0 then return nil end
  local feature = getFeatureName()
  if not feature then return nil end

  -- Resolve the attribute's UI channel for our reference subfixture
  local ok, attrIdx = pcall(GetAttributeIndex, attrName)
  if not ok or not attrIdx or attrIdx <= 0 then return nil end
  local okCh, chIdx = pcall(GetUIChannelIndex, subs[1], attrIdx)
  if not okCh or not chIdx or chIdx <= 0 then return nil end

  -- Compare against the current feature's slot map
  local matches = uiChannelsForFeature(subs[1], feature)
  for slot = 1, 4 do
    if matches[slot] == chIdx then return slot end
  end
  return nil
end

-- Sync our sticky per-slot state from MA3's GetSelectedAttribute().
-- Called before every tick AND on encoder-bar polls.
local function syncSlotActiveFromMa3()
  -- Reset stickies when the user switches feature groups in MA3 — the
  -- old sticky for slot 1 is meaningless if the slot now points at a
  -- different attribute family.
  local feat = getFeatureName()
  if feat ~= lastFeatureSeen then
    if lastFeatureSeen ~= nil then
      slotActiveAttr = { nil, nil, nil, nil }
      slotStackIdx   = { 1, 1, 1, 1 }
      logf("feature changed (" .. tostring(lastFeatureSeen) .. " → " .. tostring(feat) .. ") — cleared sticky slot attrs + stack idx")
    end
    lastFeatureSeen = feat
  end

  if not GetSelectedAttribute then return end
  local ok, attr = pcall(GetSelectedAttribute)
  if not ok or not attr then return end
  local nm = nil
  pcall(function() nm = tostring(attr.Name or attr.name) end)
  if not nm or nm == "" then return end
  local slot = findSlotForAttr(nm)
  if slot then
    -- ONLY set if this slot has no sticky yet. This preserves manual
    -- cycleStack selections — without this guard, sync would clobber
    -- the user's cycle every time getEncoderBar iterated.
    -- (Iterating slots 1..4 in getEncoderBar means sync runs once per
    --  slot that's nil, but each call processes ALL slots' sticky state.
    --  So if slot 2 is nil, sync still tried to update slot 1 from
    --  GetSelectedAttribute. That's what was clobbering manual cycles.)
    if slotActiveAttr[slot] == nil then
      slotActiveAttr[slot] = nm
      logf("slot " .. slot .. " active attribute → " .. nm .. " (initial)")
    end
  end
end

-- =====================================================================
-- v0.13.42: resolveBarSlots — THE single source of truth for "what
-- attribute is on each of the 4 wheels right now". Used by both
-- turnEncoder (wheel ticks) and getEncoderBar (LCD labels), so what the
-- LCD shows is always exactly what turning the wheel drives.
--
-- Resolution order (BAR_MODE == "auto"):
--   1. "ui"  — read MA3's actual rendered encoder bar (sub-page aware)
--   2. "win" — selected-attribute-anchored window into feature channels
--   3. "def" — legacy sorted-first-4 (pre-0.13.42 behavior)
-- Manual stickies (setSlotAttr / cycleStack) overlay the base on top.
-- When the base bar changes (feature switch OR sub-page flip), stickies
-- are cleared — they referred to the old bar.
--
-- Results are cached for 0.35s (wall clock) so a fast encoder spin
-- doesn't re-walk the UI tree per tick; the 1 Hz getEncoderBar poll
-- refreshes it continuously.
-- =====================================================================
-- (barCache/lastBarSig are declared above cycleSlotStack, which
-- invalidates the cache before anchoring a tap-cycle.)

-- (assigns the local forward-declared above cycleSlotStack)
function resolveBarSlots()
  local t = nowS()
  if barCache.slots and (t - barCache.at) < 0.35 then
    return barCache.slots, barCache.src
  end
  local feature = getFeatureName()
  local subs = getSelectionSubfixtures()
  local base, src = { nil, nil, nil, nil }, "none"
  if feature and #subs > 0 then
    local sub = subs[1]
    local chans = uiChannelsForFeature(sub, feature)
    local chSet = {}
    for _, c in ipairs(chans) do chSet[c] = true end
    local got = nil
    if BAR_MODE == "auto" or BAR_MODE == "ui" then
      got = computeSlotsUI(sub, chSet, 0.05)
      if got then src = "ui" end
    end
    if not got and (BAR_MODE == "auto" or BAR_MODE == "win") then
      got = computeSlotsWindow(sub, chans)
      if got then src = "win" end
    end
    if not got then
      got = {}
      for s = 1, 4 do got[s] = attrNameForSlot(s) end
      src = "def"
      -- Legacy sticky auto-fill from GetSelectedAttribute() only makes
      -- sense in def mode — in ui/win mode the bar itself already
      -- reflects what the user clicked in MA3.
      syncSlotActiveFromMa3()
    end
    for s = 1, 4 do base[s] = got[s] end
  end
  for s = 1, 4 do lastBarBase[s] = base[s] end

  -- Bar-change detection → clear manual stickies (old bar's stacks).
  local sig = tostring(feature) .. "|" .. tostring(base[1]) .. "," ..
              tostring(base[2]) .. "," .. tostring(base[3]) .. "," .. tostring(base[4])
  if sig ~= lastBarSig then
    if lastBarSig ~= nil then
      slotActiveAttr = { nil, nil, nil, nil }
      slotStackIdx = { 1, 1, 1, 1 }
      logf("encoder bar changed (src=" .. src .. "): " .. sig)
    end
    lastBarSig = sig
  end

  -- Sticky overlay: explicit setSlotAttr / cycleStack picks win.
  local slots = { base[1], base[2], base[3], base[4] }
  for s = 1, 4 do
    if slotActiveAttr[s] then slots[s] = slotActiveAttr[s] end
  end
  barCache.at, barCache.slots, barCache.src = t, slots, src
  return slots, src
end

-- =====================================================================
-- Public actions
-- =====================================================================

-- Apply a relative encoder change to whatever's on slot N of MA3's
-- current encoder bar, for the current selection.
--
-- Uses MA3's command-line "Attribute <name> At + <delta>" syntax —
-- fully fixture-agnostic and verified working on MA3 onPC 2.3.2.0.
--
-- (Earlier attempts to address by slot via "Encoder N At + V" failed:
-- MA3 2.3.2.0 parses "Encoder N" as the EncoderBar UI object, not a
-- slot reference, and silently logs "Nothing to be done" while doing
-- nothing. The slot-based path was removed in 0.9.7.)
--
-- Slot ordering stability comes from sorting matches by channel index
-- inside uiChannelsForFeature() — same selection always produces the
-- same slot→attribute mapping.
local function turnEncoder(slotIdx, deltaPercent)
  local t0 = os.clock()
  if not Cmd then return false, "Cmd not available" end
  local subs = getSelectionSubfixtures()
  if #subs == 0 then return false, "empty selection" end
  -- v0.13.42: resolve through the SAME path as getEncoderBar, so the
  -- wheel always drives exactly what the LCD label says — including
  -- MA3 sub-page position and manual sticky overrides.
  local slots, src = resolveBarSlots()
  local name = slots[slotIdx]
  if not name then return false, "no attr on slot " .. slotIdx .. " (src=" .. src .. ")" end
  local sign, mag = "+", deltaPercent
  if mag < 0 then sign, mag = "-", -mag end
  local cmd = string.format('Attribute "%s" At %s %.4f', name, sign, mag)
  local ok = pcall(function() Cmd(cmd) end)
  if not ok then return false, "Cmd failed: " .. cmd end
  pcall(function()
    stats.ticks = (stats.ticks or 0) + 1
    stats.lastMs = (os.clock() - t0) * 1000.0
  end)
  return true, string.format('%s (n=%d src=%s)', cmd, #subs, src)
end

-- =====================================================================
-- JSON helpers (tiny — we only emit, never parse JSON ourselves;
-- inbound is matched with string.match on the request format we control)
-- =====================================================================
local function jsonStr(s)
  if s == nil then return "null" end
  s = tostring(s)
  -- escape the bare minimum needed for safe transport
  s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "")
  return '"' .. s .. '"'
end

-- =====================================================================
-- Main loop
-- =====================================================================
-- Probe every MA3 Lua function we depend on. Runs once at startup so
-- users on older or unfamiliar MA3 builds see a clear list of what's
-- missing instead of mysterious silent failures during runtime.
local function selfCheck()
  local checks = {
    { name = "Cmd",                        ref = function() return Cmd end,                        critical = true },
    { name = "Echo",                       ref = function() return Echo end,                       critical = false },
    { name = "Printf",                     ref = function() return Printf end,                     critical = false },
    { name = "SelectionTable",             ref = function() return SelectionTable end,             critical = true },
    { name = "SelectedFeature",            ref = function() return SelectedFeature end,            critical = true },
    { name = "GetUIChannels",              ref = function() return GetUIChannels end,              critical = true },
    { name = "GetAttributeByUIChannel",    ref = function() return GetAttributeByUIChannel end,    critical = true },
    -- Optional — needed for stacked attribute tracking. Without these,
    -- ENCpatch falls back to "always slot default" — still functional
    -- but doesn't follow user's clicks within a stacked group.
    { name = "GetSelectedAttribute",       ref = function() return GetSelectedAttribute end,       critical = false },
    { name = "GetAttributeIndex",          ref = function() return GetAttributeIndex end,          critical = false },
    { name = "GetUIChannelIndex",          ref = function() return GetUIChannelIndex end,          critical = false },
    -- Needed for fixture-aware dynamic stack enumeration. Without it
    -- we fall back to hardcoded patterns.
    { name = "ChannelTable",               ref = function() return ChannelTable end,               critical = false },
    -- v0.13.42: needed for the live encoder-bar UI read ("ui" strategy).
    -- Without it the bridge falls back to the selected-attribute window.
    { name = "GetDisplayByIndex",          ref = function() return GetDisplayByIndex end,          critical = false },
    { name = "CurrentUser",                ref = function() return CurrentUser end,                critical = false },
    { name = "CurrentScreenConfig",        ref = function() return CurrentScreenConfig end,        critical = false },
  }
  local missingCritical = {}
  local missingOptional = {}
  for _, c in ipairs(checks) do
    local ok, val = pcall(c.ref)
    local present = ok and val ~= nil
    if not present then
      if c.critical then table.insert(missingCritical, c.name)
      else table.insert(missingOptional, c.name) end
    end
  end
  if #missingCritical == 0 and #missingOptional == 0 then
    logf("self-check OK — all required APIs present")
  else
    if #missingCritical > 0 then
      logf("self-check FAILED — missing critical APIs: " .. table.concat(missingCritical, ", "))
      logf("  ENCpatch will not function. Update grandMA3 to 2.0 or newer.")
      logf("  (SelectionTable / SelectedFeature are Object-Free APIs added in MA3 2.0)")
    end
    if #missingOptional > 0 then
      logf("self-check WARN — missing optional APIs: " .. table.concat(missingOptional, ", "))
    end
  end
  return #missingCritical == 0
end

function Main()
  if not setup() then return end
  selfCheck()
  while running do
    -- Accept new clients (non-blocking)
    local c = server:accept()
    if c then
      c:settimeout(0)
      table.insert(clients, c)
      logf("client connected (#" .. #clients .. ")")
    end

    -- Send heartbeat to all connected clients every N seconds.
    -- This lets the desktop app detect connection drops quickly.
    local now = os.time()
    if (now - lastHeartbeat) >= HEARTBEAT_INTERVAL then
      lastHeartbeat = now
      for _, sock in ipairs(clients) do
        pcall(function() sock:send('{"heartbeat":true}\n') end)
      end
    end

    -- Process one line per client per pass
    for i = #clients, 1, -1 do
      local sock = clients[i]
      local data, err = sock:receive("*l")
      if data then
        local id = string.match(data, '"id"%s*:%s*(%d+)') or "0"
        if not checkToken(data) then
          sock:send('{"id":' .. id .. ',"err":"auth"}\n')
          goto next_client
        end

        -- ping --
        if string.find(data, '"action"%s*:%s*"ping"', 1, false) then
          sock:send('{"id":' .. id .. ',"pong":true}\n')

        -- tick --
        elseif string.find(data, '"action"%s*:%s*"tick"', 1, false) then
          local enc = tonumber(string.match(data, '"encoder"%s*:%s*(%d+)')) or 1
          local delta = tonumber(string.match(data, '"delta"%s*:%s*(%-?[0-9.]+)')) or 0
          local ok, info = turnEncoder(enc, delta)
          logf("  -> enc=" .. enc .. " delta=" .. delta .. " => " .. tostring(info))
          sock:send('{"id":' .. id .. ',"ok":' .. tostring(ok) .. ',"info":' .. jsonStr(info or "") .. '}\n')

        -- getCurrentFeature --
        elseif string.find(data, '"action"%s*:%s*"getCurrentFeature"', 1, false) then
          local name = getFeatureName() or "unknown"
          sock:send('{"id":' .. id .. ',"feature":' .. jsonStr(name) .. '}\n')

        -- getEncoderBar (4 slot attribute names) — v0.13.42: resolved
        -- via resolveBarSlots (live UI read → selected-attr window →
        -- legacy default), sub-page aware. "src" reports which strategy
        -- produced the slots (ui/win/def/none) for desktop-side logging.
        elseif string.find(data, '"action"%s*:%s*"getEncoderBar"', 1, false) then
          local slots, src = resolveBarSlots()
          local parts = {}
          for s = 1, 4 do
            table.insert(parts, jsonStr(slots[s]))
          end
          local feat = getFeatureName()
          sock:send('{"id":' .. id .. ',"feature":' .. jsonStr(feat) ..
                    ',"src":' .. jsonStr(src) ..
                    ',"slots":[' .. table.concat(parts, ",") .. ']}\n')

        -- getStats --
        elseif string.find(data, '"action"%s*:%s*"getStats"', 1, false) then
          local lastMs = stats.lastMs and string.format("%.3f", stats.lastMs) or "null"
          local ticks = stats.ticks or 0
          local uptime = os.time() - (stats.startedAt or os.time())
          sock:send('{"id":' .. id .. ',"stats":{"ticks":' .. ticks ..
                    ',"lastMs":' .. lastMs ..
                    ',"uptimeS":' .. uptime .. '}}\n')

        -- getVersion --
        elseif string.find(data, '"action"%s*:%s*"getVersion"', 1, false) then
          sock:send('{"id":' .. id .. ',"version":' .. jsonStr(PLUGIN_VERSION) .. '}\n')

        -- getSelection -- return array of currently selected fixture IDs
        elseif string.find(data, '"action"%s*:%s*"getSelection"', 1, false) then
          local subs = getSelectionSubfixtures()
          local json = '{"id":' .. id .. ',"selection":[' .. table.concat(subs, ",") .. ']}\n'
          sock:send(json)

        -- getFixtureType -- return the fixture class/type name of the first
        -- selected fixture. Used by the desktop app to scope encoder stacks
        -- to specific fixture types (e.g. "MAC Aura" stacks auto-recall when
        -- any MAC Aura is selected). Returns { fixtureType: "MAC Aura" } or
        -- { fixtureType: nil } if no selection or fixture type unavailable.
        elseif string.find(data, '"action"%s*:%s*"getFixtureType"', 1, false) then
          local fixtureType = nil
          local subs = getSelectionSubfixtures()
          if subs[1] then
            -- Try to get the fixture's class/definition name
            local ok, ftype = pcall(function()
              if ObjectInformation then
                local oi = ObjectInformation("Fixture", subs[1])
                if oi then
                  -- ObjectInformation returns a table; look for class or Name fields
                  return oi.Class or oi.class or oi.Name or oi.name
                end
              end
              return nil
            end)
            if ok and ftype then fixtureType = tostring(ftype) end
          end
          sock:send('{"id":' .. id .. ',"fixtureType":' .. jsonStr(fixtureType) .. '}\n')

        -- getMa3Version -- query the running MA3 software version. We try
        -- several known Lua entry points; whichever returns a string wins.
        -- The desktop app uses this to route version-specific command
        -- syntax (e.g. if MA3 2.4 changes how encoder banks are addressed).
        elseif string.find(data, '"action"%s*:%s*"getMa3Version"', 1, false) then
          local function tryGet(fn)
            local ok, v = pcall(fn)
            if ok and v ~= nil and v ~= "" then return tostring(v) end
            return nil
          end
          local ver = nil
          -- Path 1: BuildDetails — exists in modern MA3, returns table with .version
          if not ver then ver = tryGet(function()
            if BuildDetails then local b = BuildDetails(); return b and b.version end
          end) end
          -- Path 2: SoftwareVersion() — returns string directly in some builds
          if not ver then ver = tryGet(function()
            if SoftwareVersion then return SoftwareVersion() end
          end) end
          -- Path 3: MA.Software.Version (object hierarchy)
          if not ver then ver = tryGet(function()
            return MA and MA.Software and MA.Software.Version
          end) end
          -- Path 4: Cmd-line introspection — works on all MA3, but ugly
          if not ver then ver = tryGet(function()
            return Version and Version()
          end) end
          sock:send('{"id":' .. id .. ',"ma3Version":' .. jsonStr(ver) .. '}\n')

        -- discoverAllSlots — for the current selection's first subfixture
        -- and the current MA3 feature group, enumerate ALL slots' valid
        -- attributes by testing each candidate name against each slot's
        -- UI channel via GetChannelFunction. Returns:
        --   { feature, slots: { "1": [...], "2": [...], "3": [...], "4": [...] } }
        -- Used by the desktop UI's "Auto-fill from current selection"
        -- button to populate the user's encoder stack config from their
        -- actual patched fixture.
        elseif string.find(data, '"action"%s*:%s*"discoverAllSlots"', 1, false) then
          local subs = getSelectionSubfixtures()
          local feat = getFeatureName()
          local slotsOut = { ["1"] = {}, ["2"] = {}, ["3"] = {}, ["4"] = {} }
          if subs[1] and feat and GetAttributeIndex and GetChannelFunction then
            local matches = uiChannelsForFeature(subs[1], feat)
            for slot = 1, 4 do
              local slotCh = matches[slot]
              if slotCh then
                for _, attrName in ipairs(CANDIDATE_ATTRS) do
                  local okIdx, attrIdx = pcall(GetAttributeIndex, attrName)
                  if okIdx and attrIdx and attrIdx > 0 then
                    local okFn, fn = pcall(GetChannelFunction, slotCh, attrIdx)
                    if okFn and fn ~= nil then
                      table.insert(slotsOut[tostring(slot)], '"' .. attrName .. '"')
                    end
                  end
                end
              end
            end
          end
          local parts = {}
          for slot = 1, 4 do
            table.insert(parts, '"' .. slot .. '":[' .. table.concat(slotsOut[tostring(slot)], ",") .. ']')
          end
          local body = '{"id":' .. id ..
                       ',"feature":' .. jsonStr(feat) ..
                       ',"selCount":' .. #subs ..
                       ',"slots":{' .. table.concat(parts, ",") .. '}}'
          sock:send(body .. '\n')
          logf("discoverAllSlots feat=" .. tostring(feat) ..
               " s1=" .. #slotsOut["1"] .. " s2=" .. #slotsOut["2"] ..
               " s3=" .. #slotsOut["3"] .. " s4=" .. #slotsOut["4"])

        -- discoverAttrs {slot:N} — uses GetChannelFunction to enumerate
        -- ALL channel functions on this slot's UI channel. Different
        -- semantics from GetUIChannelIndex: a channel can have multiple
        -- attached attributes via channel functions (the stacked tabs in
        -- MA3's UI), and this enumeration finds them all. Returns the
        -- attribute names in attribute-index order.
        elseif string.find(data, '"action"%s*:%s*"discoverAttrs"', 1, false) then
          local slot = tonumber(string.match(data, '"slot"%s*:%s*(%d+)')) or 1
          local subs = getSelectionSubfixtures()
          local feat = getFeatureName()
          local found = {}
          if subs[1] and feat and GetAttributeCount and GetChannelFunction and GetAttributeByUIChannel then
            local matches = uiChannelsForFeature(subs[1], feat)
            local slotCh = matches[slot]
            if slotCh then
              -- Iterate all attribute indexes and ask MA3 which have a
              -- valid channel function on this UI channel.
              local total = GetAttributeCount()
              for attrIdx = 1, total do
                local ok, fn = pcall(GetChannelFunction, slotCh, attrIdx)
                if ok and fn ~= nil then
                  -- Got a valid channel function — find this attribute's
                  -- name. The cleanest path: GetAttributeByUIChannel for
                  -- each channel, OR resolve via a lookup table. Here
                  -- we use GetUIChannel + descriptor.
                  local nm = nil
                  if GetUIChannel then
                    local okU, desc = pcall(GetUIChannel, slotCh, attrIdx)
                    if okU and desc then
                      pcall(function() nm = tostring(desc.attribute_name or desc.AttributeName or desc.name or desc.Name) end)
                    end
                  end
                  if nm and nm ~= "" and nm ~= "nil" then
                    table.insert(found, '"' .. nm .. '"')
                  end
                end
              end
            end
            logf("discoverAttrs slot=" .. slot .. " ch=" .. tostring(slotCh) .. " found=" .. #found)
          end
          sock:send('{"id":' .. id .. ',"slot":' .. slot .. ',"attrs":[' .. table.concat(found, ",") .. ']}\n')

        -- filterAttrs {list:[...]} — filters a list of attribute names
        -- down to only those that actually exist on the current selection's
        -- first subfixture. Used by the engine to drop phantom items from
        -- the user's manual cycle list before picking a target.
        elseif string.find(data, '"action"%s*:%s*"filterAttrs"', 1, false) then
          local subs = getSelectionSubfixtures()
          local subfix = subs[1]
          local valid = {}
          if subfix then
            -- Pull list names from JSON. Names are inside an array of
            -- quoted strings under "list":[...]. We only need the names.
            local listJson = string.match(data, '"list"%s*:%s*(%b[])') or "[]"
            for name in string.gmatch(listJson, '"([^"]+)"') do
              if GetAttributeIndex and GetUIChannelIndex then
                local ok, attrIdx = pcall(GetAttributeIndex, name)
                if ok and attrIdx and attrIdx > 0 then
                  local okCh, chIdx = pcall(GetUIChannelIndex, subfix, attrIdx)
                  if okCh and chIdx and chIdx > 0 then
                    table.insert(valid, '"' .. name .. '"')
                  end
                end
              end
            end
          end
          sock:send('{"id":' .. id .. ',"valid":[' .. table.concat(valid, ",") .. ']}\n')

        -- setSlotAttr {slot:N, name:"X"} — explicit override. Desktop
        -- side computes the next attribute name from user's manual stack
        -- config and tells us exactly what to use. Bridge just stores it.
        -- Replaces the broken auto-enumeration model in v0.12.0+.
        elseif string.find(data, '"action"%s*:%s*"setSlotAttr"', 1, false) then
          local slot = tonumber(string.match(data, '"slot"%s*:%s*(%d+)')) or 1
          local name = string.match(data, '"name"%s*:%s*"([^"]*)"') or ""
          if name == "" then
            slotActiveAttr[slot] = nil      -- empty name = revert to default
            logf("RX setSlotAttr slot=" .. slot .. " (cleared)")
          else
            slotActiveAttr[slot] = name
            logf("RX setSlotAttr slot=" .. slot .. " name=" .. name)
          end
          barCache.at = -1e9               -- take effect on next tick/poll
          sock:send('{"id":' .. id .. ',"slot":' .. slot .. ',"name":' .. jsonStr(name) .. '}\n')

        -- cycleStack {slot:N, dir:+/-, list:[...]} — advance the stacked-
        -- attribute index for slot N. Returns the new active attribute +
        -- stack position (e.g. "Gobo1WheelSpin", 2, 4 = 2nd of 4).
        -- v0.13.43: optional "list" carries the desktop app's configured
        -- stack for this feature+slot; the bridge uses it only when it
        -- matches the slot's live (sub-page-aware) base attribute.
        elseif string.find(data, '"action"%s*:%s*"cycleStack"', 1, false) then
          local slot = tonumber(string.match(data, '"slot"%s*:%s*(%d+)')) or 1
          local dir  = tonumber(string.match(data, '"dir"%s*:%s*(%-?%d+)')) or 1
          local userList = nil
          local listJson = string.match(data, '"list"%s*:%s*(%b[])')
          if listJson then
            userList = {}
            for name in string.gmatch(listJson, '"([^"]+)"') do
              userList[#userList + 1] = name
            end
            if #userList == 0 then userList = nil end
          end
          logf("RX cycleStack slot=" .. slot .. " dir=" .. dir ..
               " list=" .. (userList and #userList or 0))
          local nm, idx, total = cycleSlotStack(slot, dir, userList)
          barCache.at = -1e9               -- take effect on next tick/poll
          sock:send('{"id":' .. id ..
                    ',"slot":' .. slot ..
                    ',"name":' .. jsonStr(nm) ..
                    ',"idx":' .. (idx or 0) ..
                    ',"total":' .. (total or 0) .. '}\n')

        -- setBarMode {mode:"auto"|"ui"|"win"|"legacy"} — v0.13.42 debug
        -- lever: force a specific slot-resolution strategy without
        -- re-importing the plugin. "legacy" reproduces pre-0.13.42
        -- behavior exactly.
        elseif string.find(data, '"action"%s*:%s*"setBarMode"', 1, false) then
          local mode = string.match(data, '"mode"%s*:%s*"(%a+)"') or "auto"
          if mode == "auto" or mode == "ui" or mode == "win" or mode == "legacy" then
            BAR_MODE = mode
            barCache.at = -1e9
            uiBarCache.node = nil
            uiBarCache.missCount = 0
            uiBarCache.cooldownUntil = 0
            logf("bar mode → " .. mode)
            sock:send('{"id":' .. id .. ',"mode":' .. jsonStr(mode) .. '}\n')
          else
            sock:send('{"id":' .. id .. ',"err":"bad mode"}\n')
          end

        -- probeEncoderBar — v0.13.42 diagnostic. Dumps everything the
        -- bridge can see about encoder bar state so slot-resolution
        -- misses can be fixed from one paste of output. Run it once on
        -- feature sub-page 1, page to sub-page 2, run it again, and
        -- diff:  echo '{"id":1,"action":"probeEncoderBar"}' | nc 127.0.0.1 9001
        elseif string.find(data, '"action"%s*:%s*"probeEncoderBar"', 1, false) then
          local subs = getSelectionSubfixtures()
          local sub = subs[1]
          local feat = getFeatureName()
          local budgetEnd = nowS() + 0.6
          -- 1. Full feature channel list (the data-model view)
          local chParts = {}
          if sub and feat then
            for i, ch in ipairs(uiChannelsForFeature(sub, feat)) do
              local nm = nil
              local okA, attr = pcall(GetAttributeByUIChannel, ch)
              if okA and attr then pcall(function() nm = tostring(attr.Name or attr.name) end) end
              chParts[#chParts + 1] = '{"i":' .. i .. ',"ch":' .. ch .. ',"attr":' .. jsonStr(nm) .. '}'
            end
          end
          -- 2. Selected attribute (the "win" strategy's anchor)
          local selName = nil
          if GetSelectedAttribute then
            local okS, sa = pcall(GetSelectedAttribute)
            if okS and sa then pcall(function() selName = tostring(sa.Name or sa.name) end) end
          end
          -- 3. UI tree: find the bar fresh (ignore cache) + harvest
          local barJson = "null"
          local rawTexts = {}
          local validated = {}
          do
            local bar = findEncoderBarNode(budgetEnd)
            if bar then
              local chSet = nil
              if sub and feat then
                chSet = {}
                for _, c in ipairs(uiChannelsForFeature(sub, feat)) do chSet[c] = true end
              end
              local got = collectBarAttrs(bar, sub, chSet, budgetEnd, rawTexts)
              for _, nm in ipairs(got) do validated[#validated + 1] = jsonStr(nm) end
              barJson = '{"class":' .. jsonStr(classOf(bar)) ..
                        ',"name":' .. jsonStr(nameOf(bar)) ..
                        ',"childCount":' .. tostring(#childrenOf(bar)) ..
                        ',"props":' .. dumpProps(bar, 40) .. '}'
            end
          end
          local rawParts = {}
          for _, s in ipairs(rawTexts) do rawParts[#rawParts + 1] = jsonStr(s) end
          -- 4. What each strategy currently resolves to
          barCache.at = -1e9
          local slots, src = resolveBarSlots()
          local slotParts = {}
          for s = 1, 4 do slotParts[#slotParts + 1] = jsonStr(slots[s]) end
          -- 5. Where else page state might hide: user + screen config props
          local userJson, scfgJson = "null", "null"
          if CurrentUser then
            local okU, u = pcall(CurrentUser)
            if okU and u then userJson = dumpProps(u, 48) end
          end
          if CurrentScreenConfig then
            local okC, c2 = pcall(CurrentScreenConfig)
            if okC and c2 then scfgJson = dumpProps(c2, 48) end
          end
          local body = '{"id":' .. id ..
                       ',"pluginVersion":' .. jsonStr(PLUGIN_VERSION) ..
                       ',"barMode":' .. jsonStr(BAR_MODE) ..
                       ',"feature":' .. jsonStr(feat) ..
                       ',"selCount":' .. #subs ..
                       ',"selectedAttr":' .. jsonStr(selName) ..
                       ',"resolved":{"src":' .. jsonStr(src) .. ',"slots":[' .. table.concat(slotParts, ",") .. ']}' ..
                       ',"featureChannels":[' .. table.concat(chParts, ",") .. ']' ..
                       ',"uiBar":' .. barJson ..
                       ',"uiBarRawTexts":[' .. table.concat(rawParts, ",") .. ']' ..
                       ',"uiBarValidated":[' .. table.concat(validated, ",") .. ']' ..
                       ',"currentUserProps":' .. userJson ..
                       ',"screenConfigProps":' .. scfgJson .. '}'
          sock:send(body .. '\n')
          logf("probeEncoderBar → src=" .. src .. " slots=" ..
               tostring(slots[1]) .. "," .. tostring(slots[2]) .. "," ..
               tostring(slots[3]) .. "," .. tostring(slots[4]) ..
               " sel=" .. tostring(selName) .. " raw=" .. #rawTexts)

        -- probeStacked -- diagnostic dump for stacked-attribute issues.
        -- Returns everything we can read about each slot's UI channel:
        -- selected-attribute, phaser data, channel function, etc. Run
        -- this twice (before + after clicking a tab in MA3) to see what
        -- changes — that's the API we should hook into.
        elseif string.find(data, '"action"%s*:%s*"probeStacked"', 1, false) then
          local subs = getSelectionSubfixtures()
          local feat = getFeatureName() or "nil"
          local matches = (#subs > 0) and uiChannelsForFeature(subs[1], feat) or {}
          -- Selected attribute (global)
          local selName = "nil"
          if GetSelectedAttribute then
            local ok, attr = pcall(GetSelectedAttribute)
            if ok and attr then
              pcall(function() selName = tostring(attr.Name or attr.name or "?") end)
            end
          end
          -- Per-slot phaser/channel data
          local slotData = {}
          for s = 1, 4 do
            local ch = matches[s]
            if ch then
              local entry = '{"slot":' .. s .. ',"ch":' .. ch
              -- channel function index for the channel's "active" attr
              local okPh, ph = pcall(GetProgPhaser, ch, false)
              if okPh and type(ph) == "table" then
                local mp = ph.mask_active_phaser or 0
                local mv = ph.mask_active_value or 0
                local cf = "nil"
                if ph[1] and ph[1].channel_function then cf = tostring(ph[1].channel_function) end
                entry = entry .. ',"mask_phaser":' .. mp .. ',"mask_value":' .. mv .. ',"chFn":' .. cf
              end
              -- Default attribute on this channel
              local okA, attr = pcall(GetAttributeByUIChannel, ch)
              if okA and attr then
                local nm = "?"
                pcall(function() nm = tostring(attr.Name or attr.name) end)
                entry = entry .. ',"defaultAttr":' .. jsonStr(nm)
              end
              entry = entry .. '}'
              table.insert(slotData, entry)
            else
              table.insert(slotData, '{"slot":' .. s .. ',"ch":null}')
            end
          end
          local out = '{"id":' .. id ..
                      ',"feature":' .. jsonStr(feat) ..
                      ',"selCount":' .. #subs ..
                      ',"selectedAttr":' .. jsonStr(selName) ..
                      ',"slots":[' .. table.concat(slotData, ",") .. ']}'
          sock:send(out .. '\n')
          logf("probeStacked -> sel=" .. selName)

        -- debug -- dumps the current MA3 state the bridge can see, for
        -- diagnosing slot ordering / selection issues.
        elseif string.find(data, '"action"%s*:%s*"debug"', 1, false) then
          local feature = getFeatureName() or "nil"
          local subs = getSelectionSubfixtures()
          local subStr = #subs == 0 and "[]" or ("[" .. table.concat(subs, ",") .. "]")
          local slotInfo = {}
          for s = 1, 4 do
            local nm = attrNameForSlot(s) or "nil"
            local matches = #subs > 0 and uiChannelsForFeature(subs[1], feature) or {}
            local ch = matches[s] or "nil"
            table.insert(slotInfo, '{"slot":' .. s .. ',"name":' .. jsonStr(nm) .. ',"ch":' .. jsonStr(ch) .. '}')
          end
          local body = '{"id":' .. id ..
                       ',"feature":' .. jsonStr(feature) ..
                       ',"selectionCount":' .. #subs ..
                       ',"selectionSample":' .. subStr ..
                       ',"slots":[' .. table.concat(slotInfo, ",") .. ']}'
          sock:send(body .. '\n')
          logf("debug -> feature=" .. feature .. " sel=" .. #subs)

        -- raw cmd passthrough -- { "cmd":"..." }
        else
          local cmd = string.match(data, '"cmd"%s*:%s*"(.-)"')
          if cmd then
            local ok = pcall(function() Cmd(cmd) end)
            sock:send('{"id":' .. id .. ',"ok":' .. tostring(ok) .. '}\n')
          else
            sock:send('{"id":' .. id .. ',"err":"unknown action"}\n')
          end
        end
        ::next_client::
      elseif err == "closed" then
        -- Drop disconnected client
        pcall(function() sock:close() end)
        table.remove(clients, i)
        logf("client disconnected")
      end
      -- "timeout" is normal in non-blocking mode — just skip this pass
    end

    -- Yield politely so MA3's main thread keeps running
    socket.sleep(0.05)
    coroutine.yield()
  end
end

function Cleanup()
  running = false
  for _, sock in ipairs(clients) do pcall(function() sock:close() end) end
  if server then pcall(function() server:close() end) end
  logf("stopped (uptime " .. (os.time() - stats.startedAt) .. "s, " ..
       (stats.ticks or 0) .. " ticks served)")
end

return Main
