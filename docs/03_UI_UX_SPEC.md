# 03 UI / UX Spec

> This document records how the product should feel and behave.
> Update it when page structure, interaction rules, status labels, or major UI behavior changes.

## 1. Design Principles

- The interface should feel like a practical learning tool, not a marketing site.
- Student pages should be calm, clear, and mobile-friendly.
- Teacher pages should prioritize speed, scanning, and repeated classroom use.
- Important learning state should come from the backend, not from localStorage.
- Visitor mode should allow browsing but clearly block answer input and saving.

## 2. Main Pages

| Page | Purpose |
| --- | --- |
| `index.html` | Login and visitor entry |
| `dashboard.html` | Student assignments, My Words, Library, account menu |
| `teacher.html` | Teacher admin desk |
| `library.html` | Learning library / content entry |
| `bbc.html` | BBC listening practice runtime |
| `ielts-reading.html` | IELTS Reading runtime |
| `ielts-listening.html` | IELTS Listening runtime |
| `vocabulary.html` | Vocabulary learning, dictation, test |
| `attempt-review.html` | Attempt review surface |

### Login

The student login page should feel like a lightweight welcome ritual rather
than a feature billboard. The current direction uses a bright green floating
paper scene with listening, vocabulary, writing, and speaking symbols drifting
across the welcome panel. Keep the visible text minimal: `Mr. Cat Academy`, one
central quote, the Student ID/password fields, `Sign in`, `Continue as
Visitor`, and a short visitor-mode note.

## 3. Student Dashboard

Navigation:

- `Assignments`
- `My Words`
- `Library`

Assignments display:

- open `TO DO` assignments directly
- a small bottom `Finished` completion button for completed work
- the top billboard keeps the existing greeting/copy structure, but uses a
  pale green aurora-rainbow animated background instead of the older dark green
  panel
- the main `Assignments` / `My Words` / `Library` capsule and the student
  Library `General Practice` / `Exam Practice` / `Lessons` capsule use a soft
  translucent glass treatment with subtle rainbow active states

Backend statuses:

- `to_do`
- `passed`
- `mastered`

Frontend rule:

- `passed` and `mastered` both appear inside the collapsed `Finished` completion button.
- Do not split the student dashboard back into `PASSED` and `MASTERED` tabs unless the owner explicitly changes the product rule.
- The finished control is a compact sticky gold capsule, visually aligned with
  the Library gold badge style but with a brighter golden glow. When collapsed,
  it stays docked at the bottom of the Assignments view. After it is opened, it
  becomes part of the page content, reveals the finished list with a subtle
  golden ribbon effect, and the capsule can still stick to the top while
  scrolling. It reads `Show Finished` when collapsed and `Hide Finished` when
  expanded, and keeps the visible control to a check icon plus that label. Do
  not put counts or extra action text inside the capsule.
- Student messages and account actions live in the top-right chip/bell area, not as a main navigation tab.
- Message and unread-count reminders use red dots/badges consistently, including
  student replies, assignment-tab notices, teacher notification counts, and
  unread activity rows. On the student main navigation, the assignment count
  floats just outside the glass capsule so the rounded active tab is not
  clipped.
- Student STAR counters live inside the top-right account panel, not in the always-visible header.
  Show assigned-task stars as the yellow counter and self-study/library stars
  as the blue counter beside it.
- The student account panel should be quiet: no separate achievement card, no
  large account action buttons. Stars sit on the same row as the student's
  display name, not in a separate `Stars` field. Student ID, Class, System, and
  Finished should keep consistent row height and divider spacing. `Change
  password` and `Log out` are small quiet capsules at the bottom; do not show a
  `Password change required` field in the account panel.

Student cards should show:

- the same compact task capsule structure used by Library task cards
- title
- `PASSED` / `MASTERED` stamp-style state for finished work
- STAR state if mastered
- the whole card opens the original task when clicked, except for explicit
  buttons such as Teacher replies or Get Star
- opening a task card first shows the shared practice-entry confirmation dialog
  so accidental taps do not immediately leave the dashboard
- practice pages use `Back`, not `Home`, for return controls. Tapping Back
  first shows a leave-page confirmation, then returns one browser-history page;
  if no history is available, it falls back to `dashboard.html`.

My Words:

- has its own main navigation entry.
- shows saved student-owned words and phrases from `studentVocabulary`.
- uses a vocabulary-list/table layout with word, source/context, saved date, and archive action.
- visitors see a login prompt instead of personal data.

Student account menu:

- opens from the top-right identity chip.
- shows profile/account information, password change, and logout.
- teacher replies remain a message-center dialog opened from the top-right message indicator.

## 4. Teacher Interface

Teacher page has three main capsules:

- `Assign`
- `View`
- `Library`

