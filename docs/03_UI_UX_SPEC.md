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
| `vocabulary.html` | Vocabulary learning, spelling, use/test |
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
  Library `Practice` / `Exam` capsule use a soft translucent glass treatment
  with subtle rainbow active states

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
- Finished Vocabulary assignment cards open the same Learn entry used by
  Library Vocabulary cards, without automatically restoring Test/History mode.
- Student messages and account actions live in the top-right chip/bell area, not as a main navigation tab.
- Message and unread-count reminders use red dots/badges consistently, including
  student replies, assignment-tab notices, teacher notification counts, and
  unread activity rows. On the student main navigation, the assignment count
  floats just outside the glass capsule so the rounded active tab is not
  clipped.
- Teacher Library and Student Library show only two top-level filters:
  `Practice` and `Exam`. Lesson catalog sections are surfaced under Practice
  sub-filters rather than as a separate top-level `Lessons` button.
- Practice Library sub-filters are `BBC2024`, `BBC2025`, `BBC2026`, `NGSL`,
  `NAWL`, `TK2`, `Oxford5000`, `DSE`, and `IELTS`. The old generic
  `Vocabulary`, `Grammar`, `Writing`, and `Grammar Lessons` sub-filters are not
  shown in Library. NGSL, NAWL, and Oxford5000 Library task cards use
  `vocabulary` as the eyebrow and show the source-specific word-number range in
  the top-right metadata. Teacher Assign type filters, Teacher View matrix type
  filters, and student assignment cards still identify vocabulary sets by
  source (`NGSL`, `NAWL`, `TK2`, or `Oxford5000`).
- Opening the teacher notification bell immediately clears the top-right badge.
  Individual attempt rows stay red until the teacher opens one related attempt;
  opening any attempt for the same student assignment clears the red state for
  that assignment's related attempts.
- The student message/replies dialog opened from the top-right bell must be a
  fully opaque top-layer modal. Dashboard navigation capsules such as
  `Assignments`, `My Words`, and `Library` must never show through it.
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
- no `PASSED` / `MASTERED` stamp-style state on finished task capsules
- STAR state if mastered
- the whole card opens the original task when clicked, except for explicit
  buttons such as Teacher replies or Get Star
- opening a task card first shows the shared practice-entry confirmation dialog
  so accidental taps do not immediately leave the dashboard
- the shared practice-entry confirmation dialog has no top-right stamp; its
  bottom ribbon shows only `Score: 90%` style copy, with the same lock icon
  treatment as the teacher View matrix when the score is locked
- the practice-entry confirmation dialog must close before navigation and must
  not be restored by browser Back/bfcache; returning from a practice page should
  show the page behind the dialog
- practice pages use `Back`, not `Home`, for return controls. Tapping Back
  first shows a leave-page confirmation, then returns one browser-history page;
  if no history is available, it falls back to `dashboard.html`.

My Words:

- has its own main navigation entry.
- shows saved student-owned words and phrases from `studentVocabulary`.
- uses a vocabulary-list/table layout with word, source/context, saved date, and archive action.
- includes a manual add form where students can type a word or short phrase
  plus optional context directly into My Words.
- visitors see a login prompt instead of personal data.

Student account menu:

- opens from the top-right identity chip.
- shows profile/account information, password change, and logout.
- the `Change password` dialog must layer above the account panel and remain
  the topmost student-account surface while open.
- teacher replies remain a message-center dialog opened from the top-right message indicator.

## 4. Teacher Interface

Teacher page has three main capsules:

- `Assign`
- `View`
- `Library`

The top-right teacher chip opens a Personal Center panel. Its title is centered
as `PERSONAL CENTER`, without a separate `Teacher Account` heading or account
status row. The top-right circular student ID icon opens a standalone Student
lookup modal. That modal contains the student search/selection surface,
selected student info and progress, and an internal `+` action for creating a
student. The Choose/Search student list expands inside the modal and remains
scrollable there.
The create-student modal uses a vertical field stack and, after success, shows
a standalone checkmark confirmation dialog with the new Login ID and initial
password. Review requests open from a separate top-right question-mark icon
button with a pending-count badge and display in a standalone modal.
The notification bell opens a standalone student-attempt modal only; Review
requests must not be duplicated in the bell because they have their own
top-right Review entry.

