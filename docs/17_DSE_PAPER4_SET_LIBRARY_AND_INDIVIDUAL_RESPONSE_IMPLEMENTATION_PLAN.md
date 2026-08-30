# DSE Paper 4 Set Library and Individual Response — Detailed Engineering Plan

Status: approved for implementation on 2026-08-30
Owner: Mr. Cat Academy
Executor: coding agent operating in `/Users/jxbleo/jxbleo.github.io`
Primary source document: `/Users/jxbleo/Desktop/DSE_English_Paper4_Technology_Practice_Book.docx`

This document is intentionally explicit. The executor must follow it as an implementation contract and must not silently simplify product rules, merge Part A and Part B semantics, expose private CloudBase data, or overwrite unrelated work already present in the dirty working tree.

## 0. Executor protocol

### 0.1 Read before editing

Read these files in order:

1. `AGENTS.md`
2. `README.md`
3. `docs/01_PRODUCT_REQUIREMENTS.md`
4. `docs/02_ARCHITECTURE.md`
5. `docs/04_DATA_MODEL.md`
6. `docs/11_AGENT_TROUBLESHOOTING.md`
7. `docs/09_CONTENT_WORKFLOW.md`
8. `docs/10_DEPLOYMENT.md`
9. `docs/15_DSE_SPEAKING_LAB_IMPLEMENTATION_PLAN.md`
10. `docs/adr/0004-discussion-scoped-voice-identity-and-share-snapshots.md`
11. `docs/adr/0005-reusable-tencent-voiceprints.md`
12. This document
13. Current Speaking source and tests listed in section 16

The working tree is already dirty. Existing changes belong to the owner. Do not reset, clean, reformat, replace, or delete unrelated changes.

### 0.2 Baseline commands

Before editing, record but do not attempt to fix unrelated failures:

```bash
git status --short
npm run test:speaking-lab
node --check assets/js/speaking-lab.js
node --check assets/js/teacher-speaking.js
node --check cloudfunctions/speakingLab/index.js
node --check cloudfunctions/speakingAiWorker/index.js
git diff --check
```

### 0.3 Hard rules

- Keep all Speaking collections `ADMINONLY`.
- Derive student/teacher authority from server authentication only.
- Never trust browser-supplied role, UID, Student ID, Set content, source type, question text, duration limit, or report snapshot.
- Do not expose Tencent credentials, provider voiceprint IDs, raw share-token hashes, private audio file IDs, or model prompts.
- Do not store voiceprint enrolment WAV files.
- Do not allow a Set edit to mutate an already-started Session or generated report.
- Do not use display names, Set titles, or question numbers as authoritative identifiers.
- Do not reuse the general LMS `sets` collection. Speaking Sets have different content, ownership, revision, snapshot, and visibility semantics.
- Do not create a framework or add a new dependency.
- Do not create or modify production CloudBase resources without owner-gated authorization.
- Do not import Viewpoint Bank, Useful Language, the 60-second drill, or the reusable framework appendix from the Word source.
- Do not describe a mock passage as an authentic past-paper reproduction.

## 1. Approved product outcome

Speaking Lab becomes a DSE Paper 4 Set-first workspace.

The student landing view contains one primary `Choose a Set` card. Selecting a Set opens the current live Set content in this order:

1. Context article
2. Part A · Group Discussion
3. Part B · Individual Response

Part A has `Start Discussion`. It creates a normal existing multi-person Discussion and then uses the current Candidate, invitation, recording/upload, ASR, voice matching, report, and share flow.

Part B lists individual questions. Each question has its own `Start Response`. Starting one creates a private single-student Individual Response Session tied to that exact question and to an immutable Set/question snapshot.

Voiceprint is removed from the student home cards. The sidebar contains a `Voiceprint` item. Selecting it opens the existing reusable-voiceprint recording view in the main content area.

Teacher Speaking contains two top-level workspaces:

- `Reports`: current complete Discussion report list and detail
- `Sets`: create, view, edit, preview, show/hide, and safely delete eligible Speaking Sets

There is no Draft/Published/Archived Set state machine. Teacher edits save directly. Students see saved changes when they next load the Set. A simple `Show to students` boolean controls whether a Set is selectable for new student Sessions.

## 2. Frozen product decisions

### 2.1 Scope

- DSE English Language Paper 4 only.
- Part A remains Group Discussion.
- Part B is Individual Response.
- No pronunciation or delivery assessment in this release.
- The score display remains CS, IO, VL, and PD.
- PD is always `Not assessed` and receives no generated criticism.
- VL full label is `Vocabulary & Language Pattern`.
- The mandatory ASR uncertainty safeguard applies to both Part A and Part B.

### 2.2 Set identity and naming

Every Set has one immutable `set_id`.

Source kinds:

```text
pp    authentic Past Paper material
mock  original or adapted practice material
```

Canonical display labels:

```text
2024 PP · Set 1.1 · Digital Museum
2023 MOCK · Set 4.1 · Wearable Smart Devices
2019 MOCK · Translation Apps and Language Learning
```

The HKEAA number such as `4.1` is stored internally as `paper_version`. The UI may display it as `Set 4.1` because that is the learner-facing convention.

Stable Set ID format:

```text
dse-p4-<source_kind>-<exam_year>-<optional-paper-version>-<stable-topic-slug>
```

Examples:

```text
dse-p4-mock-2023-4-1-wearable-smart-devices
dse-p4-pp-2024-1-1-digital-museum
```

Changing the title, year, source note, version label, Context, Part A, or Part B never changes `set_id`.

### 2.3 Set update and visibility

- No Set status enum.
- Teacher edits update the current Set document directly.
- Every successful content save increments integer `content_revision` by exactly one.
- `visible_to_students` is the only availability flag.
- When false, the Set is absent from new student selection but remains available to teachers and remains resolvable for historical Sessions/reports.
- Hiding a Set does not revoke or mutate Sessions, audio, reports, or shares.
- A Set with any Session reference cannot be hard-deleted. The UI directs the teacher to turn off `Show to students` instead.
- A Set with no Session references may be hard-deleted by a teacher after a dedicated confirmation.
- Concurrent teacher edits use optimistic concurrency. The browser submits the last-read `content_revision`; a stale revision returns `SPEAKING_SET_STALE` and does not overwrite the newer document.

### 2.4 Snapshot rule

The live Set is read when a student selects it. The authoritative snapshot is created only when the student presses `Start Discussion` or `Start Response` and the server accepts the creation.

Every Session stores:

- `set_id`
- `set_content_revision`
- complete server-built Set snapshot needed by that Session
- current display label snapshot
- session type

Existing Sessions and generated reports never change when the teacher edits the live Set.

### 2.5 Part A

- `Start Discussion` creates the existing Discussion entity.
- The server derives `title` as `<Set title> · <Shanghai date>` unless the browser provides a valid edited title in the existing title field.
- The Discussion snapshot includes source metadata, Context title/body, Part A task instruction, and Part A discussion points.
- The existing `prompt_text` compatibility field remains populated from the frozen Part A snapshot so current reporting, sharing, and task modals keep working.
- New Set-based creation must not accept arbitrary browser `prompt_text` as authority.
- Existing historical/manual Discussions with no `set_id` remain readable and editable under the compatibility label `Custom prompt`.
- No automatic migration of old Discussions is required.

### 2.6 Part B question identity

Part B questions are children of a Set, but each has a stable immutable `question_id`.

Canonical question data:

```json
{
  "question_id": "ir_01",
  "order": 1,
  "text": "When do you normally use a translation app?"
}
```

Rules:

- `question_id` is the authority.
- `order` is display order only.
- Question text may be edited.
- Questions may be added, removed, or reordered for future Sessions.
- Existing Session snapshots remain unchanged.
- The teacher UI must not regenerate existing question IDs during reorder or ordinary text editing.
- A newly added question gets the next unused stable ID (`ir_09`, `ir_10`, and so on). Removed IDs are never reused within that Set.

Student UI labels questions `Question 1`, `Question 2`, and so on. A Response title is derived as `<Set title> · IR Q<order> · <Shanghai date>`.

### 2.7 Part B repetition and timing

- A Set may own many Individual Response Sessions.
- One Part B question may own many attempts by the same student.
- Every attempt is a new Session with a new `response_session_id`.
- Recording is designed for one uninterrupted answer.
- `0–60` seconds: normal timer.
- `60–65` seconds: timer and warning become red and announce that time is almost over.
- At 65 seconds: browser automatically stops the recording.
- The server accepts only formal response audio whose measured/declared duration is within a bounded tolerance around 65 seconds; the browser cannot increase the limit.
- A student may also upload a supported existing audio file. The server validates type/size/duration and applies the same maximum-duration rule.
- A failed upload or analysis can be retried idempotently without creating a duplicate Session.

### 2.8 Part B report

Part B has no Candidate roster, invitation, Guest, voice matching, voice reference, or external peer-access logic.

The server already knows the authenticated student owner. The Part B report contains only that student's analysis:

- Session details: date, duration, selected Set, selected question
- CS · Communication Strategies
- IO · Ideas & Organisation
- VL · Vocabulary & Language Pattern
- PD · Not assessed
- concise overall summary
- strengths
- priority actions
- language suggestions
- sample improved response
- complete transcript

Part B CS evaluates directness, stance, response control, qualification, and communicative clarity appropriate to an individual examiner question. Part B IO evaluates reason, explanation, example, sequencing, and conclusion. It must not apply group turn-taking criteria such as inviting another Candidate.

Part B shares are not part of this iteration unless the existing general student-report link can be reused without weakening authorization or exposing data. If safe reuse would be non-trivial, leave Part B sharing absent and record it in the backlog.

### 2.9 Voiceprint navigation

- Remove the Voiceprint card from student home.
- Add a `Voiceprint` row to the existing left sidebar.
- Selecting it closes the sidebar on phone and renders the existing reusable voiceprint summary/setup controls in the main content area.
- Voiceprint remains account-scoped and reusable across Discussions.
- It does not create or affect Individual Response identity because the Part B owner is already authenticated.

### 2.10 Excluded source content

Do not import or create placeholder fields for:

- Viewpoint Bank
- Useful Language
- 60-second drill
- reusable technology-topic framework
- Part A Interaction Phrases appendix
- Part B 60-second Structure appendix
- Self-check appendix

If these are added later, they require a deliberate schema and UI iteration.

## 3. Domain model

### 3.1 Entities

