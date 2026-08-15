# 09 Content Workflow

> This document explains how teacher materials become website content.
> Update it when content import rules, source locations, IDs, catalog behavior,
> or public/private answer boundaries change.

## 1. Main Principle

The teacher should provide teaching material, not hand-edit JSON, CloudBase
records, or links.

An agent should turn Markdown, PDFs, raw questions, audio files, corrections, or
natural-language notes into the correct project files and CloudBase import data.

## 2. Content Layers

The project has three content layers:

| Layer | Who reads it | Examples | Notes |
| --- | --- | --- | --- |
| Teacher source | teacher and agent | Markdown, PDF, transcript, answer key image | may live outside repo |
| Public runtime | browser | `data/*.json`, `content/**/*.json`, audio | no new private answers |
| Private grading | CloudBase functions | `.cloudbase-private/import/grading-keys-cloudbase.json` | never commit |

The public runtime layer can include passages, questions, choices, transcripts,
IDs, and display metadata. Correct answers, accepted variants, explanations,
and scoring rules should move into private CloudBase `grading_keys`.

Some older public runtime files still contain answer fields. Treat that as
legacy migration state, not the desired future pattern.

## 3. Default Content Intake Flow

For any new or changed teaching material:

1. Identify the family: BBC, IELTS Reading, IELTS Listening, Vocabulary, DSE,
   or temporary classroom material.
2. Read the nearest existing examples and templates.
3. Choose or preserve a stable `set_id`.
4. Update the human/source layer when it exists.
5. Update public runtime data under `data/` and metadata under `content/`.
6. Keep private grading material out of Git.
7. Rebuild generated catalog data.
8. Prepare CloudBase import data when `sets` or grading changed.
9. Validate JSON, links, question counts, and grading coverage.
10. Tell the owner exactly what still needs to be imported or deployed.

When unrelated local private sources prevent a full preparation run, target the
approved set without altering those sources:

```bash
node scripts/prepare-cloudbase-data.js --ids BBC-YYMMDD-V2
```

The resulting import files contain only the selected IDs. Import them with an
explicit matching `--ids` filter and only the required collections.

## 4. Stable IDs

Use stable IDs because assignments, attempts, grading keys, and STAR records
depend on them.

| Content type | Pattern | Example |
| --- | --- | --- |
| BBC | `BBC-YYMMDD` | `BBC-250724` |
| IELTS Reading | `C<book>-T<test>-P<passage>` | `C7-T1-P2` |
| IELTS Listening | `C<book>-T<test>-S<section>` | `C7-T1-S1` |
| Vocabulary | source/group code | `NGSL-A`, `Oxford5000-A` |

Do not rename a `set_id` after it has been assigned or attempted unless the
owner approves a deliberate migration.

## 5. Public Catalog Flow

Homepage/library metadata should come from `content/`, then generated catalog
files:

```bash
node scripts/build-home-catalog.js
```

This updates:

- `data/home-catalog.json`
- `data/home-catalog.js`

Do not hand-edit generated catalog files when the same change can be expressed
in `content/<section>/<set_id>.json`.

If a direct practice URL works but the homepage or Library does not show the
item, check both:

- `content/<section>/<set_id>.json`
- CloudBase `sets` import state

Teacher Library and Assign both read the static catalog for visibility, but
Assign can only create real assignments for items that also exist in CloudBase
`sets` with matching private `grading_keys`. A catalog-only item should appear
as import-required, not selectable, until CloudBase content import is applied.

## 6. CloudBase Import Flow

When sets or grading data changed, run:

```bash
node scripts/prepare-cloudbase-data.js
```

It writes ignored output under `.cloudbase-private/`, including:

- `import/sets-cloudbase.json`
- `import/grading-keys-cloudbase.json`
- `import/system-config-cloudbase.json`
- `public/` preview data with answers stripped where supported

The `*-cloudbase.json` files are JSON Lines: one complete JSON document per
line. The preferred import path is the owner-run CLI helper:

```bash
npm run cloudbase:import:content
npm run cloudbase:import:content -- --apply
```

The first command is a dry run. The second writes missing `sets` and
`grading_keys` records to the development CloudBase environment. Existing
records are not overwritten unless `--overwrite-existing` is passed after an
explicit owner review.

CloudBase console import of the JSON Lines files remains a fallback.

