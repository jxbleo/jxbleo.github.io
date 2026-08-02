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
| CloudBase data | `sets`, `grading_keys`, `system_config` | import JSON Lines files |

A feature may require one, two, or all three tracks. Always state which tracks
are still required.

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

### Protected HKDSE Topic Bank

This feature has two deployment tracks and no database migration:

1. Generate the private payload from the reviewed local report. The generated
   module is ignored by Git and must never be staged:

```bash
npm run prepare:dse-topic-bank -- --source /absolute/path/HKDSE-topic-bank.html
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

3. Publish `dse-topic-bank.html`, its versioned CSS/JS, the catalog metadata,
   Login return handling, and Dashboard catalog merge. Verify a logged-out
   visitor sees only preview content and a dedicated development student sees
   the complete report. Updating GitHub Pages alone never publishes the full
   edition; updating the function alone does not add the Library card.

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

Do not configure automatic CloudBase deployment on every Git push. If CI/CD is
added later, it should use a manually triggered workflow and owner approval
before secrets are released.

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

Data flow:

- no private grading output is staged
- `.cloudbase-private/` remains ignored
- `sets` and `grading_keys` exact `set_id` records exist
- browser does not directly access `ADMINONLY` collections
- evidence file IDs are not permanent public URLs and Storage remains private

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
