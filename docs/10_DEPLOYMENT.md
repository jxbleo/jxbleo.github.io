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
- `answer_disputes`
- `grading_key_history`
- `student_vocabulary_items`
- `vocabulary_test_sessions`

Recommended unique indexes where supported:

- `student_set_achievements.achievement_id`
- `answer_disputes.dispute_id`
- `grading_key_history.history_id`
- `student_vocabulary_items.vocab_id`
- `student_vocabulary_items.student_uid + normalized_text`
- `vocabulary_test_sessions.test_session_id`

Recommended query index:

- `student_vocabulary_items.student_uid + status + updated_at`
- `vocabulary_test_sessions.student_uid + status`

Create required collections before deploying functions that depend on them.

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

Common validation:

```bash
find cloudfunctions -name index.js -exec node --check {} \;
```

Function runtime expectation:

- Node.js 18
- automatic dependency installation
- development environment unless owner approves otherwise

`teacherAdmin` additionally requires the environment variable:

```text
INITIAL_STUDENT_PASSWORD=<configured in CloudBase only>
```

Never write this value into Git, frontend code, docs, screenshots, or command
logs.

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
| `npm run package:functions:all` | rebuild local ZIPs in `deploy-packages/` | upload ZIPs or change function settings |
| `npm run release:plan` | write `.cloudbase-private/deploy-plan.md` for owner review | deploy, import data, request credentials |
| `npm run cloudbase:import:content` | dry-run CloudBase data import plan | write CloudBase unless `-- --apply` is passed |

Agents may run these helper commands. The owner remains responsible for the
final CloudBase function deploy, owner-only CLI apply command, and any
environment variable changes.

The generated deploy plan is local and ignored by Git. It is a checklist, not
an authorization grant.

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

Teacher flow:

- teacher page requires active teacher profile
- student creation checks Login ID uniqueness
- assign skips open duplicates
- completed work can be reassigned
- Library preview can show answers only through teacher session
- Argue list loads and resolution updates grading/history

Data flow:

- no private grading output is staged
- `.cloudbase-private/` remains ignored
- `sets` and `grading_keys` exact `set_id` records exist
- browser does not directly access `ADMINONLY` collections

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
