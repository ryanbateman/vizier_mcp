-- rpc/jobs.lua — Vizier MCP companion module (rpc.jobs)
--
-- Exposes the fortress JOB QUEUE over DFHack's RunLua RPC, plus two
-- reversible, opt-in write actions (prioritise / suspend a job). The job
-- queue lives in df.global.world.jobs.* and is NOT reachable over the typed
-- RemoteFortressReader socket, so — like rpc.legends — this Lua companion is
-- the practical unlock. The model is the same one DFHack's own `do-job-now`
-- and `prioritize` tools use: the whole job-management surface is two boolean
-- flags, `job.flags.do_now` and `job.flags.suspend`.
--
-- INSTALL
-- -------
-- Copy this file to your DFHack Lua module tree at:
--
--     <DF install>/hack/lua/rpc/jobs.lua
--
-- (`hack/lua/`, NOT `hack/scripts/` — RunLua require()s against package.path,
-- which searches hack/lua/.) Then set VIZIER_ENABLE_RUN_LUA=1, and for the
-- write tools additionally set VIZIER_ENABLE_ACTIONS=1. `npx vizier-mcp
-- install-companion` copies this alongside legends.lua automatically. Call
-- jobs_setup_check from your MCP client to confirm.
--
-- SAFETY
-- ------
-- Every mutation runs inside dfhack.with_suspend (DFHack: "Suspending is
-- necessary for accessing a consistent state of DF memory") so a write from
-- the RPC thread can't race the game's main loop. Both writes are fully
-- reversible — flip the flag back to undo.
--
-- MODULE SHAPE / SCHEMA: identical to rpc.legends — mkmodule env, every
-- function returns a single JSON string `{ ok = boolean, data | error }`,
-- arguments arrive as individual varargs. See lua/rpc/legends.lua for the
-- detailed rationale.

local _ENV = mkmodule('rpc.jobs')

local json = require('json')

-- Convert DFHack userdata leaves to JSON-safe values (see legends.lua).
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

-- Transcode a raw DF (CP437) string to UTF-8 so accented names survive the
-- json.encode + JS UTF-8 decode round trip. Returns nil for empty input.
local function df_string(s)
    if s == nil or s == "" then return nil end
    if dfhack.df2utf then
        local ok_, utf = pcall(dfhack.df2utf, s)
        if ok_ and utf then return utf end
    end
    return s
end

-- Render a unit's name the way the DF UI shows it (native dwarvish surname),
-- mirroring the convention used across Vizier's other tools.
local function unit_name(unit)
    if not unit then return nil end
    local fn = dfhack.translation and dfhack.translation.translateName
    if not fn then return df_string(unit.name and unit.name.first_name) end
    local ok_, s = pcall(fn, unit.name, false)
    if ok_ and s and s ~= "" then return df_string(s) end
    return df_string(unit.name and unit.name.first_name)
end

local function enum_name(enum, code)
    if enum == nil or code == nil then return nil end
    local ok_, name = pcall(function() return enum[code] end)
    if ok_ and type(name) == "string" then return name end
    return tostring(code)
end

local function type_name(t)
    if t == nil then return nil end
    local s = tostring(t)
    return s:match("<type: (.+)>") or s
end

local function try(fn)
    local okv, val = pcall(fn)
    if okv then return val end
    return nil
end

-- Parse a vararg string into a boolean. RunLua hands every argument across as
-- a string, so "1"/"true"/"yes"/"on" → true and "0"/"false"/"no"/"off" →
-- false; anything else falls back to `default`.
local function parse_bool(v, default)
    if v == nil then return default end
    v = string.lower(tostring(v))
    if v == "1" or v == "true" or v == "yes" or v == "on" then return true end
    if v == "0" or v == "false" or v == "no" or v == "off" then return false end
    return default
end

-- Walk the fortress job linked list (df.global.world.jobs.list). The head
-- link carries no item; every subsequent link's `.item` is a df.job. cb may
-- return true to stop early.
local function for_each_job(cb)
    local link = df.global.world.jobs.list.next
    while link do
        local job = link.item
        if job then
            if cb(job) then return end
        end
        link = link.next
    end
end

local function find_job(id)
    local found = nil
    for_each_job(function(job)
        if job.id == id then found = job; return true end
        return false
    end)
    return found
end

-- Build the per-job summary record surfaced by list_jobs. Every field probe
-- is pcall-wrapped so a shape mismatch on one job drops that field, not the
-- whole call.
local function job_summary(job)
    local worker = try(function()
        local u = dfhack.job.getWorker(job)
        if not u then return nil end
        return { unitId = u.id, name = unit_name(u) }
    end)
    local building = try(function()
        local b = dfhack.job.getHolder(job)
        if not b then return nil end
        return { id = b.id, type = type_name(b._type) }
    end)
    return {
        id = try(function() return job.id end),
        type = try(function() return enum_name(df.job_type, job.job_type) end),
        typeCode = try(function() return job.job_type end),
        name = try(function() return dfhack.job.getName(job) end),
        pos = try(function()
            return { x = job.pos.x, y = job.pos.y, z = job.pos.z }
        end),
        worker = worker,
        building = building,
        doNow = try(function() return job.flags.do_now end),
        suspended = try(function() return job.flags.suspend end),
    }
end

-- ping: probe whether the module is installed and callable. Returns the
-- schema version so the client can detect mismatches.
function ping(...)
    return ok({ schema = 2, dfhack = dfhack.getDFHackVersion() })
end

-- list_jobs: enumerate the fortress job queue. Skips df-internal special
-- jobs (job.flags.special) by default — pass "all" as the first arg to
-- include them. Read-only.
function list_jobs(...)
    local include_special = (select(1, ...) == "all")
    local jobs = {}
    local total = 0
    for_each_job(function(job)
        local special = try(function() return job.flags.special end)
        if include_special or not special then
            total = total + 1
            table.insert(jobs, job_summary(job))
        end
        return false
    end)
    return ok({ jobs = jobs, total = total })
end

-- set_job_priority: set/clear job.flags.do_now (the "do this now" boost that
-- do-job-now / prioritize use). Args: { jobId, on? } where on defaults to
-- true. Reversible. Wrapped in with_suspend for a consistent memory state.
function set_job_priority(...)
    local id = tonumber((select(1, ...)))
    if not id then return err("missing job id (first arg)") end
    local on = parse_bool(select(2, ...), true)
    local job = find_job(id)
    if not job then return err("job not found: " .. tostring(id)) end

    local applied
    local okm, e = pcall(function()
        dfhack.with_suspend(function() job.flags.do_now = on end)
        applied = job.flags.do_now
    end)
    if not okm then return err("failed to set priority: " .. tostring(e)) end
    return ok({ jobId = id, doNow = applied })
end

-- set_job_suspended: set/clear job.flags.suspend. A suspended job is left in
-- the queue but not worked until resumed. Args: { jobId, on? } where on
-- defaults to true. Reversible. Wrapped in with_suspend.
function set_job_suspended(...)
    local id = tonumber((select(1, ...)))
    if not id then return err("missing job id (first arg)") end
    local on = parse_bool(select(2, ...), true)
    local job = find_job(id)
    if not job then return err("job not found: " .. tostring(id)) end

    local applied
    local okm, e = pcall(function()
        dfhack.with_suspend(function() job.flags.suspend = on end)
        applied = job.flags.suspend
    end)
    if not okm then return err("failed to set suspend: " .. tostring(e)) end
    return ok({ jobId = id, suspended = applied })
end

-- remove_job: cancel a job and remove it from the queue (dfhack.job.removeJob).
-- Args: { jobId }. NOT reversible — the job is gone (DF may re-post a recurring
-- workshop/labor job on its own). Wrapped in with_suspend.
function remove_job(...)
    local id = tonumber((select(1, ...)))
    if not id then return err("missing job id (first arg)") end
    local job = find_job(id)
    if not job then return err("job not found: " .. tostring(id)) end

    local removed
    local okm, e = pcall(function()
        dfhack.with_suspend(function() removed = dfhack.job.removeJob(job) end)
    end)
    if not okm then return err("failed to remove job: " .. tostring(e)) end
    return ok({ jobId = id, removed = removed and true or false })
end

-- list_manager_orders: read the work-order queue (df.global.world.manager_orders.all)
-- — the standing "make N of X" production orders the manager hands out as jobs.
-- Read-only. Each field probe is pcall-wrapped against DF-version shape drift.
function list_manager_orders(...)
    local out = {}
    local orders = try(function() return df.global.world.manager_orders.all end) or {}
    for _, o in ipairs(orders) do
        table.insert(out, {
            id = try(function() return o.id end),
            jobType = try(function() return enum_name(df.job_type, o.job_type) end),
            jobTypeCode = try(function() return o.job_type end),
            amountTotal = try(function() return o.amount_total end),
            amountLeft = try(function() return o.amount_left end),
            frequency = try(function()
                local enum = df.manager_order.T_frequency
                return enum and enum_name(enum, o.frequency) or tostring(o.frequency)
            end),
        })
    end
    return ok({ orders = out, total = #out })
end

return _ENV
