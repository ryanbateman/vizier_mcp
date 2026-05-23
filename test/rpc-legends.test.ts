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
  callLegends,
  ScriptMissingError,
  LegendsError,
  pingLegends,
} from "../src/dfhack/rpc-legends.js";
import { DFHackRPCError } from "../src/dfhack/client.js";
import { CR_NOT_FOUND, CR_FAILURE, CR_WRONG_USAGE } from "../src/dfhack/codec.js";

beforeEach(() => {
  callRpcMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("callLegends", () => {
  it("unwraps a successful JSON envelope and returns data", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { counts: { figures: 42 } } })],
    });
    const r = await callLegends<{ counts: { figures: number } }>("get_overview");
    expect(r.counts.figures).toBe(42);
    expect(callRpcMock).toHaveBeenCalledWith("RunLua", {
      module: "rpc.legends",
      function: "get_overview",
      arguments: [],
    });
  });

  it("passes through string arguments", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { id: 5 } })],
    });
    await callLegends("describe_historical_figure", ["5"]);
    expect(callRpcMock.mock.calls[0]?.[1]).toMatchObject({
      arguments: ["5"],
    });
  });

  it("throws ScriptMissingError on CR_NOT_FOUND", async () => {
    callRpcMock.mockRejectedValue(
      new DFHackRPCError("not found", "RunLua", CR_NOT_FOUND),
    );
    await expect(callLegends("ping")).rejects.toBeInstanceOf(ScriptMissingError);
  });

  it("throws ScriptMissingError on CR_WRONG_USAGE (module-name gate)", async () => {
    callRpcMock.mockRejectedValue(
      new DFHackRPCError("wrong usage", "RunLua", CR_WRONG_USAGE),
    );
    await expect(callLegends("ping")).rejects.toBeInstanceOf(ScriptMissingError);
  });

  it("throws ScriptMissingError on CR_FAILURE (Lua load error)", async () => {
    callRpcMock.mockRejectedValue(
      new DFHackRPCError("failure", "RunLua", CR_FAILURE),
    );
    await expect(callLegends("ping")).rejects.toBeInstanceOf(ScriptMissingError);
  });

  it("rethrows other DFHackRPCError codes verbatim", async () => {
    const err = new DFHackRPCError("link failure", "RunLua", -3);
    callRpcMock.mockRejectedValue(err);
    await expect(callLegends("ping")).rejects.toBe(err);
  });

  it("throws LegendsError when the envelope reports ok=false", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: false, error: "not found: 999" })],
    });
    await expect(callLegends("describe_historical_figure", ["999"]))
      .rejects.toThrow(/not found: 999/);
  });

  it("throws LegendsError on empty response (missing function)", async () => {
    callRpcMock.mockResolvedValue({ value: [] });
    await expect(callLegends("ping")).rejects.toThrow(/empty response/);
  });

  it("throws LegendsError when payload is not JSON", async () => {
    callRpcMock.mockResolvedValue({ value: ["not json at all"] });
    await expect(callLegends("ping")).rejects.toThrow(/non-JSON output/);
  });

  it("throws LegendsError when ok=true but data missing", async () => {
    callRpcMock.mockResolvedValue({ value: [JSON.stringify({ ok: true })] });
    await expect(callLegends("ping")).rejects.toThrow(/no data/);
  });
});

describe("pingLegends", () => {
  it("returns schema + dfhack version on success", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { schema: 1, dfhack: "50.13" } })],
    });
    const r = await pingLegends();
    expect(r.schema).toBe(1);
    expect(r.dfhack).toBe("50.13");
  });

  it("surfaces ScriptMissingError when the module isn't installed", async () => {
    callRpcMock.mockRejectedValue(
      new DFHackRPCError("not found", "RunLua", CR_NOT_FOUND),
    );
    await expect(pingLegends()).rejects.toBeInstanceOf(ScriptMissingError);
  });
});
