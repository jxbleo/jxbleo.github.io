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

Future agents should look for the test-login setup in the repository root:

- Local file: `.qa-secrets.local` (ignored by Git; do not print values)
- Template file: `.qa-secrets.example`
- Keys: `MR_CAT_TEST_BASE_URL`, `MR_CAT_TEST_TEACHER_ID`,
  `MR_CAT_TEST_TEACHER_PASSWORD`, `MR_CAT_TEST_STUDENT_ID`,
  `MR_CAT_TEST_STUDENT_PASSWORD`

Useful search command:

```bash
rg -n "MR_CAT_TEST|qa-secrets|TEST_TEACHER|TEST_STUDENT" -S . .gitignore AGENTS.md AGENT_TODO.md
```

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
- [ ] Plan a safe CloudBase content de-duplication pass. Read-only checks on
      2026-06-20 showed 395 visible `sets` and 411 `grading_keys`, more than
      the 106 generated records, likely from repeated console imports. Do not
      delete duplicates without backup and owner approval.

## Done

### 2026-07-25

- Fixed the BBC yellow `classroom-worksheet` grid so Show Answers,
  History/Explain, dispute status, and action controls span both columns rather
  than collapsing into the narrow number column on phone/iPad.
- Renamed all student-visible Vocabulary Cloze completion actions from `Redo`
  to `Retry`, including the top sticky action, inline practice action, and
  confirmation copy. Internal selectors and reset behavior are unchanged.
- Updated grading defaults to Vocabulary `90/100` and BBC `80/95` across
  Teacher, backend grading/dashboard fallbacks, and generated CloudBase data.
  Replaced Assign/edit number inputs with a shared touch-inertial percentage
  wheel. Owner action after static publish: deploy `teacherAdmin`,
  `submitAttempt`, and `getDashboard`, then review/apply the documented
  `sets,system_config` overwrite import. Existing assignments remain unchanged.
- Restored native iPhone/iPad long-press selection highlighting for My Words.
  The shared selection script no longer clears the browser range after capture,
  while the save button still protects the captured text and suppresses the
  duplicate synthetic click. Bumped all shared script references; JavaScript
  syntax and release checks passed. Physical iPhone/iPad smoke testing remains
  useful before publish; no CloudBase deployment or content import is required.
- Removed the redundant counted-result suffix from Vocabulary Cloze Test
  options and repaired the phone-only Practice chip scroller collapse. Mobile
  numbered chips now retain a complete 40px capsule inside a 48px horizontal
  scroll area; tablet and desktop sizing remains unchanged.
- Renamed the student-facing counted Cloze path from `Test` to `Quiz` and its
  action to `Start Quiz`, then aligned the visible dialogs and status copy.
  Backend session actions and stored `vocabulary_test` modes remain unchanged.

### 2026-07-15

- Audited all 27 commits from 2026-07-14 through 2026-07-15 and consolidated
  their current behavior into dated changelog sections, frontend architecture,
  UI, technical decisions, testing, and backlog documentation. Reconciled the
  stale Student Library note with the shipped title-inline category popover and
  documented `my-words-modal-preview.html` as an unlinked sample-only design
  reference. Verified the prototype's inline JavaScript, search interaction,
  desktop/390px layout, horizontal overflow, console, secret/network scan, and
  release checks. No CloudBase deployment or data import is required.
- Added My Words-style browser pronunciation to Vocabulary Learn cards and
  Spell rows. The Spell control speaks without revealing/filling the answer and
  uses a neutral accessible label. Static syntax, structure, desktop, and phone
  checks passed. No CloudBase deployment or content import is required; publish
  the static site.
- Made the Teacher View matrix responsive and user-resizable with `−`, `Fit`,
  and `+`. Phone portrait now fits the normal six-to-seven-task overview using
  compact task IDs and score cells, while desktop keeps comfortable columns;
  explicit size choices persist locally. Updated UI/test documentation and
  cache versions. No backend, CloudBase deployment, or content import is
  required.
