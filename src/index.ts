#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerVersionTools } from "./tools/version.js";
import { registerWorldTools } from "./tools/world.js";
import { registerUnitTools } from "./tools/units.js";
import { registerReferenceTools, registerReferenceResources } from "./tools/reference.js";
import { registerMapTools } from "./tools/map.js";
import { registerLuaTool } from "./tools/lua.js";
import { disconnectClient } from "./dfhack/client.js";
import { warmCache } from "./lookup-cache.js";

const server = new McpServer({
  name: "vizier-mcp",
  version: "0.1.0",
});

registerVersionTools(server);
registerWorldTools(server);
registerUnitTools(server);
registerReferenceTools(server);
registerReferenceResources(server);
registerMapTools(server);
registerLuaTool(server);

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
  // Best-effort: pre-fetch lookup tables so the first unit query is fast.
  // No-ops gracefully if DFHack isn't running yet (retried lazily on demand).
  void warmCache();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
