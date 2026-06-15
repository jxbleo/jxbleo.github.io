# Agent QA To Do List

This file is the shared QA memory for Mr. Cat Academy agents. Keep entries
short, factual, and useful for the next run.

## How To Use This File

- Add reproducible product, design, content, and test issues under `Open`.
- Move completed items to `Done` after the fix is verified.
- Record what was tested, what changed, and any owner action still required.
- Do not paste passwords, CloudBase secrets, grading keys, private answers, or
  long command output here.
- If a test touches the CloudBase development backend, mention the test account
  role and the kind of data created, but not the password.

## Local QA Credentials

Automated login tests may read credentials from `.qa-secrets.local` when that
file exists on this machine. The file is ignored by Git. Use only dedicated
development test accounts, never the owner's real teacher account or a real
student account.

Create it from `.qa-secrets.example` and fill in local values:

```bash
cp .qa-secrets.example .qa-secrets.local
```

## Open

- [ ] Add a lightweight smoke-test script that checks JSON parsing, catalog
      links, and key static pages.
- [ ] Add browser smoke coverage for visitor mode, student login, and teacher
      preview once dedicated development test accounts are available.
- [ ] Consider passing durable `question_text` from each practice runtime's
      Argue submission path.
- [ ] Investigate teacher Progress data freshness: after a dev student completed
      assignment `BBC-250717` at 100%, the student dashboard showed it under
      MASTERED, but teacher Progress still showed the older `5 TO DO / 4
      Finished` summary and did not list that assignment after reload.
- [ ] Reconcile reassignment rules for completed/STAR work. Teacher Assign
      correctly detected the completed `BBC-250717` result, but both frontend
      candidate UI and the deployed `teacherAdmin.createAssignments` behavior
      block reassignment as already completed; project rules say completed/STAR
      records must not block future assignment.
- [ ] Decide whether the student dashboard should show two unlabeled star
      counters. The current header displays separate assignment and self-study
      counts, but they appear only as adjacent `★` numbers.

## Done

### 2026-06-15

- Ran a dev end-to-end QA pass with dedicated teacher/student test accounts:
  teacher assigned `BBC-250717`, student opened it from dashboard, submitted a
  correct countable attempt, and the student dashboard moved it from TO DO to
  MASTERED.
- Verified teacher BBC preview `Show Answers` works with an authenticated
  teacher session and does not surface a raw CloudBase SDK error.
- Fixed the student dashboard assignment filters to show `TO DO`, `PASSED`, and
  `MASTERED` instead of merging completed work into `FINISHED`; MASTERED now
  uses the existing `1 Week / 1 Month / All` range selector.
- Verified `assets/js/dashboard.js` with `node --check`, browser-tested the
  three filters locally, and bumped `dashboard.html` to
  `dashboard.js?v=20260615-7`.
- CloudBase: no deployment performed. Test data created in development:
  one assignment and one attempt for the dedicated student test account.
- Added PWA/iOS icon assets from the supplied cat-logo references, wired
  `apple-touch-icon` and `site.webmanifest` across all root HTML pages, and
  verified manifest JSON, icon dimensions, and page icon references.
- CloudBase: no deployment required; publish the static site for devices to
  fetch the new home-screen icon.
- Created this QA memory file and a local credential template for future
  Codex-assisted test runs.
- Added repository rules for updating this file after QA, bug-fix, and
  verification work.
- CloudBase: no deployment required.
