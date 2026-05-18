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
3. **Calling methods**: Send header (int16 method_id + int16 padding + int32 size) followed by protobuf-encoded payload
4. **Responses**: Server sends 0+ `RPC_REPLY_TEXT` messages (id=-3) followed by one `RPC_REPLY_RESULT` (id=-1) or `RPC_REPLY_FAIL` (id=-2)
5. **Quit**: Send header with id=-4 to disconnect

Max payload size: 64 MiB. All values little-endian.

`command_result` codes returned in `RPC_REPLY_FAIL` size field:
- `CR_LINK_FAILURE = -3`: I/O or protocol error
- `CR_NEEDS_CONSOLE = -2`: Attempt to call interactive command without console
- `CR_NOT_IMPLEMENTED = -1`: Not implemented or plugin not loaded
- `CR_OK = 0`: Success
- `CR_FAILURE = 1`: General failure
- `CR_WRONG_USAGE = 2`: Wrong arguments or usage
- `CR_NOT_FOUND = 3`: Target object not found

### Project Structure

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
├── README.md
└── .gitignore
```

---

## Remote Access Constraints (Verified Against Source)

### Source-Verified Method Registration Flags

Verified from DFHack source (`RemoteTools.cpp`, `RemoteFortressReader.cpp`, `RemoteServer.cpp`):

#### Core Service (`library/RemoteTools.cpp`)

| Method | Flags | Remote? |
|--------|-------|---------|
| BindMethod | `SF_DONT_SUSPEND \| SF_ALLOW_REMOTE` | **Yes** |
| RunCommand | `SF_DONT_SUSPEND` | **No** |
| CoreSuspend | `SF_DONT_SUSPEND \| SF_ALLOW_REMOTE` | Yes |
| CoreResume | `SF_DONT_SUSPEND \| SF_ALLOW_REMOTE` | Yes |
| RunLua | _(no flags)_ | **No** |
| GetVersion | `SF_DONT_SUSPEND \| SF_ALLOW_REMOTE` | Yes |
| GetDFVersion | `SF_DONT_SUSPEND \| SF_ALLOW_REMOTE` | Yes |
| GetWorldInfo | `SF_ALLOW_REMOTE` | Yes |
| ListEnums | `SF_CALLED_ONCE \| SF_DONT_SUSPEND \| SF_ALLOW_REMOTE` | Yes |
| ListJobSkills | `SF_CALLED_ONCE \| SF_DONT_SUSPEND \| SF_ALLOW_REMOTE` | Yes |
| ListMaterials | `SF_CALLED_ONCE \| SF_ALLOW_REMOTE` | Yes |
| ListUnits | `SF_ALLOW_REMOTE` | Yes |
| ListSquads | `SF_ALLOW_REMOTE` | Yes |
| SetUnitLabors | `SF_ALLOW_REMOTE` | Yes |

#### RemoteFortressReader Plugin — ALL methods have `SF_ALLOW_REMOTE`

| Method | Remote? |
|--------|---------|
| GetVersionInfo | **Yes** |
| GetMapInfo | **Yes** |
| GetViewInfo | **Yes** |
| GetPauseState | **Yes** |
| GetUnitList | **Yes** |
| GetUnitListInside | **Yes** |
| GetBlockList | **Yes** |
| GetMaterialList | **Yes** |
| GetItemList | **Yes** |
| GetBuildingDefList | **Yes** |
| GetCreatureRaws | **Yes** |
| GetPlantRaws | **Yes** |
| GetTiletypeList | **Yes** |
| GetLanguage | **Yes** |
| All other RFR methods | **Yes** |

The RFR plugin includes a compatibility fallback:
```cpp
#ifndef SF_ALLOW_REMOTE
#define SF_ALLOW_REMOTE 0
#endif
```

#### Rename Plugin — ALL methods local only

| Method | Flags | Remote? |
|--------|-------|---------|
| RenameSquad | _(no flags)_ | **No** |
| RenameUnit | _(no flags)_ | **No** |
| RenameBuilding | _(no flags)_ | **No** |

#### Enforcement Logic (`RemoteServer.cpp`)

```cpp
if (((fn->flags & SF_ALLOW_REMOTE) != SF_ALLOW_REMOTE)
    && strcmp(socket->GetClientAddr(), "127.0.0.1") != 0)
{
    stream.printerr("In call to {}: forbidden host: {}\n", fn->name, socket->GetClientAddr());
}
```

Methods **without** `SF_ALLOW_REMOTE` are only accessible from 127.0.0.1 (localhost). Methods **with** the flag are never blocked, regardless of client address.

### What's Actually Blocked Remotely

Only these are blocked for non-localhost clients:
1. **RunLua** — No flags, plus module name restriction (`rpc.*`, `*.rpc`, `*-rpc` whitelist)
2. **RunCommand** — `SF_DONT_SUSPEND` only (intentional: prevents arbitrary command execution remotely)
3. **Rename plugin methods** — No flags (not exposed as Vizier tools)

All RFR methods (GetUnitList, GetBlockList, GetCreatureRaws, etc.) have `SF_ALLOW_REMOTE` and should work remotely.

### Root Cause of Earlier RFR Testing Failures

The PLAN previously stated RFR methods were blocked by `SF_ALLOW_REMOTE`. This was **incorrect** — the failures were likely caused by:
- Method binding failures (proto schema mismatch, plugin not fully loaded)
- Silent error catching in `bindAllMethods` (catches and continues, logs nothing)
- Silent error catching in tool handlers (returns generic error, no diagnostic info)

The `SF_ALLOW_REMOTE` hypothesis was assumed rather than verified against source code.

---

## MCP Tools

### Core Tools (always available)

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

### Core Methods (unavailable remotely)

| Method | Reason | Impact |
|--------|--------|--------|
| `RunLua` | No `SF_ALLOW_REMOTE` flag | Cannot query arbitrary game state via Lua |
| `RunCommand` | No `SF_ALLOW_REMOTE` flag | Cannot execute DFHack console commands remotely |

### RFR Tools (remote-accessible — all have `SF_ALLOW_REMOTE`)

| Tool | Method | Description | Status |
|------|--------|-------------|--------|
| `get_version_info` | GetVersionInfo | DF+DFHack version info | needs retest |
| `get_map_info` | GetMapInfo | Map dimensions and region info | needs retest |
| `get_view_info` | GetViewInfo | Viewport position and size | needs retest |
| `get_pause_state` | GetPauseState | Check if game is paused | needs retest |
| `get_unit_list` | GetUnitList | All units with full data (RFR format) | needs retest |
| `get_unit_list_inside` | GetUnitListInside | Units within bounding box | needs retest |
| `get_block_list` | GetBlockList | Map tile/block data | needs retest |
| `get_material_list` | GetMaterialList | Material definitions (RFR format) | needs retest |
| `get_item_list` | GetItemList | Item type definitions | needs retest |
| `get_building_def_list` | GetBuildingDefList | Building type definitions | needs retest |
| `get_creature_raws` | GetCreatureRaws | Creature raw definitions | needs retest |
| `get_plant_raws` | GetPlantRaws | Plant raw definitions | needs retest |
| `get_tiletype_list` | GetTiletypeList | Tile type definitions | needs retest |
| `get_language` | GetLanguage | Language/translation data | needs retest |
| `run_lua` | RunLua | Lua execution (core, but blocked) | ✗ |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DFHACK_HOST` | `127.0.0.1` | DFHack remote server host |
| `DFHACK_PORT` | `5000` | DFHack remote server port |

