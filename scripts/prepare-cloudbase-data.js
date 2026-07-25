const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.resolve(process.argv[2] || path.join(projectRoot, ".cloudbase-private"));
const privateRoot = path.join(outputRoot, "import");
const publicRoot = path.join(outputRoot, "public");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonIfExists(filePath) {
  return fs.existsSync(filePath) ? readJson(filePath) : null;
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
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(dirPath, name));
}

function normalizeLexiconText(value) {
  return String(value == null ? "" : value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanLexiconText(value) {
  return String(value == null ? "" : value)
    .replace(/<br\s*\/?>/gi, "; ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s*;\s*/g, "; ")
    .replace(/\s+/g, " ")
    .trim();
}

function lexiconId(normalizedWord) {
  return `lex_${crypto.createHash("sha256").update(normalizedWord).digest("hex").slice(0, 32)}`;
}

function addCuratedLexiconWords(lexiconMap, unit) {
  (unit.words || []).forEach((entry) => {
    const normalizedWord = normalizeLexiconText(entry.word);
    if (!normalizedWord) return;
    const source = String(unit.sourceName || unit.id || "Mr. Cat Academy").trim();
    const candidate = {
      lexicon_id: lexiconId(normalizedWord),
      normalized_word: normalizedWord,
      word: String(entry.word || "").trim(),
      phonetic: cleanLexiconText(entry.phonetic || entry.ipa || ""),
      part_of_speech: cleanLexiconText(entry.partOfSpeech || ""),
      english_definition: cleanLexiconText(entry.simpleDefinition || entry.definition || ""),
      chinese_meaning: cleanLexiconText(entry.meaning || entry.translation || ""),
      word_forms: cleanLexiconText(entry.wordForms || ""),
      emoji: cleanLexiconText(entry.emoji || ""),
      sources: source ? [source] : [],
      source_type: "curated",
      verified: true,
      lexicon_version: "2026-07-12",
    };
    const existing = lexiconMap.get(normalizedWord);
    if (!existing) {
      lexiconMap.set(normalizedWord, candidate);
      return;
    }
    ["phonetic", "part_of_speech", "english_definition", "chinese_meaning", "word_forms", "emoji"].forEach((field) => {
      if (!existing[field] && candidate[field]) existing[field] = candidate[field];
    });
    candidate.sources.forEach((item) => {
      if (item && !existing.sources.includes(item)) existing.sources.push(item);
    });
  });
}

function prepareVocabularyLexicon(records) {
  const finalPath = path.join(privateRoot, "vocabulary-lexicon-cloudbase.json");
  const ecdictSource = String(process.env.ECDICT_SOURCE || "").trim();
  if (!ecdictSource) {
    writeJsonLines(finalPath, records);
    return records.length;
  }

  const curatedPath = path.join(outputRoot, "vocabulary-lexicon-curated.jsonl");
  writeJsonLines(curatedPath, records);
  const helper = path.join(projectRoot, "scripts", "prepare-ecdict-lexicon.py");
  const result = spawnSync("python3", [
    helper,
    "--source", ecdictSource,
    "--curated", curatedPath,
    "--output", finalPath,
    "--limit", String(process.env.ECDICT_LIMIT || "30000"),
  ], { cwd: projectRoot, encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
  if (result.status !== 0) {
    throw new Error(`ECDICT preparation failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
  const count = fs.readFileSync(finalPath, "utf8").split(/\r?\n/).filter(Boolean).length;
  if (result.stdout.trim()) console.log(result.stdout.trim());
  return count;
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

function extractBbc(source, privateSource) {
  const answers = {};
  const explanations = {};
  const privateAnswers = privateSource && privateSource.answers ? privateSource.answers : null;
  const privateExplanations = privateSource && privateSource.explanations ? privateSource.explanations : null;

  (source.blanks || []).forEach((item) => {
    if (privateAnswers && Object.prototype.hasOwnProperty.call(privateAnswers, item.id)) {
      answers[item.id] = privateAnswers[item.id];
      explanations[item.id] = privateExplanations && privateExplanations[item.id] ? privateExplanations[item.id] : "";
    } else {
      answers[item.id] = item.answer;
      explanations[item.id] = item.evidence || "";
    }
  });
  (source.multipleChoice || []).forEach((item) => {
    if (privateAnswers && Object.prototype.hasOwnProperty.call(privateAnswers, item.id)) {
      answers[item.id] = privateAnswers[item.id];
      explanations[item.id] = privateExplanations && privateExplanations[item.id] ? privateExplanations[item.id] : "";
    } else {
      answers[item.id] = item.answer;
      explanations[item.id] = item.evidence || "";
    }
  });
  (source.matching || []).forEach((group) => {
    (group.pairs || []).forEach((pair, index) => {
      const key = `${group.id}-${index}`;
      if (privateAnswers && Object.prototype.hasOwnProperty.call(privateAnswers, key)) {
        answers[key] = privateAnswers[key];
        explanations[key] = privateExplanations && privateExplanations[key] ? privateExplanations[key] : "";
      } else {
        answers[key] = (group.answer || [])[index] || "";
        explanations[key] = pair.right || "";
      }
    });
  });

  return {
    publicData: withoutPrivateFields(source),
    gradingKey: {
      set_id: source.id,
      grading_version: privateSource && privateSource.grading_version ? privateSource.grading_version : "1",
      answers,
      explanations,
      scoring_rules: privateSource && privateSource.scoring_rules ? privateSource.scoring_rules : { type: "exact_normalized" },
    },
  };
}

function extractIelts(source, privateSource) {
  const answers = {};
  const explanations = {};

  if (privateSource && privateSource.answers) {
    Object.assign(answers, privateSource.answers);
    Object.assign(explanations, privateSource.explanations || {});
  }

  (source.questions || []).forEach((questionSet) => {
    if (questionSet.example && questionSet.example.id && questionSet.example.answer != null) {
      if (answers[questionSet.example.id] == null) {
        answers[questionSet.example.id] = questionSet.example.answer;
        explanations[questionSet.example.id] = questionSet.example.evidence || "";
      }
    }
    (questionSet.items || []).forEach((item) => {
      if (!item.id || item.answer == null) return;
      if (answers[item.id] == null) {
        answers[item.id] = item.answer;
        explanations[item.id] = item.evidence || item.explanation || "";
      }
    });
  });

  return {
    publicData: withoutPrivateFields(source),
    gradingKey: {
      set_id: source.id,
      grading_version: privateSource && privateSource.grading_version ? privateSource.grading_version : "1",
      answers,
      explanations,
      scoring_rules: privateSource && privateSource.scoring_rules ? privateSource.scoring_rules : { type: "ielts_normalized" },
    },
  };
}

function privateSourceFor(kind, setId) {
  const candidates = [
    path.join(outputRoot, "source", kind, `${setId}.json`),
    path.join(projectRoot, ".cloudbase-private", "source", kind, `${setId}.json`),
  ];
  return candidates.map(readJsonIfExists).find(Boolean);
}

function extractIeltsListening(source, privateSource) {
  if (!privateSource || !privateSource.answers) return null;
  return {
    publicData: withoutPrivateFields(source),
    gradingKey: {
      set_id: source.id,
      grading_version: privateSource.grading_version || "1",
      answers: privateSource.answers || {},
      explanations: privateSource.explanations || {},
      scoring_rules: privateSource.scoring_rules || { type: "ielts_listening_normalized" },
    },
  };
}

function extractVocabulary(source, privateSource) {
  const answers = {};
  const explanations = {};
  const publicData = JSON.parse(JSON.stringify(source));
  const privateAnswers = privateSource && privateSource.answers ? privateSource.answers : null;
  const privateExplanations = privateSource && privateSource.explanations ? privateSource.explanations : null;
  const missingAnswers = [];
  const publicVersion = String(source.contentVersion == null ? "" : source.contentVersion).trim();
  const privateVersion = String(privateSource && privateSource.grading_version || "1").trim();

  if (!publicVersion || publicVersion !== privateVersion) {
    throw new Error(`Vocabulary ${source.id} contentVersion ${publicVersion || "(missing)"} does not match private grading version ${privateVersion}`);
  }
  publicData.contentVersion = publicVersion;

  function hasAnswerValue(value) {
    if (Array.isArray(value)) return value.length > 0 && value.some(hasAnswerValue);
    return value != null && String(value).trim() !== "";
  }

  (publicData.quizGroups || []).forEach((group) => {
    const wordList = Array.isArray(group.wordList) ? group.wordList : [];
    (group.questions || []).forEach((question, index) => {
      const key = `${group.id}:${question.number}`;
      question.questionKey = key;
      let answer;
      let explanation = "";
      if (privateAnswers && Object.prototype.hasOwnProperty.call(privateAnswers, key)) {
        answer = privateAnswers[key];
        explanation = privateExplanations && privateExplanations[key] ? privateExplanations[key] : "";
      } else {
        answer = hasAnswerValue(question.answer) ? question.answer : wordList[index];
        explanation = question.explanation || "";
      }
      if (!hasAnswerValue(answer)) {
        missingAnswers.push(key);
      } else {
        answers[key] = answer;
        explanations[key] = explanation;
      }
      delete question.answer;
      delete question.explanation;
    });
  });

  if (missingAnswers.length) {
    throw new Error(`Vocabulary ${source.id} is missing answers for: ${missingAnswers.slice(0, 10).join(", ")}${missingAnswers.length > 10 ? "..." : ""}`);
  }

  return {
    publicData,
    gradingKey: {
      set_id: source.id,
      grading_version: privateVersion,
      answers,
      explanations,
      scoring_rules: privateSource && privateSource.scoring_rules ? privateSource.scoring_rules : {
        type: "vocabulary_test",
        minimum_countable_groups: 5,
      },
    },
  };
}

function buildSet(meta, overrides = {}) {
  const type = overrides.type || meta.sectionId;
  const course = overrides.course || meta.sectionId;
  const isVocabulary = type === "vocabulary" || meta.sectionId === "vocabulary";
  const isBbc = type === "bbc-six-minute-english" ||
    meta.sectionId === "bbc-six-minute-english" ||
    /^BBC-/i.test(String(meta.id || ""));
  const defaultPassingPercentage = isVocabulary ? 90 : (isBbc ? 80 : 50);
  const defaultMasteryPercentage = isVocabulary ? 100 : (isBbc ? 95 : 90);
  const set = {
    set_id: meta.id,
    section_id: meta.sectionId,
    title: meta.title,
    type,
    course,
    link: meta.href,
    difficulty: overrides.difficulty || "",
    estimated_minutes: overrides.estimatedMinutes || null,
    passing_percentage: overrides.passingPercentage == null
      ? defaultPassingPercentage
      : overrides.passingPercentage,
    mastery_percentage: overrides.masteryPercentage == null
      ? defaultMasteryPercentage
      : overrides.masteryPercentage,
    feedback_policy: "always",
    visible: meta.visible !== false,
  };
  if (meta.renderTheme) set.renderTheme = meta.renderTheme;
  return set;
}

function main() {
  const sets = [];
  const gradingKeys = [];
  const vocabularyLexicon = new Map();

  listJson(path.join(projectRoot, "data"))
    .filter((filePath) => /^BBC-/.test(path.basename(filePath)))
    .forEach((filePath) => {
      const source = readJson(filePath);
      const meta = readJson(path.join(projectRoot, "content", "bbc-six-minute-english", `${source.id}.json`));
      const extracted = extractBbc(source, privateSourceFor("bbc-six-minute-english", source.id));
      sets.push(buildSet(meta, { type: "listening", course: "BBC Listening" }));
      gradingKeys.push(extracted.gradingKey);
      writeJson(path.join(publicRoot, "data", path.basename(filePath)), extracted.publicData);
    });

  listJson(path.join(projectRoot, "data"))
    .filter((filePath) => /^C\d+-T\d+-P\d+/.test(path.basename(filePath)))
    .forEach((filePath) => {
      const source = readJson(filePath);
      const meta = readJson(path.join(projectRoot, "content", "ielts-reading", `${source.id}.json`));
      const extracted = extractIelts(source, privateSourceFor("ielts-reading", source.id));
      sets.push(buildSet(meta, { type: "reading", course: "IELTS Reading" }));
      gradingKeys.push(extracted.gradingKey);
      writeJson(path.join(publicRoot, "data", path.basename(filePath)), extracted.publicData);
    });

  listJson(path.join(projectRoot, "content", "ielts-listening"))
    .forEach((metaPath) => {
      const meta = readJson(metaPath);
      const dataPath = path.join(projectRoot, "data", `${meta.id}.json`);
      if (!fs.existsSync(dataPath)) {
        console.warn(`Missing IELTS Listening data for ${meta.id}`);
        return;
      }
      const source = readJson(dataPath);
      const extracted = extractIeltsListening(source, privateSourceFor("ielts-listening", source.id));
      sets.push(buildSet(meta, {
        type: "listening",
        course: "IELTS Listening",
        estimatedMinutes: source.durationMinutes || null,
      }));
      writeJson(path.join(publicRoot, "data", path.basename(dataPath)), withoutPrivateFields(source));
      if (extracted) {
        gradingKeys.push(extracted.gradingKey);
      } else {
        console.warn(`Missing private IELTS Listening grading source for ${source.id}`);
      }
    });

  listJson(path.join(projectRoot, "content", "vocabulary")).forEach((filePath) => {
    const source = readJson(filePath);
    addCuratedLexiconWords(vocabularyLexicon, source);
    const extracted = extractVocabulary(source, privateSourceFor("vocabulary", source.id));
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
      default_mastery_percentage: 90,
      vocabulary_default_passing_percentage: 90,
      vocabulary_default_mastery_percentage: 100,
      bbc_default_passing_percentage: 80,
      bbc_default_mastery_percentage: 95,
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

  const vocabularyLexiconCount = prepareVocabularyLexicon(
    Array.from(vocabularyLexicon.values()).sort((left, right) => left.normalized_word.localeCompare(right.normalized_word))
  );

  console.log(`Prepared ${sets.length} sets`);
  console.log(`Prepared ${gradingKeys.length} private grading keys`);
  console.log(`Prepared ${vocabularyLexiconCount} shared vocabulary lexicon entries`);
  console.log(`Output: ${outputRoot}`);
  console.log("Do not commit the output directory.");
}

main();
