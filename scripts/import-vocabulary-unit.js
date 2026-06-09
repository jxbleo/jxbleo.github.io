const fs = require("fs");
const path = require("path");

function usage() {
  console.error("Usage: node scripts/import-vocabulary-unit.js <source-md> <output-json>");
  process.exit(1);
}

const sourcePath = process.argv[2];
const outputPath = process.argv[3];

if (!sourcePath || !outputPath) {
  usage();
}

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function parseTableRow(line) {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((part) => part.trim());
}

function stripMarkdown(value) {
  return value
    .replace(/\*\*/g, "")
    .replace(/<br\s*\/?>/gi, " / ")
    .trim();
}

function parseWords(content) {
  const lines = content.split("\n");
  const startIndex = lines.findIndex((line) => line.startsWith("|No.|Word|"));
  const endIndex = lines.findIndex((line) => line.startsWith("## CEFR Level:"));
  if (startIndex === -1 || endIndex === -1) {
    throw new Error("Unable to find vocabulary table");
  }

  const words = [];
  for (let i = startIndex + 2; i < endIndex; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const parts = parseTableRow(line);
    if (parts.length < 5) continue;
    words.push({
      number: Number(parts[0]),
      word: parts[1],
      emoji: parts[2],
      meaning: parts[3],
      wordForms: parts[4],
    });
  }
  return words;
}

function parseCefr(content) {
  const match = content.match(/## CEFR Level:\s*(.+)/);
  return match ? match[1].trim() : "";
}

function parseGroupBlocks(content) {
  const quizSection = content.split("# 答案解析")[0];
  const groupRegex = /###\s+第(.+?)组\s+\((\d+)-(\d+)\)\n\n([\s\S]*?)(?=\n###\s+第|\n# 答案解析|$)/g;
  const groups = [];
  let match;

  while ((match = groupRegex.exec(quizSection)) !== null) {
    const groupLabel = `第${match[1]}组`;
    const rangeStart = Number(match[2]);
    const rangeEnd = Number(match[3]);
    const block = match[4].trim();
    const parts = block.split(/\n\n/);
    const wordLine = (parts[0] || "").trim();
    const questionsBlock = parts.slice(1).join("\n\n");
    const wordList = wordLine.split("|").map((item) => item.trim()).filter(Boolean);
    const questionMatches = [...questionsBlock.matchAll(/(\d+)\.\s+([^\n]+)/g)];
    const questions = questionMatches.map((item) => ({
      number: Number(item[1]),
      prompt: item[2].trim(),
    }));

    groups.push({
      id: `${rangeStart}-${rangeEnd}`,
      label: groupLabel,
      rangeStart,
      rangeEnd,
      wordList,
      questions,
    });
  }

  return groups;
}

function parseAnswerBlocks(content, groups) {
  const parts = content.split("# 答案解析");
  if (parts.length < 2) return groups;
  const answerSection = parts[1];
  const groupRegex = /###\s+第(.+?)组\s+\((\d+)-(\d+)\)\n\n([\s\S]*?)(?=\n###\s+第|$)/g;
  const answerMap = new Map();
  let match;

  while ((match = groupRegex.exec(answerSection)) !== null) {
    const key = `${match[2]}-${match[3]}`;
    const block = match[4].trim();
    const lineRegex = /(\d+)\.\s+\*\*(.+?)\*\*。([\s\S]*?)(?=\n\d+\.\s+\*\*|$)/g;
    const answers = [];
    let lineMatch;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      answers.push({
        number: Number(lineMatch[1]),
        answer: stripMarkdown(lineMatch[2]),
        explanation: lineMatch[3].trim(),
      });
    }
    answerMap.set(key, answers);
  }

  return groups.map((group) => {
    const answers = answerMap.get(group.id) || [];
    const answerByNumber = new Map(answers.map((item) => [item.number, item]));
    return {
      ...group,
      questions: group.questions.map((question) => {
        const answer = answerByNumber.get(question.number);
        return {
          ...question,
          answer: answer ? answer.answer : "",
          explanation: answer ? answer.explanation : "",
        };
      }),
    };
  });
}

function buildUnit(content, sourceFile) {
  const unitId = path.basename(sourceFile, path.extname(sourceFile));
  const words = parseWords(content);
  const cefr = parseCefr(content);
  const groups = parseAnswerBlocks(content, parseGroupBlocks(content));

  const sortMatch = unitId.match(/^([A-Z]+)-([A-Z])$/);
  let sortOrder = 0;
  if (sortMatch) {
    const sourcePrefix = sortMatch[1] === "NGSL" ? 1000 : sortMatch[1] === "NAWL" ? 2000 : 9000;
    sortOrder = sourcePrefix + (sortMatch[2].charCodeAt(0) - 64);
  }

  return {
    id: unitId,
    sectionId: "vocabulary",
    title: unitId,
    href: `vocabulary.html?set=${unitId}`,
    sortOrder,
    topic: "",
    tags: [],
    note: `${words.length} Words · ${groups.length} Quiz Groups`,
    visible: true,
    sourceName: sortMatch ? sortMatch[1] : "Vocabulary",
    cefrLevel: cefr,
    wordCount: words.length,
    words,
    quizGroups: groups,
  };
}

function buildFallbackScript(unit) {
  return "window.__VOCABULARY_UNITS__ = window.__VOCABULARY_UNITS__ || {};\n" +
    "window.__VOCABULARY_UNITS__[" + JSON.stringify(unit.id) + "] = " +
    JSON.stringify(unit, null, 2) + ";\n";
}

function main() {
  const content = readFile(sourcePath);
  const unit = buildUnit(content, sourcePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(unit, null, 2) + "\n");
  fs.writeFileSync(
    outputPath.replace(/\.json$/i, ".js"),
    buildFallbackScript(unit)
  );
  console.log(`Created ${outputPath}`);
}

main();
