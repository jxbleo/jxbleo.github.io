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

`changePassword` and `resetStudentPassword` are intentionally not active yet:

- student password changes must use CloudBase's authenticated password API
- teacher resets require a server-side teacher authorization policy
- the reset password must be stored as server-side configuration, never in the
  repository

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

The function uses CloudBase's official `@cloudbase/manager-node` user
management service with the cloud function runtime's temporary Tencent Cloud
credentials. No permanent SecretId or SecretKey is stored in the repository
or browser.