- Routed Teacher View matrix task headers through the shared practice-entry
  confirmation so an accidental click no longer leaves the matrix. Confirming
  opens the existing `teacher=1` preview; Close, Escape, or backdrop dismissal
  stays in View. Updated the UI/test specifications and bumped the Teacher JS
  cache version. Verified JavaScript syntax, diff whitespace, release checks,
  and the authenticated local Teacher View: the matrix stayed on its original
  URL when the dialog opened or closed, and Enter issued the expected
  `teacher=1` practice URL with the View return target. No backend, CloudBase
  deployment, or content import is required.
- Reduced the Teacher Student lookup dialog to three-quarters of its former
  desktop width/height, replaced the internal top-right `x` with an external
  lower `Close`, and simplified student finding to `Choose` plus a magnifying
  glass that swaps Choose in place for live search. Removed Confirm because a
  student row now completes selection directly. Closing Create student by its
  close control, backdrop, or Escape restores the parent lookup with the prior
  selection intact. Verified JavaScript syntax, diff whitespace, authenticated
  desktop and 390px browser layouts, live filtering/direct selection, all
  create-modal return paths, no horizontal overflow, zero console errors, and
  release verification. No backend, CloudBase deployment, or content import is
  required.

### 2026-07-14

- Unified all Teacher top-level dialogs on a page-level modal root so Review,
  Student lookup/create/success, Assign Work/Student pickers, and dynamic View
  matrix details stay fixed to the current viewport instead of centering within
  the backdrop-filtered workspace. Added dynamic-viewport height limits and
  internal scrolling for tall dialogs. Verified Work, Student, Review, Student
  lookup, Create student, notification, matrix/student progress, assignment
  editor, and practice-entry dialogs through the authenticated local Teacher
  page at desktop and 390px widths; a matrix detail also stayed viewport-fixed
  at page scroll 900. JavaScript syntax, whitespace checks, runtime console, and
  release verification pass. No backend, CloudBase deployment, or content
  import is required.
- Moved the Teacher notification surface out of the backdrop-filtered workspace
  so the bell opens its message card in the current viewport instead of far down
  a tall page. Teacher entry now treats stale `?view=tasks` as `View`, while the
  explicit `?view=library` practice-return route remains supported. Verified
  JavaScript syntax, static routing/overlay structure, release verification,
  viewport-fixed placement at page scroll 0 and 1100, and desktop/390px layouts
  without horizontal overflow. No backend, CloudBase deployment, or content
  import is required.
- Simplified the Teacher View entry so it begins directly with the progress
  matrix: removed the top-left wordmark and the repeated `TEACHER` / `View` /
  `New assignment` block and shortcut behavior. Aligned the header glass with
  the workspace frame, matched the sidebar's inner corner to the outer curve,
  and removed the matrix's contrasting top accent tip. Verified JavaScript
  syntax, static structure, CSS balance/diff whitespace, release verification,
  exact header/workspace edge measurements, rounded-corner rendering, and zero
  page overflow at desktop and 390px widths. No backend, CloudBase deployment,
  or content import is required.
- Refined the student bell modal into a shorter `Assignments` card with one
  external lower `Close` pill, removed both former in-card close controls, and
  added red right-side `TO DO` / failed-score pills while keeping only passed
  or mastered assignments in `FINISHED`. Updated UI and test specifications;
  no backend, CloudBase deployment, or content import is required.
- Replaced the student Dashboard's top-left wordmark with an unframed animated
  line-art cat SVG, removed the `STUDENT WORKSPACE` eyebrow, and made the
  smaller time-aware greeting a single line with overflow-only movement and a
  reduced-motion ellipsis fallback. Updated the UI and test specifications.
  Verified JavaScript syntax, CSS brace balance, diff whitespace, release
  verification, authenticated desktop and 390px browser layouts, zero mobile
  page overflow, correct accessible branding, and zero console errors. No
  backend, CloudBase deployment, or content import is required.
