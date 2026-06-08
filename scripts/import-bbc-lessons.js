const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "data");
const contentDir = path.join(projectRoot, "content", "bbc-six-minute-english");

const topicByDate = {
  "250918": "Technology / Society",
  "250925": "History / Crime",
  "251002": "Nature / Conservation",
  "251009": "Society / Politics",
  "251030": "Food / Health",
};

const tagsByDate = {
  "250918": ["Technology", "Society"],
  "250925": ["History", "Crime"],
  "251002": ["Nature", "Conservation"],
  "251009": ["Society", "Politics"],
  "251030": ["Food", "Health"],
};

function usage() {
  console.error("Usage: node scripts/import-bbc-lessons.js <source-md> [<source-md> ...]");
  process.exit(1);
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stripMarkdown(value) {
  return value
    .replace(/\*\*/g, "")
    .replace(/<br\s*\/?>/gi, " / ")
    .replace(/——/g, "—")
    .trim();
}

function normalizeTitle(rawTitle) {
  const cleaned = rawTitle.replace(/\s+/g, " ").trim();
  const words = cleaned.split(" ");
  const titled = words.map((word) => {
    if (/^[A-Z]{2,}$/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");

  if (/[?.!]$/.test(titled)) return titled;
  if (/^(What|How|Why|Would|Have|Is|Are|Do|Does|Did|Can|Could|Should|Will)\b/i.test(titled)) {
    return titled + "?";
  }
  return titled;
}

function slugifyTitle(title) {
  return title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBlankSentence(text) {
  return stripMarkdown(text)
    .replace(/\(\d+\)\s*_{2,}/g, "_____")
    .replace(/\(\d+\)\s*/g, "")
    .replace(/_{2,}/g, "_____")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((part) => part.trim());
}

function normalizeQuestionNumber(value) {
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseBlankAnswerTable(section) {
  const lines = section.split("\n");
  const rows = new Map();
  lines.forEach((line) => {
    if (!line.trim().startsWith("|")) return;
    const parts = parseTableRow(line);
    if (!parts.length || parts[0] === "题号" || parts[0] === "---" || parts[0] === "题号 ") return;
    const number = normalizeQuestionNumber(parts[0]);
    if (!number) return;
    rows.set(number, {
      answer: stripMarkdown(parts[1] || ""),
      evidence: stripMarkdown(parts[2] || ""),
      lineRef: stripMarkdown(parts[3] || ""),
    });
  });
  return rows;
}

function parseBlanks(content) {
  const firstDivider = content.indexOf("\n---");
  const mcIndex = content.indexOf("# MC");
  if (firstDivider === -1 || mcIndex === -1) {
    return [];
  }

  const noteSection = content.slice(0, firstDivider).trim();
  const answerSection = content.slice(firstDivider, mcIndex);
  const answerRows = parseBlankAnswerTable(answerSection);

  const lines = noteSection.split("\n");
  let currentSection = "";
  const blanks = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const headingMatch = trimmed.match(/^\*{0,2}([A-Za-z0-9'‘’"“”().,:;&!?/\-\s]+)\*{0,2}$/);
    if ((trimmed.startsWith("**") || trimmed.startsWith("###")) && !trimmed.includes("________")) {
      currentSection = stripMarkdown(trimmed.replace(/^#+\s*/, ""));
      return;
    }

    if (!/_{2,}/.test(trimmed)) return;
    const numbers = Array.from(trimmed.matchAll(/\((\d+)\)/g)).map((item) => Number(item[1]));
    if (!numbers.length) return;

    numbers.forEach((number) => {
      const answer = answerRows.get(number) || { answer: "", evidence: "" };
      let sentenceSource = trimmed.replace(/^[•\-]\s*/, "");
      numbers.forEach((candidate) => {
        const candidateAnswer = answerRows.get(candidate);
        const replacement = candidate === number
          ? "_____"
          : candidateAnswer && candidateAnswer.answer
            ? candidateAnswer.answer
            : "_____";
        sentenceSource = sentenceSource.replace(new RegExp(`\\(${candidate}\\)\\s*\\*{0,2}_{2,}\\*{0,2}`), replacement);
      });

      blanks.push({
        id: `fill-${number}`,
        sentence: normalizeBlankSentence(sentenceSource),
        answer: answer.answer,
        evidence: answer.evidence,
        section: currentSection || "Notes",
      });
    });
  });

  return blanks;
}

function parseMcQuestions(content) {
  const mcIndex = content.indexOf("# MC");
  const answerIndex = content.indexOf("## 答案解析", mcIndex);
  if (mcIndex === -1 || answerIndex === -1) return [];

  const mcSection = content.slice(mcIndex, answerIndex);
  const questionRegex = /\*\*(\d+)\.\s+(.+?)\*\*\s*\n((?:[A-D]\.[^\n]+\n?)+)/g;
  const questions = [];
  let match;
  while ((match = questionRegex.exec(mcSection)) !== null) {
    const number = Number(match[1]);
    const options = match[3]
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    questions.push({
      number,
      id: `mc-${number}`,
      question: stripMarkdown(match[2]),
      options,
    });
  }
  return questions;
}

function parseMcAnswers(content) {
  const mcIndex = content.indexOf("# MC");
  const answerIndex = content.indexOf("## 答案解析", mcIndex);
  if (answerIndex === -1) return new Map();
  const answerSection = content.slice(answerIndex);

  const answerRegex = /\*\*第(\d+)题：([A-D])\..+?\*\*([\s\S]*?)(?=\n\*\*第\d+题：|\n---|$)/g;
  const answers = new Map();
  let match;
  while ((match = answerRegex.exec(answerSection)) !== null) {
    const number = Number(match[1]);
    const answerLetter = match[2];
    const block = match[3];
    const evidenceMatch = block.match(/-\s*(?:正确选项证据|证据)：\s*([^\n]+)/);
    answers.set(number, {
      answer: answerLetter,
      evidence: evidenceMatch ? stripMarkdown(evidenceMatch[1]) : "",
    });
  }
  return answers;
}

function parseMultipleChoice(content) {
  const questions = parseMcQuestions(content);
  const answers = parseMcAnswers(content);
  return questions.map((question) => {
    const answer = answers.get(question.number) || { answer: "", evidence: "" };
    return {
      id: question.id,
      question: question.question,
      options: question.options,
      answer: answer.answer,
      evidence: answer.evidence,
    };
  });
}

function buildLesson(sourcePath) {
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const datePrefix = baseName.slice(0, 6);
  const rawTitle = baseName.slice(7).trim();
  const title = normalizeTitle(rawTitle);
  const content = readFile(sourcePath);
  const id = `BBC-${datePrefix}`;

  return {
    id,
    title,
    audioSrc: `bbc-audio/${datePrefix}-${slugifyTitle(title)}.mp3`,
    blanks: parseBlanks(content),
    multipleChoice: parseMultipleChoice(content),
    matching: [],
  };
}

function buildCatalogMeta(lesson) {
  const datePrefix = lesson.id.replace("BBC-", "");
  const yyyyMmDd = `20${datePrefix.slice(0, 2)}-${datePrefix.slice(2, 4)}-${datePrefix.slice(4, 6)}`;
  return {
    id: lesson.id,
    sectionId: "bbc-six-minute-english",
    title: lesson.title,
    href: `bbc.html?set=${lesson.id}`,
    publishedOn: yyyyMmDd,
    topic: topicByDate[datePrefix] || "",
    tags: tagsByDate[datePrefix] || [],
    note: "Listening Practice",
    visible: true,
  };
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function main() {
  const sources = process.argv.slice(2);
  if (!sources.length) usage();

  const created = [];
  sources.forEach((sourcePath) => {
    const lesson = buildLesson(sourcePath);
    const meta = buildCatalogMeta(lesson);
    writeJson(path.join(dataDir, `${lesson.id}.json`), lesson);
    writeJson(path.join(contentDir, `${lesson.id}.json`), meta);
    created.push(lesson.id);
  });

  created.forEach((id) => console.log(`Imported ${id}`));
}

main();
