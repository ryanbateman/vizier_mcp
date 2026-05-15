# Vizier MCP — DFHack MCP Server

## Overview

Vizier MCP is a Model Context Protocol (MCP) server that connects to a running Dwarf Fortress + DFHack instance over its TCP remote API and exposes game state queries as MCP tools. This enables LLMs to understand and reason about a Dwarf Fortress game in progress.

## Architecture

### Transport

- **MCP transport**: Stdio (standard for local MCP servers, launched by MCP hosts)
- **DFHack transport**: Raw TCP (DFHack's remote server, default port 5000)

### DFHack Protocol

DFHack exposes a custom binary protocol on top of Google Protobuf message serialization:

1. **Handshake**: Client sends `"DFHack?\n"` + int32 version `1`; server replies `"DFHack!\n"` + int32 version `1`
2. **Method binding**: All RPC methods are discovered at runtime via `BindMethod` (ID 0), which takes a method name, input protobuf type, output protobuf type, and optional plugin name
3. **Calling methods**: Send a header (int16 method_id + int16 padding + int32 size) followed by protobuf-encoded payload
4. **Responses**: Server sends 0+ `RPC_REPLY_TEXT` messages (int16 id=-3) followed by one `RPC_REPLY_RESULT` (id=-1) or `RPC_REPLY_FAIL` (id=-2)
5. **Quit**: Send header with id=-4 to disconnect

Max payload size: 64 MiB. All values little-endian.

## Project Structure

```
vizier_mcp/
├── src/
│   ├── index.ts              # MCP server entry point + tool registration
│   ├── dfhack/
│   │   ├── client.ts         # DFHack TCP client (connect, handshake, bind, call)
│   │   ├── codec.ts          # Binary protocol encode/decode
│   │   ├── methods.ts        # FUNC_DEFS, method binding, type lookup
│   │   └── index.ts          # Re-exports
│   ├── tools/
│   │   ├── core.ts           # Core method tools (ListEnums, ListUnits, ListMaterials, etc.)
│   │   ├── world.ts          # get_version, get_df_version, get_version_info, get_world_info, etc.
│   │   ├── units.ts          # get_unit_list, get_unit_list_inside (RFR)
│   │   ├── reference.ts      # get_material_list, get_item_list, etc. (RFR)
│   │   └── lua.ts            # run_lua (core, blocked by SF_ALLOW_REMOTE)
│   └── types.ts              # Shared TypeScript types
├── proto/                    # .proto files (from DFHack/RFR)
├── generated/                # Compiled proto JSON (protobufjs output)
├── scripts/                  # Proto generation script
├── package.json
├── tsconfig.json
├── PLAN.md
└── .gitignore
```

## MCP Tools

### Core Tools (working — have SF_ALLOW_REMOTE flag)

| Tool | Method | Input | Description | Status |
|------|--------|-------|-------------|--------|
| `get_version` | GetVersion | — | DFHack version string | ✓ |
| `get_df_version` | GetDFVersion | — | Dwarf Fortress version string | ✓ |
| `get_world_info` | GetWorldInfo | — | World name, game mode, world ID | ✓ |
| `list_enums` | ListEnums | — | All enum definitions (flags, labors, skills, professions) | ✓ |
| `list_job_skills` | ListJobSkills | `type`, `offset`, `limit` | Job skills, professions, labors with pagination | ✓ |
| `list_materials` | ListMaterials | `builtin`, `inorganic`, `creatures`, `plants`, `offset`, `limit` | Material definitions with filters and pagination | ✓ |
| `list_units` | ListUnits | `scan_all`, `race`, `civ_id`, `alive`, `dead`, `sane`, `mask`, `offset`, `limit` | Units with filters, profession/skills/labors mask, pagination | ✓ |
| `list_squads` | ListSquads | — | Military squads and members | ✓ |
| `set_unit_labors` | SetUnitLabors | `changes[]` | Enable/disable labors for units | untested |

### Core Methods (unavailable — missing SF_ALLOW_REMOTE)

| Method | Reason | Impact |
|--------|--------|--------|
| `RunLua` | No `SF_ALLOW_REMOTE` flag in DFHack source (`RemoteTools.cpp`) | Cannot query arbitrary game state via Lua |
| `RunCommand` | No `SF_ALLOW_REMOTE` flag | Cannot execute DFHack console commands remotely |

Both require a DFHack rebuild with `SF_ALLOW_REMOTE` added to the method registration, or a proxy/shim on the DF host.

### RFR Tools (unavailable — RemoteFortressReader methods lack SF_ALLOW_REMOTE)

| Tool | Method | Description | Status |
|------|--------|-------------|--------|
| `get_version_info` | GetVersionInfo | DF+DFHack version info | ✗ |
| `get_map_info` | GetMapInfo | Map dimensions and region info | ✗ |
| `get_view_info` | GetViewInfo | Viewport position and size | ✗ |
| `get_pause_state` | GetPauseState | Check if game is paused | ✗ |
| `get_unit_list` | GetUnitList | All units with full data (RFR format) | ✗ |
| `get_unit_list_inside` | GetUnitListInside | Units within bounding box | ✗ |
| `get_block_list` | GetBlockList | Map tile/block data | ✗ |
| `get_material_list` | GetMaterialList | Material definitions (RFR format) | ✗ |
| `get_item_list` | GetItemList | Item type definitions | ✗ |
| `get_building_def_list` | GetBuildingDefList | Building type definitions | ✗ |
| `get_creature_raws` | GetCreatureRaws | Creature raw definitions | ✗ |
| `get_plant_raws` | GetPlantRaws | Plant raw definitions | ✗ |
| `get_tiletype_list` | GetTiletypeList | Tile type definitions | ✗ |
| `get_language` | GetLanguage | Language/translation data | ✗ |
| `run_lua` | RunLua | Lua execution (core, but blocked) | ✗ |

RFR methods are registered with `plugin: "RemoteFortressReader"`. The RFR plugin IS loaded on the DFHack side (confirmed via `RemoteFortressReader_version` returning 0.21.0), but its remote RPC methods lack `SF_ALLOW_REMOTE` — same root cause as RunLua.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DFHACK_HOST` | `127.0.0.1` | DFHack remote server host |
| `DFHACK_PORT` | `5000` | DFHack remote server port |

Env vars are read at connection time (not module load), so they respect MCP host configurations properly.

### MCP Host Configuration (OpenCode)

```jsonc
{
  "mcp": {
    "vizier": {
      "type": "local",
      "command": ["node", "/path/to/vizier_mcp/build/index.js"],
      "enabled": true,
      "environment": {
        "DFHACK_HOST": "192.168.178.202",
        "DFHACK_PORT": "5000"
      }
    }
  }
}
```

Note: The property is `environment` (not `env`). OpenCode's config schema requires this.

## Key Findings

### CJS/ESM Interop (FIXED)
`protobufjs` exports via `module.exports` (CJS). Using `import * as protobuf from "protobufjs"` in ESM wraps the default export in a namespace, making `protobuf.Root` undefined. Fixed by changing to `import protobuf from "protobufjs"` (default import).

### CamelCase Field Names (FIXED)
protobufjs converts snake_case proto fields to camelCase in the generated JSON:
- `scan_all` → `scanAll`, `civ_id` → `civId`, `unit_id` → `unitId`
- Single-word fields stay unchanged (`race`, `alive`, `dead`)

MCP tool input keys must match the proto JSON field names (camelCase), not the .proto file names (snake_case).

### SF_ALLOW_REMOTE Flag (BLOCKER)
DFHack's `RemoteServer.cpp` has a per-method permission check:
```cpp
if (((fn->flags & SF_ALLOW_REMOTE) != SF_ALLOW_REMOTE)
    && strcmp(socket->GetClientAddr(), "127.0.0.1") != 0)
```
Methods without `SF_ALLOW_REMOTE` are rejected for non-localhost clients. Core methods `RunLua` and `RunCommand` lack this flag, as do all RFR plugin methods. This blocks Lua-based fallback queries and rich game-state access from remote connections.

### Pagination
Three tools are now paginated to avoid output truncation by the MCP host:
- `list_units` — `offset`/`limit` with response wrapper `{ total, offset, limit, items }`
- `list_materials` — same pattern
- `list_job_skills` — `type` selector + `offset`/`limit`

## TODO

### High Priority

- [ ] Fix `RunLua` for remote access — needs DFHack rebuild with `SF_ALLOW_REMOTE` flag
  - Alternative: websockify proxy on DF host to make remote appear as localhost
- [ ] Expose `mask.skills`, `mask.labors`, `mask.miscTraits` in `list_units` tool description
  - Data already flows through when mask is set; just needs schema entry

### Medium Priority

- [ ] Add `offset`/`limit` pagination note to `list_units` and `list_materials` tool descriptions
- [ ] Fix builtin materials `token` field issue (DFHack 53.13 builtins lack required `token` in proto)
- [ ] Add `mask` parameter to `list_materials` for detailed material info
- [ ] Document data gaps: nobility via entity positions requires Lua/RFR; unit health/thoughts/mood requires Lua/RFR
- [ ] If RunLua becomes available, implement Lua-based fallback tools for:
  - Unit health, mood, thoughts
  - Entity positions (nobility titles)
  - Current jobs/tasks
  - Burrow assignments

### Low Priority

- [ ] Profile large responses and add pagination to `list_enums` if needed (currently fine)
- [ ] Consider websockify proxy setup for local DFHack instances
- [ ] Handle proto version mismatches gracefully (e.g. `token` field on builtin materials)

## Testing

### Verified Against DFHack 53.13-r1 (Steam)

| Test | Tool(s) | Result |
|------|---------|--------|
| Core connectivity | `get_world_info` | ✓ Returns world name, mode, IDs |
| Version queries | `get_version`, `get_df_version` | ✓ Returns 53.13-r1 |
| Enums | `list_enums` | ✓ All flags, labors, skills, professions |
| Job skills (paginated) | `list_job_skills` with `type`/`limit` | ✓ 136 professions, 149 skills |
| Materials (paginated) | `list_materials` with filters | ✓ 319 inorganic materials |
| Units (paginated, masked) | `list_units` with `mask.profession` | ✓ 175 total dwarves with profession data |
| Squad listing | `list_squads` | ✓ 4 squads with members |
| Pagination | `list_units` `offset`/`limit` | ✓ Returns `{ total, offset, limit, items }` |
| CamelCase fields | `scanAll`, `civId`, `unitId` | ✓ Correct encoding |
| Proto JSON loading | `getProtoRoot()` | ✓ 7 namespaces loaded |
| Env var config | `DFHACK_HOST`/`DFHACK_PORT` | ✓ Read at connection time |
| RFR methods | All RFR tools | ✗ SF_ALLOW_REMOTE blocker |
| RunLua (core) | `run_lua` | ✗ SF_ALLOW_REMOTE + module name gate |
| Builtin materials | `list_materials` with `builtin: true` | ✗ Missing `token` in DFHack 53.13 |
| Custom profession | `list_units` with `mask.profession` | ✗ Empty for all units (DF 50+ doesn't use it for titles) |

### Test Setup

- DFHack remote server on `192.168.178.202:5000`
- MCP host: OpenCode with `environment.DFHACK_HOST` and `environment.DFHACK_PORT`
- DF version: 53.13-r1 (Steam)
- Test fortress: "The Land of Vision", ~175 citizens, 4 military squads

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK (TypeScript)
- `protobufjs` — Protocol Buffers for JS
- `zod` — Schema validation for MCP tool inputs

## License

ISC (matching dfhack-remote)

## References

- [DFHack Remote API Docs](https://docs.dfhack.org/)
- [dfhack-remote JS library](https://github.com/alexchandel/dfhack-remote)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
