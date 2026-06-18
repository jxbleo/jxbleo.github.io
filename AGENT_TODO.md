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
- [ ] If NAWL-A through NAWL-J still do not appear in student Explore or
      teacher Library after the static site is published, import the matching
      CloudBase `sets` records for visibility and `grading_keys` records for
      grading in the development environment.
- [ ] Investigate teacher Progress data freshness: after a dev student completed
      assignment `BBC-250717` at 100%, the student dashboard showed it under
      FINISHED, but teacher Progress still showed the older `5 TO DO / 4
      Finished` summary and did not list that assignment after reload.
- [ ] Before importing `NGSL-D`, confirm or replace the duplicate unit words
      found in the source material: `quiet`, `relatively`, and `attract` each
      appears twice in the 1301-1400 unit.

## Done

### 2026-06-19

- Simplified student Assignment task capsules by removing the extra lower-left
  status/set pills and matching the Library task-card density. Reworked the
  Finished drawer control into a sticky BBC-result-inspired stamp with
  `Show Finished` / `Hide Finished`, and made assignment card bodies open the
  original task while preserving explicit buttons. Verified dashboard syntax and
  static references; browser smoke remains useful before publish.
- Split the student account STAR row into two adjacent counters: yellow for
  assigned-task stars and blue for self-study/library stars. Verified dashboard
  syntax and cache-version references; browser smoke remains useful before
  publish.
- Replaced finished Assignment card action text with clickable `PASSED` and
  `MASTERED` stamps. Verified dashboard syntax and cache-version references;
  browser smoke remains useful before publish.
- Simplified teacher Assign into a minimal two-panel multi-select flow: Work
  uses search plus Column, Students uses search plus Class, and assignment
  creation still uses the existing defaults and backend validation. Verified
  teacher syntax and release checks; static publish remains required.
- Expanded teacher matrix detail dialogs with latest-attempt wrong-answer
  comparisons and answer-view lock status from `teacherAdmin`. Verified teacher
  and function syntax, release checks, and rebuilt the local function package;
  static publish and `teacherAdmin` redeploy remain required.

### 2026-06-18

- Imported `NGSL-L` into project vocabulary content, leaving `NGSL-K` out for
  owner rework. Corrected two L word-form mismatches (`meter` and
  `restriction`), regenerated the static catalog, prepared ignored CloudBase
  import data, and verified public files omit answer/explanation fields, private
  grading source has 100 answers, each group's Word Bank order differs from
  answer order, release verification passes, and local browser loading works.
  Owner still needs to run CloudBase content import for authenticated
  Library/Explore and grading.
- Renumbered NAWL vocabulary units from the old NGSL-continuation sequence
  (`NAWL-S` through `NAWL-Z2`) to independent `NAWL-A` through `NAWL-J`,
  regenerated the static catalog, and documented the rule for future imports.
  Verified JSON/JS fallbacks, CloudBase prep output, release verification, and
  local browser loading for `NAWL-A` and `NAWL-J`. Owner still needs to import
  the regenerated CloudBase content data before authenticated Library/Explore
  and grading use the new set IDs.
- Added the front-end-only BBC `blue-studio` render theme and applied it to
  `BBC-250619` and `BBC-250626`. The shared `bbc.html` keeps existing blank,
  multiple-choice, submit, History/Clear, Explain, and Argue flows while adding
  themed Worksheet and current-lesson My Words entry points. Verified JSON
  parsing and static references; browser smoke remains useful before publish.
- Fixed My Words touch handling by suppressing native selection/callout behavior
  around the custom save button, preserving the captured selection before
  clearing mobile browser selection, and bumping the shared script cache version.
  Verified JavaScript syntax and static references; physical iOS/Android device
  smoke remains useful before publish.
- Reviewed and corrected NGSL/NAWL DOCX vocabulary sources for D/E/F/I/J in
  `/private/tmp/ngsl-corrected`. Verified corrected DOCX structure, answer
  coverage, prompt leak checks, and rendered all five files to PNG contact
  sheets. E/F/I/J are import-ready from the source-QA perspective; D still needs
  owner confirmation for duplicate source words before import.
