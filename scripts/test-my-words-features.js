const assert = require("assert");
const fs = require("fs");
const path = require("path");
const exporter = require("../assets/js/my-words-export.js");

async function main() {
  const words = [
    {
      vocab_id: "vocab_work",
      text: "work",
      personal_note: "注意搭配 work on",
      source_title: "BBC",
      activity_updated_at: "2026-07-31T17:30:00.000Z",
      saved_examples: [
        { form: "worked", context: "She worked late.", source_title: "BBC" },
        { form: "work", context: "We work together.", source_title: "IELTS" },
      ],
      dictionary: {
        chinese_meaning: "工作",
        part_of_speech: "noun / verb",
        phonetic: "/wɜːk/",
        english_definition: "activity involving effort",
      },
    },
  ];
  const data = exporter.tableData(words, ["chinese", "part_of_speech", "phonetic", "english_definition", "source", "context", "note", "saved_date"]);
  assert.deepStrictEqual(data.headers.slice(0, 4), ["English", "Chinese", "Part of Speech", "Phonetic"]);
  assert.strictEqual(data.rows[0][0], "work");
  assert(data.rows[0].includes("工作"));
  const contextCell = data.rows[0][data.fields.indexOf("context")];
  assert(contextCell.includes("[worked] She worked late."));
  assert(contextCell.includes("[work] We work together."));
  assert(data.rows[0].includes("BBC\nIELTS"));
  assert(data.rows[0].includes("注意搭配 work on"));
  assert(data.rows[0].includes("2026-08-01"), "saved date should use Asia/Shanghai");

  const blob = exporter.makeXlsxBlob(words, data.fields);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.strictEqual(bytes.readUInt32LE(0), 0x04034b50);
  assert(bytes.includes(Buffer.from("xl/worksheets/sheet1.xml")));
  assert(bytes.includes(Buffer.from("My Words")));
  assert(bytes.includes(Buffer.from("工作")));
  const output = path.join("/tmp", "mrcat-my-words-test.xlsx");
  fs.writeFileSync(output, bytes);

  const printable = exporter.printableHtml(words, ["english", "chinese", "note"]);
  assert(printable.includes("注意搭配 work on"));
  assert(printable.includes("@page{size:A4 landscape"));

  const root = path.resolve(__dirname, "..");
  const dashboardHtml = fs.readFileSync(path.join(root, "dashboard.html"), "utf8");
  const dashboardJs = fs.readFileSync(path.join(root, "assets/js/dashboard.js"), "utf8");
  const myWordsHtml = fs.readFileSync(path.join(root, "my-words.html"), "utf8");
  const myWordsJs = fs.readFileSync(path.join(root, "assets/js/my-words.js"), "utf8");
  const myWordsCss = fs.readFileSync(path.join(root, "assets/css/my-words.css"), "utf8");
  const teacherHtml = fs.readFileSync(path.join(root, "teacher.html"), "utf8");
  const studentFunction = fs.readFileSync(path.join(root, "cloudfunctions/studentVocabulary/index.js"), "utf8");
  const teacherFunction = fs.readFileSync(path.join(root, "cloudfunctions/teacherAdmin/index.js"), "utf8");
  assert(dashboardHtml.includes('href="my-words.html"'), "Dashboard notebook must open the dedicated My Words workspace");
  assert(!dashboardHtml.includes('id="student-words-overlay"'), "Dashboard must not retain a second My Words runtime");
  assert(dashboardJs.includes("window.location.hash === '#my-words'"), "legacy Dashboard My Words links must redirect");
  assert(/assets\/css\/app\.css\?v=\d{8}-\d+/.test(dashboardHtml));
  assert(/assets\/js\/dashboard\.js\?v=\d{8}-\d+/.test(dashboardHtml));
  assert(myWordsHtml.includes("assets/js/my-words-export.js?v=20260801-1"));
  assert(myWordsHtml.includes('id="my-words-export-panel"'));
  assert(myWordsHtml.includes('data-my-words-view="study"'));
  assert(myWordsHtml.includes('data-my-words-view="word-list"'));
  assert(myWordsHtml.includes("Review Mode · In design"));
  assert(myWordsHtml.includes('data-my-words-nav="word-list" aria-selected="true">My Words</button>'));
  assert(myWordsHtml.includes('id="my-words-search-trigger"'));
  assert(myWordsHtml.includes('id="my-words-density-trigger"'), "mobile toolbar must expose one layout picker trigger");
  assert(myWordsHtml.includes('data-my-words-density="triple"'), "layout picker must offer a three-column view");
  assert(myWordsHtml.includes('class="my-words-toolbar-more my-words-export-trigger"'), "the third mobile toolbar action must remain Export");
  assert(!myWordsHtml.includes('aria-controls="my-words-export-panel">•••</button>'), "Export must use a recognizable icon instead of an ellipsis");
  assert(myWordsHtml.includes('class="my-words-mobile-detail-shell"'), "mobile word detail must group the card with an external close action");
  assert(myWordsHtml.indexOf('class="my-words-mobile-detail-card"') < myWordsHtml.indexOf('id="my-words-mobile-detail-close"'), "mobile Close must sit after and outside the detail card");
  assert(!myWordsHtml.includes("WORD DETAILS"), "mobile word detail must not retain the old eyebrow label");
  assert(!myWordsHtml.includes('class="my-words-page-title"'));
  assert(myWordsJs.includes("AI dictionary lookup is under development."));
  assert(myWordsJs.includes("function wordChineseMeaning(dictionary)"), "word details must remove duplicated POS labels");
  assert(!myWordsJs.includes("escapeHtml(dictionary.source_name || 'Dictionary')"), "student word details must not expose dictionary provider labels");
  assert(myWordsJs.includes("mrcat_my_words_density"), "mobile column preference must persist on the current browser");
  assert(myWordsJs.includes("['single', 'double', 'triple']"), "saved density must accept all three mobile layouts");
  assert(myWordsJs.includes("function mobileWordDetailBodyHtml(word)"), "mobile word detail must use its own compact content hierarchy");
  assert(myWordsJs.includes("if (!actions.contains(event.target)) actions.removeAttribute('open')"), "word action menus must close when the student clicks elsewhere");
  assert(!myWordsJs.includes("Saved word"), "mobile word detail must not retain the old Saved word label");
  assert(myWordsJs.includes('my-word-mobile-section\"><h3>Source</h3>'), "mobile word detail must label the source box");
  assert(myWordsJs.includes('my-word-mobile-section\"><h3>Note</h3>'), "mobile word detail must label the note box");
  assert(myWordsJs.includes("state.view !== 'word-list' && state.search"), "leaving Word List must clear its transient search");
  assert(myWordsJs.includes("Math.max(7, Math.min(14"), "overflowing mobile words must reuse bounded title-scroll timing");
  assert(myWordsCss.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"), "mobile Word List must default to a two-column grid");
  assert(myWordsCss.includes(".my-words-index-list.is-triple"), "mobile Word List must provide a three-column grid");
  assert(myWordsCss.includes(".my-words-mobile-detail-close"), "mobile word detail must style an external Close capsule");
  assert(/\.my-words-mobile-detail-card \.my-word-edit-form input,[\s\S]*font-size:\s*16px;/.test(myWordsCss), "mobile edit controls must stay at 16px to prevent focus zoom");
  assert(/\.my-words-workspace\s*\{[^}]*overflow:\s*clip;/.test(myWordsCss), "workspace clipping must not create a scroll container that offsets the sticky toolbar");
  assert(!/\.my-words-workspace\s*\{[^}]*overflow:\s*hidden;/.test(myWordsCss), "workspace overflow must not trap the sticky toolbar above the export panel");
  assert(myWordsCss.includes(".my-words-desktop-detail"), "desktop Word List must retain a separate detail pane");
  assert(myWordsCss.includes(".my-words-mobile-detail-overlay"), "mobile word details must use an independent modal");
  assert(!/Forgot|A little|Know|Learning\/Mastered/.test(myWordsHtml), "the placeholder release must not add a learning system");
  assert(teacherHtml.includes('id="teacher-dictionary-panel"'));
  ["updateNote", "updateWord", "mergeWords", "undoMerge", "requestAiDraft", "confirmAiDraft", "reportDictionaryIssue"].forEach((action) => {
    assert(studentFunction.includes(`action === "${action}"`), `missing student action ${action}`);
  });
  ["getStudentVocabulary", "listDictionaryWorkspace", "saveDictionaryEntry", "draftDictionaryWithAi"].forEach((action) => {
    assert(teacherFunction.includes(`action === "${action}"`), `missing teacher action ${action}`);
  });
  assert(studentFunction.includes('timeZone: "Asia/Shanghai"'));
  assert(!myWordsHtml.includes("VOCAB_AI_API_KEY"), "AI key configuration must not enter static HTML");
  console.log(`My Words feature tests passed: ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
