-- rpc/legends.lua — Vizier MCP companion module (rpc.legends)
--
-- Exposes a read-only slice of DF's legends data (df.global.world.history.*
-- and adjacent) over DFHack's RunLua RPC. Without this module, Vizier MCP
-- cannot reach historical figures, events, sites, artifacts, written
-- contents, or entities — they're not on the remote socket.
--
-- INSTALL
-- -------
-- Copy this file to your DFHack Lua module tree at:
--
--     <DF install>/hack/lua/rpc/legends.lua
--
-- NOTE the path is `hack/lua/`, NOT `hack/scripts/`. DFHack's RunLua RPC
-- uses standard Lua `require()` against `package.path`, which searches
-- `hack/lua/`. Scripts in `hack/scripts/` are for the in-game command
-- prompt and are NOT reachable via RunLua.
--
-- Then in Vizier MCP, set VIZIER_ENABLE_RUN_LUA=1 in your shell (or in
-- the MCP config) and call `legends_setup_check` to confirm.
--
-- The module is referenced by RunLua as `module="rpc.legends"`. The dot
-- maps to a directory separator (rpc/legends.lua) per standard Lua
-- require semantics.
--
-- WHY THIS IS NEEDED
-- ------------------
-- See UNLOCKING-LEGENDS.md in the Vizier MCP repo. DFHack's RemoteServer
-- enforces SF_ALLOW_REMOTE per RPC and a module-name whitelist on RunLua
-- (`rpc.*` / `*.rpc` / `*-rpc`). The legends surface isn't exposed via
-- typed RPCs, so this Lua companion is the practical unlock.
--
-- MODULE SHAPE
-- ------------
-- This uses DFHack's `mkmodule` convention: `local _ENV = mkmodule(name)`
-- makes the module's environment the table that DFHack's RunLua dispatch
-- looks up functions on (via `rawget`). Returning `_ENV` exports it.
-- Global functions WILL NOT WORK — RunLua's PushModulePublic explicitly
-- requires a table and ignores _G.
--
-- SCHEMA
-- ------
-- Every function returns a single JSON string (NOT wrapped in a table —
-- DFHack's RunLua dispatch reads each Lua return value via lua_tostring,
-- and a table return stringifies to nil and gets dropped) with the
-- shape `{ ok = boolean, data | error = ... }`. Vizier decodes this on
-- its side; if you add functions, follow the same convention.
--
-- This module is intentionally minimal — extend it as Vizier grows new
-- legends tools.

local _ENV = mkmodule('rpc.legends')

local json = require('json')

local function ok(payload)
    return json.encode({ ok = true, data = payload })
end

local function err(message)
    return json.encode({ ok = false, error = tostring(message) })
end

local function name_string(name)
    if not name then return nil end
    if dfhack.TranslateName then
        local s = dfhack.TranslateName(name, true)
        if s and s ~= "" then return s end
    end
    return nil
end

-- Note on arguments: DFHack's RunLua pushes the protobuf `arguments`
-- repeated-string field as individual Lua varargs (NOT a single table).
-- So functions take `...` and use `select`/`{...}` to read them.

-- ping: probe whether the module is installed and callable.
-- Returns the schema version so the client can detect mismatches.
function ping(...)
    return ok({ schema = 1, dfhack = dfhack.getDFHackVersion() })
end

-- get_overview: counts + year range for the four big legends collections.
-- Cheap to call; reads top-level lengths only.
function get_overview(...)
    local hist = df.global.world.history
    local world_data = df.global.world.world_data
    local artifacts = df.global.world.artifacts
    local sites = world_data and world_data.sites
    local artifact_list = artifacts and artifacts.all

    local first_event = hist.events[0]
    local last_event_idx = #hist.events - 1
    local last_event = last_event_idx >= 0 and hist.events[last_event_idx] or nil

    return ok({
        counts = {
            historicalFigures = #hist.figures,
            events = #hist.events,
            sites = sites and #sites or 0,
            artifacts = artifact_list and #artifact_list or 0,
            writtenContents = #df.global.world.written_contents.all,
            entities = #df.global.world.entities.all,
        },
        yearRange = {
            first = first_event and first_event.year or nil,
            last = last_event and last_event.year or nil,
        },
        currentYear = df.global.cur_year,
    })
end

-- describe_historical_figure: by id, returns identity + key affiliations.
-- Args: first vararg is the figure id (as a string).
--
-- Defensive shape: each optional section is wrapped in pcall so a
-- field-shape mismatch with a future DFHack release surfaces as
-- a missing section in the response rather than a CR_FAILURE that
-- masks which line broke.
function describe_historical_figure(...)
    local id = tonumber((select(1, ...)))
    if not id then return err("missing id (first arg)") end

    local hf = df.historical_figure.find(id)
    if not hf then return err("not found: " .. tostring(id)) end

    local function try(fn)
        local okv, val = pcall(fn)
        if okv then return val end
        return nil
    end

    local entity_links = try(function()
        local out = {}
        for _, link in ipairs(hf.entity_links) do
            table.insert(out, {
                entityId = link.entity_id,
                -- link._type is a userdata reference to the polymorphic
                -- struct type; tostring() yields a readable name like
                -- "histfig_entity_link_memberst".
                linkType = tostring(link._type),
            })
        end
        return out
    end)

    local relationships = try(function()
        local out = {}
        for _, link in ipairs(hf.histfig_links) do
            table.insert(out, {
                targetId = link.target_hf,
                linkType = tostring(link._type),
            })
        end
        return out
    end)

    return ok({
        id = hf.id,
        name = try(function()
            return {
                firstName = (hf.name.first_name ~= "" and hf.name.first_name) or nil,
                translatedName = name_string(hf.name),
            }
        end),
        race = try(function() return hf.race end),
        caste = try(function() return hf.caste end),
        sex = try(function() return hf.sex end),
        birthYear = try(function() return hf.born_year end),
        deathYear = try(function()
            return hf.died_year ~= -1 and hf.died_year or nil
        end),
        flags = try(function()
            return {
                deity = hf.flags.deity,
                ghost = hf.flags.ghost,
                force = hf.flags.force,
            }
        end),
        entityLinks = entity_links,
        relationships = relationships,
    })
end

return _ENV
