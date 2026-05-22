import { describe, it, expect } from "vitest";
import {
  checkBlockVolume,
  computeBlockVolume,
} from "../src/block-volume.js";

describe("computeBlockVolume", () => {
  it("multiplies dx*dy*dz with inclusive bounds", () => {
    expect(computeBlockVolume({ minX: 0, maxX: 9, minY: 0, maxY: 9, minZ: 0, maxZ: 0 }))
      .toBe(100);
    expect(computeBlockVolume({ minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 }))
      .toBe(1);
  });

  it("returns 0 for an inverted box", () => {
    expect(computeBlockVolume({ minX: 5, maxX: 0, minY: 0, maxY: 9, minZ: 0, maxZ: 0 }))
      .toBe(0);
  });
});

describe("checkBlockVolume", () => {
  it("passes a small request", () => {
    const r = checkBlockVolume(
      { minX: 0, maxX: 15, minY: 0, maxY: 15, minZ: 100, maxZ: 100 },
      16_384,
    );
    expect(r.ok).toBe(true);
    expect(r.volume).toBe(256);
  });

  it("rejects the empirical crash threshold (200x200x1 = 40k)", () => {
    // This is the bounding box that took the DFHack process down — the
    // guard must reject it before forwarding to RFR.
    const r = checkBlockVolume({
      minX: 0,
      maxX: 199,
      minY: 0,
      maxY: 199,
      minZ: 100,
      maxZ: 100,
    });
    expect(r.ok).toBe(false);
    expect(r.volume).toBe(40_000);
    expect(r.reason).toMatch(/exceeds VIZIER_MAX_BLOCK_VOLUME/);
  });

  it("rejects an inverted bbox with a clear reason", () => {
    const r = checkBlockVolume({
      minX: 10,
      maxX: 0,
      minY: 0,
      maxY: 5,
      minZ: 0,
      maxZ: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Inverted bounding box/);
  });

  it("passes when volume is exactly at the budget", () => {
    const r = checkBlockVolume(
      { minX: 0, maxX: 99, minY: 0, maxY: 99, minZ: 0, maxZ: 0 },
      10_000,
    );
    expect(r.ok).toBe(true);
    expect(r.volume).toBe(10_000);
  });

  it("respects a custom budget", () => {
    const r = checkBlockVolume(
      { minX: 0, maxX: 31, minY: 0, maxY: 31, minZ: 0, maxZ: 0 },
      512,
    );
    expect(r.ok).toBe(false);
    expect(r.volume).toBe(1024);
  });
});
