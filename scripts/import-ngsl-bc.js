const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = "/Users/leoji/Library/Mobile Documents/iCloud~md~obsidian/Documents/jxbleo/NGSL";
const unitsToImport = [
  { id: "NGSL-B", source: path.join(sourceRoot, "NGSL-B.md"), cefrLevel: "B1" },
  { id: "NGSL-C", source: path.join(sourceRoot, "NGSL-C.md"), cefrLevel: "B1" },
];

const simpleDefinitions = {
  nobody: "no person; not anyone",
  examine: "to look at something carefully to learn about it",
  lay: "to put something down carefully or in a flat position",
  speed: "how fast someone or something moves",
  politics: "ideas and activities about government and power",
  reply: "to answer someone in speech, writing, or action",
  display: "to show something so people can see it",
  transfer: "to move someone or something from one place to another",
  perfect: "as good as possible, with no mistakes",
  slightly: "a little; not very much",
  overall: "including everything or considering the whole situation",
  intend: "to plan or mean to do something",
  user: "a person who uses a thing, service, or system",
  respond: "to answer or react to someone or something",
  dinner: "the main meal of the day, often eaten in the evening",
  slow: "not fast, or to become less fast",
  regular: "happening often or following a normal pattern",
  physical: "related to the body or to real objects",
  apart: "separated by distance, time, or feeling",
  suit: "to be right for someone, or a formal jacket and trousers",
  federal: "related to a central national government",
  reveal: "to make something known that was hidden or secret",
  percentage: "an amount shown as part of one hundred",
  peace: "a time or state without war or fighting",
  status: "someone's position, rank, or official situation",
  crime: "an illegal action that can be punished by law",
  decline: "to become less, or to politely refuse",
  decade: "a period of ten years",
  launch: "to start, send, or introduce something new",
  warn: "to tell someone about possible danger or a problem",
  consumer: "a person who buys or uses goods and services",
  favor: "a kind action, support, or preference for someone",
  dry: "not wet, or to make something not wet",
  partner: "a person you work, live, or do something with",
  institution: "a large organization such as a school, bank, or hospital",
  spot: "a place, mark, or small area",
  horse: "a large animal people can ride or use for work",
  eventually: "in the end, after some time",
  heat: "warmth or high temperature",
  excite: "to make someone feel very interested or happy",
  reader: "a person who reads",
  importance: "the quality of being important or valuable",
  distance: "the amount of space between two places or things",
  guide: "to show someone where to go or what to do",
  grant: "to give someone something officially",
  taxi: "a car with a driver that you pay to take you somewhere",
  feed: "to give food to a person or animal",
  pain: "an unpleasant feeling in the body or mind",
  sector: "one part of an economy, activity, or area",
  mistake: "something that is wrong or done incorrectly",
  ensure: "to make certain that something happens",
  satisfy: "to give someone what they need or want",
  chief: "main or most important; a leader",
  cool: "slightly cold, calm, or fashionable",
  expert: "a person with a lot of skill or knowledge",
  wave: "to move your hand to greet someone, or a raised line of water",
  south: "the direction opposite north",
  labor: "work, especially hard physical work",
  surface: "the outside or top layer of something",
  library: "a place where books and other materials are kept",
  excellent: "very good; of very high quality",
  edge: "the outside line or border of something",
  camp: "a place where people stay in tents or simple buildings",
  audience: "the people watching or listening to a performance",
  lift: "to raise something or someone",
  procedure: "an official or usual way of doing something",
  email: "a message sent by computer or phone",
  global: "relating to the whole world",
  struggle: "to try very hard to do something difficult",
  advertise: "to tell people about a product, service, or event",
  select: "to choose someone or something",
  surround: "to be all around someone or something",
  extent: "how large, important, or serious something is",
  river: "a long natural flow of water",
  annual: "happening once every year",
  fully: "completely",
  contrast: "to compare differences, or a clear difference",
  roll: "to move by turning over and over",
  reality: "the true situation, not an idea or dream",
  photograph: "a picture made with a camera",
  artist: "a person who creates art",
  conflict: "a serious disagreement or fight",
  entire: "whole or complete",
  presence: "the fact that someone or something is in a place",
  crowd: "a large group of people together",
  corner: "the place where two lines, roads, or walls meet",
  gas: "a substance like air, or fuel for a car",
  shift: "to move or change, or a period of work time",
  net: "material with holes used to catch or hold things",
  category: "a group of people or things of the same type",
  secretary: "a person who organizes office work and records",
  defense: "protection from attack or criticism",
  quick: "fast or taking little time",
  cook: "to prepare food by heating it",
  spread: "to move or make something move over a larger area",
  nuclear: "related to the energy inside atoms",
  scale: "the size or level of something",
  driver: "a person who drives a vehicle",
  ball: "a round object used in games",
  cry: "to produce tears or make a loud sound",
  introduction: "the first part of something, or the act of presenting someone",
  requirement: "something that is needed or officially asked for",
  north: "the direction opposite south",
  confirm: "to say or show that something is true or certain",
  senior: "older, higher in rank, or more experienced",
  photo: "a picture made with a camera",
  refuse: "to say no or not accept something",
  transport: "to move people or goods from one place to another",
  emerge: "to appear or become known",
  map: "a drawing of an area, or to plan or show where things are",
  concept: "an idea or way of thinking about something",
  island: "land with water all around it",
  reform: "to improve a system by changing it",
  neither: "not one and not the other of two things",
  football: "a game played by two teams with a ball",
  survive: "to continue to live or exist after danger or difficulty",
  flight: "a trip by air, or the act of flying",
  left: "on the left side, or the past form of leave",
  solve: "to find an answer to a problem",
  neighbor: "a person who lives near you",
  background: "someone's experience, history, or the area behind something",
  technique: "a special way of doing something",
  traffic: "vehicles moving on roads",
  improvement: "a change that makes something better",
  tool: "an object or method used to do a job",
  consequence: "a result of an action or situation",
  circumstance: "a fact or condition that affects a situation",
  smoke: "the grey or black gas from something burning",
  reaction: "what someone does or feels because of something",
  rain: "water that falls from clouds",
  busy: "having a lot to do",
  lesson: "a period of learning or something learned from experience",
  brain: "the organ in your head that controls thought and feeling",
  mass: "a large amount or group of something",
  funny: "making people laugh, or strange",
  contribute: "to give something to help a person, group, or cause",
  failure: "a lack of success, or something that stops working",
  schedule: "a plan that shows times for activities",
  speaker: "a person who speaks, or a device that makes sound louder",
  bottom: "the lowest part of something",
  adopt: "to take and use something, or legally take a child as your own",
  combine: "to join two or more things together",
  mountain: "a very high natural area of land",
  waste: "to use too much or use something badly",
  hide: "to put or keep something where it cannot be seen",
  marriage: "the legal relationship between married people",
  ticket: "a piece of paper or digital record that gives entry or travel",
  meal: "food eaten at one time",
  colleague: "a person you work with",
  bag: "a container used for carrying things",
  repeat: "to say or do something again",
  equal: "the same in number, size, or value",
  expression: "a look on the face, or a way of saying an idea",
  plus: "added to; more than",
  extremely: "very much; to a very high degree",
  owner: "a person who has something as their own",
  plane: "an aircraft, or a flat surface",
  commercial: "related to business or advertising",
  lady: "a polite word for a woman",
  duty: "something you must do because it is right or required",
  strength: "physical power or a good quality",
  connect: "to join or link things together",
  cultural: "related to the ideas, art, and customs of a group",
  arrange: "to plan or put things in order",
  scheme: "a plan, often a clever or organized one",
  payment: "money paid for something",
  unfortunately: "used to say something is sad or unlucky",
  brief: "short in time or words",
  bird: "an animal with wings and feathers",
  demonstrate: "to show clearly how something works or is true",
  contribution: "something given to help a person, group, or cause",
  appreciate: "to be thankful for or understand the value of something",
  chapter: "one main part of a book",
  secret: "something known by only a few people",
  apparently: "as it seems or as people say",
  novel: "a long written story, or new and different",
  union: "a group joined together, often workers",
  burn: "to damage or be damaged by fire or heat",
  trend: "a general direction of change or development",
  initial: "first or at the beginning",
  pleasure: "a feeling of happiness or enjoyment",
  suggestion: "an idea or plan offered for someone to consider",
  critical: "very important, or saying what is wrong",
  gather: "to come together or collect things",
  mostly: "mainly; for the largest part",
  earth: "the planet we live on, or soil",
  pop: "to make a short sharp sound, or popular music",
  essential: "very important and necessary",
  desire: "a strong wish for something",
  promote: "to help something grow, or move someone to a higher position",
  currently: "at the present time",
  employ: "to give someone a job, or use something",
  path: "a small road or way to move forward",
  topic: "the subject being talked or written about",
  beach: "land covered with sand or stones next to the sea",
  attract: "to make someone interested or make something come closer",
  engage: "to interest someone or take part in something",
  powerful: "having a lot of power or influence",
  flower: "the colorful part of a plant that can make seeds",
  crisis: "a very serious or dangerous situation",
};

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function parseTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((part) => part.trim());
}

