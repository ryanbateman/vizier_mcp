import { describe, it, expect } from "vitest";
import {
  buildItemCensus,
  type ItemTypeRef,
  type MaterialRef,
} from "../src/item-census.js";
import type { MapBlockWithItems, RfrItem } from "../src/dfhack/proto-types.js";

const BOUNDS = { minX: 0, maxX: 47, minY: 0, maxY: 47, minZ: 100, maxZ: 110 };

const ITEM_TYPES: ItemTypeRef[] = [
  { matType: 0, matIndex: -1, id: "BAR", name: undefined },
  { matType: 4, matIndex: -1, id: "BOULDER" },
  { matType: 13, matIndex: 0, id: "INSTRUMENT/ENT11 INK1", name: "inen", baseValue: 50 },
];

const MATERIALS: MaterialRef[] = [
  { matType: 0, matIndex: 7, id: "INORGANIC:IRON", name: "iron" },
  { matType: 0, matIndex: 8, id: "INORGANIC:STEEL", name: "steel" },
  { matType: 0, matIndex: 12, id: "INORGANIC:HEMATITE", name: "hematite" },
];

function block(items: RfrItem[]): MapBlockWithItems {
  return { mapX: 0, mapY: 0, mapZ: 100, items };
}

function item(over: Partial<RfrItem> = {}): RfrItem {
  return {
    id: 1,
    type: { matType: 0, matIndex: -1 },
    material: { matType: 0, matIndex: 7 },
    stackSize: 1,
    ...over,
  };
}

describe("buildItemCensus", () => {
  it("returns an empty report when no blocks have items", () => {
    const r = buildItemCensus({
      blocks: [block([]), { mapX: 1, mapY: 0, mapZ: 100 }],
      bounds: BOUNDS,
      itemTypes: ITEM_TYPES,
      materials: MATERIALS,
    });
    expect(r.blocksSeen).toBe(2);
    expect(r.total).toEqual({ items: 0, stack: 0, distinctBuckets: 0, decorated: 0 });
    expect(r.topByCount).toEqual([]);
    expect(r.decorated).toEqual([]);
  });

  it("buckets by (itemType, material), summing count and stackSize", () => {
    const r = buildItemCensus({
      blocks: [
        block([
          item({ stackSize: 3 }),
          item({ stackSize: 2 }),
          item({ material: { matType: 0, matIndex: 8 }, stackSize: 1 }),
        ]),
      ],
      bounds: BOUNDS,
      itemTypes: ITEM_TYPES,
      materials: MATERIALS,
    });
    expect(r.total.items).toBe(3);
    expect(r.total.stack).toBe(6);
    expect(r.total.distinctBuckets).toBe(2);
    const ironBar = r.topByCount.find((b) => b.material.name === "iron");
    const steelBar = r.topByCount.find((b) => b.material.name === "steel");
    expect(ironBar).toMatchObject({ count: 2, stackTotal: 5 });
    expect(steelBar).toMatchObject({ count: 1, stackTotal: 1 });
  });

  it("resolves type and material names from the supplied refs", () => {
    const r = buildItemCensus({
      blocks: [block([item({ type: { matType: 13, matIndex: 0 } })])],
      bounds: BOUNDS,
      itemTypes: ITEM_TYPES,
      materials: MATERIALS,
    });
    expect(r.topByCount[0]?.itemType).toMatchObject({
      id: "INSTRUMENT/ENT11 INK1",
      name: "inen",
      baseValue: 50,
    });
    expect(r.topByCount[0]?.material.name).toBe("iron");
  });

  it("treats missing stackSize as 1", () => {
    const r = buildItemCensus({
      blocks: [block([item({ stackSize: undefined }), item({ stackSize: undefined })])],
      bounds: BOUNDS,
      itemTypes: ITEM_TYPES,
      materials: MATERIALS,
    });
    expect(r.total.stack).toBe(2);
  });

  it("counts decorated items separately and caps the surfaced list", () => {
    const items: RfrItem[] = [];
    for (let i = 0; i < 60; i++) {
      items.push(
        item({
          id: 100 + i,
          improvements: [{ type: 1 }],
          pos: { x: i, y: 0, z: 100 },
        }),
      );
    }
    items.push(item({ id: 999, improvements: undefined }));
    const r = buildItemCensus(
      {
        blocks: [block(items)],
        bounds: BOUNDS,
        itemTypes: ITEM_TYPES,
        materials: MATERIALS,
      },
      { decoratedLimit: 25 },
    );
    expect(r.total.items).toBe(61);
    expect(r.total.decorated).toBe(60);
    expect(r.decorated).toHaveLength(25);
    expect(r.decorated[0]?.improvementCount).toBe(1);
    expect(r.decorated[0]?.position).toEqual({ x: 0, y: 0, z: 100 });
  });

  it("honors topN and ranks both topByCount and topByStack", () => {
    // Three buckets with different count/stack relationships so the two
    // rankings produce different orderings.
    const r = buildItemCensus(
      {
        blocks: [
          block([
            // Bucket A: 10 items, stack=1 each → count=10, stack=10
            ...Array.from({ length: 10 }, () => item({ id: 1 })),
            // Bucket B: 3 items, stack=20 each → count=3, stack=60
            ...Array.from({ length: 3 }, () =>
              item({ id: 2, material: { matType: 0, matIndex: 8 }, stackSize: 20 }),
            ),
            // Bucket C: 5 items, stack=5 each → count=5, stack=25
            ...Array.from({ length: 5 }, () =>
              item({ id: 3, material: { matType: 0, matIndex: 12 }, stackSize: 5 }),
            ),
          ]),
        ],
        bounds: BOUNDS,
        itemTypes: ITEM_TYPES,
        materials: MATERIALS,
      },
      { topN: 2 },
    );
    expect(r.topByCount).toHaveLength(2);
    expect(r.topByCount.map((b) => b.material.name)).toEqual(["iron", "hematite"]);
    expect(r.topByStack).toHaveLength(2);
    expect(r.topByStack.map((b) => b.material.name)).toEqual(["steel", "hematite"]);
  });

  it("tolerates items with no type / material (buckets them under '?/?')", () => {
    const r = buildItemCensus({
      blocks: [block([{ id: 42, stackSize: 1 } as RfrItem])],
      bounds: BOUNDS,
      itemTypes: ITEM_TYPES,
      materials: MATERIALS,
    });
    expect(r.total.items).toBe(1);
    expect(r.topByCount[0]?.itemType.matType).toBe(-1);
    expect(r.topByCount[0]?.itemType.id).toBeUndefined();
  });

  it("aggregates across multiple blocks", () => {
    const r = buildItemCensus({
      blocks: [
        block([item({ stackSize: 2 })]),
        block([item({ stackSize: 3 })]),
        block([item({ material: { matType: 0, matIndex: 8 }, stackSize: 1 })]),
      ],
      bounds: BOUNDS,
      itemTypes: ITEM_TYPES,
      materials: MATERIALS,
    });
    expect(r.blocksSeen).toBe(3);
    expect(r.total.items).toBe(3);
    expect(r.total.distinctBuckets).toBe(2);
  });

  it("emits the caveat block describing what RFR cannot see", () => {
    const r = buildItemCensus({
      blocks: [],
      bounds: BOUNDS,
      itemTypes: ITEM_TYPES,
      materials: MATERIALS,
    });
    expect(r.caveats.qualityBlind).toBe(true);
    expect(r.caveats.materialValueBlind).toBe(true);
    expect(r.caveats.physicalTilePresenceOnly).toBe(true);
    expect(r.caveats.note).toMatch(/stockpile/i);
  });
});