The top-right teacher chip opens a Personal Center panel. Its title is centered
as `PERSONAL CENTER`, without a separate `Teacher Account` heading or account
status row. The only create-student entry is the `+` button beside the
notification control in the top-right header; it opens a standalone modal, not
an inline View panel. The create-student modal uses a vertical field stack and,
after success, shows a standalone checkmark confirmation dialog with the new
Login ID and initial password. Review requests open from a separate top-right
question-mark icon button with a pending-count badge and display in a
standalone modal.
The notification bell opens a standalone student-attempt modal only; Review
requests must not be duplicated in the bell because they have their own
top-right Review entry.

Teacher notification rows are direct links. Clicking a student attempt opens
`View`, selects the matching matrix cell, and highlights that specific attempt
inside the matrix detail dialog. Matrix date filtering for this route must
include the clicked attempt's submitted date, even when the assignment summary
date or first completion date is different.

### Assign Tab

Assign contains:

- `Assign`

### Assign

Teacher can:

- open a standalone `Choose work` dialog from the quiet `Work` summary card
- filter work inside that dialog with one search field and one `Column` select
- sort filtered Work items with the same natural order used by the matching
  Library column, such as BBC date order or IELTS numeric book/test order
- open a standalone `Choose students` dialog from the quiet `Students` summary
  card
- filter students inside that dialog with one search field and one `Class`
  select
- assign the selected work to the selected students

The Assign surface should stay visually minimal: the default Assign tab shows
only selected work and selected student chips plus the Assign action. Search,
filters, candidate lists, and filtered-class selection live in the standalone
picker dialogs. There are no visible multi-step accordions, no legend, and no
visible due/pass/mastery fields in the default flow. Assignment creation
continues to use the existing server-side validation and default thresholds.
If a visible static catalog item has been published but its CloudBase `sets`
record is missing, the Assign picker should still show it as a disabled,
catalog-only row with an import-required note instead of hiding it completely.
It becomes selectable only after the matching CloudBase `sets` and
`grading_keys` records are imported.

Candidate states:

- `Available`: selectable
- `In Progress`: not selectable
- `Completed · can reassign`: selectable
- `STAR · can reassign`: selectable

### View

View is the teacher's progress and student-inspection surface.

It should include:

- an assignment matrix/table for scanning completion by student and task, with class, column, recent-task count, and date-range filters plus responsive horizontal scrolling on small screens
- matrix task headers show the stable task ID with the task name directly
  underneath
- matrix filters appear in `Class`, `Column`, `Recent`, `Date` order; `Class` defaults to `All`, `Column` defaults to `All`, `Recent` defaults to `7` and is a numeric select from 1 through 20, and `Date` offers `This week`, `This month`, or a custom from/to calendar range
- the matrix renders every student matching the current filters; do not hide
  later students behind a fixed first-page row cap
- the matrix student column shows only the student name, without Login ID or class, and sizes to the visible names instead of using a wide fixed column
- clickable matrix cells open a floating dialog with the close button outside
  the detail card underneath it. The dialog shows the practice title, a student
  name pill, a lock/best-score pill, an attempt score bar chart, and newest-first
  attempt cards.
- matrix detail close buttons are centered below the dialog card. Attempt score
  bars use fixed-width columns rather than stretching a single attempt across
  the whole dialog; not-passed bars are amber, passed bars are green, and
  mastered bars are gold.
- the matrix score pill shows only the best score until answers have been
  viewed; once answers have been viewed and locked, it adds a lock icon beside
  the best score.
- matrix cells use icon-plus-score status treatment: `Not yet` uses a warm
  orange hollow circle, `Passed` uses a green check, and `Mastered` uses a
  glowing gold star.
- matrix attempt cards show only wrong answers, with Q number, student wrong
  answer in red, and correct answer in green. They do not repeat table header
  labels.
- a grouped `By student` / `By class` / `By task` progress view
- `By student` and `By class` groups show compact matrix-style score cells; clicking a cell expands the single assignment detail
- `By task` groups show each student's completion as a low-to-high bar chart; clicking a bar expands that student's assignment detail
- group tools allow teachers to edit due date, passing percentage, and mastery percentage for the assignments in that student, class, or task scope
- student selection and student detail panels
- student account management actions such as class/system edit, password reset, enable/disable, and account creation

### Library

Teacher opens existing practice pages in `teacher=1` mode.

Student and teacher Library task items should render as the same compact task
capsules/cards with set metadata, title, and stable set ID. The whole capsule
opens the practice item after the shared practice-entry confirmation dialog;
do not add a separate `Go` action.
Teacher Library uses CloudBase `sets` as the authoritative assignable source,
but should merge in visible static `home-catalog` items that are missing from
CloudBase so new public lessons can still be previewed while content import is
being checked.
BBC task cards should not show a year badge inside each task capsule. Teacher
Library currently does not expose a BBC year sub-filter; keep BBC as a simple
column unless the owner explicitly asks to restore 2025/2026 sub-tabs. IELTS
task cards should not show the Cambridge book badge inside each task capsule.
IELTS book/filter labels belong in the yellow capsule tab layer above the task
list. DSE labels should read `DSE Reading`, `DSE Writing`, `DSE Integrated`,
and `DSE Speaking` without visible Paper numbers. Keep this capsule shape when
changing Library grouping, tabs, or filters.
IELTS Library task capsules should label their course surface as lowercase
slugs, `ielts-reading` or `ielts-listening`, in the card eyebrow.

