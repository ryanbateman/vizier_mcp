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

## Not in scope here

The same architectural unlock — a small set of read-only, allow-listed
remote methods — would also reach the other items the README appendix
mentions: current jobs, mood and stress, burrow assignments,
relationships outside of legends. Those are different proto definitions
and different game structures, and worth their own note if and when the
legends work bears fruit.
