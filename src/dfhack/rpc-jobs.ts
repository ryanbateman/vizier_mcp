// Wrapper around the `rpc.jobs` Lua companion script (lua/rpc/jobs.lua),
// which surfaces the fortress job queue and the two reversible job-management
// writes (prioritise / suspend). Built on the generic callRpcModule helper.

import { callRpcModule } from "./rpc-module.js";

export const JOBS_MODULE = "rpc.jobs";
export const JOBS_SCHEMA = 2;

/** Thrown when the rpc.jobs companion can't be reached. */
export class JobsScriptMissingError extends Error {
  constructor() {
    super(
      `The rpc/jobs Lua companion module is not installed or could not be ` +
        `reached. Install it from <vizier-mcp>/lua/rpc/jobs.lua to ` +
        `<DF install>/hack/lua/rpc/jobs.lua (or run ` +
        `\`npx @ryanbateman/vizier-mcp install-companion\`), then ensure ` +
        `VIZIER_ENABLE_RUN_LUA=1 is set. See jobs_setup_check for full ` +
        `install instructions.`,
    );
    this.name = "JobsScriptMissingError";
  }
}

/** Call a function on the rpc.jobs module and decode its JSON envelope. */
export async function callJobs<T>(fn: string, args: string[] = []): Promise<T> {
  return callRpcModule<T>(
    JOBS_MODULE,
    fn,
    args,
    () => new JobsScriptMissingError(),
  );
}

/** Probe whether the companion is reachable; returns its schema version. */
export async function pingJobs(): Promise<{ schema: number; dfhack?: string }> {
  return await callJobs<{ schema: number; dfhack?: string }>("ping");
}
