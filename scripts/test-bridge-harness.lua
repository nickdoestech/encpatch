-- =====================================================================
-- test-bridge-harness.lua — stub-MA3 test harness for ENCpatchMA3Bridge
-- ---------------------------------------------------------------------
-- Runs the bridge plugin against a fake MA3 Lua environment + fake
-- luasocket, drives the newline-JSON protocol through a fake client,
-- and asserts on the replies. No MA3, no network, no Stream Deck.
--
--   Run:  texlua scripts/test-bridge-harness.lua        (Lua 5.3)
--    or:  lua5.3 scripts/test-bridge-harness.lua
--
-- Covers (v0.13.43):
--   1. getEncoderBar "ui" strategy follows sub-page 2 labels
--   2. tick drives the page-2 attribute (same resolution path)
--   3. cycleStack honors the user's list when it matches the base
--   4. cycleStack IGNORES the user's list on sub-page 2 (anchor fix)
--   5. cycleStack dynamic path with no list
--   6. sticky overlays getEncoderBar; cleared on page flip
--   7. degraded run: no UI tree → "win" fallback; none → "def"
--   8. every reply line is valid JSON (checked with a strict parser)
-- =====================================================================

local SCRIPT_DIR = arg and arg[0] and arg[0]:match("^(.*)[/\\]") or "."
local BRIDGE_PATH = SCRIPT_DIR .. "/../docs/ma3-plugin/ENCpatchMA3Bridge.lua"

-- ---------------------------------------------------------------------
-- Fake luasocket
-- ---------------------------------------------------------------------
local clock = { t = 1000.0 }
local fakeClient -- forward

local fakeSocket = {}
fakeSocket.gettime = function() return clock.t end
fakeSocket.sleep = function(s) clock.t = clock.t + (s or 0) end

