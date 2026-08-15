# 10 Deployment

> This document explains how to deploy the static site, CloudBase functions,
> and CloudBase data. Update it when environment settings, function packaging,
> deployment order, or manual verification steps change.

## 1. Scope

These instructions are for the development CloudBase environment:

```text
mrcat-dev-d9gwy2v1icdfdf597
region: ap-shanghai
timezone: Asia/Shanghai
```

Do not deploy to production, billing, DNS, domains, or account-level settings
without explicit owner approval.

## 2. Deployment Has Three Tracks

| Track | What changes | Typical owner action |
| --- | --- | --- |
| Static site | HTML, CSS, JS, public data, audio | push/publish static files |
| Cloud functions | trusted backend logic | upload rebuilt ZIP in CloudBase console |
| CloudBase data | `sets`, `grading_keys`, `system_config`, report collections/indexes | import JSON Lines files or create collections/indexes in console |

A feature may require one, two, or all three tracks. Always state which tracks
are still required.

Teacher attempt-response slimming requires both the rebuilt `teacherAdmin`
function ZIP and the matching static `teacher.html` / `assets/js/teacher.js`.
Deploy them from the same commit. Publish the backward-compatible static files
first, then update `teacherAdmin`, so a new browser never requests
`getAttemptDetail` from an older function version. No database migration is
required.

Student Dashboard staged startup requires the rebuilt `getDashboard` function
ZIP plus `dashboard.html`, `assets/js/dashboard.js`, `assets/js/auth.js`, and
their cache-version updates. The new browser remains backward-compatible with
an older function because an unrecognized `dashboardBootstrap` action falls
back to the complete Dashboard response, but the latency improvement begins
only after the new function is deployed. No database migration or permission
change is required.

## 3. CloudBase Collections

All project collections should remain `ADMINONLY`:

- `students`
- `sets`
- `assignments`
- `attempts`
- `grading_keys`
- `system_config`
- `student_set_achievements`
- `star_reward_ledger`
- `star_redemption_requests`
- `star_redemption_evidence`
- `answer_disputes`
- `grading_key_history`
- `student_vocabulary_items`
- `vocabulary_lexicon`
- `vocabulary_lexicon_history`
- `vocabulary_dictionary_reports`
- `vocabulary_test_sessions`
- `classes`
- `class_memberships`
- `learning_reports`
- `teacher_attempt_email_events`

Recommended unique indexes where supported:

- `student_set_achievements.achievement_id`
- `answer_disputes.dispute_id`
- `grading_key_history.history_id`
- `student_vocabulary_items.vocab_id`
- `student_vocabulary_items.student_uid + normalized_text`
- `vocabulary_lexicon.lexicon_id`
- `vocabulary_lexicon.normalized_word`
- `vocabulary_test_sessions.test_session_id`
- `star_reward_ledger.ledger_id`
- `star_redemption_requests.request_id`
- `star_redemption_evidence.evidence_id`
- `classes.class_id`
- `classes.normalized_name`
- `class_memberships.membership_id`
- `learning_reports.report_id`
- logical unique report identity: `learning_reports.class_id + period_type + period_key`
- `teacher_attempt_email_events.event_id`

Recommended query index:

- `student_vocabulary_items.student_uid + status + updated_at`
- `vocabulary_lexicon_history.normalized_word + changed_at`
- `vocabulary_dictionary_reports.status + updated_at`
- `vocabulary_dictionary_reports.normalized_word + status`
- `vocabulary_test_sessions.student_uid + status`
- `star_reward_ledger.student_uid + created_at`
- `star_redemption_requests.student_uid + status + created_at`
- `star_redemption_requests.status + created_at`
- `star_redemption_evidence.request_id + status + created_at`
- `class_memberships.student_uid + ended_at`
- `class_memberships.class_id + ended_at`
- `learning_reports.class_id + period_type + period_key`
- `learning_reports.status + published_at`
- `assignments.class_id + due_at`
- `assignments.class_task_id`
- `assignments.assignment_batch_id`
- `attempts.student_uid + submitted_at`
- `attempts.assignment_id + submitted_at`
- `teacher_attempt_email_events.status + due_at`
- `teacher_attempt_email_events.thread_key + status + submitted_at`
- `teacher_attempt_email_events.status + processing_started_at`

Create required collections before deploying functions that depend on them.

Prepare the built-in curated lexicon with the normal content command. To merge
the 30,000 highest-frequency ECDICT-only records without committing the source
CSV, provide a local path or HTTPS URL:

```bash
ECDICT_SOURCE=/path/to/ecdict.csv node scripts/prepare-cloudbase-data.js
# or ECDICT_SOURCE=https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
```

