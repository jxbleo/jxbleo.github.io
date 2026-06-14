# Mr. Cat Academy Agent Guide

This file is the operating contract for any coding agent working in this
repository. Read it before editing code, importing content, changing CloudBase
data, or deploying functions.

## 1. Project Intent

Mr. Cat Academy is a static learning website with a CloudBase backend. The
owner should be able to give an agent Markdown, PDFs, raw questions, or
natural-language changes and have the agent turn them into complete website
content without asking the owner to hand-edit JSON, database records, or links.

The finished system lets the owner manage students from the teacher page,
assign work to individuals or classes, grade on the server, and retain every
countable attempt.

## 2. Read These Sources First

Use this order when learning the project:

1. `AGENTS.md`: binding implementation rules and invariants.
2. `CLOUDBASE_ARCHITECTURE.md`: full data model and product decisions.
3. `CLOUDBASE_DEPLOYMENT.md`: current console and deployment procedure.
4. `CONTENT_WORKFLOW.md`: how teaching material becomes website content.
5. Existing code and data: the final source of truth for current behavior.

If documentation conflicts with working code, investigate before changing
either. Preserve confirmed product rules, then update stale documentation in
the same change.

## 3. Ownership and Safety

The Tencent Cloud account, CloudBase environments, billing, domains, and
production authority belong only to the project owner.

Never commit or hard-code:

- Tencent Cloud `SecretId` or `SecretKey`
- administrator credentials, access tokens, or refresh tokens
- private keys or service-account files
- student passwords
- the initial/reset password
- private grading keys, answers, accepted variants, or explanations

The public browser configuration may be committed:

```text
environment: mrcat-dev-d9gwy2v1icdfdf597
region: ap-shanghai
timezone: Asia/Shanghai
```

Do not weaken database permissions. The collections below must remain
`ADMINONLY`. Do not modify production resources, billing, DNS, domains, or
account settings without explicit owner approval.

## 4. Repository Map

Important entry points:

- `index.html`: login and visitor entry
- `dashboard.html`: student dashboard
- `teacher.html`: separate teacher interface
- `bbc.html`, `ielts-reading.html`, `vocabulary.html`: practice runtimes
- `assets/js/cloudbase-client.js`: browser CloudBase wrapper
- `assets/js/practice-session.js`: practice submission integration
- `assets/js/dashboard.js`: student dashboard behavior
- `assets/js/teacher.js`: teacher interface behavior
- `content/`: canonical metadata and vocabulary source data
- `data/`: browser-readable exercise data and generated catalog
- `scripts/`: content import, catalog, and private-data preparation tools
- `cloudfunctions/`: cloud function source
- `deploy-packages/`: generated deployment ZIP files, not source

Do not make a new permanent standalone HTML page for each exercise. Reuse the
current schemas and shared practice pages. Temporary classroom pages may stay
standalone when the owner requests that.

### BBC standalone page lessons learned

Some older BBC 6 Minute English classroom pages live as standalone root-level
HTML files, for example `250904-the-joys-of-writing-lists.html` and
`250724-what-is-degrowth.html`. If the owner explicitly asks to match these
existing HTML pages, keep their current Formspree-style layout and behavior
instead of moving the task into the shared `bbc.html` runtime during that same
change.

Useful pitfalls from the 2025 BBC batch import:

- Source Markdown may be outside this repo in the owner's Obsidian/iCloud
  folder. Quote paths with spaces, for example
  `/Users/leoji/Library/Mobile Documents/iCloud~md~obsidian/Documents/jxbleo/BBC 6 Minute English/...`.
- The Markdown files can already contain all exercise content: fill blanks,
  answer-key table, multiple-choice questions, and Chinese explanations. Prefer
  converting that structure directly over rewriting questions by hand.
- Fill-blank pages should preserve the existing pattern: `Blank_01` through
  `Blank_20`, `Question_21` through `Question_30`, one student-name field,
  Formspree submit, and answer explanations revealed only after submission.
- Be careful with nested bullets. The nested `<ul>` must be inside the parent
  `<li>`; otherwise browsers may still render it, but the HTML is invalid and
  future styling can break.
- Verify generated pages mechanically: count blank inputs, multiple-choice
  blocks, explanation blocks, and ensure every `index.html` BBC card links to an
  existing file.
- One known source typo: `250821 Whats your favourite snack.md` had MC Question
  27's explanation labelled `D`, but option `C` is the correct answer. Fix the
  generated page to show `Question 27: C`.
- Browser verification with the in-app browser may block `file://` URLs. Start a
  local static server and test through `http://127.0.0.1:<port>/index.html`
  instead.
- A `git push` can time out locally even after another terminal succeeds. Check
  with `git log --oneline --decorate -5` and compare `git rev-parse HEAD
  origin/main`; matching hashes mean the push reached GitHub.

## 5. Authentication Has Two Linked Layers

A working student account always has both:

1. a CloudBase Authentication username/password end user
2. a top-level document in the `students` collection

The link is the authentication user ID stored as `auth_uid`. `student_id` is
the human-facing Login ID. These are not interchangeable.

Canonical student profile:

```json
{
  "auth_uid": "CLOUDBASE_AUTH_USER_ID",
  "student_id": "unique-login-id",
  "name": "Student Name",
  "class_group": "",
  "curriculum_track": "",
  "role": "student",
  "active": true,
  "must_change_password": true,
  "created_at": "Date",
  "updated_at": "Date"
}
```

All fields must be top-level. With `@cloudbase/node-sdk`, add documents using:

```js
await db.collection("students").add(student);
```

Never use `add({ data: student })`. That creates a nested `data` object and
causes `Profile incomplete`, failed lookups, and apparently missing accounts.
The same direct-add rule applies to `assignments` and `attempts`.

### Login ID uniqueness

`student_id` is unique; student names may repeat.

Before creating an account, check both:

- `students.student_id`
- CloudBase Authentication end-user username

If either exists, return `STUDENT_ID_EXISTS`. Do not auto-merge, auto-delete,
or silently repair duplicate accounts. The owner chose prevention at account
creation instead of migration complexity.

### Creating a student

The teacher page calls `teacherAdmin`. The function:

1. validates the authenticated teacher
2. checks Login ID uniqueness in both layers
3. creates a CloudBase Authentication end user
4. resolves its UID and enables it
5. creates the matching top-level `students` document
6. verifies the profile exists
7. deletes the new auth user if profile creation fails

Use the `@cloudbase/manager-node` end-user APIs:

- `createEndUser`
- `modifyEndUser`
- `setEndUserStatus`
- `deleteEndUsers`
- `getEndUserList`

Do not replace them with unified `createUser`. The website signs in with
CloudBase username/password end users; the wrong management API can create an
account visible in the console that cannot use the web login.

The initial password comes only from the `INITIAL_STUDENT_PASSWORD` cloud
function environment variable. Never put it in frontend code or Git.

