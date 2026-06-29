// Wrapper around the `rpc.units` Lua companion script (lua/rpc/units.lua),
// which exposes the reversible unit write actions (nickname, custom
// profession, teleport). Built on the generic callRpcModule helper.

import { callRpcModule } from "./rpc-module.js";

export const UNITS_MODULE = "rpc.units";
export const UNITS_SCHEMA = 1;

/** Thrown when the rpc.units companion can't be reached. */
export class UnitsScriptMissingError extends Error {
  constructor() {
    super(
      `The rpc/units Lua companion module is not installed or could not be ` +
        `reached. Install it from <vizier-mcp>/lua/rpc/units.lua to ` +
        `<DF install>/hack/lua/rpc/units.lua (or run ` +
        `\`npx @ryanbateman/vizier-mcp install-companion\`), then ensure ` +
        `VIZIER_ENABLE_RUN_LUA=1 is set. See units_setup_check for full ` +
        `install instructions.`,
    );
    this.name = "UnitsScriptMissingError";
  }
}

/** Call a function on the rpc.units module and decode its JSON envelope. */
export async function callUnits<T>(
  fn: string,
  args: string[] = [],
): Promise<T> {
  return callRpcModule<T>(
    UNITS_MODULE,
    fn,
    args,
    () => new UnitsScriptMissingError(),
  );
}

/** Probe whether the companion is reachable; returns its schema version. */
export async function pingUnits(): Promise<{ schema: number; dfhack?: string }> {
  return await callUnits<{ schema: number; dfhack?: string }>("ping");
}
