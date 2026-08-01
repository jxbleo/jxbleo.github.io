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
  const teacherHtml = fs.readFileSync(path.join(root, "teacher.html"), "utf8");
  const studentFunction = fs.readFileSync(path.join(root, "cloudfunctions/studentVocabulary/index.js"), "utf8");
  const teacherFunction = fs.readFileSync(path.join(root, "cloudfunctions/teacherAdmin/index.js"), "utf8");
  assert(dashboardHtml.includes("assets/js/my-words-export.js?v=20260801-1"));
  assert(dashboardHtml.includes("assets/js/dashboard.js?v=20260801-4"));
  assert(dashboardHtml.includes('id="my-words-export-panel"'));
  assert(dashboardJs.includes("AI dictionary lookup is under development."));
  assert(teacherHtml.includes('id="teacher-dictionary-panel"'));
  ["updateNote", "updateWord", "mergeWords", "undoMerge", "requestAiDraft", "confirmAiDraft", "reportDictionaryIssue"].forEach((action) => {
    assert(studentFunction.includes(`action === "${action}"`), `missing student action ${action}`);
  });
  ["getStudentVocabulary", "listDictionaryWorkspace", "saveDictionaryEntry", "draftDictionaryWithAi"].forEach((action) => {
    assert(teacherFunction.includes(`action === "${action}"`), `missing teacher action ${action}`);
  });
  assert(studentFunction.includes('timeZone: "Asia/Shanghai"'));
  assert(!dashboardHtml.includes("VOCAB_AI_API_KEY"), "AI key configuration must not enter static HTML");
  console.log(`My Words feature tests passed: ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