- Imported corrected `NGSL-E`, `NGSL-F`, `NGSL-I`, and `NGSL-J` into project
  vocabulary content with public JSON/JS fallback files, regenerated
  `data/home-catalog.*`, and prepared ignored CloudBase import data. Verified
  public files have no answer fields, private grading source has 100 answers
  per set, HTTP loading succeeds, and `npm run verify:release` passes. Owner
  still needs to run the CloudBase content import before authenticated
  Library/Explore and grading use the new sets.
- Added teacher View matrix `Class`, numeric-select `Recent`, and `Column`
  filters, removed the top View summary cards, and kept clickable matrix cells
  that show the selected student's set records, attempt dates, durations,
  scores, and wrong-question answer summaries. Verified `teacher.js` syntax,
  `git diff --check`, and v11 resource tags.
- Refined the teacher View matrix so `Recent` defaults to 7, the toolbar has a
  `Date` basis selector, matrix student rows show names only, and wrong-question
  summaries include teacher-only correct answers from `teacherAdmin`. Verified
  `teacher.js` and `teacherAdmin` syntax; static publish and `teacherAdmin`
  CloudBase redeploy are still required.
- Updated teacher View matrix responsiveness and controls: the matrix scrolls
  horizontally inside the available screen width with a sticky student-name
  column, filters render as `Class`, `Column`, `Recent`, `Date`, date filtering
  supports this week/month/custom calendar ranges, and clicked cells open a
  closeable floating detail dialog. Verified `teacher.js` syntax and release
  checks; static publish is still required.
- Aligned student Assignment task capsules with the Library task card structure,
  including the same eyebrow/set-id/title/action layout while preserving status,
  score, teacher reply, and star actions. Verified `dashboard.js` syntax,
  `git diff --check`, and local v8 asset requests.
- Updated Library card eyebrows to show `ielts-reading` / `ielts-listening`
  explicitly and simplified the student account panel: removed the separate
  achievement card and account heading, moved stars into the profile rows,
  changed independent practice to `Finished`, and made password/logout actions
  low-noise text buttons. Verified dashboard/teacher syntax, `git diff --check`,
  and local v7 asset requests.
- Removed the yellow `C7` IELTS badge from student and teacher Library task
  cards, kept BBC year badges, and restyled the Library sub-tab layer as yellow
  capsule buttons. Verified `dashboard.js`/`teacher.js` syntax, `git diff --check`,
  and local v6 asset requests.
- Replaced the student Assignments achievement drawer summary with a compact
  `Finished` completion button showing a completion SVG and total finished
  count; expanded state now goes straight to the finished task list. Verified
  `dashboard.js` syntax, `git diff --check`, and local dashboard smoke.
- Standardized student and teacher Library sorting: BBC cards now follow
  release date from earliest to latest, and IELTS cards follow Cambridge book,
  Test, then Section/Passage order. Regenerated `home-catalog` and bumped
  dashboard/teacher cache versions; verified syntax, catalog order, and local
  dashboard/teacher browser smoke.
- Expanded teacher View progress around `By student`, `By class`, and `By task`;
  removed Open/Watch status labels, added low-to-high task score bars and
  clickable single-assignment details, and added scoped due/pass/mastery editing
  for existing assignments. Verified `teacher.js` and `teacherAdmin` syntax,
  ran release verification, rebuilt `deploy-packages/teacherAdmin.zip`, and
  smoke-tested local `teacher.html`; CloudBase still needs the rebuilt
  `teacherAdmin` function package deployed.
- Unified student and teacher Library task capsules; added IELTS book badges,
  BBC year badges, and DSE labels without Paper numbers. Moved student STAR
  counters into the account panel, changed My Words to a vocabulary-list layout,
  simplified the Assignments achievement drawer around a gold completed count,
  and added class filtering plus mobile-friendly scrolling to the teacher View
  matrix. Verified `dashboard.js` and `teacher.js` with `node --check`; browser
  smoke is still needed.
- Fixed BBC practice feedback states so not-passed submissions still mark wrong
  questions without revealing answers; History refills editable answers while
  showing Explain/Argue only when backend feedback is available; Clear removes
  visible feedback/actions and MC locks now persist only as yellow reminders.
  Verified inline script parsing with Node and ran `git diff --check`; browser
  smoke with an authenticated student session is still needed.
