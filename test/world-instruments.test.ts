import { describe, it, expect } from "vitest";
import {
  buildWorldInstruments,
  type ItemTypeEntry,
} from "../src/world-instruments.js";

function entry(over: Partial<ItemTypeEntry> = {}): ItemTypeEntry {
  return {
    matPair: { matType: 0, matIndex: 0 },
    id: "INSTRUMENT/ENT11 INK1",
    name: "inen",
    instrument: {
      size: 6300,
      value: 50,
      flags: { placedAsBuilding: true },
      pieces: [
        { id: "KEYBOARD", name: "inen keyboard" },
        { id: "BODY", name: "inen case" },
        { id: "VIB", name: "inen strings" },
      ],
      description: "The inen is a huge ceramic instrument.",
    },
    ...over,
  };
}

describe("buildWorldInstruments", () => {
  it("returns an empty report when nothing carries an instrument", () => {
    const r = buildWorldInstruments([
      { matPair: { matType: 0, matIndex: 0 }, id: "WEAPON/ITEM_WEAPON_PICK", name: "pick" },
      { matPair: { matType: 0, matIndex: 1 }, id: "ARMOR/ITEM_ARMOR_DRESS", name: "dress" },
    ]);
    expect(r.total).toBe(0);
    expect(r.byCiv).toEqual({});
    expect(r.byFamily).toEqual({
      keyboard: 0,
      strings: 0,
      wind: 0,
      percussion: 0,
      other: 0,
    });
  });

  it("groups instruments by civ and family", () => {
    const items: ItemTypeEntry[] = [
      entry({ id: "INSTRUMENT/ENT11 INK1", name: "inen" }),
      entry({
        id: "INSTRUMENT/ENT11 INS1",
        name: "tekmok",
        instrument: { value: 50, flags: { placedAsBuilding: false }, pieces: [] },
      }),
      entry({
        id: "INSTRUMENT/ENT11 INW1",
        name: "cagith",
        instrument: { value: 50, flags: { woodMat: true }, pieces: [] },
      }),
      entry({
        id: "INSTRUMENT/ENT11 INP1",
        name: "remang",
        instrument: { value: 50, flags: { placedAsBuilding: true }, pieces: [] },
      }),
      entry({
        id: "INSTRUMENT/ENT13 INP1",
        name: "gikifishrunkus",
        instrument: { value: 50, flags: { placedAsBuilding: true }, pieces: [] },
      }),
    ];
    const r = buildWorldInstruments(items);
    expect(r.total).toBe(5);
    expect(Object.keys(r.byCiv).sort()).toEqual(["ENT11", "ENT13"]);
    expect(r.byCiv["ENT11"]).toHaveLength(4);
    expect(r.byCiv["ENT13"]).toHaveLength(1);
    expect(r.byFamily).toEqual({
      keyboard: 1,
      strings: 1,
      wind: 1,
      percussion: 2,
      other: 0,
    });
  });

  it("derives family from the id suffix", () => {
    const r = buildWorldInstruments([
      entry({ id: "INSTRUMENT/ENT11 INK7", name: "k7" }),
      entry({ id: "INSTRUMENT/ENT11 INS2", name: "s2" }),
      entry({ id: "INSTRUMENT/ENT11 INW4", name: "w4" }),
      entry({ id: "INSTRUMENT/ENT11 INP3", name: "p3" }),
      entry({ id: "INSTRUMENT/ENT11 XYZ9", name: "junk" }),
    ]);
    const list = r.byCiv["ENT11"];
    // Sorted by family then name (alphabetical): keyboard, other, percussion, strings, wind.
    expect(list.map((i) => i.family)).toEqual([
      "keyboard",
      "other",
      "percussion",
      "strings",
      "wind",
    ]);
  });

  it("decodes the material allow-list flags", () => {
    const r = buildWorldInstruments([
      entry({
        id: "INSTRUMENT/ENT11 INW1",
        name: "cagith",
        instrument: {
          flags: { woodMat: true, boneMat: true, metalMat: false },
          pieces: [],
        },
      }),
    ]);
    expect(r.byCiv["ENT11"][0].materials).toEqual(["wood", "bone"]);
  });

  it("captures piece counts and the building flag", () => {
    const r = buildWorldInstruments([entry()]);
    const inst = r.byCiv["ENT11"][0];
    expect(inst.pieces).toBe(3);
    expect(inst.building).toBe(true);
    expect(inst.description).toContain("ceramic");
  });

  it("attaches the raw InstrumentDef in verbose mode", () => {
    const r = buildWorldInstruments([entry()], { verbose: true }) as {
      total: number;
      byCiv: Record<string, Array<{ raw?: { size?: number } }>>;
    };
    expect(r.byCiv["ENT11"][0].raw).toBeDefined();
    expect(r.byCiv["ENT11"][0].raw?.size).toBe(6300);
  });

  it("orders entries within a civ by family then name", () => {
    const r = buildWorldInstruments([
      entry({ id: "INSTRUMENT/ENT11 INW2", name: "zebra" }),
      entry({ id: "INSTRUMENT/ENT11 INW1", name: "alpha" }),
      entry({ id: "INSTRUMENT/ENT11 INK1", name: "mango" }),
    ]);
    expect(r.byCiv["ENT11"].map((i) => i.name)).toEqual([
      "mango",  // keyboard first
      "alpha",  // wind, alphabetical
      "zebra",
    ]);
  });
});
