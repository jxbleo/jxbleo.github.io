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
  assert(dashboardHtml.includes('id="student-words-overlay"'), "Dashboard notebook must open the My Words quick preview");
  assert(dashboardHtml.includes('class="student-words-open-button" href="my-words.html"'), "the preview must link to the dedicated My Words workspace");
  assert(dashboardHtml.includes('id="student-words-preview"'), "the preview must expose a bounded recent-word surface");
  assert(!dashboardHtml.includes('id="my-words-search-trigger"'), "Dashboard must not retain the complete My Words runtime");
  assert(dashboardJs.includes("activeWords.slice(0, 7)"), "the Dashboard preview must show at most seven recent active words");
  assert(dashboardJs.includes("data-preview-speak"), "preview rows must provide pronunciation");
  assert(dashboardJs.includes("window.location.hash === '#my-words'"), "legacy Dashboard My Words links must redirect");
  assert(/assets\/css\/app\.css\?v=\d{8}-\d+/.test(dashboardHtml));
  assert(/assets\/js\/dashboard\.js\?v=\d{8}-\d+/.test(dashboardHtml));
  assert(myWordsHtml.includes("assets/js/my-words-export.js?v=20260801-1"));
  assert(myWordsHtml.includes('id="my-words-export-panel"'));
  assert(!myWordsHtml.includes('id="my-words-select-all"'), "Export must not retain the Select all results action");
  assert(myWordsHtml.includes('data-export-format="excel"'), "Export must offer Excel as a format choice");
  assert(myWordsHtml.includes('data-export-format="pdf"'), "Export must offer PDF as a format choice");
  assert(myWordsHtml.includes('id="my-words-export-submit"'), "Export must finish with one shared Export action");
  assert(myWordsHtml.includes('data-my-words-view="study"'));
  assert(myWordsHtml.includes('data-my-words-view="word-list"'));
  assert(myWordsHtml.includes("Review Mode · In design"));
  assert(myWordsHtml.includes('data-my-words-nav="word-list" aria-selected="true">My Words</button>'));
  assert(myWordsHtml.includes('id="my-words-search-trigger"'));
  assert(!myWordsHtml.includes('id="my-words-loading-sheet"'), "My Words must not block the page behind a batch loading surface");
  assert(myWordsHtml.includes('id="my-words-notebook"'), "the word workspace shell must exist at first paint");
  assert(!myWordsHtml.includes('id="my-words-notebook" hidden'), "the word workspace must stay visible while its first page loads");
  assert(myWordsHtml.includes('class="my-words-skeleton-card"'), "first paint must reserve stable word-card positions");
  assert(myWordsHtml.includes('id="my-words-density-trigger"'), "mobile toolbar must expose one layout picker trigger");
  assert(myWordsHtml.includes('data-my-words-density="triple"'), "layout picker must offer a three-column view");
  assert(myWordsHtml.includes('id="my-words-translation-trigger"'), "Word List toolbar must expose the Chinese meaning toggle");
  assert(myWordsHtml.includes('<text x="12" y="17" text-anchor="middle">中</text>'), "the Chinese meaning toggle must use the requested 中 SVG");
  assert(myWordsHtml.includes('class="my-words-toolbar-more my-words-export-trigger"'), "the toolbar must retain Export after the Chinese meaning toggle");
  assert(!myWordsHtml.includes('aria-controls="my-words-export-panel">•••</button>'), "Export must use a recognizable icon instead of an ellipsis");
  assert(myWordsHtml.includes('class="my-words-mobile-detail-shell"'), "mobile word detail must group the card with an external close action");
  assert(myWordsHtml.includes('id="my-words-mobile-detail-edit"'), "mobile word detail must expose an external pencil editor");
  assert(myWordsHtml.indexOf('id="my-words-mobile-detail-edit"') < myWordsHtml.indexOf('class="my-words-mobile-detail-card"'), "the pencil must sit outside and above the mobile detail card");
  assert(myWordsHtml.indexOf('class="my-words-mobile-detail-card"') < myWordsHtml.indexOf('id="my-words-mobile-detail-close"'), "mobile Close must sit after and outside the detail card");
  assert(!myWordsHtml.includes("WORD DETAILS"), "mobile word detail must not retain the old eyebrow label");
  assert(!myWordsHtml.includes('class="my-words-page-title"'));
  assert(myWordsJs.includes("AI dictionary lookup is under development."));
  assert(myWordsJs.includes("function wordChineseMeaning(dictionary)"), "word details must remove duplicated POS labels");
  assert(!myWordsJs.includes("escapeHtml(dictionary.source_name || 'Dictionary')"), "student word details must not expose dictionary provider labels");
  assert(myWordsJs.includes("mrcat_my_words_density"), "mobile column preference must persist on the current browser");
  assert(myWordsJs.includes("mrcat_my_words_show_chinese"), "the Chinese meaning preference must persist on the current browser");
  assert(myWordsJs.includes("indexList.classList.toggle('show-translations'"), "the toolbar toggle must update every word card together");
  assert(myWordsJs.includes("wordChineseMeaning(dictionary)].join(' ')"), "word-card Chinese text must not retain a middle-dot separator");
  assert(myWordsJs.includes("['single', 'double', 'triple']"), "saved density must accept all three mobile layouts");
  assert(myWordsJs.includes("indexList.addEventListener('touchmove'"), "mobile list motion must dismiss the density picker");
  assert(myWordsJs.includes("indexList.addEventListener('scroll'"), "independent desktop list scrolling must dismiss floating toolbar panels");
  assert(myWordsJs.includes("if (state.densityMenuOpen) setDensityMenuOpen(false)"), "scrolling must close an open density picker");
  assert(myWordsJs.includes("function positionExportPanel()"), "Export must anchor to the visible download button");
  assert(myWordsJs.includes("triggerRect.bottom + 8"), "Export must open directly below its trigger at any scroll depth");
  assert(myWordsJs.includes("if (state.exportOpen) setExportOpen(false)"), "moving the word list must dismiss Export");
  assert(myWordsJs.includes("var defaults = { chinese: true, part_of_speech: true, english_definition: true }"), "Default export must include English, Chinese, POS, and English definition");
  assert(myWordsJs.includes("if (state.exportFormat === 'pdf')"), "the shared Export action must honor the selected file format");
  assert(myWordsJs.includes("scheduleMobileAutoSpeech(word)"), "opening a mobile word card must schedule its pronunciation");
  assert(myWordsJs.includes("}, 1000);"), "mobile automatic pronunciation must wait about one second");
  assert(/if\s*\(isMobileLayout\(\)\)\s*\{\s*openMobileDetail\(\);\s*scheduleMobileAutoSpeech\(word\)/.test(myWordsJs), "only the phone single-column layout should open and pronounce the independent detail card");
  assert(myWordsJs.includes("if (!state.mobileDetailOpen || state.mobileDetailClosing || !isMobileLayout() || state.selectedId !== vocabId) return"), "delayed pronunciation must not play after its phone detail is closed or replaced");
  assert(myWordsJs.includes("cancelMobileAutoSpeech();\n            speakWord(speak.dataset.speakWord || '')"), "manual pronunciation must replace any pending automatic playback");
  assert(!/renderDesktopDetail\(\);\s*openMobileDetail\(\);/.test(myWordsJs), "tablet and desktop split layouts must update the right detail pane without opening a modal");
  assert(myWordsJs.includes("if (state.mobileDetailOpen && !isMobileLayout()) closeMobileDetail(true)"), "crossing into the split layout must remove any phone detail overlay");
  assert(myWordsJs.includes("function mobileWordDetailBodyHtml(word)"), "mobile word detail must use its own compact content hierarchy");
  assert(myWordsJs.includes("function updatedDetailContentHtml(word, mobile)"), "phone, tablet, and desktop details must share the updated content hierarchy");
  assert(myWordsJs.includes("data-fit-detail-title"), "detail titles must opt into single-line fitting");
  assert(myWordsJs.includes("function fitDetailTitles(root)"), "long word and phrase titles must shrink to their available first line");
  assert(myWordsJs.includes("var minimum = 9"), "title fitting must retain a readable floor before ellipsis fallback");
  assert(myWordsJs.includes("class=\"my-words-desktop-detail-toolbar\""), "the desktop detail pane must expose its own pencil toolbar");
  assert(myWordsJs.includes("data-start-detail-edit"), "phone and desktop pencils must enter the same unified editor");
  assert(!/return '<div class="my-words-detail-head"><span>Word details<\/span>' \+ detailActionsHtml/.test(myWordsJs), "the desktop detail pane must not retain the old three-dot layout");
  assert(!myWordsJs.includes("return '<div class=\"my-words-detail-head my-words-detail-head-mobile\">' + detailActionsHtml"), "mobile detail must not render the three-dot action menu");
  assert(myWordsJs.includes("data-mobile-edit-form"), "mobile detail must edit word, Source, and Note in one form");
  assert(myWordsJs.includes("source_contexts: Array.prototype.slice.call"), "the unified editor must save every displayed Source context");
  assert(myWordsJs.includes("Changing the English word may clear its dictionary details"), "mobile spelling edit must warn about dictionary loss");
  assert(!myWordsJs.includes("mobileDetailTargetMotion"), "detail open and close must not calculate source-card travel");
  assert(!myWordsJs.includes("card.animate(["), "detail open and close must not animate the card");
  assert(myWordsJs.includes("finishMobileDetailClose(target);"), "detail Close must finish immediately and preserve the selected target");
  assert(!myWordsJs.includes("var wordInput = mobileDetail.querySelector"), "entering pencil edit mode must not autofocus or auto-select the word field");
  assert(!myWordsJs.includes("mobileOverlay.addEventListener('click'"), "mobile word detail must ignore backdrop clicks");
  assert(myWordsJs.includes("if (state.mobileDetailOpen) return;"), "mobile word detail must ignore Escape");
  assert(myWordsJs.includes("if (!actions.contains(event.target)) actions.removeAttribute('open')"), "word action menus must close when the student clicks elsewhere");
  assert(!myWordsJs.includes("Saved word"), "mobile word detail must not retain the old Saved word label");
  assert(myWordsJs.includes('my-word-mobile-section\"><h3>Source</h3>'), "mobile word detail must label the source box");
  assert(myWordsJs.includes('my-word-mobile-section\"><h3>Note</h3>'), "mobile word detail must label the note box");
  assert(myWordsJs.includes("state.view !== 'word-list' && state.search"), "leaving Word List must clear its transient search");
  assert(myWordsJs.includes("Math.max(7, Math.min(14"), "overflowing mobile words must reuse bounded title-scroll timing");
  assert(myWordsCss.includes("grid-template-columns: repeat(2, minmax(0, 1fr));"), "mobile Word List must default to a two-column grid");
  assert(myWordsCss.includes(".my-words-index-list.is-triple"), "mobile Word List must provide a three-column grid");
  assert(myWordsCss.includes('.my-words-translation-trigger[aria-pressed="true"]'), "the active Chinese meaning toggle must have visible pressed feedback");
  assert(myWordsCss.includes(".my-words-index-list.show-translations .my-words-index-card small"), "word-card POS and Chinese meaning must appear only when requested");
  assert(/\.my-words-index-card small\s*\{[^}]*text-align:\s*left;/.test(myWordsCss), "word-card POS and Chinese meaning must align to the left");
  assert(myWordsCss.includes(".my-words-mobile-detail-close"), "mobile word detail must style an external Close capsule");
  assert(myWordsCss.includes(".my-words-mobile-detail-edit"), "mobile word detail must style its external pencil");
  assert(!myWordsCss.includes(".my-words-index-card.is-return-target"), "the former flashing return-target animation must be removed");
  assert(/@media \(max-width: 760px\)[\s\S]*\.my-words-index-card\[aria-selected="true"\][\s\S]*background:\s*rgba\(218, 241, 231, 0\.96\)/.test(myWordsCss), "the last-opened mobile word must keep a stable selected style");
  assert(/\.my-words-mobile-detail-card \.my-word-edit-form input,[\s\S]*font-size:\s*16px;/.test(myWordsCss), "mobile edit controls must stay at 16px to prevent focus zoom");
  assert(/\.my-words-workspace\s*\{[^}]*overflow:\s*clip;/.test(myWordsCss), "workspace clipping must not create a scroll container that offsets the sticky toolbar");
  assert(!/\.my-words-workspace\s*\{[^}]*overflow:\s*hidden;/.test(myWordsCss), "workspace overflow must not trap the sticky toolbar above the export panel");
  assert(myWordsCss.includes(".my-words-desktop-detail"), "desktop Word List must retain a separate detail pane");
  assert(myWordsJs.includes("mobileWordDetailBodyHtml(word)"), "desktop detail must reuse the updated phone lexical, Source, and Note body");
  assert(myWordsCss.includes(".my-words-desktop-detail-edit"), "desktop detail must style the shared pencil editor");
  assert(myWordsCss.includes(".my-word-desktop-title-cluster"), "desktop word and speaker must share one left-aligned title cluster");
  assert(/\.my-word-mobile-title-row h2\s*\{[^}]*overflow:\s*hidden;[^}]*white-space:\s*nowrap;/.test(myWordsCss), "mobile detail titles must never wrap beyond one line");
  assert(/\.my-words-desktop-detail-heading\s*\{[^}]*justify-content:\s*space-between;/.test(myWordsCss), "desktop title must keep the pencil at the far-right edge of its first row");
  assert(/\.my-words-desktop-detail-toolbar\s*\{[^}]*position:\s*sticky;/.test(myWordsCss), "the desktop pencil must remain available while its detail pane scrolls");
  assert(/\.my-words-notebook\s*\{[^}]*height:\s*calc\(100dvh - 171px\);[^}]*overflow:\s*hidden;/.test(myWordsCss), "desktop My Words must stay within the visible workspace instead of scrolling both columns together");
  assert(/\.my-words-index-list\s*\{[^}]*height:\s*100%;[^}]*overflow-y:\s*auto;/.test(myWordsCss), "the desktop word index must scroll independently");
  assert(/\.my-words-desktop-detail\s*\{[^}]*height:\s*100%;[^}]*overflow-y:\s*auto;/.test(myWordsCss), "the desktop detail pane must remain fixed and own any necessary detail scrolling");
  assert(myWordsJs.includes("if (selectedWordChanged) desktopDetail.scrollTop = 0"), "a newly selected desktop word must begin at the top of the fixed detail pane");
  assert(/@media \(max-width: 760px\)[\s\S]*\.my-words-notebook\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/.test(myWordsCss), "phone My Words must retain its document-scrolling layout");
  assert(myWordsCss.includes(".my-words-mobile-detail-overlay"), "mobile word details must use an independent modal");
  assert(myWordsCss.includes(".my-words-skeleton-card"), "loading must happen inside stable word-card placeholders");
  assert(/\.my-words-export-panel\.open\s*\{[^}]*position:\s*fixed;/.test(myWordsCss), "Export parameters must float at the current viewport position");
  assert(myWordsCss.includes("@view-transition"), "My Words must opt into same-origin document transitions");
  assert(myWordsCss.includes("view-transition-name: my-words-surface"), "the page header must share the Dashboard notebook transition surface");
  assert(myWordsCss.includes("@keyframes myWordsSkeletonSweep"), "word placeholders must use a restrained local loading treatment");
  assert(!myWordsCss.includes(".my-words-mobile-detail-overlay.is-closing"), "detail overlay must not retain a closing animation state");
  assert(myWordsJs.includes("function setWordsReady()"), "loaded words must replace the reserved loading surface without moving the toolbar");
  assert(myWordsJs.includes("var FIRST_PAGE_SIZE = 18"), "My Words must request a bounded first page");
  assert(myWordsJs.includes("function loadMoreWords()"), "My Words must load later pages progressively");
  assert(myWordsJs.includes("function ensureAllWordsLoaded(message)"), "search, sorting, and export must be able to complete the full collection on demand");
  assert(myWordsJs.includes("mrcat_my_words_first_page_v1"), "My Words must hydrate an owner-scoped warm first page");
  assert(dashboardJs.includes("function warmMyWordsFirstPage()"), "Dashboard must warm the first page after its primary content is ready");
  assert(studentFunction.includes("next_cursor"), "studentVocabulary must return a pagination cursor");
  assert(studentFunction.includes("has_more"), "studentVocabulary must report whether another page exists");
  assert(!/Forgot|A little|Know|Learning\/Mastered/.test(myWordsHtml), "the placeholder release must not add a learning system");
  assert(teacherHtml.includes('id="teacher-dictionary-panel"'));
  ["updateNote", "updateWord", "mergeWords", "undoMerge", "requestAiDraft", "confirmAiDraft", "reportDictionaryIssue"].forEach((action) => {
    assert(studentFunction.includes(`action === "${action}"`), `missing student action ${action}`);
  });
  assert(studentFunction.includes("function editableDetailUpdates(item, event)"), "updateWord must save Source and Note with the word edit");
  assert(studentFunction.includes("update.saved_examples = item.saved_examples"), "Source editing must preserve saved example snapshots");
  assert(studentFunction.includes("index < contexts.length"), "Source editing must update every displayed saved example snapshot");
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
