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
- [ ] If NAWL-X through NAWL-Z2 still do not appear in student Explore or
      teacher Library after the static site is published, import the matching
      CloudBase `sets` records for visibility and `grading_keys` records for
      grading in the development environment.
- [ ] Investigate teacher Progress data freshness: after a dev student completed
      assignment `BBC-250717` at 100%, the student dashboard showed it under
      FINISHED, but teacher Progress still showed the older `5 TO DO / 4
      Finished` summary and did not list that assignment after reload.
- [ ] Decide whether the student dashboard should show two unlabeled star
      counters. The current header displays separate assignment and self-study
      counts, but they appear only as adjacent `★` numbers.

## Done

### 2026-06-16

- Added owner-gated CloudBase release helpers: `verify-release`,
  `package-cloudfunctions`, and `generate-deploy-plan`. Verified the release
  checker passes with only a dirty-worktree warning, dry-run packaging lists all
  current cloud functions, and deploy-plan generation writes the ignored local
  `.cloudbase-private/deploy-plan.md`. CloudBase: no deployment performed.
- Fixed source-level P0 backend architecture issues: `submitAttempt` now keeps
  assignment status monotonic while recording lower-scoring retries, student
  dashboard/submit functions reject teacher profiles, teacher assignment can
  reassign completed/STAR work, and Argue regrading can create or repair STAR
  records when mastery is reached.
- Updated `teacher.js` candidate cards so completed/STAR students are selectable
  for reassignment. CloudBase deployment still required for
  `submitAttempt`, `getDashboard`, and `teacherAdmin`; static publish required
  for the teacher UI change.
- Generated light-background square DSE/IELTS app icon assets from the owner's
  original logo images, wired the student dashboard to switch the home-screen
  icon/manifest by `curriculum_track`, and kept student/teacher personal
  profile System fields text-only.
- Verified icon dimensions/background pixels, manifest JSON, and
  `dashboard.js`/`teacher.js` syntax. CloudBase: no deployment required; static
  publish is required for devices to fetch the new icons.
- Fixed mobile student assignment capsules so the `Go` button stays in a right
  column instead of dropping to a third line; verified with headless Chrome at
  390px viewport that `Go` shares the title row and sits on the right.
- Blocked personal My Words saves from answer, explanation, feedback, result,
  teacher-reply, and review-answer UI regions; also guarded selections that
  drag across blocked answer content.
- Verified `personal-vocab.js` syntax and bumped the script cache query on
  Dashboard, BBC, IELTS Reading, IELTS Listening, and Vocabulary pages.
- Removed the green generated app icon and web manifest references, kept the
  owner's original DSE/IELTS logo images as static assets, and made teacher
  student Class/System tags visibly editable with DSE/IELTS logo badges.
- Verified `teacher.js` syntax, original logo byte-for-byte copies, and local
  static responses for teacher assets and removed icon paths.
- Fixed IELTS Listening teacher preview audio startup: `teacher=1` no longer
  blocks the shared `Start Audio` confirmation flow.
- Added the public app version to teacher Library practice links and bumped the
  static config cache version to `20260616-1` so devices fetch the updated
  practice page URL.
- Verified locally that IELTS Listening teacher preview opens `C7-T1-S1`, sees
  the audio source, and shows the start-audio dialog after clicking `Start
  Audio`.
- Verified NAWL-X through NAWL-Z2 JSON/JS fallback files parse, are listed in
  the static home catalog, and `NAWL-Z2` renders locally with 63 words and 6
  test groups.
- CloudBase: no deployment or import performed. Static publish is required for
  the audio fix; CloudBase `sets` and `grading_keys` import is required if NAWL
  items are missing from authenticated Library/Explore or grading.
- Imported Cambridge IELTS 7 Academic Reading/Listening from the supplied PDF:
  added missing Test 4 Reading passages, added 14 missing Listening section
  pages, corrected `C7-T3-P1` Questions 7-13 to use the original A-O option
  format, rebuilt the static catalog, and regenerated private CloudBase import
  files.
- Verified all 28 C7 runtime JSON files parse, each C7 grading key is non-empty,
  public C7 data contains no answer/explanation fields, the home catalog lists
  all 28 C7 items, and local browser smoke tests load `C7-T4-P1`,
  `C7-T4-S4`, and corrected `C7-T3-P1` with no console errors.
- CloudBase: import updated `.cloudbase-private/import/sets-cloudbase.json` and
  `.cloudbase-private/import/grading-keys-cloudbase.json` after publishing the
  static site. New Listening pages show `Audio pending` until matching mp3 files
  are added under `assets/audio/ielts-listening/` and referenced in data JSON.

### 2026-06-15

- Added the personal My Words feature source: new `studentVocabulary` cloud
  function, shared `personal-vocab.js` selection UI, Dashboard My Words panel,
  docs, and `deploy-packages/studentVocabulary.zip`.
- Verified `studentVocabulary`, `personal-vocab.js`, and `dashboard.js` with
  `node --check`; browser-smoked local BBC visitor loading and local Visitor
  Dashboard with no console errors.
- CloudBase: owner already created `student_vocabulary_items` and indexes.
  Deploy `studentVocabulary`, then publish the static site and test saving with
  a dedicated development student account.
- Investigated IELTS Listening `Start Audio` not playing. Verified
  `C7-T3-S4.mp3` serves locally as `audio/mpeg`; fixed the start/resume state
  machine so one tap cannot double-trigger `touchend`/`click` and invalidate
  the first `audio.play()` attempt. Verified inline script syntax and local
  page/audio 200 responses.
- Ran a dev end-to-end QA pass with dedicated teacher/student test accounts:
  teacher assigned `BBC-250717`, student opened it from dashboard, submitted a
  correct countable attempt, and the student dashboard moved it from TO DO to
  FINISHED.
- Verified teacher BBC preview `Show Answers` works with an authenticated
  teacher session and does not surface a raw CloudBase SDK error.
- Confirmed owner correction: the current student dashboard is intentionally
  two groups, `TO DO` and `FINISHED`; do not split it into `PASSED` and
  `MASTERED` without a new owner request.
- Reverted the accidental three-filter dashboard change and removed the
  residual MASTERED `1 Week / 1 Month / All` code path; bumped `dashboard.html`
  to `dashboard.js?v=20260615-8`.
- Updated `AGENTS.md` so future agents know the student dashboard is currently
  a two-group `TO DO` / `FINISHED` design.
- Verified `assets/js/dashboard.js` with `node --check`.
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