### Teacher authority

A teacher also has a `students` document with `role: "teacher"` and
`active: true`. Every teacher action must derive the caller UID from
server-side authenticated context and require a matching active teacher
profile. Never trust a role, UID, or Student ID sent by browser code.

### Password and account state

- Passwords are not stored in the database and cannot be shown to teachers.
- Reset changes the CloudBase auth password to the configured initial password,
  enables the auth user, and sets `must_change_password: true`.
- Disabling/enabling a student updates both CloudBase Authentication status and
  `students.active`.
- Student password changes must use an authenticated CloudBase/server flow.
- CloudBase rejects weak passwords such as pure repeated digits, even at six or
  eight characters. Keep frontend and `changePassword` validation aligned with
  the short complex pattern: at least 6 characters with uppercase, lowercase,
  number, and symbol.

## 6. Database Collections

All collections use `ADMINONLY`:

- `students`: profiles and teacher/student roles
- `sets`: assignable exercise metadata
- `assignments`: assigned task instances
- `attempts`: immutable countable submissions
- `grading_keys`: private answers, explanations, and scoring rules
- `system_config`: defaults such as passing percentage
- `student_set_achievements`: permanent protected STAR records
- `answer_disputes`: student single-question Argue requests
- `grading_key_history`: immutable teacher grading-rule revisions

Read exact schemas in `CLOUDBASE_ARCHITECTURE.md` before adding fields.
Preserve these stable identifiers:

- `student_id`: unique Login ID
- `auth_uid`: authoritative authentication link
- `set_id`: stable content/exercise ID
- `assignment_id`: unique assignment instance
- `attempt_id`: unique immutable submission

Do not use display names as keys. In the teacher UI, identify a profile row by
database document ID (`profile_id`/`_id`) and use `auth_uid` for backend
ownership. This prevents same-name records from being selected together.

## 7. Assignment Rules

The separate `teacher.html` interface has four capsules:

- `Assign`
- `Library`
- `Students`
- `Argue`

### Assign

The teacher can choose a visible set or filter by column/keyword to assign
multiple sets, search students, filter by `class_group`, select one or multiple
students, assign to a filtered class, and optionally set a due date, passing
percentage, and mastery percentage.

For the same student and `set_id`:

- no previous assignment: `available`, selectable
- existing `not_done` or `failed`: `in_progress`, not selectable
- previous `done`: `completed`, visibly marked but selectable for reassignment

The server revalidates this. A duplicate open assignment is skipped even if
the browser sends it. Reassignment after completion creates a new assignment
and preserves the old one.

`failed` remains the same open assignment. `Try Again` creates another attempt,
not another assignment.

Backend STAR claims do not block future assignment of the same `set_id`.

### Students

The Students page defaults to a searchable list. Selecting a student shows:

- basic profile and class
- To Do, Failed, and Done counts
- assigned work
- recent attempts
- assign-class, reset-password, enable, and disable actions

The create form is hidden until `Create Student Account` is selected. Assigning
a class updates `class_group`.

## 8. Submission, Grading, and Status

All grading happens in `submitAttempt`, never in trusted browser logic.

The server derives the student from authentication, loads the visible `set`
and private `grading_keys`, grades normalized answers, calculates a percentage,
records every countable attempt, and updates the linked assignment.

The default passing percentage is `50`. A set-specific
`passing_percentage` overrides it. Passing means:

```text
percentage >= passing_percentage
```

Countable submissions become `done` when passed and `failed` below the
threshold. Once an assignment is `done`, a later failed attempt must not move
that same assignment back to `failed`; still store the later attempt.

Every countable attempt is immutable history and includes score, pass state,
answers, per-question results, attempt number, grading version, timing, and
assignment/resource context. Independent Resources work uses
`assignment_id: null`.

The student dashboard labels assignment states `TO DO`, `PASSED`, and
`MASTERED`. Each type is newest assignment first. MASTERED defaults to one week
and supports one month and All.
The backend retains all attempts.

Assignment STAR records are backend records keyed by `assignment_id`. A mastered
assignment must create or repair its protected STAR automatically in backend
code; `claimStar` may remain as an idempotent fallback, but the dashboard count
must not depend on localStorage or a purely frontend action. Once recorded:

- it can never be revoked or downgraded by normal code
- later failing attempts cannot remove it
- later passing-standard changes cannot remove it
- answer-key changes cannot remove it
- only the best attempt reference and best percentage may improve

Independent Library/Explore mastery uses a self-study STAR with
`assignment_id: null`. `getDashboard` may repair missing historical STAR
records from mastered attempts for both assignment and self-study work.

Teacher assignment candidates are not disabled by previous STAR claims.

### Feedback and retry

The current default is `feedback_policy: "always"`. Preserve the design for a
future policy that reveals complete answers only after passing.

`Try Again` clears browser answers, grading marks, and explanations while
preserving prior attempt records in CloudBase.

Historical STAR review returns only the student's submitted answers and a
correct/incorrect flag. It must never return correct answers or explanations.
Full grading feedback is limited to the immediate response after submission.

### Argue

Only a wrong question in a recorded attempt can be disputed. The authenticated
student may include an optional reason. Enforce one record per
`attempt_id + question_id`.

Teachers can also submit Argue requests from `teacher=1` practice preview after
showing answers. Teacher-originated disputes use `requester_role: "teacher"`
and may have `attempt_id: null`; they are for correcting grading rules, not for
student score recovery. Resolving a teacher-originated dispute must not call
attempt regrading logic unless an `attempt_id` is actually present.

Teacher decisions are:

- `keep`: retain the original ruling
- `add`: add the submitted answer to accepted answers
- `replace`: replace the future correct answer with the submitted answer

`add` and `replace` update private CloudBase `grading_keys`, increment
`grading_version`, and append `grading_key_history`. Do not put corrected
answers back into public JSON.

Only the disputed attempt is regraded, and only upward. Never automatically
regrade other students' historical attempts. Future attempts use the new
grading rule. If the adjusted attempt passes, create or improve its protected
STAR.

Teacher-approved CloudBase grading corrections are authoritative. Future
content imports must not blindly overwrite revised `grading_keys`; reconcile
their `grading_version` and `grading_key_history` first.

### Vocabulary

Only Vocabulary `Test Mode` can count:

- 1-4 selected groups: self-test only, not stored in `attempts`
- 5 or more groups: countable and stored
- Practice Mode: not stored

Countable vocabulary attempts retain `selected_group_count`,
`selected_group_ids`, overall score, and per-group `group_results`. Groups are
random, so these details are required history.

## 9. Public and Private Content

Public repository/runtime data may contain passages, transcripts, questions,
choices, IDs, and display metadata.