function parsePartOfSpeech(meaning) {
  const matches = [...meaning.matchAll(/(?:^|<br>|\s)(adj\.|adv\.|conj\.|prep\.|pron\.|v\.|n\.)/g)];
  return [...new Set(matches.map((item) => item[1]))].join(" / ");
}

function parseWords(content) {
  const lines = content.split("\n");
  const tableStart = lines.findIndex((line) => /^\|(?:NO\.|No\.|序号)\|/.test(line.trim()));
  if (tableStart === -1) throw new Error("Vocabulary table not found");
  const words = [];
  for (let i = tableStart + 2; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break;
    const parts = parseTableRow(line);
    if (!/^\d+$/.test(parts[0])) continue;
    const word = parts[1];
    if (!simpleDefinitions[word]) throw new Error(`Missing simple definition for ${word}`);
    const meaning = parts[3] || "";
    words.push({
      number: Number(parts[0]),
      word,
      emoji: parts[2] || "",
      meaning,
      partOfSpeech: parsePartOfSpeech(meaning),
      simpleDefinition: simpleDefinitions[word],
    });
  }
  return words;
}

function parseCefr(content, fallback) {
  const match = content.match(/CEFR Level:\s*([A-Z0-9 ]+)/i) || content.match(/^#\s*([A-Z][0-9])\s*$/m);
  return match ? match[1].trim() : fallback;
}

function parseGroupBlocks(content) {
  const quizSection = content.split(/#+\s*答案解析/)[0];
  const groupRegex = /###\s+第(.+?)组\s+\((\d+)-(\d+)\)\n\n([\s\S]*?)(?=\n###\s+第|\n#+\s*答案解析|$)/g;
  const groups = [];
  let match;
  while ((match = groupRegex.exec(quizSection)) !== null) {
    const block = match[4].trim();
    const parts = block.split(/\n\n/);
    const wordList = (parts[0] || "").split("|").map((item) => item.trim()).filter(Boolean);
    const questions = [...parts.slice(1).join("\n\n").matchAll(/(\d+)\.\s+([^\n]+)/g)].map((item) => ({
      number: Number(item[1]),
      prompt: item[2].trim(),
    }));
    groups.push({
      id: `${match[2]}-${match[3]}`,
      label: `第${match[1]}组`,
      rangeStart: Number(match[2]),
      rangeEnd: Number(match[3]),
      wordList,
      questions,
    });
  }
  return groups;
}

function parseAnswerBlocks(content, groups) {
  const parts = content.split(/#+\s*答案解析/);
  if (parts.length < 2) return groups;
  const groupRegex = /###\s+第(.+?)组\s+\((\d+)-(\d+)\)\n\n([\s\S]*?)(?=\n###\s+第|$)/g;
  const answerMap = new Map();
  let match;
  while ((match = groupRegex.exec(parts[1])) !== null) {
    const answers = [];
    const lineRegex = /(\d+)\.\s+\*\*(.+?)\*\*。([\s\S]*?)(?=\n\d+\.\s+\*\*|$)/g;
    let lineMatch;
    while ((lineMatch = lineRegex.exec(match[4].trim())) !== null) {
      answers.push({
        number: Number(lineMatch[1]),
        answer: lineMatch[2].trim(),
        explanation: lineMatch[3].trim(),
      });
    }
    answerMap.set(`${match[2]}-${match[3]}`, answers);
  }

  return groups.map((group) => {
    const answers = answerMap.get(group.id) || [];
    const answerByNumber = new Map(answers.map((answer) => [answer.number, answer]));
    const questions = group.questions.map((question) => {
      const answer = answerByNumber.get(question.number);
      return {
        ...question,
        answer: answer ? answer.answer : "",
        explanation: answer ? answer.explanation : "",
      };
    });
    return {
      ...group,
      questions,
      wordList: questions.map((question) => question.answer).filter(Boolean),
    };
  });
}

function sortOrderFor(id) {
  const match = id.match(/^([A-Z]+)-([A-Z])$/);
  if (!match) return 0;
  const sourcePrefix = match[1] === "NGSL" ? 1000 : match[1] === "NAWL" ? 2000 : 9000;
  return sourcePrefix + (match[2].charCodeAt(0) - 64);
}

function buildUnit(config) {
  const content = readFile(config.source);
  const words = parseWords(content);
  const quizGroups = parseAnswerBlocks(content, parseGroupBlocks(content));
  return {
    id: config.id,
    sectionId: "vocabulary",
    title: config.id,
    href: `vocabulary.html?set=${config.id}`,
    sortOrder: sortOrderFor(config.id),
    topic: "",
    tags: [],
    note: `${words.length} Words · ${quizGroups.length} Quiz Groups`,
    visible: true,
    sourceName: "NGSL",
    cefrLevel: parseCefr(content, config.cefrLevel),
    wordCount: words.length,
    words,
    quizGroups,
  };
}

function writeUnit(unit) {
  const jsonPath = path.join(projectRoot, "content/vocabulary", `${unit.id}.json`);
  const jsPath = path.join(projectRoot, "content/vocabulary", `${unit.id}.js`);
  fs.writeFileSync(jsonPath, JSON.stringify(unit, null, 2) + "\n");
  fs.writeFileSync(
    jsPath,
    "window.__VOCABULARY_UNITS__ = window.__VOCABULARY_UNITS__ || {};\n" +
      `window.__VOCABULARY_UNITS__[${JSON.stringify(unit.id)}] = ` +
      JSON.stringify(unit, null, 2) +
      ";\n"
  );
}

function catalogItem(unit) {
  return {
    id: unit.id,
    sectionId: "vocabulary",
    title: unit.id,
    href: unit.href,
    displayValue: `Words ${unit.words[0].number}-${unit.words[unit.words.length - 1].number}`,
    sortValue: unit.sortOrder,
    topic: "",
    tags: [],
    note: "",
    visible: true,
  };
}

function updateHomeCatalog(units) {
  const jsonPath = path.join(projectRoot, "data/home-catalog.json");
  const jsPath = path.join(projectRoot, "data/home-catalog.js");
  const catalog = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const byId = new Map(catalog.items.map((item) => [item.id, item]));
  units.forEach((unit) => byId.set(unit.id, catalogItem(unit)));
  catalog.items = [...byId.values()];
  fs.writeFileSync(jsonPath, JSON.stringify(catalog, null, 2) + "\n");
  fs.writeFileSync(jsPath, "window.__HOME_CATALOG__ = " + JSON.stringify(catalog, null, 2) + ";\n");
}

const units = unitsToImport.map(buildUnit);
units.forEach(writeUnit);
updateHomeCatalog(units);
units.forEach((unit) => {
  console.log(`${unit.id}: ${unit.words.length} words, ${unit.quizGroups.length} groups, ${unit.cefrLevel}`);
});
