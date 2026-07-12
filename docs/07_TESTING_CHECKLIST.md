# 07 Testing Checklist

> Manual and lightweight automated checks for this project.
> Update it when flows, data model, deployment, or testing tools change.

## 1. Current Test Reality

There is no full automated test suite yet.

Current verification uses:

- JavaScript syntax checks
- JSON parse checks
- local static server browser checks
- CloudBase development environment tests
- manual teacher/student flows

## 2. Quick Local Checks

Run after JavaScript changes:

```bash
find cloudfunctions -name index.js -exec node --check {} \;
node --check assets/js/teacher.js
node --check assets/js/dashboard.js
node --check assets/js/practice-session.js
```

Run after catalog/content changes:

```bash
node scripts/build-home-catalog.js
node scripts/prepare-cloudbase-data.js
```

Then parse changed JSON files or run a small JSON parse check.

## 3. Local Browser Smoke

Use a local HTTP server rather than `file://`:

```bash
python3 -m http.server 8000
```

Open:

- `http://127.0.0.1:8000/index.html`
- `http://127.0.0.1:8000/dashboard.html`
- `http://127.0.0.1:8000/teacher.html`
- at least one BBC page
- at least one IELTS Reading page
- at least one IELTS Listening page
- at least one Vocabulary page

Practice navigation checks:

- clicking a completed-task capsule in the Dashboard four-week board opens the
  shared entry confirmation, and `Enter` opens that completed task with a safe
  Dashboard return target
- opening a task from Dashboard Assignments appends a safe `return` target and
  the practice `Back` control returns to Dashboard Assignments
- opening a task from Dashboard Library appends a safe `return` target and
  the practice `Back` control returns exactly one history step to the existing
  Dashboard Library instance, preserving its selected sub-filter, search,
  scroll position, and avoiding a second dashboard data load when bfcache is
  available
- opening a practice URL directly, or with a referrer path that does not match
  its safe `return` target, makes `Back` use the validated URL fallback instead
  of arbitrary older browser history
- opening a teacher preview from Teacher Library returns to
  `teacher.html?view=library`
- practice `Home` goes to `dashboard.html` for students/visitors and Teacher
  Library for `teacher=1`
- BBC and Vocabulary shared practice pages show both `Back` and `Home`; IELTS
  Reading and IELTS Listening show both controls in the exam top bar
- static practice data requests use the public app-version query, not
  timestamp cache busting such as `?_=` + `Date.now()`
- IELTS Reading shows the set code only in the black exam bar, reduces paragraph
  matching choices to letters, resizes typed blanks with their content, and
  restores passage/question highlights after submission or reload; `Clear` and
  `Clear All` remove the expected saved highlight records
- Vocabulary 5+ group countable Test still abandons the active server session
  on page hide/leave and must not be restored as an ordinary draft

For BBC pages with worksheet PDFs, verify the top-corner `Download Practice`
link returns HTTP 200 for the current set's PDF, and render at least one
representative generated PDF page to confirm it contains no answer key or
explanation text.

Stop the server after testing.

## 4. Student Flow Checklist

Use a dedicated development student account, never a real student account.

Check:

- login succeeds
- profile loads
- opening `Change password` from the account panel shows the password dialog
  above the account panel
- forced password change appears when expected
- the lower dashboard navigation shows only `Library`
- the top-right bell opens `TO DO` and finished assignment messages
- the student bell uses the same SVG bell design as the teacher bell
- the notebook icon sits immediately to the right of the bell and opens My
  Words in an independent modal
- scrolling the My Words modal, closing it, and reopening it restores the prior
  internal scroll position
- neither Assignments nor My Words appears as a lower navigation entry
- student opens assigned work
- opening a finished Vocabulary assignment from `Show Finished` lands on
  Vocabulary Learn like Library entry, not automatic Test/History mode
- student opens the same assigned set from Library, submits, and the backend records it against the open assignment
- BBC History works when the student opens a previously attempted set from
  Library without `history` or `assignment` URL parameters
