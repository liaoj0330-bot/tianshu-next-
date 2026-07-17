import { resolve, sep } from "node:path";
import { openStore } from "../src/core/store.mjs";
import { buildObsidianReadModel } from "../src/product/obsidian-read-model.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--state", "--output"].includes(key)) throw new Error(`unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
    result[key.slice(2)] = value;
    index += 1;
  }
  if (!result.state || !result.output) {
    throw new Error("usage: node scripts/build-obsidian-read-model.mjs --state <state.sqlite> --output <isolated-directory>");
  }
  return result;
}

const args = parseArgs(process.argv.slice(2));
const statePath = resolve(args.state);
const outputPath = resolve(args.output);
const outputPrefix = `${outputPath}${sep}`.toLocaleLowerCase();
if (statePath.toLocaleLowerCase() === outputPath.toLocaleLowerCase()
  || statePath.toLocaleLowerCase().startsWith(outputPrefix)) {
  throw new Error("SQLite state file must be outside the generated Obsidian directory");
}

const db = openStore(statePath);
try {
  console.log(JSON.stringify(buildObsidianReadModel(db, outputPath), null, 2));
} finally {
  db.close();
}
