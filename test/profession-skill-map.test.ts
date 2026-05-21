import { describe, it, expect } from "vitest";
import {
  PROFESSION_ALIGNED_SKILL,
  SKILL_EXPECTED_PROFESSION,
} from "../src/profession-skill-map.js";

describe("profession-skill-map", () => {
  it("maps craft roles to their canonical skill and omits coordinative roles", () => {
    // Representative sample of each behaviour, not an enumeration of the
    // full map (the map IS the spec; round-tripping every entry just
    // restates it).
    expect(PROFESSION_ALIGNED_SKILL.Miner).toBe("Mining");
    expect(PROFESSION_ALIGNED_SKILL.Armorer).toBe("Armorsmithing");
    expect(PROFESSION_ALIGNED_SKILL.Leatherworker).toBe("Leatherworkering");
    // Roles intentionally absent — they're coordination, not crafts.
    expect(PROFESSION_ALIGNED_SKILL.Trader).toBeUndefined();
    expect(PROFESSION_ALIGNED_SKILL.Child).toBeUndefined();
    expect(PROFESSION_ALIGNED_SKILL.Administrator).toBeUndefined();
  });

  it("reverse-map derives an expected profession for each canonical skill", () => {
    // This isn't restating the forward map — SKILL_EXPECTED_PROFESSION is
    // derived (first-wins on synonyms), so a representative check on the
    // derivation is worth keeping.
    expect(SKILL_EXPECTED_PROFESSION.Mining).toBe("Miner");
    expect(SKILL_EXPECTED_PROFESSION.Armorsmithing).toBe("Armorer");
    expect(SKILL_EXPECTED_PROFESSION["Pump Operation"]).toBe("Pump Operator");
  });
});
