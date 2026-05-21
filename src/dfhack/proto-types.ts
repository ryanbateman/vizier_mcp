export interface EnumItem {
  value: number;
  name: string;
}

export interface ListEnumsOut {
  unitFlags1: EnumItem[];
  unitFlags2: EnumItem[];
  unitFlags3: EnumItem[];
  deathInfoFlags: EnumItem[];
  [key: string]: unknown;
}

export interface SkillDef {
  id: number;
  key: string;
  caption: string;
  captionNoun: string;
}

export interface ProfessionDef {
  id: number;
  key: string;
  caption: string;
}

export interface LaborDef {
  id: number;
  key: string;
  caption: string;
}

export interface ListJobSkillsOut {
  profession: ProfessionDef[];
  skill: SkillDef[];
  labor: LaborDef[];
}

export interface MaterialPair {
  matType: number;
  matIndex: number;
}

export interface MaterialDef {
  matPair: MaterialPair;
  id: string;
  name: string;
}

export interface MaterialList {
  materialList: MaterialDef[];
}

export interface ResolvedName {
  firstName?: string;
  lastName?: string;
  englishName?: string;
  nickname?: string;
}

export interface UnitBase {
  name?: ResolvedName;
  profession?: number;
  professionName?: string;
  gender?: number;
  genderName?: string;
  flags1?: number;
  flags1Names?: string[];
  flags2?: number;
  flags2Names?: string[];
  flags3?: number;
  flags3Names?: string[];
  deathFlags?: number;
  deathFlagsNames?: string[];
  /** Unique death-event id; higher = more recent. -1 / undefined when alive. */
  deathId?: number;
  skills?: Array<{ id: number; name?: string; nameNoun?: string }>;
  labors?: number[] | Array<{ id: number; name?: string }>;
  race?: number | { matType: number; matIndex: number };
  raceName?: string;
}

export interface ListUnitsOut {
  value: UnitBase[];
}

export interface ListMaterialsOut {
  value: MaterialDef[];
}

export interface CreatureRaw {
  id?: number;
  /**
   * RFR's GetUnitList returns a pre-composed string ("firstName englishName"),
   * which is NOT what the DF UI displays (the UI shows the *dwarvish* surname
   * from ListUnits). Tool handlers that surface CreatureRaw should overlay
   * the structured name from ListUnits before responding — see
   * overlayStructuredNames in tools/helpers.ts.
   */
  name?: string | ResolvedName;
  race?: number | { matType: number; matIndex: number };
  raceName?: string;
  profession?: number;
  professionName?: string;
  inventory?: Array<{
    item?: {
      material?: { matType: number; matIndex: number };
      type?: { matType: number; matIndex: number };
      materialName?: string;
      typeName?: string;
    };
  }>;
  [key: string]: unknown;
}

export interface UnitList {
  creatureList: CreatureRaw[];
}

export interface CreatureRawDef {
  index: number;
  creatureId: string;
  name?: string[];
}

export interface CreatureRawList {
  creatureRaws?: CreatureRawDef[];
}

export interface GetWorldInfoOut {
  mode?: number;
  // Stable per-save identifier (proto field `save_dir`). There is no
  // numeric world id in this message — use this to detect a save change.
  saveDir?: string;
  worldName?: unknown;
  civId?: number;
  siteId?: number;
}