Dry-run and owner-import the shared lexicon separately:

```bash
npm run cloudbase:import:content -- --only vocabulary_lexicon
npm run cloudbase:import:content -- --apply --only vocabulary_lexicon
```

## 4. Static Site Deployment

The production static frontend is built from `main` and uploaded to Tencent
COS by `.github/workflows/deploy-cos.yml`. The workflow runs
`npm run build:static`, verifies the public-only `dist/` boundary, and then runs
`scripts/deploy-static-to-cos.js`. COS object keys never begin with `/`, so the
bucket website's default `index.html` remains reachable at the domain root.
Before upload, the script lists existing COS objects. Small objects use their
ETag/local MD5 for comparison; files handled by multipart upload use byte size
because the COS multipart ETag returned by object listing is not a portable
local content checksum. Unchanged files are skipped, changed files are
uploaded, and obsolete public objects are removed only after all uploads
succeed. This keeps later GitHub-to-Shanghai deployments incremental rather
than retransmitting the complete audio library.
Uploads use bounded concurrency and retry transient COS/network failures per
file. A failed or cancelled first publication can therefore resume safely on
the next `main` run without retransmitting completed objects. Files of at least
5 MB use 1 MB multipart chunks so audio uploads from GitHub's overseas runner
do not depend on one long-lived connection to Shanghai COS.

The repository must define these GitHub Actions secrets:

- `TENCENT_CLOUD_SECRET_ID`
- `TENCENT_CLOUD_SECRET_KEY`

They belong to a programming-access-only CAM sub-user with the minimum required
permissions for this one bucket: `GetBucket`, `PutObject`, and `DeleteObject`.
Multipart audio upload additionally requires `InitiateMultipartUpload`,
`UploadPart`, `ListParts`, `CompleteMultipartUpload`, and
`AbortMultipartUpload` for the same bucket only. Do not grant console login or
account-wide administrator access to this deployment identity.
The deployment script logs only COS error codes, HTTP status, and request IDs;
it must never print either credential.

Static changes include:

- `*.html`
- `assets/css/*.css`
- `assets/js/*.js`
- `data/*.json`
- `data/*.js`
- `content/**/*.json`
- audio/image assets

When changing shared JS or CSS, preserve the cache-version pattern in HTML query
strings, for example:

```html
<script src="assets/js/teacher.js?v=YYYYMMDD-N"></script>
```

For local verification:

```bash
python3 -m http.server 8000
```

Then test through `http://127.0.0.1:8000/`.

## 5. Cloud Function Deployment

Function source lives in:

```text
cloudfunctions/<function-name>/
```

Deployment ZIPs live in:

```text
deploy-packages/<function-name>.zip
```

Edit source first, validate, then rebuild the ZIP. Never hand-edit a ZIP.

Active or relevant functions:

- `getCurrentStudent`
- `getResources`
- `getDashboard`
- `submitAttempt`
- `teacherAdmin`
- `studentVocabulary`
- `changePassword`
- `getProtectedResource`
- `learningReports`
- `generateLearningReports`
- `sendTeacherAttemptEmails`

Common validation:

```bash
find cloudfunctions -name index.js -exec node --check {} \;
```

Function runtime expectation:

- Node.js 18
- deployment ZIPs are bundled with the runtime code they use;
- bundled code is minified so direct ZIP uploads remain below CloudBase's
  expanded-file limit and do not depend on slower COS uploads;
- CloudBase automatic dependency installation is not required and should stay
  disabled for bundled functions;
- root and function-level lockfiles pin the SDK and bundler versions, so a
  package rebuild cannot silently pick a newer dependency tree.
- development environment unless owner approves otherwise
- `getDashboard` execution timeout must be at least 10 seconds; 15 seconds is
  recommended. The batched implementation should normally finish well below
  that limit, while the higher ceiling protects cold starts and large histories.

`teacherAdmin` additionally requires the environment variable:

```text
INITIAL_STUDENT_PASSWORD=<configured in CloudBase only>
```

Never write this value into Git, frontend code, docs, screenshots, or command
logs.

The optional AI dictionary fallback requires all three variables on both
`studentVocabulary` and `teacherAdmin`:

```text
VOCAB_AI_API_URL=<HTTPS OpenAI-compatible chat-completions endpoint>
VOCAB_AI_API_KEY=<configured in CloudBase only>
VOCAB_AI_MODEL=<provider model identifier>
```

If any value is absent, normal curated/ECDICT/Free Dictionary behavior still
works and the AI action returns `AI_NOT_CONFIGURED`. Never put the key in static
site settings or Git. The endpoint must be HTTPS.

### My Words Editing, Export, and Dictionary Review

This release requires two deployment tracks after static publication:

1. Create `vocabulary_lexicon_history` and
   `vocabulary_dictionary_reports` as `ADMINONLY` collections, then add the
   recommended indexes above where supported.
2. Configure the three `VOCAB_AI_*` variables on both functions if AI lookup is
   wanted immediately.
3. Upload rebuilt `deploy-packages/studentVocabulary.zip` and
   `deploy-packages/teacherAdmin.zip` to the development environment.

There is no bulk data migration. Existing personal items receive missing Note,
example, and activity fields lazily; export falls back to existing save/update
timestamps. AI can be left unconfigured without blocking edit, merge, Note,
Excel, PDF, or normal dictionary enrichment.

The progressive My Words first-page release changes both the versioned static
Dashboard/My Words files and `studentVocabulary`. Publish the static files and
upload a rebuilt `deploy-packages/studentVocabulary.zip` from the same commit.
No collection or field migration is required; the existing recommended
`student_vocabulary_items.student_uid + status + updated_at` query index supports
the paginated read. Until the function ZIP is updated, the new static page cannot
consume `next_cursor` / `has_more` and should not be released independently.

### Dashboard Large-History Fix

The large-history fix requires both tracks below:

1. Publish the versioned `dashboard.html` / `assets/js/dashboard.js` static
   files so request failures show Retry instead of a false empty state.
2. Rebuild and deploy `deploy-packages/getDashboard.zip`, then set the CloudBase
   function execution timeout to at least 10 seconds (15 recommended).

No database migration or content import is required. After deployment, sign in
with a student that has at least 40 distinct historical sets and reload several
times. In CloudBase logs, every `getDashboard` invocation should succeed; a
`433` row whose detail says `Invoking task timed out` means either the old
function is still deployed or the timeout configuration was not updated.

### Personal Center STAR History

The STAR-source list requires both the versioned Dashboard static files and the
rebuilt `getDashboard` function:

```bash
npm run package:functions -- getDashboard
MRCAT_GET_DASHBOARD_DIR="$(mktemp -d /private/tmp/mrcat-getDashboard.XXXXXX)"
unzip -q deploy-packages/getDashboard.zip -d "$MRCAT_GET_DASHBOARD_DIR"
(cd "$MRCAT_GET_DASHBOARD_DIR" && tcb -e mrcat-dev-d9gwy2v1icdfdf597 -r ap-shanghai fn code update getDashboard --deployMode zip)
```

The second command changes the development CloudBase environment and remains
owner-gated. No collection, data migration, or content import is required.
After deployment, verify one student with both STAR colors and confirm each
list item opens that student's linked historical attempt.

### STAR Wallet and Cash Requests

This release requires all three deployment tracks plus private Storage setup.

1. Create `star_reward_ledger`, `star_redemption_requests`, and
   `star_redemption_evidence` as `ADMINONLY`, then add the indexes listed above.
2. Keep CloudBase Storage private. Do not expose a public bucket rule; evidence
   reads must use server-authorized temporary URLs.
3. Rebuild and deploy `getDashboard`, `teacherAdmin`, and `submitAttempt`:

```bash
npm run package:functions -- getDashboard teacherAdmin submitAttempt
```

4. Run the owner-gated STAR wallet migration in dry-run mode first. It reports
   active Blue rows, Yellow credits, grandfathered duplicate Yellow rows, and
   existing liability without changing CloudBase. Apply only after reviewing
   that report. From an authenticated Teacher page browser console:

```js
await MrCatCloud.callFunction('teacherAdmin', {
  action: 'migrateStarRewards'
});
```

After the owner accepts the report, apply once:

```js
await MrCatCloud.callFunction('teacherAdmin', {
  action: 'migrateStarRewards',
  apply: true
});
```

`teacherAdmin` currently has a 10-second execution timeout. An apply call can
time out in the browser after completing only part of the idempotent migration.
If that happens, do not infer success or failure from the browser error and do
not inspect student payloads in broad logs. Run the dry run again: if either
pending count remains non-zero, rerun apply; otherwise continue to verification.
Use the supported CLS command for aggregate log checks:

```bash
tcb logs search -e mrcat-dev-d9gwy2v1icdfdf597 \
  -q 'function_name:"teacherAdmin" AND "credits_created"' \
  -t 30m --sort desc --json
```

Rerun the dry run afterward; `credits_created` and
`converted_blue_created` should both be `0`.
5. Publish versioned `dashboard.html`, `teacher.html`, `assets/js/dashboard.js`,
   `assets/js/teacher.js`, `assets/js/cloudbase-client.js`, and `assets/css/app.css`.

