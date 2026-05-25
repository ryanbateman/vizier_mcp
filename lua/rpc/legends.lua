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

-- Walk a payload table, converting DFHack userdata fields to JSON-safe
-- values (number where possible, else string, else nil). Without this,
-- any typed enum/struct field that DFHack hands us as userdata trips
-- json.encode with "can't convert userdata to JSON" and the whole call
-- becomes opaque. Recursive but bounded by payload depth.
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

-- Render a language_name struct. `in_english = true` returns the
-- English translation (e.g. "Glazesuns"); false returns the native
-- form as the DF UI displays it (e.g. "Fikodad").
--
-- DF stores strings as CP437 bytes; passing those through json.encode
-- raw produces invalid UTF-8 (a bare 0x89 for ë, etc.) that the TS
-- side strips. dfhack.df2utf transcodes CP437 -> UTF-8 so the JSON
-- envelope round-trips intact.
local function name_string(name, in_english)
    if not name then return nil end
    local fn = dfhack.translation and dfhack.translation.translateName
    if not fn then return nil end
    if in_english == nil then in_english = true end
    local ok_, s = pcall(fn, name, in_english)
    if not (ok_ and s and s ~= "") then return nil end
    if dfhack.df2utf then
        local ok2, utf = pcall(dfhack.df2utf, s)
        if ok2 and utf then return utf end
    end
    return s
end

-- Transcode a raw DF (CP437) string field to UTF-8 so accented
-- characters survive the json.encode + JS UTF-8 decode round trip.
-- Returns nil for empty/missing input so callers can chain `or nil`.
local function df_string(s)
    if s == nil or s == "" then return nil end
    if dfhack.df2utf then
        local ok_, utf = pcall(dfhack.df2utf, s)
        if ok_ and utf then return utf end
    end
    return s
end

-- Resolve an enum code (int) to its symbolic name using a DFHack
-- df.* enum table (e.g. df.value_type, df.goal_type). Returns the
-- name string when known, or the bare code as a fallback so the
-- caller still has *something* renderable.
local function enum_name(enum, code)
    if enum == nil or code == nil then return nil end
    local ok_, name = pcall(function() return enum[code] end)
    if ok_ and type(name) == "string" then return name end
    return tostring(code)
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

-- World-data refs: every bare integer id that leaves the module is
-- wrapped in { kind, id [, name] } so the consumer can either narrate
-- around it ("a site I would need to look up") or call describe_<kind>
-- for the follow-up. When `resolve` is true, the ref carries an inline
-- `name` — pay the lookup cost up front. When false (default), the
-- ref is bare and the caller decides what to do with it.
--
-- Position refs are composite: { kind="position", entityId, positionId }
-- — position ids are entity-local, so both are needed to dereference.
local function site_ref(id, resolve)
    if not id or id == -1 then return nil end
    if not resolve then return { kind = "site", id = id } end
    local s = df.world_site.find(id)
    if not s then return { kind = "site", id = id } end
    return { kind = "site", id = id, name = name_string(s.name) }
end

local function entity_ref(id, resolve)
    if not id or id == -1 then return nil end
    if not resolve then return { kind = "entity", id = id } end
    local e = df.historical_entity.find(id)
    if not e then return { kind = "entity", id = id } end
    return { kind = "entity", id = id, name = name_string(e.name) }
end

local function artifact_ref(id, resolve)
    if not id or id == -1 then return nil end
    if not resolve then return { kind = "artifact", id = id } end
    local a = df.artifact_record.find(id)
    if not a then return { kind = "artifact", id = id } end
    return { kind = "artifact", id = id, name = name_string(a.name) }
end

local function region_ref(id, resolve)
    if not id or id == -1 then return nil end
    if not resolve then return { kind = "region", id = id } end
    local r = df.world_region.find(id)
    if not r then return { kind = "region", id = id } end
    return { kind = "region", id = id, name = name_string(r.name) }
end

local function written_content_ref(id, resolve)
    if not id or id == -1 then return nil end
    if not resolve then return { kind = "written_content", id = id } end
    local wc = df.written_content.find(id)
    if not wc then return { kind = "written_content", id = id } end
    return {
        kind = "written_content",
        id = id,
        title = try(function() return df_string(wc.title) end),
    }
end

-- Histfig ref shape used everywhere a person is referenced from another
-- person's record (relationships, slayer/victim, position holders,
-- artifact makers, search hits). Always carries sex so the TS layer can
-- name it cleanly — previously sex was identity-only and downstream
-- readers misgendered children/spouses/etc. that only appeared via refs.
local function hf_ref(target_hf_id)
    if not target_hf_id or target_hf_id == -1 then return nil end
    local h = df.historical_figure.find(target_hf_id)
    if not h then return { id = target_hf_id } end
    return {
        id = target_hf_id,
        firstName = df_string(h.name.first_name),
        displayName = name_string(h.name, false),
        englishName = name_string(h.name, true),
        alive = h.died_year == -1,
        sex = try(function() return h.sex end),
    }