Within a concrete Library column, cards should keep a stable learning order:
BBC by release date from earliest to latest; IELTS by Cambridge book, then
Test, then Section/Passage; other columns by configured numeric order or title.

Teacher Show Answers:

- calls `teacherAdmin.getAnswerKeyForSet`
- does not call student reveal logic
- does not lock mastery

### Student Detail

Student detail should show:

- name, Login ID, class, curriculum track
- active status
- assigned work
- recent attempts
- reset password
- enable/disable
- class/system editing

### Review

Review is the teacher-facing surface for student Argue requests. It opens as a
standalone modal from the top-right Review icon, not as a Tasks sub-tab.

Review should show `Pending`, `Approved`, and `Rejected` status tabs and group
requests into task capsules so the teacher can handle one student attempt or
assignment at a time.

Pending items sort first.

Each detail should show:

- question text if available
- student answer
- answer snapshot
- explanation if available
- student note
- decision controls

## 5. Practice Pages

Shared rules:

- Show current identity on practice pages.
- Visitor cannot type, select, submit, or save My Words.
- Teacher preview can show answers but should not affect student state.
- Submission feedback should use page UI, not native `alert()` where avoidable.
- Try Again clears visible answers and feedback but preserves CloudBase attempts.

### IELTS Listening

- A sticky lesson header at the top of the workspace shows the lesson title and source, above the questions.
- The header stays visible while scrolling through questions.

### BBC Practice

- BBC lessons may opt into a front-end-only render theme through
  `renderTheme` in their runtime JSON. The theme must not change grading IDs,
  submission behavior, History/Clear, Explain, Argue, or answer feedback rules.
- A submitted BBC attempt should mark wrong questions even when answer feedback is still locked because the attempt did not pass.
- History should refill the saved attempt answers into editable fields for not-passed, passed, and mastered attempts.
- History may show Explain and Argue controls only when backend review data marks feedback as available.
- Clear removes visible answers, feedback, Explain, Argue, and local blank locks; persistent MC wrong-answer reminders may remain as yellow boxes.
- The BBC Argue sent/thanks dialog must include a visible Close button in both
  student mode and teacher preview mode.

### Vocabulary Test

- The test countdown timer is fixed at the top-center of the screen with red text on a light-red background to create a sense of urgency.
- Starting a Vocabulary Test opens a confirmation dialog warning that the timer
  cannot be paused or stopped.
- While a Vocabulary Test is running, the page is front-end locked to the Test
  view: other mode tabs are disabled, browser unload/back attempts show a
  warning, and the student must submit or wait for automatic time-up submission.
- Manual Submit opens an early-submit confirmation; time-up submission does not
  ask again.
- The Vocabulary Test result modal has one action only: `Close`.
- After the result modal closes, incorrect Vocabulary Test questions remain
  marked red and their answer explanations are shown inline for review.
- The submitted Test view shows a `Redo` button. Redo opens a confirmation
  dialog warning that the current review will be cleared and the cleared
  answers will not be recorded. Confirming Redo returns the student to the
  group-count selector for a fresh timed test.

## 6. Status Labels

Preferred product labels:

| Backend | Student label | Teacher label |
| --- | --- | --- |
| `to_do` | TO DO | To Do / Working / Not started |
| `passed` | FINISHED | Passed / Finished |
| `mastered` | FINISHED + STAR | Mastered |

Legacy labels:

- `not_done`
- `failed`
- `done`

New UI should not introduce new persistent backend status words without updating [04_DATA_MODEL.md](04_DATA_MODEL.md).

## 7. Mobile and Classroom Use

Important mobile rules:

- Assignment action buttons should not wrap awkwardly.
- Listening controls should stay reachable while scrolling.
- Candidate popups should not cover question text.
- Text must not overflow buttons/cards.
- Teacher views should remain scannable on laptop screens during class.
- Teacher progress matrices may scroll horizontally on small screens instead of compressing text.

## 8. Known UI Risks

- Cache query strings must be bumped after shared JS changes.
- Teacher preview and student mode can accidentally share UI paths; keep reveal logic separate.
- Vocabulary fallback JS is needed for local/file loading.
- My Words selection should avoid answer/explanation/result regions.
- On touch devices, My Words should preserve the captured word or phrase while
  dismissing the browser's native selection callout so the site save button is
  the primary action.

## 9. Future UI Improvements

- Clearer STAR counter labels.
- Better teacher progress filters by class and curriculum.
- More consistent modal/dialog style across practice pages.
- More compact teacher dispute resolution flow.
- A small deployment/version indicator for teacher troubleshooting.