```text
Speaking Set
├── one current editable content revision number
├── one Context
├── one Part A task with discussion points
└── many stable Part B questions

Speaking Set
├── many Part A Discussion Sessions
└── many Part B Individual Response Sessions

Part B Question
└── many Individual Response Sessions
```

### 3.2 Existing entity preservation

Keep the existing collections and meanings for:

- `speaking_discussions`
- `speaking_participants`
- `speaking_audio_assets`
- `speaking_ai_jobs`
- `speaking_reports`
- identity/share/voiceprint collections

Add Set references and frozen snapshots to Discussions. Do not split or rename existing production collections.

Create a separate Individual Response session collection rather than pretending a one-person response is a three-to-six-person Discussion.

## 4. CloudBase collections

All collections remain `ADMINONLY`.

### 4.1 New `speaking_sets`

Canonical top-level document:

```json
{
  "set_id": "dse-p4-mock-2024-1-1-digital-museums",
  "source_kind": "mock",
  "exam_year": 2024,
  "paper_version": "1.1",
  "title": "Digital Museums",
  "source_note": "Based on the officially confirmed 2024 Paper 4 version 1.1, ‘Digital museum’. Passage and questions are original.",
  "context": {
    "source_line": "This article appeared on a youth / education website:",
    "title": "Can a Museum Fit Inside a Phone?",
    "body": [
      "First paragraph...",
      "Second paragraph..."
    ]
  },
  "part_a": {
    "instruction": "You may want to talk about:",
    "discussion_points": [
      { "point_id": "pa_01", "order": 1, "text": "the benefits and limitations of a digital museum" }
    ]
  },
  "part_b": {
    "instruction": "The examiner will ask you one or more questions based on Part A. You will have up to 1 minute to respond.",
    "questions": [
      { "question_id": "ir_01", "order": 1, "text": "Do you prefer visiting a museum online or in person?" }
    ]
  },
  "content_revision": 1,
  "visible_to_students": true,
  "created_at": "Date",
  "created_by_teacher_uid": "UID",
  "updated_at": "Date",
  "updated_by_teacher_uid": "UID"
}
```

Validation:

- `set_id`: lower-case stable slug, 12–160 characters, unique.
- `source_kind`: exactly `pp` or `mock`.
- `exam_year`: integer 2000–2100.
- `paper_version`: null/empty or `^[0-9]{1,2}\.[0-9]{1,2}$`.
- `title`: required, trimmed, maximum 160 characters.
- `source_note`: optional, maximum 1000 characters.
- Context title required, maximum 300 characters.
- Context body: 1–20 non-empty paragraphs, maximum 20,000 combined characters.
- Part A: 1–12 non-empty points; stable `point_id` values.
- Part B: 1–20 non-empty questions; stable unique `question_id` values.
- All arrays are normalized and sorted by `order` on server output.
- No HTML is accepted. Browser renders text with `textContent`/escaping.

Indexes:

- unique `set_id`
- `visible_to_students + exam_year + updated_at`
- `source_kind + exam_year + paper_version`
- `updated_at`

### 4.2 Existing `speaking_discussions` additions

Optional fields for backward compatibility:

```json
{
  "session_type": "group_discussion",
  "set_id": "...",
  "set_content_revision": 3,
  "set_snapshot": {
    "display_label": "2024 MOCK · Set 1.1 · Digital Museums",
    "source_kind": "mock",
    "exam_year": 2024,
    "paper_version": "1.1",
    "title": "Digital Museums",
    "source_note": "...",
    "context": { "source_line": "...", "title": "...", "body": ["..."] },
    "part_a": { "instruction": "...", "discussion_points": [{"point_id":"pa_01","order":1,"text":"..."}] }
  }
}
```

Historical rows without these fields remain `custom_prompt` compatible.

### 4.3 New `speaking_individual_responses`

Canonical top-level document:

```json
{
  "response_session_id": "sir_<stable-random-id>",
  "session_type": "individual_response",
  "student_uid": "authenticated owner UID",
  "student_id_snapshot": "human login ID for teacher display only",
  "student_name_snapshot": "display name for teacher display only",
  "set_id": "...",
  "set_content_revision": 2,
  "set_snapshot": {
    "display_label": "...",
    "source_kind": "mock",
    "exam_year": 2024,
    "paper_version": "1.1",
    "title": "Digital Museums",
    "source_note": "...",
    "context": { "source_line": "...", "title": "...", "body": ["..."] }
  },
  "question_snapshot": {
    "question_id": "ir_03",
    "order": 3,
    "text": "Can virtual reality make history more interesting?"
  },
  "title": "Digital Museums · IR Q3 · 2026-08-30",
  "response_date": "2026-08-30",
  "duration_limit_seconds": 65,
  "recording_status": "not_uploaded",
  "formal_audio_asset_id": null,
  "analysis_status": "not_ready",
  "active_analysis_job_id": null,
  "active_report_version": null,
  "created_at": "Date",
  "updated_at": "Date",
  "deleted_at": null
}
```

Indexes:

- unique `response_session_id`
- `student_uid + created_at`
- `set_id + created_at`
- `analysis_status + updated_at`
- `deleted_at + updated_at`

### 4.4 Shared asset/job/report strategy

Preferred approach:

- Reuse `speaking_audio_assets`, `speaking_ai_jobs`, and `speaking_reports`.
- Add `session_type` plus exactly one locator: `discussion_id` or `response_session_id`.
- Keep existing Discussion fields untouched for old rows.
- Add Individual Response-specific job type and report schema version.

