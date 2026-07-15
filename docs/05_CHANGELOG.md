# Changelog

> Product-level and architecture-level changes only.
> Do not record every tiny CSS tweak or variable rename here.

## 2026-07-15

### Changed

- Added the My Words-style browser pronunciation button to every Vocabulary
  Learn word card and Spell row. Both use local `en-GB` speech synthesis; Spell
  playback does not reveal or fill the hidden answer, and no backend or audio
  asset is required.
- Replaced the oversized student My Words surface with the approved compact,
  vertically centered modal. Search and Add now share matching top-right icon
  controls, Close sits outside below the card, manual entry is one Enter-to-save
  field, and review states/filters were removed. Word rows now use centered
  equal English/Chinese halves with a vertical divider, while pronunciation
  appears beside the phonetic only after expansion.
- Replaced the Student Library's always-visible gold sub-filter row with a
  title-inline `Library / current category⌄` control. Its anchored neutral
  popover closes after selection, outside click, or Escape and stays synchronized
  with category changes triggered by search or the Practice/Exam switch.
- Replaced the Student Dashboard's separate completion and four-week progress
  cards with one compact weekly-focus surface. It preserves the greeting and
  motivation, conditionally shows a muted-red overdue share, always shows
  China-time weekly completion from teacher-planned assignments, excludes
  self-study STAR records, and opens scope-filtered Assignment lists.
- Unified Teacher page-level modal behavior so notifications, attempt details,
  Student lookup/create, Review/Argue, assignment pickers/editors, matrix
  details, and practice-entry confirmation stay centered in the current
  viewport, use internal scrolling, and return to their parent surface on
  Close, Escape, or backdrop dismissal.
- Simplified Teacher Student lookup to direct row selection with an in-place
  search control, corrected the student-picker overlay stacking, kept Teacher
  navigation above workspace content, and normalized the raised-hand icon and
  header-logo sizing.
- Added practice-entry confirmation before Teacher View matrix task-header
  navigation and made the matrix responsive/user-resizable with `−`, `Fit`, and
  `+`; phone portrait can fit the normal six-to-seven-task overview while wider
  modes retain horizontal scrolling and full labels.
- Fixed Student assignment modal return/focus behavior when practice-entry
  confirmation is dismissed, while confirmed navigation still opens the
  selected assignment.
- Added `my-words-modal-preview.html` as an isolated, unlinked static design
  reference for the compact My Words modal. It contains sample-only data and
  does not call CloudBase.

Audit scope: commits `1f3fbec` through `4fcaa3d`, plus the static My Words
preview artifact committed with this documentation pass. All changes are
static frontend/documentation changes; no CloudBase function deployment or
data import is required.

## 2026-07-14

### Changed

- Removed the visible `STUDENT ENTRY` eyebrow from the login form while
  retaining its screen-reader heading and all existing authentication controls.
- Added an explicit rounded clip to the Teacher View matrix scroll viewport so
  sticky and colored header layers cannot leave small square tips inside its
  top-left or top-right corners.
- Moved the shared black full-body cat logo from the far right to the far left
  of both authenticated Student and Teacher headers, leaving all utility and
  account controls grouped on the right.
- Replaced the Student Dashboard's top-left line-art cat with the solid black
  full-body leaping-cat logo and placed the same mark at the far right of both
  authenticated Student and Teacher headers. The logo has a restrained idle
  motion, a reduced-motion fallback, and does not change existing header
  control hooks or behavior.
- Fixed the Teacher View matrix's phone-portrait `DUE AT` row alignment by
  making sticky first-column cells fill the shared grid track and applying the
  same compact padding, font size, and row height to `Student`, `DUE AT`, and
  Wxx cells below the 760px breakpoint.
- Applied the shared Liquid Glass presentation shell to login, public Library,
  Student Dashboard, and Teacher, then added spatial workspace layouts for the
  authenticated Student and Teacher surfaces without changing backend state or
  practice-runtime designs.
- Tightened desktop/mobile login and Dashboard spacing, kept the login page's
  randomized motivational quote, and refined Student notification, assignment,
  progress-loading, and practice-entry interactions.
- Refined Teacher View layout, Due/Wxx alignment, default View restoration, and
  grouped notification behavior while preserving the existing assignment,
  attempt, and unread-state rules.

Audit scope: commits `9f0b9b6` through `bd5c85d`. These changes are static
frontend/documentation updates only; no CloudBase deployment or data import is
required.

## 2026-07-13

### Changed

- Fixed BBC post-submit result colors so correct answers remain green and wrong
  answers use the Vocabulary-style light red; the yellow MC lock reminder no
  longer overrides known correct/wrong feedback.
- Allowed Login IDs to be reused after a completed student account deletion.
  Deleted profiles now keep the original ID in an audit snapshot and use an
  internal archive key, while recreated accounts receive a new `auth_uid` and
  do not inherit the deleted account's history.
- Added direct student-name editing to Teacher Student Detail so spelling
  corrections no longer require deleting an account.