Deploy in that exact order. New functions tolerate a temporarily unavailable
wallet projection for learning flows, but Cash must remain disabled until the
collections, indexes, migration, functions, and private Storage policy are all
ready. No cash amount or exchange-rate configuration is required.

After deployment, verify one student with Yellow and Blue history, one legacy
duplicate Yellow case if present, request creation/reservation, student and
teacher evidence upload, teacher reject/confirm, seven-day expiry logic with a
test timestamp, Refund, unread state, and double-click/idempotent retries.

### Teacher Matrix Assignment-Parameter Compatibility Fix

Matrix cell Edit and Wxx batch editing require the versioned `teacher.html` /
`assets/js/teacher.js` static files and a rebuilt `teacherAdmin` function. The
backend now accepts either the canonical `assignment_id` or the document `_id`
used as the stable ID by legacy assignment records. No database migration is
required.

```bash
npm run package:functions -- teacherAdmin
```

Upload `deploy-packages/teacherAdmin.zip` to the development `teacherAdmin`
function, preserving its existing Node.js 18 runtime, timeout settings, and
CloudBase-only environment variables.

### Assignment Due-Week Backfill

The required Due-week rollout needs updated `teacherAdmin`, `getDashboard`,
and `submitAttempt` functions plus the static Teacher/Student files. Deploying
the functions does not mutate assignment records. Reads temporarily derive a
Sunday-end due week from legacy `assigned_at`/creation timestamps.

After deploying `teacherAdmin`, an authenticated teacher should inspect the
bounded dry run from `teacher.html` in the browser console:

```js
await window.MrCatCloud.callFunction("teacherAdmin", {
  action: "backfillAssignmentDueWeeks",
  limit: 100
});
```

After checking `candidate_count`, `missing_source_count`, and the candidate
dates, apply one batch:

```js
await window.MrCatCloud.callFunction("teacherAdmin", {
  action: "backfillAssignmentDueWeeks",
  apply: true,
  limit: 100
});
```

If `next_cursor` is non-null, pass that exact string as `cursor` on the next
dry-run/apply request and continue until `done` is `true`. The action
normalizes each candidate to Shanghai-time Sunday 23:59:59 and keeps the
original legacy `assigned_at` value for audit/group identity. Records without
any usable date source are reported and left unchanged.

### TeacherAdmin Historical Regrade Backfill

Deploying `teacherAdmin.zip` does not automatically mutate historical data.
After deployment, an authenticated teacher may run the bounded backfill from
`teacher.html` in the browser console. The action compares historical wrong
answers against current CloudBase `grading_keys` and only improves matching
attempts; it never lowers scores or revokes STAR records.

Dry run one batch:

```js
await window.MrCatCloud.callFunction("teacherAdmin", {
  action: "backfillAcceptedAnswerRegrades",
  limit: 100,
  cursor: 0
});
```

Apply one batch:

```js
await window.MrCatCloud.callFunction("teacherAdmin", {
  action: "backfillAcceptedAnswerRegrades",
  apply: true,
  limit: 100,
  cursor: 0
});
```

If the result includes a non-null `next_cursor`, repeat with that value until
`done` is `true`. Add `set_id: "BBC-YYMMDD"` to limit the repair to one set.

For a reviewed Vocabulary public/private version mismatch, use the dedicated
teacher-only action. It reconstructs the legacy answer map from immutable
historical answer snapshots, requires at least three wrong answers in one
attempt to match the legacy map by default, and only marks additional answers
correct. Always inspect the dry run before applying:

```js
await window.MrCatCloud.callFunction("teacherAdmin", {
  action: "backfillVocabularyContentVersionMismatch",
  set_id: "NGSL-J",
  legacy_grading_version: "1",
  current_grading_version: "2"
});
```

Add `apply: true` only after candidate counts, question counts, and percentage
changes have been reviewed. The action writes adjusted fields, updates linked
assignment summaries, repairs eligible STAR records, and is idempotent.

### Protected Reference Reports

This feature has two deployment tracks and no database migration:

1. Generate the private payload from the reviewed local report. The generated
   module is ignored by Git and must never be staged:

```bash
npm run prepare:dse-topic-bank -- --source /absolute/path/HKDSE-topic-bank.html
npm run prepare:jupas-report -- --source /absolute/path/HK8-JUPAS-report.html
npm run test:protected-resources
npm run package:functions -- getProtectedResource
```

2. Create or update the development CloudBase `getProtectedResource` function
   with Node.js 18 and the generated `deploy-packages/getProtectedResource.zip`.
   No environment variable or new collection is required. If using CLI, extract
   the ZIP and run `fn deploy` from inside that narrow bundle directory so the
   CLI cannot package the repository. `fn deploy` creates the function on first
   use and `--force` replaces its code on later runs:

