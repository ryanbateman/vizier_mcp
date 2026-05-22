// Defensive bounds for RFR's BlockRequest.
//
// DFHack's GetBlockList does not fail gracefully when asked for too wide a
// region: an empirical 200×200×1 sweep crashed the DFHack-side process and
// took every tool on this server with it (no graceful error — just
// connection close). This guard runs *before* the RPC is dispatched so the
// crash mode is impossible to trigger through the MCP surface.
//
// The cap is on raw bounding-box volume in whatever coord units the caller
// passes (DFHack accepts tile coords in BlockRequest fields min_x..max_z).
// Default budget: 16_384 — comfortably below the observed 40k crash point
// while still permitting reasonable single-z scans (128×128 = 16_384).
// Override with the VIZIER_MAX_BLOCK_VOLUME env var when a chunked
// orchestrator needs a tighter budget per chunk.

export interface BlockBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface VolumeCheck {
  ok: boolean;
  reason?: string;
  volume?: number;
}

const DEFAULT_MAX_VOLUME = 16_384;

export function readMaxBlockVolume(): number {
  const raw = process.env.VIZIER_MAX_BLOCK_VOLUME;
  if (!raw) return DEFAULT_MAX_VOLUME;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_VOLUME;
}

export function computeBlockVolume(b: BlockBounds): number {
  const dx = b.maxX - b.minX + 1;
  const dy = b.maxY - b.minY + 1;
  const dz = b.maxZ - b.minZ + 1;
  if (dx <= 0 || dy <= 0 || dz <= 0) return 0;
  return dx * dy * dz;
}

export function checkBlockVolume(
  b: BlockBounds,
  maxVolume: number = readMaxBlockVolume(),
): VolumeCheck {
  const dx = b.maxX - b.minX + 1;
  const dy = b.maxY - b.minY + 1;
  const dz = b.maxZ - b.minZ + 1;
  if (dx <= 0 || dy <= 0 || dz <= 0) {
    return {
      ok: false,
      reason:
        `Inverted bounding box: min must be <= max on every axis ` +
        `(x:[${b.minX},${b.maxX}] y:[${b.minY},${b.maxY}] z:[${b.minZ},${b.maxZ}])`,
    };
  }
  const volume = dx * dy * dz;
  if (volume > maxVolume) {
    return {
      ok: false,
      volume,
      reason:
        `Bounding-box volume ${volume} exceeds VIZIER_MAX_BLOCK_VOLUME=${maxVolume}. ` +
        `Wide RFR sweeps crash DFHack. Use a smaller region, or have an ` +
        `orchestrator chunk the sweep server-side.`,
    };
  }
  return { ok: true, volume };
}
