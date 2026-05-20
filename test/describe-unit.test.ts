import { describe, it, expect } from "vitest";
import { buildUnitDescription } from "../src/describe-unit.js";

function rfrUnit(over: Record<string, unknown> = {}): any {
  return {
    id: 238,
    name: "Channelboar",
    professionId: 0,
    noblePositions: [],
    posX: 61,
    posY: 23,
    posZ: 165,
    age: 132,
    isSoldier: false,
    sizeInfo: { sizeBase: 60000, sizeCur: 60000 },
    appearance: { physicalDescription: "He is brawny." },
    bloodCount: 200,
    bloodMax: 200,
    wounds: [],
    inventory: [
      {
        item: {
          materialName: "Iron",
          typeName: "WEAPON:ITEM_WEAPON_PICK",
        },
        mode: 2,
        bodyPartId: 5,
      },
    ],
    raceName: "dwarf",
    ...over,
  };
}

function coreUnit(over: Record<string, unknown> = {}): any {
  return {
    unitId: 238,
    name: {
      firstName: "mafol",
      lastName: "Cattendùstik",
      englishName: "Channelboar",
    },
    profession: 0,
    professionName: "Miner",
    genderName: "Male",
    raceName: "dwarf",
    skills: [
      { name: "Mining", level: 17, id: 0 },
      { name: "Masonry", level: 5, id: 2 },
      { name: "Carpentry", level: 0, id: 3 },
    ],
    labors: [
      { id: 0, name: "Mining" },
      { id: 11, name: "Carpentry" },
    ],
    ...over,
  };
}

describe("buildUnitDescription — RFR + Core join", () => {
  it("assembles the full bundle when both sides are present", () => {
    const d = buildUnitDescription(rfrUnit(), coreUnit());
    expect(d.id).toBe(238);
    expect(d.name.englishName).toBe("Channelboar");
    expect(d.name.firstName).toBe("mafol");
    expect(d.raceName).toBe("dwarf");
    expect(d.genderName).toBe("Male");
    expect(d.age).toBe(132);
    expect(d.profession).toEqual({ id: 0, name: "Miner" });
    expect(d.position).toEqual({ x: 61, y: 23, z: 165 });
    expect(d.body.description).toBe("He is brawny.");
    expect(d.body.isSoldier).toBe(false);
    expect(d.health.bloodCount).toBe(200);
    expect(d.health.wounds).toEqual([]);
    expect(d.health.woundNote).toBeUndefined();
    expect(d.skills.top[0]).toEqual({ name: "Mining", level: 17 });
    expect(d.skills.trainedCount).toBe(2); // Mining + Masonry have level > 0
    expect(d.skills.totalCount).toBe(3);
    expect(d.labors).toEqual(["Mining", "Carpentry"]);
    expect(d.inventory).toHaveLength(1);
    expect(d.notVisible).toContain("current job (idle / mining / hauling)");
  });

  it("falls back to RFR name string when Core is missing", () => {
    const d = buildUnitDescription(rfrUnit(), undefined);
    expect(d.name).toEqual({ englishName: "Channelboar" });
    expect(d.skills.top).toEqual([]);
    expect(d.labors).toEqual([]);
  });

  it("works with only Core data (no RFR)", () => {
    const d = buildUnitDescription(undefined, coreUnit());
    expect(d.id).toBe(238);
    expect(d.name.englishName).toBe("Channelboar");
    expect(d.skills.top[0]).toEqual({ name: "Mining", level: 17 });
    expect(d.inventory).toEqual([]);
  });

  it("annotates wounds with the body-part resolution caveat", () => {
    const d = buildUnitDescription(
      rfrUnit({
        wounds: [
          { parts: [{ bodyPartId: 5, globalLayerIdx: 1, layerIdx: 0 }], severedPart: false },
        ],
      }),
      coreUnit(),
    );
    expect(d.health.wounds).toHaveLength(1);
    expect(d.health.wounds[0].parts[0].bodyPartId).toBe(5);
    expect(d.health.woundNote).toMatch(/body-part ids/i);
  });

  it("respects topSkills option", () => {
    const skills = Array.from({ length: 20 }, (_, i) => ({
      name: `Skill${i}`,
      level: 20 - i,
    }));
    const d = buildUnitDescription(
      rfrUnit(),
      coreUnit({ skills }),
      { topSkills: 3 },
    );
    expect(d.skills.top).toHaveLength(3);
    expect(d.skills.top[0].level).toBe(20);
    expect(d.skills.top[2].level).toBe(18);
  });
});