```bash
MRCAT_PROTECTED_RESOURCE_DIR="$(mktemp -d /private/tmp/mrcat-protected-resource.XXXXXX)"
unzip -q deploy-packages/getProtectedResource.zip -d "$MRCAT_PROTECTED_RESOURCE_DIR"
(cd "$MRCAT_PROTECTED_RESOURCE_DIR" && tcb -e mrcat-dev-d9gwy2v1icdfdf597 -r ap-shanghai fn deploy getProtectedResource --dir . --deployMode zip --runtime Nodejs18.15 --force)
```

3. Publish the relevant preview HTML and versioned JS/CSS only after the function
   bundle contains that resource. For the topic bank, also publish catalog and
   Dashboard integration. The standalone JUPAS report deliberately has no
   homepage or Library entry. Verify a logged-out visitor sees only preview
   content, a dedicated development student sees the complete report, and a
   teacher remains on the JUPAS preview. Updating GitHub Pages alone never
   publishes the full edition.

### Learning Reports V1

Learning Reports V1 has all of these deployment requirements. They are
owner-gated; agents may validate/package and prepare a deployment plan, but may
not create the collections, configure Cron, upload functions, or run the
migration without explicit owner approval.

1. Create `classes`, `class_memberships`, and `learning_reports` in the
   development environment with `ADMINONLY` permissions. Add the report,
   membership, assignment, and attempt indexes listed in section 3 before
   enabling report reads or timers.
2. Run `npm run test:learning-reports`, validate `teacherAdmin`,
   `learningReports`, and `generateLearningReports`, then rebuild and upload all
   three deployment ZIPs to the development CloudBase environment. The report
   page, its JavaScript/CSS cache versions, and the three function ZIPs must
   come from the same reviewed source.
3. After the new `teacherAdmin` is deployed, run a read-only migration audit of
   non-deleted student profiles and legacy `class_group` values. Resolve
   blank/ambiguous class names with the owner; do not guess historical
   enrolment. After review, create one normalized class and one active
   membership per current student, preserve the old profile field as a
   compatibility mirror, and record cutover time. Do not generate pre-cutover
   reports.
4. Set `LEARNING_REPORT_CRON_TOKEN` only in the function environment; never
   commit or print it. Configure the SCF timer's `CustomArgument` to the same
   value; SCF delivers that string as `event.Message` to
   `generateLearningReports`. The CloudBase CLI `fn trigger create` shortcut
   exposes only the name and Cron expression, so use the official SCF
   `CreateTrigger` API when setting `CustomArgument`. Suppress or sanitize the
   API response because `TriggerInfo` may echo `CustomArgument`; rotate the
   token immediately if it appears in a terminal or agent transcript. The
   timer must not accept browser-provided class IDs, periods, timestamps, or a
   publish flag.
   Run one daily timer at Shanghai `00:05` (`0 5 0 * * * *`) and set function
   `TZ=Asia/Shanghai`. The function derives the only allowed operations from
   server Shanghai time: weekly preview on Saturday and finalization after
   Sunday 23:59:59; monthly preview on the penultimate calendar day and
   finalization on the first day of the next month. After creation, verify in
   the SCF trigger details that the next execution resolves to Shanghai
   `00:05`; function `TZ` controls runtime time handling and must not be assumed
   to prove the scheduler's displayed next-run timezone.
5. Run development dry-runs with a disposable class. Verify idempotency for a
   duplicate timer delivery, preview-comment preservation, Shanghai boundary
   behavior, partial membership exclusion, server response redaction, and
   print/PDF output before any real group link is copied.
6. Publish `reports.html` and its versioned assets. The first ordinary-WeChat
   release uses `Copy report link` / `Copy WeChat text` followed by teacher
   manual sending. Do not deploy an unofficial personal-WeChat robot as part of
   this feature.

The authenticated teacher-only migration action is
`teacherAdmin.backfillLearningReportModel`. Invoke it with
`{ "action": "backfillLearningReportModel", "limit": 100, "offset": 0,
"assignment_limit": 25, "assignment_offset": 0 }`
first; omission of `apply: true` is the required dry run. Review every proposed
class, membership, skipped legacy batch, and exact full-class assignment batch.
Only then repeat each reviewed page with `"apply": true`. Continue student
pages with `next_offset` and assignment-batch pages with
`assignment_scope.assignment_next_offset`; each assignment batch is promoted
transactionally. Never substitute an unauthenticated database script.

Rollback notes: static files and report functions can roll back normally.
Published `learning_reports` and membership history are audit data; do not
bulk-delete, rewrite a published snapshot, or run a destructive migration. If
a report correction is required, use an explicit audited correction/republication
path after the owner reviews the impact.