- Renamed the Teacher View matrix's sticky `Due` label to `DUE AT` and matched
  its text edge, padding, font size, and weight to the `Student` header above;
  the shared grid already provides identical column boundaries.
- Matched the Teacher View matrix's sticky `Due` cell to the colorful
  Student/task header surface, and normalized the full Due/Wxx row's font,
  centering, height, padding, and borders to keep every column aligned.
- Limited the Teacher notification card to roughly three-quarters of the
  viewport height with internal scrolling, and replaced its top-right `x` with
  a centered external `Close` capsule below the card.
- Fixed Teacher View's `Due` row so every assigned task displays the `Wxx`
  grouping label moved from the old header position, including legacy tasks
  without a `due_at` value.
- Removed `Wxx` from the first Teacher View header row so it contains only the
  task ID and set name, and restored header clicks as direct task-preview links.
  The separate `Due / Wxx` cells now open the class-wide parameter editor for
  due date, passing, mastery, Earn STAR, and the other assignment settings.
- Made student-bell assignment rows shorter and fully clickable. The rows now
  keep a compact type label, a one-or-two-line title, an optional finished score,
  and a directional cue instead of separate `Start` / `Open` buttons; opening a
  row uses the shared Library practice-entry confirmation before navigation.
- Unified the teacher header bell, Argue hand, and student-card controls as
  matching 40px circular icon buttons. All three now share the same surface,
  hover/focus treatment, 20px icon size, and 2.2px non-scaling line weight;
  the hand and student-card artwork were adjusted for equal visual weight.
- Refined the student Dashboard monthly-progress loading state: the four-week
  grid now advances through a staggered diagonal cell wave, and the detail side
  uses one large loading capsule with `Loading progress` inside instead of two
  stacked capsules plus separate text.
- Reworked teacher notification rows with a fixed right-side latest-score
  capsule matching By student, single-line ellipsized task labels, and colored
  attempt-count capsules placed immediately before the date/time.
- Replaced the teacher notification modal's text heading with an action toolbar.
  `Read all` is now a left-aligned accessible double-check icon with pending,
  success, unread, and disabled states; Close remains on the right and the
  middle space is available for future controls.
- Added `Next week - Wxx` to the Teacher View Date filter, using the next
  Beijing-time Monday-to-Sunday range from assignment `assigned_at`.
- Added a full-width Due row immediately below the original Teacher View task
  header: its first cell reads Due and each task cell shows only Wxx. Clicking a
  Due/Wxx cell opens one bulk parameter editor for the current class/visible
  column, covering assign week, due date, passing, mastery, and Earn STAR across
  all represented students; task-header clicks open the task itself.

## 2026-07-12

### Changed

- Made shared My Words lexicon joins resilient: dictionary lookups now use
  CloudBase-safe batches of ten and fall back to per-word reads instead of
  silently leaving every card in a pending state when one batch fails.

- Simplified collapsed My Words cards to word, part of speech, Chinese meaning,
  and pronunciation, with details on expansion; added New/Learning/Mastered
  states and rule-based daily reveal-and-rate review without AI calls.

- Changed shared practice `Back` navigation to use one verified browser-history
  step when the previous same-origin page matches the safe return target. This
  restores the existing Library/Dashboard instance through back-forward cache,
  while direct links and uncertain history still use the safe URL fallback.

- Unified student and Teacher View `By student` monthly-progress task details
  with the teacher matrix visual hierarchy: full wrapping task titles now take
  priority, with compact task-type and best-score metadata aligned together on
  the right for iPad and smaller layouts.

- Upgraded My Words with immediate-save dictionary enrichment, a shared curated
  and optional ECDICT lexicon, cached external English dictionary fallback,
  phonetic/POS/definition display, pronunciation, retry throttling, and import
  tooling for the shared lexicon.

- Made Teacher View matrix task headers open their corresponding teacher
  practice preview and return to Teacher View.

## 2026-07-11

### Changed

- Made completed-task capsules in the student Dashboard four-week progress
  board reopen their task through the shared practice-entry confirmation.

- Simplified IELTS Reading set headers and paragraph-matching choices, made
  typed blanks follow answer length, and persisted both passage and question
  highlights in browser storage with per-highlight and clear-all controls.

- Added Vocabulary content/grading version handshakes and server-side answer
  snapshots for countable tests. Stale pages are rejected before grading,
  active tests retain their start-time grading rules, drafts are isolated by
  content version, and release checks now validate all Vocabulary JSON/JS,
  Word Bank, and question-key structure.
- Added a teacher-only, dry-run-first historical repair for Vocabulary
  content-version mismatches. It identifies whole attempts from multiple legacy
  answer signatures and regrades only upward while preserving original history.
- Locked CloudBase SDK versions and changed cloud-function ZIP generation to
  bundle reachable runtime dependencies. Deployments no longer drift with npm
  range resolution or exceed the CloudBase code-unzip limit because an online
  installer expanded the full SDK dependency tree.

