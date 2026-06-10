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

The separate `teacher.html` interface has three capsules:

- `Assign`
- `Students`
- `Data`

`Data` is currently a light placeholder for future question-level analysis.

### Assign

The teacher can choose a visible set, search students, filter by
`class_group`, select one or multiple students, assign to a filtered class,
and optionally set a due date.

For the same student and `set_id`:

- no previous assignment: `available`, selectable
- existing `not_done` or `failed`: `in_progress`, not selectable
- previous `done`: `completed`, visibly marked but selectable for reassignment

The server revalidates this. A duplicate open assignment is skipped even if
the browser sends it. Reassignment after completion creates a new assignment
and preserves the old one.

`failed` remains the same open assignment. `Try Again` creates another attempt,
not another assignment.

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

The student dashboard shows Done work for one week by default and supports two
weeks, one month, and View All. The backend retains all attempts.

### Feedback and retry

The current default is `feedback_policy: "always"`. Preserve the design for a
future policy that reveals complete answers only after passing.

`Try Again` clears browser answers, grading marks, and explanations while
preserving prior attempt records in CloudBase.

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
- `Resources`
- `Me`

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