### Teacher Attempt Email Notifications

This release uses CloudBase data, cloud functions, and the Teacher Personal
Center static UI. Deployment is owner-gated. Local validation and ZIP packaging
do not authorize creating the collection, setting SMTP credentials, deploying
the functions/static files, or enabling the timer.

Development rollout status (2026-08-11): the `ADMINONLY` outbox and indexes,
all three functions, and the three matching static files are deployed to
`mrcat-dev-d9gwy2v1icdfdf597`. The dispatcher timeout is 300 seconds. At that
deployment checkpoint, SMTP variables, recipient settings, and the timer were
intentionally left unconfigured; see the activation status below.

Activation status (2026-08-12): the owner configured the iCloud SMTP variables,
added and enabled the two development recipient addresses, and explicitly
authorized the one-minute timer. The private token and enabled SCF timer are now
configured in development; delivery still requires a real development-student
submission for end-to-end verification.

1. Create `teacher_attempt_email_events` with `ADMINONLY` permissions and add
   the unique/query indexes listed in section 3. Do not give the browser direct
   access to the outbox.
2. Configure these variables on `sendTeacherAttemptEmails` only:

   ```text
   TEACHER_ATTEMPT_EMAIL_CRON_TOKEN=<random server-only value>
   TEACHER_ATTEMPT_SMTP_HOST=smtp.mail.me.com
   TEACHER_ATTEMPT_SMTP_PORT=587
   TEACHER_ATTEMPT_SMTP_SECURE=false
   TEACHER_ATTEMPT_SMTP_USER=jxbleo@icloud.com
   TEACHER_ATTEMPT_SMTP_PASS=<SMTP authorization code or app password>
   TEACHER_ATTEMPT_EMAIL_FROM=猫先生英语 <jxbleo@icloud.com>
   TEACHER_ATTEMPT_EMAIL_REPLY_TO=<optional reply address>
   TEACHER_ATTEMPT_EMAIL_TEACHER_URL=<optional authenticated teacher-page HTTPS URL>
   TZ=Asia/Shanghai
   ```

   For providers such as QQ Mail or 163 Mail, use the provider's SMTP
   authorization code/app password, not the ordinary mailbox password. Never
   commit, print, or place these values in frontend settings. Recipient
   addresses are not function environment values: after deployment, the
   authenticated teacher adds up to ten addresses in Personal Center and
   enables the desired ones. Multiple enabled teacher-owned inboxes receive one
   BCC message and cannot see each other's address. Do not add parent addresses
   here; guardian delivery requires a separate student-specific authorization
   mapping.
3. Validate and package all affected functions from the same source:

   ```bash
   npm run test:attempt-emails
   npm run package:functions -- submitAttempt teacherAdmin sendTeacherAttemptEmails
   ```

4. Deploy `sendTeacherAttemptEmails` first, then the rebuilt `teacherAdmin` and
   `submitAttempt`, and publish matching `teacher.html`, `assets/js/teacher.js`,
   and `assets/css/app.css` cache versions. Only submissions accepted by the
   new `submitAttempt` enqueue email events; this rollout intentionally does not
   backfill old attempts.
5. Create a one-minute SCF timer (`0 * * * * * *`) for
   `sendTeacherAttemptEmails`. Put the same server token in `CustomArgument`;
   SCF delivers it as `event.Message`. As with Learning Reports, use the
   official SCF `CreateTrigger` API if the console/CLI shortcut cannot set
   `CustomArgument`, and sanitize any response that might echo the token.
6. Enable the timer last and test with a dedicated development student. A
   Vocabulary email normally arrives on the next timer tick. Every Quiz/timed
   Practice submission must be a separate mailbox message; its subject carries
   the mode and current `No.`, while second and later submissions include prior
   attempts in the body. A BBC email is eligible seven minutes after the first
   submission in its fixed batch, then sends on the next tick. SMTP/network
   failures retry with bounded backoff; a processing claim older than ten
   minutes is automatically recovered.
7. In Teacher Personal Center, add the owner's QQ and iCloud addresses and keep
   both enabled for the comparison period. Submit one development Vocabulary
   attempt, confirm both inboxes receive the same BCC message, then pause one
   address and verify only the remaining enabled inbox receives the next test.

For rollback, disable the timer first and redeploy the previous
`submitAttempt`. Keep existing outbox rows as delivery/audit evidence; do not
bulk-delete them. SMTP cannot provide strict exactly-once delivery when the
provider accepts a message but the following database update fails. The
dispatcher uses a deterministic `Message-ID`, transactional claims, and sent
state to reduce duplicate delivery, but the teacher should treat the attempt
history—not the number of email copies—as authoritative.

