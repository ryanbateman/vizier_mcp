// Live smoke test for the Lua companion modules (rpc.*).
//
// The unit suite (npm test) mocks the DFHack socket, so the companion *.lua —
// which only ever runs inside DFHack — has zero automated coverage. This script
// fills that gap: it pings every companion this checkout ships against a live
// DFHack and reports each one's status. Run it after editing any lua/rpc/*.lua.
//
//   npm run build && npm run smoke
//
// It reads DFHACK_HOST / DFHACK_PORT like the server. If DFHack isn't running
// it prints a notice and exits 0 (this is a dev aid, not a CI gate). A loaded
// companion reports its schema; one that is installed-but-stale or not loaded
// shows as "missing/not-loaded" — re-run after reloading it in DFHack (see the
// Companion modules section of DEVELOPMENT.md).
//
// Note: DFHack caches require()'d modules, so after editing a companion you must
// reload it in the DFHack console before this script sees the change:
//   :lua for _,m in ipairs({'rpc.legends','rpc.jobs','rpc.units'}) do package.loaded[m]=nil end

import { readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { callRpc, disconnectClient } from "../build/dfhack/client.js";

const here = dirname(fileURLToPath(import.meta.url));
const luaRpcDir = join(here, "..", "lua", "rpc");

// Companions this checkout ships → their rpc.<name> module ids.
const modules = readdirSync(luaRpcDir)
  .filter((f) => f.endsWith(".lua"))
  .map((f) => `rpc.${f.replace(/\.lua$/, "")}`)
  .sort();

const host = process.env.DFHACK_HOST ?? "127.0.0.1";
const port = process.env.DFHACK_PORT ?? "5000";

function isConnectionError(err) {
  const m = String(err?.message ?? err);
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|socket|connect/i.test(m);
}

let failures = 0;
console.log(`Smoke-testing ${modules.length} companion(s) against DFHack ${host}:${port}\n`);

for (const module of modules) {
  try {
    const res = await callRpc("RunLua", { module, function: "ping", arguments: [] });
    const payload = res?.value?.[0];
    const env = payload ? JSON.parse(payload) : null;
    if (env?.ok) {
      console.log(`  OK   ${module.padEnd(14)} ready (schema ${env.data?.schema}, dfhack ${env.data?.dfhack})`);
    } else {
      console.log(`  FAIL ${module.padEnd(14)} responded but ok=false: ${env?.error ?? payload}`);
      failures++;
    }
  } catch (err) {
    if (isConnectionError(err)) {
      console.log(`\nDFHack not reachable on ${host}:${port}. Start DF + DFHack (with a fort/adventurer loaded) to smoke-test. Skipping.`);
      disconnectClient();
      process.exit(0);
    }
    // A per-module RPC failure (CR_FAILURE/CR_NOT_FOUND) = not installed, not
    // loaded, or the module raised during load. Report, keep going.
    console.log(`  FAIL ${module.padEnd(14)} missing / not-loaded (${err?.message ?? err})`);
    failures++;
  }
}

disconnectClient();
console.log(`\n${modules.length - failures}/${modules.length} companion(s) ready.`);
process.exit(failures > 0 ? 1 : 0);
