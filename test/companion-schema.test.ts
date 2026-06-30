import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Each Lua companion declares a `schema` version in its ping(), and its TS
// wrapper declares a matching `<NAME>_SCHEMA` constant that *_setup_check
// compares against. The two are bumped by hand and trivially drift apart (a new
// companion function added to the .lua without bumping either side ships a
// silent schema lie). This test pins them together: for every lua/rpc/<name>.lua
// it asserts a src/dfhack/rpc-<name>.ts exists with a <NAME>_SCHEMA equal to the
// schema returned by the Lua ping().

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const luaRpcDir = join(repo, "lua", "rpc");
const dfhackDir = join(repo, "src", "dfhack");

const companions = readdirSync(luaRpcDir)
  .filter((f) => f.endsWith(".lua"))
  .map((f) => f.replace(/\.lua$/, ""));

describe("companion schema versions stay in sync (lua <-> ts)", () => {
  it("discovers at least one companion to check", () => {
    expect(companions.length).toBeGreaterThan(0);
  });

  for (const name of companions) {
    it(`${name}: lua ping schema matches ${name.toUpperCase()}_SCHEMA`, () => {
      const lua = readFileSync(join(luaRpcDir, `${name}.lua`), "utf-8");
      // The ping() function returns `schema = N`.
      const luaMatch = lua.match(/schema\s*=\s*(\d+)/);
      expect(luaMatch, `no \`schema = N\` found in ${name}.lua`).not.toBeNull();
      const luaSchema = Number(luaMatch![1]);

      const tsPath = join(dfhackDir, `rpc-${name}.ts`);
      const ts = readFileSync(tsPath, "utf-8");
      const constName = `${name.toUpperCase()}_SCHEMA`;
      const tsMatch = ts.match(new RegExp(`${constName}\\s*=\\s*(\\d+)`));
      expect(tsMatch, `no \`${constName} = N\` found in rpc-${name}.ts`).not.toBeNull();
      const tsSchema = Number(tsMatch![1]);

      expect(
        tsSchema,
        `${constName} (${tsSchema}) != ${name}.lua ping schema (${luaSchema}) — bump both when you change the companion`,
      ).toBe(luaSchema);
    });
  }
});
