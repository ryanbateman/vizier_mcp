# Vizier MCP — DFHack MCP Server

## Overview

Vizier MCP is a Model Context Protocol (MCP) server that connects to a running Dwarf Fortress + DFHack instance over its TCP remote API and exposes game state queries as MCP tools. This enables LLMs to understand and reason about a Dwarf Fortress game in progress.

## Architecture

### Transport层

- **MCP transport**: Stdio (standard for local MCP servers, launched by MCP hosts like Claude Desktop)
- **DFHack transport**: Raw TCP to `localhost:5000` (DFHack's default remote server port)

### DFHack Protocol

DFHack exposes a custom binary protocol on top of Google Protobuf message serialization:

1. **Handshake**: Client sends `"DFHack?\n"` + int32 version `1`; server replies `"DFHack!\n"` + int32 version `1`
2. **Method binding**: All RPC methods are discovered at runtime via `BindMethod` (ID 0), which takes a method name, input protobuf type, output protobuf type, and optional plugin name
3. **Calling methods**: Send a header (int16 method_id + int16 padding + int32 size) followed by protobuf-encoded payload
4. **Responses**: Server sends 0+ `RPC_REPLY_TEXT` messages (int16 id=-3) followed by one `RPC_REPLY_RESULT` (id=-1) or `RPC_REPLY_FAIL` (id=-2)
5. **Quit**: Send header with id=-4 to disconnect

Max payload size: 64 MiB. All values little-endian.

### Key RPC Methods (Read-Only v1)

| Source | Method | Input | Output |
|--------|--------|-------|--------|
| Core | `BindMethod` | `CoreBindRequest` | `CoreBindReply` |
| Core plugin | `GetVersionInfo` | `EmptyMessage` | `VersionInfo` |
| Core plugin | `GetDFVersion` | `EmptyMessage` | `StringMessage` |
| Core plugin | `GetWorldInfo` | `EmptyMessage` | `GetWorldInfoOut` |
| Core plugin | `ListEnums` | `EmptyMessage` | `ListEnumsOut` |
| Core plugin | `ListJobSkills` | `EmptyMessage` | `ListJobSkillsOut` |
| Core plugin | `ListMaterials` | `ListMaterialsIn` | `ListMaterialsOut` |
| Core plugin | `ListUnits` | `ListUnitsIn` | `ListUnitsOut` |
| Core plugin | `ListSquads` | `ListSquadsIn` | `ListSquadsOut` |
| Core | `RunCommand` | `CoreRunCommandRequest` | `EmptyMessage` |
| Core | `RunLua` | `CoreRunLuaRequest` | `StringListMessage` |
| RFR | `GetUnitList` | `EmptyMessage` | `UnitList` |
| RFR | `GetUnitListInside` | `BlockRequest` | `UnitList` |
| RFR | `GetBlockList` | `BlockRequest` | `BlockList` |
| RFR | `GetMapInfo` | `EmptyMessage` | `MapInfo` |
| RFR | `GetViewInfo` | `EmptyMessage` | `ViewInfo` |
| RFR | `GetItemList` | `EmptyMessage` | `MaterialList` |
| RFR | `GetMaterialList` | `EmptyMessage` | `MaterialList` |
| RFR | `GetBuildingDefList` | `EmptyMessage` | `BuildingList` |
| RFR | `GetCreatureRaws` | `EmptyMessage` | `CreatureRawList` |
| RFR | `GetPlantRaws` | `EmptyMessage` | `PlantRawList` |
| RFR | `GetTiletypeList` | `EmptyMessage` | `TiletypeList` |
| RFR | `GetLanguage` | `EmptyMessage` | `Language` |
| RFR | `GetWorldMap` | `EmptyMessage` | `WorldMap` |
| RFR | `GetWorldMapNew` | `EmptyMessage` | `WorldMap` |
| RFR | `GetRegionMaps` | `EmptyMessage` | `RegionMaps` |
| RFR | `GetPauseState` | `EmptyMessage` | `SingleBool` |
| RFR | `GetVersionInfo` | `EmptyMessage` | `VersionInfo` |
| RFR | `GetReports` | `EmptyMessage` | `Status` |

### DFHack Client Library

We adapt the open-source `dfhack-remote` JavaScript library (ISC license, by Alex Chandel). The original is browser-only (WebSocket transport). We:

- Port the binary codec (handshake, header framing, message encode/decode) to Node.js TCP
- Use the same `protobufjs` library for protobuf serialization
- Compile the same `.proto` definitions from DFHack/RemoteFortressReader
- Use the same FUNC_DEFS table for method binding

## Project Structure

```
vizier_mcp/
├── src/
│   ├── index.ts              # MCP server entry point + tool registration
│   ├── dfhack/
│   │   ├── client.ts         # DFHack TCP client (connect, handshake, bind, call)
│   │   ├── codec.ts           # Binary protocol encode/decode
│   │   ├── methods.ts         # FUNC_DEFS, method binding, type lookup
│   │   └── connection.ts      # Connection lifecycle, reconnection
│   ├── tools/
│   │   ├── world.ts           # get_version_info, get_world_info, get_map_info, get_view_info, get_pause_state
│   │   ├── units.ts           # get_unit_list, get_unit_list_inside
│   │   ├── reference.ts       # get_material_list, get_item_list, get_building_def_list, get_creature_raws, get_plant_raws, get_tiletype_list, get_language
│   │   └── lua.ts             # run_lua
│   └── types.ts               # Shared TypeScript types
├── proto/                     # .proto files (from DFHack/RFR)
├── generated/                 # Compiled proto JSON (protobufjs output)
├── package.json
├── tsconfig.json
├── PLAN.md
└── .gitignore
```

## v1 MCP Tools (16 tools, read-only)

### World & Meta (5 tools)

| # | Tool Name | Input | Description |
|---|-----------|-------|-------------|
| 1 | `get_version_info` | — | Get DF and DFHack version strings |
| 2 | `get_world_info` | — | Get world name, game mode, and world ID |
| 3 | `get_map_info` | — | Get map dimensions and region info |
| 4 | `get_view_info` | — | Get current viewport position and size |
| 5 | `get_pause_state` | — | Check if the game is currently paused |

### Units (2 tools)

| # | Tool Name | Input | Description |
|---|-----------|-------|-------------|
| 6 | `get_unit_list` | — | List all units (dwarves, animals, invaders, etc.) with names, positions, skills |
| 7 | `get_unit_list_inside` | `minX, minY, minZ, maxX, maxY, maxZ` | List units within a map region |

### Reference Data (7 tools)

| # | Tool Name | Input | Description |
|---|-----------|-------|-------------|
| 8 | `get_block_list` | `minX, minY, minZ, maxX, maxY, maxZ` | Get map tile/block data for a region |
| 9 | `get_material_list` | — | List all material definitions |
| 10 | `get_item_list` | — | List item type definitions |
| 11 | `get_building_def_list` | — | List building type definitions |
| 12 | `get_creature_raws` | — | List creature raw definitions |
| 13 | `get_plant_raws` | — | List plant raw definitions |
| 14 | `get_tiletype_list` | — | List all tile type definitions |
| 15 | `get_language` | — | Get language/translation data |

### Advanced (1 tool)

| # | Tool Name | Input | Description |
|---|-----------|-------|-------------|
| 16 | `run_lua` | `module, function, arguments[]` | Execute a Lua function in DFHack for arbitrary game state queries (powerful, can theoretically mutate — use with caution) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DFHACK_HOST` | `127.0.0.1` | DFHack remote server host |
| `DFHACK_PORT` | `5000` | DFHack remote server port |

## MCP Host Configuration

```json
{
  "mcpServers": {
    "vizier": {
      "command": "node",
      "args": ["/path/to/vizier_mcp/build/index.js"]
    }
  }
}
```

## Implementation Steps

1. Scaffold project: `package.json`, `tsconfig.json`, dependencies
2. Port proto definitions and generate JSON descriptors with `protobufjs`
3. Implement DFHack binary codec (handshake, header framing, message encode/decode)
4. Implement DFHack TCP client (connect, bind methods, call RPC methods, disconnect)
5. Build MCP server skeleton with `McpServer` and `StdioServerTransport`
6. Implement tools group by group (world → units → reference → lua)
7. Add env var config and connection lifecycle management
8. Build & test against a running DF+DFHack instance

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK (TypeScript)
- `protobufjs` — Protocol Buffers for JS (same library dfhack-remote uses)
- `zod` — Schema validation for MCP tool inputs

## License

ISC (matching dfhack-remote)

## References

- [DFHack Remote API Docs](https://dfhack.readthedocs.io/)
- [dfhack-remote JS library](https://github.com/alexchandel/dfhack-remote)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)