## 6. Owner-Gated Release Automation

The project uses semi-automated deployment helpers. They prepare release
artifacts but do not deploy to CloudBase.

```bash
npm run verify:release
npm run package:functions:all
npm run release:plan
npm run cloudbase:import:content
```

What each command does:

| Command | What it may do | What it must not do |
| --- | --- | --- |
| `npm run verify:release` | syntax-check cloud functions, parse public JSON, check required docs, warn about dirty files | deploy, read secrets, modify CloudBase |
| `npm run package:functions:all` | bundle runtime dependencies and rebuild local ZIPs in `deploy-packages/` | upload ZIPs or change function settings |
| `npm run release:plan` | write `.cloudbase-private/deploy-plan.md` for owner review | deploy, import data, request credentials |
| `npm run cloudbase:import:content` | dry-run CloudBase data import plan | write CloudBase unless `-- --apply` is passed |

Agents may run these helper commands. The owner remains responsible for the
final CloudBase function deploy, owner-only CLI apply command, and any
environment variable changes.

The generated deploy plan is local and ignored by Git. It is a checklist, not
an authorization grant.

### Threshold-default rollout

When Vocabulary/BBC family defaults change, deploy the rebuilt
`teacherAdmin`, `submitAttempt`, and `getDashboard` ZIPs. Regenerate private
content data, then review and apply an overwrite limited to `sets` and
`system_config` so existing set records receive the new values without
touching teacher-approved `grading_keys`:

```bash
node scripts/prepare-cloudbase-data.js
npm run cloudbase:import:content -- --only sets,system_config --overwrite-existing
npm run cloudbase:import:content -- --apply --only sets,system_config --overwrite-existing
```

The first import command is a dry run. This changes defaults for new
assignments and independent practice; it does not rewrite threshold snapshots
already stored on existing assignments.

GitHub Actions automatically publishes successful builds from the GitHub
`main` branch to the dedicated Tencent COS static-website bucket, as explicitly
selected by the owner. This authorization applies only to the public static
artifact produced by:

```bash
npm run build:static
```

The workflow is `.github/workflows/deploy-cos.yml`. It installs locked npm
dependencies, runs `npm run build:static`, verifies the public boundary, and
runs `scripts/deploy-static-to-cos.js`. The allowlist contains root
HTML/web-manifest files plus `assets/`, `bbc-audio/`, `content/`, and `data/`;
it excludes cloud functions, scripts, documentation, deployment packages, and
local/private files.

Automatic static publication does not authorize function deployment, database
imports, DNS changes, certificate changes, secrets, environment variables,
timers, billing changes, or other Tencent resource mutations. Those remain
separately owner-gated.

## 7. CloudBase Data Import

Prepare import data:

```bash
node scripts/prepare-cloudbase-data.js
```

Use the JSON Lines files under:

```text
.cloudbase-private/import/
```

Important files:

- `sets-cloudbase.json`: import into `sets`
- `grading-keys-cloudbase.json`: import into `grading_keys`
- `system-config-cloudbase.json`: import into `system_config`

These files are one JSON document per line. Do not wrap them in an array before
console import.

Preferred CLI import:

```bash
npm run cloudbase:import:content
npm run cloudbase:import:content -- --apply
```

The first command is a dry run. The second writes to the development CloudBase
environment using `tcb db nosql execute`.

Default write behavior is insert-missing only:

- existing `sets` are not overwritten
- existing `grading_keys` are not overwritten
- teacher-approved grading changes made through Argue are protected by default

Only use overwrite mode after an explicit content-owner review:

```bash
npm run cloudbase:import:content -- --apply --overwrite-existing
```

To repair a reviewed subset without touching unrelated existing grading keys,
filter by key with `--ids`:

```bash
npm run cloudbase:import:content -- --only grading_keys --ids NGSL-C
npm run cloudbase:import:content -- --apply --only grading_keys --ids NGSL-C --overwrite-existing
```

For multiple records, pass a comma-separated list such as
`--ids NGSL-A,NGSL-B,NGSL-C`. The filter matches each collection's key field
(`set_id` for `sets` and `grading_keys`, `config_key` for `system_config`).

The script uses these defaults unless overridden:

```text
env-id: mrcat-dev-d9gwy2v1icdfdf597
region: ap-shanghai
collections: sets, grading_keys
```

Set `TCB_ENV_ID`, `TCB_REGION`, or pass `--env-id` / `--region` when needed.

Console import remains a fallback. If using the console, import:

- `sets-cloudbase.json` into `sets`
- `grading-keys-cloudbase.json` into `grading_keys`
- `system-config-cloudbase.json` into `system_config` only when default config changes