Every code path must reject ambiguous rows with both locators or neither locator.

If safe reuse would create widespread conditionals that weaken existing behavior, a dedicated response report collection is acceptable only after documenting the deviation in `docs/06_DECISIONS.md`. Do not make that deviation silently.

## 5. Server API

All actions live behind `speakingLab` and perform server-side authorization.

### 5.1 Set actions

```text
listSpeakingSets
getSpeakingSet
teacherListSpeakingSets
teacherGetSpeakingSet
teacherCreateSpeakingSet
teacherUpdateSpeakingSet
teacherSetSpeakingSetVisibility
teacherDeleteSpeakingSet
```

Rules:

- Student list/get returns visible Sets only.
- A student may resolve a hidden Set only through an owned historical Session projection, never by arbitrary `set_id`.
- Teacher actions require active teacher profile.
- Create validates an owner-supplied immutable `set_id` and checks uniqueness.
- Update requires `expected_content_revision` and increments revision transactionally.
- Visibility update is separate, idempotent, and does not increment content revision unless content also changed.
- Delete checks both Discussion and Individual Response references before deletion.
- Public projections exclude teacher UIDs and internal audit fields.

### 5.2 Part A creation

Extend `createDiscussion` to accept:

```json
{
  "set_id": "dse-p4-mock-2024-1-1-digital-museums",
  "discussion_date": "2026-08-30",
  "duration_seconds": 480,
  "title": "optional valid override"
}
```

The server:

1. loads visible Set by `set_id`;
2. builds a safe normalized snapshot;
3. derives `prompt_text` from Context + Part A points;
4. creates the Discussion and creator participant using current transaction/idempotency behavior;
5. stores snapshot and content revision;
6. returns the normal Discussion projection.

Retain a compatibility path for old clients/manual Discussions only if current production still requires it. New student UI must use `set_id` and must not send the full Set.

### 5.3 Individual Response actions

```text
listIndividualResponses
getIndividualResponse
createIndividualResponse
startIndividualResponseAudioUpload
finishIndividualResponseAudioUpload
startIndividualResponseAnalysis
deleteIndividualResponse
```

Rules:

- Student can read/mutate only own response Sessions.
- Teacher can list/read every response Session.
- Create accepts `set_id`, `question_id`, optional response date, and stable operation ID.
- Server loads current visible Set, resolves exact stable question, and builds snapshots.
- Create is idempotent for the same operation ID and owner/set/question scope.
- Upload uses the existing two-phase private Storage pattern.
- Analysis is durable and browser-independent.
- Delete is soft deletion and schedules private audio cleanup; it does not delete model-usage audit rows.

### 5.4 Teacher reporting

Teacher Speaking `Reports` should continue showing all Group Discussions. If Individual Response teacher review is included in this release, add a clear filter/capsule (`Group Discussion`, `Individual Response`) and preserve pagination. Do not mix one-person and group rows without an explicit type label.

At minimum the backend must expose teacher-authorized response details even if the final teacher Individual Response presentation is left as a simple first release.

## 6. Set snapshot helpers

Add pure shared helpers, preferably in `cloudfunctions/_shared/speaking-lab.js` or a narrowly scoped new shared module:

```text
normalizeSpeakingSetInput
speakingSetDisplayLabel
publicSpeakingSetProjection
buildGroupDiscussionSnapshot
buildIndividualResponseSnapshot
partACompatibilityPrompt
resolvePartBQuestion
validateSpeakingSetId
validatePaperVersion
```

Pure tests must cover:

- PP/MOCK label formatting with and without paper version;
- stable sorting by order;
- duplicate point/question IDs;
- missing/oversized fields;
- HTML-like content treated as inert text;
- snapshots containing only approved fields;
- question resolution by ID, not array position;
- content revision preserved in snapshot;
- Set edits do not mutate copied snapshots.

## 7. Individual Response AI pipeline

### 7.1 Speech stage

Reuse the existing provider adapter for English ASR with single-speaker expectations.

- Do not require diarization or Candidate count.
- Canonical transcript may still use segment IDs and timestamps.
- Ignore brief outside voices when provider evidence permits; never treat an outside interruption as the student by default.
- Preserve ASR confidence where available.
- Apply the same low-confidence protection before feedback.

### 7.2 Separate prompt and schema

Do not reuse the Group Discussion prompt by merely changing one sentence.

Add:

```text
INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION
individualResponseAnalysisPrompt()
individualResponseUserPrompt()
canonicalizeIndividualResponseReport()
```

Required model output shape:

```json
{
  "summary_zh": "...",
  "domains": {
    "communication_strategies": {
      "score": 0,
      "commentary_zh": "...",
      "evidence_segment_ids": []
    },
    "ideas_organisation": {
      "score": 0,
      "commentary_zh": "...",
      "evidence_segment_ids": []
    },
    "vocabulary_language_patterns": {
      "score": 0,
      "commentary_zh": "...",
      "evidence_segment_ids": []
    },
    "pronunciation_delivery": { "status": "not_assessed" }
  },
  "strengths": [],
  "priority_actions": [],
  "language_suggestions": [],
  "sample_response_en": "..."
}
```

Server canonicalization must:

- require exactly the three assessed domains and fixed PD state;
- clamp/reject scores outside integer 0–7 according to the existing strict policy;
- reject unknown evidence IDs;
- remove names and Student IDs from evidence/payload;
- cap list and text lengths;
- force PD to `not_assessed` even if the model returns a score;
- validate the improved sample as plain text;
- never use model-provided overall totals;
- preserve a strict schema version and prompt version.

### 7.3 Mandatory ASR safeguard

The Individual Response system prompt must include the existing mandatory safeguard:

- suspicious or low-confidence ASR tokens are not automatically student errors;
- one odd word cannot cause a score deduction or correction;
- exact language criticism needs repeated or unambiguous evidence;
- unknown confidence is neither proof of accuracy nor proof of error;
- pronunciation cannot be inferred from spelling or ASR substitutions.

### 7.4 Durable job rules

- Add job type `individual_response_analysis`.
- Reuse lease, retry, dispatch, usage-ledger, stale-result, and cleanup boundaries.
- Queue rows store locators and safe stage/error fields only—never Set body, question text, transcript, prompt, name, URL, or provider response.
- The worker loads the frozen snapshot and private audio only when processing.
- A replaced/retried audio revision cannot publish into the wrong Session.
- Final result publication verifies owner Session, active asset, job revision, and current active job ID transactionally.

## 8. Student UI

### 8.1 Landing view

Replace the two mode cards and home Voiceprint card with one restrained Set-first surface.

Required initial state:

```text
Choose a Set
[search/filter optional if list is short]
[Set cards or picker]
```

Each Set row/card shows:

- display label (`2024 MOCK · Set 1.1`)
- title
- source kind badge only if it does not visually clutter the label

Order Sets newest exam year first, then paper version, then title. The teacher visibility flag determines student availability.

### 8.2 Selected Set view

After selection, render:

```text
Set header
Context article
Part A · Group Discussion
Part B · Individual Response
```

Context and questions are plain text. Preserve paragraph breaks. Do not render source HTML.

Part A card shows all discussion points and `Start Discussion`.

Part B shows the instruction followed by separate numbered question rows. Each row has one `Start Response` control.

The student can return to Choose a Set without opening the sidebar.

### 8.3 Discussion creation

After `Start Discussion`, retain the current creation dialog only for:

- title (pre-filled and editable)
- date (defaults to current Shanghai date)
- duration (existing participant-based default, still adjustable)

Remove the prompt textarea from new Set-based creation. Show a read-only Set summary instead.

### 8.4 Individual Response creation and recording

Clicking `Start Response` creates/opens a Response workspace for that question.

The recording surface should have the minimum necessary controls:

- selected question
- Start recording
- Stop recording (available before 65 seconds)
- timer
- discard/re-record before upload
- upload existing audio
- upload and analyse

Timing UI:

- normal through 59.9 seconds;
- add a red `Time is almost over` state from 60.0 seconds;
- automatically stop at 65.0 seconds;
- support reduced motion without pulse animation;
- announce warning and stop through `aria-live` without repeating every timer tick.

Do not persist the browser recording in localStorage or IndexedDB.

### 8.5 Response report view

Once upload is accepted, replace preparation controls with progress/report state, following the existing separation between upload and report screens.

Ready report order:

1. `SESSION DETAILS`: Date, Duration, Set, Question
2. `YOUR ANALYSIS`: CS, IO, VL, PD
3. strengths/priorities/language guidance and sample response
4. collapsed `Complete script`

The page must remain usable at 320, 375, 390, 768, 834, and 1024 CSS px, with no horizontal overflow.

### 8.6 Sidebar

Sidebar order:

1. Home
2. New/Choose a Set action
3. Voiceprint
4. invitations/identity notices
5. Group Discussions
6. Individual Responses, clearly labelled

`Voiceprint` opens the main voiceprint view. It is not a home card and not merely a dialog launched inside the sidebar.

## 9. Teacher UI

### 9.1 Workspace navigation

Inside Teacher `Speaking`, add local tabs/capsules:

```text
Reports
Sets
```

Keep the current report experience under `Reports` without regression.

### 9.2 Set list

Teacher Set list shows:

- display label
- title
- visibility
- content revision
- last updated time
- Edit
- Preview

Provide `Create Set`.

### 9.3 Set editor

Fields:

- immutable Set ID (editable only before first successful create)
- source kind: PP or MOCK
- exam year
- optional paper version
- title
- optional source note
- Context source line
- Context title
- Context paragraphs
- ordered Part A discussion points
- ordered Part B questions
- Show to students

Part A and Part B rows support add, delete, and reorder. Existing row IDs remain hidden or read-only technical metadata; reordering must not regenerate them.

The Save button sends `expected_content_revision`. A stale error reloads nothing automatically and tells the teacher another edit exists.

Preview uses the same safe renderer as the student Set detail where practical.

### 9.4 Delete behavior

- Dedicated confirmation modal.
- If no Session references exist: delete.
- If references exist: server returns `SPEAKING_SET_IN_USE`; UI offers/points to `Show to students` off.
- Never cascade-delete Sessions, audio, reports, or shares from a Set delete.

## 10. First five test Sets

Import exactly the first five Practice Sets from the provided Word document. They are all `MOCK`, because the document states the passages and questions are original even where an official topic/version inspired them.

Do not import the later Viewpoint Bank, Useful Language, or 60-second drill blocks.

