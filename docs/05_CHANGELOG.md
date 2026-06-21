# Changelog

> Product-level and architecture-level changes only.
> Do not record every tiny CSS tweak or variable rename here.

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
