import { describe, it, expect } from "vitest";
import {
  buildMilitiaReport,
  type SoldierInput,
  type SquadInput,
} from "../src/militia.js";

function soldier(over: Partial<SoldierInput> & { unitId: number }): SoldierInput {
  return {
    unitId: over.unitId,
    name: { firstName: "Urist", englishName: "Stockwise" },
    professionName: "Hammerdwarf",
    isSoldier: true,
    skills: [],
    inventory: [],
    ...over,
  };
}

function squad(over: Partial<SquadInput> & { squadId: number }): SquadInput {
  return {
    squadId: over.squadId,
    alias: "The Iron Fists",
    memberIds: [],
    ...over,
  };
}

const FULL_KIT = [
  { item: { typeName: "WEAPON/ITEM_WEAPON_AXE_BATTLE" } },
  { item: { typeName: "SHIELD/ITEM_SHIELD_SHIELD" } },
  { item: { typeName: "HELM/ITEM_HELM_HELM" } },
  { item: { typeName: "ARMOR/ITEM_ARMOR_BREASTPLATE" } },
  { item: { typeName: "PANTS/ITEM_PANTS_GREAVES" } },
  { item: { typeName: "GLOVES/ITEM_GLOVES_GAUNTLETS" } },
  { item: { typeName: "SHOES/ITEM_SHOES_BOOTS" } },
];

describe("buildMilitiaReport", () => {
  it("classifies a fully-equipped, trained soldier as ready", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [100] })],
      [
        soldier({
          unitId: 100,
          skills: [
            { name: "Axe", level: 10 },
            { name: "Fighting", level: 8 },
            { name: "Shield", level: 7 },
          ],
          inventory: FULL_KIT,
        }),
      ],
    );
    const m = r.squads[0].members[0];
    expect(m.fullyEquipped).toBe(true);
    expect(m.trained).toBe(true);
    expect(m.ready).toBe(true);
    expect(m.topWeapon).toEqual({ name: "Axe", level: 10 });
    expect(m.equipment.missing).toEqual([]);
    expect(r.squads[0].rollups).toEqual({
      total: 1,
      fullyEquipped: 1,
      trained: 1,
      ready: 1,
    });
  });

  it("identifies missing armor slots and a missing weapon", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [101] })],
      [
        soldier({
          unitId: 101,
          inventory: [
            { item: { typeName: "ARMOR/ITEM_ARMOR_BREASTPLATE" } },
            { item: { typeName: "PANTS/ITEM_PANTS_PANTS" } },
          ],
        }),
      ],
    );
    const m = r.squads[0].members[0];
    expect(m.equipment.weapon).toBeUndefined();
    expect(m.equipment.shield).toBeUndefined();
    expect(m.equipment.armor.head).toBeUndefined();
    expect(m.equipment.armor.body).toBe("ARMOR/ITEM_ARMOR_BREASTPLATE");
    expect(m.equipment.armor.legs).toBe("PANTS/ITEM_PANTS_PANTS");
    expect(m.equipment.missing).toEqual([
      "weapon",
      "shield",
      "head",
      "hands",
      "feet",
    ]);
    expect(m.fullyEquipped).toBe(false);
    expect(m.ready).toBe(false);
  });

  it("trained-but-unequipped is trained=true, ready=false", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [102] })],
      [
        soldier({
          unitId: 102,
          skills: [{ name: "Sword", level: 14 }],
          inventory: [], // no kit at all
        }),
      ],
    );
    const m = r.squads[0].members[0];
    expect(m.trained).toBe(true);
    expect(m.fullyEquipped).toBe(false);
    expect(m.ready).toBe(false);
    expect(m.combatSkills).toEqual([{ name: "Sword", level: 14 }]);
  });

  it("equipped-but-untrained is fullyEquipped=true, ready=false", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [103] })],
      [
        soldier({
          unitId: 103,
          skills: [{ name: "Axe", level: 1 }, { name: "Cooking", level: 9 }],
          inventory: FULL_KIT,
        }),
      ],
    );
    const m = r.squads[0].members[0];
    expect(m.fullyEquipped).toBe(true);
    expect(m.trained).toBe(false);
    expect(m.ready).toBe(false);
    // Cooking is not a combat skill — should not appear.
    expect(m.combatSkills).toEqual([{ name: "Axe", level: 1 }]);
  });

  it("orders members worst-equipped first within a squad", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [200, 201, 202] })],
      [
        soldier({ unitId: 200, inventory: FULL_KIT }),                   // 0 missing
        soldier({ unitId: 201, inventory: [] }),                          // 7 missing
        soldier({ unitId: 202, inventory: FULL_KIT.slice(0, 3) }),       // some missing
      ],
    );
    expect(r.squads[0].members.map((m) => m.unitId)).toEqual([201, 202, 200]);
  });

  it("isSoldier units not in any squad land in unsquaddedSoldiers", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [300] })],
      [
        soldier({ unitId: 300, inventory: FULL_KIT }),
        soldier({ unitId: 301, isSoldier: true, inventory: [] }),
        soldier({ unitId: 302, isSoldier: false }), // civilian — should not appear anywhere
      ],
    );
    expect(r.squads[0].members.map((m) => m.unitId)).toEqual([300]);
    expect(r.unsquaddedSoldiers.map((m) => m.unitId)).toEqual([301]);
  });

  it("returns a stub member if the squad lists an unknown unit id", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [999] })],
      [], // no unit data for 999
    );
    const m = r.squads[0].members[0];
    expect(m.unitId).toBe(999);
    expect(m.equipment.missing.length).toBe(7); // everything missing
    expect(m.combatSkills).toEqual([]);
  });

  it("honors the trained_threshold override", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberIds: [400] })],
      [
        soldier({
          unitId: 400,
          skills: [{ name: "Fighting", level: 4 }],
          inventory: FULL_KIT,
        }),
      ],
      { trainedThreshold: 3 },
    );
    expect(r.trainedThreshold).toBe(3);
    expect(r.squads[0].members[0].trained).toBe(true);
  });

  it("renders squad display name from alias preferred, NameInfo as fallback", () => {
    const r = buildMilitiaReport(
      [
        squad({ squadId: 1, alias: "The Iron Fists", memberIds: [] }),
        squad({
          squadId: 2,
          alias: undefined,
          name: { englishName: "Stalwartdams" },
          memberIds: [],
        }),
        squad({ squadId: 3, alias: undefined, memberIds: [] }),
      ],
      [],
    );
    expect(r.squads.map((s) => s.squadName)).toEqual([
      "The Iron Fists",
      "Stalwartdams",
      "(unnamed)",
    ]);
  });
});
