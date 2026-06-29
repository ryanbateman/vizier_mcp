import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "fs";
import { join, sep } from "path";
import { tmpdir } from "os";
import { install, type InstalledFile } from "../src/install-companion.js";

// Stage a temporary directory that mimics a real DF/DFHack install
// (it just needs `hack/lua/rpc/` to exist for validateDfInstall to pass).
function stageFakeDf(): string {
  const root = mkdtempSync(join(tmpdir(), "vizier-install-test-"));
  mkdirSync(join(root, "hack", "lua", "rpc"), { recursive: true });
  return root;
}

function byName(files: InstalledFile[], name: string): InstalledFile {
  const f = files.find((x) => x.name === name);
  if (!f) throw new Error(`expected ${name} in install result, got ${files.map((x) => x.name).join(", ")}`);
  return f;
}

describe("install-companion install()", () => {
  let df: string;
  afterEach(() => {
    if (df && existsSync(df)) rmSync(df, { recursive: true, force: true });
  });

  it("dry-run reports every bundled companion without writing", () => {
    df = stageFakeDf();
    const result = install(df, { dryRun: true });
    expect(result.dryRun).toBe(true);
    // Both shipped companions are present.
    const legends = byName(result.files, "legends.lua");
    const jobs = byName(result.files, "jobs.lua");
    expect(legends.destination).toBe(join(df, "hack", "lua", "rpc", "legends.lua"));
    expect(jobs.destination).toBe(join(df, "hack", "lua", "rpc", "jobs.lua"));
    // Sources point at the bundled lua/rpc/ dir (cross-platform: compare tail).
    expect(legends.source.endsWith(join("lua", "rpc", "legends.lua"))).toBe(true);
    expect(jobs.source.endsWith(join("lua", "rpc", "jobs.lua"))).toBe(true);
    // Nothing written.
    for (const f of result.files) expect(existsSync(f.destination)).toBe(false);
  });

  it("copies every bundled lua module into hack/lua/rpc/", () => {
    df = stageFakeDf();
    const result = install(df);
    expect(result.dryRun).toBe(false);
    for (const f of result.files) {
      expect(f.overwrote).toBe(false);
      expect(existsSync(f.destination)).toBe(true);
    }
    // Spot-check each module is the real one by its mkmodule anchor.
    expect(readFileSync(byName(result.files, "legends.lua").destination, "utf-8"))
      .toContain("mkmodule('rpc.legends')");
    expect(readFileSync(byName(result.files, "jobs.lua").destination, "utf-8"))
      .toContain("mkmodule('rpc.jobs')");
  });

  it("refuses to overwrite an existing companion without --force", () => {
    df = stageFakeDf();
    const dest = join(df, "hack", "lua", "rpc", "legends.lua");
    writeFileSync(dest, "-- pre-existing\n", "utf-8");
    expect(() => install(df)).toThrow(/already exists/);
    // Original content should be untouched.
    expect(readFileSync(dest, "utf-8")).toBe("-- pre-existing\n");
  });

  it("overwrites with --force and reports overwrote=true", () => {
    df = stageFakeDf();
    const dest = join(df, "hack", "lua", "rpc", "legends.lua");
    writeFileSync(dest, "-- pre-existing\n", "utf-8");
    const result = install(df, { force: true });
    expect(byName(result.files, "legends.lua").overwrote).toBe(true);
    const after = readFileSync(dest, "utf-8");
    expect(after).not.toBe("-- pre-existing\n");
    expect(after).toContain("mkmodule('rpc.legends')");
  });

  it("creates hack/lua/rpc/ when only hack/lua exists (fresh DFHack)", () => {
    // A fresh DFHack ships hack/lua but not hack/lua/rpc until an rpc.* module
    // is installed. install() should create the rpc dir and copy into it.
    df = mkdtempSync(join(tmpdir(), "vizier-install-test-fresh-"));
    mkdirSync(join(df, "hack", "lua"), { recursive: true });
    expect(existsSync(join(df, "hack", "lua", "rpc"))).toBe(false);
    const result = install(df);
    expect(existsSync(join(df, "hack", "lua", "rpc"))).toBe(true);
    for (const f of result.files) expect(existsSync(f.destination)).toBe(true);
  });

  it("rejects a path that doesn't exist", () => {
    expect(() => install(`${sep}nonexistent${sep}path${sep}zzz`)).toThrow(/does not exist/);
  });

  it("rejects a path that exists but lacks hack/lua/rpc/", () => {
    df = mkdtempSync(join(tmpdir(), "vizier-install-test-empty-"));
    expect(() => install(df)).toThrow(/not a DFHack-having install/);
  });
});
