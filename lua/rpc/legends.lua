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

-- Render a language_name struct. `in_english = true` returns the
-- English translation (e.g. "Glazesuns"); false returns the native
-- form as the DF UI displays it (e.g. "Fikodad").
local function name_string(name, in_english)
    if not name then return nil end
    local fn = dfhack.translation and dfhack.translation.translateName
    if not fn then return nil end
    if in_english == nil then in_english = true end
    local ok_, s = pcall(fn, name, in_english)
    if ok_ and s and s ~= "" then return s end
    return nil
end

-- Strip "<type: foo>" → "foo". DFHack's tostring on a polymorphic
-- struct ref formats as the former; the bare type name reads cleaner.
local function type_name(t)
    if t == nil then return nil end
    local s = tostring(t)
    return s:match("<type: (.+)>") or s
end

-- pcall-wrapped section builder. Returns the section value on success
-- or nil on error, so a field-shape mismatch surfaces as a missing
-- section rather than crashing the whole call with CR_FAILURE.
local function try(fn)
    local okv, val = pcall(fn)
    if okv then return val end
    return nil
end

-- Note on arguments: DFHack's RunLua pushes the protobuf `arguments`
-- repeated-string field as individual Lua varargs (NOT a single table).
-- So functions take `...` and use `select`/`{...}` to read them.