- cancelled assigned work no longer appears in student To Do or Finished
- an old cancelled `assignment_id` URL cannot record a new assignment attempt
- prior attempts for a cancelled assignment remain visible through set-level
  History when the student opens the same set from Library
- student submits wrong/low score
- attempt is stored
- assignment remains or becomes `to_do`
- student retries and passes
- assignment appears in `FINISHED`
- low-score retry after passing does not downgrade assignment
- reveal answers works only after passing
- reveal locks mastery only when not already mastered
- mastered work creates backend STAR
- assignment with `mastery_enabled: false` can pass but does not become
  mastered or create a new STAR on later submissions
- Vocabulary countable tests use `80%` passing and `100%` mastery by default
  unless the set or assignment explicitly overrides thresholds
- new Assign-created assignments default to `mastery_enabled: false`; after the
  teacher selects `Earn STAR` during Assign or turns `Can earn STAR` on from
  View, a later qualifying submission can become mastered / STAR
- a not-passed Vocabulary Test result can return to group selection and start
  a fresh test without keeping the previous questions or local draft
- history review does not leak answers unless reveal is recorded

## 5. Teacher Flow Checklist

Use a dedicated development teacher account.

Check:

- teacher page loads only for teacher profile
- list students works
- create student checks duplicate Login ID
- create student uses the vertical modal form and shows the checkmark success
  dialog with the Login ID after creation
- reset password enables auth user and sets `must_change_password`
- deleting a student account removes the CloudBase Auth end user, hides the
  student from Students, Assign candidates, View progress, activity attempts,
  and Argue lists, while preserving historical attempts/assignments in storage
- Assign shows available students
- Assign keeps the main tab surface to selected work/student chips and opens
  standalone picker dialogs for work and student search/filter selection
- Assign shows visible static catalog items missing from CloudBase `sets` as
  disabled import-required rows instead of hiding them
- Assign still resolves imported CloudBase `sets` when the live `sets`
  collection has more than 200 visible records
- Student and Teacher Library expose only `Practice` and `Exam` top-level
  filters; lesson sections appear under Practice
- Practice Library sub-filters show `BBC`, `NGSL`, `NAWL`, `TK2`,
  `Oxford5000`, `DSE`, and `IELTS`, with no generic `Vocabulary`, `Grammar`, `Writing`, or
  `Grammar Lessons` sub-filter
- Teacher Assign filters, Teacher View matrix type filters, and student
  assignment cards show Vocabulary sets as `NGSL`, `NAWL`, `TK2`, or
  `Oxford5000`
- teacher notifications merge multiple attempts from the same student
  assignment thread, or the same student/set self-study thread, into one row
- a grouped notification shows its attempt count and opens the complete attempt
  history for that thread
- opening the teacher notification bell alone does not clear the header badge
  or red unread row styling
- opening a grouped attempt notification clears its red state; a later attempt
  in the same thread makes it red again while unopened threads remain red
- in-progress assignment cannot be duplicated
- completed/mastered/STAR work can be reassigned
- reassignment creates a new `assignment_id`
- Assign supports choosing Students before Work and Work before Students; the
  opposite picker color-codes prior assignment state
- Assign marks open `in_progress` student/work pairs with color and disables
  selection, while completed/mastered pairs stay colored but selectable
- Assign selected Work and Students render one row per item, each with a small
  remove control that clears that selection without reopening the picker
- Student picker no longer shows a `Select filtered` bulk-select button
- Assign task parameters render as one row per selected Work item with Task,
  Date, Passing %, and STAR columns
- Assign Date offers only `This week`, `Next week`, and `Customize`; Customize
  reveals Week/Date controls, and Week clearly labels the current Wxx week
- Assign supports different dates/weeks, passing percentages, and STAR settings
  for different selected Work rows in the same submit
- Assign rejects an `Earn STAR` row until `Mastery %` is filled, and stores
  checked STAR assignments with `mastery_enabled: true`
- Assign-created work for a future Week appears in Teacher View under that Wxx
  assignment column/date filter
