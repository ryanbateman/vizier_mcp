import { describe, it, expect } from "vitest";
import { buildFortressOverview } from "../src/overview.js";

const lookups = {
  creature: new Map<number, string>([
    [572, "dwarf"],
    [100, "goblin"],
  ]),
};

const world = {
  mode: 1,
  saveDir: "region1",
  worldName: { englishName: "The Universes of Vision", lastName: "Ecamo Asada" },
  civId: 11,
  siteId: 34,
  raceId: 572,
};

const map = {
  blockSizeX: 12,
  blockSizeY: 12,
  blockSizeZ: 225,
  blockPosX: 51,
  blockPosY: 145,
  blockPosZ: -27,
};

function unit(name: string, profession: string, gender: "Male" | "Female", skills: Array<{ name: string; level: number }>): any {
  return {
    name: { englishName: name },
    professionName: profession,
    genderName: gender,
    skills,
  };
}

describe("buildFortressOverview", () => {
  it("resolves world name, save, mode label, and race name", () => {
    const o = buildFortressOverview(world, map, [], lookups);
    expect(o.world.name).toBe("The Universes of Vision");
    expect(o.world.save).toBe("region1");
    expect(o.world.mode).toBe("Dwarf Fortress");
    expect(o.world.civId).toBe(11);
    expect(o.world.siteId).toBe(34);
    expect(o.world.raceId).toBe(572);
    expect(o.world.raceName).toBe("dwarf");
  });

  it("falls back to 'Mode N' for unknown mode values", () => {
    const o = buildFortressOverview({ ...world, mode: 42 }, map, [], lookups);
    expect(o.world.mode).toBe("Mode 42");
  });

  it("converts map block dimensions to tiles", () => {
    const o = buildFortressOverview(world, map, [], lookups);
    expect(o.map.blocks).toEqual({ x: 12, y: 12, z: 225 });
    expect(o.map.embarkTiles).toEqual({ x: 192, y: 192 });
    expect(o.map.zLevels).toBe(225);
    expect(o.map.blockOrigin).toEqual({ x: 51, y: 145, z: -27 });
  });

  it("aggregates profession histogram and gender split", () => {
    const units = [
      unit("A", "Miner", "Male", []),
      unit("B", "Miner", "Female", []),
      unit("C", "Carpenter", "Male", []),
      unit("D", "Carpenter", "Male", []),
      unit("E", "Planter", "Female", []),
    ];
    const o = buildFortressOverview(world, map, units, lookups);
    expect(o.population.total).toBe(5);
    expect(o.population.byProfession).toEqual({
      Miner: 2,
      Carpenter: 2,
      Planter: 1,
    });
    expect(o.population.byGender).toEqual({ Male: 3, Female: 2, Unknown: 0 });
  });

  it("collects notable skills above the threshold, sorted by level", () => {
    const units = [
      unit("Channelboar", "Miner", "Male", [{ name: "Mining", level: 16 }]),
      unit("Waywardpillar", "Planter", "Male", [
        { name: "Poetry", level: 7 },
        { name: "Growing", level: 2 },
      ]),
      unit("Searchcrafted", "Craftsman", "Female", [{ name: "Dance", level: 3 }]),
    ];
    const o = buildFortressOverview(world, map, units, lookups);
    expect(o.population.notable.length).toBe(2);
    expect(o.population.notable[0]).toEqual({
      unit: "Channelboar",
      skill: "Mining",
      level: 16,
      profession: "Miner",
    });
    expect(o.population.notable[1].skill).toBe("Poetry");
  });

  it("honors notableMinLevel and notableLimit", () => {
    const units = [
      unit("A", "X", "Male", [{ name: "S1", level: 6 }]),
      unit("B", "X", "Male", [{ name: "S2", level: 5 }]),
      unit("C", "X", "Male", [{ name: "S3", level: 4 }]),
    ];
    const o = buildFortressOverview(world, map, units, lookups, {
      notableMinLevel: 6,
      notableLimit: 1,
    });
    expect(o.population.notable).toEqual([
      { unit: "A", skill: "S1", level: 6, profession: "X" },
    ]);
  });

  it("buckets unknown gender", () => {
    const units = [unit("A", "X", "Male", []), { name: { englishName: "B" } } as any];
    const o = buildFortressOverview(world, map, units, lookups);
    expect(o.population.byGender).toEqual({ Male: 1, Female: 0, Unknown: 1 });
  });
});