Never commit `.cloudbase-private/`.

## 7. BBC Workflow

BBC is usually a teacher-maintained Markdown workflow.

Typical source material may be in the owner's Obsidian/iCloud folder, outside
this repository. Paths can contain spaces, so quote paths carefully when using
shell commands.

For BBC transcript-only intake:

1. Create a teacher review draft outside the repository, for example under
   `/private/tmp`.
2. Include questions, answers, and evidence line references.
3. Use line references such as `L23` or `L23-L25`.
4. Do not create public website data until the owner approves the draft.

For an approved HKDSE Paper 3 teacher draft in the current
`Teachers Draft.md` format, import the reviewed Markdown and same-basename MP3
with:

```bash
node scripts/import-bbc-teacher-drafts.js \
  "/absolute/path/to/example-exercises Teachers Draft.md"
```

The importer requires Questions 1-10 as note-completion blanks and Questions
11-20 as four-option multiple choice. It validates the three-word answer limit,
keeps answers and explanations in ignored private source, copies the matching
audio, and generates the public runtime, metadata, and no-answer worksheet.

BBC public runtime rules:

- Use shared `bbc.html` for permanent BBC lessons.
- Preserve existing standalone classroom BBC HTML only when the owner asks to
  match those pages.
- New BBC runtime data should keep answers, accepted variants, explanations,
  and evidence out of committed `data/BBC-*.json`. Put that material in ignored
  local source files under
  `.cloudbase-private/source/bbc-six-minute-english/<set_id>.json`; the
  CloudBase prep script reads that source when creating `grading_keys`.
- Optional `renderTheme` metadata may change only the front-end presentation in
  shared `bbc.html`; it must not change question IDs, grading keys, attempts,
  History/Clear, Explain, or Argue behavior.
- The shared runtime's default presentation is the green BBC interface. Omit
  `renderTheme` when that interface is wanted; do not invent a separate green
  theme value.
- BBC practice pages can expose generated no-answer worksheet PDFs from
  `assets/pdf/bbc-six-minute-english/<set_id>/<set_id>-worksheet.pdf`. Generate
  them with `python3 scripts/generate-bbc-worksheets.py` for all BBC lessons or
  `python3 scripts/generate-bbc-worksheets.py BBC-YYMMDD` for one lesson. These
  PDFs must use only public exercise content: titles, fill-in sentences, blank
  lines, multiple-choice questions, and options. They must not include answers,
  explanations, accepted variants, evidence, or grading rules.
- Edition worksheets display the explicit `edition_label`, and a public first
  blank-section heading containing a word limit such as `NO MORE THAN THREE
  WORDS` is printed above the note-completion table.
- Fill-in-the-blank placeholders in `data/BBC-*.json` must be exactly `_____`.
- If a blank accepts multiple answers, store that answer as an array in the
  ignored private source so the importer can create accepted variants.
- After generating data, scan for `_{6,}` to catch bad placeholder lengths.

Required artifacts for a full BBC addition:

- runtime data under `data/`
- metadata under `content/bbc-six-minute-english/`
- worksheet PDF under `assets/pdf/bbc-six-minute-english/<set_id>/`
- audio asset if applicable
- updated `data/home-catalog.*`
- imported CloudBase `sets`
- imported CloudBase `grading_keys`

## 8. IELTS Reading Workflow

IELTS Reading often starts from PDFs.

Preferred locations:

- Metadata: `content/ielts-reading/<set_id>.json`
- Runtime data: `data/<set_id>.json`
- Shared page: `ielts-reading.html`

Before inventing a new question shape, inspect `ielts-reading.html`. Current or
historically used runtime types include:

- `tfng`
- `ynng`
- `mcq`
- `summary`
- `headings`

Some original IELTS formats can be represented through `summary` with choices,
but the student-facing instruction must be clear. If a new interaction is
needed, add it deliberately to the shared runtime page and update this document.

PDF extraction pitfalls:

- `pdftotext` may not be installed.
- Python `pypdf` can often extract text, but not always perfectly.
- File names may contain apostrophes.
- Some PDFs have incomplete text layers and need OCR or owner confirmation.
- Validate `JSON.parse` and expected question counts before committing.

## 9. IELTS Listening Workflow

IELTS Listening uses `ielts-listening.html`.

