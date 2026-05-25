import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { install } from "../src/install-companion.js";

// Stage a temporary directory that mimics a real DF/DFHack install
// (it just needs `hack/lua/rpc/` to exist for validateDfInstall to pass).
function stageFakeDf(): string {
  const root = mkdtempSync(join(tmpdir(), "vizier-install-test-"));
  mkdirSync(join(root, "hack", "lua", "rpc"), { recursive: true });
  return root;
}

describe("install-companion install()", () => {
  let df: string;
  afterEach(() => {
    if (df && existsSync(df)) rmSync(df, { recursive: true, force: true });
  });

  it("dry-run reports source + destination without writing", () => {
    df = stageFakeDf();
    const result = install(df, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.destination).toBe(join(df, "hack/lua/rpc/legends.lua"));
    expect(result.source).toMatch(/lua\/rpc\/legends\.lua$/);
    expect(existsSync(result.destination)).toBe(false);
  });

  it("copies the bundled lua module into hack/lua/rpc/", () => {
    df = stageFakeDf();
    const result = install(df);
    expect(result.dryRun).toBe(false);
    expect(result.overwrote).toBe(false);
    expect(existsSync(result.destination)).toBe(true);
    // The copied file should be the actual legends module — sanity-check
    // by looking for the `mkmodule('rpc.legends')` line that anchors it.
    const copied = readFileSync(result.destination, "utf-8");
    expect(copied).toContain("mkmodule('rpc.legends')");
  });

  it("refuses to overwrite an existing legends.lua without --force", () => {
    df = stageFakeDf();
    const dest = join(df, "hack/lua/rpc/legends.lua");
    writeFileSync(dest, "-- pre-existing\n", "utf-8");
    expect(() => install(df)).toThrow(/already exists/);
    // Original content should be untouched.
    expect(readFileSync(dest, "utf-8")).toBe("-- pre-existing\n");
  });

  it("overwrites with --force and reports overwrote=true", () => {
    df = stageFakeDf();
    const dest = join(df, "hack/lua/rpc/legends.lua");
    writeFileSync(dest, "-- pre-existing\n", "utf-8");
    const result = install(df, { force: true });
    expect(result.overwrote).toBe(true);
    const after = readFileSync(dest, "utf-8");
    expect(after).not.toBe("-- pre-existing\n");
    expect(after).toContain("mkmodule('rpc.legends')");
  });

  it("rejects a path that doesn't exist", () => {
    expect(() => install("/nonexistent/path/zzz")).toThrow(/does not exist/);
  });

  it("rejects a path that exists but lacks hack/lua/rpc/", () => {
    df = mkdtempSync(join(tmpdir(), "vizier-install-test-empty-"));
    expect(() => install(df)).toThrow(/not a DFHack-having install/);
  });
});
