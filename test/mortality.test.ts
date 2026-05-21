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
    ...over,
  };
}

function rfr(
  id: number,
  over: Record<string, unknown> = {},
): { id: number } & Record<string, unknown> {
  return {
    id,
    posX: 50,
    posY: 50,
    posZ: 165,
    bloodCount: 0,
    bloodMax: 200,
    wounds: [],
    ...over,
  };
}

describe("buildMortalityReport", () => {
  it("returns an empty report when no one has died", () => {
    const r = buildMortalityReport([], new Map());
    expect(r.total).toBe(0);
    expect(r.dead).toEqual([]);
    expect(r.byRace).toEqual({});
    expect(r.byProfession).toEqual({});
  });

  it("joins core + rfr per unit and surfaces position, blood, wounds", () => {
    const rfrMap = new Map<number, any>([
      [
        100,
        rfr(100, {
          wounds: [
            {
              parts: [{ bodyPartId: 5, globalLayerIdx: 1, layerIdx: 0 }],
              severedPart: true,
            },
          ],
        }),
      ],
    ]);
    const r = buildMortalityReport([coreDead()], rfrMap);
    expect(r.total).toBe(1);
    const d = r.dead[0];
    expect(d.name).toEqual({ firstName: "Urist", englishName: "Cleavereyes" });
    expect(d.position).toEqual({ x: 50, y: 50, z: 165 });
    expect(d.bloodCount).toBe(0);
    expect(d.wounds).toHaveLength(1);
    expect(d.wounds[0].severedPart).toBe(true);
    expect(d.severedPartCount).toBe(1);
    expect(d.deathFlagsNames).toEqual(["killed"]);
  });

  it("orders dead by deathId descending (most recent first)", () => {
    const dead = [
      coreDead({ unitId: 1, deathId: 3, name: { englishName: "First" } }),
      coreDead({ unitId: 2, deathId: 7, name: { englishName: "Last" } }),
      coreDead({ unitId: 3, deathId: 5, name: { englishName: "Middle" } }),
    ];
    const r = buildMortalityReport(dead, new Map());
    expect(r.dead.map((d) => d.deathId)).toEqual([7, 5, 3]);
    expect(r.dead.map((d) => d.name?.englishName)).toEqual([
      "Last",
      "Middle",
      "First",
    ]);
  });

  it("bubbles units with no deathId to the bottom", () => {
    const dead = [
      coreDead({ unitId: 1, deathId: 5 }),
      coreDead({ unitId: 2, deathId: undefined }),
      coreDead({ unitId: 3, deathId: 9 }),
    ];
    const r = buildMortalityReport(dead, new Map());
    expect(r.dead.map((d) => d.unitId)).toEqual([3, 1, 2]);
  });

  it("counts by race and profession", () => {
    const dead = [
      coreDead({ unitId: 1, raceName: "dwarf", professionName: "Miner" }),
      coreDead({ unitId: 2, raceName: "dwarf", professionName: "Miner" }),
      coreDead({ unitId: 3, raceName: "goblin", professionName: "Lasher" }),
      coreDead({ unitId: 4, raceName: "dwarf", professionName: "Carpenter" }),
    ];
    const r = buildMortalityReport(dead, new Map());
    expect(r.byRace).toEqual({ dwarf: 3, goblin: 1 });
    expect(r.byProfession).toEqual({
      Miner: 2,
      Lasher: 1,
      Carpenter: 1,
    });
  });

  it("buckets unknown race / profession as '(unknown)'", () => {
    const dead = [
      coreDead({ unitId: 1, raceName: undefined, professionName: undefined }),
    ];
    const r = buildMortalityReport(dead, new Map());
    expect(r.byRace).toEqual({ "(unknown)": 1 });
    expect(r.byProfession).toEqual({ "(unknown)": 1 });
    // The DeadUnit entry itself keeps undefined (no synthetic value baked in).
    expect(r.dead[0].raceName).toBeUndefined();
    expect(r.dead[0].profession).toBeUndefined();
  });

  it("works when rfr side is missing for a unit (position/wounds blank)", () => {
    const r = buildMortalityReport([coreDead()], new Map());
    const d = r.dead[0];
    expect(d.position).toEqual({ x: undefined, y: undefined, z: undefined });
    expect(d.bloodCount).toBeUndefined();
    expect(d.wounds).toEqual([]);
    expect(d.severedPartCount).toBe(0);
  });

  it("counts multiple severed parts across wounds", () => {
    const rfrMap = new Map<number, any>([
      [
        100,
        rfr(100, {
          wounds: [
            { parts: [], severedPart: true },
            { parts: [], severedPart: false },
            { parts: [], severedPart: true },
          ],
        }),
      ],
    ]);
    const r = buildMortalityReport([coreDead()], rfrMap);
    expect(r.dead[0].severedPartCount).toBe(2);
    expect(r.dead[0].wounds).toHaveLength(3);
  });
});