- Refined the student Dashboard header and bell message rows without changing
  assignment state or practice navigation. The header brand is quieter, its
  glass capsule now aligns exactly with the workspace card, bell task labels
  normalize to `BBC` / `IELTS`, and only overflowing task titles use a gentle
  one-line scroll with a reduced-motion ellipsis fallback. Updated the UI and
  testing specifications. Verified JavaScript syntax, diff whitespace, release
  verification, an authenticated dev-student bell at desktop and 390px widths,
  confirmation-dialog return behavior, zero page overflow, and zero console
  errors. No CloudBase deployment or content import is needed.
- Implemented the owner-approved authenticated spatial workspace layout while
  leaving login, public Library, and every practice runtime unchanged. Student
  Dashboard now keeps the brand in the header, uses one static China-time-aware
  greeting, presents welcome/progress as a responsive two-pane workspace, and
  places Library search plus `Practice` / `Exam` beside the Library heading with
  a two-column desktop card grid. Teacher now uses the `View` / `Assign` /
  `Library` sidebar and exact workspace headings, removes the standalone greeting
  hero, preserves the existing View matrix and its `Class` / `Column` / `Date`
  filters, and keeps the approved hybrid Assign summaries, task-parameter matrix,
  and all existing picker/management dialogs. `New assignment` switches views
  without a write or selection reset, and `?view=tasks|library` now survives a
  reload. Updated the UI/UX specification and testing checklist. Verified
  JavaScript syntax, CSS brace balance, diff whitespace, release verification,
  visitor and authenticated student/teacher desktop layouts, 390px responsive
  layouts, search focus restoration, URL/view restoration, and zero page console
  errors. A controlled dev-account test created one non-STAR assignment, confirmed
  it in the student's To Do list, then soft-cancelled it and confirmed the student
  totals returned to their original values. No CloudBase function deployment or
  content import is required; the changed static files still need normal publish.

### 2026-07-13

- Applied the approved neutral Liquid Glass system shell to login, public
  Library, student Dashboard, and Teacher surfaces without moving existing
  controls or changing business logic. Practice runtimes remain excluded.
  Verified asset scope, JavaScript syntax, diff whitespace, desktop login,
  visitor Dashboard and My Words behavior, 390px login/Library/Dashboard width,
  and zero page console errors. Authenticated Teacher visual smoke remains for
  the next publish check; no CloudBase deployment or data import is required.
- Replaced the yellow BBC `classroom-worksheet` theme's boxed, two-column MC
  options with the owner-selected open-row design: one full-width column,
  circular A-D markers, and a soft teal surface only on hover/selection. Kept
  fill-in styling, other BBC themes, grading, answer locks, and result states
  unchanged. Verified inline script syntax, CSS scope, desktop/mobile layout,
  option selection, and zero browser console errors. CloudBase: no deployment
  or data import required; static publish is required.

### 2026-06-24

- Implemented the selected teacher View `By student` expanded layout: a
  full-width student history list with task best percentage fixed on the far
  right. Each task opens the same independent matrix detail modal used by top
  matrix cells. Verified teacher JavaScript syntax, diff whitespace, cache
  references, and related UI/test documentation.

### 2026-06-23

- Fixed student and teacher practice-entry dialogs so `Enter` closes the dialog
  before opening the practice page, and `pageshow` clears restored dialogs when
  browser Back returns from practice. Verified dashboard and teacher JavaScript
  syntax plus static cache references.
- Added BBC MC option click feedback with only a soft bell sound and right-side
  `✦` marker. Confirmed the default and blue BBC render themes share the
  behavior, with the blue theme marker following the blue accent color.
- Fixed the shared practice Back confirmation so it hides before calling
  browser history navigation. This prevents Vocabulary Test Mode's popstate
  lock from leaving the Back dialog visible when the page correctly stays on
  the test. Updated shared practice-session cache versions and verified static
  checks.

### 2026-06-22

