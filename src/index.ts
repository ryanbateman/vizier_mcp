#!/usr/bin/env node
// Subcommand dispatch (must run before any DFHack-touching imports so
// `npx vizier-mcp install-companion` works on a host with no DF / DFHack
// running). The install-companion path is intentionally read-only relative
// to the MCP server — it copies the bundled rpc.legends Lua module into
// a DFHack install and exits.
const SUBCOMMAND = process.argv[2];
if (SUBCOMMAND === "install-companion") {
  const { run } = await import("./install-companion.js");
  await run(process.argv.slice(3));
  process.exit(0);
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { registerVersionTools } from "./tools/version.js";
import { registerWorldTools } from "./tools/world.js";
import { registerUnitTools } from "./tools/units.js";
import { registerReferenceTools, registerReferenceResources } from "./tools/reference.js";
import { registerMapTools } from "./tools/map.js";
import { registerOverviewTools } from "./tools/overview.js";
import { registerDescribeUnitTool } from "./tools/describe-unit.js";
import { registerWorkforceTool } from "./tools/workforce.js";
import { registerWorldInstrumentsTool } from "./tools/world-instruments.js";
import { registerMilitiaTool } from "./tools/militia.js";
import { registerMortalityTool } from "./tools/mortality.js";
import { registerItemCensusTool } from "./tools/item-census.js";
import { registerLegendsTools } from "./tools/legends.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerLuaTool } from "./tools/lua.js";
import { disconnectClient } from "./dfhack/client.js";
import { warmCache } from "./lookup-cache.js";

// run_lua is opt-in: DFHack only permits modules named rpc.* / *.rpc / *-rpc
// (see README appendix), so without a user-authored rpc.* script the tool is
// non-functional and only misleads the model. Enable explicitly if you have
// such modules: VIZIER_ENABLE_RUN_LUA=1 (also: true / yes).
function runLuaEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.VIZIER_ENABLE_RUN_LUA ?? "");
}

// Job-management WRITE tools (set_job_priority, set_job_suspended) are opt-in
// on top of the rpc.jobs companion: they mutate game state, so they only
// register when VIZIER_ENABLE_ACTIONS=1 (also: true / yes). The read tool
// (list_jobs) and the jobs_setup_check diagnostic register regardless, so the
// companion can be discovered without unlocking writes.
function actionsEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.VIZIER_ENABLE_ACTIONS ?? "");
}

// Real version from package.json so the MCP handshake and startup log
// reflect the build actually running (key for diagnosing stale npx/pinned
// installs). package.json sits one level above build/index.js.
const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSION = (
  JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8")) as { version: string }
).version;

const server = new McpServer({
  name: "vizier-mcp",
  version: VERSION,
});

registerVersionTools(server);
registerWorldTools(server);
registerUnitTools(server);
registerReferenceTools(server);
registerReferenceResources(server);
registerMapTools(server);
registerOverviewTools(server);
registerDescribeUnitTool(server);
registerWorkforceTool(server);
registerWorldInstrumentsTool(server);
registerMilitiaTool(server);
registerMortalityTool(server);
registerItemCensusTool(server);
// Legends tools always register — legends_setup_check is the discovery
// entry point and must be reachable even when the companion script /
// VIZIER_ENABLE_RUN_LUA aren't in place yet.
registerLegendsTools(server);
// Job tools follow the same discovery-first contract: jobs_setup_check +
// list_jobs always register; the write tools only when VIZIER_ENABLE_ACTIONS=1.
registerJobTools(server, { actionsEnabled: actionsEnabled() });
if (runLuaEnabled()) registerLuaTool(server);

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[vizier-mcp] Received ${signal}, shutting down...`);
  disconnectClient();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[vizier-mcp] v${VERSION} ready ` +
      `(DFHACK_HOST=${process.env.DFHACK_HOST ?? "127.0.0.1"} ` +
      `DFHACK_PORT=${process.env.DFHACK_PORT ?? "5000"} ` +
      `DFHACK_RPC_TIMEOUT_MS=${process.env.DFHACK_RPC_TIMEOUT_MS ?? "60000"})`,
  );
  // Best-effort: pre-fetch lookup tables so the first unit query is fast.
  // No-ops gracefully if DFHack isn't running yet (retried lazily on demand).
  void warmCache();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
