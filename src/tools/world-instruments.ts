import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult } from "./helpers.js";
import { getReferenceDataset } from "../lookup-cache.js";
import {
  buildWorldInstruments,
  type ItemTypeEntry,
} from "../world-instruments.js";

interface ItemListCache {
  materialList?: ItemTypeEntry[];
}

export function registerWorldInstrumentsTool(server: McpServer) {
  server.tool(
    "world_instruments",
    "List every musical instrument procedurally generated in this world, " +
      "grouped by entity (civilisation) and family (keyboard / strings / " +
      "wind / percussion). Each entry includes the instrument's procedural " +
      "name, size, value, the named pieces that make it up, and DF's " +
      "generated prose description. Use this to answer 'what are the bards " +
      "even playing?' or to enumerate every instrument the fort could " +
      "build. Verbose mode passes the full InstrumentDef through " +
      "(sound-production codes, pitch-choice codes, tuning methods, " +
      "registers) — refer to the ItemdefInstrument proto for the integer " +
      "enums. Cached per save, so cheap to call repeatedly. Data path: " +
      "filters get_reference_data kind=item_types for entries with a " +
      "populated instrument definition." +
      " `permittedMaterials` is sparse: it reflects DF's material-flag " +
      "allow-list, which is set only for instruments that accept multiple " +
      "material categories. Most procedural instruments have a single " +
      "material baked into the description (e.g. \"huge ceramic " +
      "instrument\") with no flag set, so this array is `[]` for them. " +
      "Read the description for the actual material a built instance " +
      "will be made of.",
    {
      verbose: z.boolean().optional().describe(
        "Include the full InstrumentDef raw structure (sound production, " +
          "pitch choice, tuning, registers) on each entry. Off by default.",
      ),
    },
    async ({ verbose }) => {
      try {
        const data = await getReferenceDataset<ItemListCache>("item_types");
        const items = data.materialList ?? [];
        const report = buildWorldInstruments(items, { verbose });
        return jsonResult(report);
      } catch (err: unknown) {
        return errorResult(err);
      }
    },
  );
}