### Remote Connection Setup

For remote connections, both settings must be configured:

1. **DFHack side** (`dfhack-config/remote-server.json`):
   ```json
   {
     "allow_remote": true,
     "port": 5000
   }
   ```

2. **MCP Host side** (e.g., OpenCode):
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

Without `allow_remote: true`, DFHack binds only to 127.0.0.1, accepting only local connections. Even with `allow_remote: true`, methods without `SF_ALLOW_REMOTE` (RunLua, RunCommand) remain blocked for non-localhost clients.

---

## Key Findings

### CJS/ESM Interop (FIXED)
`protobufjs` exports via `module.exports` (CJS). Using `import * as protobuf from "protobufjs"` in ESM wraps the default export in a namespace, making `protobuf.Root` undefined. Fixed by changing to `import protobuf from "protobufjs"` (default import).

### CamelCase Field Names (FIXED)
protobufjs converts snake_case proto fields to camelCase in the generated JSON:
- `scan_all` → `scanAll`, `civ_id` → `civId`, `unit_id` → `unitId`
- Single-word fields stay unchanged (`race`, `alive`, `dead`)

MCP tool input keys must match the proto JSON field names (camelCase), not the .proto file names (snake_case).

### RFR Remote Access (CORRECTED)
Previously documented as blocked by `SF_ALLOW_REMOTE`. Verified from source: all RFR methods ARE registered with `SF_ALLOW_REMOTE`. Earlier test failures were likely caused by silent error catching in `bindAllMethods` or tool handlers, not permission restrictions.

