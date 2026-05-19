import { describe, it, expect } from "vitest";
import { resolveListUnitsMask } from "../src/tools/units.js";

describe("resolveListUnitsMask", () => {
  it("returns the caller's mask unchanged when summary is not set", () => {
    expect(resolveListUnitsMask(undefined, { labors: true })).toEqual({
      labors: true,
    });
    expect(resolveListUnitsMask(false, { labors: true })).toEqual({
      labors: true,
    });
  });

  it("returns undefined when summary is not set and no mask is provided", () => {
    expect(resolveListUnitsMask(undefined, undefined)).toBeUndefined();
    expect(resolveListUnitsMask(false, undefined)).toBeUndefined();
  });

  it("forces profession+skills when summary:true and no mask", () => {
    expect(resolveListUnitsMask(true, undefined)).toEqual({
      profession: true,
      skills: true,
    });
  });

  it("merges profession+skills into a caller-provided mask under summary", () => {
    expect(
      resolveListUnitsMask(true, { labors: true, miscTraits: true }),
    ).toEqual({
      labors: true,
      miscTraits: true,
      profession: true,
      skills: true,
    });
  });

  it("does not let a caller turn profession/skills off under summary", () => {
    // Summary's contract requires those fields; the override must win.
    expect(
      resolveListUnitsMask(true, { profession: false, skills: false }),
    ).toEqual({ profession: true, skills: true });
  });
});
