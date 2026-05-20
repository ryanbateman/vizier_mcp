import { describe, it, expect } from "vitest";
import {
  PROFESSION_ALIGNED_SKILL,
  SKILL_EXPECTED_PROFESSION,
} from "../src/profession-skill-map.js";

describe("profession-skill-map", () => {
  it("covers the canonical craft roles seen in the live test fort", () => {
    expect(PROFESSION_ALIGNED_SKILL.Miner).toBe("Mining");
    expect(PROFESSION_ALIGNED_SKILL.Carpenter).toBe("Carpentry");
    expect(PROFESSION_ALIGNED_SKILL.Armorer).toBe("Armorsmithing");
    expect(PROFESSION_ALIGNED_SKILL.Planter).toBe("Growing");
    expect(PROFESSION_ALIGNED_SKILL.Stonecrafter).toBe("Stone Crafting");
    expect(PROFESSION_ALIGNED_SKILL["Pump Operator"]).toBe("Pump Operation");
    expect(PROFESSION_ALIGNED_SKILL.Leatherworker).toBe("Leatherworkering");
  });

  it("intentionally omits social/coordinative roles", () => {
    expect(PROFESSION_ALIGNED_SKILL.Trader).toBeUndefined();
    expect(PROFESSION_ALIGNED_SKILL.Child).toBeUndefined();
    expect(PROFESSION_ALIGNED_SKILL.Craftsman).toBeUndefined();
    expect(PROFESSION_ALIGNED_SKILL.Peasant).toBeUndefined();
    expect(PROFESSION_ALIGNED_SKILL.Merchant).toBeUndefined();
  });

  it("reverse-map gives an expected profession for canonical skills", () => {
    expect(SKILL_EXPECTED_PROFESSION.Mining).toBe("Miner");
    expect(SKILL_EXPECTED_PROFESSION.Armorsmithing).toBe("Armorer");
    expect(SKILL_EXPECTED_PROFESSION["Pump Operation"]).toBe("Pump Operator");
  });
});
