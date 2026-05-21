import { describe, it, expect } from "vitest";
import { buildMortalityReport } from "../src/mortality.js";

function coreDead(over: Record<string, unknown> = {}): any {
  return {
    unitId: 100,
    name: { firstName: "Urist", englishName: "Cleavereyes" },
    professionName: "Hammerdwarf",
    raceName: "dwarf",
    deathId: 7,
    deathFlagsNames: ["killed"],
    posX: 50,
    posY: 50,
    posZ: 165,
    ...over,
  };
}

describe("buildMortalityReport", () => {
  it("returns an empty report when no one has died", () => {
    const r = buildMortalityReport([]);
    expect(r.total).toBe(0);
    expect(r.dead).toEqual([]);
    expect(r.byRace).toEqual({});
    expect(r.byProfession).toEqual({});
  });

  it("reads position straight from Core (no RFR join)", () => {
    const r = buildMortalityReport([
      coreDead({ posX: 110, posY: 11, posZ: 166 }),
    ]);
    expect(r.dead[0].position).toEqual({ x: 110, y: 11, z: 166 });
  });

  it("surfaces name, race, profession, deathId, deathFlags verbatim", () => {
    const r = buildMortalityReport([coreDead()]);
    const d = r.dead[0];
    expect(d.name).toEqual({ firstName: "Urist", englishName: "Cleavereyes" });
    expect(d.raceName).toBe("dwarf");
    expect(d.profession).toBe("Hammerdwarf");
    expect(d.deathId).toBe(7);
    expect(d.deathFlagsNames).toEqual(["killed"]);
  });

  it("orders dead by deathId descending (most recent first)", () => {
    const dead = [
      coreDead({ unitId: 1, deathId: 3, name: { englishName: "First" } }),
      coreDead({ unitId: 2, deathId: 7, name: { englishName: "Last" } }),
      coreDead({ unitId: 3, deathId: 5, name: { englishName: "Middle" } }),
    ];
    const r = buildMortalityReport(dead);
    expect(r.dead.map((d) => d.name?.englishName)).toEqual([
      "Last",
      "Middle",
      "First",
    ]);
  });

  it("bubbles units with no deathId to the bottom", () => {
    // Butchered livestock often have no deathId — they're "removed", not
    // killed in an event. They should still appear, just at the end.
    const dead = [
      coreDead({ unitId: 1, deathId: 5 }),
      coreDead({ unitId: 2, deathId: undefined }),
      coreDead({ unitId: 3, deathId: 9 }),
    ];
    const r = buildMortalityReport(dead);
    expect(r.dead.map((d) => d.unitId)).toEqual([3, 1, 2]);
  });

  it("counts by race and profession", () => {
    const dead = [
      coreDead({ unitId: 1, raceName: "dwarf", professionName: "Miner" }),
      coreDead({ unitId: 2, raceName: "dwarf", professionName: "Miner" }),
      coreDead({ unitId: 3, raceName: "goblin", professionName: "Lasher" }),
      coreDead({ unitId: 4, raceName: "dwarf", professionName: "Carpenter" }),
    ];
    const r = buildMortalityReport(dead);
    expect(r.byRace).toEqual({ dwarf: 3, goblin: 1 });
    expect(r.byProfession).toEqual({
      Miner: 2,
      Lasher: 1,
      Carpenter: 1,
    });
  });

  it("buckets unknown race / profession as '(unknown)' in rollups", () => {
    const dead = [
      coreDead({ unitId: 1, raceName: undefined, professionName: undefined }),
    ];
    const r = buildMortalityReport(dead);
    expect(r.byRace).toEqual({ "(unknown)": 1 });
    expect(r.byProfession).toEqual({ "(unknown)": 1 });
    // The DeadUnit entry itself keeps undefined (no synthetic value baked in).
    expect(r.dead[0].raceName).toBeUndefined();
    expect(r.dead[0].profession).toBeUndefined();
  });
});