end

local function position_ref(entity_id, position_id, resolve)
    if not position_id or position_id == -1 then return nil end
    local out = { kind = "position", entityId = entity_id, positionId = position_id }
    if not resolve or not entity_id or entity_id == -1 then return out end
    local ent = df.historical_entity.find(entity_id)
    if not ent or not ent.positions then return out end
    for _, pos in ipairs(ent.positions.own or {}) do
        if pos.id == position_id then
            out.code = try(function() return pos.code end)
            out.name = try(function()
                return pos.name and pos.name[0] and df_string(pos.name[0])
            end)
            return out
        end
    end
    return out
end

-- Note on arguments: DFHack's RunLua pushes the protobuf `arguments`
-- repeated-string field as individual Lua varargs (NOT a single table).
-- So functions take `...` and use `select`/`{...}` to read them.

-- ping: probe whether the module is installed and callable.
-- Returns the schema version so the client can detect mismatches.
function ping(...)
    return ok({ schema = 8, dfhack = dfhack.getDFHackVersion() })
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
                firstName = df_string(hf.name.first_name),
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
                firstName = df_string(first),
                displayName = native,
                englishName = english,
                race = hf.race,
                sex = try(function() return hf.sex end),
                birthYear = hf.born_year,
                deathYear = hf.died_year ~= -1 and hf.died_year or nil,
            })
        end
    end
    return ok({ matches = results, total = #results })
end

-- list_noble_positions: walk historical_entity.positions.assignments for
-- the player's fortress group and parent civ (or all entities, on
-- request) and return one record per assignment. Each record carries
-- the entity id, the position code (e.g. "CHIEF_MEDICAL_DWARF") +
-- display name, and the holder's histfigId resolved through ref() so
-- the caller has enough to pivot straight into dwarf_biography.
--
-- Args: { scope? } where scope ∈ "fort" | "civ" | "fort_and_civ" (default) | "all"
--
-- entity.positions is a struct with two parallel vectors: `own` (the
-- position definitions) and `assignments` (who currently holds them,
-- keyed by position_id which is the definition's local id, not its
-- code). Vacant positions are surfaced with vacant=true so a player
-- can see what's currently unfilled.
function list_noble_positions(...)
    local scope = tostring(select(1, ...) or "fort_and_civ")

    local entity_ids = {}
    local seen = {}
    local function add_entity(eid)
        if eid and eid ~= -1 and not seen[eid] then
            seen[eid] = true
            entity_ids[#entity_ids + 1] = eid
        end
    end

    if scope == "fort" or scope == "fort_and_civ" then
        local fort = try(function() return df.global.plotinfo.main.fortress_entity end)
        if fort then add_entity(fort.id) end
    end
    if scope == "civ" or scope == "fort_and_civ" then
        local civ_id = try(function() return df.global.plotinfo.civ_id end)
        add_entity(civ_id)
    end
    if scope == "all" then
        for _, ent in ipairs(df.global.world.entities.all) do
            add_entity(ent.id)
        end
    end

    local out = {}
    for _, eid in ipairs(entity_ids) do
        local ent = df.historical_entity.find(eid)
        if ent and ent.positions then
            local positions_by_id = {}
            for _, pos in ipairs(ent.positions.own or {}) do
                positions_by_id[pos.id] = pos
            end
            for _, asn in ipairs(ent.positions.assignments or {}) do
                local pos = positions_by_id[asn.position_id]
                if pos then
                    local hfid = asn.histfig
                    local entry = {
                        entityId = ent.id,
                        positionCode = try(function() return pos.code end),
                        positionName = try(function()
                            return pos.name and pos.name[0] and df_string(pos.name[0])
                        end),
                        positionNamePlural = try(function()
                            return pos.name and pos.name[1] and df_string(pos.name[1])
                        end),
                    }
                    if hfid and hfid ~= -1 then
                        entry.holder = hf_ref(hfid)
                        entry.vacant = false
                    else
                        entry.vacant = true
                    end
                    table.insert(out, entry)
                end
            end
        end
    end

    return ok({ positions = out, total = #out })
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
    local resolve = (select(2, ...) == "resolve")
    local hf = df.historical_figure.find(id)
    if not hf then return err("histfig not found: " .. tostring(id)) end

    -- Top-level pcall so an uncaught error in any section returns as a
    -- LegendsError with the actual message instead of a CR_FAILURE
    -- that the TS-side maps to ScriptMissingError.
    local ok_body, result_or_err = pcall(function()
        return _build_biography(id, hf, resolve)
    end)
    if ok_body then return result_or_err end
    return err("get_biography internal error: " .. tostring(result_or_err))
end

function _build_biography(id, hf, resolve)
    -- Locate the live unit (if any) for personality/thoughts/stress.
    local unit = nil
    for _, u in ipairs(df.global.world.units.active) do
        if u.hist_figure_id == id then unit = u; break end
    end

    -- Per-call diagnostic: which link categories hit a pcall error
    -- while iterating. Lets the consumer distinguish a real empty list
    -- (e.g. migrant with no parents recorded) from a silently-eaten
    -- DF-structures shape mismatch.
    local link_errors = {}

    local function links_of_type(types)
        local out = {}
        local label = types[1] or "?"
        local ok_outer, _ = pcall(function()
            for _, link in ipairs(hf.histfig_links) do
                local ok_inner, _ = pcall(function()
                    local tn = type_name(link._type)
                    for _, want in ipairs(types) do
                        if tn == want then
                            local r = hf_ref(link.target_hf)
                            if r then table.insert(out, r) end
                            break
                        end
                    end
                end)
                if not ok_inner then link_errors[label] = true end
            end
        end)
        if not ok_outer then link_errors[label] = true end
        return out
    end

    local identity = try(function()
        return {
            histfigId = hf.id,
            unitId = unit and unit.id or nil,
            name = {
                firstName = df_string(hf.name.first_name),
                -- displayName = the dwarvish surname as the DF UI shows
                -- it (e.g. "Fikodad"); englishName = translation flavour
                -- (e.g. "Glazesuns").
                displayName = name_string(hf.name, false),
                englishName = name_string(hf.name, true),
                nickname = df_string(hf.name.nickname),
            },
            race = hf.race,
            caste = hf.caste,
            sex = hf.sex,
            currentProfession = unit and unit.profession or nil,
        }
    end)

    local origins = {
        birthYear = try(function() return hf.born_year end),
        originCiv = try(function() return entity_ref(hf.civ_id, resolve) end),
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
            -- traits is an int16 vector indexed by df.personality_facet_type
            -- (the enum sometimes shows up as personality_facet under
            -- different DF builds — try both). Values are 0-100 strengths.
            out.traits = try(function()
                local enum = df.personality_facet_type or df.personality_facet
                local traits = {}
                for k, v in pairs(personality.traits) do
                    local name = enum_name(enum, k) or tostring(k)
                    traits[name] = v
                end
                return traits
            end)
            out.values = try(function()
                local vals = {}
                for _, v in ipairs(personality.values) do
                    table.insert(vals, {
                        type = enum_name(df.value_type, v.type),
                        typeCode = v.type,
                        strength = v.strength,
                    })
                end
                return vals
            end)
            out.goals = try(function()
                local goals = {}
                for _, g in ipairs(personality.dreams or {}) do
                    table.insert(goals, {
                        type = enum_name(df.goal_type, g.type),
                        typeCode = g.type,
                    })
                end
                return goals
            end)
            -- preferences: the "likes copper for its colour" data. Each
            -- entry's payload depends on .type — pcall every probe so a
            -- shape-mismatched subfield doesn't kill the whole list.
            -- TS side resolves creatureId/material/itemType ids to names
            -- via the existing lookup cache.
            out.preferences = try(function()
                local enum = df.unit_preference and df.unit_preference.T_type
                local prefs = {}
                for _, p in ipairs(personality.preferences or {}) do
                    local entry = {
                        type = enum_name(enum, p.type),
                        typeCode = p.type,
                    }
                    entry.itemType = try(function() return p.item_type end)
                    entry.itemSubtype = try(function() return p.item_subtype end)
                    entry.matType = try(function() return p.mattype end)
                    entry.matIndex = try(function() return p.matindex end)
                    entry.creatureId = try(function() return p.creature_id end)
                    entry.colorId = try(function() return p.color_id end)
                    entry.shapeId = try(function() return p.shape_id end)
                    entry.plantId = try(function() return p.plant_id end)
                    entry.poeticFormId = try(function() return p.poetic_form_id end)
                    entry.musicalFormId = try(function() return p.musical_form_id end)
                    entry.danceFormId = try(function() return p.dance_form_id end)
                    table.insert(prefs, entry)
                end
                return prefs
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
            siblings = links_of_type({ "histfig_hf_link_siblingst" }),
            lovers = links_of_type({ "histfig_hf_link_loverst" }),
            companions = links_of_type({ "histfig_hf_link_companionst" }),
            friends = links_of_type({ "histfig_hf_link_friendst" }),
            grudges = links_of_type({ "histfig_hf_link_grudgest" }),
            pets = links_of_type({ "histfig_hf_link_pet_ownerst" }),
            apprentices = links_of_type({ "histfig_hf_link_apprenticest" }),
            masters = links_of_type({ "histfig_hf_link_masterst" }),
            deity = links_of_type({ "histfig_hf_link_deityst" })[1],
        }
    end)

    -- Strip history_event_ prefix and trailing 'st' from a polymorphic
    -- event type symbol. history_event_hist_figure_diedst -> hist_figure_died.
    local function event_type(ev)
        local t = type_name(ev._type)
        if not t then return nil end
        t = t:gsub("^history_event_", ""):gsub("st$", "")
        return t
    end

    -- Career events: walk world.history.events for any field that holds
    -- this histfig's id, record WHICH field matched (so the narrator can
    -- distinguish "slew X" from "was slain by X"), and resolve the OTHER
    -- party's id to a name where the event has a paired field.
    --
    -- Roles seen so far in DF events: histfig/histfig_id (single-subject),
    -- actor + target_hf / targeted_histfig (initiator + target),
    -- slayer_hf + victim_hf (lethal), persecutor + target_hf, etc.
    --
    -- Defensive: DFHack's Lua bindings raise on accessing a field that
    -- doesn't exist on the concrete subclass, so every probe is pcall'd.
    -- Field-name variants for the focal histfig across event subclasses.
    -- DF death events use `victim_hf`/`slayer_hf`; older snippets used
    -- bare `victim`. We probe both so neither hides the participant.
    local function paired_field(role)
        if role == "slayer_hf" then return "victim_hf", "victim" end
        if role == "victim_hf" then return "slayer_hf", "slayer" end
        if role == "victim" then return "slayer_hf", "slayer" end
        if role == "actor" then return "target_hf", "target" end
        if role == "target_hf" then return "actor", "actor" end
        if role == "targeted_histfig" then return "actor", "actor" end
        return nil, nil
    end

    -- Generic per-event world-data ref probe. For each event we look
    -- at a handful of well-known fields (artifact, site, region,
    -- entity, position) and emit refs the consumer can either narrate
    -- around or follow up on via describe_<kind>.
    --
    -- Position is composite — it needs an entity context — so we pick
    -- up the entity ref first and feed it into position_ref.
    local function event_refs(ev)
        local function field(name)
            local ok_, v = pcall(function() return ev[name] end)
            if ok_ and v and v ~= -1 then return v end
            return nil
        end

        local refs = {}
        local art = field("artifact_id") or field("artifact")
        if art then refs.artifact = artifact_ref(art, resolve) end
        local site = field("site_id") or field("site")
        if site then refs.site = site_ref(site, resolve) end
        local region = field("subregion") or field("region_id") or field("region")
        if region then refs.region = region_ref(region, resolve) end
        local ent = field("entity") or field("civ") or field("entity_id")
        if ent then refs.entity = entity_ref(ent, resolve) end
        local pos = field("position") or field("position_id")
        if pos then refs.position = position_ref(ent, pos, resolve) end
        -- written_content_composedst uses `content` for the wc id
        -- (verified via inspect_event 2026-05-25). Other variants kept
        -- as fallbacks against future event subclasses.
        local wc = field("content") or field("wc_id") or field("wc")
            or field("written_content") or field("written_content_id")
            or field("content_id")
        if wc then refs.writtenContent = written_content_ref(wc, resolve) end

        if next(refs) == nil then return nil end
        return refs
    end

    local career_highlights = try(function()
        local events = df.global.world.history.events
        local out = {}
        local total = 0
        for _, ev in ipairs(events) do
            local role = nil
            for _, field in ipairs({ "histfig", "histfig_id", "actor",
                                     "slayer_hf", "victim_hf", "victim",
                                     "targeted_histfig", "target_hf" }) do
                local ok_, v = pcall(function() return ev[field] end)
                if ok_ and v and v == id then role = field; break end
            end
            if role then
                total = total + 1
                if #out < 20 then
                    local entry = {
                        eventId = try(function() return ev.id end),
                        year = try(function() return ev.year end),
                        type = try(function() return event_type(ev) end),
                        rawType = try(function() return type_name(ev._type) end),
                        role = role,
                    }
                    local other_field, other_label = paired_field(role)
                    if other_field then
                        local ok_, other_id = pcall(function() return ev[other_field] end)
                        if ok_ and other_id and other_id ~= -1 then
                            entry.otherRole = other_label
                            entry.other = hf_ref(other_id)
                        end
                    end
                    entry.refs = event_refs(ev)
                    table.insert(out, entry)
                end
            end
        end
        return { recent = out, totalEvents = total }
    end)

    -- Worldgen backstory: hf.info carries data accrued during world
    -- generation — kills, skills learned, masterpieces, whereabouts,
    -- secrets. Especially load-bearing for older dwarves born before
    -- the fort was founded (e.g. a 56-year-old who walked in as a
    -- migrant carries an entire pre-fort life here).
    --
    -- hf.info itself may be nil for very simple histfigs; each
    -- subfield is its own optional pointer. pcall every probe.
    local backstory = try(function()
        if not hf.info then return nil end
        local out = {}
        out.kills = try(function()
            local k = hf.info.kills
            if not k then return nil end
            -- hf.info.kills holds two parallel-ish counters that DO NOT
            -- measure the same thing:
            --   events       — historical-figure kill events this hf
            --                  is recorded as slayer in (worldgen and
            --                  later). Empirically: a goblin demon's
            --                  slaying of a histfig DOES appear here.
            --   killed_race  — flat vector of creature race-ids; appears
            --                  to track only the wildlife/incidental
            --                  side (a histfig slaying may produce a
            --                  historicEvents++ without a killed_race
            --                  entry). The bucketed form is published
            --                  as `byRaceTally` so the caller cannot
            --                  mistake the two for a single total.
            local events = k.events or {}
            local races = {}
            for _, race_id in ipairs(k.killed_race or {}) do
                local key = tostring(tonumber(race_id) or race_id)
                races[key] = (races[key] or 0) + 1
            end
            return {
                historicEvents = #events,
                byRaceTally = next(races) and races or nil,
                byRaceTallyLength = #(k.killed_race or {}),
            }
        end)
        out.skills = try(function()
            local s = hf.info.skills
            if not s then return nil end
            local list = {}
            for _, entry in ipairs(s.skills or {}) do
                table.insert(list, {
                    type = enum_name(df.job_skill, entry.type),
                    typeCode = try(function() return entry.type end),
                    rating = try(function() return entry.rating end),
                })
            end
            return list
        end)
        out.masterpieces = try(function()
            local m = hf.info.masterpieces
            if not m then return nil end
            return {
                eventCount = try(function() return #(m.events or {}) end),
            }
        end)
        out.whereabouts = try(function()
            local w = hf.info.whereabouts
            if not w then return nil end
            return {
                state = try(function()
                    local enum = df.whereabouts_type or df.unit_whereabouts_state
                    return enum_name(enum, tonumber(w.state)) or tostring(w.state)
                end),
                stateCode = try(function() return tonumber(w.state) end),
                region = try(function() return region_ref(w.region_id, resolve) end),
                site = try(function() return site_ref(w.site_id, resolve) end),
                armyId = try(function() return w.army_id end),
            }
        end)
        out.secret = try(function()
            local s = hf.info.secret
            if not s then return nil end
            return {
                knowsSecrets = true,
            }
        end)
        return out
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

    -- Surface which link categories had iteration errors. Empty table
    -- means every category iterated cleanly (so an empty `parents` is
    -- a real fact about the dwarf, not a swallowed exception).
    local link_errors_list = {}
    for k, _ in pairs(link_errors) do table.insert(link_errors_list, k) end

    return ok({
        identity = identity,
        origins = origins,
        tenure = tenure,
        innerLife = inner_life,
        social = social,
        careerHighlights = career_highlights,
        craftedOutput = crafted_output,
        backstory = backstory,
        linkErrors = link_errors_list,
    })
end

-- describe_site: resolve a site id to its name + type + owning entity.
-- Pivot target from any { kind="site", id } ref returned by bio or
-- living_legends. Args: { siteId }.
function describe_site(...)
    local id = tonumber(select(1, ...))
    if not id then return err("missing site id (first arg)") end
    local s = df.world_site.find(id)
    if not s then return err("site not found: " .. tostring(id)) end

    return ok({
        id = s.id,
        name = try(function() return name_string(s.name) end),
        type = try(function()
            local enum = df.world_site_type or (df.world_site and df.world_site.T_type)
            return enum_name(enum, tonumber(s.type)) or tostring(s.type)
        end),
        typeCode = try(function() return tonumber(s.type) end),
        civId = try(function() return s.civ_id end),
        ownerCiv = try(function() return entity_ref(s.cur_owner_id, true) end),
        pos = try(function() return { x = s.pos.x, y = s.pos.y } end),
    })
end

-- describe_entity: resolve an entity id to its name, type (Civilization /
-- SiteGovernment / Religion / ...), race, and LAW_MAKING position
-- holders (the leaders). Args: { entityId }.
function describe_entity(...)
    local id = tonumber(select(1, ...))
    if not id then return err("missing entity id (first arg)") end
    local e = df.historical_entity.find(id)
    if not e then return err("entity not found: " .. tostring(id)) end

    local leaders = try(function()
        local out = {}
        if not e.positions then return out end
        local positions_by_id = {}
        for _, pos in ipairs(e.positions.own or {}) do
            positions_by_id[pos.id] = pos
        end
        for _, asn in ipairs(e.positions.assignments or {}) do
            local pos = positions_by_id[asn.position_id]
            if pos and asn.histfig and asn.histfig ~= -1 then
                local is_leader = try(function()
                    return pos.responsibilities and pos.responsibilities.LAW_MAKING
                end)
                if is_leader then
                    local holder = hf_ref(asn.histfig)
                    if holder then
                        table.insert(out, {
                            positionCode = try(function() return pos.code end),
                            positionName = try(function()
                                return pos.name and pos.name[0] and df_string(pos.name[0])
                            end),
                            holder = holder,
                        })
                    end
                end
            end
        end
        return out
    end) or {}

    return ok({
        id = e.id,
        name = try(function() return name_string(e.name) end),
        type = try(function()
            return enum_name(df.historical_entity_type, tonumber(e.type))
                or tostring(e.type)
        end),
        typeCode = try(function() return tonumber(e.type) end),
        race = try(function() return e.race end),
        leaders = leaders,
    })
end

-- inspect_event (diagnostic): dump the field names + scalar values
-- on a history event by id, so we can discover the actual field name
-- for new ref-probing (e.g. which field on written_content_composedst
-- carries the wc id). Not exposed as an MCP tool — call via
-- callLegends("inspect_event", [id]). Args: { eventId }.
function inspect_event(...)
    local id = tonumber(select(1, ...))
    if not id then return err("missing event id (first arg)") end
    local target = nil
    for _, ev in ipairs(df.global.world.history.events) do
        if ev.id == id then target = ev; break end
    end
    if not target then return err("event not found: " .. tostring(id)) end

    local fields = {}
    for k, v in pairs(target) do
        local tk = type(k)
        local key = tk == "string" and k or tostring(k)
        local tv = type(v)
        local repr = nil
        if tv == "number" or tv == "boolean" or tv == "string" then
            repr = v
        elseif tv == "userdata" then
            repr = tostring(v)
        else
            repr = tv
        end
        fields[key] = repr
    end

    return ok({
        id = id,
        type = type_name(target._type),
        year = try(function() return target.year end),
        fields = fields,
    })
end

-- describe_written_content: resolve a written-content id to its
-- title, form, style, and author (as a histfig ref). Pivot target from
-- any { kind="written_content", id } ref returned by bio
-- careerHighlights on a written_content_composedst event. Args: { wcId }.
function describe_written_content(...)
    local id = tonumber(select(1, ...))
    if not id then return err("missing written-content id (first arg)") end
    local wc = df.written_content.find(id)
    if not wc then return err("written content not found: " .. tostring(id)) end

    return ok({
        id = wc.id,
        title = try(function() return df_string(wc.title) end),
        author = try(function() return hf_ref(wc.author) end),
        form = try(function()
            return enum_name(df.written_content_type, tonumber(wc.type))
                or tostring(wc.type)
        end),
        formCode = try(function() return tonumber(wc.type) end),
        style = try(function()
            local enum = df.written_content_style
            return enum and enum_name(enum, tonumber(wc.style)) or tostring(wc.style)
        end),
        pageStart = try(function() return wc.page_start end),
        pageEnd = try(function() return wc.page_end end),
    })
end

-- describe_artifact: resolve an artifact id to its name + item type +
-- maker (as a histfig ref). The item itself carries more (material,
-- quality, decorations) but those require a separate item walk — kept
-- minimal here. Args: { artifactId }.
function describe_artifact(...)
    local id = tonumber(select(1, ...))
    if not id then return err("missing artifact id (first arg)") end
    local a = df.artifact_record.find(id)
    if not a then return err("artifact not found: " .. tostring(id)) end

    return ok({
        id = a.id,
        name = try(function() return name_string(a.name) end),
        item = try(function()
            if not a.item then return nil end
            return {
                id = try(function() return a.item.id end),
                type = try(function() return type_name(a.item._type) end),
                maker = try(function() return hf_ref(a.item.maker) end),
            }
        end),
    })
end

-- living_legends: "who matters in this world right now" — a curated digest
-- of prominent historical figures, classified by why they're notable.
-- Categories surfaced:
--   civLeaders        — holders of LAW_MAKING positions in Civilization
--                       entities (kings, queens, lawgivers across all civs)
--   artifactCreators  — top-N histfigs by count of artifacts they crafted,
--                       with sample artifact names (dead or alive — the
--                       artifact's fame outlives the maker)
--   megabeasts        — alive race-MEGABEAST histfigs (rocs, dragons, etc.)
--   semimegabeasts    — alive race-SEMIMEGABEAST histfigs
--   forgottenBeasts   — alive race-FEATURE_BEAST histfigs (cavern dwellers)
--   nightCreatures    — alive race-NIGHT_CREATURE_* (bogeymen, nightmares...)
--   demons            — alive race-UNIQUE_DEMON
--   titans            — alive race-TITAN
--   necromancers      — alive histfigs with hf.info.secret set
--   cursedFigures     — alive histfigs with curse_year set (vampires/were-)
--   heroes            — alive histfigs with kill_count >= 10 not in a beast
--                       category, sorted by kill count, capped at 30
--
-- Each entry carries enough for the caller to pivot to dwarf_biography:
-- histfigId, names, race id, birth/death years, alive flag, plus
-- category-specific context (positionCode for leaders, artifactCount for
-- creators, killCount for heroes, whereabouts for beasts).
--
-- Args: { include_dead? } — pass "include_dead" to also surface deceased
-- figures across non-artifact categories (default: alive-only for beasts/
-- leaders/necromancers; artifactCreators always includes the dead since
-- the artifact survives them).
--
-- Categories with more entries than the cap surface totals separately so
-- the caller can ask for follow-ups via list_historical_figures (future).
function living_legends(...)
    local include_dead = (select(1, ...) == "include_dead")
    local HERO_CAP = 30
    local NECRO_CAP = 30
    local CREATOR_CAP = 20
    local CREATOR_SAMPLES = 5
    local HERO_THRESHOLD = 10

    local current_year = df.global.cur_year

    -- Pre-aggregate artifact-maker counts (and sample artifact names).
    local artifact_counts = {}
    local artifact_samples = {}
    try(function()
        for _, art in ipairs(df.global.world.artifacts.all) do
            local ok_, maker = pcall(function() return art.item and art.item.maker end)
            if ok_ and maker and maker ~= -1 then
                artifact_counts[maker] = (artifact_counts[maker] or 0) + 1
                local samples = artifact_samples[maker]
                if not samples then samples = {}; artifact_samples[maker] = samples end
                if #samples < CREATOR_SAMPLES then
                    table.insert(samples, {
                        artifactId = try(function() return art.id end),
                        name = try(function() return name_string(art.name) end),
                    })
                end
            end
        end
    end)

    -- Civ leaders: walk Civilization entities, find LAW_MAKING position
    -- holders. Captures cross-civ rulers, not just the player's parent civ.
    local civ_leaders = {}
    local civ_type = try(function() return df.historical_entity_type.Civilization end)
    try(function()
        for _, ent in ipairs(df.global.world.entities.all) do
            if (civ_type == nil or ent.type == civ_type) and ent.positions then
                local positions_by_id = {}
                for _, pos in ipairs(ent.positions.own or {}) do
                    positions_by_id[pos.id] = pos
                end
                for _, asn in ipairs(ent.positions.assignments or {}) do
                    local pos = positions_by_id[asn.position_id]
                    local hfid = asn.histfig
                    if pos and hfid and hfid ~= -1 then
                        local is_leader = try(function()
                            return pos.responsibilities and pos.responsibilities.LAW_MAKING
                        end)
                        if is_leader then
                            local r = hf_ref(hfid)
                            if r and (include_dead or r.alive) then
                                r.entityId = ent.id
                                r.entityName = try(function() return name_string(ent.name) end)
                                r.positionCode = try(function() return pos.code end)
                                r.positionName = try(function()
                                    return pos.name and pos.name[0] and df_string(pos.name[0])
                                end)
                                table.insert(civ_leaders, r)
                            end
                        end
                    end
                end
            end
        end
    end)

    -- Iterate all historical figures classifying threats/necromancers/heroes.
    local megabeasts, semimegabeasts, forgotten_beasts = {}, {}, {}
    local night_creatures, demons, titans = {}, {}, {}
    local necromancers, cursed = {}, {}
    local heroes = {}

    local function whereabouts(hf)
        return try(function()
            local w = hf.info and hf.info.whereabouts
            if not w then return nil end
            local enum = df.whereabouts_type or df.unit_whereabouts_state
            return {
                state = enum_name(enum, tonumber(w.state)),
                siteId = w.site_id,
                regionId = w.region_id,
            }
        end)
    end

    local function build(hf, kill_count, extras)
        local e = {
            id = hf.id,
            firstName = df_string(hf.name.first_name),
            displayName = name_string(hf.name, false),
            englishName = name_string(hf.name, true),
            race = try(function() return hf.race end),
            sex = try(function() return hf.sex end),
            birthYear = try(function() return hf.born_year end),
            deathYear = try(function()
                return hf.died_year ~= -1 and hf.died_year or nil
            end),
            alive = hf.died_year == -1,
            killCount = (kill_count and kill_count > 0) and kill_count or nil,
            whereabouts = whereabouts(hf),
        }
        if extras then
            for k, v in pairs(extras) do e[k] = v end
        end
        return e
    end

    try(function()
        for _, hf in ipairs(df.global.world.history.figures) do
            local alive = hf.died_year == -1
            local is_deity = try(function() return hf.flags.deity end) or false
            local is_force = try(function() return hf.flags.force end) or false
            if not is_deity and not is_force and (include_dead or alive) then
                local raw = nil
                pcall(function() raw = df.creature_raw.find(hf.race) end)
                local function rf(name)
                    if not raw or not raw.flags then return false end
                    local v = nil
                    pcall(function() v = raw.flags[name] end)
                    return v == true
                end

                local kill_count = 0
                pcall(function()
                    if hf.info and hf.info.kills and hf.info.kills.events then
                        kill_count = #hf.info.kills.events
                    end
                end)

                local is_megabeast = rf("MEGABEAST")
                local is_semi = rf("SEMIMEGABEAST")
                local is_fb = rf("FEATURE_BEAST")

                if is_megabeast then
                    table.insert(megabeasts, build(hf, kill_count))
                end
                if is_semi then
                    table.insert(semimegabeasts, build(hf, kill_count))
                end
                if is_fb then
                    table.insert(forgotten_beasts, build(hf, kill_count))
                end
                if rf("NIGHT_CREATURE_HUNTER") or rf("NIGHT_CREATURE_NIGHTMARE")
                    or rf("NIGHT_CREATURE_BOGEYMAN") or rf("NIGHT_CREATURE_EXPERIMENT")
                    or rf("NIGHT_CREATURE_ANY") then
                    table.insert(night_creatures, build(hf, kill_count))
                end
                if rf("UNIQUE_DEMON") then
                    table.insert(demons, build(hf, kill_count))
                end
                if rf("TITAN") then
                    table.insert(titans, build(hf, kill_count))
                end

                local has_secret = try(function()
                    return hf.info and hf.info.secret ~= nil
                end)
                if has_secret then
                    table.insert(necromancers, build(hf, kill_count))
                end

                local curse_year = try(function() return hf.curse_year end)
                if curse_year and curse_year ~= -1 then
                    table.insert(cursed, build(hf, kill_count, { curseYear = curse_year }))
                end

                -- Heroes: high kill count, alive, not classified as a beast.
                if alive and kill_count >= HERO_THRESHOLD
                    and not is_megabeast and not is_semi and not is_fb then
                    table.insert(heroes, build(hf, kill_count))
                end
            end
        end
    end)

    -- Sort + cap heroes by kill count.
    table.sort(heroes, function(a, b)
        return (a.killCount or 0) > (b.killCount or 0)
    end)
    local heroes_total = #heroes
    if #heroes > HERO_CAP then
        local trimmed = {}
        for i = 1, HERO_CAP do trimmed[i] = heroes[i] end
        heroes = trimmed
    end

    -- Sort + cap necromancers (by alive first, then by kill count desc).
    table.sort(necromancers, function(a, b)
        if a.alive ~= b.alive then return a.alive end
        return (a.killCount or 0) > (b.killCount or 0)
    end)
    local necromancers_total = #necromancers
    if #necromancers > NECRO_CAP then
        local trimmed = {}
        for i = 1, NECRO_CAP do trimmed[i] = necromancers[i] end
        necromancers = trimmed
    end

    -- Top-N artifact creators.
    local creators_list = {}
    for hfid, count in pairs(artifact_counts) do
        table.insert(creators_list, { hfid = hfid, count = count })
    end
    table.sort(creators_list, function(a, b) return a.count > b.count end)
    local artifact_creators = {}
    for i = 1, math.min(CREATOR_CAP, #creators_list) do
        local item = creators_list[i]
        local hf = df.historical_figure.find(item.hfid)
        if hf then
            local e = build(hf, nil, {
                artifactCount = item.count,
                artifactSamples = artifact_samples[item.hfid],
            })
            table.insert(artifact_creators, e)
        end
    end

    return ok({
        asOfYear = current_year,
        includeDead = include_dead,
        civLeaders = civ_leaders,
        artifactCreators = artifact_creators,
        megabeasts = megabeasts,
        semimegabeasts = semimegabeasts,
        forgottenBeasts = forgotten_beasts,
        nightCreatures = night_creatures,
        demons = demons,
        titans = titans,
        necromancers = necromancers,
        cursedFigures = cursed,
        heroes = heroes,
        totals = {
            civLeaders = #civ_leaders,
            artifactCreatorsUnique = #creators_list,
            megabeasts = #megabeasts,
            semimegabeasts = #semimegabeasts,
            forgottenBeasts = #forgotten_beasts,
            nightCreatures = #night_creatures,
            demons = #demons,
            titans = #titans,
            necromancers = necromancers_total,
            cursedFigures = #cursed,
            heroes = heroes_total,
        },
    })
end

return _ENV
