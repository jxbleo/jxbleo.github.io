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

STAR claims are backend records keyed by `assignment_id`. Once claimed:

- it can never be revoked or downgraded by normal code
- later failing attempts cannot remove it
- later passing-standard changes cannot remove it
- answer-key changes cannot remove it
- only the best attempt reference and best percentage may improve

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
- `Get Star` records a backend `student_set_achievements` claim keyed by
  `assignment_id`; the student dashboard star counter reads this backend count.

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
- Student stars are backend records in `student_set_achievements` keyed by
  `assignment_id`; the dashboard star counter updates after `claimStar`.
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
