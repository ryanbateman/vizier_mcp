# Vizier MCP

Vizier is an MCP server/AI integration for Dwarf fortress that allows you to query the state of your ongoing game. It allows your LLM agent to act like a vizier - giving you a helpful assistant to ask about your dwarfs and their world - whether your legendary weaponsmith is accidentally assigned to hauling stone, what your world looks like, what your expedition leader is skilled in, and more. Similar to Dwarf Therapist, its intended as a read-only interface to help understand your world. And when it comes to terrible, potentially incorrect, treacherous advice that may come at a world-ending price, what better source than ~~AI~~ your trusted Vizier? Ahaha. Ha. Ha.

## What You Can Do

When running your LLM Agent (and the Vizier MCP server) on the same machine as DF (the typical setup), Vizier has mixed read access to your game. Here are real examples of what you can ask:

### Workforce

| Question | Tool | What You See |
|----------|------|-------------|
| "What's my population?" | `list_units` | Every dwarf, their profession, where they are, and who they belong to |
| "Tell me about my expedition leader?" | `get_unit` by name | Who they are, their noble position, what they're wearing, and what they're skilled at — noble positions come from the RFR unit data, not `list_units` |
| "What're most of my population's professions?" | `list_units` with `mask.profession` | Profession distribution across your fortress. Identify your Bard epidemic early. |
| "Who's my best miner?" | `list_units` with `mask.skills` | Skill levels for every dwarf — find your specialists and hidden talent |
| "Find a specific dwarf" | `list_units` with `name` | Locate any dwarf by first name, last name, English name, or nickname |
| "Show every labor/skill mismatch" | Compare skills to enabled labors | Spot dwarves assigned to jobs they can't do, or locked out of jobs they're legendary at |
| "What is this dwarf wearing?" | `get_unit` by name/id, or `list_units` with `include_inventory` | One call returns the unit's clothing and armor with material and item names already resolved |
| "List my military squads" | `list_squads` | Squad rosters, leaders, and weapon assignments |
| "What labors do dwarves have?" | `list_enums`, `list_job_skills` | Every labor, skill, and profession in the game with their attributes. Spot what you're missing. |

### World & Materials

| Question | Tool | What You See |
|----------|------|-------------|
| "What world is this?" | `get_world_info` | Your world's name, game mode, civilization, and site identity |
| "What materials are here?" | `list_materials` | Every stone, metal, gem, and crafted material available on your map |
| "Show me a creature's raw stats" | `get_reference_data kind=creature_raws` | Every creature type — body parts, attacks, materials — know what you're fighting |
| "What plants grow here?" | `get_reference_data kind=plant_raws` | Every plant with its growths, products, and harvest seasons |
| "List all building types" | `get_reference_data kind=building_defs` | All workshops, furnaces, and traps you can construct |
| "What musical instruments exist?" | `get_reference_data kind=item_types` | Understand the musical instruments of your world — what they're made of, how they're played, and their sound descriptions |

### Map & Meta

| Question | Tool | What You See |
|----------|------|-------------|
| "What does the map look like?" | `get_block_list` (RFR) | Tile types, terrain, and materials for any region of the map |
| "Where's my camera?" | `get_view_info` (RFR) | What the player is currently looking at and how large the viewport is |
| "Is the game paused?" | `get_pause_state` (RFR) | Whether the game is currently paused or running |
| "What are the map dimensions?" | `get_map_info` (RFR) | Block count, embark position, and z-level depth |

### Data Detail: Core vs RFR

Two APIs serve unit data. The Core API provides a workforce overview; the RFR API adds rich per-unit detail:

