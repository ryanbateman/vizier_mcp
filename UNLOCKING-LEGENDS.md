# Could the Vizier read the legends?

A note on the data Vizier *cannot* currently see — the historical figures, the
events of the world, the artifacts your dwarves have made, the books they have
written — and what it would take to lift the curtain.

This is not a roadmap. It's an explanation of what's possible, written so the
maintainer and the curious reader can decide whether it's worth doing.

## Why the curtain is there at all

Dwarf Fortress keeps a vast historical record in memory: every named figure,
every battle, every artifact's origin, every site on the map, every written
work. DFHack reads all of this in-process — Legends mode is essentially a UI
over the same structures. The Vizier connects to DFHack over its remote API,
and the remote API exposes only a small slice of what DFHack can see: units,
items, materials, blocks, world bounds. The rest is gated.

There are two gates, both documented in the [README appendix on
RunLua](README.md#appendix-why-runlua-is-blocked):

1. **`SF_ALLOW_REMOTE`** — every RPC method advertises whether it's safe to
   call from outside the game's machine. Methods without the flag are
   rejected for non-localhost clients in `library/RemoteServer.cpp`.
2. **The `RunLua` module-name whitelist** — even on localhost, the generic
   `RunLua` escape hatch only invokes modules named `rpc.*`, `*.rpc`, or
   `*-rpc`. You cannot just call `dfhack.legends.get_event_string` from
   afar; the gate in `library/RemoteTools.cpp` will refuse it.

Together they form a sensible defence: outside callers can't run arbitrary
Lua, and the targeted RPC methods that *are* exposed have each been audited
and tagged. The cost is that the legends surface — read-only by nature,
data your dwarves are arguably *proud* of — is unreachable.

## What's actually behind the wall

The relevant DF structures live under `df::global::world->history` and
adjacent globals. The interesting collections, more or less:

- `history.figures` — every historical figure DF has ever generated for this
  world, plus the ones your fort has created. Their birth/death, race, deeds,
  relationships, entity affiliations.
- `history.events` — the event log. Battles, peace treaties, births,
  marriages, artifact creations, the founding of sites. Each event already
  has a renderable string courtesy of `dfhack.legends.get_event_string`.
- `world_data->sites` — every site in the world, including yours, with
  coordinates, type (fortress, hamlet, dark tower, ruin), the civ that
  controls it, and who lives there.
- `artifacts.all` — the canonical record of every artifact, who made it,
  when, where it is now.
- `written_contents.all` — books, scrolls, poetic forms, the lot, with
  author and subject.
- `entities.all` — civilisations, religious sects, mercenary companies,
  bands of outlaws. The groups your fort belongs to and dances around.

None of this is secret. It's all in the game and all in DFHack's reach.
It's just not on the remote socket.

## Two ways to lift the curtain

### Route A — A small Lua companion, no fork

The `RunLua` module-name gate accepts any module named `rpc-legends`,
`legends.rpc`, or `rpc.legends`. A modestly sized Lua script dropped into
`hack/scripts/` of an *unmodified* DFHack — call it `rpc-legends.lua` —
can expose whatever it likes from `dfhack.legends` and the
`df.global.world.history.*` tables, returning serialisable Lua tables.
The Vizier would then call `RunLua(module="rpc.legends", function="…")`
and decode the result.

This works **today**, on a stock DFHack, with no source changes. It works
only for localhost callers — the `SF_ALLOW_REMOTE` check on `RunLua`
still blocks remote sessions — but for the common case (Vizier and DFHack
on the same machine) that's not a real limitation.

**What it costs**: every Vizier user has to install the companion script,
or Vizier has to ship it and document the placement. Each RPC has to
serialise through Lua tables back to protobuf-on-the-wire, which is
fine for the scale of data involved but adds a marshalling hop. And the
trust boundary is awkward — the script *is* arbitrary Lua, even if it's
ours.

**Why you'd choose it**: it's the fastest possible "yes, this works"
demonstrator. You can prove the narrative shape — what the LLM actually
wants in `describe_historical_figure` — without compiling anything.

### Route B — A small DFHack source fork

The cleaner unlock. Read-only RPC methods, each declaring
`SF_ALLOW_REMOTE`, each returning a properly typed protobuf message.
The fork's footprint, roughly:

- One new proto file (or an extension of the existing
  `RemoteFortressReader.proto`) defining six message families: historical
  figures, events, sites, artifacts, written contents, entities. Each
  with a paginated request and a list response.
- One new C++ plugin (or a block in `library/RemoteTools.cpp`) registering
  the methods via `addFunction(..., SF_ALLOW_REMOTE)` and walking the
  in-process structures to fill the response messages.
- Optional: pre-rendered narrative strings on event/artifact messages,
  populated by calling `dfhack.legends.get_event_string` from C++ via
  the existing `Lua::SafeCall` machinery. Keeps Vizier free of duplicate
  rendering logic.

The messages are small and orthogonal — a flavour of the shape:

```proto
message HistoricalFigure {
  required int32 id = 1;
  optional NameInfo name = 2;
  optional int32 race = 3;
  optional int32 birth_year = 4;
  optional int32 death_year = 5;
  optional int32 cause_of_death = 6;
  repeated HFEntityLink entity_links = 7;
  repeated HFRelationship relationships = 8;
  optional int32 current_site_id = 9;
  optional bool deity = 10;
}
```

The five siblings (`HistoryEvent`, `WorldSite`, `Artifact`,
`WrittenContent`, `HistoricalEntity`) follow the same pattern: an id, a
name, a few typed fields that mirror what you'd find in Legends mode,
and ids that cross-reference into the other lists.

**What it costs**: maintaining a DFHack fork against upstream changes —
ongoing, not crushing, especially if the change is small and
well-bounded. Users either build DFHack themselves or you publish a
binary. Until/unless the PR lands upstream.

**Why you'd choose it**: because it's the right shape. The data is
read-only, the messages are small, the security argument that justifies
`RunLua`'s restrictions doesn't apply — you're adding *narrow*
allow-listed endpoints, not opening a door. It's plausibly upstreamable.
And it works remotely, for the day someone wants to run Vizier on a
different box from the game.

## What the Vizier would do with it

Either route opens the same composite-tool surface on the Vizier side.
Following the project's convention of one tool per README narrative
example, candidates include:

- **`get_legends_overview`** — year range, counts of figures / events /
  sites / artifacts, the most-storied figures. The legends counterpart of
  `get_fortress_overview`.
- **`describe_historical_figure`** — by id or name, with relationships
  and event participation cross-referenced.
- **`list_recent_events`** — paginated by year range; narrative summaries
  ready for the LLM to dramatise.
- **`describe_artifact`** — creator, year, current site, item details.
- **`list_world_sites`** — what sits where on the map.
- **`describe_book`** / **`list_entities`** — the rest of the surface,
  for completeness.

Each would ship its own narrative example in the README ("Tell me the
legend of…", "What artifacts have my people made?", "Speak of the great
civilisations of this world…").

## An honest verdict

Yes, it's possible — both routes are real engineering, neither
hypothetical. The pragmatic middle is to prototype on Route A (a Lua
companion shows immediately what the narrative tools should look like),
then port the proven surface to Route B for the cleaner, remoteable,
upstream-friendly version. Vizier MCP's composite-tool layer is
identical in either case; only the wire format and where the data is
fetched from changes.

## Status: Route A prototype shipped

The companion script lives at `lua/rpc-legends.lua` in this repo. It
currently exposes:

- `ping` — schema probe; used by `legends_setup_check`.
- `get_overview` — counts + year range across the six legends collections.
- `describe_historical_figure` — by id; identity, race, dates, entity
  links, relationships, current site.

Vizier MCP registers three matching tools — `legends_setup_check`,
`get_legends_overview`, `describe_historical_figure` — and they
self-diagnose: if the script isn't installed, each returns a
structured `status: "missing"` payload pointing at
`legends_setup_check`, which carries full install instructions.

### Install

1. Copy `lua/rpc-legends.lua` to `<DF install>/hack/scripts/rpc/legends.lua`.
2. Set `VIZIER_ENABLE_RUN_LUA=1` in the environment running `vizier-mcp`.
3. Restart `vizier-mcp` and call `legends_setup_check` to confirm.

### Extending

The script is intentionally minimal. To add a function:

1. Add a global function in `lua/rpc-legends.lua` returning
   `{ json.encode({ ok = true, data = ... }) }` (or `{ ok = false, error = "…" }`).
2. Add a tool in `src/tools/legends.ts` using `callLegends<T>("yourFn", args)`.
3. Bump `LEGENDS_SCHEMA` if you make breaking changes to existing
   payload shapes (the schema is reported by `ping` and surfaced by
   `legends_setup_check`).

Once the surface stabilises and is genuinely useful, Route B (typed
proto methods in a DFHack fork) becomes the right port — same tools,
cleaner wire format, works remotely.

## Next batch: narrative artifact tools

Once the Route A wire path is live-validated, the natural next layer is
two composite tools that compose legends data with the existing item /
unit surface. Both are read-only and assistive — they help the player
*find and understand* what they already have, not act on their behalf.

### `find_family_artifacts(unit, depth=2)`

User-facing question: *"Show me artifacts tied to my expedition
leader's family."* The composite tool resolves the unit to a histfigId,
walks the histfig_links graph to `depth` generations, and pulls
artifacts where any of those figures appears as owner, holder,
family-claimant, or maker. Returns each with its name, the relation
path that surfaced it ("forged by your leader's father"), current
location (in this fort with tile coords, at another site, or carried
by a known unit), and a key-events narrative built from
`world.history.events` filtered by `.artifact == id`.

Internal callflow per invocation:

1. `describe_unit(name|id)` — existing, gets histfigId.
2. `RunLua rpc.legends.trace_lineage [histfigId, depth]` — new.
3. `RunLua rpc.legends.list_artifacts_by_hfs [hfid_list]` — new.
4. `RunLua rpc.legends.describe_artifact [artifact_id]` × N — new.
5. Server-side rank + bundle.

### `find_notable_items(scope="fort", min_kills=0, include_artifacts=true)`

User-facing question: *"What powerful or legendary items do I have?"*
The composite tool surfaces three classes of "notable": artifacts in
the fort, weapons with non-trivial kill histories
(`item_actual.history_info.kills`), and masterworks tied to a
documented creation event (`item_crafted.quality + masterpiece_event`).
Each entry tagged with the reason it surfaced, current location, and
the same narrative-string treatment as above.

Internal callflow:

1. `RunLua rpc.legends.list_artifacts_summary [site_id]` — new.
2. `RunLua rpc.legends.list_kill_items [min_kills]` — new.
3. Merge + rank server-side.
4. `RunLua rpc.legends.describe_artifact [id]` or
   `describe_combat_item [id]` × N to enrich top entries.

### New Lua functions needed (rpc-legends extensions)

| Function | Args | Returns |
|---|---|---|
| `trace_lineage` | `[hfid, depth]` | flat list of related hfids with relation labels + path |
| `list_artifacts_by_hfs` | `[hfid_csv]` | artifact summaries where any hfid appears in owner / holder / family / maker |
| `list_artifacts_summary` | `[site_id?]` | compact artifact list, optionally site-filtered |
| `list_kill_items` | `[min_kills]` | non-artifact items with `history_info.kills` ≥ threshold |
| `describe_artifact` | `[artifact_id]` | name, item, creator, creation year, location, holder, key events |

Each function plus the existing three would bump `LEGENDS_SCHEMA` from
1 → 2 once added. Narrative event strings rendered Lua-side from
typed `history_event_*` records (no `dfhack.legends` helper exists —
verified during the audit).

### Caching strategy

Lua-side caching pays back compound queries. TS-side caching beyond
the existing `lookup-cache.ts` is unnecessary for this batch — the
composition is cheap; the RPC walks are where time is spent.

**Generation-tuple invalidation.** A single tuple gates the cache:

```
gen = (df.global.cur_year, #artifacts.all, #history.events)
```

Cur_year advances slowly. Artifact and event counts increment only on
discrete in-game events (rare in fortress mode). When `gen` differs
from the last build, prune. Worst-case staleness: until the next
history event. Owner reassignment fires a
`history_event_hf_does_interactionst` which bumps `#events` — so the
tuple correctly catches "artifact changed hands."

**Three canonical indexes** built once per generation:

- `artifact_by_hf` — maps hfid → artifact ids (any of owner / holder /
  family-claimant / maker). Speeds up `list_artifacts_by_hfs` from
  O(N×artifacts) per query down to O(1) lookup after one O(artifacts)
  build.
- `events_by_artifact` — maps artifact_id → list of event records.
  `describe_artifact` and key-event rendering become O(1).
- `events_by_histfig` — maps hfid → list of event records. Reusable
  for future narrative tools beyond artifacts.

Lua module surface stays small:

```lua
local cache = {}
local current_gen = nil

local function memo(key, builder)
  local g = generation()
  if g ~= current_gen then cache = {}; current_gen = g end
  if cache[key] == nil then cache[key] = builder() end
  return cache[key]
end
```

**What is NOT cached, ever:** anything position-derived
(`dfhack.items.getPosition`, "carried by" attributions, current job
state). These change every tick and freshness matters more than
speed.

**TS-side request-scoped dedup.** One narrow win — a `Map<id, Promise>`
that lives for the duration of a single composite-tool handler so
descendants that look up the same artifact share one RPC roundtrip.
No persistence, no invalidation problem.

**User escape hatch.** Both composite tools accept `refresh:true` to
force the Lua cache to rebuild before serving, for the rare case
where the user has just done something they suspect should change the
result and the generation tuple hasn't caught it yet.

### Open questions before building

- **Lineage depth default.** Depth 2 = parents, grandparents, siblings,
  spouse, children (~7-15 figures). Depth 3 adds great-grandparents,
  aunts, uncles, cousins (~30+). Artifact set grows fast. Default 2;
  cap at 4.
- **`relation` field rendering.** Lua returns the structured path
  (`["mother", "father"]`); TS composite tool turns it into prose
  ("your leader's mother's father, Onul"). Decide where the prose
  lives — leaning TS so the Lua side stays minimal data.
- **"Carried by" detection.** When `getPosition` returns nil but
  `artifact.site == fortress_site`, scan unit inventories to attribute
  the artifact to a carrier. Worth the extra walk for narrative
  payoff; cap the inventory scan to fortress citizens to bound cost.
- **`find_notable_items` ranking.** Combine kill count, artifact
  status, and quality into a single rank? Or three separate
  sub-lists? Single rank reads better narratively; sub-lists are
  easier to argue about. Lean single rank with the `reason` field
  carrying the discrimination.

### Ethos check

Both tools are observation only. Neither suggests an action ("you
should move the artifact to the noble's bedroom"). Neither modifies
state. They surface what exists for the player to act on themselves.
This is the [[read-only-assistive-ethos]] in practice — same lens
applies to every future legends-side composite tool.

## Not in scope here

The same architectural unlock — a small set of read-only, allow-listed
remote methods — would also reach the other items the README appendix
mentions: current jobs, mood and stress, burrow assignments,
relationships outside of legends. Those are different proto definitions
and different game structures, and worth their own note if and when the
legends work bears fruit.