- Changed the student Dashboard progress board so the completion meter centers
  its `Finished / total` value, week labels open weekly completion summaries,
  blank selections stay visually quiet, and loading states reserve the meter and
  board layout before dashboard data arrives.
- Changed student Dashboard assignment reminders to live in the top-right bell:
  the bell now opens a message center with open assignments, finished
  assignments, and teacher replies, while open-assignment counts only clear when
  assignments are completed.

## 2026-07-10

### Changed

- Changed the student Dashboard top billboard into a four-week progress board:
  students now see recent completion squares with weekday/week labels, summary
  counts, and a selected-day completion detail pane before the assignment list.
- Changed the Dashboard billboard summary from three separate count cards into
  one completion progress bar, and expanded the randomized greeting and
  motivational copy shown above the progress board.

## 2026-07-09

### Added

- Added shared practice navigation with explicit `Back` and `Home` controls.
  Student practice returns now use safe same-origin `return` targets from
  Dashboard or Library, while teacher previews return to Teacher Library.
- Added static no-answer worksheet PDF downloads for all current BBC listening
  lessons, exposed through a top-corner `Download Practice` button on
  `bbc.html`.
- Added exam-style no-answer worksheet PDF downloads and fold-and-cover
  wordlist PDF downloads for all current NGSL, NAWL, Oxford5000, and THINK2
  Vocabulary units, with full-unit download links and generated single-set PDF
  files.
- Added a Vocabulary `Practice` download dialog with `Confirm` for the static
  full worksheet and `Customise` for selected-group worksheet PDFs, including
  per-group word-bank/question shuffling from a visible randomiser seed.
- Updated the Vocabulary PDF controls to use document/download icons with
  `Wordlist` and `Practice` labels, and removed the per-set download button from
  inline Study Set practice.

### Changed

- Changed Vocabulary inline practice `?` explanations so students can reveal a
  question's answer and explanation before clicking `Check`; private-answer
  units load only the selected question's feedback from the backend.
- Changed practice and catalog static-data fetches to use the public
  `appVersion` cache key instead of timestamp cache busting, so normal browser
  caching and back/forward restoration can keep practice pages faster while
  still refreshing after version bumps.
- Added a Teacher Assign task-parameters area for Week/Date scheduling,
  passing percentage, and explicit `Earn STAR` selection. New assignments now
  default to no STAR earning unless the teacher checks `Earn STAR`; checked STAR
  assignments require `Mastery %`.
- Changed Teacher Assign pickers so Work and Students can be chosen in either
  order. The opposite picker now color-codes prior assignment state, disables
  open `in_progress` pairs, and keeps completed pairs selectable for
  reassignment.
- Changed Teacher Assign selected Work/Students summaries to show one selected
  item per row with a small remove control, and removed the student picker's
  `Select filtered` bulk-select button.
- Changed Teacher Assign task parameters into a per-selected-task matrix. Each
  task now has its own date/week, passing percentage, and optional Earn STAR /
  mastery setting in the same Assign submit.

## 2026-07-08

### Added

- Added `THINK2-U12` as a TK2 Vocabulary unit with 36 words, 4 quiz groups, and
  private CloudBase grading data.
- Added `Oxford5000-R`, `Oxford5000-S`, and `Oxford5000-T` as Oxford5000
  Vocabulary units, covering words `1701-2000` with 30 quiz groups and private
  CloudBase grading data, bringing Oxford5000 coverage to `001-2000`.

### Changed

- Changed NGSL, NAWL, and Oxford5000 Library task capsules so the eyebrow reads
  `vocabulary` and the top-right metadata shows the source word-number range,
  while keeping the main card title unchanged.
- Changed Student and Teacher Library BBC practice entry points from one `BBC`
  sub-filter into `BBC2024`, `BBC2025`, and `BBC2026` year-specific sub-filters.
- Changed BBC Argue question controls from an orange `!` to a raised-hand SVG,
  and added the student's submitted answer to the `Tell me why.` dialog before
  the reason textarea.
- Fixed BBC completed-attempt entry so a passed/mastered history URL can
  automatically render Explain and Argue controls without requiring students to
  press `History` first.
- Added a BBC `classroom-worksheet` render theme and applied it to the 2024 BBC
  lessons for review, giving those pages a worksheet-style paper layout with
  serif exam-style lesson titles, compact question numbering, boxed fill-in
  blanks, a default `Notes` fill-in section, section-local text-size controls,
  separated fill-in rows, rounded multiple-choice option boxes, and
  English-name-only student identity in the audio bar.
- Changed the Vocabulary mode switcher label from `Use` to `Cloze`, aligned
  Cloze timing to 90 seconds per selected group in the frontend and
  `submitAttempt`, and removed empty `None selected` / `Nothing selected`
  placeholders from the Teacher Assign work/student pickers.

## 2026-07-07

### Added

