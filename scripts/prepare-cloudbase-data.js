const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.resolve(process.argv[2] || path.join(projectRoot, ".cloudbase-private"));
const privateRoot = path.join(outputRoot, "import");
const publicRoot = path.join(outputRoot, "public");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function writeJsonLines(filePath, values) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    values.map((value) => JSON.stringify(value)).join("\n") + "\n"
  );
}

function writeVocabularyFallback(filePath, unit) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    "window.__VOCABULARY_UNITS__ = window.__VOCABULARY_UNITS__ || {};\n" +
      `window.__VOCABULARY_UNITS__[${JSON.stringify(unit.id)}] = ` +
      JSON.stringify(unit, null, 2) +
      ";\n"
  );
}

function listJson(dirPath) {
  return fs.readdirSync(dirPath)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(dirPath, name));
}

function withoutPrivateFields(value) {
  if (Array.isArray(value)) return value.map(withoutPrivateFields);
  if (!value || typeof value !== "object") return value;
  const output = {};
  Object.entries(value).forEach(([key, child]) => {
    if (["answer", "answers", "evidence", "explanation", "correctAnswer"].includes(key)) return;
    output[key] = withoutPrivateFields(child);
  });
  return output;
}

function extractBbc(source) {
  const answers = {};
  const explanations = {};

  (source.blanks || []).forEach((item) => {
    answers[item.id] = item.answer;
    explanations[item.id] = item.evidence || "";
  });
  (source.multipleChoice || []).forEach((item) => {
    answers[item.id] = item.answer;
    explanations[item.id] = item.evidence || "";
  });
  (source.matching || []).forEach((group) => {
    (group.pairs || []).forEach((pair, index) => {
      const key = `${group.id}-${index}`;
      answers[key] = (group.answer || [])[index] || "";
      explanations[key] = pair.right || "";
    });
  });

  return {
    publicData: withoutPrivateFields(source),
    gradingKey: {
      set_id: source.id,
      grading_version: "1",
      answers,
      explanations,
      scoring_rules: { type: "exact_normalized" },
    },
  };
}

function extractIelts(source) {
  const answers = {};
  const explanations = {};

  (source.questions || []).forEach((questionSet) => {
    if (questionSet.example && questionSet.example.id && questionSet.example.answer != null) {
      answers[questionSet.example.id] = questionSet.example.answer;
      explanations[questionSet.example.id] = questionSet.example.evidence || "";
    }
    (questionSet.items || []).forEach((item) => {
      if (!item.id || item.answer == null) return;
      answers[item.id] = item.answer;
      explanations[item.id] = item.evidence || item.explanation || "";
    });
  });

  return {
    publicData: withoutPrivateFields(source),
    gradingKey: {
      set_id: source.id,
      grading_version: "1",
      answers,
      explanations,
      scoring_rules: { type: "ielts_normalized" },
    },
  };
}

function extractVocabulary(source) {
  const answers = {};
  const explanations = {};
  const publicData = JSON.parse(JSON.stringify(source));

  (publicData.quizGroups || []).forEach((group) => {
    (group.questions || []).forEach((question) => {
      const key = `${group.id}:${question.number}`;
      question.questionKey = key;
      answers[key] = question.answer;
      explanations[key] = question.explanation || "";
      delete question.answer;
      delete question.explanation;
    });
  });

  return {
    publicData,
    gradingKey: {
      set_id: source.id,
      grading_version: "1",
      answers,
      explanations,
      scoring_rules: {
        type: "vocabulary_test",
        minimum_countable_groups: 5,
      },
    },
  };
}

function buildSet(meta, overrides = {}) {
  return {
    set_id: meta.id,
    section_id: meta.sectionId,
    title: meta.title,
    type: overrides.type || meta.sectionId,
    course: overrides.course || meta.sectionId,
    link: meta.href,
    difficulty: overrides.difficulty || "",
    estimated_minutes: overrides.estimatedMinutes || null,
    passing_percentage: 50,
    mastery_percentage: 90,
    feedback_policy: "always",
    visible: meta.visible !== false,
  };
}

function main() {
  const sets = [];
  const gradingKeys = [];

  listJson(path.join(projectRoot, "data"))
    .filter((filePath) => /^BBC-/.test(path.basename(filePath)))
    .forEach((filePath) => {
      const source = readJson(filePath);
      const meta = readJson(path.join(projectRoot, "content", "bbc-six-minute-english", `${source.id}.json`));
      const extracted = extractBbc(source);
      sets.push(buildSet(meta, { type: "listening", course: "BBC Listening" }));
      gradingKeys.push(extracted.gradingKey);
      writeJson(path.join(publicRoot, "data", path.basename(filePath)), extracted.publicData);
    });

  listJson(path.join(projectRoot, "data"))
    .filter((filePath) => /^C\d+-T\d+-P\d+/.test(path.basename(filePath)))
    .forEach((filePath) => {
      const source = readJson(filePath);
      const meta = readJson(path.join(projectRoot, "content", "ielts-reading", `${source.id}.json`));
      const extracted = extractIelts(source);
      sets.push(buildSet(meta, { type: "reading", course: "IELTS Reading" }));
      gradingKeys.push(extracted.gradingKey);
      writeJson(path.join(publicRoot, "data", path.basename(filePath)), extracted.publicData);
    });

  listJson(path.join(projectRoot, "content", "vocabulary")).forEach((filePath) => {
    const source = readJson(filePath);
    const extracted = extractVocabulary(source);
    sets.push(buildSet(source, { type: "vocabulary", course: source.sourceName || "Vocabulary" }));
    gradingKeys.push(extracted.gradingKey);
    writeJson(path.join(publicRoot, "content", "vocabulary", path.basename(filePath)), extracted.publicData);
    writeVocabularyFallback(
      path.join(publicRoot, "content", "vocabulary", path.basename(filePath).replace(/\.json$/i, ".js")),
      extracted.publicData
    );
  });

  const systemConfig = [{
    config_key: "grading_defaults",
    value: {
      default_passing_percentage: 50,
      default_feedback_policy: "always",
      vocabulary_minimum_countable_groups: 5,
    },
  }];

  writeJson(path.join(privateRoot, "sets.json"), sets);
  writeJson(path.join(privateRoot, "grading_keys.json"), gradingKeys);
  writeJson(path.join(privateRoot, "system_config.json"), systemConfig);
  writeJsonLines(path.join(privateRoot, "sets-cloudbase.json"), sets);
  writeJsonLines(path.join(privateRoot, "grading-keys-cloudbase.json"), gradingKeys);
  writeJsonLines(path.join(privateRoot, "system-config-cloudbase.json"), systemConfig);

  console.log(`Prepared ${sets.length} sets`);
  console.log(`Prepared ${gradingKeys.length} private grading keys`);
  console.log(`Output: ${outputRoot}`);
  console.log("Do not commit the output directory.");
}

main();