- Fixed Vocabulary Learn `NO_GRADED_QUESTIONS` for NGSL/NAWL units whose
  generated `grading_keys.answers` were empty by deriving missing private
  answers from quiz `wordList` order during CloudBase data preparation. Added
  an `--ids` filter to the CloudBase import helper so the owner can overwrite
  only reviewed affected grading keys. Verified regenerated private import data
  has no empty Vocabulary answer maps, dry-ran targeted import, ran release
  verification, and checked diff whitespace. After the owner applied the
  targeted CloudBase `grading_keys` overwrite, verified with development
  student and teacher accounts that NGSL-C Learn `Check Answer`, sampled
  affected NGSL/NAWL Learn sets, and teacher Library preview `Show Answers`
  return answers without the `NO_GRADED_QUESTIONS` dialog.
- Simplified the teacher View matrix filters to `Class`, `Column`, and `Date`,
  removed the `Recent` numeric limit, and kept `Date` defaulted to `This
  month`. Verified teacher JavaScript syntax, static references, and diff
  whitespace.
- Adjusted teacher View matrix status cells so `Not yet` is neutral white,
  while `Passed` and `Mastered` share the same green cell background and
  `Mastered` uses the selected solid green circle with a white star. Verified
  release checks and diff whitespace; owner still needs to publish the static
  site.
- Fixed BBC History coloring after Argue/backfill score adjustments by forcing
  history rendering to clear stale `wrong`, blank-lock, and MC-lock classes
  before applying the server-returned `correct`/`wrong` state. Verified release
  checks and diff whitespace; owner still needs to publish the static site.
- Fixed teacher bell notification routing for second/third attempts by making
  View matrix date filtering include each linked attempt's submitted date, not
  only the assignment summary date. Verified release checks and diff
  whitespace; owner still needs to publish the static site.

### 2026-06-21

- Moved the student Assignments navigation count badge outside the glass tab so
  the red number is no longer clipped, and strengthened the `Show Finished`
  capsule with a brighter golden glow. Verified static CSS checks and diff
  whitespace; logged-in visual smoke remains useful before static publish.
- Simplified the student account panel footer to two small quiet capsules for
  `Change password` and `Log out`, and removed the visible `Password change
  required` field from the account panel. Verified dashboard JavaScript syntax,
  cache-version checks, and diff whitespace.
- Nudged the student Personal Center close button slightly upward/right and
  removed the extra divider under the `Finished` profile row so the footer has
  a single clean line. Verified dashboard JavaScript syntax and diff
  whitespace.
- Applied the selected golden-ribbon `Show Finished` interaction: collapsed
  state stays bottom-docked, expanded state becomes page content with a sticky
  top capsule and ribbon reveal. Moved account-panel stars onto the name row
  and normalized profile row/divider spacing. Verified dashboard JavaScript
  syntax, static cache-version checks, and diff whitespace.
- Changed practice return controls from `Home` to `Back` with a shared
  leave-page confirmation and one-page browser-history return falling back to
  `dashboard.html`. Updated BBC, Vocabulary, IELTS Reading, and IELTS Listening
  practice-session cache versions and verified static checks.
- Tightened the teacher View matrix's left student-name column so it sizes to
  the visible names, and added a visible Close button to the BBC Argue
  sent/thanks dialog for both student and teacher-preview paths. Verified
  teacher JavaScript syntax, targeted static references, and diff whitespace.
- Applied the selected teacher View matrix status treatment: orange hollow
  circle for `Not yet`, green check for `Passed`, and glowing gold star for
  `Mastered`. Updated teacher asset cache versions and verified static checks.
- Fixed BBC History when a student opens a previously attempted set from
  Library without assignment/history URL context. Added a student-owned
  `getDashboard.getLatestAttemptForSet` lookup, taught `bbc.html` to hydrate
  `historyAttemptId` from it, and returned resolved `assignment_id` from
  `submitAttempt` for Library-bound assignment submissions.