Teacher notification rows open standalone attempt detail dialogs inside the
notification surface. They must not switch to `View`, select matrix cells,
change matrix filters, or redraw the matrix, whether the attempt came from an
assigned task or self study. The attempt detail dialog must use the same
detail layout as a `View` matrix cell, showing every attempt for the relevant
assignment or self-study thread at a glance. When opened from a specific
notification attempt, the dialog highlights that attempt and automatically
scrolls to its card. The attempt detail dialog must keep a visible `Close`
action fixed at the bottom of the modal while the attempt history scrolls above
it. The detail modal should render outside the notification list's scroll body
so the first open uses the same full dialog height as later opens.

The teacher page defaults to `View` on entry. While assignment matrix data is
loading, the matrix area uses a textless loading state with visible grid lines,
subtle rainbow color movement, and no centered spinner. On the first successful
matrix render, the real matrix content should softly fade and lift into place
instead of replacing the loading state abruptly.

Teacher visual style uses a warm, animated rainbow theme. Rainbow gradients
appear on the hero, active tabs, primary actions, matrix headers, group-card
top borders, and selected control borders. These rainbow
elements should move slowly and continuously. Completion states remain
functionally colored: passed/mastered stay green, low scores stay red, and
empty/not-yet cells stay neutral. The grouped progress area below the matrix
should not use rainbow fills on repeated student capsules, mode tabs, mini
cells, score bars, or stats because repeated color blocks make the view noisy.

The top-right Review and Notifications icon buttons show compact spinner loading states
while the teacher desk is initializing. The create-student and account capsules
stay in their normal state. Header capsules should not use a
separate rainbow underline; keep their shape stable and remove the spinner once
the desk data has loaded or failed.

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
visible due/pass/mastery fields in the default flow. Empty Work/Students
summaries and picker footers should not show `None selected` or `Nothing
selected` placeholder text. Assignment creation continues to use the existing
server-side validation and default thresholds.
After successful assignment creation, Assign should show a standalone
checkmark success dialog using the same confirmation style as student account
creation. It should not write the success result into the small page message
line; the dialog's bottom action is a `Close` button.
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

- a wide teacher workspace shell that can expand on desktop screens so the
  matrix uses available horizontal space instead of staying capped at the
  narrower student dashboard width
- no separate student info/progress section below the matrix; that student
  lookup surface lives in the top-right Student lookup modal
- an assignment matrix/table for scanning completion by student and task, with class, column, and date filters. The matrix card should fill the available
  View width, and wide task sets must scroll horizontally inside the matrix
  area instead of widening the whole page. On touch devices, horizontal matrix
  scrolling must not block normal vertical page scrolling.
- matrix task headers show the stable task ID, a zero-padded week label such as
  `W03`, and the task name underneath. Week labels are calculated from
  assignment `assigned_at` in Beijing time: dates before that year's first
  Monday show `W00`, and the first Monday-Sunday range is `W01`.
- matrix filters appear as compact unlabeled `Class`, `Column`, and `Date`
  select capsules on one row with equal visual width; all three default to all
  records. `Column` uses `All type`, `Date` uses `All time`, and date filtering
  offers `This week - Wxx`, `Last week - Wxx`, `All time`, and `Self study`.
  Week filters use the assignment `assigned_at` timestamp, not student
  completion time, and calculate fixed Monday-to-Sunday natural weeks in
  Beijing time. Self-study records without an assignment are shown only by the
  `Self study` date option. Repeated assignments of the same set should render
  as separate matrix columns, even when they occur in the same week.
  Unclassed students appear in the `Class` menu by student name so a teacher can
  isolate one student's matrix rows without an `Individual` prefix.
- the matrix renders every student matching the current filters; do not hide
  later students behind a fixed first-page row cap
- the matrix student column shows only the student name, without Login ID or class, and sizes to the visible names instead of using a wide fixed column
- clickable matrix cells open a floating dialog with the close button inside
  the bottom of the detail card. The dialog shows the practice title, a student
  name pill, a lock/best-score pill, an attempt score bar chart, and newest-first
  attempt cards. It must remain an independent page-level overlay and must not
  be clipped by the matrix card or rendered inline beneath the matrix. The
  overlay must sit above page-level progress controls such as the
  `By student` / `By task` capsule.
- matrix detail close buttons are centered at the bottom inside the dialog card. Attempt score
  bars use fixed-width columns rather than stretching a single attempt across
  the whole dialog; not-passed bars are pale red, passed bars are green, and
  mastered bars are glowing gold.
- every attempt card in matrix and notification detail dialogs includes a
  compact paper icon button in the top-right action area. The button opens that
  attempt's full-work review inside the same dialog without changing attempt
  history counts, showing all recorded questions, student answers, correctness,
  correct answers, and a compact attempt-history summary.