After importing content, verify:

- `sets` contains the exact `set_id`
- `grading_keys` contains the exact `set_id`
- the practice page loads
- `submitAttempt` can grade the set

If a direct practice URL loads but the authenticated Library/Explore does not
show it, check `sets`. If submission returns `GRADING_KEY_NOT_FOUND`, check
`grading_keys`.

## 8. Recommended Deployment Order

For a backend/data release:

1. Confirm required collections and indexes exist.
2. Run local syntax checks.
3. Rebuild affected function ZIPs.
4. Deploy functions to development CloudBase.
5. Import required data files.
6. Publish static site changes.
7. Test login, dashboard, assignment, submission, and teacher page flows.

For a content-only release:

1. Update `content/` and `data/`.
2. Run `node scripts/build-home-catalog.js`.
3. Run `node scripts/prepare-cloudbase-data.js` if CloudBase `sets` or grading
   changed.
4. Import new `sets` and `grading_keys` records if required.
5. Publish static files.
6. Verify catalog visibility and grading.

## 9. Manual Verification After Deploy

Student flow:

- login works
- dashboard loads profile
- `TO DO` and `FINISHED` groups display correctly
- assigned practice opens
- failed, passed, and mastered attempts store correctly
- later low score does not downgrade completed work
- personal My Words save works only for logged-in students
- My Words edit, Note, merge/undo, time/manual selection, Excel, and print-to-PDF work
- a missing word shows the configured AI preview flow or a clear not-configured error
- Personal Center shows Available Yellow STAR balance and unified My STARs
- Cash request reserve/cancel/evidence/status flows work without displaying money
- published report link requires login; the student sees the shared leaderboard
  and only their own detail, while browser print/PDF contains only that view

Teacher flow:

- teacher page requires active teacher profile
- student creation checks Login ID uniqueness
- assign skips open duplicates
- completed work can be reassigned
- Library preview can show answers only through teacher session
- Argue list loads and resolution updates grading/history
- Dictionary queues load; publishing creates private lexicon history and updates
  the one current shared entry
- Student detail My Words view is complete and read-only
- Teacher STAR badge counts all pending Cash requests; confirm/reject/refund and
  private evidence history work
- teacher report preview saves comments/goals, finalizes once after the cutoff,
  shows full authorized class detail, and copies a valid ordinary-WeChat link/text
- every Vocabulary Quiz and timed Practice submission creates a separately
  visible prompt email with mode/current `No.` in its subject; second and later
  emails contain the earlier attempts and comparison chart
- BBC retries submitted within the fixed first-submission-plus-seven-minute
  window produce one email containing the complete batch history
- email mistake rows match the Teacher bell's authorized paper view: correct
  questions are omitted and BBC mistakes include expected answers/explanations
- opening or receiving an email does not mark the Teacher bell thread as read

Data flow:

- no private grading output is staged
- `.cloudbase-private/` remains ignored
- `sets` and `grading_keys` exact `set_id` records exist
- browser does not directly access `ADMINONLY` collections
- evidence file IDs are not permanent public URLs and Storage remains private
- report collections remain `ADMINONLY`; unauthenticated, inactive, unrelated,
  and preview-student reads are denied without returning another student's report data
- attempt-email outbox and SMTP credentials remain server-only; recipient
  settings are visible/mutable only to the authenticated owning teacher, and
  delivery failures do not roll back submissions

## 10. Rollback and Risk Notes

Static rollback is usually a Git/static-hosting rollback.

Cloud function rollback requires redeploying a previous ZIP or previous source
package. Keep deploy packages aligned with source commits.

Data import rollback is harder because attempts, disputes, and grading history
are durable. Do not run destructive migrations or mass deletes unless the owner
explicitly approves the exact plan.

## 11. Legacy Detailed Reference

The older root-level [CLOUDBASE_DEPLOYMENT.md](../CLOUDBASE_DEPLOYMENT.md)
contains historical console notes and examples. This `docs/10_DEPLOYMENT.md`
is the current docs-system entry point.

## 12. Edition Publication Order

An edition spans static files, CloudBase data, and (for the first rollout) cloud
functions. Publish in this order:

1. Deploy the compatible `getResources`, `getDashboard`, `submitAttempt`, and
   `teacherAdmin` functions plus static shared edition code.
2. Prepare and dry-run the new edition's concrete `sets` and `grading_keys` rows.
3. Owner-apply those missing rows; do not overwrite the original edition.
4. Publish the catalog/runtime files that expose the new edition.
5. Verify Student Library switching, independent scores, Teacher Assign rows,
   direct Assignment entry, and one real submission in development.

No current collection migration or production deployment is authorized by this
documentation change.
