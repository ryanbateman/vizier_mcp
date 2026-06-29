import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { jsonResult, errorResult } from "./helpers.js";
import {
  callJobs,
  pingJobs,
  JOBS_SCHEMA,
  JobsScriptMissingError,
} from "../dfhack/rpc-jobs.js";

const INSTALL_INSTRUCTIONS = [
  "The jobs tools rely on a tiny Lua companion script that lives inside",
  "DFHack — the fortress job queue is not reachable over the typed",
  "RemoteFortressReader socket, so Vizier MCP needs this companion (the same",
  "mechanism as the legends tools).",
  "",
  "Install:",
  "  1. Copy lua/rpc/jobs.lua from the Vizier MCP repo to:",
  "       <DF install>/hack/lua/rpc/jobs.lua",
  "     (or run `npx @ryanbateman/vizier-mcp install-companion`, which",
  "     installs every bundled companion).",
  "  2. Ensure VIZIER_ENABLE_RUN_LUA=1 is set in the environment that runs",
  "     vizier-mcp.",
  "  3. For the write tools (set_job_priority, set_job_suspended) also set",
  "     VIZIER_ENABLE_ACTIONS=1 — they stay unregistered otherwise.",
  "  4. Restart Vizier MCP if it was already running, then re-run",
  "     jobs_setup_check to confirm.",
].join("\n");

const RUN_LUA_NOTE =
  " Requires VIZIER_ENABLE_RUN_LUA=1 and the rpc/jobs.lua companion module. " +
  "If the tool reports the script is missing, call jobs_setup_check for " +
  "install instructions.";

const ACTION_NOTE =
  " This is a reversible WRITE action (it flips a single job flag) and is " +
  "only registered when VIZIER_ENABLE_ACTIONS=1. Wrapped in dfhack.with_suspend " +
  "for a consistent game state.";

/**
 * Map a thrown error from a jobs companion call to a tool result: surface a
 * missing companion as a structured hint pointing at jobs_setup_check, and
 * everything else as a plain error. Mirrors the legends error mapper.
 */
function jobsError(err: unknown) {
  if (err instanceof JobsScriptMissingError) {
    return jsonResult({
      status: "missing",
      message: err.message,
      hint: "Call jobs_setup_check for install instructions.",
    });
  }
  return errorResult(err);
}

/**
 * Register the job-management tools. Read tools (jobs_setup_check, list_jobs)
 * always register so the discovery path is reachable; the write tools register
 * only when `actionsEnabled` (VIZIER_ENABLE_ACTIONS) is set.
 */
export function registerJobTools(
  server: McpServer,
  options: { actionsEnabled: boolean },
) {
  server.tool(
    "jobs_setup_check",
    "Diagnostic for the jobs-access companion script. Probes whether the " +
      "rpc.jobs Lua module is installed and callable, and returns install " +
      "instructions if not. Call this first if list_jobs or a set_job_* tool " +
      "reports a missing script.",
    {},
    async () => {
      try {
        const result = await pingJobs();
        const schemaMatch = result.schema === JOBS_SCHEMA;
        return jsonResult({
          status: schemaMatch ? "ready" : "schema_mismatch",
          installedSchema: result.schema,
          expectedSchema: JOBS_SCHEMA,
          dfhackVersion: result.dfhack,
          actionsEnabled: options.actionsEnabled,
          message: schemaMatch
            ? "rpc.jobs companion is installed and reachable." +
              (options.actionsEnabled
                ? ""
                : " Write tools are disabled (set VIZIER_ENABLE_ACTIONS=1 to enable).")
            : `rpc.jobs schema ${result.schema} does not match expected ${JOBS_SCHEMA}. ` +
              `Update lua/rpc/jobs.lua from the latest Vizier MCP repo.`,
        });
      } catch (err) {
        if (err instanceof JobsScriptMissingError) {
          return jsonResult({
            status: "missing",
            message: err.message,
            installInstructions: INSTALL_INSTRUCTIONS,
          });
        }
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_jobs",
    "List the fortress job queue: each active job's type, assigned worker, " +
      "holding building, position, and its do_now (prioritised) and suspended " +
      "flags. df-internal special jobs are skipped by default; pass " +
      "include_special:true to include them. Read-only." +
      RUN_LUA_NOTE,
    {
      include_special: z
        .boolean()
        .optional()
        .describe("Include df-internal special jobs (default: false)"),
    },
    async ({ include_special }) => {
      try {
        const data = await callJobs<unknown>(
          "list_jobs",
          include_special ? ["all"] : [],
        );
        return jsonResult(data);
      } catch (err) {
        return jobsError(err);
      }
    },
  );

  if (!options.actionsEnabled) return;

  server.tool(
    "set_job_priority",
    "Prioritise (or un-prioritise) a job by setting its do_now flag — the " +
      "same boost DFHack's do-job-now / prioritize use to push a job to the " +
      "front of the queue. Find job ids via list_jobs." +
      ACTION_NOTE +
      RUN_LUA_NOTE,
    {
      job_id: z.number().int().describe("Job id (from list_jobs)"),
      on: z
        .boolean()
        .optional()
        .describe("Set do_now true to prioritise, false to clear (default: true)"),
    },
    async ({ job_id, on }) => {
      try {
        const data = await callJobs<unknown>("set_job_priority", [
          String(job_id),
          String(on ?? true),
        ]);
        return jsonResult(data);
      } catch (err) {
        return jobsError(err);
      }
    },
  );

  server.tool(
    "set_job_suspended",
    "Suspend (or resume) a job by setting its suspend flag. A suspended job " +
      "stays in the queue but no worker picks it up until it is resumed. Find " +
      "job ids via list_jobs." +
      ACTION_NOTE +
      RUN_LUA_NOTE,
    {
      job_id: z.number().int().describe("Job id (from list_jobs)"),
      on: z
        .boolean()
        .optional()
        .describe("Set suspend true to suspend, false to resume (default: true)"),
    },
    async ({ job_id, on }) => {
      try {
        const data = await callJobs<unknown>("set_job_suspended", [
          String(job_id),
          String(on ?? true),
        ]);
        return jsonResult(data);
      } catch (err) {
        return jobsError(err);
      }
    },
  );
}