- Added `Oxford5000-A`, `Oxford5000-B`, `Oxford5000-C`, `Oxford5000-D`,
  `Oxford5000-E`, `Oxford5000-F`, `Oxford5000-G`, `Oxford5000-H`,
  `Oxford5000-I`, `Oxford5000-J`, `Oxford5000-K`, `Oxford5000-L`,
  `Oxford5000-M`, `Oxford5000-N`, `Oxford5000-O`, `Oxford5000-P`, and
  `Oxford5000-Q` as the first Oxford5000 Vocabulary units, covering words
  `001-1700` with 170 quiz groups and private CloudBase grading data.
- Added countable Vocabulary Test integrity sessions through
  `vocabulary_test_sessions`: 5+ group tests now create a server session before
  questions appear, heartbeat while active, validate `test_session_id` on
  submit, and grade the session's recorded question IDs.

### Changed

- Restored the current NAWL vocabulary units in Library while keeping old
  superseded NAWL letter records retired in CloudBase.
- Changed Student and Teacher Library to use only `Practice` and `Exam` as
  top-level filters, with lesson sections folded into Practice.
- Split Vocabulary surfaces into `NGSL`, `NAWL`, `TK2`, and `Oxford5000`
  capsules/labels in Student Library, Teacher Library, Teacher Assign filters,
  Teacher View matrix type filters, and student assignment cards; removed the old Library
  `Vocabulary`, `Grammar`, `Writing`, and `Grammar Lessons` sub-filters.
- Changed teacher notification read behavior: opening the bell clears the
  header badge, while red attempt rows remain until the teacher opens a related
  attempt for that same student assignment.
- Changed countable Vocabulary Test anti-cheat behavior so switching apps/tabs,
  hiding/leaving the page, heartbeat timeout, or session expiry abandons the
  session without recording an attempt or changing assignment status.
- Changed the Vocabulary Test start confirmation to remind students to turn on
  Do Not Disturb before starting.
- Changed Vocabulary Use timing from 2 minutes per selected group to 1.5
  minutes per selected group.
- Changed the Vocabulary Test interruption notice to show a clear `Close`
  dialog when a student returns after leaving the page or switching windows.
- Changed Teacher Assign success feedback from the small page message line to
  a standalone checkmark dialog with a bottom `Close` button.
- Fixed Vocabulary Test `Redo` so the Start button returns to a clickable
  `Start` state after clearing a completed review.
- Blocked other devices or browser page instances from student cloud-backed
  features while the same account has an active countable Vocabulary Test.
- Changed the client page-instance identifier to per-page-load memory state so
  cloned/new tabs cannot inherit the active test's owner ID.

## 2026-07-03

### Changed

- Changed Teacher View matrix assignment columns to show `Wxx` week labels based
  on Beijing-time assignment dates, with `W00` before the year's first Monday,
  and to keep repeated assignments of the same set as separate columns.
- Replaced the teacher student enable/disable UI with account deletion: deleting
  removes the CloudBase Auth end user, marks the student profile deleted, and
  hides the student from teacher-visible lists and progress surfaces.
- Changed Teacher View matrix date filtering to use Beijing-time natural weeks
  based on assignment `assigned_at`, and added a separate `Self study` date
  option for records without an assignment.
- Changed new Vocabulary assignments to default to STAR earning disabled; a
  teacher must turn `Can earn STAR` on from View before the assignment can
  become mastered / earn STAR.
- Changed Teacher View matrix cells so completed assignments with STAR earning
  disabled show a green check instead of a star.
- Changed teacher notification attempt details to render outside the
  notification list scroll body, preventing the first-open dialog from
  appearing unusually short.
- Changed finished Vocabulary assignment cards to open the Learn entry like
  Library cards instead of automatically entering Test/History mode.
- Refined Vocabulary Learn so numbered group capsules stay in a sticky learning
  bar while the word bank appears only after `Go to Practice`, expands and
  collapses more slowly, omits extra labels and controls, and collapses when
  students scroll back into the word-card area.
- Changed Vocabulary inline practice so `Check` turns into a score plus inline
  `Redo`, removes `Clear All` and floating Redo controls, and writes answer
  feedback directly into each blank.
- Changed Vocabulary inline practice choice panels to shuffle word choices per
  question, preventing the visible choice order from matching the answer order.
- Refined Vocabulary inline practice feedback: wrong answers use a static
  light-red state, the score shows only correct/total, action pills are
  centered, and the per-blank choice panel opens as a floating overlay with a
  final blank underline chip instead of a `Clear` button.
- Changed unanswered wrong Vocabulary inline practice blanks to display `X`
  instead of `No answer`.
- Restored Vocabulary inline practice explanations for local checks.
- Changed Vocabulary inline practice explanations to use always-visible `?`
  buttons with floating popovers, and removed the wrong-card pulse animation.
- Changed Vocabulary inline practice so every question card renders the `?`
  explanation button, even before the popover is opened.
