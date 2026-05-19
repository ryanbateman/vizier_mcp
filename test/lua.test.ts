import { describe, it, expect } from "vitest";
import { isValidRpcModule } from "../src/tools/lua.js";

describe("isValidRpcModule", () => {
  it("accepts rpc.* names", () => {
    expect(isValidRpcModule("rpc.mymodule")).toBe(true);
    expect(isValidRpcModule("rpc.a")).toBe(true);
  });

  it("accepts *.rpc and *-rpc names", () => {
    expect(isValidRpcModule("mymodule.rpc")).toBe(true);
    expect(isValidRpcModule("my-rpc")).toBe(true);
    expect(isValidRpcModule("a.rpc")).toBe(true);
  });

  it("rejects built-in / arbitrary modules", () => {
    expect(isValidRpcModule("dfhack.units")).toBe(false);
    expect(isValidRpcModule("df.global")).toBe(false);
    expect(isValidRpcModule("dfhack.maps")).toBe(false);
    expect(isValidRpcModule("utils")).toBe(false);
  });

  it("rejects empty and too-short names (DFHack requires length > 4)", () => {
    expect(isValidRpcModule("")).toBe(false);
    expect(isValidRpcModule("rpc")).toBe(false);
    expect(isValidRpcModule("rpc.")).toBe(false);
    expect(isValidRpcModule(".rpc")).toBe(false);
  });
});
