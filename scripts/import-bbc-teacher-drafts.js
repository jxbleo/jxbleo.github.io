const fs = require("fs");
const path = require("path");
const os = require("os");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "data");
const contentDir = path.join(projectRoot, "content", "bbc-six-minute-english");
const audioDir = path.join(projectRoot, "bbc-audio");
const privateDir = path.join(projectRoot, ".cloudbase-private", "source", "bbc-six-minute-english");

const lessonDetails = {
  "240919": { title: "Saving Water in the Driest Place on Earth", topic: "Water / Farming", tags: ["Environment", "Farming"] },
  "240926": { title: "Learning a New Food Culture", topic: "Food / Migration", tags: ["Food", "Culture"] },
  "241003": { title: "What Decides Our Taste?", topic: "Food / Biology", tags: ["Food", "Science"] },
  "241010": { title: "Did Taylor Swift Fans Cause an Earthquake?", topic: "Music / Earth Science", tags: ["Music", "Science"] },
  "241017": { title: "Tech That Refuses to Die", topic: "Technology / Change", tags: ["Technology", "Society"] },
  "241024": { title: "Divorce: Why Does It Happen?", topic: "Relationships / Society", tags: ["Relationships", "Society"] },
  "241031": { title: "Why You Need a Good Night's Sleep", topic: "Sleep / Health", tags: ["Health", "Science"] },
  "241107": { title: "Having Acne", topic: "Skin / Wellbeing", tags: ["Health", "Wellbeing"] },
  "241114": { title: "The Bond Between Sisters", topic: "Family / Relationships", tags: ["Family", "Relationships"] },
  "241121": { title: "The Secrets to a Healthy Old Age", topic: "Ageing / Health", tags: ["Health", "Society"] },
  "241128": { title: "How Babies Learn to Talk", topic: "Language / Childhood", tags: ["Language", "Children"] },
  "260709": { title: "Should We Cycle More?", topic: "Cycling / Environment", tags: ["Health", "Environment"] },
  "260820": { title: "Sharing the Road with Driverless Cars", topic: "Transport / Technology", tags: ["Technology", "Transport"] },
  "260827": { title: "How Do We Describe Smells?", topic: "Smell / Language", tags: ["Language", "Science"] },
  "260903": { title: "Climate Change and Extreme Weather", topic: "Climate / Weather", tags: ["Climate", "Science"] },
  "260910": { title: "Can Apps Teach You a Language?", topic: "Language / Technology", tags: ["Language", "Technology"] },
  "260917": { title: "Is Rejection Good for Us?", topic: "Rejection / Psychology", tags: ["Psychology", "Wellbeing"] },
  "260924": { title: "Why Do We Itch?", topic: "Skin / Science", tags: ["Health", "Science"] },
  "260716": {
    title: "What's in a Footballer's Brain?",
    topic: "Sport / Neuroscience",
    tags: ["Sport", "Science"],
  },
  "260723": {
    title: "Children in War Zones",
    topic: "Conflict / Childhood",
    tags: ["Society", "Children"],
  },
  "260730": {
    title: "The Enhanced Games",
    topic: "Sport / Ethics",
    tags: ["Sport", "Ethics"],
  },
  "260806": {
    title: "How Do Climate Scientists Make Predictions?",
    topic: "Climate / Science",
    tags: ["Climate", "Science"],
  },
  "260813": {
    title: "Who Does the Housework?",
    topic: "Society / Gender",
    tags: ["Society", "Gender"],
  },
};

