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

export interface UnitBase {
  name?: {
    firstName?: string;
    lastName?: string;
    englishName?: string;
    nickname?: string;
  };
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
  skills?: Array<{ id: number; name?: string; nameNoun?: string }>;
  labors?: number[] | Array<{ id: number; name?: string }>;
}

export interface ListUnitsOut {
  value: UnitBase[];
}

export interface ListMaterialsOut {
  value: MaterialDef[];
}

export interface CreatureRaw {
  inventory?: Array<{
    item?: {
      material?: { matType: number; matIndex: number };
      type?: { matType: number; matIndex: number };
      materialName?: string;
      typeName?: string;
    };
  }>;
}

export interface UnitList {
  creatureList: CreatureRaw[];
}

export interface GetWorldInfoOut {
  worldName: string;
  worldId: number;
  gameMode: number;
}
