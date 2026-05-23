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
  /**
   * Historical figure id (BasicUnitInfo.histfig_id). DF uses this ID space
   * for persistent identity across deaths/retirements. Crucially,
   * BasicSquadInfo.members[] contains *histfigIds*, not unitIds — so any
   * squad-membership join MUST be keyed by histfigId.
   */
  histfigId?: number;
  skills?: Array<{ id: number; name?: string; nameNoun?: string }>;
  labors?: number[] | Array<{ id: number; name?: string }>;
  race?: number | { matType: number; matIndex: number };
  raceName?: string;
  /** Tile position. BasicUnitInfo fields 13-15. */
  posX?: number;
  posY?: number;
  posZ?: number;
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

/** RFR MatPair: a (matType, matIndex) pair shared by Item.type, Item.material, etc. */
export interface MatPair {
  matType: number;
  matIndex: number;
}

/** RFR ItemImprovement: decoration/inlay/engraving on an item. Presence of any
 * improvement is the closest proxy RFR offers for "this item is valuable"
 * (RFR has no quality field and no material-value field). */
export interface ItemImprovement {
  material?: MatPair;
  shape?: number;
  specificType?: number;
  type?: number;
}

/** RFR Item: a single physical item on a tile. Stockpile assignment is NOT
 * exposed (RFR has no stockpile-membership linkage); position is the item's
 * tile only. */
export interface RfrItem {
  id?: number;
  pos?: { x?: number; y?: number; z?: number };
  type?: MatPair;
  material?: MatPair;
  stackSize?: number;
  volume?: number;
  improvements?: ItemImprovement[];
  flags1?: number;
  flags2?: number;
}

/** RFR MapBlock: a 16×16 tile chunk. `items[]` is what item_census consumes. */
export interface MapBlockWithItems {
  mapX?: number;
  mapY?: number;
  mapZ?: number;
  items?: RfrItem[];
  [key: string]: unknown;
}

/** RFR BlockList response (a sweep over GetBlockList returns these aggregated). */
export interface BlockListOut {
  mapBlocks?: MapBlockWithItems[];
  mapX?: number;
  mapY?: number;
  [key: string]: unknown;
}

/** RFR MapInfo: embark dimensions/origin in BLOCK coords (each block = 16 tiles).
 * Tile-space conversion: `tileX = blockX * 16`. */
export interface MapInfoOut {
  blockSizeX?: number;
  blockSizeY?: number;
  blockSizeZ?: number;
  blockPosX?: number;
  blockPosY?: number;
  blockPosZ?: number;
  worldName?: string;
  worldNameEnglish?: string;
  saveName?: string;
}

/** RFR ViewInfo: the player's current camera + cursor position in tile coords. */
export interface ViewInfoOut {
  viewPosX?: number;
  viewPosY?: number;
  viewPosZ?: number;
  viewSizeX?: number;
  viewSizeY?: number;
  cursorPosX?: number;
  cursorPosY?: number;
  cursorPosZ?: number;
  followUnitId?: number;
  followItemId?: number;
}