- Added automatic upward-only historical Argue regrading for teacher
  `add`/`replace` decisions. Matching same-set, same-question, same-answer old
  attempts can now improve assignment summaries and STAR records. Verified
  backend syntax and release checks; owner still needs to deploy
  `teacherAdmin.zip`.
- Added the teacher-only paginated `backfillAcceptedAnswerRegrades` action for
  older approved grading-key changes. It can dry-run or apply current-key
  upward repairs in batches and still requires owner-triggered deployment plus
  authenticated teacher execution.
- Added front-end-only Vocabulary Test locking: start warning dialog, disabled
  non-Test mode tabs during the timer, browser leave/back warning, manual
  submit confirmation, time-up auto-submit, and red wrong-question marking
  after the result modal. Backend timing validation was intentionally not added
  because students may take unlimited fresh Vocabulary Tests.
- Refined Vocabulary Test review: the result modal now has only one Close
  action, wrong answers reveal inline explanations, and Redo is a separate
  confirmed clear action from the reviewed test page. `submitAttempt` now
  returns Vocabulary Test feedback after submission so recorded failed tests
  can show the same explanations.

### 2026-06-20

- Updated the student dashboard top billboard to use the approved Option A
  pale aurora-rainbow animated background without changing its greeting text,
  copy, chips, or layout. Verified syntax and diff whitespace; logged-in
  visual smoke remains useful before static publish.
- Standardized message and unread reminder indicators to red across student and
  teacher surfaces, including tab notices, top-right counts, and teacher unread
  activity dots. Verified static CSS checks and diff whitespace.
- Applied the approved Option A soft liquid-glass treatment to the student main
  navigation capsule and the student Library category capsule, scoped away from
  teacher tabs. Verified syntax and diff whitespace; logged-in visual smoke
  remains useful before static publish.
- Changed the student Assignments finished drawer entry from a sticky stamp to
  a lower-positioned gold capsule matching the Library badge style, with
  `Show Finished` / `Hide Finished` text and no count. Verified JavaScript
  syntax and diff whitespace; logged-in visual smoke remains useful before
  static publish.
- Fixed backend assignment binding for Library submissions: `submitAttempt`
  now auto-resolves the student's open assignment for the same `set_id` when a
  practice page submits without `assignment_id`. This should make those
  attempts move the assignment to FINISHED and appear in teacher View matrix
  after `submitAttempt` is deployed.
- Hardened backend progress reads and assignment summaries: `teacherAdmin`,
  `getDashboard`, and `getResources` now page through CloudBase reads instead
  of trusting fixed first-page limits; `submitAttempt` recomputes assignment
  summary fields from linked attempts after recording an assignment attempt; and
  teacher View progress can derive finished status from linked attempts when
  stored assignment summary fields are stale. Owner must deploy updated
  `submitAttempt`, `teacherAdmin`, `getDashboard`, and `getResources` packages.
- Confirmed with dedicated QA teacher/student accounts that a newly assigned
  `BBC-250529` task opened from the student Library without an `assignment`
  URL parameter records a passed attempt, moves from student Assignments to
  Finished, and appears in teacher View groupings. Found and fixed a frontend
  matrix display cap that hid students beyond the first 12 sorted rows; after
  the fix, the View matrix directly showed the student row with a `50%`
  passed cell. Verified `teacher.js`, cloud function syntax, diff whitespace,
  and `npm run verify:release`.
- Updated the teacher create-student flow to use a vertical modal form and a
  checkmark success dialog with the new Login ID, renamed the teacher Tasks tab
  to Assign, changed the Review entry to a question-mark icon, and simplified
  Assign so work/student search and filters live in standalone picker dialogs.
- Verified `assets/js/teacher.js` syntax, diff whitespace, and duplicate IDs in
  `teacher.html`. Local static server started but could not be reached from a
  separate command session in this environment, so browser smoke remains useful
  before static publish.
