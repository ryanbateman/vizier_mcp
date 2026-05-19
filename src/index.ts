#!/usr/bin/env node
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
