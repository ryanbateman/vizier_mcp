// Wrapper around the `rpc.legends` Lua companion script. See
// lua/rpc/legends.lua and UNLOCKING-LEGENDS.md for what it exposes and why.
//
// Every Lua function returns `{ json.encode({ ok, data | error }) }` —
// i.e. a single-element string list carrying a JSON envelope. callLegends
// unwraps that, distinguishing three failure modes:
//   1. Script not installed   → ScriptMissingError
//   2. Script raised an error → LegendsError with the message
//   3. Wire / DFHack error    → re-thrown DFHackRPCError (transport bug,
//                                module-name gate hit, etc.)

import { callRpc, DFHackRPCError } from "./client.js";
import { CR_NOT_FOUND, CR_FAILURE, CR_WRONG_USAGE } from "./codec.js";

export const LEGENDS_MODULE = "rpc.legends";
export const LEGENDS_SCHEMA = 4;

interface StringListMessage {
  value?: string[];
}

interface LegendsEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export class ScriptMissingError extends Error {
  constructor() {
    super(
      `The rpc/legends Lua companion module is not installed or could not ` +
        `be reached. Install it from <vizier-mcp>/lua/rpc/legends.lua to ` +
        `<DF install>/hack/lua/rpc/legends.lua, then ensure ` +
        `VIZIER_ENABLE_RUN_LUA=1 is set. See legends_setup_check for full ` +
        `install instructions.`,
    );
    this.name = "ScriptMissingError";
  }
}

export class LegendsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegendsError";
  }
}

/**
 * Call a function on the rpc.legends Lua module and decode the JSON
 * envelope. Generic over the expected `data` shape. Throws
 * ScriptMissingError when the module isn't installed, LegendsError when
 * the script reports an error, or rethrows transport-level failures.
 */
export async function callLegends<T>(
  fn: string,
  args: string[] = [],
): Promise<T> {
  let result: StringListMessage;
  try {
    result = await callRpc<StringListMessage>("RunLua", {
      module: LEGENDS_MODULE,
      function: fn,
      arguments: args,
    });
  } catch (err) {
    if (err instanceof DFHackRPCError) {
      // CR_NOT_FOUND = module-name gate refused (RunLua not enabled or
      // the script literally isn't there). CR_WRONG_USAGE = bad module
      // shape. CR_FAILURE = Lua errored during load. All three boil down
      // to "we can't reach the companion script."
      if (
        err.code === CR_NOT_FOUND ||
        err.code === CR_WRONG_USAGE ||
        err.code === CR_FAILURE
      ) {
        throw new ScriptMissingError();
      }
    }
    throw err;
  }

  const payload = result.value?.[0];
  if (!payload) {
    throw new LegendsError(
      `rpc.legends.${fn} returned an empty response — the function may be ` +
        `missing from the installed script. Reinstall lua/rpc/legends.lua ` +
        `from the Vizier MCP repo.`,
    );
  }

  let envelope: LegendsEnvelope<T>;
  try {
    envelope = JSON.parse(payload) as LegendsEnvelope<T>;
  } catch {
    throw new LegendsError(
      `rpc.legends.${fn} returned non-JSON output: ${payload.slice(0, 200)}`,
    );
  }

  if (!envelope.ok) {
    throw new LegendsError(
      envelope.error ?? `rpc.legends.${fn} reported an unspecified error`,
    );
  }
  if (envelope.data === undefined) {
    throw new LegendsError(`rpc.legends.${fn} returned ok=true but no data`);
  }
  return envelope.data;
}

/**
 * Probe whether the companion script is reachable. Returns the schema
 * version if installed, throws ScriptMissingError otherwise.
 */
export async function pingLegends(): Promise<{
  schema: number;
  dfhack?: string;
}> {
  return await callLegends<{ schema: number; dfhack?: string }>("ping");
}