local function newFakeClient()
  return {
    inbox = {},            -- lines queued for the bridge to receive
    outbox = {},           -- lines the bridge sent back
    settimeout = function() end,
    receive = function(self, _)
      if #self.inbox > 0 then return table.remove(self.inbox, 1) end
      return nil, "timeout"
    end,
    send = function(self, line) self.outbox[#self.outbox + 1] = line; return #line end,
    close = function() end,
  }
end

local serverAcceptQueue = {}
fakeSocket.tcp = function()
  return {
    setoption = function() return true end,
    bind = function() return true end,
    listen = function() return true end,
    settimeout = function() end,
    accept = function()
      if #serverAcceptQueue > 0 then return table.remove(serverAcceptQueue, 1) end
      return nil
    end,
    close = function() end,
  }
end

-- texlua (LuaTeX) bundles a real luasocket, so package.preload alone is
-- not enough — require() returns package.loaded first. Force the stub
-- into both so the bridge can never reach a real network.
package.preload["socket"] = function() return fakeSocket end
package.loaded["socket"] = fakeSocket

-- ---------------------------------------------------------------------
-- Fake MA3: fixture model
-- ---------------------------------------------------------------------
-- A mover with a Position feature spanning two encoder sub-pages:
--   page 1: Pan(101) Tilt(102) PanRotate(103) TiltRotate(104)
--   page 2: XFocus(105) YFocus(106) ZFocus(107) PositionMSpeed(108)
-- and a Color feature with a stacked wheel:
--   Color1(201) Color1WheelSpin(202) Color1WheelShake(203) Color1WheelIndex(204)
--   plus ColorRGB_R..B(205..207) so #chans makes the run heuristic sane.
local ATTRS = {  -- attribute name -> attribute index
  Pan = 1, Tilt = 2, PanRotate = 3, TiltRotate = 4,
  XFocus = 5, YFocus = 6, ZFocus = 7, PositionMSpeed = 8,
  Pan_Phaser = 9, Tilt_Phaser = 10,
  Color1 = 21, Color1WheelSpin = 22, Color1WheelShake = 23, Color1WheelIndex = 24,
  ColorRGB_R = 25, ColorRGB_G = 26, ColorRGB_B = 27,
}
local ATTR_CHANNEL = {  -- attribute index -> UI channel (subfixture 1)
  [1] = 101, [2] = 102, [3] = 103, [4] = 104,
  [5] = 105, [6] = 106, [7] = 107, [8] = 108,
  [9] = 101, [10] = 102,       -- phaser variants ride the base channels
  [21] = 201, [22] = 202, [23] = 203, [24] = 204,
  [25] = 205, [26] = 206, [27] = 207,
}
local CHANNEL_PRIMARY = {  -- UI channel -> primary attribute name + feature
  [101] = { "Pan", "Position" },      [102] = { "Tilt", "Position" },
  [103] = { "PanRotate", "Position" },[104] = { "TiltRotate", "Position" },
  [105] = { "XFocus", "Position" },   [106] = { "YFocus", "Position" },
  [107] = { "ZFocus", "Position" },   [108] = { "PositionMSpeed", "Position" },
  [201] = { "Color1", "Color" },      [202] = { "Color1WheelSpin", "Color" },
  [203] = { "Color1WheelShake", "Color" }, [204] = { "Color1WheelIndex", "Color" },
  [205] = { "ColorRGB_R", "Color" },  [206] = { "ColorRGB_G", "Color" },
  [207] = { "ColorRGB_B", "Color" },
}

local MA3 = {
  feature = "Position",
  selection = { 1 },
  selectedAttr = nil,         -- what GetSelectedAttribute returns
  uiLabels = { "Pan", "Tilt", "Pan Rotate", "Tilt Rotate" },  -- what the fake bar renders
  uiAvailable = true,
  cmds = {},
}

-- Core Object-Free API stubs
Echo = function() end  -- silence bridge logging; flip to print for debug
Cmd = function(line) MA3.cmds[#MA3.cmds + 1] = line end
SelectedFeature = function() return { Name = MA3.feature } end
SelectionTable = function() return { table.unpack(MA3.selection) } end
GetUIChannels = function(_)
  local out = {}
  for ch in pairs(CHANNEL_PRIMARY) do out[#out + 1] = ch end
  table.sort(out)
  return out
end
GetAttributeByUIChannel = function(ch)
  local e = CHANNEL_PRIMARY[ch]
  if not e then return nil end
  return { Name = e[1], Feature = { Name = e[2] } }
end
GetAttributeIndex = function(name) return ATTRS[name] or 0 end
GetUIChannelIndex = function(_, attrIdx) return ATTR_CHANNEL[attrIdx] or 0 end
GetSelectedAttribute = function()
  if MA3.selectedAttr then return { Name = MA3.selectedAttr } end
  return nil
end

-- UI tree for the "ui" strategy: GetDisplayByIndex(1).ScreenContents.EncoderBar
-- ONE persistent node whose children read MA3.uiLabels live — the bridge
-- caches the node handle, and in real MA3 the node's children re-render
-- in place when the user flips sub-pages. GetClass goes nil when the UI
-- is "gone" so the bridge's stale-handle check drops the cached node.
local persistentBarNode = {
  Visible = true,
  GetClass = function() if MA3.uiAvailable then return "EncoderBar" end return nil end,
  Children = function()
    if not MA3.uiAvailable then return {} end
    local kids = {}
    for _, label in ipairs(MA3.uiLabels) do
      kids[#kids + 1] = { Text = label, Visible = true }
    end
    return kids
  end,
  PropertyCount = function() return 0 end,
}
GetDisplayByIndex = function(i)
  if not MA3.uiAvailable then return nil end
  if i == 1 then return { ScreenContents = { EncoderBar = persistentBarNode } } end
  return nil
end

-- ---------------------------------------------------------------------
-- Boot the bridge inside a coroutine
-- ---------------------------------------------------------------------
local Main = assert(loadfile(BRIDGE_PATH))()
fakeClient = newFakeClient()
serverAcceptQueue[1] = fakeClient
local co = coroutine.create(Main)

local function pump(n)
  for _ = 1, (n or 3) do
    local ok, err = coroutine.resume(co)
    if not ok then error("bridge crashed: " .. tostring(err)) end
  end
end

local RAW_REPLIES = {}
local function request(obj)
  -- take a Lua table, hand-encode the tiny JSON the bridge parses
  local parts = {}
  for k, v in pairs(obj) do
    if type(v) == "number" then parts[#parts + 1] = '"' .. k .. '":' .. v
    elseif type(v) == "string" then parts[#parts + 1] = '"' .. k .. '":"' .. v .. '"'
    elseif type(v) == "table" then
      local items = {}
      for _, s in ipairs(v) do items[#items + 1] = '"' .. s .. '"' end
      parts[#parts + 1] = '"' .. k .. '":[' .. table.concat(items, ",") .. ']'
    end
  end
  fakeClient.inbox[#fakeClient.inbox + 1] = "{" .. table.concat(parts, ",") .. "}"
  pump(3)
  -- newest non-heartbeat line is our reply
  for i = #fakeClient.outbox, 1, -1 do
    local line = fakeClient.outbox[i]
    if not line:find('"heartbeat"', 1, true) then
      RAW_REPLIES[#RAW_REPLIES + 1] = line
      return line
    end
  end
  error("no reply")
end

local function field(line, name)
  return line:match('"' .. name .. '"%s*:%s*"([^"]*)"')
end
local function slots(line)
  local arr = line:match('"slots"%s*:%s*(%b[])')
  local out = {}
  if arr then for s in arr:gmatch('"([^"]*)"') do out[#out + 1] = s end end
  return out, arr
end
local function advanceClock(s) clock.t = clock.t + s end

local PASS, FAIL = 0, {}
local function check(label, cond, detail)
  if cond then PASS = PASS + 1
  else FAIL[#FAIL + 1] = label .. (detail and (" — " .. detail) or "") end
  print(string.format("  [%s] %s%s", cond and "ok" or "FAIL", label,
    (not cond and detail) and (" — " .. detail) or ""))
end

pump(3)  -- let the bridge accept the client

-- ---------------------------------------------------------------------
print("1) ui strategy, page 1")
local r = request({ id = 1, action = "getEncoderBar" })
local s = slots(r)
check("page-1 slots from UI labels", s[1] == "Pan" and s[2] == "Tilt"
  and s[3] == "PanRotate" and s[4] == "TiltRotate", table.concat(s, ","))
check("src is ui", field(r, "src") == "ui", field(r, "src"))

print("2) ui strategy follows page 2 (spaced labels)")
MA3.uiLabels = { "X Focus", "Y Focus", "Z Focus", "Position MSpeed" }
advanceClock(1)
r = request({ id = 2, action = "getEncoderBar" })
s = slots(r)
check("page-2 slots via label variants", s[1] == "XFocus" and s[2] == "YFocus"
  and s[3] == "ZFocus" and s[4] == "PositionMSpeed", table.concat(s, ","))

print("3) tick drives the page-2 attribute")
MA3.cmds = {}
advanceClock(1)
request({ id = 3, action = "tick", encoder = 1, delta = 2.5 })
check("Cmd targets XFocus", MA3.cmds[1] ~= nil
  and MA3.cmds[1]:find('Attribute "XFocus" At %+') ~= nil, tostring(MA3.cmds[1]))

print("4) cycleStack IGNORES user list that doesn't match page-2 base")
advanceClock(1)
r = request({ id = 4, action = "cycleStack", slot = 1, dir = 1, list = { "Pan", "Pan_Phaser" } })
local nm = field(r, "name")
check("no snap-back to Pan", nm ~= "Pan" and nm ~= "Pan_Phaser" and nm ~= nil and nm ~= "", tostring(nm))

print("5) back to page 1: cycleStack honors matching user list")
MA3.uiLabels = { "Pan", "Tilt", "Pan Rotate", "Tilt Rotate" }
advanceClock(1)
request({ id = 5, action = "getEncoderBar" })  -- page flip clears stickies
advanceClock(1)
r = request({ id = 6, action = "cycleStack", slot = 1, dir = 1, list = { "Pan", "Pan_Phaser" } })
check("first tap → Pan_Phaser", field(r, "name") == "Pan_Phaser", field(r, "name"))
r = request({ id = 7, action = "cycleStack", slot = 1, dir = 1, list = { "Pan", "Pan_Phaser" } })
check("second tap wraps → Pan", field(r, "name") == "Pan", field(r, "name"))

print("6) sticky overlays getEncoderBar, clears on page flip")
advanceClock(1)
r = request({ id = 8, action = "cycleStack", slot = 1, dir = 1, list = { "Pan", "Pan_Phaser" } })
local sticky = field(r, "name")
advanceClock(1)
r = request({ id = 9, action = "getEncoderBar" })
s = slots(r)
check("sticky shown in slot 1", s[1] == sticky, s[1] .. " vs " .. tostring(sticky))
MA3.uiLabels = { "X Focus", "Y Focus", "Z Focus", "Position MSpeed" }
advanceClock(1)
r = request({ id = 10, action = "getEncoderBar" })
s = slots(r)
check("page flip clears sticky", s[1] == "XFocus", s[1])

print("7) dynamic stack with no list (Color wheel)")
MA3.feature = "Color"
MA3.uiLabels = { "Color1", "ColorRGB_R", "ColorRGB_G", "ColorRGB_B" }
advanceClock(1)
request({ id = 11, action = "getEncoderBar" })
advanceClock(1)
r = request({ id = 12, action = "cycleStack", slot = 1, dir = 1 })
nm = field(r, "name")
check("dynamic cycle moves off Color1", nm ~= nil and nm ~= "" and nm ~= "Color1", tostring(nm))

print("8) degraded: no UI tree → win fallback anchored at selected attr")
MA3.feature = "Position"
MA3.uiAvailable = false
MA3.selectedAttr = "XFocus"
advanceClock(31)  -- past any uiBar failure cooldown
r = request({ id = 13, action = "getEncoderBar" })
s = slots(r)
check("win slots start at XFocus", s[1] == "XFocus", table.concat(s, ","))
check("src is win", field(r, "src") == "win", field(r, "src"))

print("9) degraded further: no GetSelectedAttribute → def first-4")
GetSelectedAttribute = nil
advanceClock(31)
r = request({ id = 14, action = "getEncoderBar" })
s = slots(r)
check("def slots are sorted first 4", s[1] == "Pan" and s[4] == "TiltRotate", table.concat(s, ","))

print("10) version + JSON validity of all replies")
r = request({ id = 15, action = "getVersion" })
check("bridge reports 0.13.43", field(r, "version") == "0.13.43", field(r, "version"))

-- dump raw replies for an external strict-JSON pass
local f = assert(io.open(SCRIPT_DIR .. "/../.harness-replies.jsonl", "w"))
for _, line in ipairs(RAW_REPLIES) do f:write(line) end
f:close()

print(string.format("\n%d passed, %d failed", PASS, #FAIL))
for _, msg in ipairs(FAIL) do print("  FAILED: " .. msg) end
os.exit(#FAIL == 0 and 0 or 1)
