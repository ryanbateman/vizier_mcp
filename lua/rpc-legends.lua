-- rpc-legends.lua — Vizier MCP companion script
--
-- Exposes a read-only slice of DF's legends data (df.global.world.history.*
-- and adjacent) over DFHack's RunLua RPC. Without this script, Vizier MCP
-- cannot reach historical figures, events, sites, artifacts, written
-- contents, or entities — they're not on the remote socket.
--
-- INSTALL
-- -------
-- Copy this file to your DFHack scripts tree at:
--
--     <DF install>/hack/scripts/rpc/legends.lua
--
-- Then in Vizier MCP, set VIZIER_ENABLE_RUN_LUA=1 in your shell (or in the
-- MCP config) and call `legends_setup_check` to confirm.
--
-- The module is referenced by RunLua as `module="rpc.legends"`. The file
-- must live under `hack/scripts/rpc/legends.lua` for that mapping to work.
--
-- WHY THIS IS NEEDED
-- ------------------
-- See UNLOCKING-LEGENDS.md in the Vizier MCP repo. DFHack's RemoteServer
-- enforces SF_ALLOW_REMOTE per RPC and a module-name whitelist on RunLua
-- (`rpc.*` / `*.rpc` / `*-rpc`). The legends surface isn't exposed via
-- typed RPCs, so this Lua companion is the practical unlock.
--
-- SCHEMA
-- ------
-- Every function returns a single-element string list `{ json.encode(...) }`
-- with the shape `{ ok = boolean, data | error = ... }`. Vizier decodes
-- this on its side; if you add functions, follow the same convention.
--
-- This script is intentionally minimal — extend it as Vizier grows new
-- legends tools.

local json = require('json')

local function ok(payload)
    return { json.encode({ ok = true, data = payload }) }
end

local function err(message)
    return { json.encode({ ok = false, error = tostring(message) }) }
end

local function name_string(name)
    if not name then return nil end
    if dfhack.TranslateName then
        local s = dfhack.TranslateName(name, true)
        if s and s ~= "" then return s end
    end
    return nil
end

-- ping: probe whether the module is installed and callable.
-- Returns the schema version so the client can detect mismatches.
function ping(args)
    return ok({ schema = 1, dfhack = dfhack.getDFHackVersion() })
end

-- get_overview: counts + year range for the four big legends collections.
-- Cheap to call; reads top-level lengths only.
function get_overview(args)
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
-- Args: { "12345" } — first arg is the figure id.
function describe_historical_figure(args)
    local id = tonumber(args and args[1])
    if not id then return err("missing id (first arg)") end

    local hf = df.historical_figure.find(id)
    if not hf then return err("not found: " .. tostring(id)) end

    local entity_links = {}
    for _, link in ipairs(hf.entity_links) do
        table.insert(entity_links, {
            entityId = link.entity_id,
            linkType = link:getType(),
        })
    end

    local relationships = {}
    if hf.histfig_links then
        for _, link in ipairs(hf.histfig_links) do
            table.insert(relationships, {
                targetId = link.target_hf,
                linkType = link:getType(),
            })
        end
    end

    return ok({
        id = hf.id,
        name = {
            firstName = (hf.name.first_name ~= "" and hf.name.first_name) or nil,
            translatedName = name_string(hf.name),
        },
        race = hf.race,
        caste = hf.caste,
        sex = hf.sex,
        birthYear = hf.born_year,
        deathYear = hf.died_year ~= -1 and hf.died_year or nil,
        flags = {
            deity = hf.flags.deity,
            ghost = hf.flags.ghost,
            force = hf.flags.force,
        },
        entityLinks = entity_links,
        relationships = relationships,
        currentSiteId = hf.info and hf.info.unk_14 and hf.info.unk_14.site or nil,
    })
end
