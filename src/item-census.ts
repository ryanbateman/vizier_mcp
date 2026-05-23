// item_census — what items exist on tiles in the scanned region?
//
// Pure aggregator over RFR's MapBlock.items[] across a sweep. Buckets each
// item by (itemType, material) and surfaces "decorated" items separately
// (anything with improvements[] populated — RFR's best proxy for value
// since it has no quality field and no material-value field).
//
// RFR boundary disclosed in the tool description: items lying on a tile
// could be stockpiled, dumped, carried by a creature, on furniture, or
// just loose. RFR exposes no stockpile-membership linkage, so the tool
// reports physical tile presence only — no "what's in stockpile X."

import type {
  MapBlockWithItems,
  MatPair,
  RfrItem,
} from "./dfhack/proto-types.js";

export interface ItemTypeRef {
  matType: number;
  matIndex: number;
  /** "INSTRUMENT/ENT11 INK1" or "BLOCKS" — the item type's id field. */
  id?: string;
  /** Friendlier display name when present (e.g. "inen"). */
  name?: string;
  /** Per-item-type base value where the raws expose one. Many types have none. */
  baseValue?: number;
}

export interface MaterialRef {
  matType: number;
  matIndex: number;
  /** "IRON" / "STEEL" / "WOOD:OAK" — the material's id field. */
  id?: string;
  /** Friendlier display name when present. */
  name?: string;
}

export interface CensusBucket {
  itemType: { matType: number; matIndex: number; id?: string; name?: string; baseValue?: number };
  material: { matType: number; matIndex: number; id?: string; name?: string };
  count: number;
  /** Sum of stackSize across the bucket (defaults to 1 per item when missing). */
  stackTotal: number;
  /** How many items in the bucket carry any improvements[]. */
  decoratedCount: number;
}

export interface DecoratedItemSummary {
  itemId?: number;
  itemType: { id?: string; name?: string };
  material: { id?: string; name?: string };
  position?: { x?: number; y?: number; z?: number };
  improvementCount: number;
}

export interface ItemCensusReport {
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  };
  blocksSeen: number;
  total: {
    items: number;
    stack: number;
    distinctBuckets: number;
    decorated: number;
  };
  topByCount: CensusBucket[];
  topByStack: CensusBucket[];
  decorated: DecoratedItemSummary[];
  caveats: {
    qualityBlind: true;
    materialValueBlind: true;
    physicalTilePresenceOnly: true;
    note: string;
  };
}

export interface CensusOptions {
  topN?: number;
  /** Cap on the decorated list returned (decoratedCount in `total` is always
   * the full count). Default 50. */
  decoratedLimit?: number;
}

export interface CensusInput {
  blocks: MapBlockWithItems[];
  bounds: ItemCensusReport["bounds"];
  itemTypes: ItemTypeRef[];
  materials: MaterialRef[];
}

function keyOf(pair: MatPair | undefined): string {
  if (!pair) return "?/?";
  return `${pair.matType}/${pair.matIndex}`;
}

function indexRefs<T extends { matType: number; matIndex: number }>(
  refs: T[],
): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of refs) m.set(`${r.matType}/${r.matIndex}`, r);
  return m;
}

/** Build the item-census report. Pure — no I/O. */
export function buildItemCensus(
  input: CensusInput,
  options: CensusOptions = {},
): ItemCensusReport {
  const topN = options.topN ?? 20;
  const decoratedLimit = options.decoratedLimit ?? 50;

  const typeIndex = indexRefs(input.itemTypes);
  const matIndex = indexRefs(input.materials);

  const buckets = new Map<string, CensusBucket>();
  const decorated: DecoratedItemSummary[] = [];
  let totalItems = 0;
  let totalStack = 0;
  let totalDecorated = 0;

  for (const block of input.blocks) {
    if (!block.items) continue;
    for (const item of block.items) {
      totalItems += 1;
      const stack = item.stackSize ?? 1;
      totalStack += stack;
      const isDecorated = (item.improvements?.length ?? 0) > 0;
      if (isDecorated) totalDecorated += 1;

      const tKey = keyOf(item.type);
      const mKey = keyOf(item.material);
      const bucketKey = `${tKey}|${mKey}`;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        const tRef = item.type ? typeIndex.get(tKey) : undefined;
        const mRef = item.material ? matIndex.get(mKey) : undefined;
        bucket = {
          itemType: {
            matType: item.type?.matType ?? -1,
            matIndex: item.type?.matIndex ?? -1,
            id: tRef?.id,
            name: tRef?.name,
            baseValue: tRef?.baseValue,
          },
          material: {
            matType: item.material?.matType ?? -1,
            matIndex: item.material?.matIndex ?? -1,
            id: mRef?.id,
            name: mRef?.name,
          },
          count: 0,
          stackTotal: 0,
          decoratedCount: 0,
        };
        buckets.set(bucketKey, bucket);
      }
      bucket.count += 1;
      bucket.stackTotal += stack;
      if (isDecorated) bucket.decoratedCount += 1;

      if (isDecorated && decorated.length < decoratedLimit) {
        decorated.push(summariseDecorated(item, typeIndex, matIndex));
      }
    }
  }

  const all = [...buckets.values()];
  const topByCount = [...all]
    .sort((a, b) => b.count - a.count || keyCompare(a, b))
    .slice(0, topN);
  const topByStack = [...all]
    .sort((a, b) => b.stackTotal - a.stackTotal || keyCompare(a, b))
    .slice(0, topN);

  return {
    bounds: input.bounds,
    blocksSeen: input.blocks.length,
    total: {
      items: totalItems,
      stack: totalStack,
      distinctBuckets: all.length,
      decorated: totalDecorated,
    },
    topByCount,
    topByStack,
    decorated,
    caveats: {
      qualityBlind: true,
      materialValueBlind: true,
      physicalTilePresenceOnly: true,
      note:
        "RFR exposes no item quality, no per-material base value, and no " +
        "stockpile-membership linkage. Items here are tile presence only — " +
        "they may be stockpiled, dumped, carried, on furniture, or loose.",
    },
  };
}

function keyCompare(a: CensusBucket, b: CensusBucket): number {
  return (
    a.itemType.matType - b.itemType.matType ||
    a.itemType.matIndex - b.itemType.matIndex ||
    a.material.matType - b.material.matType ||
    a.material.matIndex - b.material.matIndex
  );
}

function summariseDecorated(
  item: RfrItem,
  typeIndex: Map<string, { id?: string; name?: string }>,
  matIndex: Map<string, { id?: string; name?: string }>,
): DecoratedItemSummary {
  const tKey = keyOf(item.type);
  const mKey = keyOf(item.material);
  const tRef = typeIndex.get(tKey);
  const mRef = matIndex.get(mKey);
  return {
    itemId: item.id,
    itemType: { id: tRef?.id, name: tRef?.name },
    material: { id: mRef?.id, name: mRef?.name },
    position: item.pos
      ? { x: item.pos.x, y: item.pos.y, z: item.pos.z }
      : undefined,
    improvementCount: item.improvements?.length ?? 0,
  };
}