- Library opens practice pages in `teacher=1`
- Show Answers uses teacher route and does not lock student mastery
- Progress reflects recent attempts
- Teacher page opens to View by default, and the initial matrix loading state
  shows only the animated grid/radar wash without visible loading copy or a
  centered spinner
- top-right circular student ID icon opens the standalone student lookup
  modal; Choose/Search expands a scrollable student list inside the modal, the
  modal's internal `+` opens create-student, and View no longer shows student
  info/progress below the matrix
- Teacher View `By student` expands a student into a history list with best
  percentage fixed on the far right, and clicking a task opens the same
  independent detail modal as the top matrix
- Teacher View progress mode tabs show only `By student` and `By task`; the
  capsule sticks over the main Assign/View/Library tabs while scrolling, and
  `By task` summaries show Total plus Avg with unfinished assignments excluded
- Teacher View expands to the desktop workspace width and does not stay capped
  at the narrower student dashboard shell width
- clicking a linked task header at the top of the Teacher View matrix opens its
  `teacher=1` practice preview, and `Back` returns to `teacher.html?view=view`
- First successful matrix render transitions in with a soft fade/lift instead
  of abruptly replacing the loading state
- Teacher rainbow theme animates slowly on hero, active controls, matrix
  headers, and group-card top borders without overriding passed/mastered
  green states or low-score red states
- Grouped progress items below the matrix keep quiet neutral/green status
  styling instead of repeated rainbow-filled mode tabs, student capsules, or
  stat pills
- Top-right teacher icon buttons show compact spinner states while loading and
  header capsules do not show separate rainbow underline accents
- Progress still reflects assignment attempts after attempts/assignments exceed
  one CloudBase read page
- View matrix shows completed status from linked attempts even if assignment
  summary fields are stale
- View matrix shows a green check, not a star, for completed assignments whose
  `mastery_enabled` is false
- View matrix date filtering uses assignment `assigned_at` in Beijing-time
  natural weeks: `This week` is Monday-Sunday of the current Beijing week,
  `Last week` is the previous Beijing Monday-Sunday range, and `Self study`
  shows records without an assignment separately
- View matrix task headers show zero-padded week labels such as `W03`; week
  numbering starts at the first Monday of the assignment year, and dates before
  that Monday show `W00`
- View matrix renders repeated assignments of the same set as separate columns,
  including repeated assignments in the same week
- View matrix includes every student matching the current filters, including
  students beyond the first dozen sorted rows
- Clicking the matrix left student-name column opens an independent four-week
  progress modal with that student's Total, Done, and Avg summary; its Wxx
  labels, Mon-Sun squares, completion-density/STAR states, and selected day or
  week detail match the student Dashboard and include completed self-study
- Clicking a matrix cell opens the independent page-level detail modal instead
  of rendering the detail inline under the matrix
- Opening a teacher notification attempt for the first time shows the full
  attempt-detail dialog height; closing and reopening should not be required
  to get the normal modal size
- Matrix attempt cards show `Page ... · Audio ...` timing for audio attempts
  and keep older/non-audio attempts readable when audio timing is absent
- View shows only `By student` and `By task` groupings without Open/Watch status labels
- `By task` bars sort student completion from low to high and open the same
  independent detail modal as matrix cells
- editing due/pass/mastery in View updates only the selected assignment records
- Argue list loads and groups disputes
- Argue list does not show student disputes linked to cancelled assignments
- cancelling open selected assignments in View hides them from teacher View
  progress and student To Do, preserves old attempts, skips completed/mastered
  assignments, and allows the same set to be reassigned later
- resolving `keep` does not alter grading key
- resolving `add`/`replace` updates grading key and history
- approved `add`/`replace` scans historical attempts and only improves matching same-set/same-question/same-answer records
- approved dispute can create or repair STAR
- teacher-originated `add`/`replace` with no `attempt_id` still triggers matching historical upward regrade
- `backfillAcceptedAnswerRegrades` dry run reports matching attempts without writes, and apply mode improves only matching historical answers

## 6. Visitor Flow Checklist

Check:

- visitor can browse homepage/library
- visitor can open practice pages
- visitor cannot type/select answers
- visitor cannot submit
- visitor cannot save My Words
- visitor sees login prompt on interaction

## 7. Vocabulary Checklist

Check:

- every vocabulary JSON has a non-empty string `contentVersion`, and its JS
  fallback is structurally identical;
- every group has equal Word Bank/question counts, unique canonical
  `questionKey` values, and keys shaped as `<group.id>:<question.number>`;
- `prepare-cloudbase-data.js` fails when public `contentVersion` differs from
  private `grading_version`;
- a stale public unit is rejected with `VOCABULARY_CONTENT_OUTDATED` before a
  countable test session starts and before an uncounted practice is graded;
- a countable test session stores only the selected questions' private answer
  and explanation snapshots, never returns those snapshots in `sessionView`,
  and grades against the snapshots after the live grading key changes;
- resume, heartbeat, and submit reject a page whose `content_version` differs
  from the session's locked `grading_version`;
- draft storage keys include `contentVersion`, so answers from an older prompt
  revision cannot prefill a newer revision;
- normalized matching still accepts case and surrounding-space differences,
  while a genuinely different answer remains wrong;
- run `npm run test:vocabulary` for version/snapshot rule tests and
  `npm run verify:release` for all-unit schema, key, Word Bank, and JSON/JS
  parity checks;
- before deployment, smoke test an old-version start request, a current-version
  start and submit, a grading-key update during an active session, and a 1-4
  group self-test. The stale request must fail, the active session must retain
  its original result, and the self-test must never write an attempt.
- for a historical version-mismatch repair, dry-run
  `backfillVocabularyContentVersionMismatch`, require multiple legacy-answer
  signatures in every candidate attempt, confirm every percentage moves only
  upward, then apply and rerun the dry run to verify it returns zero candidates.

- Learn/Spell/Cloze modes render
- Vocabulary Learn numbered capsules stay in the sticky learning bar, while the
  word bank appears only after `Go to Practice`, expands and collapses slowly,
  has no `Word Bank` label or `Hide` button, and collapses when scrolling back
  into the word-card area
- Learn word cards do not show source numbers, and inline practice cards do
  not repeat `Study Set`, word-range labels, or a second word bank
- Vocabulary practice word-bank chips show words only, without chip numbers or
  plus/minus font controls
- selecting a numbered Vocabulary Learn group shows `Go to Practice`, opens
  that group's inline practice, shows only `Check` before checking, then
  replaces it with a centered correct/total score pill plus inline `Redo` after
  checking
- Vocabulary inline practice has no `Clear All`, no `Hide Answer`, and no
  floating `Redo` button
- each blank's choice panel opens as a floating overlay that does not push
  questions down, has no `Clear` button, and ends with a blank underline chip
- checking Vocabulary inline practice turns correct cards green, wrong cards
  orange-yellow without pulsing, and writes correct or wrong-to-correct
  feedback in the answer blank
- unanswered wrong Vocabulary inline practice blanks show `X` on the
  submitted-answer side, not `No answer`
- every Vocabulary inline practice question card shows an always-visible `?`
  button before and after checking; clicking it opens a floating answer and
  explanation popover that does not push the question layout down, including
  before `Check` is clicked
- private-answer Vocabulary units load only the selected question's answer and
  explanation on the first `?` click and must not mark the whole practice group
  correct or wrong
- Vocabulary inline practice with local `answer` fields checks without
  CloudBase, and legacy CloudBase fallback errors do not expose raw SDK messages
  such as `t.scope`
- Vocabulary top `Practice` download opens a dialog; `Confirm` downloads the
  static all-groups worksheet in original order
- Vocabulary `Practice` download `Customise` opens a group multiselect where
  removing any group unchecks `All`, and selecting every group rechecks `All`
- Vocabulary custom worksheet download with shuffle off uses static PDFs for
  all-groups and one-group cases, and browser-generates selected multi-group
  PDFs without answers
- Vocabulary custom worksheet download with shuffle on keeps group order and
  group numbers stable, randomises each selected group's word bank and question
  order from the visible randomiser seed, and renumbers shuffled questions from
  `1`
