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

Stop the server after testing.

## 4. Student Flow Checklist

Use a dedicated development student account, never a real student account.

Check:

- login succeeds
- profile loads
- forced password change appears when expected
- Assignments shows `TO DO` and `FINISHED`
- student opens assigned work
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
- Vocabulary countable tests use `80%` passing and `100%` mastery by default
  unless the set or assignment explicitly overrides thresholds
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
- disable/enable updates auth and profile
- Assign shows available students
- Assign keeps the main tab surface to selected work/student chips and opens
  standalone picker dialogs for work and student search/filter selection
- Assign shows visible static catalog items missing from CloudBase `sets` as
  disabled import-required rows instead of hiding them
- Assign still resolves imported CloudBase `sets` when the live `sets`
  collection has more than 200 visible records
- in-progress assignment cannot be duplicated
- completed/mastered/STAR work can be reassigned
- reassignment creates a new `assignment_id`
- Library opens practice pages in `teacher=1`
- Show Answers uses teacher route and does not lock student mastery
- Progress reflects recent attempts
- Teacher page opens to View by default, and the initial matrix loading state
  shows only the animated grid/spinner without visible loading copy
- top-right circular student ID icon opens the standalone student lookup
  modal; Choose/Search expands a scrollable student list inside the modal, the
  modal's internal `+` opens create-student, and View no longer shows student
  info/progress below the matrix
- Teacher View `By student` expands a student into a history list with best
  percentage fixed on the far right, and clicking a task opens the same
  independent detail modal as the top matrix
- Teacher View expands to the desktop workspace width and does not stay capped
  at the narrower student dashboard shell width
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
- View matrix includes every student matching the current filters, including
  students beyond the first dozen sorted rows
- Clicking a matrix cell opens the independent page-level detail modal instead
  of rendering the detail inline under the matrix
- Matrix attempt cards show `Page ... · Audio ...` timing for audio attempts
  and keep older/non-audio attempts readable when audio timing is absent
- View shows `By student`, `By class`, and `By task` groupings without Open/Watch status labels
- `By task` bars sort student completion from low to high and open single-assignment detail
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

- Word List/Learn/Dictate/Test modes render
- JSON and JS fallback both work
- Test start shows the timed-test warning before questions appear
- running Test mode disables other Vocabulary mode tabs and warns on
  browser-level leave/back attempts
- manual Test submit asks for early-submit confirmation, while time-up submits
  automatically
- the result modal has only one `Close` action
- after the result modal closes, wrong Test questions remain marked red and
  show inline answer explanations
- submitted Test review shows `Redo`; Redo confirms before clearing and
  returns to the group-count selector
- 1-4 selected Test groups do not create CloudBase attempt
- 5+ selected Test groups create attempt
- group metadata is stored
- My Words cannot save from answer/result regions

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
