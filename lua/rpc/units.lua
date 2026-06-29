-- rpc/units.lua — Vizier MCP companion module (rpc.units)
--
-- Reversible, opt-in unit WRITE actions over DFHack's RunLua RPC — the
-- Dwarf-Therapist-style edits (nickname, custom profession) plus a teleport.
-- These touch df.unit fields that aren't writable over the typed
-- RemoteFortressReader socket, so — like rpc.legends / rpc.jobs — a Lua
-- companion is the practical route.
--
-- INSTALL: copy to <DF install>/hack/lua/rpc/units.lua (hack/lua/, NOT
-- hack/scripts/). `npx vizier-mcp install-companion` installs it alongside the
-- other companions. Requires VIZIER_ENABLE_RUN_LUA=1; the write tools also
-- require VIZIER_ENABLE_ACTIONS=1.
--
-- SAFETY: every mutation runs inside dfhack.with_suspend for a consistent
-- memory state. set_nickname / set_custom_profession are fully reversible
-- (pass an empty value to clear); teleport relocates the unit (capture its
-- prior pos via get_unit first if you want to move it back).
--
-- MODULE SHAPE / SCHEMA: identical to rpc.legends / rpc.jobs — mkmodule env,
-- each function returns a single JSON string `{ ok, data | error }`, arguments
-- arrive as individual varargs. Each writer reads the field back after the
-- write and returns the stored value so the caller sees the real result.

local _ENV = mkmodule('rpc.units')

local json = require('json')

local function sanitize(v)
    local t = type(v)
    if t == "table" then
        local out = {}
        for k, vv in pairs(v) do
            out[k] = sanitize(vv)
        end
        return out
    end
    if t == "userdata" then
        local n = tonumber(v)
        if n then return n end
        local ok_, s = pcall(tostring, v)
        if ok_ and s then return s end
        return nil
    end
    if t == "function" or t == "thread" then return nil end
    return v
end

local function ok(payload)
    return json.encode({ ok = true, data = sanitize(payload) })
end

local function err(message)
    return json.encode({ ok = false, error = tostring(message) })
end

-- Transcode a raw DF (CP437) string to UTF-8 (see legends.lua); nil for empty.
local function df_string(s)
    if s == nil or s == "" then return nil end
    if dfhack.df2utf then
        local ok_, utf = pcall(dfhack.df2utf, s)
        if ok_ and utf then return utf end
    end
    return s
end

-- Transcode a UTF-8 string from the MCP side back to DF's CP437 before it is
-- written into a name/profession field, so accented input round-trips.
local function to_df(s)
    if s == nil then return "" end
    if dfhack.utf2df then
        local ok_, cp = pcall(dfhack.utf2df, s)
        if ok_ and cp then return cp end
    end
    return s
end

-- ping: probe whether the module is installed and callable.
function ping(...)
    return ok({ schema = 1, dfhack = dfhack.getDFHackVersion() })
end

-- set_nickname: set or clear a unit's nickname (dfhack.units.setNickname,
-- which also updates the linked historical figure). Args: { unitId, nick? }.
-- An empty/absent nick clears it. Reversible. Returns the stored value.
function set_nickname(...)
    local id = tonumber((select(1, ...)))
    if not id then return err("missing unit id (first arg)") end
    local nick = to_df(select(2, ...) or "")
    local unit = df.unit.find(id)
    if not unit then return err("unit not found: " .. tostring(id)) end

    local stored
    local okm, e = pcall(function()
        dfhack.with_suspend(function() dfhack.units.setNickname(unit, nick) end)
        stored = unit.name and unit.name.nickname
    end)
    if not okm then return err("failed to set nickname: " .. tostring(e)) end
    return ok({ unitId = id, nickname = df_string(stored) })
end

-- set_custom_profession: set or clear a unit's custom profession label (the
-- free-text role that overrides the displayed profession, e.g. "Miner Lead").
-- Args: { unitId, profession? }. Empty/absent clears it. Reversible.
function set_custom_profession(...)
    local id = tonumber((select(1, ...)))
    if not id then return err("missing unit id (first arg)") end
    local prof = to_df(select(2, ...) or "")
    local unit = df.unit.find(id)
    if not unit then return err("unit not found: " .. tostring(id)) end

    local stored
    local okm, e = pcall(function()
        dfhack.with_suspend(function() unit.custom_profession = prof end)
        stored = unit.custom_profession
    end)
    if not okm then return err("failed to set custom profession: " .. tostring(e)) end
    return ok({ unitId = id, customProfession = df_string(stored) })
end

-- teleport_unit: relocate a unit to a map coordinate (dfhack.units.teleport).
-- Args: { unitId, x, y, z }. Returns the unit's pos after the move (capture
-- the prior pos via get_unit first to move it back).
--
-- Whole body is pcall-wrapped so any DF-side error (missing function, bad
-- coord) comes back as a readable err envelope instead of a CR_FAILURE the
-- client can't see into.
function teleport_unit(...)
    local args = { ... }
    local ok_body, result = pcall(function()
        local id = tonumber(args[1])
        local x, y, z = tonumber(args[2]), tonumber(args[3]), tonumber(args[4])
        if not (id and x and y and z) then
            return err("need unit id + x + y + z (four args)")
        end
        local unit = df.unit.find(id)
        if not unit then return err("unit not found: " .. tostring(id)) end
        if not (dfhack.units and dfhack.units.teleport) then
            return err("dfhack.units.teleport is unavailable in this DFHack build")
        end
        -- dfhack.maps.getTileBlock-style coord: a plain {x,y,z} table is
        -- accepted by the teleport binding (xyz2pos isn't in the module env).
        local pos = { x = x, y = y, z = z }
        dfhack.with_suspend(function() dfhack.units.teleport(unit, pos) end)
        return ok({ unitId = id, pos = { x = unit.pos.x, y = unit.pos.y, z = unit.pos.z } })
    end)
    if ok_body then return result end
    return err("teleport_unit internal error: " .. tostring(result))
end

return _ENV
