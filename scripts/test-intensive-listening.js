const assert = require("assert");
const fs = require("fs");
const path = require("path");
const service = require("../cloudfunctions/intensiveListening/service");

function unit() {
  return {
    unit_id: "unit-01",
    text: "It's a good boy.",
    start_seconds: 0,
    end_seconds: 3,
    slots: [
      { slot_id: "w1", answer: "It's", accepted_answers: ["it's"], prefix: "", suffix: "" },
      { slot_id: "w2", answer: "a", accepted_answers: ["a"], prefix: "", suffix: "" },
      { slot_id: "w3", answer: "good", accepted_answers: ["good"], prefix: "", suffix: "" },
      { slot_id: "w4", answer: "boy", accepted_answers: ["boy"], prefix: "", suffix: "." },
    ],
  };
}

function run() {
  assert.strictEqual(service.normalizeAnswer(" IT’S "), "it's");

  const first = service.gradeUnit(unit(), ["", "", "", ""], null, "student:unit");
  assert.strictEqual(first.effective, true);
  assert.strictEqual(first.state.checks, 1);
  assert.deepStrictEqual(first.marks, [false, false, false, false]);

  const unchanged = service.gradeUnit(unit(), ["", "", "", ""], first.state, "student:unit");
  assert.strictEqual(unchanged.effective, false);
  assert.strictEqual(unchanged.state.checks, 1);

  const partlyCorrect = service.gradeUnit(unit(), ["it's", "x", "good", "boy"], unchanged.state, "student:unit");
  assert.strictEqual(partlyCorrect.effective, true);
  assert.strictEqual(partlyCorrect.state.checks, 2);
  assert.deepStrictEqual(partlyCorrect.marks, [true, false, true, true]);

  const completed = service.gradeUnit(unit(), ["wrong", "a", "wrong", "wrong"], partlyCorrect.state, "student:unit");
  assert.strictEqual(completed.state.completed, true, "previously correct positions stay locked");
  assert.deepStrictEqual(completed.marks, [true, true, true, true]);

  assert.strictEqual(service.revealUnit(unit(), first.state).allowed, false);
  const threeChecks = { ...partlyCorrect.state, checks: 3 };
  const revealed = service.revealUnit(unit(), threeChecks);
  assert.strictEqual(revealed.allowed, true);
  assert.strictEqual(revealed.state.assisted, true);
  assert.strictEqual(revealed.answerText, "It's a good boy.");

  const material = { material_id: "IL-TEST", set_id: "IL-TEST", title: "Test", audio_src: "audio.mp3", units: [unit()] };
  const publicView = service.publicMaterial(material);
  assert.strictEqual(JSON.stringify(publicView).includes("It's"), false, "bootstrap must not expose answers");
  assert.strictEqual(publicView.units[0].slots[3].suffix, ".");

  const root = path.resolve(__dirname, "..");
  const metadata = JSON.parse(fs.readFileSync(path.join(root, "content/intensive-listening/IL-BBC-260813.json"), "utf8"));
  assert.strictEqual(metadata.href, "intensive-listening.html?set=IL-BBC-260813");
  assert.strictEqual(metadata.catalogVisible, false, "intensive listening must not create a Library entry");
  assert.ok(fs.existsSync(path.join(root, "bbc-audio/260813-who-does-the-housework.mp3")));
  assert.strictEqual(fs.existsSync(path.join(root, "data/IL-BBC-260813.json")), false, "private words must not be copied into public data");

  const bbcPractice = JSON.parse(fs.readFileSync(path.join(root, "data/BBC-260813.json"), "utf8"));
  assert.strictEqual(bbcPractice.intensiveListeningSetId, "IL-BBC-260813");
  const bbcRuntime = fs.readFileSync(path.join(root, "bbc.html"), "utf8");
  assert.ok(bbcRuntime.includes('id="lesson-intensive-listening"'));
  assert.ok(bbcRuntime.includes("intensive-listening.html?set="));

  const homeCatalog = JSON.parse(fs.readFileSync(path.join(root, "data/home-catalog.json"), "utf8"));
  assert.strictEqual(homeCatalog.sections.some((section) => section.id === "intensive-listening"), false);
  assert.strictEqual(homeCatalog.items.some((item) => item.id === "IL-BBC-260813"), false);

  console.log("Intensive Listening tests passed");
}

run();