- Changed Vocabulary default thresholds to 80% passing and 100% mastery across
  CloudBase set generation and backend fallback logic. Verified cloud function
  syntax, regenerated local private import output, checked all 23 generated
  vocabulary sets are 80/100 while non-vocabulary sets remain 50/90, rebuilt the
  affected function ZIPs, and ran release verification. CloudBase: deploy
  `getDashboard`, `submitAttempt`, and `teacherAdmin`; update existing
  Vocabulary `sets` records if they already contain old 50/90 values.
- Added a failed Vocabulary Test `Choose Again` action that clears the current
  questions, local draft, timer, and summary, then returns the student to group
  selection for a fresh start. Verified the `vocabulary.html` inline script
  parses with Node, exercised the failed-result restart path with a DOM stub,
  and ran `git diff --check`; browser smoke is still needed.
- Refactored the student dashboard navigation to `Assignments`, `My Words`,
  and `Library`; moved account actions and teacher replies to the top-right
  chip/message controls; added a collapsed `Finished & Wins` drawer focused on
  completed-count achievement. Refactored the teacher desk to `Tasks`, `View`,
  and `Library`; moved Review under Tasks, changed Updates into a notification
  bell, and added a progress matrix to View.
- Verified `assets/js/dashboard.js` and `assets/js/teacher.js` with
  `node --check`, ran `git diff --check`, and browser-smoked the teacher page
  locally with an existing teacher session: `Tasks`, `Tasks > Review`, `View`
  matrix, notification bell, and teacher account panel loaded without console
  errors. Student browser smoke with a real student session is still needed.
  CloudBase: no deployment or data import required; publish the static site for
  the UI/cache-bump change.

### 2026-06-17

- Restored Teacher Library practice items to compact task capsules while
  keeping the 3-tab, sub-tab, search, and year filtering behavior. Verified
  `teacher.js` syntax and browser-smoked a dedicated teacher session locally:
  Library rendered `teacher-library-card` capsules with `Open` actions and no
  residual `menu-card` items. Static publish is required for the UI/cache-bump
  change.
- Added Cambridge book sub-tabs to the student and teacher Library views for
  IELTS Reading and IELTS Listening. Verified locally in visitor mode that
  IELTS Reading shows `C7` and `C8`, defaults to `C7`, and lists 12 C7 Reading
  passages; IELTS Listening shows `C7` and `C8`, defaults to `C7`, lists 16 C7
  Listening sections, and switches to C8 correctly.
- Verified `assets/js/dashboard.js` and `assets/js/teacher.js` with
  `node --check`. CloudBase: no deployment or import performed; publish the
  static site for the Library UI change.

### 2026-06-16

- Imported Cambridge IELTS 8 Academic Reading/Listening Test 1 and Test 2:
  added 6 Reading passage sets, 8 Listening section sets, matching C8 listening
  mp3 assets, static catalog entries, and local private grading source/import
  data. Verified C8 public runtime JSON parses, all 14 C8 sets have complete
  private grading coverage, public C8 data contains no answer/explanation
  fields, catalog entries are present, and the copied audio files exist.
- Imported Cambridge IELTS 8 Academic Reading/Listening Test 3 and Test 4:
  added 6 Reading passage sets, 8 Listening section sets, matching C8 listening
  mp3 assets, and two public question-image assets for the Test 4 map/diagram
  tasks. Verified all C8 Test 1-4 catalog/import records are present, T3/T4
  public runtime JSON has complete private grading coverage, public data
  contains no answer/explanation fields, copied audio files exist, and release
  verification passes with only the expected dirty-worktree warning.
- CloudBase: after publishing the static site, import the regenerated
  `.cloudbase-private/import/sets-cloudbase.json` and
  `.cloudbase-private/import/grading-keys-cloudbase.json` so authenticated
  Library/Explore and server grading can see the C8 sets.
- Added owner-run CloudBase CLI content import helper:
  `npm run cloudbase:import:content` dry-runs by default and
  `-- --apply` writes insert-missing records to `sets` and `grading_keys`.
  Verified help output, dry-run counts, release verification, and whitespace
  checks. CloudBase: no apply/import command was run by the agent.
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
- Verified NAWL units JSON/JS fallback files parse, are listed in
  the static home catalog, and the final NAWL unit renders locally with 63 words and 6
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
