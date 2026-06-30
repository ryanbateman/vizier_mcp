import { describe, it, expect } from "vitest";
import { DIG_MODE, firstHazardNear, type Tile } from "../src/tools/dig.js";

describe("DIG_MODE wire values", () => {
  it("maps friendly modes to the RFR TileDigDesignation enum", () => {
    expect(DIG_MODE.clear).toBe(0); // NO_DIG
    expect(DIG_MODE.mine).toBe(1); // DEFAULT_DIG
    expect(DIG_MODE.updown_stair).toBe(2);
    expect(DIG_MODE.channel).toBe(3);
    expect(DIG_MODE.ramp).toBe(4);
    expect(DIG_MODE.down_stair).toBe(5);
    expect(DIG_MODE.up_stair).toBe(6);
  });
});

describe("firstHazardNear", () => {
  const targets: Tile[] = [{ x: 10, y: 10, z: 5 }];

  it("returns null when no hazards", () => {
    expect(firstHazardNear(targets, new Set())).toBeNull();
  });

  it("flags a hazard on the target tile itself", () => {
    const hit = firstHazardNear(targets, new Set(["10,10,5"]));
    expect(hit?.hazardAt).toBe("10,10,5");
  });

  it("flags a hazard on an orthogonal neighbour (incl. z)", () => {
    expect(firstHazardNear(targets, new Set(["11,10,5"]))?.hazardAt).toBe("11,10,5");
    expect(firstHazardNear(targets, new Set(["10,10,6"]))?.hazardAt).toBe("10,10,6");
    expect(firstHazardNear(targets, new Set(["10,10,4"]))?.hazardAt).toBe("10,10,4");
  });

  it("ignores a diagonal-only hazard (not a 6-neighbour)", () => {
    expect(firstHazardNear(targets, new Set(["11,11,5"]))).toBeNull();
  });
});