### 10.1 Set 1

```text
set_id: dse-p4-mock-2019-screen-time-controls-for-teenagers
source_kind: mock
exam_year: 2019
paper_version: null
title: Screen-time Controls for Teenagers
source_note: Based on the officially confirmed 2019 topic title “Apple Screen Control”. Passage and questions are original.
context title: Can a Phone Teach Us When to Put It Down?
```

Part A points and eight Part B questions must match the Word source exactly.

### 10.2 Set 2

```text
set_id: dse-p4-mock-2019-translation-apps-and-language-learning
source_kind: mock
exam_year: 2019
paper_version: null
title: Translation Apps and Language Learning
source_note: Based on the officially confirmed 2019 topic title “Translation Apps”. Passage and questions are original.
context title: A Helpful Language Partner — or a Dangerous Shortcut?
```

### 10.3 Set 3

```text
set_id: dse-p4-mock-2023-4-1-wearable-smart-devices
source_kind: mock
exam_year: 2023
paper_version: 4.1
title: Wearable Smart Devices
source_note: Based on the officially confirmed 2023 Paper 4 version 4.1, “Wearable smart devices”. Passage and questions are original.
context title: When Your Watch Knows More About You Than You Do
```

### 10.4 Set 4

```text
set_id: dse-p4-mock-2024-1-1-digital-museums
source_kind: mock
exam_year: 2024
paper_version: 1.1
title: Digital Museums
source_note: Based on the officially confirmed 2024 Paper 4 version 1.1, “Digital museum”. Passage and questions are original.
context title: Can a Museum Fit Inside a Phone?
```

### 10.5 Set 5

```text
set_id: dse-p4-mock-2025-1-3-smartphones-replacing-personal-computers
source_kind: mock
exam_year: 2025
paper_version: 1.3
title: Smartphones Replacing Personal Computers
source_note: Based on the officially confirmed 2025 Paper 4 version 1.3, “As PC ownership declines, smartphones are on the rise”. Passage and questions are original.
context title: One Device for Everything?
```

### 10.6 Canonical local content file

Create a reviewed local source file under `content/speaking/`, for example:

```text
content/speaking/dse-paper4-sets.json
```

This file is owner source/import input, not a public browser data source. `scripts/build-static-site.js` must not copy it into `dist/` unless a later explicit architecture decision makes Set content public. The student browser should load Sets from the authorized CloudBase function.

Create a validator/import-preparation script that:

- parses the file;
- validates every Set and stable child ID;
- rejects Viewpoint Bank/Useful Language/drill fields;
- writes ignored CloudBase import material under `.cloudbase-private/`;
- does not overwrite newer live teacher edits by default;
- supports a dry-run summary;
- requires an explicit owner-gated apply/import flow for CloudBase changes.

Prefer insert-missing behavior for initial seed data. Once a teacher edits a live Set, a routine content preparation command must not overwrite it silently.

## 11. Error codes and user copy

Add deterministic safe errors:

```text
SPEAKING_SET_NOT_FOUND
SPEAKING_SET_NOT_VISIBLE
SPEAKING_SET_ID_INVALID
SPEAKING_SET_EXISTS
SPEAKING_SET_INVALID
SPEAKING_SET_STALE
SPEAKING_SET_IN_USE
SPEAKING_QUESTION_NOT_FOUND
INDIVIDUAL_RESPONSE_NOT_FOUND
INDIVIDUAL_RESPONSE_ACCESS_DENIED
INDIVIDUAL_RESPONSE_AUDIO_TOO_LONG
INDIVIDUAL_RESPONSE_UPLOAD_INCOMPLETE
INDIVIDUAL_RESPONSE_ANALYSIS_NOT_READY
```

Messages must not reveal whether a hidden/private Set or another student's Response exists.

## 12. Security and privacy review

The implementation is incomplete unless it proves:

- students cannot list hidden Sets;
- students cannot create from a hidden Set;
- students cannot submit altered Set/question text;
- students cannot read another student's Individual Response by guessed ID;
- students cannot call teacher Set mutations;
- teacher Set delete cannot cascade into historical Sessions;
- Set snapshots exclude audit UIDs and unrelated Part B questions where unnecessary;
- individual jobs contain no question text, Set body, transcript, name, or URL;
- public static output contains no unintended private Set source if CloudBase delivery remains authoritative;
- external Group Discussion share projections remain unchanged;
- voiceprint provider IDs/credentials remain server-only;
- raw recordings remain non-downloadable through the application UI.

## 13. Automated tests

### 13.1 Extend `scripts/test-speaking-lab-rules.js`

Add pure cases for:

- Set ID and paper-version validation;
- PP/MOCK display labels;
- stable child IDs and order;
- Set normalization length/count bounds;
- snapshot immutability;
- Part B question resolution by ID;
- 65-second timing boundary helper if implemented as pure logic;
- individual report canonicalization;
- PD forced to not assessed;
- ASR evidence validation.

### 13.2 Extend `scripts/test-speaking-lab-service.js`

Static/service contract assertions:

- all new actions are wired;
- student/teacher boundaries are explicit;
- `createDiscussion` uses server Set lookup and snapshot;
- old custom Discussions remain supported;
- Individual Response jobs use `response_session_id` and no participant logic;
- queue rows exclude forbidden content;
- Set deletion checks both Session collections;
- stale revision protection exists;
- first five content records validate.

