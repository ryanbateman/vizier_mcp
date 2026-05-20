/**
 * Canonical profession → primary craft skill, used by workforce_report to
 * detect misfits. Conservative: only well-defined craft alignments are
 * included. Social/coordinative roles (Trader, Administrator, Child,
 * Peasant, Craftsman, Merchant, ...) have no canonical craft skill and
 * are intentionally absent — they are roles, not crafts, and treating
 * them as "mismatched" generates noise.
 *
 * Skill names use DFHack's resolved captions exactly (e.g. the odd
 * "Leatherworkering" spelling matches what the game emits).
 */
export const PROFESSION_ALIGNED_SKILL: Record<string, string> = {
  Miner: "Mining",

  // Stone / construction
  Mason: "Masonry",
  Engraver: "Engraving",

  // Wood
  "Wood Cutter": "Wood Cutting",
  Woodcutter: "Wood Cutting",
  Carpenter: "Carpentry",
  Bowyer: "Bowmaking",

  // Crafters
  Stonecrafter: "Stone Crafting",
  "Stone Crafter": "Stone Crafting",
  "Wood Crafter": "Wood Crafting",
  Woodcrafter: "Wood Crafting",
  "Bone Carver": "Bone Carving",
  "Metal Crafter": "Metal Crafting",
  Metalcrafter: "Metal Crafting",

  // Metalworking
  Blacksmith: "Metalsmithing",
  Metalsmith: "Metalsmithing",
  Weaponsmith: "Weaponsmithing",
  Armorer: "Armorsmithing",
  "Furnace Operator": "Furnace Operation",

  // Other crafts
  "Pump Operator": "Pump Operation",
  Leatherworker: "Leatherworkering",
  Tanner: "Tanning",
  Butcher: "Butchery",
  "Strand Extractor": "Extract Strands",
  Mechanic: "Mechanics",
  "Animal Trainer": "Animal Training",
  "Gem Cutter": "Gem Cutting",
  "Lye Maker": "Lye Making",
  "Potash Maker": "Potash Making",

  // Medical
  Surgeon: "Surgery",
  Diagnostician: "Diagnosis",
  "Wound Dresser": "Wound Dressing",

  // Food
  Fisherman: "Fishing",
  "Fish Dissector": "Fish Cleaning",
  Brewer: "Brewing",
  Cook: "Cooking",
  Herbalist: "Herbalism",

  // Farming
  Planter: "Growing",
  Farmer: "Growing",
  Grower: "Growing",

  // Records
  // (Administrator deliberately omitted — it's a coordination/noble role,
  // not a craft. Real administrators excel at Consoling/Negotiation/
  // Organization, not one canonical skill. Treating it as Record Keeping
  // misflags effective leaders as mismatched.)
  Clerk: "Record Keeping",
};

/**
 * Reverse lookup: given a skill name, which profession would canonically have
 * it. Used to phrase "underused legend" findings ("a legendary Miner in
 * Stonecrafter clothing"). Built once at module load.
 */
export const SKILL_EXPECTED_PROFESSION: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [prof, skill] of Object.entries(PROFESSION_ALIGNED_SKILL)) {
    // First mapping wins so a skill linked from multiple profession
    // synonyms (Mason / etc.) gets a stable label.
    if (out[skill] === undefined) out[skill] = prof;
  }
  return out;
})();