- Investigated why `BBC-250529`, `BBC-250605`, and `BBC-250612` did not appear
  in teacher Assign. Static `data/home-catalog.*`, public data, audio, and local
  `.cloudbase-private/import/sets-cloudbase.json` / `grading-keys-cloudbase.json`
  include the three lessons, but CloudBase import is still required for real
  assignment. Updated teacher Assign to merge catalog-only missing items as
  disabled import-required rows and bumped `teacher.html` asset versions.
- Follow-up on whether the three BBC lessons had already been deployed: repo QA
  notes from the import commit explicitly said the owner still needed static
  publish and CloudBase content import. A direct read-only `tcb` query for the
  three `set_id`s could not confirm live CloudBase state because this local CLI
  session has no valid CloudBase identity. The observed old Assign behavior is
  still consistent with CloudBase `sets` missing those records or stale static
  cache, not with a confirmed function-package deployment issue.
- Root cause summary: static publication, CloudBase function packages, and
  CloudBase content data are separate release layers. The three BBC lessons were
  added to static files and local import output, but teacher Assign used
  CloudBase `sets` as its assignable source and did not merge catalog-only
  missing records. When CloudBase `sets` / `grading_keys` were not confirmed in
  the live environment, the lessons were invisible instead of shown with an
  import-required state. The fix is to merge static catalog fallback rows into
  Assign and keep them disabled until CloudBase content import is complete.
- Final diagnosis after owner import: read-only CloudBase queries confirmed the
  three BBC `sets` and `grading_keys` are present, but duplicate/imported
  content pushed the live environment to 395 visible `sets` and 411
  `grading_keys`. Deployed `teacherAdmin.listSets` only read the first 200
  visible sets, so these BBC lessons could still be treated as catalog-only.
  Raised teacherAdmin content read limits to 1000 and rebuilt
  `deploy-packages/teacherAdmin.zip`; owner must deploy that function package.
- Resolution confirmed: after the owner deployed the rebuilt `teacherAdmin`
  package, the three BBC lessons became assignable. Future imports should check
  three layers separately: static catalog visibility, CloudBase `sets` /
  `grading_keys` presence, and the deployed `teacherAdmin` content read limit.
  If Assign shows `Import to CloudBase` while CloudBase records exist, suspect a
  stale teacherAdmin deployment or content-read pagination/limit issue before
  re-importing data again.

### 2026-06-19

- Updated the student login page to the floating-paper welcome design with a
  minimal central quote, light green motion elements, `Sign in`, and concise
  view-only visitor copy. Verified login JavaScript syntax and diff whitespace;
  browser visual smoke is still useful before static publish.
- Corrected the Teacher Library BBC year-badge misunderstanding: BBC task
  capsules should not show gold year badges, and the teacher BBC column should
  not expose year sub-tabs unless the owner explicitly asks to restore them.
  This supersedes older notes that mentioned keeping BBC year badges.
- Lesson learned for missing Teacher Library content: do not assume
  `teacherAdmin.zip` redeploy is the fix. First check static publish/cache
  (`teacher.html` script version and `home-catalog`), then CloudBase `sets` and
  `grading_keys` import state, then teacher Library filters/fallback behavior,
  and only consider cloud function redeploy when the function logic itself
  changed or returns stale data.
- Fixed teacher Library display fallback so it merges visible static
  `home-catalog` items missing from CloudBase `sets`, allowing newly published
  lessons to be previewed while CloudBase import state is checked. Verified
  teacher JavaScript syntax, release checks, and diff whitespace; static publish
  required.
- Moved teacher Review out of Tasks into a top-right icon button and standalone
  modal with Pending, Approved, and Rejected tabs. Removed the old Tasks Review
  entry and kept notification Review rows opening the modal. Verified
  `teacher.js` syntax, searched for stale Tasks Review entry points, ran
  `git diff --check`, and ran release verification. Local browser loaded the
  updated teacher assets, then redirected to `index.html` because localhost had
  no active teacher login state; visual smoke still needs an authenticated
  teacher session after static publish.