For a new listening set:

- Metadata goes in `content/ielts-listening/<set_id>.json`.
- Public runtime data goes in `data/<set_id>.json`.
- Audio goes under `assets/audio/ielts-listening/`.
- Public question HTML should use placeholders like `{{Q1}}`, `{{Q2}}`.
- Private answers should come from ignored local source files and be converted
  into CloudBase `grading_keys`.

Do not create permanent standalone IELTS Listening pages for each section.

## 10. Vocabulary Workflow

Vocabulary content may come from structured lists, units, or generated groups.

Rules to preserve:

- Every committed vocabulary JSON/JS unit must include a string
  `contentVersion`. It must equal the corresponding private
  `grading_keys.grading_version`; version values themselves are public, but
  answers and explanations remain private.
- Increase `contentVersion` whenever prompts, question-to-key mappings, answer
  forms, accepted answers, or explanations change. Deploy public content and
  private grading together. Old clients are rejected before a test starts, and
  already-started countable tests continue against their server-side snapshot.

- Timed Cloze Practice writes a notification-only activity attempt regardless
  of selected group count; Learn inline practice writes no attempt.
- Only Quiz mode writes a countable Vocabulary progress attempt. The current
  Quiz selector starts at five groups.
- Vocabulary sets default to `passing_percentage: 90` and
  `mastery_percentage: 100`; BBC sets default to `80` / `95`; other current
  content families keep `50` / `90` unless a set or assignment overrides them.
- Countable vocabulary attempts must retain selected group count, selected
  group IDs, overall score, and per-group results.
- NGSL, NAWL, and Oxford5000 are independent source sequences. Do not continue
  NAWL or Oxford5000 letter IDs after another source's final unit. NAWL starts
  at `NAWL-A`; Oxford5000 starts at `Oxford5000-A` for words `001-100`, with
  later 100-word batches continuing as `Oxford5000-B`, `Oxford5000-C`, and so
  on.
- For NGSL, NAWL, and Oxford5000 catalog display, keep `displayValue` as the
  source word-number range only, such as `001-100`, `901-963`, or
  `1001-1100`. Student and teacher Library cards use that range as the
  top-right metadata while preserving the unit title as the main card title.
- NGSL, NAWL, Oxford5000, and THINK2 vocabulary units include two static PDF
  download families by adding `wordlistPdf` and `worksheetPdf` metadata to both
  `content/vocabulary/<set_id>.json` and the browser-loaded companion
  `content/vocabulary/<set_id>.js`. `wordlistPdf.list` points to the complete
  unit wordlist. `worksheetPdf.list` points to a complete unit worksheet, while
  `worksheetPdf.sets` may map each `quizGroups[].id` to a generated single-set
  worksheet for future use. The student-facing vocabulary page exposes only the
  top-level `Wordlist` and `Practice` PDF buttons, not per-set download buttons.
  Practice worksheet PDFs must include only public exercise material such as
  group labels, word banks, and prompts; do not include answers, explanations,
  accepted variants, or grading rules.
- Generate practice PDFs with
  `python3 scripts/generate-vocabulary-worksheets.py <set_id> --kind practice`
  and wordlist PDFs with
  `python3 scripts/generate-vocabulary-worksheets.py <set_id> --kind wordlist`.
  Vocabulary outputs live under `assets/pdf/vocabulary/<set_id>/`: one
  `<set_id>-wordlist.pdf`, one `<set_id>-all-sets.pdf`, and one
  `<set_id>-set-<group-id>.pdf` per quiz group. The current worksheet style is
  a black-and-white exam-paper layout: the header shows only the vocabulary
  source/unit, the top right has separate `Name`, `Date`, and `Score` labels,
  each group uses a black `SET` ribbon beside a word-bank grid, and questions
  use only `No.` and `Sentence` columns with longer inline blanks. Do not add a
  separate answer column or answer lines. The current wordlist style is a
  fold-and-cover study table with emoji cues, grouped words, meaning/definition
  text, and self-check boxes. After generating, render representative pages to
  images and visually verify page headers, table rows, blanks, emoji rendering,
  and no-answer practice content before publishing.