- Refined Vocabulary Test mode with a sticky numbered test-set bar and inline
  timer, number-only test-set labels, Learn-style inline answer feedback after
  submit, a `Submit` button label, a top timer position that becomes `Redo`
  after submission, and a centered top correct/total result.
- Refined Vocabulary Test mode so the sticky test-set bar includes the current
  set's word bank below the numbered capsules and updates both the active
  number and word bank while scrolling between test sets.
- Refined Vocabulary question explanation controls so sticky Learn/Test word
  banks layer above `?` buttons while scrolling, `?` buttons stay optically
  centered on iPad, and Test results show only the direct correct/total count.
- Refined Vocabulary Learn/Test sticky word banks with a triangle toggle that
  preserves the student's manual open/closed choice, and hid Test explanation
  `?` buttons until submission or history review.
- Refined Vocabulary Learn/Test sticky bars to sit as an opaque top layer while
  scrolling, made Vocabulary Use set capsules gold-glowing with centered gold
  test-card set badges, and let Test prompts use full width before post-submit `?`
  explanation buttons appear.
- Refined Vocabulary Test number rows so larger selected test ranges scroll
  horizontally while the timer stays fixed at the right.
- Refined Vocabulary Learn/Use word-bank controls so the triangle sits in a
  fixed far-left rail outside the horizontally scrolling number capsules, while
  Use keeps the red countdown timer at the right and shows `Redo` there after
  submission.
- Changed the Vocabulary mode switcher labels to `Learn`, `Spell`, and `Use`
  while preserving the existing underlying spelling and timed-test flows.
- Fixed Vocabulary inline practice `Check` so local-answer units no longer call
  CloudBase, and legacy units show a friendly login/session message instead of
  the raw `t.scope` SDK error.
- Removed auto-numbering from Vocabulary practice word-bank chips and removed
  the plus/minus font controls from vocabulary practice cards.

## 2026-07-02

### Added

- Added assignment-level `mastery_enabled` support so teachers can turn off
  future mastered/STAR earning for selected assignments while still allowing
  passed / FINISHED completion.

### Changed

- Vocabulary assignments opened from the student dashboard now land on the
  normal learning entry first instead of automatically restoring/entering Test
  mode.
- Merged the Vocabulary word list and practice flow into `Learn`: numbered
  Study Set filters now expose inline `Go to Practice` practice cards, with a
  score shown beside `Check Answers`.
- Removed the duplicate in-view Words heading and search box from Vocabulary
  Learn.
- Removed the student Vocabulary bottom-right `Show Answers` capsule while
  keeping the submitted Test review `Redo` capsule.
- Raised the student `Change password` dialog above the account panel so it is
  the topmost surface after opening from the profile menu.

## 2026-07-01

### Changed

- Updated teacher View matrix filters so `Class`, `Column`, and `Date` default
  to all records in one compact unlabeled row; date filtering now offers
  `This week`, `Last week`, and `All time` based on assignment time, and
  unclassed student options show the student name without an `Individual`
  prefix.
- Added a compact paper icon button to each teacher matrix/notification attempt
  card so teachers can open that attempt's full-work review, including all
  recorded questions, submitted answers, correctness, correct answers, and
  attempt-history context.
- Added a sticky Study Set filter row to Vocabulary Words so students can jump
  between `All` words and numbered study-set word groups while keeping search
  scoped to the selected group.
- Updated BBC history review so passed/mastered historical attempts
  automatically show per-question Explain/Argue icon entry points on entry,
  while below-passing attempts keep those actions hidden.
- Fixed BBC multiple-choice question spacing so the stem and choices use the
  available width on iPad/tablet layouts instead of reserving action-button
  space before the buttons exist.
- Updated My Words so students can save selected text from answer/explanation
  content and manually add a word or phrase from the My Words dashboard view.

## 2026-06-30

### Fixed

- Fixed BBC finished-assignment review so multiple-choice answers are restored
  and locked after the first submitted attempt, preventing students from
  changing MC choices when reopening finished work.
- Changed teacher bell attempt details to use the same modal layout as View
  matrix cells, showing the full attempt history while scrolling to the
  clicked attempt.
- Kept teacher matrix-style modal Close actions fixed at the bottom while
  long attempt histories scroll above them.
- Changed submitted Vocabulary Test review to use the bottom-right floating
  `Redo` capsule and removed the old page-bottom Redo button.
- Updated teacher assignment creation so prior completed Library/Explore work
  initializes the new assignment as already passed or mastered, making it
  visible as completed in teacher progress views.
- Updated BBC practice so desktop Space toggles audio when no answer/control is
  focused, moved BBC Explain/Argue into compact question-box `?`/`!` icon
  buttons, and changed the teacher Review icon to `!`.

## 2026-06-24

### Added

- Added audio-to-submit timing for audio practice attempts and displayed
  teacher attempt timing as `Page ... · Audio ...` when available.
- Moved teacher student lookup into a top-right standalone modal with an
  internal create-student `+`, leaving the View page focused on the matrix.