- matrix attempt cards show timing as `Page 12m 30s · Audio 8m 10s` when audio
  timing exists, while older or non-audio attempts may show only the page/test
  duration.
- the matrix score pill shows only the best score until answers have been
  viewed; once answers have been viewed and locked, it adds a lock icon beside
  the best score.
- matrix cells use icon-plus-score status treatment: `Not yet` stays white
  with a neutral hollow circle, while `Passed` and `Mastered` share the same
  green cell background; `Passed` uses a green check circle and `Mastered` uses
  a solid green circle with a white star only when the assignment can earn
  STAR. If STAR earning is disabled for that assignment, the completed cell
  uses the green check instead of a star.
- clicking the left student-name column in the matrix opens an independent
  student timeline modal summarizing that student's assigned-work history,
  using the same overall student data represented by `By student`.
- matrix attempt cards show only wrong answers, with Q number, student wrong
  answer in red, and correct answer in green. They do not repeat table header
  labels.
- a grouped `By student` / `By task` progress view. The progress-view capsule
  sticks near the top while scrolling and visually covers the main
  Assign/View/Library capsule until the progress capsule scrolls back down.
- `By student` groups expand into a full-width student history layout: a quiet
  left student identity rail and a right-side assigned-task history list with
  each task's best percentage fixed on the far right. Clicking a task opens
  the same independent matrix detail modal used by top matrix cells.
- `By task` groups show each student's completion as a low-to-high bar chart;
  clicking a bar opens the same independent matrix detail modal used by top
  matrix cells. The group summary shows only Total and Avg; Avg excludes
  unfinished assignments.
- matrix detail and group tools allow teachers to manage the selected
  assignment records directly. A single matrix cell edits one student's one
  assignment; grouped tools edit the assignment records currently represented
  by that student, class, or task group.
- assignment management can edit due date, passing percentage, and mastery
  percentage, or soft-cancel open selected assignments. Cancelled assignments
  are hidden from teacher View progress and from the student's To Do without
  deleting attempts or completed history.
- student selection and student detail panels
- student account management actions such as class/system edit, password reset,
  deleting a student account, and account creation. Deleting a student account
  should remove that student from teacher-visible lists and View progress after
  confirmation.

### Library

Teacher opens existing practice pages in `teacher=1` mode.

Student and teacher Library task items should render as the same compact task
capsules/cards with set metadata, title, and stable set ID or display range.
The whole capsule opens the practice item after the shared practice-entry confirmation dialog;
do not add a separate `Go` action. The dialog must close before navigation and
must not reappear when browser Back returns to the Library/dashboard surface.
It should not show the old top-right `Ready?` stamp, and its bottom ribbon
should show only `Score: …`, plus the score-lock icon when available.
NGSL, NAWL, and Oxford5000 Library task capsules keep the black main title
unchanged while the eyebrow reads `vocabulary` and the top-right metadata shows
the source word-number range, for example `001-100` or `1001-1100`.
Teacher Library uses CloudBase `sets` as the authoritative assignable source,
but should merge in visible static `home-catalog` items that are missing from
CloudBase so new public lessons can still be previewed while content import is
being checked.
BBC entries in Student and Teacher Library are split into `BBC2024`, `BBC2025`,
and `BBC2026` sub-filter buttons. BBC task cards should not show a year badge
inside each task capsule; the year belongs in the sub-filter layer. IELTS task
cards should not show the Cambridge book badge inside each task capsule.
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
- delete account
- class/system editing

### Review

Review is the teacher-facing surface for student Argue requests. It opens as a
standalone modal from the top-right `!` Review icon, not as a Tasks sub-tab.

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
- On desktop, pressing Space toggles the BBC audio player only when focus is
  not inside an answer input, choice, button, select, textarea, or modal.
- A submitted BBC attempt should mark wrong questions even when answer feedback is still locked because the attempt did not pass.
- History should refill the saved attempt answers into editable fields for not-passed, passed, and mastered attempts.
- History may show Explain and Argue controls only when backend review data marks feedback as available.
- BBC multiple-choice answers lock after the first submitted attempt. Reopening
  finished work or loading History should restore the submitted MC choices and
  keep those radio groups disabled.
- Clear removes visible answers, feedback, Explain, Argue, and local blank
  locks, but it must not unlock submitted BBC multiple-choice answers.
- BBC MC option selection may add only lightweight sound and a right-side
  `✦` selection symbol. Do not add extra selected-state text; the blue render
  theme should show the symbol in blue.
