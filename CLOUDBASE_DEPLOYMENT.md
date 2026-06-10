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
