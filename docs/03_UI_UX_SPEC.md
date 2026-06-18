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

## 3. Student Dashboard

Navigation:

- `Assignments`
- `My Words`
- `Library`

Assignments display:

- open `TO DO` assignments directly
- a small bottom `Finished` completion button for completed work

Backend statuses:

- `to_do`
- `passed`
- `mastered`

Frontend rule:

- `passed` and `mastered` both appear inside the collapsed `Finished` completion button.
- Do not split the student dashboard back into `PASSED` and `MASTERED` tabs unless the owner explicitly changes the product rule.
- The finished control is a compact sticky stamp-style button inspired by the
  BBC result stamp. It reads `Show Finished` when collapsed and `Hide Finished`
  when expanded. Keep the visible control to a check icon plus that label; do
  not put counts or extra action text inside the stamp.
- Student messages and account actions live in the top-right chip/bell area, not as a main navigation tab.
- Student STAR counters live inside the top-right account panel, not in the always-visible header.
  Show assigned-task stars as the yellow counter and self-study/library stars
  as the blue counter beside it.
- The student account panel should be quiet: no separate achievement card, no
  large account action buttons, and stars/finished count should sit alongside
  Student ID, Class, and System as profile rows.

Student cards should show:

- the same compact task capsule structure used by Library task cards
- title
- `PASSED` / `MASTERED` stamp-style state for finished work
- STAR state if mastered
- the whole card opens the original task when clicked, except for explicit
  buttons such as Teacher replies or Get Star

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

- `Tasks`
- `View`
- `Library`

### Tasks

Tasks contains:

- `Assign`
- `Review`

Review is the teacher-facing surface for student Argue requests.

### Assign

Teacher can:

- select one or more work items from a quiet `Work` panel
- filter work with one search field and one `Column` select
- sort filtered Work items with the same natural order used by the matching
  Library column, such as BBC date order or IELTS numeric book/test order
- select one or more students from a quiet `Students` panel
- filter students with one search field and one `Class` select
- assign the selected work to the selected students

The Assign surface should stay visually minimal: no visible multi-step
accordions, no legend, no bulk-select button, and no visible due/pass/mastery
fields in the default flow. Assignment creation continues to use the existing
server-side validation and default thresholds.

Candidate states:

- `Available`: selectable
- `In Progress`: not selectable
- `Completed · can reassign`: selectable
- `STAR · can reassign`: selectable

### View

View is the teacher's progress and student-inspection surface.

It should include:

- an assignment matrix/table for scanning completion by student and task, with class, column, recent-task count, and date-range filters plus responsive horizontal scrolling on small screens
- matrix filters appear in `Class`, `Column`, `Recent`, `Date` order; `Class` defaults to `All`, `Column` defaults to `All`, `Recent` defaults to `7` and is a numeric select from 1 through 20, and `Date` offers `This week`, `This month`, or a custom from/to calendar range
- the matrix student column shows only the student name, without Login ID or class
- clickable matrix cells open a floating dialog with a close button for the student's records for that set, including attempt dates, time spent, scores, a latest-attempt wrong-answer comparison with student answers and correct answers in separate columns, and teacher-only correct answers
- the matrix detail dialog shows whether assignment answers have already been viewed and locked (`Answers viewed · locked`) or not (`Answers not viewed`)
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
opens the practice item; do not add a separate `Go` action.
BBC cards show a year badge; IELTS task cards should not show the Cambridge
book badge inside each task capsule. IELTS book/filter labels belong in the
yellow capsule tab layer above the task list. DSE labels should read
`DSE Reading`, `DSE Writing`, `DSE Integrated`, and `DSE Speaking` without
visible Paper numbers. Keep this capsule shape when changing Library grouping,
tabs, or filters.
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

Review should be grouped into task capsules so the teacher can handle one student attempt or assignment at a time.

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

### Vocabulary Test

- The test countdown timer is fixed at the top-center of the screen with red text on a light-red background to create a sense of urgency.
- A not-passed Vocabulary Test result offers `Choose Again`, which clears the
  current test view and returns the student to the group-count selector for a
  fresh start.

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
