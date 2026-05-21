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

  it("rejects names that don't match any allowed pattern", () => {
    // One example per rejection reason. Enumerating every built-in name
    // tests the regex's negative space, not behaviour.
    expect(isValidRpcModule("dfhack.units")).toBe(false); // not rpc.* / *.rpc / *-rpc
    expect(isValidRpcModule("utils")).toBe(false);        // no prefix/suffix marker
  });

  it("rejects names DFHack itself would reject as too short (length <= 4)", () => {
    expect(isValidRpcModule("")).toBe(false);    // empty
    expect(isValidRpcModule("rpc.")).toBe(false); // exactly length 4, no module body
  });
});
