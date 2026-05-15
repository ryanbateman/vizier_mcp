#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerWorldTools } from "./tools/world.js";
import { registerUnitTools } from "./tools/units.js";
import { registerReferenceTools } from "./tools/reference.js";
import { registerLuaTool } from "./tools/lua.js";

const server = new McpServer({
  name: "vizier-mcp",
  version: "0.1.0",
});

registerWorldTools(server);
registerUnitTools(server);
registerReferenceTools(server);
registerLuaTool(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});