- In the BBC blue render theme, the top lesson tools show `Worksheet` only,
  the exercise body does not show separate `Part 1` / `Part 2` headings, and
  the main submission button reads `Submit`.
- The BBC Argue sent/thanks dialog must include a visible Close button in both
  student mode and teacher preview mode.
- BBC Explain and Argue entry points use compact icon buttons at the far right
  of the final text line inside the relevant question box, in both the green
  and blue render themes. Explain uses a blue-green `?`; Argue uses an orange
  raised-hand SVG. When both are present, `?` sits to the left of the raised
  hand. These buttons must not reserve a full vertical action column or squeeze
  earlier lines of text.
- The BBC Argue `Tell me why.` dialog shows a compact `Your answer` panel
  above the reason textarea. It displays the student's submitted/filled answer
  for that question, or `No answer` when blank. It must not show the correct
  answer in this panel.
- BBC answer explanations opened through `?` should not put a check or cross
  before `Correct answer:`. The answer value itself should be followed by a
  compact green circular check icon matching the teacher View matrix passed
  state.
- When a student opens a BBC lesson with a passed or mastered historical
  attempt, the page should automatically load that historical review and show
  the per-question Explain `?` buttons and wrong-question Argue raised-hand
  buttons. Loading this historical review must not call `revealAnswers` or lock
  future mastery by itself.
  Historical attempts below the passing threshold must still hide both actions.
- BBC History review should not show an extra per-question dispute status note
  box under each question in any render theme. Keep the visual correct/wrong
  state and any eligible Explain/Argue icon buttons.

### Vocabulary Learn

- The Vocabulary mode switcher uses the visible labels `Learn`, `Spell`, and
  `Cloze`. `Spell` opens the existing dictation/spelling view, and `Cloze` opens
  the existing timed test flow.
- Vocabulary Learn shows a fused sticky learning bar at the top of the view.
  It defaults to `All`, while the filter row displays numbered round buttons
  first and `All` at the end. Numbered buttons filter the word cards by the
  matching study group's word range. The word-bank triangle toggle sits in a
  fixed far-left rail beside the numbered capsule row, so it remains visible
  even when the numbered row scrolls horizontally. The sticky learning bar
  should sit as an opaque top layer when it sticks, so the mode switcher or any
  earlier capsule row scrolls away instead of showing as a second layer
  underneath. Selecting a group does not show the word bank by itself.
- Learn word cards show the word, emoji, definition, and Chinese meaning
  without repeating each word's source number.
- When a numbered Study Set is selected, the bottom of Learn shows a
  `Go to Practice` button. Clicking it opens that same group's practice card
  inline below the word cards, using the former Learn-mode questions and word
  bank. The word bank slowly expands inside the sticky learning bar only after
  Practice opens, and it automatically collapses when the student scrolls back
  up into the word-card area until the student manually uses the triangle
  toggle. After a manual toggle, the word bank should keep that open/closed
  state until the student changes it again. The inline practice card should
  begin with the questions and not repeat `Study Set`, word-range labels, a
  `Word Bank` label, controls, or a second word bank because the sticky
  learning bar already identifies the group. The word bank shows words only,
  without auto-numbered chips or font-size plus/minus controls.
- Vocabulary inline practice uses each study group's own `Check` button. Each
  question card shows a compact blue-green `?` button at the top right before
  and after checking; clicking it opens the explanation in a floating popover
  so the practice layout does not shift. After checking,
  correct cards turn green, incorrect cards turn light red, and each answer
  blank is replaced by inline feedback:
  correct answers show in green, while wrong answers show the submitted answer
  in red followed by an arrow and the correct answer in green. If the
  student left a blank unanswered, the submitted-answer side shows `X` instead
  of `No answer`. The `Check` button is replaced by a centered score pill such
  as `Score: 7 / 10` and an inline `Redo` button; `Redo` clears all practice
  answers and restores the group to an unchecked state. Inline practice does
  not show `Clear All`, `Hide Answer`, or a floating `Redo` control. The
  per-blank choice panel opens as a floating overlay so the question layout
  does not shift; its word choices are shuffled per question so they do not
  reveal the answer order, it has no `Clear` button, and its final chip is a
  blank underline option for leaving an answer empty. When local practice
  answers are present, checking is handled locally and does not call CloudBase.
  Legacy vocabulary units that still need CloudBase answer checks must show a
  friendly login/session message instead of raw SDK errors.
- Vocabulary practice does not expose Argue buttons in inline practice, Test,
  History, or teacher preview surfaces.

### Vocabulary Test

- Starting a Vocabulary Test opens a confirmation dialog warning that the timer
  cannot be paused or stopped.
