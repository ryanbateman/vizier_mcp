import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callRpcMock = vi.fn();
vi.mock("../src/dfhack/client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/dfhack/client.js")>(
    "../src/dfhack/client.js",
  );
  return {
    ...actual,
    callRpc: (...args: unknown[]) => callRpcMock(...args),
  };
});

import {
  callJobs,
  pingJobs,
  JobsScriptMissingError,
} from "../src/dfhack/rpc-jobs.js";
import { RpcModuleError } from "../src/dfhack/rpc-module.js";
import { DFHackRPCError } from "../src/dfhack/client.js";
import { CR_NOT_FOUND, CR_FAILURE, CR_WRONG_USAGE } from "../src/dfhack/codec.js";

beforeEach(() => {
  callRpcMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("callJobs", () => {
  it("unwraps a successful envelope and targets the rpc.jobs module", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { jobs: [], total: 0 } })],
    });
    const r = await callJobs<{ total: number }>("list_jobs");
    expect(r.total).toBe(0);
    expect(callRpcMock).toHaveBeenCalledWith("RunLua", {
      module: "rpc.jobs",
      function: "list_jobs",
      arguments: [],
    });
  });

  it("passes through string arguments (job id + flag)", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { jobId: 7, doNow: true } })],
    });
    await callJobs("set_job_priority", ["7", "true"]);
    expect(callRpcMock.mock.calls[0]?.[1]).toMatchObject({
      arguments: ["7", "true"],
    });
  });

  it("throws JobsScriptMissingError on CR_NOT_FOUND / CR_WRONG_USAGE / CR_FAILURE", async () => {
    for (const code of [CR_NOT_FOUND, CR_WRONG_USAGE, CR_FAILURE]) {
      callRpcMock.mockRejectedValueOnce(
        new DFHackRPCError("missing", "RunLua", code),
      );
      await expect(callJobs("ping")).rejects.toBeInstanceOf(JobsScriptMissingError);
    }
  });

  it("rethrows other DFHackRPCError codes verbatim", async () => {
    const err = new DFHackRPCError("link failure", "RunLua", -3);
    callRpcMock.mockRejectedValue(err);
    await expect(callJobs("ping")).rejects.toBe(err);
  });

  it("throws RpcModuleError when the envelope reports ok=false", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: false, error: "job not found: 999" })],
    });
    await expect(callJobs("set_job_priority", ["999"]))
      .rejects.toBeInstanceOf(RpcModuleError);
    await expect(callJobs("set_job_priority", ["999"]))
      .rejects.toThrow(/job not found: 999/);
  });

  it("throws RpcModuleError on empty / non-JSON / dataless responses", async () => {
    callRpcMock.mockResolvedValue({ value: [] });
    await expect(callJobs("ping")).rejects.toThrow(/empty response/);
    callRpcMock.mockResolvedValue({ value: ["not json"] });
    await expect(callJobs("ping")).rejects.toThrow(/non-JSON output/);
    callRpcMock.mockResolvedValue({ value: [JSON.stringify({ ok: true })] });
    await expect(callJobs("ping")).rejects.toThrow(/no data/);
  });
});

describe("pingJobs", () => {
  it("returns schema + dfhack version on success", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { schema: 1, dfhack: "53.15" } })],
    });
    const r = await pingJobs();
    expect(r.schema).toBe(1);
    expect(r.dfhack).toBe("53.15");
  });

  it("surfaces JobsScriptMissingError when the module isn't installed", async () => {
    callRpcMock.mockRejectedValue(
      new DFHackRPCError("not found", "RunLua", CR_NOT_FOUND),
    );
    await expect(pingJobs()).rejects.toBeInstanceOf(JobsScriptMissingError);
  });
});
