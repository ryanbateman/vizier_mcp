import { describe, it, expect } from "vitest";
import { planChunks, sweepBlocks } from "../src/block-sweep.js";
import { computeBlockVolume, type BlockBounds } from "../src/block-volume.js";

function bbox(
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
): BlockBounds {
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/** Total volume across a chunk list (must equal the original bbox volume). */
function totalVolume(chunks: BlockBounds[]): number {
  return chunks.reduce((sum, c) => sum + computeBlockVolume(c), 0);
}

/** Detects whether two chunks intersect on any axis. */
function intersects(a: BlockBounds, b: BlockBounds): boolean {
  return (
    a.maxX >= b.minX &&
    b.maxX >= a.minX &&
    a.maxY >= b.minY &&
    b.maxY >= a.minY &&
    a.maxZ >= b.minZ &&
    b.maxZ >= a.minZ
  );
}

describe("planChunks", () => {
  it("returns the bbox unchanged when it already fits", () => {
    const b = bbox(0, 9, 0, 9, 0, 0);
    expect(planChunks(b, 100)).toEqual([b]);
  });

  it("returns an empty list for an inverted bbox", () => {
    expect(planChunks(bbox(10, 0, 0, 5, 0, 0), 100)).toEqual([]);
  });

  it("splits a wide bbox into chunks that each fit the budget", () => {
    const b = bbox(0, 199, 0, 199, 100, 100); // 40_000 tiles, crash territory
    const chunks = planChunks(b, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(computeBlockVolume(c)).toBeLessThanOrEqual(4096);
    }
  });

  it("tiles the input exactly — no overlap, no gaps", () => {
    const b = bbox(0, 199, 0, 199, 100, 105); // 200×200×6 = 240k
    const chunks = planChunks(b, 4096);
    expect(totalVolume(chunks)).toBe(computeBlockVolume(b));
    for (let i = 0; i < chunks.length; i++) {
      for (let j = i + 1; j < chunks.length; j++) {
        expect(
          intersects(chunks[i]!, chunks[j]!),
          `chunks ${i} and ${j} overlap`,
        ).toBe(false);
      }
    }
  });

  it("prefers splitting by z when z is the dominant axis", () => {
    // Tall, narrow stack: 4 wide × 4 deep × 32 tall = 512.
    // Budget 256 → must halve. z should be the chosen axis.
    const b = bbox(0, 3, 0, 3, 0, 31);
    const chunks = planChunks(b, 256);
    // Two chunks, each spanning full x/y, half z.
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.minX).toBe(0);
    expect(chunks[0]!.maxX).toBe(3);
    expect(chunks[0]!.minY).toBe(0);
    expect(chunks[0]!.maxY).toBe(3);
    expect(chunks[1]!.minX).toBe(0);
    expect(chunks[1]!.maxX).toBe(3);
    // z is partitioned: first half then second half.
    expect(chunks[0]!.maxZ + 1).toBe(chunks[1]!.minZ);
  });

  it("falls back to xy splits for thin z-slabs that still overflow", () => {
    const b = bbox(0, 199, 0, 199, 50, 50); // 40_000, single z level
    const chunks = planChunks(b, 4096);
    for (const c of chunks) {
      expect(c.minZ).toBe(50);
      expect(c.maxZ).toBe(50);
    }
  });

  it("throws on a non-positive budget", () => {
    expect(() => planChunks(bbox(0, 9, 0, 9, 0, 0), 0)).toThrow();
  });
});

describe("sweepBlocks", () => {
  it("issues one call per chunk and aggregates mapBlocks", async () => {
    const b = bbox(0, 199, 0, 199, 50, 50); // would crash without chunking
    const issued: BlockBounds[] = [];
    const result = await sweepBlocks(b, {
      chunkBudget: 4096,
      call: async (chunk) => {
        issued.push(chunk);
        // Return a synthetic block per chunk so we can verify aggregation.
        return { mapBlocks: [{ chunkMinX: chunk.minX, chunkMinY: chunk.minY }] };
      },
    });
    expect(issued.length).toBeGreaterThan(1);
    expect(result.chunksIssued).toBe(issued.length);
    expect(result.mapBlocks).toHaveLength(issued.length);
    expect(result.chunkBudget).toBe(4096);
  });

  it("makes a single call when the bbox already fits", async () => {
    let callCount = 0;
    const result = await sweepBlocks(bbox(0, 9, 0, 9, 0, 0), {
      chunkBudget: 4096,
      call: async () => {
        callCount += 1;
        return { mapBlocks: [{ tag: "the-one-block" }] };
      },
    });
    expect(callCount).toBe(1);
    expect(result.mapBlocks).toEqual([{ tag: "the-one-block" }]);
  });

  it("tolerates a response with no mapBlocks", async () => {
    const result = await sweepBlocks(bbox(0, 9, 0, 9, 0, 0), {
      chunkBudget: 4096,
      call: async () => ({}),
    });
    expect(result.mapBlocks).toEqual([]);
    expect(result.chunksIssued).toBe(1);
  });
});
