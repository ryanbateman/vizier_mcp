import { describe, it, expect } from "vitest";
import { buildWorkforceReport } from "../src/workforce.js";

function unit(
  englishName: string,
  professionName: string,
  skills: Array<{ name: string; level: number }> = [],
): any {
  // Fixtures only need englishName for distinguishing units in assertions;
  // the resolver passes the full structured name through verbatim.
  return {
    name: { englishName },
    professionName,
    skills,
  };
}

describe("buildWorkforceReport", () => {
  it("builds the profession histogram", () => {
    const report = buildWorkforceReport([
      unit("A", "Miner"),
      unit("B", "Miner"),
      unit("C", "Carpenter"),
    ]);
    expect(report.total).toBe(3);
    expect(report.byProfession).toEqual({ Miner: 2, Carpenter: 1 });
  });

  it("flags an underused legend (legendary skill outside their role)", () => {
    const report = buildWorkforceReport([
      unit("Waywardpillar", "Planter", [
        { name: "Poetry", level: 18 },
        { name: "Growing", level: 2 },
      ]),
    ]);
    expect(report.underusedLegends).toEqual([
      {
        name: { englishName: "Waywardpillar" },
        skill: "Poetry",
        level: 18,
        expectedProfession: "(no canonical role)",
        actualProfession: "Planter",
      },
    ]);
    expect(report.mismatches).toEqual([]); // legends don't double up
  });

  it("flags a mismatch when top skill beats the aligned skill by the delta", () => {
    const report = buildWorkforceReport([
      unit("Waywardpillar", "Planter", [
        { name: "Poetry", level: 7 },
        { name: "Growing", level: 2 },
      ]),
    ]);
    expect(report.mismatches).toEqual([
      {
        name: { englishName: "Waywardpillar" },
        profession: "Planter",
        topSkill: { name: "Poetry", level: 7 },
        alignedSkill: { name: "Growing", level: 2 },
      },
    ]);
  });

  it("does not flag a mismatch when the aligned skill is close to the top", () => {
    const report = buildWorkforceReport([
      unit("Aligned", "Planter", [
        { name: "Poetry", level: 6 },
        { name: "Growing", level: 5 },
      ]),
    ]);
    expect(report.mismatches).toEqual([]);
    // Nor is it idle: top skill is 6 (>= default idle threshold of 5).
    expect(report.idleGeneralists).toEqual([]);
  });

  it("flags idle generalists when no skill reaches the threshold", () => {
    const report = buildWorkforceReport([
      unit("Searchcrafted", "Mason", [{ name: "Dance", level: 3 }]),
    ]);
    expect(report.idleGeneralists).toEqual([
      {
        name: { englishName: "Searchcrafted" },
        profession: "Mason",
        topSkill: { name: "Dance", level: 3 },
      },
    ]);
  });

  it("recognises aligned legends as just-doing-their-job (no flags)", () => {
    const report = buildWorkforceReport([
      unit("Channelboar", "Miner", [{ name: "Mining", level: 17 }]),
    ]);
    expect(report.underusedLegends).toEqual([]);
    expect(report.mismatches).toEqual([]);
    expect(report.idleGeneralists).toEqual([]);
    expect(report.skillTop["Mining"]).toEqual({
      name: { englishName: "Channelboar" },
      level: 17,
    });
  });

  it("skips roles with no canonical craft skill (Trader/Child/Peasant)", () => {
    const report = buildWorkforceReport([
      unit("Visitor", "Trader", [{ name: "Persuasion", level: 4 }]),
      unit("Kid", "Child"),
      unit("Roving", "Peasant"),
    ]);
    expect(report.mismatches).toEqual([]);
    expect(report.idleGeneralists).toEqual([]);
    expect(report.uncategorisedRoles).toEqual(
      ["Child", "Peasant", "Trader"].sort(),
    );
  });

  it("tracks single best practitioner per skill across the fort", () => {
    const report = buildWorkforceReport([
      unit("A", "Miner", [{ name: "Mining", level: 10 }]),
      unit("B", "Miner", [{ name: "Mining", level: 17 }]),
      unit("C", "Carpenter", [{ name: "Carpentry", level: 12 }]),
    ]);
    expect(report.skillTop["Mining"]).toEqual({
      name: { englishName: "B" },
      level: 17,
    });
    expect(report.skillTop["Carpentry"]).toEqual({
      name: { englishName: "C" },
      level: 12,
    });
  });

  it("honors threshold overrides", () => {
    const report = buildWorkforceReport(
      [unit("X", "Mason", [{ name: "Engraving", level: 8 }, { name: "Masonry", level: 7 }])],
      { mismatchDelta: 5 },
    );
    // Delta is 1; mismatchDelta=5 → no flag.
    expect(report.mismatches).toEqual([]);
  });
});