- Changed teacher View `By student` groups into a full-width student history
  list where each task shows its best percentage and opens the same matrix
  detail modal used by matrix cells.
- Changed the teacher header student entry to a circular student ID icon and
  fixed the lookup modal's Choose/Search student list so it expands and scrolls
  inside the modal.
- Removed the teacher View `By class` progress mode, made the remaining
  `By student` / `By task` capsule sticky over the main View tabs, and changed
  `By task` summaries to show only Total and an Avg that excludes unfinished
  assignments.
- Changed teacher View `By task` score bars to open the same independent
  detail modal as matrix cells instead of expanding inline details.
- Added an independent student timeline modal from the matrix student-name
  column so teachers can inspect a student's overall assigned-work history.

## 2026-06-23

### Added

- Added assignment-level teacher management for selected assignment records,
  including due date, passing percentage, mastery percentage, and soft
  cancellation of open assignments.
- Added backend `cancelled` assignment state with audit fields. Cancelled work
  is hidden from the student dashboard and teacher View progress, rejected by
  old assignment submit links, preserves historical attempts, and does not
  block reassignment.
- Made the teacher page open to `View` by default and added a textless animated
  matrix loading state with visible grid lines and a centered spinner.
- Added a soft fade/lift transition for the first successful teacher matrix
  render so loaded data does not appear abruptly.
- Restyled the teacher interface with the selected warm animated rainbow theme
  while keeping progress status colors readable.
- Added compact spinner loading states for the teacher header icon buttons and
  removed separate rainbow underline accents from header capsules.
- Reduced repeated rainbow fills in grouped progress items below the teacher
  matrix so student capsules and stats stay visually quiet.
- Restored the teacher matrix cell detail as an independent page-level modal
  and kept the grouped progress mode tabs visually quiet.
- Widened the teacher page shell on desktop so the default View matrix adapts
  to available horizontal space.
- Added lightweight BBC MC option click feedback: a soft bell sound and a
  right-side `✦` marker, with the blue render theme using a blue marker.
- Fixed the teacher View matrix layout so wide task sets scroll horizontally
  inside the matrix card instead of widening the whole page.
- Updated teacher View matrix interactions so touch devices can still scroll
  the page vertically, notification attempt details open independently of the
  matrix, and unclassed students can be filtered as individual Class options.

### Fixed

- Fixed student and teacher practice-entry dialogs so they close before
  navigation and do not reappear when browser Back returns from a practice page.

## 2026-06-22

### Changed

- Simplified the teacher View matrix toolbar to only `Class`, `Column`, and
  `Date`, with `Date` defaulting to `This month`.
- Adjusted teacher View matrix status colors so `Not yet` is neutral white,
  while `Passed` and `Mastered` share the same green cell background;
  `Mastered` uses a solid green circle with a white star.

### Fixed

- Fixed BBC History result coloring so server-adjusted correct answers from
  Argue/backfill clear stale wrong and local lock classes before rendering.
- Fixed teacher bell attempt notifications so retry attempts can open the View
  matrix detail even when the assignment completion date differs from the
  clicked attempt date.

## 2026-06-21

### Changed

- Adjusted the student Assignments navigation count to float outside the glass
  tab and added a stronger golden glow to the `Show Finished` capsule.
- Simplified the student account panel footer into two small action capsules
  and removed the `Password change required` account-panel field.
- Changed `Show Finished` to stay bottom-docked while collapsed and reveal
  finished work with the selected golden ribbon effect when opened.
- Moved student account-panel stars onto the name row and normalized profile row
  height/divider spacing.
- Changed practice-page return controls from `Home` to confirmed `Back`
  behavior that returns one browser-history page with a dashboard fallback.
- Tightened the teacher View matrix student-name column so it sizes to the
  visible names instead of reserving a wide fixed column.
- Changed teacher View matrix status cells to the selected icon-plus-color
  treatment: orange `Not yet`, green check `Passed`, and glowing gold-star
  `Mastered`.
- Added a front-end Vocabulary Test lock flow: start warning dialog, locked Test
  view while timed work is active, early-submit confirmation, time-up automatic
  submit, and post-result wrong-question marking.
- Changed Vocabulary Test post-submit review so the result modal has only one
  Close action, wrong questions reveal inline explanations, and Redo is a
  separate confirmed action from the reviewed test page.

### Fixed

- Fixed BBC History from the student Library entry by letting `bbc.html` resolve
  the current student's best attempt for the set when the URL does not include
  `history` or `assignment` context.
- Returned the resolved `assignment_id` from `submitAttempt` so a Library-opened
  assignment submission can keep follow-up answer reveal actions linked to the
  assignment.
- Added a Close action to the BBC Argue sent/thanks dialog for both student
  submissions and teacher-preview Argue submissions.
- Changed teacher Argue `add`/`replace` resolution to automatically scan
  historical attempts for the same set/question/submitted answer and apply
  upward-only score, assignment, and STAR repairs.