Private CloudBase `grading_keys` contains correct answers, accepted variants,
explanations/evidence, and scoring rules. Do not add new answers to public
runtime JSON. Do not commit generated private import files.

Run:

```bash
node scripts/prepare-cloudbase-data.js
```

It creates ignored output under `.cloudbase-private/`:

- `import/sets-cloudbase.json`: JSON Lines for `sets`
- `import/grading-keys-cloudbase.json`: private JSON Lines for `grading_keys`
- `import/system-config-cloudbase.json`: JSON Lines for `system_config`
- `public/`: answer-stripped runtime previews

CloudBase console import accepts the `-cloudbase.json` JSON Lines files. Never
commit `.cloudbase-private/`.

## 10. Turning Owner Material Into Website Content

When the owner supplies Markdown, PDFs, raw questions, corrections, or a new
content idea, do not ask them to create JSON or wire links manually.

Default workflow:

1. Identify the family: BBC, IELTS Reading/Listening, Vocabulary, another
   permanent section, or temporary classroom material.
2. Read the matching template in `content/templates/` and existing examples.
3. Choose or preserve a stable ID:
   - BBC: `BBC-YYMMDD`
   - IELTS: `C7-T1-P2` style
   - Vocabulary: `NGSL-A` style
4. Preserve a human-readable source layer when one exists, especially BBC
   Markdown maintained by the owner.
5. Create/update canonical metadata and content under `content/`.
6. Create/update runtime exercise data under `data/` using the shared schema.
7. Keep grading data private in the deployed output.
8. Run the relevant importer and `node scripts/build-home-catalog.js`.
9. Run `node scripts/prepare-cloudbase-data.js` when sets or grading change.
10. Validate IDs, counts, links, grading-key coverage, and interaction.
11. Tell the owner exactly which CloudBase import/deployment is required.

For corrections, update structured content, private grading data, and the
owner-facing Markdown source when one exists. Never fix only visible text while
leaving grading inconsistent.

Temporary classroom HTML may remain independent until it becomes recurring.

### BBC review and import gotchas

For BBC listening lessons where the owner supplies only a transcript, generate
a teacher review draft before touching website data. Keep the review draft in
`/private/tmp` or another non-repository location because it contains answers.
The teacher review draft should show each question with its answer and a
slightly longer evidence quote, using transcript line numbers only, such as
`L23` or `L23-L25`; do not use paragraph labels like `P03-L01`. Do not include
a separate `Why` field in the teacher review version; fold the justification
into the evidence quote.

Only after the owner approves the teacher review draft should the agent create
or update project data. BBC fill-in-the-blank placeholders in `data/BBC-*.json`
must use exactly five underscores:

```text
_____
```

`bbc.html` currently replaces only the first `_____` token with an input. If a
sentence uses `________` or any longer underline, the extra underscores remain
visible after the input field. Always scan new BBC data for `_{6,}` before
committing.

When a blank has multiple accepted answers, store `answer` as an array in the
canonical `data/BBC-*.json`; `submitAttempt` accepts array answers and checks
them with normalized exact matching. This is the correct way to support variants
such as British/American spelling.

### IELTS Reading PDF import gotchas

IELTS Reading content may arrive only as PDFs. The current static reading page
loads runtime data from `data/<set_id>.json`, while homepage/library metadata
lives in `content/ielts-reading/<set_id>.json`. After adding or changing
metadata, run:

```bash
node scripts/build-home-catalog.js
```

Do not hand-edit `data/home-catalog.json` or `data/home-catalog.js`; they are
generated from `content/`.

Before inventing a new IELTS question shape, inspect `ielts-reading.html`.
During the Cambridge IELTS 7 import, the page supported these runtime types:

- `tfng`
- `ynng`
- `mcq`
- `summary`
- `headings`

Some original IELTS formats were represented through existing controls:

- Paragraph matching can be entered as `summary` with A/B/C choices.
- Classification can be entered as `summary` with choice labels.
- Map/route matching can be entered as `summary` with route-letter choices.

This keeps the page reusable, but it also means the data label/instruction must
be clear for students. If the UX needs a new interaction, add it deliberately to
the shared page and update this guide.

PDF extraction has a few recurring traps:

- `pdftotext` may not be installed on the machine. Check available tools before
  assuming it exists.
- Python `pypdf` may be available and can extract many Cambridge PDFs well.
- File names can contain apostrophes, such as `Let's go bats` or `don't fall
  down`; avoid fragile shell quoting when passing those paths.
- Some PDFs have incomplete text layers. In the C7-T2-P3 Makete import, the
  last page extracted only part of the questions. Use OCR or a verified external
  copy for the missing part, and explicitly tell the owner if any question,
  answer, or evidence remains uncertain.
- Validate each new `data/C*.json` and `content/ielts-reading/C*.json` with
  `JSON.parse`, then count expected questions before committing.

Watch for schema drift around answers. Older/static IELTS runtime data may
include `answer` and `evidence` because `ielts-reading.html` grades locally.
New CloudBase-backed counting work should keep grading material private through
`grading_keys` and `prepare-cloudbase-data.js`. Check the current target flow
before adding a new set so public runtime, private grading, and teacher feedback
do not diverge.

### IELTS Listening PDF/audio import gotchas

IELTS Listening uses the shared runtime page `ielts-listening.html`. Do not
create a permanent standalone page for each section or test.

For a new listening set:

- Put homepage/library metadata in `content/ielts-listening/<set_id>.json`.
- Put public runtime question data in `data/<set_id>.json`.
- Put audio under `assets/audio/ielts-listening/` and reference it from the
  runtime JSON.
- Use `{{Q1}}`, `{{Q2}}`, etc. placeholders in public question HTML; the runtime
  replaces them with answer inputs.
- Do not put answers, accepted variants, explanations, or answer-key screenshots
  in public runtime JSON.
- Put private answer material in ignored local source files such as
  `.cloudbase-private/source/ielts-listening/<set_id>.json`; `scripts/prepare-cloudbase-data.js`
  reads these files to create `grading_keys`.

Cambridge Listening materials may arrive as separate question PDFs, tapescript
PDFs, answer-key images, and audio files. `pdftotext` may be unavailable;
Python `pypdf` can often extract the question sheets and tapescripts well enough
for Section 1-style completion tasks. Always validate question IDs, accepted
variants such as British/American spelling, and the generated private grading
key count before importing to CloudBase.

## 11. Cloud Functions and Deployment

Active backend functions:

- `getCurrentStudent`: authenticated profile lookup
- `getDashboard`: assignments and student summary
- `getResources`: visible practice sets
- `submitAttempt`: grading, attempt storage, assignment update
- `teacherAdmin`: teacher-only account, assignment, and data actions

Source lives in `cloudfunctions/<name>/`; deployment ZIPs live in
`deploy-packages/<name>.zip`. Edit source first, test, then rebuild the ZIP.
Never hand-edit a ZIP.

