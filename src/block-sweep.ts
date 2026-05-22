// Block-sweep chunker — wraps RFR's GetBlockList for composite tools that
// need to read a wide area without tripping the crash mode documented in
// src/block-volume.ts.
//
// The chunker is server-side and not exposed as a tool: only orchestrators
// (planned: get_stocks_overview) compose it. The LLM should never get a
// direct knob that bypasses the per-request volume guard.
//
// Strategy: split into z-slabs first, then by x/y quadrant if a single
// z-slab still exceeds the per-chunk budget. Each chunk is dispatched
// sequentially through the existing callRpc path so DFHack's one-in-flight
// wire protocol is honoured (the client serializer already enforces this,
// but sequential issuance also keeps memory bounded).

import { callRpc } from "./dfhack/client.js";
import {
  computeBlockVolume,
  readMaxBlockVolume,
  type BlockBounds,
} from "./block-volume.js";

export interface MapBlock {
  // Whatever fields RFR returns — we don't depend on the shape here.
  [key: string]: unknown;
}

export interface BlockListResponse {
  mapBlocks?: MapBlock[];
  [key: string]: unknown;
}

export interface SweepResult {
  /** Aggregated map blocks across every chunk. */
  mapBlocks: MapBlock[];
  /** How many GetBlockList calls were issued. */
  chunksIssued: number;
  /** The per-chunk volume budget used. */
  chunkBudget: number;
}

export interface SweepOptions {
  /** Per-chunk volume budget. Defaults to the same envelope the guard uses. */
  chunkBudget?: number;
  /**
   * Override the underlying RPC for testing. Receives a single chunk's
   * BlockBounds and must return a BlockListResponse-shaped object.
   */
  call?: (chunk: BlockBounds) => Promise<BlockListResponse>;
}

/**
 * Split a bounding box into chunks no larger than `budget` tiles each.
 * Pure — no I/O. Chunks tile the input box exactly (no overlap, no gaps).
 *
 * Splits by z first (smallest slab first, since DF maps are stacked), then
 * by x, then by y. Each axis is halved until the resulting chunk fits.
 */
export function planChunks(b: BlockBounds, budget: number): BlockBounds[] {
  if (budget <= 0) throw new Error("chunk budget must be positive");
  const vol = computeBlockVolume(b);
  if (vol === 0) return [];
  if (vol <= budget) return [{ ...b }];

  // Choose the longest axis to halve so chunks stay roughly cubic. Bias
  // toward z when z>1 since z-slabs are the natural DF traversal unit.
  const dx = b.maxX - b.minX + 1;
  const dy = b.maxY - b.minY + 1;
  const dz = b.maxZ - b.minZ + 1;
  let axis: "x" | "y" | "z";
  if (dz > 1 && dz >= dx && dz >= dy) axis = "z";
  else if (dx >= dy) axis = "x";
  else axis = "y";

  if (axis === "z") {
    const mid = b.minZ + Math.floor(dz / 2);
    return [
      ...planChunks({ ...b, maxZ: mid - 1 }, budget),
      ...planChunks({ ...b, minZ: mid }, budget),
    ];
  }
  if (axis === "x") {
    const mid = b.minX + Math.floor(dx / 2);
    return [
      ...planChunks({ ...b, maxX: mid - 1 }, budget),
      ...planChunks({ ...b, minX: mid }, budget),
    ];
  }
  const mid = b.minY + Math.floor(dy / 2);
  return [
    ...planChunks({ ...b, maxY: mid - 1 }, budget),
    ...planChunks({ ...b, minY: mid }, budget),
  ];
}

/**
 * Sweep a wide bbox via DFHack's GetBlockList, chunked to stay under the
 * per-call volume budget. Aggregates `mapBlocks` across every chunk in
 * issuance order.
 */
export async function sweepBlocks(
  bbox: BlockBounds,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const chunkBudget = options.chunkBudget ?? readMaxBlockVolume();
  const call =
    options.call ??
    ((chunk: BlockBounds) =>
      callRpc<BlockListResponse>("GetBlockList", { ...chunk }));

  const chunks = planChunks(bbox, chunkBudget);
  const mapBlocks: MapBlock[] = [];
  for (const chunk of chunks) {
    const resp = await call(chunk);
    if (resp.mapBlocks) mapBlocks.push(...resp.mapBlocks);
  }
  return { mapBlocks, chunksIssued: chunks.length, chunkBudget };
}
