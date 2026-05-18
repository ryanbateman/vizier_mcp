import protobuf from "protobufjs";
import { writeFileSync, mkdirSync } from "fs";

const protoDir = "proto";
const outDir = "generated";

mkdirSync(outDir, { recursive: true });

const root = new protobuf.Root();

const protoFiles = [
  "CoreProtocol.proto",
  "Basic.proto",
  "BasicApi.proto",
  "RemoteFortressReader.proto",
  "AdventureControl.proto",
  "DwarfControl.proto",
  "ItemdefInstrument.proto",
  "isoworldremote.proto",
  "rename.proto",
  "ui_sidebar_mode.proto",
];

for (const file of protoFiles) {
  root.loadSync(`${protoDir}/${file}`);
}

const json = root.toJSON();

// Remove 'rule' fields from MapBlock — protobufjs serializes them but they conflict with oneof handling
const mapBlockFields = json.nested?.RemoteFortressReader?.nested?.MapBlock?.fields;
if (mapBlockFields) {
  delete mapBlockFields.mapX?.rule;
  delete mapBlockFields.mapY?.rule;
  delete mapBlockFields.mapZ?.rule;
}

writeFileSync(`${outDir}/proto.json`, JSON.stringify(json, null, 2));
console.log(`Generated ${outDir}/proto.json with ${Object.keys(json.nested || {}).length} top-level namespaces`);