### 13.3 Extend `scripts/test-speaking-lab-ui.js`

Assert:

- one `Choose a Set` primary landing surface;
- no home Voiceprint card;
- sidebar Voiceprint item exists;
- selected Set renders Context, Part A, and Part B;
- new Discussion form has no editable prompt textarea;
- Part B questions each expose `Start Response`;
- 60-second red warning and 65-second automatic stop are represented;
- reduced-motion and phone styles exist;
- teacher Reports/Sets navigation exists;
- teacher editor preserves stable question IDs;
- user content is escaped.

### 13.4 New focused content test

Add `scripts/test-speaking-sets.js` and include it in `npm run test:speaking-lab`.

It must validate:

- exactly five initial Sets in the seed file;
- all are `mock`;
- expected IDs/year/version/title/source notes;
- exactly four Part A points per Set;
- exactly eight Part B questions per Set;
- stable `pa_01`–`pa_04` and `ir_01`–`ir_08` IDs;
- no excluded Viewpoint/Useful Language/drill keys or text headings;
- no duplicate IDs;
- no empty Context paragraphs/questions.

### 13.5 Syntax/release commands

Run after implementation:

```bash
npm run test:speaking-lab
node --check assets/js/speaking-lab.js
node --check assets/js/teacher-speaking.js
node --check cloudfunctions/_shared/speaking-lab.js
node --check cloudfunctions/speakingLab/index.js
node --check cloudfunctions/speakingLab/prompts.js
node --check cloudfunctions/speakingLab/schemas.js
node --check cloudfunctions/speakingAiWorker/index.js
npm run verify:release
npm run build:static
npm run package:functions -- speakingLab speakingAiWorker
git diff --check
```

Record pre-existing unrelated failures separately. Do not change unrelated files merely to make a global command green.

## 14. Manual browser verification

Use a local HTTP server, not `file://`.

Student checks:

1. Speaking opens to Choose a Set.
2. Only visible Sets appear.
3. Labels distinguish MOCK/PP and version.
4. Selecting each of the five Sets shows exact Context, four Part A points, and eight Part B questions.
5. Start Discussion pre-fills title/date/duration and contains no prompt editor.
6. Created Discussion stores/fetches the frozen Set snapshot and current existing Candidate flow still works.
7. Voiceprint appears only through sidebar and opens in main content.
8. Start Response creates a question-scoped Session.
9. Microphone allow/deny paths work.
10. Timer warns at 60 seconds and automatically stops at 65 seconds.
11. Re-record before upload works without browser persistence.
12. Upload/retry/refresh durable states work.
13. Ready response report shows only the owner analysis.
14. Historical Session remains unchanged after teacher edits its Set.

Teacher checks:

1. Existing group Reports still paginate/open/share.
2. Sets tab lists all five initial Sets.
3. Create, edit, reorder, add/remove question, and preview work.
4. Save increments revision.
5. Two stale editor tabs cannot overwrite one another.
6. Hide removes Set from new student selection.
7. Hidden Set's historical reports remain readable.
8. Unused Set can be deleted after confirmation.
9. Used Set cannot be deleted and can be hidden.

Responsive checks:

- 320, 375, and 390 px phones;
- 768 and 834 px tablets;
- 1024 px and desktop;
- iOS Safari modal alignment;
- Reduced Motion;
- Reduced Transparency;
- Increased Contrast;
- keyboard focus and Escape/dialog close behavior.

## 15. Documentation updates required in the same implementation

Update:

- `README.md`: Speaking now covers Set-first Part A and Part B; focused commands.
- `docs/01_PRODUCT_REQUIREMENTS.md`: approved Set, snapshot, visibility, Part B, timing, and teacher rules.
- `docs/02_ARCHITECTURE.md`: Set gateway, Session types, durable pipeline, source/import boundary.
- `docs/03_UI_UX_SPEC.md`: student/teacher Set screens, sidebar Voiceprint, response recording/report.
- `docs/04_DATA_MODEL.md`: new collections/fields/indexes and optional existing-field additions.
- `docs/05_CHANGELOG.md`: one product/architecture entry.
- `docs/06_DECISIONS.md`: separate Speaking Set library, snapshot-at-start, question identity, no status state machine.
- `docs/07_TESTING_CHECKLIST.md`: automated and manual gates.
- `docs/08_BACKLOG.md`: only deferred findings, including Part B external sharing if omitted.
- `docs/09_CONTENT_WORKFLOW.md`: DOCX-to-reviewed-Set seed workflow and insert-missing rule.
- `docs/10_DEPLOYMENT.md`: new collections/indexes, seed preparation/import, package/deploy order and rollback.
- `docs/11_AGENT_TROUBLESHOOTING.md`: only if a repeatable new failure is discovered.
- `docs/15_DSE_SPEAKING_LAB_IMPLEMENTATION_PLAN.md`: mark this document as the approved V2 extension rather than rewriting V1 history.

## 16. File-level work order

Inspect before editing:

```text
speaking-lab.html
teacher.html
assets/css/speaking-lab.css
assets/js/speaking-lab.js
assets/js/teacher-speaking.js
assets/js/voiceprint-recorder.js
cloudfunctions/_shared/speaking-lab.js
cloudfunctions/speakingLab/index.js
cloudfunctions/speakingLab/prompts.js
cloudfunctions/speakingLab/schemas.js
cloudfunctions/speakingLab/speech-provider.js
cloudfunctions/speakingLab/model-provider.js
cloudfunctions/speakingAiWorker/index.js
scripts/test-speaking-lab-rules.js
scripts/test-speaking-lab-service.js
scripts/test-speaking-lab-ui.js
scripts/test-speaking-voiceprints.js
scripts/build-static-site.js
scripts/prepare-cloudbase-data.js
scripts/package-cloudfunctions.js
package.json
```

Expected additions:

```text
content/speaking/dse-paper4-sets.json
scripts/test-speaking-sets.js
optional narrowly scoped Set validator/preparer module
```

Do not create a new permanent standalone page for every Set or question.

## 17. Implementation phases

### Phase A — Pure Set domain and seed data

1. Add normalization/label/snapshot helpers.
2. Extract first five Word Sets into canonical local JSON.
3. Add content validation test.
4. Add pure domain tests.

Exit gate: seed and pure tests pass before UI/database wiring.

### Phase B — Set gateway and teacher management

1. Add Set collection constants and projections.
2. Add list/get teacher/student actions.
3. Add transactional create/update/visibility/delete actions.
4. Add teacher Sets UI.
5. Add stale-edit and used-delete tests.

Exit gate: a mock backend can prove authorization, revision, visibility, and deletion rules.

### Phase C — Set-first student Part A

1. Replace home cards with Choose a Set.
2. Render selected Set.
3. Move Voiceprint to sidebar/main view.
4. Extend `createDiscussion` with server snapshot.
5. Preserve historical manual Discussion behavior.

Exit gate: current Part A tests plus new Set UI tests pass without voice/report regression.

### Phase D — Individual Response domain and UI

1. Add response Session collection/actions.
2. Add private upload and duration rules.
3. Add 65-second recorder UI.
4. Add list/detail/sidebar behavior.
5. Add owner and teacher authorization tests.

Exit gate: owned response can be created, recorded/uploaded, resumed, and never read by a peer.

### Phase E — Individual Response AI report

1. Add separate prompt/schema/canonicalizer.
2. Extend durable worker/job/report path.
3. Add report UI and teacher read view.
4. Add ASR safeguard tests and provider-boundary tests.

Exit gate: fixture/provider tests prove correct schema and stale-job protection.

### Phase F — Documentation, packages, and release plan

1. Update required docs.
2. Run all verification.
3. Build static output.
4. Package `speakingLab` and `speakingAiWorker` ZIPs.
5. Generate owner-gated collection/index/import/deploy plan.
6. Do not mutate CloudBase until explicitly authorized.

## 18. Deployment order

After review and owner authorization:

1. Back up/export affected Speaking collections.
2. Create `speaking_sets` and `speaking_individual_responses` as `ADMINONLY`.
3. Create required indexes and wait until active.
4. Deploy `speakingLab`.
5. Deploy `speakingAiWorker`.
6. Confirm worker ACL remains `invoke: false` and timer still runs.
7. Insert the five missing Set documents without overwriting existing IDs.
8. Smoke-test gateway with teacher and development student.
9. Publish/push static frontend.
10. Verify production with one Set-based Discussion and one Individual Response.

Static frontend must not be published before compatible gateway actions exist, otherwise students receive unknown-action errors.

## 19. Rollback

- Frontend rollback: restore prior static commit while leaving additive backend fields/collections intact.
- Function rollback: redeploy the immediately previous ZIPs. New optional fields do not break old rows.
- Data rollback: hide initial Sets by setting `visible_to_students: false`; do not delete Session-linked Sets.
- Do not delete Individual Response audio/reports merely to roll back UI.
- Do not weaken collection permissions during rollback.

## 20. Completion definition

Implementation is complete only when:

- all approved Set and Part B rules are implemented;
- the first five Word Sets validate exactly and excluded sections are absent;
- old manual Discussions still load;
- current Group Discussion Candidate, voiceprint, report, teacher share, and student share tests remain green;
- Set edits never change old Sessions/reports;
- Individual Response is question-scoped and supports repeated attempts;
- timing warns at 60 and stops at 65 seconds;
- Part B uses a separate rubric/prompt/schema with the ASR safeguard;
- student/teacher authorization and `ADMINONLY` collection boundaries are preserved;
- documentation, tests, static build, release verification, and function packages are complete;
- owner-gated production changes are itemized and either explicitly authorized or clearly left as owner actions.

## 21. Executor final report format

The implementing agent must return:

1. files changed;
2. behavior implemented;
3. data/schema changes;
4. documentation updated;
5. exact tests and results;
6. generated package paths;
7. remaining risks;
8. exact owner-gated CloudBase actions still required;
9. confirmation that unrelated dirty files were preserved.

## 22. Local implementation handoff

Phases A–F are implemented locally: shared Set normalization/snapshots,
first-five Set seed validation, authenticated student/teacher Set actions,
Set-first Part A UI, question-scoped Individual Response upload/timing,
separate durable ASR/model report path, documentation, static verification, and
function packaging. The full repository preparation command retains a known
unrelated NGSL-A content-version mismatch; focused Set-only preparation passes.
CloudBase collections/indexes/import/provider configuration/function
deployment/static publication remain owner-gated.