- Cloze-mode timing gives each selected group 90 seconds, or 1.5 minutes.
- While a Vocabulary Test is running, the top of the Test view uses a sticky
  capsule bar like Vocabulary Learn. Numbered test-set capsules sit in a
  horizontal row; when there are more than six selected sets, the row scrolls
  horizontally instead of wrapping into multiple lines. The countdown timer
  remains a fixed red capsule at the far right of the sticky row. Cloze-mode
  numbered capsules and the word-bank triangle toggle use a gold glowing visual
  treatment to distinguish them from Learn groups.
  The test-set labels show only numbers, not `Test Set 1` text, and clicking a
  number jumps to that test set. The current test set's word bank appears
  directly below the numbered capsules in the same sticky surface; when the
  student scrolls between test sets, the active number and sticky word bank
  automatically update to match the visible test set. The word-bank triangle
  toggle follows the same fixed far-left placement as Learn. If the student
  manually closes the word bank with the triangle toggle, scrolling must not
  reopen it until the student opens it manually again. The sticky word bank must
  layer above question-card `?` explanation buttons and their floating
  explanation popovers while scrolling.
- While a Vocabulary Test is running, the page is front-end locked to the Test
  view: other mode tabs are disabled, browser back attempts show a warning,
  and the student must submit or wait for automatic time-up submission.
- Countable Vocabulary Tests, meaning 5 selected groups or more, must start a
  server `vocabulary_test_sessions` record before questions appear.
- Countable Vocabulary Tests heartbeat every 10 seconds. Switching apps,
  switching tabs, hiding the page, leaving the page, or heartbeat timeout ends
  the session as abandoned and returns the student to the Test setup without
  recording a score.
- While another page instance is taking a countable Vocabulary Test, student
  cloud-backed features opened from other devices or tabs show a blocked
  session message instead of entering the student surface.
- Manual Submit opens an early-submit confirmation; time-up submission does not
  ask again. The visible button label is `Submit`, and the bottom Submit button
  uses the same gold glowing treatment as the Cloze-mode numbered capsules.
- The Vocabulary Test result modal has one action only: `Close`.
- After submission, Vocabulary Test answer feedback is written directly into
  each question blank using the same inline answer treatment as Vocabulary
  Learn. The countdown timer disappears completely and its right-side position
  changes into a compact `Redo` capsule, while the direct result count such as
  `7 / 10` appears centered on the next row below the numbered capsule row; the
  bottom of the Test view should not repeat a score block.
  After submission, the sticky word bank collapses by default and the far-left
  triangle word-bank toggle remains available for reopening it. The Test result
  area should not show `Score`, saved/not saved status copy, or appear above
  the test questions. Test question `?` explanation buttons appear only after
  submission or history review, not while a timed test is in progress; before
  those buttons appear, test prompts use the full question width, then reserve
  space for the `?` button after review state is available.
- Test set cards show their set number as a centered gold glowing capsule above
  the questions, not as a left-aligned Learn-style group marker.
- Student Vocabulary pages should not show a bottom-right floating `Redo`
  capsule. Redo actions belong inside the relevant task surface.
- Student Vocabulary views should not show a standalone bottom-right
  `Show Answers` capsule.

## 6. Status Labels

Preferred product labels:

| Backend | Student label | Teacher label |
| --- | --- | --- |
| `to_do` | TO DO | To Do / Working / Not started |
| `passed` | FINISHED | Passed / Finished |
| `mastered` | FINISHED + STAR | Mastered |

Teacher View assignment editing includes a `Can earn STAR` control. Turning it
off keeps future completions in `passed` / FINISHED and prevents new STAR
creation for that assignment, without revoking existing protected STAR records.
New Vocabulary assignments default to not earning STAR until the teacher turns
`Can earn STAR` on for the assignment.

Vocabulary assignments opened from the student Assignments view should enter
the normal vocabulary learning surface first, matching Library entry, so
students can study words before choosing Test mode themselves.

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
- My Words selection is allowed in answer, explanation, feedback, and result
  content regions, but should still avoid form controls, buttons, login
  dialogs, and teacher-only controls.
- On touch devices, My Words should preserve the captured word or phrase while
  dismissing the browser's native selection callout so the site save button is
  the primary action.

## 9. Future UI Improvements

- Clearer STAR counter labels.
- Better teacher progress filters by class and curriculum.
- More consistent modal/dialog style across practice pages.
- More compact teacher dispute resolution flow.
- A small deployment/version indicator for teacher troubleshooting.