- Added a teacher-only paginated `backfillAcceptedAnswerRegrades` action for
  repairing historical attempts against current grading keys after older Argue
  approvals.

## 2026-06-20

### Changed

- Changed the student Assignments `Show Finished` / `Hide Finished` control
  from a stamp treatment to a lower-positioned gold capsule matching the
  Library badge style.
- Changed the student dashboard top billboard to a pale aurora-rainbow
  animated background while keeping its existing content and layout.
- Changed the student main navigation and student Library category tabs to a
  soft translucent glass style with subtle rainbow active states.
- Standardized message and unread reminder dots/badges to red across student
  and teacher surfaces.
- Changed the teacher create-student modal to a vertical field layout and added
  a checkmark confirmation dialog after successful account creation.
- Renamed the teacher `Tasks` tab to `Assign` and changed the top-right Review
  entry to a question-mark icon button.
- Simplified teacher `Assign` so the main surface shows only selected work
  and student chips, while search, filters, and candidate selection live in
  standalone picker dialogs.
- Updated teacher `Assign` to merge visible static catalog items missing from
  CloudBase `sets` as disabled import-required rows, so newly published BBC
  lessons are visible while CloudBase import state is checked.
- Increased teacherAdmin content read limits for `sets` and `grading_keys` so
  teacher Assign/View surfaces still resolve content after repeated CloudBase
  imports push collection counts beyond 200 records.

### Fixed

- Updated `submitAttempt` so Library/Explore submissions automatically attach
  to the student's open assignment for the same `set_id` when the browser does
  not pass an `assignment_id`.
- Replaced fixed first-page backend reads in `teacherAdmin`, `getDashboard`,
  and `getResources` with paginated reads for assignment, attempt, set, student,
  dispute, and STAR data.
- Changed assignment submission to recompute assignment summary fields from
  linked attempts after recording an attempt, reducing stale summary and
  duplicate-click race issues.
- Updated teacher progress display to derive finished status from linked
  attempts when assignment summary fields are stale.
- Updated the teacher View matrix to render every student matching the current
  filters instead of only the first 12 sorted rows.

## 2026-06-19

### Changed

- Simplified student Assignment task capsules to match Library card density and
  replaced the finished drawer control with a sticky stamp-style `Show
  Finished` / `Hide Finished` entry without counts.
- Made student Assignment cards open the original task when the card body is
  clicked, while preserving explicit button actions.
- Split the student account panel STAR row into yellow assigned-task stars and
  blue self-study/library stars.
- Changed finished Assignment card actions from `Improve Accuracy` / `Beat Your
  Best` text buttons into clickable `PASSED` / `MASTERED` stamps.
- Removed `Go` buttons from student/teacher Assignment and Library capsules so
  the whole capsule opens the practice item while explicit secondary buttons
  keep their own actions.
- Simplified teacher `Assign` into two minimal multi-select panels: `Work` with
  search and `Column`, and `Students` with search and `Class`.
- Moved teacher Review out of Tasks into a top-right icon button that opens an
  independent modal with Pending, Approved, and Rejected tabs.
- Changed the teacher notification bell into a standalone attempts-only modal;
  clicking an attempt opens the matching View matrix detail and highlights that
  specific attempt.
- Reversed the top-right create-student `+` styling to the same light button
  with purple icon treatment as the Review and notification buttons.
- Aligned teacher Assign Work-list ordering with the matching Library column's
  natural date or numeric sort.
- Expanded teacher matrix detail dialogs with answer-view lock status and a
  latest-attempt wrong-answer comparison table.
- Redesigned teacher matrix detail dialogs around a title/pill header,
  clickable attempt score bars, and newest-first wrong-answer attempt cards.
- Refined teacher matrix detail bars: centered the outside Close button,
  prevented single attempts from stretching full width, and mapped bar colors
  to not-passed, passed, and mastered states.
- Simplified teacher matrix score-lock pills so the lock icon appears only
  after answers have been viewed and locked.
- Redesigned the student login page around a bright floating-paper welcome
  ritual with lightweight listening, vocabulary, writing, and speaking motion
  elements.
- Added task names under task IDs in the teacher View matrix header.
- Moved the create-student shortcut into the teacher Personal Center, centered
  the panel title, and removed the account status row.
- Moved create-student to a single top-right header `+` beside notifications
  and changed account creation into a standalone modal.
- Replaced the task-entry browser confirmation with a shared custom dialog for
  student Assignment/Library and teacher Library capsules, including status and
  best-score reminders.

## 2026-06-18

### Changed

- Refactored the student dashboard around `Assignments`, `My Words`, and `Library`.
- Moved student account actions and teacher replies into the top-right account/message controls.
- Replaced student assignment status tabs with a default TO DO list and a collapsed `Finished & Wins` achievement drawer focused on completed-count momentum.
- Refactored the teacher desk around `Tasks`, `View`, and `Library`.
- Moved teacher `Review` under `Tasks`, changed `Updates` into a notification bell, and added a progress matrix to `View`.
- Changed Vocabulary default thresholds to `80%` passing and `100%` mastery,
  while other current content keeps the `50%` / `90%` defaults.