function usage() {
  console.error("Usage: node scripts/import-bbc-teacher-drafts.js [--audio-dir <directory>] <teacher-draft.md> [<teacher-draft.md> ...]");
  process.exit(1);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanInlineMarkdown(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function between(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  if (start === -1) return "";
  const end = content.indexOf(endMarker, start + startMarker.length);
  return content.slice(start, end === -1 ? content.length : end);
}

function parseBlankQuestions(content) {
  const section = between(content, "## Part 1: Note Completion", "## Part 2: Multiple Choice");
  const lines = section.split("\n");
  const questions = [];
  let currentSection = "Notes";

  lines.forEach((line) => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^###\s+(.+)$/);
    if (heading) {
      currentSection = cleanInlineMarkdown(heading[1]);
      return;
    }
    const subsection = trimmed.match(/^[-*]\s+\*\*(.+?)\*\*\s*$/);
    if (subsection) {
      currentSection = cleanInlineMarkdown(subsection[1]);
      return;
    }

    const matches = Array.from(trimmed.matchAll(/\((\d+)\)\s*\*{0,2}_{3,}\*{0,2}/g));
    if (!matches.length) return;
    if (matches.length !== 1) {
      throw new Error(`Expected one blank per note line, found ${matches.length}: ${trimmed}`);
    }

    const number = Number(matches[0][1]);
    const sentence = cleanInlineMarkdown(
      trimmed
        .replace(/^[-*]\s+/, "")
        .replace(/\((\d+)\)\s*\*{0,2}_{3,}\*{0,2}/g, "_____")
    );
    questions.push({
      id: `fill-${number}`,
      number,
      sentence,
      section: currentSection,
    });
  });

  return questions.sort((a, b) => a.number - b.number);
}

function parseMultipleChoiceQuestions(content) {
  const studentContent = content.split(/^# Teacher Version\s*$/m)[0];
  const section = between(studentContent, "## Part 2: Multiple Choice", "---");
  const lines = section.split("\n");
  const questions = [];
  let current = null;

  lines.forEach((line) => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^(?:###\s+)?(?:\*\*)?(1[1-9]|20)\.\s*(.+)$/);
    if (heading) {
      if (current) questions.push(current);
      const number = Number(heading[1]);
      current = {
        id: `mc-${number}`,
        number,
        question: cleanInlineMarkdown(heading[2]),
        options: [],
      };
      return;
    }
    const option = trimmed.match(/^([A-D])\.\s+(.+)$/);
    if (option && current) current.options.push(cleanInlineMarkdown(option[2]));
  });
  if (current) questions.push(current);

  return questions.sort((a, b) => a.number - b.number);
}

function parseBlankKey(content) {
  const section = between(content, "## Part 1: Note Completion Answer Key", "## Part 2: MC Metadata");
  const answers = {};
  const explanations = {};
  const sourceTypes = {};

  section.split("\n").forEach((line) => {
    if (!/^\|\s*\d+\s*\|/.test(line)) return;
    const cells = tableCells(line);
    if (cells.length < 11) throw new Error(`Incomplete Note Completion answer row: ${line}`);
    const number = Number(cells[0]);
    const key = `fill-${number}`;
    const answer = cleanInlineMarkdown(cells[1]);
    const alternative = cleanInlineMarkdown(cells[2]);
    const evidence = cleanInlineMarkdown(cells[8]);
    const location = cleanInlineMarkdown(cells[9]);
    const explanation = cleanInlineMarkdown(cells.slice(10).join(" | "));
    answers[key] = alternative && !/^[—-]$/.test(alternative)
      ? [answer, alternative]
      : answer;
    explanations[key] = [
      evidence ? `原文证据：${evidence}` : "",
      location ? `位置：${location}` : "",
      explanation,
    ].filter(Boolean).join(" ");
    sourceTypes[key] = cleanInlineMarkdown(cells[3]);
  });

  return { answers, explanations, sourceTypes };
}

function parseMcKey(content) {
  const answers = {};
  const explanations = {};
  const matches = Array.from(content.matchAll(/^### 第(1[1-9]|20)题：([A-D])\.\s*(.+)$/gm));

  matches.forEach((match, index) => {
    const number = Number(match[1]);
    const key = `mc-${number}`;
    const blockStart = match.index + match[0].length;
    const blockEnd = index + 1 < matches.length ? matches[index + 1].index : content.length;
    const block = content.slice(blockStart, blockEnd);
    const evidenceMatch = block.match(/\*\*原文证据：\*\*\s*\n+([\s\S]*?)(?=\n\s*\*\*位置：\*\*|\n\s*\*\*[A-D]错误|$)/);
    const locationMatch = block.match(/\*\*位置：\*\*\s*([^\n]+)/);
    const wrong = [];
    const wrongRegex = /\*\*([A-D])错误｜[^*]+\*\*\s*\n+([^\n]+)/g;
    let wrongMatch;
    while ((wrongMatch = wrongRegex.exec(block)) !== null) {
      wrong.push(`${wrongMatch[1]}错误：${cleanInlineMarkdown(wrongMatch[2])}`);
    }

    answers[key] = match[2];
    explanations[key] = [
      `正确答案 ${match[2]}：${cleanInlineMarkdown(match[3])}`,
      evidenceMatch ? `原文证据：${cleanInlineMarkdown(evidenceMatch[1])}` : "",
      locationMatch ? `位置：${cleanInlineMarkdown(locationMatch[1])}` : "",
      ...wrong,
    ].filter(Boolean).join(" ");
  });

  return { answers, explanations };
}

function answerWordCount(answer) {
  return String(answer || "").trim().split(/\s+/).filter(Boolean).length;
}

function validateLesson(lesson, privateSource, sourceTypes) {
  if (lesson.blanks.length < 1 || lesson.blanks.length > 10 ||
      lesson.multipleChoice.length < 1 || lesson.multipleChoice.length > 10) {
    throw new Error(`${lesson.id} must contain 1–10 note items and 1–10 MC items`);
  }
  const expectedBlankIds = Array.from({ length: lesson.blanks.length }, (_, index) => `fill-${index + 1}`);
  const expectedMcIds = Array.from({ length: lesson.multipleChoice.length }, (_, index) => `mc-${index + 11}`);
  const blankIds = lesson.blanks.map((item) => item.id);
  const mcIds = lesson.multipleChoice.map((item) => item.id);

  if (JSON.stringify(blankIds) !== JSON.stringify(expectedBlankIds)) {
    throw new Error(`${lesson.id} has non-contiguous Note Completion IDs`);
  }
  if (JSON.stringify(mcIds) !== JSON.stringify(expectedMcIds)) {
    throw new Error(`${lesson.id} has non-contiguous MC IDs starting at mc-11`);
  }
  lesson.multipleChoice.forEach((item) => {
    if (item.options.length !== 4) throw new Error(`${lesson.id} ${item.id} must have four options`);
  });

  [...expectedBlankIds, ...expectedMcIds].forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(privateSource.answers, key)) {
      throw new Error(`${lesson.id} is missing private answer ${key}`);
    }
    if (!privateSource.explanations[key]) {
      throw new Error(`${lesson.id} is missing private explanation ${key}`);
    }
  });

  expectedBlankIds.forEach((key) => {
    const accepted = Array.isArray(privateSource.answers[key])
      ? privateSource.answers[key]
      : [privateSource.answers[key]];
    accepted.forEach((answer) => {
      if (answerWordCount(answer) > 3) {
        throw new Error(`${lesson.id} ${key} exceeds the three-word answer limit: ${answer}`);
      }
    });
  });

  const types = expectedBlankIds.map((key) => sourceTypes[key]);
  const directCount = types.filter((type) => type === "direct_extraction").length;
  const controlledCount = types.filter((type) => type && type !== "direct_extraction").length;
  if (directCount + controlledCount !== expectedBlankIds.length ||
      directCount < (expectedBlankIds.length >= 10 ? 7 : 6) ||
      controlledCount < 2 || controlledCount > 3 ||
      !types.includes("word_form_transformation") ||
      !types.some((type) => type === "lexical_paraphrase" || type === "semantic_summary")) {
    throw new Error(`${lesson.id} has an invalid Note Completion source mix (${directCount} direct, ${controlledCount} controlled)`);
  }

  const serializedPublic = JSON.stringify(lesson);
  if (/"(?:answer|answers|evidence|explanation|correctAnswer)"\s*:/.test(serializedPublic)) {
    throw new Error(`${lesson.id} public runtime contains private grading fields`);
  }
  if (/_{6,}/.test(serializedPublic)) {
    throw new Error(`${lesson.id} contains an invalid long blank placeholder`);
  }
}

function publishedOn(datePrefix) {
  return `20${datePrefix.slice(0, 2)}-${datePrefix.slice(2, 4)}-${datePrefix.slice(4, 6)}`;
}

function importDraft(sourcePath, sourceAudioDir) {
  const absoluteSource = path.resolve(sourcePath);
  const fileName = path.basename(absoluteSource);
  const legacyMatch = fileName.match(/^(\d{6})-(.+?)-exercises Teachers Draft\.md$/i);
  const reviewedMatch = fileName.match(/^BBC-(\d{6})-teacher-review\.md$/i);
  const dateMatch = legacyMatch || reviewedMatch;
  if (!dateMatch) {
    throw new Error(`Unexpected teacher draft filename: ${fileName}`);
  }

  const datePrefix = dateMatch[1];
  const sourceBase = legacyMatch
    ? fileName.replace(/-exercises Teachers Draft\.md$/i, "")
    : fs.readdirSync(sourceAudioDir).filter((name) => new RegExp(`^${datePrefix}-.+\\.mp3$`, "i").test(name))[0];
  if (!sourceBase) throw new Error(`Missing matching audio for BBC-${datePrefix} in ${sourceAudioDir}`);
  const audioSource = legacyMatch
    ? path.join(path.dirname(absoluteSource), `${sourceBase}.mp3`)
    : path.join(sourceAudioDir, sourceBase);
  if (!fs.existsSync(audioSource)) throw new Error(`Missing matching audio: ${audioSource}`);
  if (reviewedMatch && fs.readdirSync(sourceAudioDir).filter((name) => new RegExp(`^${datePrefix}-.+\\.mp3$`, "i").test(name)).length !== 1) {
    throw new Error(`Expected exactly one matching audio for BBC-${datePrefix} in ${sourceAudioDir}`);
  }

  const details = lessonDetails[datePrefix];
  if (!details) throw new Error(`Add title/topic metadata for BBC-${datePrefix}`);
  const content = readText(absoluteSource);
  const noteKey = parseBlankKey(content);
  const mcKey = parseMcKey(content);
  const id = `BBC-${datePrefix}`;
  const lesson = {
    id,
    title: details.title,
    audioSrc: `bbc-audio/${path.basename(audioSource)}`,
    blanks: parseBlankQuestions(content),
    multipleChoice: parseMultipleChoiceQuestions(content),
    matching: [],
  };
  const privateSource = {
    set_id: id,
    grading_version: "1",
    answers: { ...noteKey.answers, ...mcKey.answers },
    explanations: { ...noteKey.explanations, ...mcKey.explanations },
    scoring_rules: { type: "exact_normalized" },
  };
  const metadata = {
    id,
    sectionId: "bbc-six-minute-english",
    title: details.title,
    href: `bbc.html?set=${id}`,
    publishedOn: publishedOn(datePrefix),
    topic: details.topic,
    tags: details.tags,
    note: "Listening Practice",
    visible: true,
  };

  validateLesson(lesson, privateSource, noteKey.sourceTypes);
  writeJson(path.join(dataDir, `${id}.json`), lesson);
  writeJson(path.join(contentDir, `${id}.json`), metadata);
  writeJson(path.join(privateDir, `${id}.json`), privateSource);
  ensureDir(audioDir);
  fs.copyFileSync(audioSource, path.join(audioDir, path.basename(audioSource)));
  ensureDir(privateDir);
  fs.copyFileSync(absoluteSource, path.join(privateDir, `${id}.teacher.md`));

  return {
    id,
    blankCount: lesson.blanks.length,
    mcCount: lesson.multipleChoice.length,
    audio: lesson.audioSrc,
  };
}

function main() {
  const args = process.argv.slice(2);
  let sourceAudioDir = path.join(os.homedir(), "Downloads");
  if (args[0] === "--audio-dir") {
    if (!args[1]) usage();
    sourceAudioDir = path.resolve(args[1]);
    args.splice(0, 2);
  }
  const sources = args;
  if (!sources.length) usage();
  const imported = sources.map((source) => importDraft(source, sourceAudioDir));
  imported.forEach((item) => {
    console.log(`Imported ${item.id}: ${item.blankCount} blanks, ${item.mcCount} MC, ${item.audio}`);
  });
}

main();