### Pagination
Three tools are paginated to avoid output truncation by the MCP host:
- `list_units` — `offset`/`limit` with response wrapper `{ total, offset, limit, items }`
- `list_materials` — same pattern
- `list_job_skills` — `type` selector + `offset`/`limit`

### Proto JSON Fix (FRAGILE)
`methods.ts` contains a runtime patch removing `rule` fields from `MapBlock` in the proto JSON. This is fragile — shallow copy, field-name-dependent. Should be moved to the proto generation script.

---

## Refactoring Plan

### 1. Eliminate Try/Catch Boilerplate — `callTool` Helper (P1)

25+ identical try/catch blocks doing `getClient()` → `call()` → `JSON.stringify` → error. Create `src/tools/helpers.ts` with `callTool()` and `callWithClient()` helpers. ~150 lines eliminated.

### 2. Type Proto Responses — Replace `any` Casts (P2)

Every response cast `as any`. Define TypeScript interfaces for proto response shapes in `src/dfhack/types.ts`. Add `client.callTyped<T>(name): Promise<T>`.

### 3. Extract Shared Concerns from `core.ts` (P1)

`core.ts` mixes tool registration, lookup caching/enrichment, and pagination. Split into:
- `src/enrichment.ts` — `LookupTables`, `ensureLookups()`, `resolveUnitNames()`, `enrichInventory()`
- `src/pagination.ts` — `paginate()`
- `src/tools/core.ts` — only tool registration

### 4. Deduplicate `blockRequestSchema` (P1)

Identical Zod schema in `units.ts` and `reference.ts`. Move to `src/tools/schemas.ts`.

### 5. Fix Lookup Cache — Add Invalidation (P2)

`cachedLookups` populated once, never refreshed. Add `invalidateLookups()`, call it on reconnect. Store `world_id` alongside cache; invalidate if changed.

### 6. Add Reconnection with Backoff (P2)

Connection failure is fatal. Add exponential backoff retry (3 attempts) in `getClient()`. Call `invalidateLookups()` on successful reconnect. Add SIGINT/SIGTERM handlers.

### 7. Remove Dead Code (P1)

Delete: `readRawBytes` (declared, never read), `resetClient()` (exported, never called), `DecodedReply` interface (never used).

### 8. Fix Silent Error Swallowing (P0)

`bindAllMethods` catches failures silently. RFR failures ignored in `ensureLookups`. No diagnostic info.

### 9. Enhance Error Messages for Known Failure Modes (P0)

Generic `RPC call to X failed` messages. Parse `command_result` codes and enrich with context.

### 10. Correct Documentation (P0)

README and PLAN incorrectly claim RFR methods are blocked remotely. They have `SF_ALLOW_REMOTE`.

