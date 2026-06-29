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
  callUnits,
  pingUnits,
  UnitsScriptMissingError,
} from "../src/dfhack/rpc-units.js";
import { RpcModuleError } from "../src/dfhack/rpc-module.js";
import { DFHackRPCError } from "../src/dfhack/client.js";
import { CR_NOT_FOUND, CR_FAILURE, CR_WRONG_USAGE } from "../src/dfhack/codec.js";

beforeEach(() => {
  callRpcMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("callUnits", () => {
  it("unwraps a successful envelope and targets the rpc.units module", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { unitId: 10058, nickname: "Urist" } })],
    });
    const r = await callUnits<{ nickname: string }>("set_nickname", ["10058", "Urist"]);
    expect(r.nickname).toBe("Urist");
    expect(callRpcMock).toHaveBeenCalledWith("RunLua", {
      module: "rpc.units",
      function: "set_nickname",
      arguments: ["10058", "Urist"],
    });
  });

  it("throws UnitsScriptMissingError on CR_NOT_FOUND / CR_WRONG_USAGE / CR_FAILURE", async () => {
    for (const code of [CR_NOT_FOUND, CR_WRONG_USAGE, CR_FAILURE]) {
      callRpcMock.mockRejectedValueOnce(
        new DFHackRPCError("missing", "RunLua", code),
      );
      await expect(callUnits("ping")).rejects.toBeInstanceOf(UnitsScriptMissingError);
    }
  });

  it("rethrows other DFHackRPCError codes verbatim", async () => {
    const err = new DFHackRPCError("link failure", "RunLua", -3);
    callRpcMock.mockRejectedValue(err);
    await expect(callUnits("ping")).rejects.toBe(err);
  });

  it("throws RpcModuleError when the envelope reports ok=false", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: false, error: "unit not found: 999" })],
    });
    await expect(callUnits("set_nickname", ["999", "x"]))
      .rejects.toBeInstanceOf(RpcModuleError);
    await expect(callUnits("set_nickname", ["999", "x"]))
      .rejects.toThrow(/unit not found: 999/);
  });
});

describe("pingUnits", () => {
  it("returns schema + dfhack version on success", async () => {
    callRpcMock.mockResolvedValue({
      value: [JSON.stringify({ ok: true, data: { schema: 1, dfhack: "53.15" } })],
    });
    const r = await pingUnits();
    expect(r.schema).toBe(1);
    expect(r.dfhack).toBe("53.15");
  });

  it("surfaces UnitsScriptMissingError when the module isn't installed", async () => {
    callRpcMock.mockRejectedValue(
      new DFHackRPCError("not found", "RunLua", CR_NOT_FOUND),
    );
    await expect(pingUnits()).rejects.toBeInstanceOf(UnitsScriptMissingError);
  });
});