| Data | Core `list_units` | RFR `get_unit_list` |
|------|:---:|:---:|
| Name, race, gender, civ | ✓ | ✓ |
| Grid-level position | ✓ | ✓ |
| Sub-tile position (fractional) | ✗ | ✓ |
| Facing direction | ✗ | ✓ |
| Profession (with name resolution) | ✓ | ✓ |
| Profession display color | ✗ | ✓ |
| Skills (level, experience) | mask | ✓ |
| Enabled labors | mask | ✗ |
| Personality traits | mask | ✗ |
| Age in years | ✗ | ✓ |
| Physical appearance (hair, beard, colors) | ✗ | ✓ |
| Body size | ✗ | ✓ |
| Full inventory (every item, material, slot) | ✗ | ✓ |
| Mounted/riding status | ✗ | ✓ |
| Noble titles (Expedition Leader, Baron, Count, etc.) | ✗ | ✓ |

## If You're Connecting Remotely

When DF runs on a different machine to the agent and Vizier MCP server, access to some methods is restricted. This is a restriction of DFHack. DFHack's remote server applies a per-method `SF_ALLOW_REMOTE` permission flag. The table below shows exactly what works where.

> **Important:** Remote connections require `"allow_remote": true` in DFHack's `dfhack-config/remote-server.json`. Without it, the server only binds to 127.0.0.1. If you do want to connect your Vizier MCP server to a remote DFHack instance, you will need to set the flag in the DFHack config (see below).

| Data | Local | Remote |
|------|:-----:|:------:|
| Core tools (units, materials, squads, etc.) | ✓ | ✓ |
| RFR tools (map info, pause state, creature/plant raws, etc.) | ✓ | ✓ |
| Unit inventory, appearance, age (RFR) | ✓ | ✓ |
| Map tiles and terrain (RFR) | ✓ | ✓ |
| RunCommand (DFHack console commands) | ✓ | ✗ |
| RunLua (arbitrary Lua queries) | ✗* | ✗* |