### 11. Parse Failure Codes from `RPC_REPLY_FAIL` (P0)

`client.call()` treats all failures as generic errors. Extract `command_result` codes from fail messages. Create `DFHackRPCError` class.

### 12. Proto JSON Fix — Move to Generation Script (P3)

Move `rule` deletion from runtime `getProtoRoot()` to `scripts/generate-proto.mjs` post-processing.

### 13. Guard Against Concurrent `sendRecv` Calls (P3)

Single `pendingResolve`/`pendingReject` pair — concurrent calls corrupt responses. Add runtime assertion.

### 14. Return Actual Response from `set_unit_labors` (P2)

Discards RPC response, returns hardcoded string. Return actual status.

### 15. Reorganize Tool Files by Domain (P3)

`world.ts` mixes core and RFR. `reference.ts` is a grab-bag. Reorganize by user-facing domain.

### Execution Priority

| Phase | Items | Effort |
|-------|-------|--------|
| **P0** | #8 (error logging), #9 (error messages), #10 (docs), #11 (failure codes) | Medium |
| **P1** | #1 (callTool helper), #3 (extract enrichment), #4 (shared schema), #7 (dead code) | Medium |
| **P2** | #2 (typed responses), #5 (cache invalidation), #6 (reconnection), #14 (set_unit_labors) | High |
| **P3** | #12 (proto fix), #13 (sendRecv guard), #15 (reorganize files) | Low |

---

## Testing Plan

### Unit Tests

#### Protocol Layer (`dfhack/codec.ts`, `dfhack/client.ts`)

| Test | What it validates |
|------|-------------------|
| `encodeHeader` / `decodeHeader` roundtrip | Header serialization consistency |
| `encodeMessage` produces correct binary format | Message framing matches DFHack protocol |
| `createHandshakeRequest` produces correct magic bytes | Handshake format |
| `validateHandshakeResponse` accepts valid, rejects invalid | Handshake validation |
| `tryParseMessages` with valid `RPC_REPLY_RESULT` | Result message parsing |
| `tryParseMessages` with valid `RPC_REPLY_FAIL` + command_result code | Failure code extraction |
| `tryParseMessages` with `RPC_REPLY_TEXT` followed by `RPC_REPLY_RESULT` | Multi-message parsing |
| `tryParseMessages` with partial data (buffered) | Incremental parsing |
| `tryParseMessages` with oversized payload | Max size enforcement (64 MiB) |
| `sendRecv` with `pendingResolve` already set throws | Concurrent call guard |
| `DFHackRPCError` carries code and method name | Error class structure |

#### Enrichment Layer (`enrichment.ts`)

| Test | What it validates |
|------|-------------------|
| `decodeFlags` with known bit patterns | Bit-to-name resolution |
| `decodeFlags` with unknown bits | Unknown bits skipped gracefully |
| `resolveUnitNames` with profession ID | Profession name enrichment |
| `resolveUnitNames` with skills | Skill name + noun enrichment |
| `resolveUnitNames` with labors array | Labor name enrichment |
| `resolveUnitNames` with gender | Male/Female resolution |
| `enrichInventory` with material lookup | Material name enrichment |
| `enrichInventory` with item type lookup | Item type enrichment |
| `enrichInventory` with missing lookups | Graceful degradation |

#### Pagination (`pagination.ts`)

| Test | What it validates |
|------|-------------------|
| `paginate([1..100], 0, 20)` | Basic pagination |
| `paginate([1..10], 0, 20)` | Limit exceeds collection |
| `paginate([1..100], 95, 20)` | Offset near end |
| `paginate([], 0, 20)` | Empty collection |
| `paginate([1..100], 50, 0)` | Zero limit edge case |

#### Tool Input Handling