`teacherAdmin` configuration:

- Node.js 18
- 256 MB
- initialization timeout 65 seconds
- execution timeout 10 seconds
- automatic dependency installation
- `INITIAL_STUDENT_PASSWORD` environment variable

Deploy only to the development environment unless the owner explicitly
approves production. Follow `CLOUDBASE_DEPLOYMENT.md`.

## 12. Frontend and Visitor Rules

Student dashboard navigation:

- `Assignments`
- `Explore`
- `Profile`

Assignments has three selectable cards: `TO DO`, `PASSED`, and `MASTERED`. Do
not add separate Failed/Done explanation sections below them.

The hero has no `STUDENT DASHBOARD` label. It shows a varied English greeting
and a randomly selected motivational sentence. Use China Standard Time for
time-aware greetings. Student records keep the owner's simple `Chinese Name +
English Name` format; the UI extracts the final English word for the greeting
and top-right identity chip without adding another database field.

Visitor mode uses the same learning interface but has no assignments, cannot
fill/select answers, cannot submit, and sees a login prompt on interaction.
Entry offers Login and `Continue as Visitor`.

When changing frontend assets, preserve the cache-version pattern in
`assets/js/config.public.js` and HTML query strings so deployed clients do not
retain stale JavaScript.

## 13. Verification Checklist

For backend/data work verify at least:

- no secret or grading-key output is staged
- generated private files remain ignored
- JSON and JSON Lines parse
- `student_id` uniqueness is enforced in both identity layers
- profile fields are top-level
- teacher authorization is server-side
- browser-provided identity does not grant access
- direct database `add(document)` is used
- failed attempts are stored and mark assignments `failed`
- passing retries are stored and move assignments to `done`
- independent practice uses `assignment_id: null`
- vocabulary 1-4 groups are not recorded
- vocabulary 5+ groups are recorded with group details
- catalog links and practice pages load

For substantial frontend changes, run the local site and inspect the affected
page. Do not report cloud deployment complete unless it was deployed and
tested.

## 14. Change Discipline

- Keep changes scoped to the requested feature and existing architecture.
- Do not erase user changes or clean unrelated dirty files.
- Do not introduce automatic merging or destructive migration without an
  explicit owner decision.
- Preserve historical attempts and completed assignments.
- Update this guide when a backend invariant or owner workflow changes.
- End with a concise summary, tests performed, and exact owner action still
  required in CloudBase.

## 15. Session Record — Teacher Argue Enhancement (2026-06-12)

### What was done

**Cloud function (`cloudfunctions/teacherAdmin/index.js`):**
- `listDisputes` now also queries `grading_keys` collection and returns `explanation` (latest from grading_keys) and `explanation_snapshot` (from the raw dispute record, stored at submission time).
- `listDisputes` returns `assignment_id`, `updated_at`, and optional `question_text_snapshot` so frontend grouping and context display are stable.

**Cloud function (`cloudfunctions/getDashboard/index.js`):**
- `submitDispute` accepts optional `question_text` and stores it as `question_text_snapshot` for future dispute records.

**Frontend (`assets/js/teacher.js`):**
- Added `questionTextCache` and `loadQuestionTextForDisputes()` that fetches `data/{set_id}.json`, with `content/vocabulary/{set_id}.json` fallback for Vocabulary.
- Added `getQuestionTextFromData()` — searches `blanks[]`, `multipleChoice[]`, `matching[]`, IELTS-style `questions[].items[]`, matching pairs, and Vocabulary `quizGroups[].questions[]`.
- `renderDisputes()` now groups requests into one task capsule per student assignment/attempt. Teachers click a capsule to see detailed disputed questions.
- Pending groups sort first; fully processed groups sort underneath.
- Detail view displays question text, student answer, correct answer snapshot, explanation, student note, and decision controls.
- All data loading paths include null guards to prevent rendering crashes.

**CSS (`assets/css/app.css`):**
- Added task-capsule and expanded-detail styles for Argue, including `.dispute-question-text` and `.dispute-explanation`.

**Version bumps:**
- `teacher.html`: `app.css?v=20260612-2`, `teacher.js?v=20260612-2`

**Deployment artifact:**
- `deploy-packages/teacherAdmin.zip` rebuilt with latest `index.js` + `package.json`.
- `deploy-packages/getDashboard.zip` rebuilt with latest `index.js` + `package.json`.

### Current state

- Frontend question text lookup was validated locally against BBC, IELTS Reading, and Vocabulary sample data.
- Explanation display requires the updated `teacherAdmin` cloud function deployment.
- Optional future question-text snapshots require the updated `getDashboard` cloud function deployment.
- ZIP files are ready but have NOT been deployed to CloudBase.

### TODO (next agent)

1. Deploy `deploy-packages/teacherAdmin.zip` and `deploy-packages/getDashboard.zip` to the development CloudBase environment.
2. Open owner's browser DevTools on teacher page and check:
   - Console for JS errors
   - Network tab: `data/{set_id}.json` requests (should be 200)
   - Network tab: `teacherAdmin` response (should include `assignment_id`, `explanation_snapshot`, and `explanation`)
   - Argue groups render as collapsed task capsules, expand on click, and move below pending groups after resolution.
3. Consider passing `question_text` from each practice runtime's Argue submission path so new dispute records keep a durable question snapshot.

## 16. Session Record — Assignment Mastery Model (2026-06-12)

### New product rules

- Assignment statuses are now `to_do`, `passed`, and `mastered`.
- Default passing threshold is `50%`; default mastery threshold is `90%`.
- Sets may later override these with `passing_percentage` and `mastery_percentage`.
- Assignments may override both thresholds with `passing_percentage` and
  `mastery_percentage`; `submitAttempt` reads assignment values first, then set
  values, then defaults.
- Students below passing see only `x/y` score feedback and cannot view answers.
- Students who pass may choose to view answers or keep trying.
- Viewing answers records `answer_revealed` on the assignment. If the assignment
  is not already `mastered`, it sets `mastery_locked`, so later scores at or
  above mastery are capped to `mastery_percentage - 0.01` for display/status.
- If an assignment is already `mastered`, viewing answers does not revoke it.
- Mastered assignments create a backend `student_set_achievements` record keyed
  by `assignment_id`; the student dashboard star counter reads this backend
  count.

### Changed files

- `cloudfunctions/submitAttempt/index.js`: grades into `to_do`, `passed`, or
  `mastered`; stores raw/display percentages and mastery lock metadata.
- `cloudfunctions/getDashboard/index.js`: returns normalized assignment
  statuses, supports `revealAnswers`, `claimStar`, and `getAttemptForRetry`.
- `cloudfunctions/teacherAdmin/index.js`: creates `to_do` assignments and
  normalizes teacher candidate/assignment behavior for the new statuses.
- `assets/js/dashboard.js`: shows `TO DO`, `PASSED`, and `MASTERED`, compact
  assignment pills, backend `Get Star` / `Star collected`, and the star counter.
- `bbc.html`, `ielts-reading.html`, `vocabulary.html`: answer reveal
  confirmation, backend reveal locking, retry choices, draft preservation, and
  historical-answer prefill where practical.
- `scripts/prepare-cloudbase-data.js`: adds default `mastery_percentage: 90`.

### Deployment required

Deploy these updated function ZIPs to CloudBase development:

- `deploy-packages/submitAttempt.zip`
- `deploy-packages/getDashboard.zip`
- `deploy-packages/teacherAdmin.zip`

Then deploy/push the static site so `dashboard.html`, `assets/js/dashboard.js`,
`assets/css/app.css`, and the practice pages are current.

## 17. Session Record — Teacher Library, Thresholds, Stars, Curriculum (2026-06-12)

### New product rules

- Teacher UI uses the orange/orange-pink theme and no longer has the placeholder
  `Data` tab.
- Teacher `Library` opens existing practice pages in `teacher=1` mode. Teacher
  answer reveal calls `teacherAdmin.getAnswerKeyForSet`; it does not call
  student reveal logic and does not lock mastery.
- Teachers can assign by a single set, or by filtered column/keyword batch.
  Each assignment can store `passing_percentage` and `mastery_percentage`;
  blank values fall back to set/default `50/90`.
- Student assignment stars are backend records in `student_set_achievements`
  keyed by `assignment_id`; mastered assignments create or repair this record
  automatically, and `claimStar` is only a safe fallback.
- Student profiles may include `curriculum_track` for DSE, A-Level, AP, IB,
  Zhongkao, or Gaokao.
- `changePassword` now changes the authenticated end user's CloudBase password
  and clears `must_change_password`.

### Deployment required

Deploy these updated function ZIPs to CloudBase development:

- `deploy-packages/teacherAdmin.zip`
- `deploy-packages/getDashboard.zip`
- `deploy-packages/submitAttempt.zip`
- `deploy-packages/getCurrentStudent.zip`
- `deploy-packages/changePassword.zip`

Then push/deploy the static site so `teacher.html`, `dashboard.html`,
`assets/js/teacher.js`, `assets/js/dashboard.js`, `assets/css/app.css`, and the
practice pages are current.

## 18. Session Record — BBC June/July Import Lessons Learned (2026-06-13)

### What was added

Five BBC listening sets were generated from owner transcript Markdown, reviewed
by the teacher, converted into website data, and pushed to GitHub Pages:

- `BBC-250619` — How Do Babies Communicate?
- `BBC-250626` — Are Plant-Based Substitutes Healthier Than Meat?
- `BBC-250703` — How Do You Say Sorry?
- `BBC-250710` — Do You Need To Declutter Your Home?
- `BBC-250717` — How Can We Help Wild Bees?

### Problems encountered and confirmed fixes

- Teacher review drafts should be teacher-facing, not student-facing. Show
  `Prompt`/`Question`, options, `Answer`, longer `Evidence` quotes, and `Skill`
  together for each question so the owner can judge quality without jumping
  between an exercise and an answer key.
- Evidence references should be transcript line numbers only (`L23-L25`). The
  earlier `PXX-LXX` format was unnecessary for Markdown transcripts and made
  review harder.
- CloudBase console imports require the `-cloudbase.json` JSON Lines files:
  one JSON document per line. Array-form backup files such as
  `grading_keys.json` or an ad hoc JSON array can appear to upload but may not
  create usable records. For partial imports, generate a partial JSON Lines
  file from the `-cloudbase.json` source.
- The CloudBase import modal may say it supports JSON and CSV. For
  `grading_keys`, use JSON because `answers` and `explanations` are nested
  objects/arrays; CSV cannot preserve them.
- A CloudBase warning like `5 records succeeded, 0 failed` followed by
  `failed to clean tmp file` means the database import succeeded. The temporary
  uploaded file can be deleted later from file management; it does not block
  grading.
- `GRADING_KEY_NOT_FOUND` during submission means the `grading_keys` collection
  lacks a document with the submitted `set_id`. The static page may load
  perfectly while grading still fails. Fix by importing the corresponding
  `grading_keys` JSON Lines records and then searching `grading_keys` for the
  exact `set_id`.
- Student Library/Explore uses the `getResources` cloud function first.
  `getResources` reads the CloudBase `sets` collection. If the static catalog
  contains a new lesson but the student Library does not show it, check whether
  `sets` has the matching `set_id`. Direct lesson URLs can work while Library
  is missing the item.
- New BBC lessons therefore require both imports: `sets` for Library visibility
  and `grading_keys` for grading. Verify both collections by searching for at
  least one new `set_id`, for example `BBC-250619`.
- GitHub Pages and browser caches may briefly serve stale JSON after a push.
  Verify the raw GitHub file on `main` if needed, and use a cache-busting query
  such as `?v=<commit>` when checking the deployed page.
- Large audio pushes can fail once with a network error such as `Empty reply
  from server`. Retry `git push origin main` with network access if the commit
  is local and the first push failed.
- Fill-in-the-blank sentences initially used eight underscores. Because
  `bbc.html` replaces exactly `_____`, the extra underscores appeared after
  each input field. The data was fixed by replacing all `_{6,}` placeholders in
  the five new BBC JSON files with exactly `_____`.

### Verification checklist for future BBC imports

1. Review draft approved by owner before repository edits.
2. `data/BBC-*.json` has 10 blanks and 10 MC questions, unless the owner
   explicitly approved a different count.
3. No `_{6,}` placeholder remains in new BBC data.
4. Matching `content/bbc-six-minute-english/BBC-*.json` metadata exists and is
   `visible: true`.
5. Audio file exists at the `audioSrc` path.
6. `node scripts/build-home-catalog.js` has been run.
7. `node scripts/prepare-cloudbase-data.js` has been run.
8. Public preview under `.cloudbase-private/public` has no `answer`,
   `answers`, `evidence`, `explanation`, or `correctAnswer` fields.
9. CloudBase `sets` contains the new `set_id`.
10. CloudBase `grading_keys` contains the new `set_id`.
11. Student Library shows the lesson.
12. A logged-in student can submit and receive grading feedback.

## 19. Cross-Session Maintenance Notes (2026-06-13)

These are small but important lessons from the assignment/teacher/star work.
Keep them in mind before changing the same surfaces again.

### Git and parallel windows

- The owner may run multiple Codex windows against the same working tree. Before
  staging, always check `git status --short --branch` and stage only files that
  belong to the current request.
- Do not assume unrelated modified or untracked files are yours. In particular,
  BBC import sessions may leave `data/home-catalog.*`, `content/bbc-*`,
  `data/BBC-*`, and `bbc-audio/*` changes in the same repo.
- If the current branch is ahead by multiple commits, inspect
  `git log --oneline origin/main..HEAD` before pushing. Do not push unrelated
  commits if the owner says another window will handle them.
- GitHub HTTPS pushes sometimes fail with `Empty reply from server` or DNS
  errors. If the commit is local and checks passed, retry later; do not rewrite
  history to "fix" a network failure.

### Dashboard drafts versus history

- Draft answers and history answers are different concepts.
- Drafts are frontend/localStorage state and should preserve what the student
  has typed even if they have not submitted. Re-entering a page should prefer
  draft answers over backend history.
- History means submitted attempts stored in CloudBase. `Show History` should
  restore the best submitted attempt only; if scores tie, use the newest
  matching best attempt.
- `Show History` intentionally overwrites the current draft after confirmation.
  Clear the visible answers first, then apply the historical answers, so old
  draft values and historical answers cannot mix.
- Do not unconditionally point `Show History` at the most recent submission. A
  lower-scoring later attempt must not replace the best history target.

### Answer reveal and teacher mode

- Student answer reveal goes through `getDashboard.revealAnswers`. For
  non-mastered assignments it sets `answer_revealed` and `mastery_locked`.
- If the assignment is already `mastered`, answer reveal must not revoke mastery
  or show the "cannot master" warning.
- Teacher answer reveal is separate. Practice pages opened with `teacher=1`
  should call `teacherAdmin.getAnswerKeyForSet`, show answers/explanations, and
  never call student reveal logic.
- Teacher Library should reuse existing practice pages instead of creating
  duplicate teacher-only exercise pages.

### Assignment thresholds and stars

- Effective thresholds resolve in this order: assignment override, set value,
  default `50/90`.
- When adding assignment creation paths, include `passing_percentage` and
  `mastery_percentage` on the assignment record.
- Assignment STARs are backend-backed now. Count `student_set_achievements`;
  do not reintroduce localStorage as the source of truth. `submitAttempt` and
  `getDashboard` must create or repair assignment STAR records for mastered
  assignments, and `getDashboard` also repairs missing self-study STAR records
  from mastered resource attempts. `getDashboard.claimStar` is only a
  compatibility fallback.
- Star claims are keyed by `assignment_id` and should not block assigning the
  same `set_id` again later.

### Deployment reminders

- Frontend-only changes still need cache-version bumps in the relevant HTML
  query strings.
- Any change to `teacherAdmin`, `getDashboard`, `submitAttempt`,
  `getCurrentStudent`, or `changePassword` source must be followed by rebuilding
  the matching `deploy-packages/*.zip`.
- `changePassword` is a real CloudBase function now. If it is missing in the
  console, create it with Node.js 18, upload `deploy-packages/changePassword.zip`,
  enable automatic dependency installation, and no extra environment variable is
  required.

## 20. Session Record — Vocabulary Maintenance Notes (2026-06-13)

These notes capture pitfalls from the NGSL vocabulary UI/data work. Future
agents should read this before changing `vocabulary.html`,
`content/vocabulary/*`, `data/home-catalog.*`, or vocabulary import scripts.

### Local loading and catalog fallbacks

- `vocabulary.html` fetches `content/vocabulary/<unit>.json`. Opening the page
  directly with `file://` can show `Failed to fetch`, so vocabulary units also
  need a script fallback at `content/vocabulary/<unit>.js` that registers data
  on `window.__VOCABULARY_UNITS__`.
- `data/home-catalog.json` also has a script fallback,
  `data/home-catalog.js`, exposed as `window.__HOME_CATALOG__`. Keep the JSON
  and JS versions in sync when changing catalog data.
- The homepage catalog has historically carried richer hand-maintained
  structure than `content/sections.json`. Do not blindly run
  `node scripts/build-home-catalog.js` if it would wipe current homepage
  groupings, paths, or section IDs. Compare the output first.
- `scripts/import-vocabulary-unit.js` and `scripts/import-ngsl-bc.js` are the
  current references for generating vocabulary JSON plus JS fallback files.

### Vocabulary schema and NGSL imports

- Use `content/vocabulary/NGSL-A.json` as the vocabulary unit template.
  Important fields include `id`, `sectionId`, `title`, `href`, `sortOrder`,
  `sourceName`, `cefrLevel`, `wordCount`, `words`, and `quizGroups`.
- Each `words[]` item should include `number`, `word`, `emoji`, `meaning`,
  `partOfSpeech`, and `simpleDefinition`.
- `simpleDefinition` must be a short English definition. Do not map word forms
  or inflection notes into this field.
- The NGSL-B and NGSL-C source Markdown files use a different table shape from
  NGSL-A, and their final column is word-form information, not a definition.
  If definitions are uncertain, stop and ask instead of inventing or copying
  the wrong column.
- When a quiz answer uses a changed form of the base word, the student-facing
  Word Bank should show the answer form, such as `warned`, `excited`,
  `Apparently`, or `flowers`. The separate Words list should still show the
  base vocabulary word.

### Vocabulary UI rules

- The four mode labels should stay short and parallel; `Word List` was renamed
  to `Words`.
- Learn mode uses a low-emphasis header with a `Study Set 1` capsule and small
  grey text such as `Words 1001-1010`. Test mode uses `Test Set 1` with a
  visually distinct capsule.
- The Word Bank is merged into the set header. Do not reintroduce a separate
  literal `Word Bank` label or a vertical one-word-per-line layout.
- Word Bank chips must flex from left to right, fill each row naturally, and
  wrap only when the row is full. This must work on mobile and desktop.
- The `-` and `+` font controls live in the top-right of the set header. They
  adjust both question text and Word Bank chips through the shared practice
  font-size variable, and should not steal layout width from the chips on
  mobile.
- The inline answer control is a short underline button only. Do not show
  `Choose`, and do not use a long blank line.
- Candidate selection is a custom popup, not a native select. It should open
  above or below the full question card so it does not cover wrapped sentence
  text on mobile. Each popup includes `Clear`.
- Within the same Learn/Test set, once a word is selected in one question, hide
  it from other questions until it is cleared. This is intentional.
- Test mode should not reveal original question numbers or `Words X-Y` ranges,
  because students can use those to find answers in Learn mode.
- In Test mode, the timer appears at the top-left after the test starts, away
  from the top-right identity/status area. Time-up feedback includes a short
  Web Audio beep, not an external audio asset.
- Dictate mode should not show Chinese definitions. Its setup row uses a simple
  `Start` button aligned to the right on desktop, and should not include the
  old explanatory sentence beginning with "Choose a range".

### Verification and push pitfalls

- Fast checks are often enough for small static changes: parse changed JSON,
  execute fallback JS in a VM-like `window` object, and syntax-check inline
  scripts in `vocabulary.html`.
- A local Python static server can be useful for browser inspection, but it has
  caused slow or interrupted sessions. Stop any server you start. If a server
  PID cannot be killed inside the sandbox, request escalation for that specific
  PID only.
- GitHub pushes have failed before with network errors such as
  `Failed to connect to github.com port 443` or `Empty reply from server`.
  Retry with network escalation when appropriate, and never tell the owner a
  push succeeded unless the command output confirms the remote update.
- Before committing or pushing, check `git status --short --branch`. This repo
  is often edited from multiple Codex windows, so stage only files that belong
  to the current request.

## 21. Known Pitfalls And Fast Diagnosis (2026-06-13)

Use this section when a future agent sees behavior that "should already be
fixed." Most past breakages were caused by deployment order, stale CloudBase
function code, or data shape drift rather than complex frontend bugs.

### CloudBase function code can be stale

- If the browser shows an error for code that is already fixed locally, first
  check whether the CloudBase console is still running an old uploaded function.
  Example: `Unable to complete this teacher action (studentUid is not defined)`
  was caused by an old `teacherAdmin` deployment even though the repository and
  ZIP already used `student.auth_uid`.
- After editing a cloud function, always rebuild the matching ZIP and inspect
  the ZIP contents if the bug looks impossible:

```bash
unzip -p deploy-packages/teacherAdmin.zip index.js | rg "student_uid"
```

- Deploying source changes to GitHub does not deploy CloudBase functions.
  Function ZIP upload and static site deployment are separate steps.

### Create collections before deploying code that reads them

- New backend features that read new collections must be deployed in this
  order: create CloudBase collections first, deploy functions second, deploy
  static frontend last.
- If static frontend is pushed before required collections exist, the page can
  fail even though the JavaScript is correct.
- Current extra collections beyond the original six include
  `student_set_achievements`, `answer_disputes`, and `grading_key_history`.
  Check the latest product rules before assuming whether STAR records are keyed
  by `set_id` or `assignment_id`; this has changed during design.

### Direct database adds only

- With `@cloudbase/node-sdk`, add documents directly:

```js
await db.collection("students").add(student);
```

- Do not use `add({ data: student })`. That nests the document under `data` and
  causes `Profile incomplete`, missing student rows, broken auth/profile
  linking, and assignment records that look present but are not queryable by
  the expected fields.
- If CloudBase console shows documents wrapped like `{ "data": { ... } }`,
  treat them as malformed and fix the write path before adding more records.

### Authentication and profile linking

- CloudBase Authentication users and `students` documents are two separate
  records. A user visible in Authentication is not enough to log into the app
  unless `students.auth_uid` matches the CloudBase user ID.
- Teacher-created users must use `@cloudbase/manager-node` end-user APIs
  (`createEndUser`, `modifyEndUser`, `setEndUserStatus`). Using the wrong user
  API can create console-visible accounts that cannot sign in through the web
  username/password flow.
- Student Login ID uniqueness must be checked in both Authentication usernames
  and `students.student_id`. Names may repeat; Login IDs may not.

### CloudBase imports

- CloudBase import for nested data such as `grading_keys` must use JSON Lines:
  one JSON object per line. Use the generated `*-cloudbase.json` files, not
  array-form backups.
- CSV is not suitable for `grading_keys` because `answers` and `explanations`
  are nested objects/arrays.
- A submission error `GRADING_KEY_NOT_FOUND` usually means the static lesson is
  present but the matching `grading_keys.set_id` was not imported.
- A lesson can open directly while still missing from student Explore/Library
  if the matching `sets` record was not imported.

### Frontend cache and versioning

- After changing shared assets, bump both `assets/js/config.public.js`
  `appVersion` and the query strings in affected HTML files.
- Practice pages may import shared scripts without cache-busting unless updated.
  Add explicit `?v=...` query strings to `config.public.js`,
  `cloudbase-client.js`, and `practice-session.js` when changing those files.
- GitHub Pages and browser caches may briefly serve stale JSON/JS. When testing,
  use a cache-busting query or check the raw GitHub file on `main`.

### Argue and answer history

- Historical review endpoints must not return `correct_answer` or
  `explanation`. Those belong only to the immediate post-submit feedback or to
  teacher-authorized views.
- Teacher Argue decisions that add or replace answers must update private
  CloudBase `grading_keys` and append `grading_key_history`; do not write
  corrected answers back into public runtime JSON.
- Do not automatically regrade all old attempts after an Argue approval unless
  the owner explicitly asks for a separate manual correction workflow.

### STAR and assignment semantics can evolve

- The product has changed several times around STAR behavior. Before changing
  `student_set_achievements`, read the current implementation in
  `getDashboard`, `submitAttempt`, and `teacherAdmin`, not only older notes.
- Never reintroduce localStorage as the source of truth for STAR/completion.
  Backend records are authoritative.
- Whatever the current key is, completion records are monotonic: normal
  application code may create or improve them, but must not silently revoke or
  downgrade them.

### Browser and local testing notes

- If in-app browser automation refuses a local URL because of a browser policy,
  do not try to bypass it with another browser surface. Fall back to static
  checks, syntax checks, and user-guided browser verification.
- Local HTTP server checks are useful for static layout, but they do not prove
  CloudBase functions are deployed or configured correctly.

### Git hygiene in this repo

- `.DS_Store` frequently appears modified; do not stage it.
- `deploy-packages/` is ignored. Rebuilding ZIPs is still required for
  deployment, but ZIP changes will not normally appear in Git status.
- Multiple Codex sessions may leave unrelated dirty files. Stage explicit paths
  only, and do not push if it would also publish unrelated commits from another
  active task unless the owner asked for that.

## 22. UI Runtime Maintenance Notes (2026-06-13)

These notes summarize recent frontend decisions and mistakes that were already
worked through in conversation. Future agents should preserve these unless the
owner explicitly asks for a different behavior.

### General workflow

- The owner often has several agent windows editing the same repo. Treat a dirty
  worktree as normal. Check `git status --short` before editing, and stage only
  the files for the current request.
- Do not "clean up" unrelated modified files. They may belong to another
  session or to the owner.
- This project is mostly static HTML/JSON for the current learning pages. For
  quick safety checks, extract inline `<script>` blocks and run `new Function`
  with Node, and validate JSON with `JSON.parse`.
- The in-app browser may not always be available in Codex. If browser
  verification is blocked, do not invent a workaround; run static checks and
  report the limitation.

### Home page catalog and layout

- Keep `data/home-catalog.json` and `data/home-catalog.js` synchronized. The
  JSON path is preferred, but the JS file is the fallback catalog used when
  fetch fails.
- Current home hierarchy is: exam/path card -> small section entry tile ->
  expanded content cards. Do not put every lesson directly under the exam card
  by default; it makes the home page visually crowded.
- `General` should default open, but its children should first appear as small
  tiles. Current General tile labels are `BBC`, `vocab`, `grammar`, and
  `writing`.
- Other paths such as IELTS, DSE, MSE, 中考英语, and 高考英语 should reveal their
  section tiles only after the path card opens.
- Section headers can become sticky after a section is expanded so the user can
  reach `Hide` without scrolling back a long distance.
- The top brand is `Mr. Cat Academy` / 猫先生英语. Do not revert it to older
  names such as Leo's English Hub.
- Home card metadata should stay compact. BBC and IELTS Reading cards should
  not show redundant notes such as `Listening Practice` or `Passage Practice`.
  Dates/codes and tags should stay on the same compact metadata row where
  possible.
- The global search box searches visible catalog items by id, title, date/code,
  topic, note, and tags. Preserve login/user parameter handling for links shown
  in search results.

### Practice identity and login

- Practice pages should display the current identity even when the user is a
  visitor or not logged in. The home page has its own login status.
- If a device already has a saved identity, login prompts should offer a simple
  "continue as existing user" path. Keep `or continue as visitor` available.
- Avoid adding extra login explanatory copy. The owner prefers a clean login
  surface: student ID input, login button, saved identity button when present,
  and visitor option.

### BBC listening runtime

- `bbc.html` should use one custom player, not two. The hero card should not
  contain a second audio player.
- The player should stick at the top while the student scrolls. The student
  name belongs inside the time row between current time and duration, using the
  same small visual weight as the times.
- Do not restore the old fixed identity pill above the player; it caused visual
  conflicts with the progress bar.
- The progress bar is display-only. Students should not be able to drag or seek
  freely.
- Each playback session has at most seven `-5s` rewinds. Pausing does not reset
  the allowance. Replaying after the audio ends may reset for the new session.
- Do not reintroduce the native browser audio control. It looked unfinished and
  did not support the rewind-limit rule.
- If the student exits or refreshes BBC listening to get another listen, answers
  should not be restored automatically. The owner accepts that the student must
  rewrite answers.
- Missing-answer submission should use an in-page modal, not `alert()`. Native
  alerts can show browser UI such as "suppress dialogs", which the owner does
  not want students to see.
- BBC text-size controls belong on the same row as `Part 1: Fill in the Blanks`
  so the card does not start with empty vertical space.

### IELTS Reading runtime

- Reading text should use as much page width as practical after entering a set.
  Avoid narrow boxed layouts that waste horizontal space.
- Do not add a redundant top `Questions` box when each question range already
  labels itself.
- Highlighting should work for both passage text and question text.
- Keep the student identity visible on practice pages, following the shared
  identity rules above.

### Vocabulary runtime

- The vocabulary hero should stay minimal. It only needs the two stat boxes
  `Word Source` and `CEFR Level`. For NGSL-A, `Word Source` should display
  `NGSL-A`, not only `NGSL`.
- Mode labels are intentionally short: `Word List`, `Learn`, `Dictate`, and
  `Test`. Avoid explanatory paragraphs inside each mode unless the owner asks
  for them.
- Learn mode should not show a second answer line under each sentence. The
  blank inside the sentence is the answer control.
- Learn mode answers are selected from a dropdown at the sentence blank. This
  is faster for students than typing.
- Dictate mode is based on the word list, not the quiz group sentences. It
  shows English definition first and Chinese meaning on the right so students
  prioritize the English definition.
- Dictate mode should let students choose a word-number range, then show only
  one start action: `Shuffle and Start`. The selected words should be shuffled
  after start.
- Dictate spelling needs visible per-letter short underlines so students know
  how many letters the answer has. Avoid a design that looks like a plain box
  with a separate guide underneath.
- Dictate columns should stay compact. Current intent is `Spell`, `Definition`,
  and `中文`; avoid long headers such as `Simple Definition` if they make the
  table feel cramped.
- Test mode groups are fixed by ranges such as 1001-1010, 1011-1020, but test
  display should not reveal the original group/order labels to students. Use
  generic labels such as 测试组 1.
- Test mode gives two minutes per selected group and should randomize selected
  groups and question order within each group.

## 23. Session Record — Fast Reorientation Notes (2026-06-13)

These notes come from a quick project-structure reread. They are intentionally
short so future agents can avoid repeating the same first-pass mistakes.

### Where to start

- The canonical agent memory is the root `AGENTS.md`. Do not assume there is a
  `.agents/` or `.codex/` project guide directory; those paths may be mentioned
  by the runtime permissions but are not the project documentation.
- Read `AGENTS.md` before `README.md`. The README explains the teaching intent
  in friendlier language, while `AGENTS.md` contains the current backend,
  CloudBase, grading, assignment, and deployment invariants.
- This is no longer only a few static HTML pages. Treat it as a static frontend
  plus CloudBase backend project with shared assets, generated catalogs,
  content source files, public runtime data, and deployable cloud functions.

### Current structure snapshot

- Main shell/pages: `index.html`, `library.html`, `dashboard.html`,
  `teacher.html`, `attempt-review.html`.
- Practice runtimes: `bbc.html`, `ielts-reading.html`, `vocabulary.html`.
- Shared frontend code: `assets/js/` and `assets/css/app.css`.
- Source content: `content/bbc-six-minute-english/`,
  `content/ielts-reading/`, `content/vocabulary/`, and
  `content/templates/`.
- Browser runtime data: `data/*.json`, `data/home-catalog.json`, and
  `data/home-catalog.js`.
- Backend source: `cloudfunctions/<function>/`; generated deployment ZIPs live
  in `deploy-packages/` when present.
- Scripts such as `scripts/build-home-catalog.js`,
  `scripts/prepare-cloudbase-data.js`, and import scripts are part of the
  content pipeline, not optional cleanup utilities.

### Easy traps

- A direct lesson URL can work even when Library/Explore is broken or stale.
  Library uses `data/home-catalog.*` on the frontend and `getResources` /
  CloudBase `sets` for authenticated resources, so check both catalog generation
  and CloudBase import state.
- Grading can fail while public content renders correctly. If a practice page
  loads but submission fails, check private CloudBase `grading_keys` for the
  exact `set_id` before changing the page.
- Public `data/*.json` may still contain legacy answers/evidence for older
  standalone flows, but the long-term rule is to keep grading keys private in
  CloudBase. Do not add new public answer keys casually.
- Many pages still use `localStorage` for identity, drafts, layout, highlights,
  or visitor mode. Do not confuse those client conveniences with authenticated
  CloudBase identity or countable attempt history.
- The repo may be dirty because several agent windows or classroom import
  sessions touch the same tree. Always inspect `git status --short` and change
  only files relevant to the current request.
- If an early file scan shows only a tiny static-site subset, rescan with
  `rg --files` from the repository root before drawing conclusions; the active
  project now includes `assets/`, `content/`, `scripts/`, `cloudfunctions/`,
  and multiple permanent pages.