- static and browser-generated Vocabulary Practice worksheets render enlarged
  word-bank and question text without clipping, overlap, or table overflow
- JSON and JS fallback both work
- Test start shows the timed-test warning before questions appear
- Cloze/Test timing gives each selected group 90 seconds
- running Test mode disables other Vocabulary mode tabs and warns on
  browser-level leave/back attempts
- running Test mode shows a sticky top bar with numbered test-set capsules and
  the timer centered in the same row; clicking a number jumps to that set
- Test set headings show numbers only, without `Test Set` text
- manual Test submit asks for early-submit confirmation, while time-up submits
  automatically
- the visible Test submit button says `Submit`
- the result modal has only one `Close` action
- after Test submission, answer feedback appears inside each question blank
  using the same treatment as Vocabulary Learn
- the Test result summary and `Redo` button appear below the test questions,
  not above them
- student Vocabulary views do not show a bottom-right floating `Redo` capsule
- student Vocabulary views do not show a bottom-right `Show Answers` capsule
- 1-4 selected Test groups do not create CloudBase attempt
- 5+ selected Test groups create attempt
- 5+ selected Test groups create a `vocabulary_test_sessions` record before
  questions appear and submit with its `test_session_id`
- countable Vocabulary Test submission grades the session's recorded question
  IDs, not a browser-edited question list
- switching apps/tabs or hiding/leaving the page during a 5+ group Test marks
  the session abandoned and does not create an attempt
- another device or browser tab for the same account is blocked from student
  cloud-backed features while a 5+ group Vocabulary Test is active
- heartbeat runs about every 10 seconds, and sessions with no heartbeat for
  more than 30 seconds become abandoned
- group metadata is stored
- My Words can save selected text from answer, explanation, feedback, and
  result regions, including disabled answer-feedback buttons
- My Words accepts single-letter words such as `a` and `I`
- a curated/shared-lexicon word displays dictionary details immediately after
  save/list, while an unknown word saves first and then enriches automatically
- a dictionary timeout leaves the word visible as pending, a confirmed miss is
  throttled and offers Retry, and a cached unknown word does not call the
  external provider again for another student
- My Words search matches Chinese meaning, English definition, and part of speech
- pronunciation uses browser speech without exposing a provider key
- a failed multi-word lexicon query falls back to individual reads, so known
  entries such as `expense`, `details`, and `widespread` still show dictionary data
- collapsed cards show only word, part of speech, Chinese meaning, and speaker;
  expansion reveals English definition, source/context, status, and actions
- Today/New/Learning/Mastered filters work, review hides meanings until Reveal,
  and Forgot/A little/Know schedules 1/3/7-to-30 day intervals respectively
- BBC, IELTS Reading, IELTS Listening, Vocabulary, Dashboard, and Attempt
  Review load the same cache-versioned My Words selection script

## 8. Content Import Checklist

For each new set:

- metadata exists in `content/<section>/<set_id>.json`
- runtime data exists in `data/<set_id>.json` or correct content folder
- audio/image assets exist if referenced
- `node scripts/build-home-catalog.js` run if catalog changes
- `node scripts/prepare-cloudbase-data.js` run if sets/grading change
- public preview strips answers
- CloudBase `sets` imported
- CloudBase `grading_keys` imported
- direct lesson URL loads
- authenticated Explore/Library shows the item
- submission grades successfully

## 9. Deployment Checklist

Before saying a deploy is complete:

- static files are pushed/published
- changed cloud functions have rebuilt ZIPs
- CloudBase development functions are uploaded
- required collections exist and are `ADMINONLY`
- cache query strings are bumped for changed shared JS
- at least one development account flow is tested

## 10. Known Testing Gaps

- No automated CloudBase integration tests.
- No pure unit tests for assignment status, STAR, and Argue rules yet.
- No automated browser smoke for teacher/student login yet.
- No automated grading-key reconcile check yet.

High priority improvement:

- Add a lightweight pure JS rule test suite for backend status/STAR/Argue logic.
