import { describe, it, expect } from "vitest";
import {
  decodeFlags,
  resolveUnitNames,
  enrichInventory,
  type LookupTables,
} from "../src/enrichment.js";

function makeLookups(): LookupTables {
  return {
    profession: new Map([
      [99, { key: "PROF_WOODCUTTER", caption: "Woodcutter" }],
    ]),
    skill: new Map([
      [117, { key: "SKILL_MUSIC", caption: "Music", captionNoun: "Musician" }],
      [2, { key: "SKILL_MINING", caption: "Mining", captionNoun: "Miner" }],
    ]),
    labor: new Map([
      [11, { key: "LABOR_CARPENTRY", caption: "Carpentry" }],
      [0, { key: "LABOR_MINE", caption: "Mining" }],
    ]),
    unitFlags1: new Map([
      [0, "dead"],
      [1, "tame"],
      [3, "skeleton"],
    ]),
    unitFlags2: new Map([
      [0, "killed"],
    ]),
    unitFlags3: new Map([
      [1, "ghostly"],
    ]),
    deathInfoFlags: new Map([
      [0, "scuttle"],
      [2, "murder"],
    ]),
    material: new Map([
      ["0/5", "Iron"],
      ["3/2", "Oak wood"],
    ]),
    itemType: new Map([
      ["1/25", "WEAPON:ITEM_WEAPON_PICK"],
      ["26/1", "ARMOR:ITEM_ARMOR_HELM"],
    ]),
  };
}

describe("decodeFlags", () => {
  it("decodes multiple flags", () => {
    const map = new Map([[0, "dead"], [1, "tame"], [2, "wild"]]);
    const result = decodeFlags(0b011, map);
    expect(result).toEqual(["dead", "tame"]);
  });

  it("returns empty array for zero value", () => {
    const map = new Map([[0, "dead"]]);
    expect(decodeFlags(0, map)).toEqual([]);
  });

  it("skips unknown bit positions", () => {
    const map = new Map([[0, "dead"]]);
    const result = decodeFlags(0b101, map);
    expect(result).toEqual(["dead"]);
  });

  it("handles bit 31 in 32-bit range", () => {
    const map = new Map([[31, "high"]]);
    const result = decodeFlags(0x80000000, map);
    expect(result).toEqual(["high"]);
  });
});

describe("resolveUnitNames", () => {
  it("resolves profession name", () => {
    const lookups = makeLookups();
    const unit: any = { profession: 99 };
    resolveUnitNames(unit, lookups);
    expect(unit.professionName).toBe("Woodcutter");
  });

  it.each([
    [0, "Female"],
    [1, "Male"],
    [2, undefined],
  ])("resolves gender %d → %s", (gender, expected) => {
    const lookups = makeLookups();
    const unit: any = { gender };
    resolveUnitNames(unit, lookups);
    expect(unit.genderName).toBe(expected);
  });

  it("resolves flags1 names", () => {
    const lookups = makeLookups();
    const unit: any = { flags1: 0b1001 };
    resolveUnitNames(unit, lookups);
    expect(unit.flags1Names).toEqual(["dead", "skeleton"]);
  });

  it("resolves skills with names", () => {
    const lookups = makeLookups();
    const unit: any = {
      skills: [
        { id: 117, level: 8, experience: 1000 },
        { id: 2, level: 5, experience: 500 },
        { id: 999, level: 1, experience: 0 },
      ],
    };
    resolveUnitNames(unit, lookups);
    expect(unit.skills[0].name).toBe("Music");
    expect(unit.skills[0].nameNoun).toBe("Musician");
    expect(unit.skills[1].name).toBe("Mining");
    expect(unit.skills[2].name).toBeUndefined();
  });

  it("resolves labors to { id, name } tuples", () => {
    const lookups = makeLookups();
    const unit: any = { labors: [11, 0, 99] };
    resolveUnitNames(unit, lookups);
    expect(unit.labors).toEqual([
      { id: 11, name: "Carpentry" },
      { id: 0, name: "Mining" },
      { id: 99, name: "Labor 99" },
    ]);
  });
});

describe("enrichInventory", () => {
  it("adds material name to inventory items", () => {
    const lookups = makeLookups();
    const unit: any = {
      inventory: [
        {
          item: {
            material: { matType: 0, matIndex: 5 },
            type: { matType: 1, matIndex: 25 },
          },
        },
        {
          item: {
            material: { matType: 3, matIndex: 2 },
            type: { matType: 26, matIndex: 1 },
          },
        },
      ],
    };
    enrichInventory(unit, lookups);
    expect(unit.inventory[0].item.materialName).toBe("Iron");
    expect(unit.inventory[0].item.typeName).toBe("WEAPON:ITEM_WEAPON_PICK");
    expect(unit.inventory[1].item.materialName).toBe("Oak wood");
    expect(unit.inventory[1].item.typeName).toBe("ARMOR:ITEM_ARMOR_HELM");
  });

  it("handles missing lookups gracefully", () => {
    const lookups = makeLookups();
    const unit: any = {
      inventory: [
        {
          item: {
            material: { matType: 999, matIndex: 999 },
            type: { matType: 999, matIndex: 999 },
          },
        },
      ],
    };
    enrichInventory(unit, lookups);
    expect(unit.inventory[0].item.materialName).toBeUndefined();
    expect(unit.inventory[0].item.typeName).toBeUndefined();
  });

  it("handles unit without inventory", () => {
    const lookups = makeLookups();
    const unit: any = {};
    expect(() => enrichInventory(unit, lookups)).not.toThrow();
  });
});
