// Generic wrapper around a Vizier `rpc.*` Lua companion module, generalising
// the pattern first established by rpc-legends.ts so additional companions
// (rpc.jobs, future action modules) don't each re-implement the envelope
// decode. A companion's Lua functions each return a single JSON string
// `{ ok, data | error }` (see lua/rpc/*.lua); callRpcModule unwraps that and
// distinguishes three failure modes:
//   1. Script not installed   → the caller-supplied `missing` error
//   2. Script raised an error → RpcModuleError with the message
//   3. Wire / DFHack error    → re-thrown DFHackRPCError (transport bug,
//                                module-name gate hit, etc.)
//
// rpc-legends.ts predates this helper and keeps its own copy for now; new
// modules should build on callRpcModule.

import { callRpc, DFHackRPCError } from "./client.js";
import { CR_NOT_FOUND, CR_FAILURE, CR_WRONG_USAGE } from "./codec.js";

interface StringListMessage {
  value?: string[];
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Raised when a companion function reports `{ ok = false, error }`. */
export class RpcModuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcModuleError";
  }
}

/**
 * Call `fn` on the Lua companion `module` (e.g. "rpc.jobs") and decode its
 * JSON envelope. `missing` builds the error thrown when the module can't be
 * reached (not installed, or RunLua disabled) so each caller can surface its
 * own install hint. Generic over the expected `data` shape.
 */
export async function callRpcModule<T>(
  module: string,
  fn: string,
  args: string[],
  missing: () => Error,
): Promise<T> {
  let result: StringListMessage;
  try {
    result = await callRpc<StringListMessage>("RunLua", {
      module,
      function: fn,
      arguments: args,
    });
  } catch (err) {
    if (err instanceof DFHackRPCError) {
      // CR_NOT_FOUND = module-name gate refused (RunLua not enabled or the
      // script literally isn't there). CR_WRONG_USAGE = bad module shape.
      // CR_FAILURE = Lua errored during load. All three boil down to "we
      // can't reach the companion script."
      if (
        err.code === CR_NOT_FOUND ||
        err.code === CR_WRONG_USAGE ||
        err.code === CR_FAILURE
      ) {
        throw missing();
      }
    }
    throw err;
  }

  const payload = result.value?.[0];
  if (!payload) {
    throw new RpcModuleError(
      `${module}.${fn} returned an empty response — the function may be ` +
        `missing from the installed script. Reinstall the companion from ` +
        `the Vizier MCP repo.`,
    );
  }

  let envelope: Envelope<T>;
  try {
    envelope = JSON.parse(payload) as Envelope<T>;
  } catch {
    throw new RpcModuleError(
      `${module}.${fn} returned non-JSON output: ${payload.slice(0, 200)}`,
    );
  }

  if (!envelope.ok) {
    throw new RpcModuleError(
      envelope.error ?? `${module}.${fn} reported an unspecified error`,
    );
  }
  if (envelope.data === undefined) {
    throw new RpcModuleError(`${module}.${fn} returned ok=true but no data`);
  }
  return envelope.data;
}
