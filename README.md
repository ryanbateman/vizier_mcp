# Vizier MCP

MCP server for querying Dwarf Fortress game state via DFHack's remote API.

## Setup

```bash
npm install
npm run build
```

## MCP Host Configuration (OpenCode)

```jsonc
{
  "mcp": {
    "vizier": {
      "type": "local",
      "command": ["node", "/path/to/vizier_mcp/build/index.js"],
      "enabled": true,
      "environment": {
        "DFHACK_HOST": "127.0.0.1",
        "DFHACK_PORT": "5000"
      }
    }
  }
}
```

## Tools

### Working (Core API)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `get_version` | DFHack version string | — |
| `get_df_version` | Dwarf Fortress version string | — |
| `get_world_info` | World name, game mode, world ID | — |
| `list_enums` | All enum definitions (flags, labors, skills, professions) | — |
| `list_job_skills` | Skills, professions, and labors with attributes | `type`, `offset`, `limit` |
| `list_materials` | Material definitions with optional type filters | `builtin`, `inorganic`, `creatures`, `plants`, `offset`, `limit` |
| `list_units` | Units with filters and data mask | `scan_all`, `race`, `civ_id`, `alive`, `dead`, `sane`, `mask`, `offset`, `limit` |
| `list_squads` | Military squads and members | — |
| `set_unit_labors` | Enable/disable labors for units | `changes[]` |

### `list_units` Mask Options

| Field | What It Returns |
|-------|----------------|
| `profession` | Profession enum, custom profession, squad assignment |
| `skills` | All skill levels and experience per dwarf |
| `labors` | Enabled labor IDs per dwarf |
| `miscTraits` | Personality trait values |

### Pagination

`list_units`, `list_materials`, and `list_job_skills` support `offset`/`limit` pagination. Response format:

```json
{ "total": 175, "offset": 0, "limit": 3, "items": [...] }
```

### Blocked (Requires DFHack `SF_ALLOW_REMOTE` flag)

All RemoteFortressReader (RFR) methods and the core `RunLua`/`RunCommand` methods are blocked for remote connections. These require adding `SF_ALLOW_REMOTE` in the DFHack source (`RemoteTools.cpp`) or a localhost proxy.

| Tool | Method |
|------|--------|
| `get_version_info` | GetVersionInfo |
| `get_map_info` | GetMapInfo |
| `get_view_info` | GetViewInfo |
| `get_pause_state` | GetPauseState |
| `get_unit_list` | GetUnitList |
| `get_unit_list_inside` | GetUnitListInside |
| `get_block_list` | GetBlockList |
| `get_material_list` | GetMaterialList |
| `get_item_list` | GetItemList |
| `get_building_def_list` | GetBuildingDefList |
| `get_creature_raws` | GetCreatureRaws |
| `get_plant_raws` | GetPlantRaws |
| `get_tiletype_list` | GetTiletypeList |
| `get_language` | GetLanguage |
| `run_lua` | RunLua |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DFHACK_HOST` | `127.0.0.1` | DFHack remote server host |
| `DFHACK_PORT` | `5000` | DFHack remote server port |

## Development

```bash
npm run proto          # regenerate proto JSON from .proto files
npm run build          # full build (proto + tsc)
npm run inspector      # run MCP inspector for debugging
```

## License

ISC