- Changed the teacher notification bell to a standalone attempts-only modal,
  removed Review items and filter buttons from that feed, and made each attempt
  row open View with the matching matrix cell and attempt highlighted. Reversed
  the header `+` button to the same light/purple style as the other header
  icons. Verified `teacher.js` syntax, stale Review-in-bell searches, and diff
  whitespace, then ran release verification; authenticated visual smoke is
  still needed.
- Reviewed three incoming BBC listening practice drafts from the desktop BBC
  folder against their transcripts and audio assets, created a revised
  teacher-review copy outside the repo at `/private/tmp`, lengthened
  student-facing evidence quotes, synced the revised review draft back to the
  owner's `testing.md`, imported `BBC-250529`, `BBC-250605`, and `BBC-250612`
  with blue-studio rendering and private local grading sources, regenerated the
  static catalog and CloudBase import output, and verified question counts,
  public answer stripping, grading-key coverage, release checks, and local
  browser loading. Owner still needs static publish and CloudBase content import.
- Moved teacher student-account creation to a single top-right header `+`
  beside notifications, removed the Personal Center/View inline creation
  entry, and made the form a standalone modal. Verified JavaScript syntax and
  release checks; static publish required.
- Refined teacher View matrix detail dialogs: centered the external Close
  button, capped attempt bar width so a single attempt does not stretch full
  width, and mapped bar colors to amber not-passed, green passed, and gold
  mastered. Verified JavaScript syntax and release checks; static publish
  required.
- Simplified the matrix score-lock pill so unlocked scores show no icon and
  locked scores show a lock next to the best score. Verified JavaScript syntax
  and release checks; static publish required.
- Redesigned teacher View matrix detail dialogs with a title-only header,
  student and lock/best-score pills, clickable attempt score bars, external
  Close button, and newest-first attempt cards that list only wrong answers.
  Verified JavaScript syntax and release checks; static publish required.
- Shortened the practice-entry dialog not-passed ribbon to `Not yet` without a
  best-score field; passed and mastered states keep best-score reminders.
  Verified JavaScript syntax and diff checks; static publish required.
- Replaced task-entry browser confirmations with the shared custom entry dialog
  for student Assignment cards, student Library cards, and teacher Library
  cards. It shows task title, `Enter`, external `Close`, and status/best-score
  reminders. Verified JavaScript syntax and diff checks; static publish
  required.
- Moved the teacher create-student `+` shortcut into the top-right Personal
  Center action cluster, centered the panel title, and removed the Teacher
  Account heading/status row. Verified JavaScript syntax and release checks;
  static publish required.
- Added task names under task IDs in the teacher View matrix header and widened
  task columns slightly so the extra line remains readable with horizontal
  scrolling. Verified JavaScript syntax and release checks; static publish
  required.
- Aligned teacher Assign Work-list sorting with the matching Library column
  rules, so filtered columns use natural date/numeric ordering instead of raw
  backend title order. Verified JavaScript syntax and release checks; static
  publish required.
- Removed visible `Go` entry buttons from student Assignment, student Library,
  and teacher Library capsules. The whole capsule now opens the practice item,
  while explicit secondary controls such as Teacher replies and Get Star keep
  their own click behavior. Verified JavaScript syntax and release checks;
  static publish required.
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
  cards, kept BBC year badges at that time, and restyled the Library sub-tab
  layer as yellow capsule buttons. BBC year badges were later removed per owner
  preference. Verified `dashboard.js`/`teacher.js` syntax, `git diff --check`,
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
  BBC year badges at that time, and DSE labels without Paper numbers. BBC year
  badges were later removed per owner preference. Moved student STAR counters
  into the account panel, changed My Words to a vocabulary-list layout,
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
  Vocabulary `sets` records if they already contain old 50/90 values. Historical
  note: this 2026-06-18 rule was superseded on 2026-07-25 by Vocabulary 90/100
  and BBC 80/95.
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
