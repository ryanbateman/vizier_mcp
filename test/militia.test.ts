import { describe, it, expect } from "vitest";
import {
  buildMilitiaReport,
  type SoldierInput,
  type SquadInput,
} from "../src/militia.js";

// Fixtures: histfigId is what the squad-join keys on, so default to a
// distinct value that follows the unitId for clarity in assertions.
function soldier(over: Partial<SoldierInput> & { unitId: number }): SoldierInput {
  return {
    unitId: over.unitId,
    histfigId: over.histfigId ?? over.unitId + 1000,
    name: { firstName: "Urist", englishName: "Stockwise" },
    raceName: "dwarf",
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
    memberHistfigIds: [],
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
  it("joins squad members via histfigId, not unitId", () => {
    // Setting unitId and histfigId to different values catches the bug
    // where we previously joined by the wrong key (which let unrelated
    // animals' unitIds masquerade as squad members).
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberHistfigIds: [428] })],
      [
        soldier({
          unitId: 425,
          histfigId: 428,
          skills: [
            { name: "Axe", level: 10 },
            { name: "Fighting", level: 8 },
          ],
          inventory: FULL_KIT,
        }),
      ],
    );
    expect(r.squads[0].members).toHaveLength(1);
    expect(r.squads[0].members[0].unitId).toBe(425);
    expect(r.squads[0].members[0].histfigId).toBe(428);
    expect(r.squads[0].members[0].ready).toBe(true);
  });

  it("filters out empty squad slots (-1) and counts them in emptySlots", () => {
    const r = buildMilitiaReport(
      [
        squad({
          squadId: 1,
          memberHistfigIds: [-1, -1, 100, -1, 200],
        }),
      ],
      [
        soldier({ unitId: 1, histfigId: 100 }),
        soldier({ unitId: 2, histfigId: 200 }),
      ],
    );
    expect(r.squads[0].members.map((m) => m.histfigId)).toEqual([100, 200]);
    expect(r.squads[0].rollups).toMatchObject({
      totalSlots: 5,
      filled: 2,
      emptySlots: 3,
    });
  });

  it("surfaces unmatched histfigIds as unresolvedHistfigIds, not stub members", () => {
    const r = buildMilitiaReport(
      [
        squad({
          squadId: 1,
          memberHistfigIds: [100, 999, 200, 888],
        }),
      ],
      [
        soldier({ unitId: 1, histfigId: 100 }),
        soldier({ unitId: 2, histfigId: 200 }),
        // 999 and 888 have no matching soldier (dead/off-map/stale).
      ],
    );
    expect(r.squads[0].members.map((m) => m.histfigId)).toEqual([100, 200]);
    expect(r.squads[0].unresolvedHistfigIds).toEqual([999, 888]);
    expect(r.squads[0].rollups.filled).toBe(2);
  });

  it("surfaces raceName so non-dwarf squad members are visible", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberHistfigIds: [100] })],
      [
        soldier({
          unitId: 1,
          histfigId: 100,
          raceName: "crundle", // not a dwarf — the user should see this
          inventory: FULL_KIT,
          skills: [{ name: "Climbing", level: 15 }],
        }),
      ],
    );
    expect(r.squads[0].members[0].raceName).toBe("crundle");
  });

  it("classifies a fully-equipped, trained soldier as ready", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberHistfigIds: [100] })],
      [
        soldier({
          unitId: 1,
          histfigId: 100,
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
  });

  it("identifies missing armor slots and a missing weapon", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberHistfigIds: [101] })],
      [
        soldier({
          unitId: 1,
          histfigId: 101,
          inventory: [
            { item: { typeName: "ARMOR/ITEM_ARMOR_BREASTPLATE" } },
            { item: { typeName: "PANTS/ITEM_PANTS_PANTS" } },
          ],
        }),
      ],
    );
    const m = r.squads[0].members[0];
    expect(m.equipment.weapon).toBeUndefined();
    expect(m.equipment.armor.body).toBe("ARMOR/ITEM_ARMOR_BREASTPLATE");
    expect(m.equipment.missing).toEqual([
      "weapon",
      "shield",
      "head",
      "hands",
      "feet",
    ]);
    expect(m.fullyEquipped).toBe(false);
  });

  it("orders members worst-equipped first within a squad", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberHistfigIds: [100, 101, 102] })],
      [
        soldier({ unitId: 1, histfigId: 100, inventory: FULL_KIT }),
        soldier({ unitId: 2, histfigId: 101, inventory: [] }),
        soldier({ unitId: 3, histfigId: 102, inventory: FULL_KIT.slice(0, 3) }),
      ],
    );
    expect(r.squads[0].members.map((m) => m.unitId)).toEqual([2, 3, 1]);
  });

  it("isSoldier units not in any squad land in unsquaddedSoldiers", () => {
    const r = buildMilitiaReport(
      [squad({ squadId: 1, memberHistfigIds: [100] })],
      [
        soldier({ unitId: 1, histfigId: 100, inventory: FULL_KIT }),
        soldier({ unitId: 2, histfigId: 101, isSoldier: true }),
        soldier({ unitId: 3, histfigId: 102, isSoldier: false }), // civilian, never appears
      ],
    );
    expect(r.squads[0].members.map((m) => m.unitId)).toEqual([1]);
    expect(r.unsquaddedSoldiers.map((m) => m.unitId)).toEqual([2]);
  });

  it("honors trained_threshold and renders squad display name fallbacks", () => {
    const r = buildMilitiaReport(
      [
        squad({ squadId: 1, alias: "The Iron Fists", memberHistfigIds: [100] }),
        squad({
          squadId: 2,
          alias: undefined,
          name: { englishName: "Stalwartdams" },
          memberHistfigIds: [],
        }),
        squad({ squadId: 3, alias: undefined, memberHistfigIds: [] }),
      ],
      [
        soldier({
          unitId: 1,
          histfigId: 100,
          skills: [{ name: "Fighting", level: 4 }],
          inventory: FULL_KIT,
        }),
      ],
      { trainedThreshold: 3 },
    );
    expect(r.trainedThreshold).toBe(3);
    expect(r.squads[0].members[0].trained).toBe(true);
    expect(r.squads.map((s) => s.squadName)).toEqual([
      "The Iron Fists",
      "Stalwartdams",
      "(unnamed)",
    ]);
  });
});
