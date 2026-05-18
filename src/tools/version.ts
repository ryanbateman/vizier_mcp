import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callTool } from "./helpers.js";

export function registerVersionTools(server: McpServer) {
  server.tool("get_version_info", "Get Dwarf Fortress and DFHack version information", {}, async () => {
    return callTool("GetVersionInfo");
  });

  server.tool("get_version", "Get DFHack version string", {}, async () => {
    return callTool("GetVersion");
  });

  server.tool("get_df_version", "Get Dwarf Fortress version string", {}, async () => {
    return callTool("GetDFVersion");
  });
}
