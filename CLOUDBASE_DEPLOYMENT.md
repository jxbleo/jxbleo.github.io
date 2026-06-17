# CloudBase Development Deployment

> Current numbered docs entry: `docs/10_DEPLOYMENT.md`.
> This root-level file is kept as a legacy detailed reference.

This guide applies only to the development environment:

```text
mrcat-dev-d9gwy2v1icdfdf597
```

Do not repeat these steps in production without owner review.

## Current Console State

The following collections already exist with `ADMINONLY` permissions:

- `students`
- `sets`
- `assignments`
- `attempts`
- `grading_keys`
- `system_config`

The STAR and Argue release also requires these `ADMINONLY` collections:

- `student_set_achievements`
- `answer_disputes`
- `grading_key_history`

The personal vocabulary feature also requires this `ADMINONLY` collection:

- `student_vocabulary_items`

Create unique indexes where the console supports them:

- `student_set_achievements.achievement_id`
- `answer_disputes.dispute_id`
- `grading_key_history.history_id`
- `student_vocabulary_items.vocab_id`
- `student_vocabulary_items.student_uid + normalized_text`

Create the non-unique query index for the student word list:

- `student_vocabulary_items.student_uid + status + updated_at`

Create the STAR and Argue collections before deploying the corresponding
updated cloud functions. The student Dashboard reads
`student_set_achievements`, and the teacher page reads `answer_disputes`.
Create `student_vocabulary_items` before deploying `studentVocabulary` or the
static My Words UI.

Username/password authentication is enabled and anonymous authentication is
disabled.

## Prepare Import Data

Run locally:

```bash
node scripts/prepare-cloudbase-data.js
```

This creates ignored local files under:

```text
.cloudbase-private/
```

Important:

- Files ending in `-cloudbase.json` use the JSON Lines format required by the
  CloudBase CLI import helper and CloudBase console fallback.
- JSON Lines means one complete JSON document per line. Do not wrap the records
  in a top-level array for console import.
- `import/sets-cloudbase.json` is safe catalog metadata.
- `import/grading-keys-cloudbase.json` contains all correct answers and must remain
  private.
- `import/system-config-cloudbase.json` contains the default grading settings.
- The other `.json` files are readable array-form backups and are not intended
  for direct console import.
- `public/` contains preview data with grading fields removed.
- Never commit `.cloudbase-private/`.

Preferred owner-run CLI import:

```bash
npm run cloudbase:import:content
npm run cloudbase:import:content -- --apply
```

The first command is a dry run. The second inserts missing `sets` and
`grading_keys` records into the development CloudBase environment. It does not
overwrite existing records by default, so teacher-approved Argue grading
changes are protected.

If importing only a few new records through the console fallback, create a
smaller JSON Lines file by filtering the relevant `-cloudbase.json` file. Do
not import an array-form JSON backup into the console. The console import modal
may describe the format as `JSON` rather than `JSON Lines`; for these project
files, still upload the one-document-per-line `-cloudbase.json` file.

For `grading_keys`, use JSON import rather than CSV because each record contains
nested `answers` and `explanations` objects, and some answers may be arrays of
accepted variants.

If the console reports records succeeded but failed to clean a temporary upload
file, the database import succeeded. The temporary file can be deleted later
from file management.

After importing new exercise content, verify both collections:

- `sets`: search `set_id = <NEW_SET_ID>`; this controls Student Library /
  Explore visibility through `getResources`.
- `grading_keys`: search `set_id = <NEW_SET_ID>`; this controls grading in
  `submitAttempt`.

If a direct practice URL loads but Library does not show the item, `sets` is
missing or stale. If submission fails with `GRADING_KEY_NOT_FOUND`,
`grading_keys` is missing that `set_id`.

## Deployment Order

1. Deploy `getCurrentStudent`.
2. Test `test001` login and profile lookup.
3. Run `npm run cloudbase:import:content` and review the dry-run output.
4. Run `npm run cloudbase:import:content -- --apply` to import `sets` and
   `grading_keys`.
5. Import `system-config-cloudbase.json` into `system_config`.
6. Deploy `getResources`.
7. Deploy `getDashboard`.
8. Create one test assignment for `test001`.
9. Deploy `submitAttempt`.
10. Test the complete flow before replacing public question data.

## STAR And Argue Deployment

After creating the three collections above:

1. Deploy `submitAttempt` from `deploy-packages/submitAttempt.zip`.
2. Deploy `getDashboard` from `deploy-packages/getDashboard.zip`.
3. Deploy `teacherAdmin` from `deploy-packages/teacherAdmin.zip`.
4. Push/deploy the static website.
5. Submit one passing Explore attempt and verify a protected STAR appears.
6. Verify the teacher cannot assign the same set to that student.
7. Submit a wrong answer, send one Argue request, and verify it appears under
   Teacher `Data`.
8. Resolve it with `Add as Accepted Answer` in development and verify:
   - the disputed attempt improves
   - a qualifying attempt creates a STAR
   - the grading key version increases
   - the history record is retained

Do not deploy these function updates before the new collections exist.

## Personal Vocabulary Deployment

After creating `student_vocabulary_items` with `ADMINONLY` permissions and the
indexes listed above:

1. Deploy `studentVocabulary` from
   `deploy-packages/studentVocabulary.zip`.
2. Push/deploy the static website.
3. Log in as a development student, select a word on a practice page, and save
   it to My Words.
4. Verify the document is owned by that student's `auth_uid`.
5. Verify Dashboard `Progress` lists the saved word and `Archive` removes it
   from the active list.

Visitors and teacher preview should not create personal vocabulary records.

## Required Test Assignment

Use the linked student's string `auth_uid`.

```json
{
  "assignment_id": "test001-BBC-250724-01",
  "student_uid": "2064585008734453762",
  "set_id": "BBC-250724",
  "status": "not_done",
  "attempt_count": 0,
  "latest_attempt_id": null,
  "latest_percentage": null,
  "best_percentage": null,
  "completed_at": null
}
```

The console may add `_id` automatically. Dates may be added after the first
functional test.

## Public Answer Cutover

Do not replace current runtime JSON with the generated public files until:

- grading keys are imported successfully
- `submitAttempt` is deployed
- each practice page submits answers to the cloud function
- returned grading feedback renders correctly

After those checks, copy the generated public question data into the runtime
locations and verify that current answer fields are no longer served.

Old Git history may still contain previously committed answers. New answers
must not be committed after cutover.

## Password Functions

Teacher password resets are implemented by the teacher-authorized
`teacherAdmin` function. The reset value comes from the server-side
`INITIAL_STUDENT_PASSWORD` environment variable and must never be stored in the
repository or frontend.

Student self-service password changes are handled by the `changePassword`
function. The function uses the authenticated caller context, updates only that
student's CloudBase Authentication password, and clears `must_change_password`
after success. It must never read or store the student's password in the
database.

CloudBase rejects weak values such as pure repeated digits, even when the
length is six or eight characters. Use at least 6 characters with uppercase,
lowercase, number, and symbol; for example, `Aa_888` is the intended short
format.

## Teacher Desk

The teacher interface lives at:

```text
teacher.html
```

Before opening it, add a linked teacher profile to `students`. Replace
`auth_uid` with the User ID shown on the CloudBase authentication user detail
page:

```json
{
  "auth_uid": "CLOUDBASE_USER_ID",
  "student_id": "jxbleo",
  "name": "Leo",
  "class_group": "",
  "role": "teacher",
  "active": true,
  "must_change_password": false
}
```

Deploy the `teacherAdmin` cloud function from
`deploy-packages/teacherAdmin.zip`:

- Node.js 18
- 256 MB
- initialization timeout 65 seconds
- execution timeout 10 seconds
- install dependencies automatically

Add this cloud-function environment variable:

```text
INITIAL_STUDENT_PASSWORD=<the agreed initial password>
```

The value must remain in the CloudBase function configuration. Do not add it
to GitHub or frontend JavaScript.

Every action checks the authenticated CloudBase UID against an active
`students` document with `role: "teacher"`. Frontend state alone cannot grant
teacher access.

The first version supports:

- creating and activating a CloudBase username/password user
- creating the matching `students` profile in the same operation
- deleting the newly created authentication user if profile creation fails
- rejecting creation when the Login ID already exists in either CloudBase
  authentication or the `students` collection
- editing a student's name and class
- activating or deactivating both authentication access and the student
  profile
- resetting a student's password to the configured initial password
- assigning visible practice sets
- assigning one practice set to multiple students or a filtered class
- blocking duplicate assignment while the same set is To Do or Failed
- allowing reassignment after the student has already completed the set
- viewing assignment summaries
- viewing attempt summaries without exposing answer payloads

The function uses CloudBase's official `@cloudbase/manager-node` end-user
management service (`createEndUser`, `modifyEndUser`, and end-user status
operations), matching the username/password authentication used by the web
login. It uses the cloud function runtime's temporary Tencent Cloud
credentials. No permanent SecretId or SecretKey is stored in the repository
or browser.