-- ping: probe whether the module is installed and callable.
-- Returns the schema version so the client can detect mismatches.
function ping(...)
    return ok({ schema = 2, dfhack = dfhack.getDFHackVersion() })
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

    local entity_links = try(function()
        local out = {}
        for _, link in ipairs(hf.entity_links) do
            table.insert(out, {
                entityId = link.entity_id,
                -- link._type is a userdata reference to the polymorphic
                -- struct type; tostring() yields a readable name like
                -- "histfig_entity_link_memberst".
                linkType = type_name(link._type),
            })
        end
        return out
    end)

    local relationships = try(function()
        local out = {}
        for _, link in ipairs(hf.histfig_links) do
            table.insert(out, {
                targetId = link.target_hf,
                linkType = type_name(link._type),
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

-- find_histfig_by_unit_id: translate a fortress unit's unitId to its
-- histfig id. Returns nil if the unit isn't tracked as a historical
-- figure (most wildlife, most pets). Args: { unitId }.
function find_histfig_by_unit_id(...)
    local uid = tonumber((select(1, ...)))
    if not uid then return err("missing unit id (first arg)") end
    local unit = df.unit.find(uid)
    if not unit then return err("unit not found: " .. tostring(uid)) end
    local hfid = unit.hist_figure_id
    if not hfid or hfid == -1 then
        return ok({ unitId = uid, histfigId = nil, isHistoricalFigure = false })
    end
    return ok({ unitId = uid, histfigId = hfid, isHistoricalFigure = true })
end

-- find_histfig_by_name: case-insensitive substring search across
-- historical_figure.name fields. Returns up to `limit` matches (default
-- 10). Args: { needle, limit? }.
function find_histfig_by_name(...)
    local needle = select(1, ...)
    if not needle or needle == "" then return err("missing name needle (first arg)") end
    local limit = tonumber(select(2, ...)) or 10
    needle = string.lower(tostring(needle))

    local results = {}
    for _, hf in ipairs(df.global.world.history.figures) do
        if #results >= limit then break end
        local first = hf.name.first_name
        local english = name_string(hf.name, true)
        local native = name_string(hf.name, false)
        local function contains(s)
            return s and string.find(string.lower(s), needle, 1, true)
        end
        if contains(first) or contains(english) or contains(native) then
            table.insert(results, {
                id = hf.id,
                firstName = (first ~= "" and first) or nil,
                displayName = native,
                englishName = english,
                race = hf.race,
                birthYear = hf.born_year,
                deathYear = hf.died_year ~= -1 and hf.died_year or nil,
            })
        end
    end
    return ok({ matches = results, total = #results })
end

-- get_biography: composite "tell me about this dwarf" data.
-- Pulls identity from histfig, origins from histfig+events, tenure
-- from unit, innerLife from unit personality (RFR-blocked surface),
-- social from histfig_links, careerHighlights from filtered events,
-- craftedOutput from artifacts where this hf is the maker.
--
-- Every section pcall-wrapped so a field-shape mismatch surfaces as
-- a missing section rather than CR_FAILURE that hides which line broke.
-- Args: { histfigId }.
function get_biography(...)
    local id = tonumber((select(1, ...)))
    if not id then return err("missing histfig id (first arg)") end
    local hf = df.historical_figure.find(id)
    if not hf then return err("histfig not found: " .. tostring(id)) end

    -- Locate the live unit (if any) for personality/thoughts/stress.
    local unit = nil
    for _, u in ipairs(df.global.world.units.active) do
        if u.hist_figure_id == id then unit = u; break end
    end

    -- Helper to look up a histfig by id and return a thin reference.
    local function ref(target_hf_id)
        if not target_hf_id or target_hf_id == -1 then return nil end
        local h = df.historical_figure.find(target_hf_id)
        if not h then return { id = target_hf_id } end
        return {
            id = target_hf_id,
            firstName = (h.name.first_name ~= "" and h.name.first_name) or nil,
            displayName = name_string(h.name, false),
            englishName = name_string(h.name, true),
            alive = h.died_year == -1,
        }
    end

    local function links_of_type(types)
        local out = {}
        local ok_, _ = pcall(function()
            for _, link in ipairs(hf.histfig_links) do
                local tn = type_name(link._type)
                for _, want in ipairs(types) do
                    if tn == want then
                        local r = ref(link.target_hf)
                        if r then table.insert(out, r) end
                        break
                    end
                end
            end
        end)
        return out
    end

    local identity = try(function()
        return {
            histfigId = hf.id,
            unitId = unit and unit.id or nil,
            name = {
                firstName = (hf.name.first_name ~= "" and hf.name.first_name) or nil,
                -- displayName = the dwarvish surname as the DF UI shows
                -- it (e.g. "Fikodad"); englishName = translation flavour
                -- (e.g. "Glazesuns").
                displayName = name_string(hf.name, false),
                englishName = name_string(hf.name, true),
                nickname = (hf.name.nickname ~= "" and hf.name.nickname) or nil,
            },
            race = hf.race,
            caste = hf.caste,
            sex = hf.sex,
            currentProfession = unit and unit.profession or nil,
        }
    end)

    local origins = {
        birthYear = try(function() return hf.born_year end),
        originCivId = try(function() return hf.civ_id end),
        parents = try(function()
            return links_of_type({
                "histfig_hf_link_motherst",
                "histfig_hf_link_fatherst",
            })
        end) or {},
    }

    local tenure = try(function()
        if not unit then return nil end
        return {
            currentYear = df.global.cur_year,
            yearsAlive = df.global.cur_year - hf.born_year,
        }
    end)

    -- Inner life: the RFR-blocked surface this whole exercise was about.
    -- Field names cribbed from df.unit / df.unit_personality_moodst —
    -- if any are wrong-shaped in this DF version, that section silently
    -- returns nil and the rest of the bio still works.
    local inner_life = unit and try(function()
        local soul = unit.status and unit.status.current_soul
        local personality = soul and soul.personality
        local out = { hasSoul = soul ~= nil }
        if personality then
            out.stress = try(function() return personality.stress_level end)
            out.traits = try(function()
                local traits = {}
                for k, v in pairs(personality.traits) do
                    traits[tostring(k)] = v
                end
                return traits
            end)
            out.values = try(function()
                local vals = {}
                for _, v in ipairs(personality.values) do
                    table.insert(vals, {
                        type = type_name(v.type),
                        strength = v.strength,
                    })
                end
                return vals
            end)
            out.goals = try(function()
                local goals = {}
                for _, g in ipairs(personality.dreams or {}) do
                    table.insert(goals, type_name(g.type))
                end
                return goals
            end)
        end
        return out
    end) or nil

    local social = try(function()
        return {
            spouse = links_of_type({ "histfig_hf_link_spousest" })[1],
            formerSpouses = links_of_type({
                "histfig_hf_link_former_spousest",
                "histfig_hf_link_deceased_spousest",
            }),
            children = links_of_type({ "histfig_hf_link_childst" }),
            parents = links_of_type({
                "histfig_hf_link_motherst",
                "histfig_hf_link_fatherst",
            }),
            lovers = links_of_type({ "histfig_hf_link_loverst" }),
            companions = links_of_type({ "histfig_hf_link_companionst" }),
            deity = links_of_type({ "histfig_hf_link_deityst" })[1],
        }
    end)

    -- Career events: filter world.history.events by .histfig == id.
    -- DF events are polymorphic; subclasses store the focal histfig in
    -- different fields. Defensive: try common ones and surface a
    -- type_name + year so the TS side can render narrative strings.
    local career_highlights = try(function()
        local events = df.global.world.history.events
        local out = {}
        local total = 0
        for _, ev in ipairs(events) do
            -- Each event's field set varies by subclass; DFHack's Lua
            -- bindings raise on accessing a field that doesn't exist
            -- on this concrete subclass. pcall every probe so one
            -- subclass's missing field doesn't kill the whole walk.
            local matches = false
            for _, field in ipairs({ "histfig", "histfig_id", "actor",
                                     "slayer_hf", "targeted_histfig", "victim" }) do
                local ok_, v = pcall(function() return ev[field] end)
                if ok_ and v and v == id then matches = true; break end
            end
            if matches then
                total = total + 1
                if #out < 20 then
                    table.insert(out, {
                        eventId = try(function() return ev.id end),
                        year = try(function() return ev.year end),
                        type = try(function() return type_name(ev._type) end),
                    })
                end
            end
        end
        return { recent = out, totalEvents = total }
    end)

    local crafted_output = try(function()
        local out = {}
        for _, art in ipairs(df.global.world.artifacts.all) do
            -- Only item_crafted (and subclasses) carry a .maker field;
            -- accessing it on other subclasses errors. pcall the probe.
            local ok_, maker = pcall(function()
                return art.item and art.item.maker
            end)
            if ok_ and maker and maker == id then
                table.insert(out, {
                    artifactId = try(function() return art.id end),
                    name = try(function() return name_string(art.name) end),
                    itemId = try(function() return art.item.id end),
                    itemType = try(function() return type_name(art.item._type) end),
                })
            end
        end
        return out
    end) or {}

    return ok({
        identity = identity,
        origins = origins,
        tenure = tenure,
        innerLife = inner_life,
        social = social,
        careerHighlights = career_highlights,
        craftedOutput = crafted_output,
    })
end

return _ENV