- The `Download Practice` `Customise` path uses
  `assets/js/vocabulary-worksheet-pdf.js` to generate selected-group or
  shuffled worksheets in the browser. Its picker should show a `Set` label and
  one horizontal scrolling row of numeric set chips, while shuffle uses a hidden
  seed rather than exposing a Randomiser control. Keep that browser PDF
  generator visually aligned with the static ReportLab practice worksheet style
  whenever the paper layout changes.

Personal saved words are not content imports. They belong to
`student_vocabulary_items` through the `studentVocabulary` cloud function.

### NGSL/NAWL DOCX intake checks

Some NGSL/NAWL vocabulary source files are produced by the same document
workflow, so repeated issues can appear across units. Before converting one of
these `.docx` files into project data, extract the word table, quiz groups, and
answer explanations and verify:

- the word table has the expected contiguous number range, usually 100 rows;
- no vocabulary word is duplicated inside the same unit unless the owner
  deliberately confirms the source list contains duplicates;
- each quiz unit has 10 groups, each group has 10 questions, and each question
  has one matching answer/explanation;
- the answer for each quiz item is present in the displayed group options, or
  the prompt is rewritten so the base word fits naturally;
- prompts do not leak the answer elsewhere in the sentence;
- prompts use the required grammar form, such as plural, past tense, or
  third-person singular, instead of forcing an ungrammatical base word;
- answer explanations do not teach incorrect patterns, for example confusing a
  direct-object verb with a different prepositional pattern;
- word-form columns are not copied into `simpleDefinition`; suspicious derived
  forms should be cleaned or omitted.

If an answer needs an inflected form in the final student-facing prompt, either
make the Word Bank option use that exact answer form or rewrite the prompt so
the base vocabulary word is correct. Keep the `words[]` list anchored to the
base vocabulary item, and keep answers/explanations in private grading data.

## 11. Temporary Classroom Material

Temporary classroom HTML may remain standalone when speed and classroom use are
the priority.

Promote temporary material into the shared content system only when it becomes
recurring, assignable, or countable.

### Protected reference reports

When a report should offer only a visitor preview and a student-only full edition:

1. Keep the reviewed full source outside the public repository.
2. Build a public preview page containing only intentionally public excerpts.
3. Add `access: "student-preview"` catalog metadata only when the report should appear in Library.
4. Generate the ignored private payload with the command for that resource:
   `npm run prepare:dse-topic-bank -- --source /absolute/path/report.html` or
   `npm run prepare:jupas-report -- --source /absolute/path/report.html`.
5. Run `npm run test:protected-resources` and package `getProtectedResource`.
6. Deploy the CloudBase function before publishing the static preview/catalog.

Never implement this product state by committing the full report and applying
CSS blur. Removing styles must not reveal protected material.

## 12. Correction Flow

When the owner reports a content correction:

1. Find the source layer and runtime layer.
2. Update visible question/passages if needed.
3. Update private grading material if answers, accepted variants, or
   explanations changed.
4. Rebuild catalog or CloudBase import files when required.
5. Increase the Vocabulary `contentVersion`/`grading_version` pair when the
   correction changes any prompt or grading behavior.
6. Avoid overwriting teacher-approved `grading_keys` changes made through Argue.

Never fix only the visible text while leaving grading inconsistent.

## 13. Legacy Detailed Reference

The older root-level [CONTENT_WORKFLOW.md](../CONTENT_WORKFLOW.md) contains
historical notes and examples. This `docs/09_CONTENT_WORKFLOW.md` is the
current docs-system entry point.

## 14. Creating a New Content Edition

Only create an edition when the owner explicitly calls the material a new set or
V2/V3. Do not infer an edition from the number of edits.

1. Keep the original set's `id` unchanged.
2. Give the new set a suffix such as `-V2`.
3. Put matching edition metadata on every member of the family. The original is
   `edition_number: 1`; exactly one member is `is_latest_edition: true`.
4. Create independent runtime data and independent private grading data for the
   new concrete `set_id`. Audio may be shared.
5. Run the catalog builder, private-data preparation, and edition tests.
6. Import both the new `sets` and `grading_keys` records before making the new
   edition discoverable. Never rename historical assignment/attempt records.

For a same-edition BBC correction, optionally add/increment `contentVersion` in
both public runtime metadata and content metadata and match it to the private
`grading_version`. A prompt replacement does not regrade old attempts; an
accepted-answer correction may use the existing upward-only regrade path.
