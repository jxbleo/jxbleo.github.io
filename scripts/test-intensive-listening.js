const assert = require("assert");
const fs = require("fs");
const path = require("path");
const service = require("../cloudfunctions/intensiveListening/service");

function unit() {
  return {
    unit_id: "unit-01",
    practice_mode: "dictation",
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
  assert.strictEqual(service.progressScope({ material_id: "IL-TEST", content_version: "1" }), "IL-TEST");
  assert.notStrictEqual(service.progressScope({ material_id: "IL-TEST", content_version: "2" }), "IL-TEST");

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
  assert.strictEqual(revealed.state.reveal_position_version, 2);
  assert.strictEqual(revealed.answerText, "It's a good boy.");
  assert.strictEqual(revealed.state.completed, true, "revealed units still count as assisted completion");
  assert.deepStrictEqual(
    revealed.state.correct_positions,
    [true, false, true, true],
    "revealing an answer must preserve actual word correctness"
  );
  assert.deepStrictEqual(
    revealed.state.last_marks,
    [true, false, true, true],
    "revealing an answer must not turn a wrong word green"
  );

  const material = { material_id: "IL-TEST", set_id: "IL-TEST", title: "Test", audio_src: "audio.mp3", units: [unit()] };
  const publicView = service.publicMaterial(material);
  assert.strictEqual(JSON.stringify(publicView).includes("It's"), false, "bootstrap must not expose answers");
  assert.strictEqual(publicView.units[0].slots[3].suffix, ".");
  assert.strictEqual(publicView.units[0].practice_mode, "dictation");
  const revealedProgress = service.publicProgress(material, { unit_states: { "unit-01": revealed.state } });
  assert.strictEqual(revealedProgress.completed_count, 1);
  assert.strictEqual(revealedProgress.assisted_count, 1);
  assert.deepStrictEqual(revealedProgress.unit_progress["unit-01"].correct_positions, [true, false, true, true]);
  assert.strictEqual(revealedProgress.unit_progress["unit-01"].correct_positions_reliable, true);

  const legacyRevealedState = {
    checks: 3,
    completed: true,
    assisted: true,
    correct_positions: [true, true, true, true],
    last_marks: [true, true, true, true],
    last_wrong_hashes: ["", "", "", ""],
    replays: 2,
  };
  const repairedLegacyProgress = service.publicProgress(material, { unit_states: { "unit-01": legacyRevealedState } });
  assert.strictEqual(repairedLegacyProgress.completed_count, 1, "legacy assisted completion remains complete");
  assert.strictEqual(repairedLegacyProgress.assisted_count, 1, "legacy assisted count remains intact");
  assert.deepStrictEqual(
    repairedLegacyProgress.unit_progress["unit-01"].correct_positions,
    [false, false, false, false],
    "legacy synthetic all-green marks are neutralized when exact positions are unknown"
  );
  assert.strictEqual(repairedLegacyProgress.unit_progress["unit-01"].correct_positions_reliable, false);
  const currentAllCorrectAssisted = { ...legacyRevealedState, reveal_position_version: 2 };
  const currentAllCorrectProgress = service.publicProgress(material, { unit_states: { "unit-01": currentAllCorrectAssisted } });
  assert.deepStrictEqual(currentAllCorrectProgress.unit_progress["unit-01"].correct_positions, [true, true, true, true]);
  assert.strictEqual(currentAllCorrectProgress.unit_progress["unit-01"].correct_positions_reliable, true);

  const providedUnit = unit();
  providedUnit.slots[1].spelling_requirement = "provided";
  const providedGrade = service.gradeUnit(providedUnit, ["it's", "", "good", "boy"], null, "student:provided");
  assert.deepStrictEqual(providedGrade.marks, [true, true, true, true]);
  assert.strictEqual(providedGrade.state.completed, true, "provided words do not require student spelling");
  const mixedMaterial = {
    material_id: "IL-MIXED",
    set_id: "IL-MIXED",
    title: "Mixed",
    audio_src: "audio.mp3",
    policy_revision: 2,
    units: [
      { unit_id: "skip-1", practice_mode: "skip", text: "BBC ident", start_seconds: 0, end_seconds: 1, slots: [] },
      { unit_id: "listen-1", practice_mode: "listen_only", text: "Listen", start_seconds: 1, end_seconds: 2, slots: [] },
      providedUnit,
    ],
  };
  const mixedPublic = service.publicMaterial(mixedMaterial);
  assert.strictEqual(mixedPublic.unit_count, 1, "only dictation units count toward progress");
  assert.strictEqual(mixedPublic.sequence_count, 3);
  assert.strictEqual(mixedPublic.units[0].text, undefined, "skipped text stays private");
  assert.strictEqual(mixedPublic.units[2].slots[0].provided_text, "", "required answers stay private");
  assert.strictEqual(mixedPublic.units[2].slots[1].provided_text, "a", "provided words may be displayed");
  assert.strictEqual(service.progressSummary(mixedMaterial, { "unit-01": providedGrade.state }).percentage, 100);
  const exported = service.sourceMaterial(mixedMaterial);
  assert.deepStrictEqual(exported.segments[2].providedWordPositions, [2]);
  assert.strictEqual(exported.segments[0].practiceMode, "skip");

  const root = path.resolve(__dirname, "..");
  const metadataDir = path.join(root, "content/intensive-listening");
  const metadataFiles = fs.readdirSync(metadataDir).filter((name) => name.startsWith("IL-BBC-26") && name.endsWith(".json"));
  assert.ok(metadataFiles.length >= 17, "the imported BBC intensive listening batch must remain complete");
  metadataFiles.forEach((name) => {
    const metadata = JSON.parse(fs.readFileSync(path.join(metadataDir, name), "utf8"));
    const setId = name.slice(0, -5);
    const bbcId = setId.replace(/^IL-/, "");
    const bbcPractice = JSON.parse(fs.readFileSync(path.join(root, "data", bbcId + ".json"), "utf8"));
    assert.strictEqual(metadata.href, "intensive-listening.html?set=" + setId);
    assert.strictEqual(metadata.catalogVisible, false, setId + " must not create a Library entry");
    assert.strictEqual(bbcPractice.intensiveListeningSetId, setId);
    assert.ok(fs.existsSync(path.join(root, bbcPractice.audioSrc)), bbcId + " audio must exist");
    assert.strictEqual(fs.existsSync(path.join(root, "data", setId + ".json")), false, "private words must not be copied into public data");
  });
  const bbcRuntime = fs.readFileSync(path.join(root, "bbc.html"), "utf8");
  assert.ok(bbcRuntime.includes('id="lesson-intensive-listening"'));
  assert.ok(bbcRuntime.includes("intensive-listening.html?set="));
  assert.ok(bbcRuntime.includes("teacherMode ? '&teacher=1'"), "teacher preview keeps the BBC Intensive Listening capsule");

  const intensiveRuntime = fs.readFileSync(path.join(root, "assets/js/intensive-listening.js"), "utf8");
  assert.ok(intensiveRuntime.includes("submitSpellingDispute"));
  assert.ok(intensiveRuntime.includes("var passiveListening = state.visitorMode || mode !== 'dictation'"));
  assert.strictEqual(intensiveRuntime.includes("while (state.currentIndex < state.material.units.length && unitMode(currentUnit()) === 'skip')"), false);
  assert.ok(intensiveRuntime.includes("This unit still needs your answer."));
  assert.ok(intensiveRuntime.includes("exportMaterial"));
  assert.ok(intensiveRuntime.includes("moveToUnit(-1)"));
  assert.ok(intensiveRuntime.includes("moveToUnit(1)"));
  assert.ok(intensiveRuntime.includes("correct_positions_reliable === false"));
  assert.ok(intensiveRuntime.includes("loadVisitorMaterial"), "visitor runtime loads only the public BBC audio metadata");
  assert.ok(intensiveRuntime.includes("visitor-full-audio"), "visitor runtime creates one listen-only full-audio unit");
  assert.ok(intensiveRuntime.includes("Visitor Mode is listening-only"), "visitor runtime explains the answer lock");
  assert.ok(intensiveRuntime.includes("state.visitorFullAudio ? Infinity"), "visitor playback is not clipped to a private segment boundary");

  const intensivePage = fs.readFileSync(path.join(root, "intensive-listening.html"), "utf8");
  assert.ok(intensivePage.includes('id="previous-unit-button"'));
  assert.ok(intensivePage.includes('aria-label="Previous sentence"'));
  assert.ok(intensivePage.includes('id="next-unit-button"'));
  assert.ok(intensivePage.includes('aria-label="Next sentence"'));
  assert.ok(intensivePage.includes('class="il-argue-heart"'));
  assert.ok(intensivePage.includes('<strong>Sent to teacher.</strong><span>Thanks for your feedback.</span>'));
  assert.ok(intensivePage.includes('id="argue-sent-close"'));
  assert.ok(intensiveRuntime.includes("$('#argue-box').classList.add('sent')"));

  const teacherRuntime = fs.readFileSync(path.join(root, "assets/js/teacher.js"), "utf8");
  assert.ok(teacherRuntime.includes("renderIntensiveSpellingDispute"));
  assert.ok(teacherRuntime.includes("data-intensive-audio"));
  assert.ok(teacherRuntime.includes("Confirm Approve"));
  assert.ok(teacherRuntime.includes('data-decision="keep">Reject'));
  assert.ok(teacherRuntime.includes('data-decision="provide">Approve'));
  const teacherStyles = fs.readFileSync(path.join(root, "assets/css/app.css"), "utf8");
  assert.ok(teacherStyles.includes(".intensive-spelling-card"));
  assert.ok(teacherStyles.includes(".intensive-dispute-actions"));
  assert.ok(intensivePage.includes('class="il-passive-input"'));
  assert.ok(intensivePage.includes('value="No typing needed for this sentence."'));

  const homeCatalog = JSON.parse(fs.readFileSync(path.join(root, "data/home-catalog.json"), "utf8"));
  assert.strictEqual(homeCatalog.sections.some((section) => section.id === "intensive-listening"), false);
  assert.strictEqual(homeCatalog.items.some((item) => /^IL-BBC-/.test(item.id)), false);

  console.log("Intensive Listening tests passed");
}

run();
