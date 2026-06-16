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

## 4. Stable IDs

Use stable IDs because assignments, attempts, grading keys, and STAR records
depend on them.

| Content type | Pattern | Example |
| --- | --- | --- |
| BBC | `BBC-YYMMDD` | `BBC-250724` |
| IELTS Reading | `C<book>-T<test>-P<passage>` | `C7-T1-P2` |
| IELTS Listening | `C<book>-T<test>-S<section>` | `C7-T1-S1` |
| Vocabulary | source/group code | `NGSL-A` |

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
line. Use those files for CloudBase console import.

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

BBC public runtime rules:

- Use shared `bbc.html` for permanent BBC lessons.
- Preserve existing standalone classroom BBC HTML only when the owner asks to
  match those pages.
- Fill-in-the-blank placeholders in `data/BBC-*.json` must be exactly `_____`.
- If a blank accepts multiple answers, store `answer` as an array in canonical
  source data so the importer can create accepted variants.
- After generating data, scan for `_{6,}` to catch bad placeholder lengths.

Required artifacts for a full BBC addition:

- runtime data under `data/`
- metadata under `content/bbc-six-minute-english/`
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

- Practice Mode does not write attempts.
- Test Mode with 1-4 selected groups is self-test only and does not write
  attempts.
- Test Mode with 5 or more selected groups is countable.
- Countable vocabulary attempts must retain selected group count, selected
  group IDs, overall score, and per-group results.

Personal saved words are not content imports. They belong to
`student_vocabulary_items` through the `studentVocabulary` cloud function.

## 11. Temporary Classroom Material

Temporary classroom HTML may remain standalone when speed and classroom use are
the priority.

Promote temporary material into the shared content system only when it becomes
recurring, assignable, or countable.

## 12. Correction Flow

When the owner reports a content correction:

1. Find the source layer and runtime layer.
2. Update visible question/passages if needed.
3. Update private grading material if answers, accepted variants, or
   explanations changed.
4. Rebuild catalog or CloudBase import files when required.
5. Avoid overwriting teacher-approved `grading_keys` changes made through Argue.

Never fix only the visible text while leaving grading inconsistent.

## 13. Legacy Detailed Reference

The older root-level [CONTENT_WORKFLOW.md](../CONTENT_WORKFLOW.md) contains
historical notes and examples. This `docs/09_CONTENT_WORKFLOW.md` is the
current docs-system entry point.
