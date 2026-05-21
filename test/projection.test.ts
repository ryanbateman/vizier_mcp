import { describe, it, expect } from "vitest";
import { projectUnits } from "../src/projection.js";

function makeUnit(overrides: Record<string, unknown> = {}): any {
  return {
    unitId: 1,
    name: { firstName: "shorast", englishName: "Waywardpillar" },
    profession: 13,
    professionName: "Planter",
    gender: 1,
    genderName: "Male",
    race: 572,
    raceName: "dwarf",
    flags1: 0b101,
    flags1Names: ["dead", "skeleton"],
    flags2: 0,
    flags2Names: [],
    flags3: 0,
    flags3Names: [],
    skills: [
      { id: 117, level: 7, experience: 1000, name: "Poetry", nameNoun: "Poet" },
      { id: 2, level: 3, experience: 100, name: "Mining", nameNoun: "Miner" },
    ],
    labors: [
      { id: 0, name: "Mining" },
      { id: 11, name: "Carpentry" },
    ],
    posX: 100,
    posY: 100,
    posZ: 165,
    ...overrides,
  };
}

describe("projectUnits — default (trim)", () => {
  it("drops raw flag ints when *Names are present", () => {
    const [u] = projectUnits([makeUnit()]) as any[];
    expect(u.flags1).toBeUndefined();
    expect(u.flags2).toBeUndefined();
    expect(u.flags3).toBeUndefined();
    expect(u.flags1Names).toEqual(["dead", "skeleton"]);
  });

  it("trims skills to { name, level } only", () => {
    const [u] = projectUnits([makeUnit()]) as any[];
    expect(u.skills).toEqual([
      { name: "Poetry", level: 7 },
      { name: "Mining", level: 3 },
    ]);
  });

  it("trims labors to { name } only", () => {
    const [u] = projectUnits([makeUnit()]) as any[];
    expect(u.labors).toEqual([{ name: "Mining" }, { name: "Carpentry" }]);
  });

  it("keeps resolved name fields and position", () => {
    const [u] = projectUnits([makeUnit()]) as any[];
    expect(u.professionName).toBe("Planter");
    expect(u.raceName).toBe("dwarf");
    expect(u.genderName).toBe("Male");
    expect(u.posZ).toBe(165);
  });

  it("does not mutate the input array", () => {
    const u = makeUnit();
    projectUnits([u]);
    expect(u.flags1).toBe(0b101);
    expect(u.skills[0].nameNoun).toBe("Poet");
  });
});

describe("projectUnits — summary", () => {
  it("returns roster shape with top skill and structured name", () => {
    const [s] = projectUnits([makeUnit()], { summary: true }) as any[];
    expect(s).toEqual({
      id: 1,
      name: { firstName: "shorast", englishName: "Waywardpillar" },
      raceName: "dwarf",
      professionName: "Planter",
      topSkill: { name: "Poetry", level: 7 },
    });
  });

  it("topSkill is null when unit has no skills", () => {
    const [s] = projectUnits([makeUnit({ skills: undefined })], {
      summary: true,
    }) as any[];
    expect(s.topSkill).toBeNull();
  });

  it("passes the full structured name through (no collapse to a single string)", () => {
    const [s] = projectUnits(
      [makeUnit({
        name: {
          firstName: "Bëmbul",
          lastName: "Fikodad",
          englishName: "Glazesuns",
        },
      })],
      { summary: true },
    ) as any[];
    expect(s.name).toEqual({
      firstName: "Bëmbul",
      lastName: "Fikodad",
      englishName: "Glazesuns",
    });
  });

  it("summary wins over verbose when both passed", () => {
    const [s] = projectUnits([makeUnit()], { summary: true, verbose: true }) as any[];
    expect(s.topSkill).toEqual({ name: "Poetry", level: 7 });
    expect((s as any).flags1).toBeUndefined();
  });
});

describe("projectUnits — verbose", () => {
  it("preserves raw flag ints and full skill entries", () => {
    const [u] = projectUnits([makeUnit()], { verbose: true }) as any[];
    expect(u.flags1).toBe(0b101);
    expect(u.skills[0].nameNoun).toBe("Poet");
    expect(u.skills[0].experience).toBe(1000);
  });
});