| Test | What it validates |
|------|-------------------|
| `list_units` with `scan_all: true` | `scanAll` camelCase mapping |
| `list_units` with `civ_id: 123` | `civId` camelCase mapping |
| `list_units` with name filter | Substring case-insensitive matching |
| `list_materials` with no filters | Defaults to `inorganic: true` |
| `list_materials` with explicit filters | Passes through without default |
| `list_job_skills` with `type: "skill"` | Filters to skill array |
| `list_job_skills` with no type | Returns all three arrays |
| `set_unit_labors` input mapping | `changes` array → `change` with camelCase |

### Integration Tests (live DFHack required)

These tests require a running DFHack instance. Gated behind `DFHACK_INTEGRATION_TEST=1`.

| Test | What it validates |
|------|-------------------|
| Connect + handshake | `DFHackClient.connect()` succeeds |
| Bind all methods | All methods for loaded plugins bind successfully |
| `get_version` returns non-empty string | Core method works |
| `get_df_version` returns version | Core method works |
| `get_world_info` returns valid structure | Core method works |
| `list_enums` returns enum data | Core method works |
| `list_units` with `scan_all: true` | Returns unit list |
| `list_units` with `name` filter | Name filtering works |
| `list_units` with `mask.profession: true` | Profession enrichment works |
| `list_materials` with `inorganic: true` | Material listing works |
| `list_squads` returns squad data | Core method works |
| `get_unit_list` (RFR) | RFR method works (was previously thought blocked) |
| `get_block_list` with coordinates | RFR map data works |
| `get_map_info` (RFR) | RFR method works |
| `get_creature_raws` (RFR) | RFR method works |

### Regression Tests

These tests prevent reversions of the issues identified in this analysis:

| Test | What it prevents |
|------|------------------|
| `callTool` helper used by all tools | Prevents re-introduction of try/catch boilerplate |
| No `as any` casts in tool handlers | Prevents regression to untyped response access |
| `blockRequestSchema` imported, not duplicated | Prevents schema duplication |
| `DFHackRPCError` thrown on `RPC_REPLY_FAIL` with parsed code | Prevents regression to generic error messages |
| `bindAllMethods` logs failures to stderr | Prevents silent bind failures |
| `sendRecv` throws on concurrent call | Prevents silent data corruption |
| Connection error messages include bound methods | Prevents generic unhelpful errors |
| `set_unit_labors` returns method/status, not hardcoded string | Prevents discarding response |

### Test Infrastructure

- **Framework:** `vitest` (fast, ESM-native, good TypeScript support)
- **Location:** `test/` directory, mirroring `src/` structure
- **Mocking:** Mock `DFHackClient` for unit tests; real client for integration tests
- **CI:** Run unit tests on every push; integration tests on schedule or manual trigger
- **Dependencies to add:** `vitest`, `@vitest/coverage-v8`

### Mock Strategy for Unit Tests

Create `test/mocks/dfhack-client.ts` implementing:
```typescript
interface MockCallSpec {
  methodName: string;
  input?: Record<string, unknown>;
  response: Record<string, unknown>;
  error?: Error;
}
```

This allows injecting expected responses per test without a real DFHack connection.

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK (TypeScript)
- `protobufjs` — Protocol Buffers for JS
- `zod` — Schema validation for MCP tool inputs
- `vitest` — Test framework (to be added)
- `@vitest/coverage-v8` — Coverage reporting (to be added)

## License

ISC (matching dfhack-remote)

## References

- [DFHack Remote API Docs](https://docs.dfhack.org/en/stable/docs/dev/Remote.html)
- [DFHack RemoteServer.cpp](https://github.com/DFHack/dfhack/blob/develop/library/RemoteServer.cpp) — `SF_ALLOW_REMOTE` enforcement
- [DFHack RemoteTools.cpp](https://github.com/DFHack/dfhack/blob/develop/library/RemoteTools.cpp) — Core method registration with flags
- [RemoteFortressReader.cpp](https://github.com/DFHack/dfhack/blob/develop/plugins/RemoteFortressReader.cpp) — All RFR methods registered with `SF_ALLOW_REMOTE`
- [dfhack-remote JS library](https://github.com/alexchandel/dfhack-remote)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
