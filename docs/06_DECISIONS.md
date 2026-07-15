# 06 Decisions

> Architecture Decision Records for important product and technical choices.
> Add a record when introducing a new dependency, platform, architecture pattern, data model rule, or major product constraint.

## 2026-07-15: Layer the Shared Visual System Over the Static Frontend

Decision:

Keep the existing static pages and add the shared visual system as modular
`liquid-glass-shell` and `spatial-workspace` CSS/JavaScript layers. Login and
public Library use presentation-only shell styling; authenticated Student and
Teacher pages may use the spatial layout and one page-level modal root while
preserving existing DOM hooks and backend boundaries.

Reason:

The owner wants a coherent, responsive interface without replacing the current
vanilla JavaScript application or risking CloudBase grading/account behavior.

Trade-offs:

- Good: visual and responsive changes remain statically deployable.
- Good: modal and workspace behavior can be shared without a framework.
- Cost: CSS precedence and page-level stacking require disciplined tests.
- Cost: practice runtimes deliberately remain visually separate.

Review condition:

Revisit only if the static pages become unmaintainable or a framework migration
is separately approved.

## 2026-07-15: Use Browser Speech for Lightweight Vocabulary Pronunciation

Decision:

Use `SpeechSynthesisUtterance` with `en-GB` for My Words and Vocabulary
Learn/Spell pronunciation controls instead of adding a new audio service or one
audio asset per vocabulary item.

Reason:

The words are already present in public runtime data, pronunciation is
non-countable practice feedback, and browser speech avoids provider keys,
CloudBase changes, and large audio libraries.

Trade-offs:

- Good: no backend deployment, content migration, or new dependency.
- Good: direct user clicks satisfy normal mobile browser playback rules.
- Cost: voice quality and availability vary by device/browser.
- Cost: homographs may use the device voice's default pronunciation.

Review condition:

Revisit if the owner requires one fixed recorded accent, offline audio, or
pronunciation-specific handling for homographs.

## 2026-06-16: Use Static Frontend With CloudBase Backend

Decision:

Use static HTML/CSS/vanilla JavaScript for the frontend and Tencent CloudBase for authentication, cloud functions, and database.

Reason:

The project is a small-to-medium teaching application maintained by a teacher with AI/developer assistance. A static frontend keeps deployment simple, while CloudBase provides enough backend capability for login, private grading, assignments, and attempts.

Trade-offs:

- Good: simple hosting, no frontend build system, easy to inspect pages.
- Good: CloudBase provides managed auth and database.
- Cost: backend deployment is manual and separate from static publishing.
- Cost: vanilla JS pages can become large without discipline.

Review condition:

Revisit if the frontend becomes hard to maintain, if multi-teacher commercial features require a richer backend, or if CloudBase limitations block required workflows.

## 2026-06-16: Keep Database Collections ADMINONLY

Decision:

All CloudBase collections remain `ADMINONLY`; browsers access data only through cloud functions.

Reason:

The system stores student data, assignments, attempts, private answers, accepted variants, and teacher corrections. Direct browser access would make permissions fragile.

Trade-offs:

- Good: simple security model.
- Good: grading keys stay private.
- Cost: more cloud function code is needed.

Review condition:

Only revisit if CloudBase supports a proven safer row-level permission design and there is a clear need.

## 2026-06-16: Store Correct Answers in Private `grading_keys`

Decision:

Correct answers, accepted variants, explanations, evidence, and scoring rules belong in CloudBase `grading_keys`, not public runtime JSON.

Reason:

Students should not be able to casually inspect public files to get answer keys. Teachers also need server-authoritative grading and Argue corrections.

Trade-offs:

- Good: supports trusted server-side grading.
- Good: supports answer rule history.
- Cost: content import has two layers: public data and private grading import.
- Cost: legacy public answers need gradual cleanup.

Review condition:

Do not reverse this. Only improve tooling around import/reconcile.

## 2026-06-16: Use Owner-Gated CloudBase Release Automation

Decision:

Use local helper scripts for release verification, cloud-function packaging, and
deploy-plan generation, but keep actual CloudBase deployment, data import,
environment variables, and cloud credentials under owner control.

Reason:

The project is maintained with AI/Codex assistance, but CloudBase account
authority, billing, production resources, and secrets must remain with the
owner. Semi-automation removes repetitive packaging and checklist work without
giving agents cloud authority.

Trade-offs:

- Good: faster releases with a repeatable local process.
- Good: agents can prepare artifacts without seeing secrets.
- Good: the owner has a clear review point before upload/import.
- Cost: deployment still requires a manual owner action.
- Cost: generated plans depend on reviewing the current dirty working tree.

Review condition:

Revisit only if the owner wants CI/CD. Any future CI/CD should be manually
triggered and require owner approval before CloudBase secrets are available.

## 2026-06-16: Use Insert-Missing CLI Import for Content Data

Decision:

Use `scripts/cloudbase-import-content.js` as the owner-run CLI path for
CloudBase content imports. The script dry-runs by default and writes only when
`--apply` is passed. Its default apply mode uses insert-missing semantics for
`sets` and `grading_keys`.

Reason:

Most content releases add new `set_id` records. Re-importing local
`grading_keys` with blind overwrite could erase teacher-approved Argue changes
made directly in CloudBase. Insert-missing import removes the console upload
step while preserving CloudBase as the authority for revised grading rules.

Trade-offs:

- Good: content imports can be done from the terminal.
- Good: repeat imports are safer because existing grading keys are not changed.
- Cost: intentional corrections to existing grading keys need explicit
  `--overwrite-existing` after owner review.

Review condition:

Revisit after a proper grading-key reconcile workflow exists.

## 2026-06-16: Attempts Are Immutable

Decision:

Every countable submission creates a new attempt record. Retries do not overwrite earlier attempts.

Reason:

The teacher needs full learning history, retry tracking, and reliable dispute handling.

Trade-offs:

- Good: auditability and progress history.
- Good: disputes can target exact historical answers.
- Cost: dashboards must aggregate attempts carefully.

Review condition:

Do not remove immutable attempts. Add archival/reporting tools if volume grows.

## 2026-06-16: Assignment Status Is Monotonic

Decision:

Assignment status can move `to_do -> passed -> mastered`, but normal code cannot downgrade it.

Reason:

A later low-scoring retry should not erase a student's already completed assignment. Latest attempt and best attempt are separate concepts.

Trade-offs:

- Good: completion is stable and teacher-friendly.
- Cost: UI must distinguish latest score from best/completion status.

Review condition:

Only revisit if the teacher explicitly wants assignment completion to reset under a new assignment instance.

## 2026-06-16: Completed Work Can Be Reassigned

Decision:

Completed, passed, mastered, or STAR history does not block assigning the same set again. Only an open assignment blocks duplication.

Reason:

Teachers may want repeated practice at different times. Historical completion should be preserved, not used as a permanent block.

Trade-offs:

- Good: preserves old attempts while allowing spaced repetition.
- Cost: dashboards and reports must treat assignment instances separately.

Review condition:

Revisit if teacher workflows require explicit "do not repeat" curriculum rules.

## 2026-06-16: Student Dashboard Shows Two Buckets

Decision:

Student dashboard displays `TO DO` and `FINISHED`; backend keeps detailed `passed` and `mastered`.

Reason:

The owner confirmed the simpler student view is preferred. STAR/mastery can still be shown inside finished cards.

Trade-offs:

- Good: less confusing for students.
- Cost: teacher/reporting views must expose more detail when needed.

Review condition:

Only split again if the owner explicitly asks for separate Passed/Mastered student tabs.

## 2026-06-16: Documentation System Uses Numbered Docs

Decision:

Use root `README.md` and `AGENTS.md`, with detailed canonical docs under `docs/01...`.

Reason:

The project is maintained by humans and AI Agents. Numbered docs create a stable reading order and reduce repeated rediscovery.

Trade-offs:

- Good: easier handoff.
- Cost: documentation must be kept current.

Review condition:

Revisit if docs become too fragmented or are no longer being updated.

## 2026-06-16: Do Not Introduce a Frontend Framework Yet

Decision:

Do not rewrite the app in React/Vue/Next or add a build tool at this stage.

Reason:

The current code is static and deployable. The biggest risks are backend rules, data flow, and documentation, not component technology.

Trade-offs:

- Good: no build/dependency burden.
- Cost: large HTML files need discipline and documentation.

Review condition:

Revisit if UI complexity grows enough that static pages slow development or cause frequent regressions.

## 2026-07-09: Generate Vocabulary PDF Downloads With ReportLab

Decision:

Use a local Python ReportLab script to generate static Vocabulary PDF downloads
from `content/vocabulary/<set_id>.json`: no-answer practice worksheets and
fold-and-cover wordlists.

Reason:

The owner wants student downloads to feel like deliberate worksheet handouts,
not browser printouts of the interactive page. Static PDFs keep the student
experience simple, avoid browser-specific print layout drift, and do not
require CloudBase or runtime grading access.

Trade-offs:

- Good: stable A4 pagination, headers, footers, and no-answer exercise output.
- Good: download buttons can link to ordinary static files.
- Good: no frontend PDF library or CloudBase function is needed.
- Good: the current worksheet style is a black-and-white exam-paper table with
  no logo or image dependency, a simple source/unit header, top-right
  `Name`/`Date`/`Score` tags, a black `SET` word-bank ribbon, and two-column
  question tables without a separate answer column.
- Good: wordlist PDFs embed a local CJK TrueType font for Chinese meanings and
  render emoji cues to small images before embedding them, avoiding missing
  glyph boxes in PDF viewers.
- Cost: generated PDFs must be rebuilt when vocabulary prompts or groups
  change.
- Cost: the local generation environment needs Python with ReportLab and
  Pillow for emoji wordlist rendering.

Review condition:

Revisit if worksheet styling becomes too complex for ReportLab or if the owner
wants dynamic per-student PDF content.

## 2026-07-09: Use Browser PDF Generation Only for Custom Vocabulary Worksheets

Decision:

Keep the static ReportLab Vocabulary PDFs as the default `Confirm` download,
and add a small local browser PDF generator for `Customise` downloads that need
selected groups or shuffled worksheet order.

Reason:

The owner wants `Download Practice` to support custom group selection and a
randomiser that shuffles each selected group's word bank and question order.
Pre-generating every group combination and shuffle permutation is not practical,
while a browser-generated PDF can use the already public no-answer vocabulary
question data without calling CloudBase or exposing grading keys. Keeping the
static full worksheet as the default preserves the most stable path for normal
classroom use.

Trade-offs:

- Good: no external CDN, network dependency, or CloudBase function is required
  for custom worksheet downloads.
- Good: static all-groups and single-group PDFs remain available for the common
  non-shuffled cases.
- Good: shuffled worksheets use a hidden randomiser seed so the dialog stays
  simple while selected groups and group order remain stable.
- Cost: the local browser generator duplicates the public no-answer worksheet
  layout used by the Python ReportLab source, so visual worksheet changes must
  be mirrored in both implementations.
- Cost: custom multi-group or shuffled PDFs depend on browser Blob downloads.

Review condition:

Revisit if custom worksheet PDFs need CJK wordlist text, richer typography, or
server-side archival.

## 2026-07-12: Dictionary-First My Words Enrichment

Decision:

Enrich personal saved words with a shared `vocabulary_lexicon`: project-curated
Vocabulary entries first, an optional frequency-bounded ECDICT import second,
and Free Dictionary API only for remaining cache misses. Personal saves return
before the browser requests enrichment.

Reason:

Students need dependable parts of speech and definitions without paying for a
large-language-model call on every saved word. The project already contains
thousands of bilingual curated entries, while shared caching makes repeated
unknown words a single provider lookup across all students.

Trade-offs:

- Good: no model cost and near-immediate curated/ECDICT results.
- Good: external outages never block or remove a saved personal word.
- Good: fixed backend-only provider access avoids exposed keys and arbitrary URLs.
- Cost: ECDICT data must be prepared and owner-imported separately.
- Cost: Free Dictionary API provides English data but generally no Chinese meaning.
- Cost: provider results require attribution and do not have a paid SLA.

Review condition:

Revisit the provider only if lookup reliability or licensing no longer fits the
product, or if contextual sense selection later justifies a bounded AI fallback.