\**RunLua has an additional module name restriction even locally. See [Why RunLua Is Blocked](#why-runlua-is-blocked).*

The only methods blocked for remote access are **RunLua** and **RunCommand** — these are intentionally local-only for security. All RemoteFortressReader methods are registered with `SF_ALLOW_REMOTE` and are accessible remotely when `allow_remote` is enabled.

## Architecture

```mermaid
flowchart LR
    A[MCP Host<br/>any LLM client] <-->|stdio<br/>JSON-RPC| B[@ryanbateman/vizier-mcp<br/>MCP Server<br/>Node.js]
    B <-->|TCP<br/>protobuf| C[DFHack<br/>Remote Server<br/>port 5000]
    C --> D[Dwarf Fortress<br/>game engine]

    subgraph DFHack Remote Server
        E[Core Methods<br/>always available]
        F[RFR Methods<br/>remote-accessible]
    end

    C --- E
    C --- F
```

## Prerequisites

Vizier requires a running Dwarf Fortress instance with DFHack's remote server enabled. In `dfhack-config/remote-server.json`:

```json
{ "allow_remote": false, "port": 5000 }
```

Set `"allow_remote": true` only if connecting from another machine (see [Remote Access](#if-youre-connecting-remotely)).

## Installation

**Published package (recommended):**

```bash
npx @ryanbateman/vizier-mcp
```

**From source:**

```bash
git clone https://github.com/ryanbateman/vizier_mcp.git
cd vizier_mcp
npm install && npm run build
node build/index.js
```

## MCP Configuration

Vizier reads `DFHACK_HOST` (default `127.0.0.1`) and `DFHACK_PORT` (default `5000`) from environment variables.

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vizier": {
      "command": "npx",
      "args": ["@ryanbateman/vizier-mcp"],
      "env": {
        "DFHACK_HOST": "127.0.0.1",
        "DFHACK_PORT": "5000"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "vizier": {
      "command": "npx",
      "args": ["@ryanbateman/vizier-mcp"],
      "env": {
        "DFHACK_HOST": "127.0.0.1",
        "DFHACK_PORT": "5000"
      }
    }
  }
}
```

**OpenCode** (`.opencode/opencode.json`):

```jsonc
{
  "mcp": {
    "vizier": {
      "type": "local",
      "command": ["npx", "@ryanbateman/vizier-mcp"],
      "enabled": true,
      "environment": {
        "DFHACK_HOST": "127.0.0.1",
        "DFHACK_PORT": "5000"
      }
    }
  }
}
```

> **From source:** Replace the `npx` command with `["node", "/path/to/vizier_mcp/build/index.js"]`.

> **Remote connections:** DFHack only accepts localhost by default. To connect from another machine, set `"allow_remote": true` in `dfhack-config/remote-server.json`. `RunLua` and `RunCommand` remain blocked for non-localhost clients regardless of this setting.

## All MCP Tools

### Always Available (Core API)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `get_version` | DFHack version | — |
| `get_df_version` | Dwarf Fortress version | — |
| `get_world_info` | Save dir, game mode, civ/site IDs (no numeric world id) | — |
| `get_reference_data` | **All static reference data**, cached per save (materials, item types, enums, job skills, creature/plant raws, building defs, tiletypes, language) | `kind`, `type`, `offset`, `limit` |
| `list_enums` | Alias for `get_reference_data kind=enums` | — |
| `list_job_skills` | Alias for `get_reference_data kind=job_skills` | `type`, `offset`, `limit` |
| `list_materials` | Live *filtered* material query (not the static dump) | `inorganic`, `builtin`, `creatures`, `plants`, `offset`, `limit` |
| `list_units` | Units with filters and data mask | `scan_all`, `race`, `civ_id`, `name`, `mask`, `include_inventory`, `offset`, `limit` |
| `list_squads` | Military squads and members | — |
| `set_unit_labors` | Enable/disable labors per unit | `changes[]` |

### RemoteFortressReader (RFR) API

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `get_unit` | A single fully-enriched unit by `id` or `name`, incl. inventory and noble positions (backed by RFR `GetUnitList`) | `id`, `name` |
| `get_unit_list` | Full unit data with inventory and appearance | — |
| `get_unit_list_inside` | Units within a region | `minX`, `minY`, `minZ`, `maxX`, `maxY`, `maxZ` |
| `get_block_list` | Map tile and terrain data | `minX`, `minY`, `minZ`, `maxX`, `maxY`, `maxZ` |
| `get_map_info` | Map dimensions and embark position | — |
| `get_view_info` | Current viewport position and size | — |
| `get_pause_state` | Whether the game is paused | — |

Creature raws, plant raws, building defs, item types, tiletypes, language and the full material dump are served by **`get_reference_data`** (cached per save) and as **MCP resources** — see below.

### Reference Data: tool + resources

Static game reference data is cached per save and exposed two ways so the model rarely needs a repeat call:

- **Tool:** `get_reference_data({ kind, type?, offset?, limit? })` where `kind` is one of `materials`, `item_types`, `enums`, `job_skills`, `creature_raws`, `plant_raws`, `building_defs`, `tiletypes`, `language`.
- **Resources:** each dataset is also an MCP resource (`vizier://reference/materials`, `vizier://reference/job-skills`, …) that capable clients read once and cache.

Unit and item tool responses (`get_unit`, `list_units`, `get_unit_list`, …) already have profession, skill, labor, flag, race, material and item **names resolved server-side**, so you usually do not need a reference call just to decode IDs. The cache hits DFHack at most once per save (revalidated at most once per 60s and dropped on reconnect).

### `list_units` Detail Options

Adding `mask` returns richer data with human-readable names resolved from DFHack's own enums at runtime:

```json
{
  "profession": 114,
  "professionName": "Bard",
  "skills": [{ "id": 117, "level": 8, "name": "Music", "nameNoun": "Musician" }],
  "labors": [{ "id": 11, "name": "Carpentry" }]
}
```

| Mask Field | Returns | Extra Fields |
|-----------|---------|-------------|
| `profession` | Profession ID, squad assignment | `professionName` |
| `skills` | All skill levels and experience | `name`, `nameNoun` per skill |
| `labors` | Enabled labors | `name` per labor |
| `miscTraits` | Personality traits | — |

All name lookups are fetched dynamically from the connected DFHack instance — no hardcoded mappings.

### Name Search

Filter units by substring match across first name, last name, English name, and nickname:

```
list_units({ scan_all: true, name: "besmar", mask: { profession: true } })
```

### Pagination

Large responses from `list_units`, `list_materials`, `list_job_skills`, and `get_reference_data` use `offset`/`limit`:

```json
{ "total": 174, "offset": 0, "limit": 20, "items": [...] }
```

## Why RunLua Is Blocked

`RunLua` — the most powerful tool, giving arbitrary Lua access to the entire game state — is blocked by two independent restrictions in the DFHack source. Neither is fixable from the Vizier side. The restrictions make sense - arbitrarily accessing Lua Runtimes is something only the most foolish of Viziers would allow - but it somewhat restricts what this MCP server is capable of. 

### 1. The `SF_ALLOW_REMOTE` permission flag

Every method registered with the remote server carries a set of flags (`SF_ALLOW_REMOTE = 4` in the `ServerFunctionFlags` enum). Methods without `SF_ALLOW_REMOTE` are rejected for non-localhost clients. The check lives in [`RemoteServer.cpp`](https://github.com/DFHack/dfhack/blob/e53187c8b975f71c5c356d9a587563009684bc89/library/RemoteServer.cpp#L264-L267):

```cpp
if (((fn->flags & SF_ALLOW_REMOTE) != SF_ALLOW_REMOTE) &&
    strcmp(socket->GetClientAddr(), "127.0.0.1") != 0)
{
    stream.printerr("In call to {}: forbidden host: {}\n", fn->name, socket->GetClientAddr());
```

`RunLua` is registered without this flag in [`RemoteTools.cpp`](https://github.com/DFHack/dfhack/blob/e53187c8b975f71c5c356d9a587563009684bc89/library/RemoteTools.cpp#L554):

```cpp
addFunction("RunLua", &CoreService::RunLua);  // no SF_ALLOW_REMOTE
```

Compare to a working method on the line above: `addFunction("GetWorldInfo", GetWorldInfo, SF_ALLOW_REMOTE);`.

### 2. The module name gate

Even on localhost, `RunLua` requires the module name to match a whitelist pattern. The gate is in [`RemoteTools.cpp`](https://github.com/DFHack/dfhack/blob/e53187c8b975f71c5c356d9a587563009684bc89/library/RemoteTools.cpp#L636-L651):

```cpp
if (!valid) {
    args.rv = CR_WRONG_USAGE;
    out.printerr("Only modules named rpc.* or *.rpc or *-rpc may be called.\n");
    return 0;
}
```

Only module *names* matching `rpc.*`, `*.rpc`, or `*-rpc` are accepted. Calling `dfhack.internal.getVersion` or any other built-in function is rejected because its name fails this pattern — so RunLua only works against a purpose-written module whose name matches (conventionally a script under `hack/scripts/rpc/`, called as `module: "rpc.mymodule"`).

### What RunLua (or a clean API) Could Unlock

| Currently Impossible | RunLua Would Enable |
|---------------------|---------------------|
| Current jobs (idle, mining, hauling) | `df.global.world.jobs.list` |
| Mood, stress, personality traits | `unit.status.misc_traits`, `unit.status.current_soul.personality` |
| Legends and history | `dfhack.legends` module |
| Burrow assignments | `unit.burrows` |
| Relationships | `unit.relationships` |

Noble titles and inventory are available via the RFR `get_unit` / `get_unit_list` tools. Wounds and blood level (`UnitDefinition.wounds`, `blood_count`/`blood_max`) are also already exposed there — only mood, stress and personality require RunLua.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DFHACK_HOST` | `127.0.0.1` | DFHack remote server host |
| `DFHACK_PORT` | `5000` | DFHack remote server port |

## Development

```bash
git clone https://github.com/ryanbateman/vizier_mcp.git
cd vizier_mcp
npm install
npm run proto          # regenerate proto JSON from .proto files
npm run build          # full build (proto + tsc)
npm run inspector      # run MCP inspector for debugging
npm test               # run unit tests
```

## License

MIT