- Added a failed Vocabulary Test result action that lets students return to
  group selection and start a fresh test.
- Unified student and teacher Library capsules, simplified DSE labels, moved
  student STAR counters into the account panel, and added class filtering to the
  teacher assignment matrix.
- Expanded teacher `View` with `By student`, `By class`, and `By task` progress
  groupings, low-to-high task score bars, clickable single-assignment details,
  and scoped due/pass/mastery editing for existing assignments.
- Standardized student and teacher Library ordering so BBC follows release
  date and IELTS follows Cambridge book, Test, then Section/Passage.
- Replaced the student Assignments achievement drawer summary with a smaller
  `Finished` completion button focused on total completed count.
- Moved the yellow IELTS book/tag visual treatment out of task cards and onto
  the Library sub-tab layer.
- Clarified IELTS Library card labels and simplified the student account panel
  into quiet profile rows with stars and finished count.
- Aligned student Assignment task capsules with the compact Library task card
  structure.
- Added class, recent-task count, and column controls to the teacher View
  matrix, removed the top summary cards from View, and made matrix cells open
  per-student assignment attempt details.
- Refined the teacher View matrix: `Recent` now defaults to 7, the toolbar has
  a `Date` basis selector, the student list shows names only, and clicked cells
  show teacher-only correct answers for wrong questions.
- Updated the teacher View matrix controls to `Class`, `Column`, `Recent`,
  `Date`, changed `Date` to week/month/custom range filtering, and moved matrix
  cell details into a floating dialog with a close button.
- Added front-end-only BBC `renderTheme` support and applied the `blue-studio`
  theme to `BBC-250619` and `BBC-250626` without changing grading IDs or
  attempt behavior.
- Adjusted My Words touch handling so mobile and tablet selection can show the
  site save button without leaving the browser's native selection callout over
  the interaction.
- Renumbered NAWL vocabulary units as an independent sequence from `NAWL-A` to
  `NAWL-J`, instead of continuing the NGSL letter sequence.

### Documentation

- Updated the UI/UX spec for the new student and teacher navigation model.
- Documented the independent NAWL vocabulary ID rule for future imports.

## 2026-06-16

### Added

- Added the human-readable documentation system under `docs/`.
- Added product requirements, architecture, UI/UX, data model, decisions, testing checklist, backlog, deployment/content/troubleshooting entries.
- Added `docs/09_CONTENT_WORKFLOW.md` and `docs/10_DEPLOYMENT.md` as numbered documentation entry points.
- Added owner-gated release helper scripts for verification, function packaging, and deploy-plan generation.
- Added owner-run CloudBase CLI content import helper with dry-run and insert-missing apply mode.

### Changed

- Moved product requirements into `docs/01_PRODUCT_REQUIREMENTS.md`.
- Moved technical repeated-issues log into `docs/11_AGENT_TROUBLESHOOTING.md`.
- Kept root-level pointer files for stable links.
- Replaced the root README with a current project entry point and document map.
- Updated `AGENTS.md` reading order and documentation update rules.
- Documented that agents may prepare release artifacts but must not execute CloudBase deployment without exact owner authorization.

### Fixed

- Backend source now keeps assignment status monotonic across lower-scoring retries.
- Teacher assignment source now allows completed/STAR work to be reassigned.
- Argue regrading source now creates or repairs STAR records when mastery is reached.
- Student dashboard/submit cloud functions now reject teacher profiles.

### Documentation

- Documented the intended long-term docs workflow.
- Documented repeated technical failure modes for future Agent handoff.

## 2026-06-15

### Added

- Added personal My Words feature with a `studentVocabulary` cloud function and shared selection UI.
- Added dashboard My Words panel.

### Changed

- Confirmed student dashboard uses `TO DO` and `FINISHED`, while backend keeps `to_do`, `passed`, and `mastered`.

### Fixed

- Fixed IELTS Listening teacher preview audio startup.
- Fixed mobile student assignment capsule layout.
- Blocked personal vocabulary saves from answer/result/feedback regions.

## 2026-06-13

### Added

- Imported BBC June/July listening lessons.
- Created Agent QA memory file.

### Changed

- Strengthened BBC import workflow and CloudBase import notes.
- Clarified Vocabulary runtime and fallback behavior.

### Fixed

- Fixed BBC blank placeholder length issue.
- Documented CloudBase JSON Lines import requirement.

## 2026-06-12

### Added

- Added Teacher Argue grouped task view.
- Added backend STAR and assignment mastery model.
- Added teacher Library answer preview through `teacherAdmin`.

### Changed

- Assignment statuses moved toward `to_do`, `passed`, and `mastered`.
- Student dashboard STAR count became backend-backed.
- Assignment thresholds can be set by teacher.

### Fixed

- Separated teacher answer reveal from student answer reveal.
