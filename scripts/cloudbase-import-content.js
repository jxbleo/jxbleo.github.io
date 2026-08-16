#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const DEFAULT_ENV_ID = "mrcat-dev-d9gwy2v1icdfdf597";
const DEFAULT_REGION = "ap-shanghai";

const COLLECTIONS = {
  sets: {
    file: ".cloudbase-private/import/sets-cloudbase.json",
    keyField: "set_id",
  },
  grading_keys: {
    file: ".cloudbase-private/import/grading-keys-cloudbase.json",
    keyField: "set_id",
  },
  intensive_listening_materials: {
    file: ".cloudbase-private/import/intensive-listening-materials-cloudbase.json",
    keyField: "material_id",
  },
  system_config: {
    file: ".cloudbase-private/import/system-config-cloudbase.json",
    keyField: "config_key",
  },
  vocabulary_lexicon: {
    file: ".cloudbase-private/import/vocabulary-lexicon-cloudbase.json",
    keyField: "lexicon_id",
  },
};

function usage() {
  console.log(`Usage:
  node scripts/cloudbase-import-content.js [options]

Default mode is a dry run. Add --apply to write to CloudBase.

Options:
  --apply                    Execute CloudBase writes
  --only <list>              Comma-separated collections: sets,grading_keys,intensive_listening_materials,system_config,vocabulary_lexicon
  --ids <list>               Comma-separated keys to import, matched against each collection key field
  --offset <number>           Skip this many input records before importing, default 0
  --overwrite-existing       Update existing records instead of insert-missing only
  --env-id <envId>           CloudBase environment ID
  --region <region>          CloudBase region
  --chunk-size <number>      Records per CloudBase command, default 10
  --tcb <path>               tcb executable, default "tcb"
  --help                     Show this help

Examples:
  npm run cloudbase:import:content
  npm run cloudbase:import:content -- --apply
  npm run cloudbase:import:content -- --apply --only sets,grading_keys
  npm run cloudbase:import:content -- --apply --only grading_keys --ids NGSL-C --overwrite-existing
  npm run cloudbase:import:content -- --only vocabulary_lexicon
`);
}

function parseArgs(argv) {
  const options = {
    apply: false,
    only: ["sets", "grading_keys", "intensive_listening_materials"],
    ids: null,
    offset: 0,
    overwriteExisting: false,
    envId: process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    region: process.env.TCB_REGION || DEFAULT_REGION,
    chunkSize: 10,
    tcb: process.env.TCB_BIN || "tcb",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--overwrite-existing") {
      options.overwriteExisting = true;
    } else if (arg === "--only") {
      options.only = requireValue(argv, ++index, arg).split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg === "--ids") {
      options.ids = requireValue(argv, ++index, arg).split(",").map((item) => item.trim()).filter(Boolean);
    } else if (arg === "--offset") {
      const value = Number(requireValue(argv, ++index, arg));
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--offset must be a non-negative integer");
      }
      options.offset = value;
    } else if (arg === "--env-id" || arg === "-e") {
      options.envId = requireValue(argv, ++index, arg);
    } else if (arg === "--region" || arg === "-r") {
      options.region = requireValue(argv, ++index, arg);
    } else if (arg === "--chunk-size") {
      const value = Number(requireValue(argv, ++index, arg));
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error("--chunk-size must be an integer from 1 to 100");
      }
      options.chunkSize = value;
    } else if (arg === "--tcb") {
      options.tcb = requireValue(argv, ++index, arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.only.forEach((name) => {
    if (!COLLECTIONS[name]) throw new Error(`Unknown collection in --only: ${name}`);
  });
  if (options.ids && options.ids.length === 0) {
    throw new Error("--ids requires at least one key");
  }

  return options;
}

function requireValue(argv, index, optionName) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function readJsonLines(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${index + 1} is not valid JSON: ${error.message}`);
      }
    });
}

function assertUnique(records, keyField, collectionName) {
  const seen = new Set();
  records.forEach((record, index) => {
    const key = record[keyField];
    if (!key || typeof key !== "string") {
      throw new Error(`${collectionName} record ${index + 1} is missing string ${keyField}`);
    }
    if (seen.has(key)) {
      throw new Error(`${collectionName} import has duplicate ${keyField}: ${key}`);
    }
    seen.add(key);
  });
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function buildMgoPayload(collectionName, keyField, records, overwriteExisting) {
  const updates = records.map((record) => {
    const update = overwriteExisting
      ? { $set: record }
      : { $setOnInsert: record };
    return {
      q: { [keyField]: record[keyField] },
      u: update,
      upsert: true,
    };
  });

  return [{
    TableName: collectionName,
    CommandType: "UPDATE",
    Command: JSON.stringify({
      update: collectionName,
      updates,
    }),
  }];
}

function redactOutput(text) {
  return String(text || "")
    .replace(/"answers"\s*:\s*\{[\s\S]*?\}\s*,\s*"explanations"/g, "\"answers\":\"[redacted]\",\"explanations\"")
    .replace(/"explanations"\s*:\s*\{[\s\S]*?\}\s*,\s*"scoring_rules"/g, "\"explanations\":\"[redacted]\",\"scoring_rules\"");
}

function runTcb(options, payload) {
  const result = spawnSync(options.tcb, [
    "-e", options.envId,
    "-r", options.region,
    "db", "nosql", "execute",
    "--command", JSON.stringify(payload),
    "--json",
  ], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.status !== 0) {
    process.stderr.write(redactOutput(result.stderr || result.stdout));
    throw new Error(`tcb exited with status ${result.status}`);
  }

  const output = (result.stdout || "").trim();
  if (output) console.log(redactOutput(output));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = options.apply ? "APPLY" : "DRY RUN";
  const writeMode = options.overwriteExisting ? "overwrite existing records" : "insert missing records only";
  const idFilter = options.ids ? new Set(options.ids) : null;

  console.log(`CloudBase content import: ${mode}`);
  console.log(`Environment: ${options.envId} (${options.region})`);
  console.log(`Write mode: ${writeMode}`);
  if (idFilter) console.log(`ID filter: ${options.ids.join(", ")}`);
  if (options.offset) console.log(`Input offset: ${options.offset}`);
  console.log("");

  for (const collectionName of options.only) {
    const config = COLLECTIONS[collectionName];
    const filePath = path.join(projectRoot, config.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing import file: ${config.file}`);
    }

    const allRecords = readJsonLines(filePath).slice(options.offset);
    const records = idFilter
      ? allRecords.filter((record) => idFilter.has(record[config.keyField]))
      : allRecords;
    if (idFilter && records.length === 0) {
      console.log(`${collectionName}: 0 matching records from ${config.file}`);
      continue;
    }
    assertUnique(records, config.keyField, collectionName);
    const batches = chunk(records, options.chunkSize);

    console.log(`${collectionName}: ${records.length} records from ${config.file}`);
    console.log(`  key: ${config.keyField}; chunks: ${batches.length}`);

    if (!options.apply) continue;

    batches.forEach((batch, index) => {
      const first = batch[0][config.keyField];
      const last = batch[batch.length - 1][config.keyField];
      console.log(`  applying chunk ${index + 1}/${batches.length}: ${first} ... ${last}`);
      const payload = buildMgoPayload(collectionName, config.keyField, batch, options.overwriteExisting);
      runTcb(options, payload);
    });
  }

  if (!options.apply) {
    console.log("");
    console.log("Dry run complete. Re-run with --apply to write to CloudBase.");
  } else {
    console.log("");
    console.log("CloudBase content import complete.");
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
