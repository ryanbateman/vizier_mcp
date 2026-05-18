import protobuf from "protobufjs";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let root: protobuf.Root | null = null;

export function getProtoRoot(): protobuf.Root {
  if (root) return root;

  const jsonPath = resolve(__dirname, "../../generated/proto.json");
  const json = JSON.parse(readFileSync(jsonPath, "utf-8"));
  root = protobuf.Root.fromJSON(json);
  return root;
}

export function lookupType(fqn: string): protobuf.Type {
  return getProtoRoot().lookupType(fqn);
}

export interface MethodDef {
  name: string;
  inputType: string;
  outputType: string;
  plugin: string | null;
}

export const FUNC_DEFS: [string | null, string, Record<string, [string, string]>][] = [
  [null, "dfproto", {
    BindMethod: ["CoreBindRequest", "CoreBindReply"],
    RunCommand: ["CoreRunCommandRequest", "EmptyMessage"],
    CoreSuspend: ["EmptyMessage", "IntMessage"],
    CoreResume: ["EmptyMessage", "IntMessage"],
    RunLua: ["CoreRunLuaRequest", "StringListMessage"],
    GetVersion: ["EmptyMessage", "StringMessage"],
    GetDFVersion: ["EmptyMessage", "StringMessage"],
    GetWorldInfo: ["EmptyMessage", "GetWorldInfoOut"],
    ListEnums: ["EmptyMessage", "ListEnumsOut"],
    ListJobSkills: ["EmptyMessage", "ListJobSkillsOut"],
    ListMaterials: ["ListMaterialsIn", "ListMaterialsOut"],
    ListUnits: ["ListUnitsIn", "ListUnitsOut"],
    ListSquads: ["ListSquadsIn", "ListSquadsOut"],
    SetUnitLabors: ["SetUnitLaborsIn", "EmptyMessage"],
  }],
  ["rename", "dfproto", {
    RenameSquad: ["RenameSquadIn", "EmptyMessage"],
    RenameUnit: ["RenameUnitIn", "EmptyMessage"],
    RenameBuilding: ["RenameBuildingIn", "EmptyMessage"],
  }],
  ["RemoteFortressReader", "RemoteFortressReader", {
    GetMaterialList: ["EmptyMessage", "MaterialList"],
    GetGrowthList: ["EmptyMessage", "MaterialList"],
    GetBlockList: ["BlockRequest", "BlockList"],
    CheckHashes: ["EmptyMessage", "EmptyMessage"],
    GetTiletypeList: ["EmptyMessage", "TiletypeList"],
    GetPlantList: ["BlockRequest", "PlantList"],
    GetUnitList: ["EmptyMessage", "UnitList"],
    GetUnitListInside: ["BlockRequest", "UnitList"],
    GetViewInfo: ["EmptyMessage", "ViewInfo"],
    GetMapInfo: ["EmptyMessage", "MapInfo"],
    ResetMapHashes: ["EmptyMessage", "EmptyMessage"],
    GetItemList: ["EmptyMessage", "MaterialList"],
    GetBuildingDefList: ["EmptyMessage", "BuildingList"],
    GetWorldMap: ["EmptyMessage", "WorldMap"],
    GetWorldMapNew: ["EmptyMessage", "WorldMap"],
    GetRegionMaps: ["EmptyMessage", "RegionMaps"],
    GetRegionMapsNew: ["EmptyMessage", "RegionMaps"],
    GetCreatureRaws: ["EmptyMessage", "CreatureRawList"],
    GetPartialCreatureRaws: ["ListRequest", "CreatureRawList"],
    GetWorldMapCenter: ["EmptyMessage", "WorldMap"],
    GetPlantRaws: ["EmptyMessage", "PlantRawList"],
    GetPartialPlantRaws: ["ListRequest", "PlantRawList"],
    CopyScreen: ["EmptyMessage", "ScreenCapture"],
    PassKeyboardEvent: ["KeyboardEvent", "EmptyMessage"],
    SendDigCommand: ["DigCommand", "EmptyMessage"],
    SetPauseState: ["SingleBool", "EmptyMessage"],
    GetPauseState: ["EmptyMessage", "SingleBool"],
    GetVersionInfo: ["EmptyMessage", "VersionInfo"],
    GetReports: ["EmptyMessage", "Status"],
    GetLanguage: ["EmptyMessage", "Language"],
  }],
];

const typeNames = new Map<string, string>();

for (const [, ns, methods] of FUNC_DEFS) {
  for (const [, [input, output]] of Object.entries(methods)) {
    if (!typeNames.has(input)) typeNames.set(input, `${ns}.${input}`);
    if (!typeNames.has(output)) typeNames.set(output, `${ns}.${output}`);
  }
}

export function getTypeFqn(shortName: string): string {
  const fqn = typeNames.get(shortName);
  if (!fqn) throw new Error(`Unknown proto type: ${shortName}`);
  return fqn;
}

export interface BoundMethod {
  id: number;
  inputType: protobuf.Type;
  outputType: protobuf.Type;
}

export function getAllMethodDefs(): MethodDef[] {
  const defs: MethodDef[] = [];
  for (const [plugin, _ns, methods] of FUNC_DEFS) {
    for (const [name, [input, output]] of Object.entries(methods)) {
      if (name === "BindMethod") continue;
      defs.push({
        name,
        inputType: getTypeFqn(input),
        outputType: getTypeFqn(output),
        plugin,
      });
    }
  }
  return defs;
}