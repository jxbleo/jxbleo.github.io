# CloudBase Development Deployment

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

Create unique indexes where the console supports them:

- `student_set_achievements.achievement_id`
- `answer_disputes.dispute_id`
- `grading_key_history.history_id`

Create all three collections before deploying the corresponding updated cloud
functions. The student Dashboard reads `student_set_achievements`, and the
teacher page reads `answer_disputes`.

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
  CloudBase console.
- `import/sets-cloudbase.json` is safe catalog metadata.
- `import/grading-keys-cloudbase.json` contains all correct answers and must remain
  private.
- `import/system-config-cloudbase.json` contains the default grading settings.
- The other `.json` files are readable array-form backups and are not intended
  for direct console import.
- `public/` contains preview data with grading fields removed.
- Never commit `.cloudbase-private/`.

## Deployment Order

1. Deploy `getCurrentStudent`.
2. Test `test001` login and profile lookup.
3. Import `sets-cloudbase.json` into `sets`.
4. Import `grading-keys-cloudbase.json` into `grading_keys`.
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

Student self-service password changes are not active yet. They must use
CloudBase's authenticated password API and must never read or store the
student's password in the database.

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
