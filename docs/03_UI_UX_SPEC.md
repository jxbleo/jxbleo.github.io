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

### Shared System Shell

The login page, public Library, student Dashboard, and Teacher desk share a
neutral Liquid Glass system shell. On login and public Library this remains a
presentation layer only and must not move existing controls or alter page
information architecture. The authenticated Student Dashboard and Teacher desk
may arrange their existing controls into the approved spatial workspace
layouts, but must preserve JavaScript hooks, navigation targets, modal behavior,
and all business rules. Practice runtimes (`bbc.html`, `ielts-reading.html`,
`ielts-listening.html`, and `vocabulary.html`) are intentionally outside this
shared shell so each exercise can keep its own learning-specific design.

Use translucent glass for functional layers such as navigation, headers,
search, account surfaces, and dialogs. Repeated content cards and dense teacher
data panels use a quieter, lightly translucent standard material rather than
stacking blur on blur. The ambient palette stays neutral and softly luminous;
system blue is reserved for the primary action, focus, and selected state.
Existing semantic/category colors and green/red learning-result colors remain
unchanged. The shell must provide reduced-transparency, increased-contrast, and
reduced-motion fallbacks.

### Login

The student login page should feel like a lightweight welcome ritual rather
than a feature billboard. The current direction keeps the established
two-column welcome/form composition inside one neutral, translucent glass
surface, with no decorative object movement. Keep the visible text minimal:
`Mr. Cat Academy`, one central quote, the Student ID/password fields, `Sign
in`, `Continue as Visitor`, and a short visitor-mode note. The central quote is
randomly selected on each page load from the same existing motivational-sentence
collection used by the student Dashboard. The left welcome
column keeps the quote close below the brand instead of distributing both items
to opposite vertical edges and leaving a large blank region above the quote.
The form has no visible `STUDENT ENTRY` eyebrow; its accessible `Student sign
in` heading remains available to assistive technology.
On mobile, the welcome panel shrink-wraps the brand and quote instead of
retaining the former fixed 430px minimum height and a large empty lower half.

## 3. Student Dashboard

Navigation:

- the main content opens directly on `Library`; do not restore lower
  Assignments or My Words navigation
- assignments and finished work open from a standalone far-left `To Do List`
  checklist button, separated from the right-side utility controls
- a calendar icon in the right-side utility group opens the signed-in
  student's own completion history in an independent modal. It uses a
  Monday-first natural-month grid rather than Teacher View's `Wxx` columns.
  Each date cell uses restrained green intensity for 1/2/3+ completed items,
  adds a small gold STAR when applicable, outlines today and the selected day,
  and reveals that date's task names, type, score, and STAR state below the
  month grid. Previous/next controls stay within the student's recorded range
  and never navigate beyond the current month. The modal omits a separate
  `Progress` heading, subtitle, completed total, and active-days total, so the
  month/year toolbar sits directly at the top of the content area. The modal
  and external Close capsule share the Assignments glass material. Completed task rows are the
  same component used by Assignments: category capsule on the left, a
  single-line overflow-scrolling title in the center, and score plus chevron on
  the right. Activating a row opens the same entry confirmation and practice
  destination; closing the confirmation restores the calendar and row focus.
- The To Do List modal places Teacher Replies in its top-right corner as a plain
  speech-bubble SVG with three quiet dots and no embedded checkmark. Its badge
  counts unread replies. Teacher Replies has no close icon or bottom Close
  action; a top-left `Back` control marks current replies seen and restores the
  same Assignments modal and bubble focus.
- My Words opens in an independent modal from a notebook icon in the right-side
  utility group; closing and reopening restores the modal's previous
  internal scroll position
- account/profile actions remain in the top-right identity chip

Assignment access and progress display:

- if the authenticated Dashboard aggregate fails, replace the assignment
  loading state with an explicit `Unable to load the dashboard` card and
  `Retry` button, show `UNAVAILABLE` in weekly progress, and temporarily disable
  the To Do List and Calendar controls. A backend failure must never render the
  normal no-assignments empty state.
- both `TO DO` and completed assignments are reachable from the far-left
  `To Do List` button; there is no lower Assignments page entry
- the hero always shows three compact summary rows: `Overdue`, `This Week`, and
  `Upcoming`. Each uses completed assignments divided by all assignments in
  that due-date group for both the filled track and an explicit numeric percent
  label. The complete row is a keyboard/click target that opens a focused
  Assignments modal containing only that group's task list. Task rows no longer
  expand directly inside the hero; focused lists place unfinished work before
  finished work.
- the default modal opened from `To Do List` is titled `ASSIGNMENTS`, centered
  at the top in the same small green accent type as `PERSONAL CENTER`. The title has no translucent
  rectangular header plate behind it. Its assignment card is approximately
  three quarters of the previous maximum height and scrolls internally. It has
  no top-right `×` or in-card footer action; one pill-shaped `Close` control
  sits directly below the card. The former three top summary capsules are not
  rendered. `THIS WEEK` and `FINISHED` are both disclosures without numeric
  count pills: This Week starts open, while Finished starts closed. Finished
  tasks are sorted newest-completed first.
  Every unfinished row has a red right-side pill in
  the same position as a finished score: it reads `0%` before any attempt and
  shows the best failed percentage after an unsuccessful submission. The task
  list never uses `TO DO` text as a row score.
  Failed work remains in `TO DO`; only `passed` or `mastered` work appears in
  `FINISHED`, where the score pill remains green.
- the student header omits the cat logo so it does not consume horizontal
  space. The far-left To Do List control stands alone opposite the right-side
  utilities. The header glass capsule shares the exact left and right edges of
  the workspace card below it. The welcome pane has no `STUDENT WORKSPACE`
  label. Its smaller China-time-aware English
  greeting remains on one line; only genuine overflow receives a slow,
  reversible horizontal reveal, while reduced motion uses a static ellipsis.
  One randomized motivational sentence remains below it.
- the top student workspace is one unified luminous surface rather than two
  nested cards. On desktop the greeting and randomized motivation sit on the
  left and the fixed `THIS WEEK` and `UPCOMING` progress rows sit on the right;
  below 900px they stack without changing their reading order. `THIS WEEK`
  combines assignments due in the current China-standard-time Monday-to-Sunday
  week with every earlier unfinished assignment. Those overdue tasks count in
  its denominator, appear first in the focused Assignments list, and receive a
  restrained red pulse. While any overdue task exists, the This Week progress
  track also uses a slow red breathing halo that remains visible at zero
  percent; reduced motion uses a static red border instead. `UPCOMING`
  represents next week's assignments and remains separate. With tasks it keeps
  its blue track and percentage; without tasks it renders no track or `0%`, but
  becomes a non-interactive calendar-check plus `NO TASKS` state, with the check
  centered inside the calendar body rather than attached to a corner. Self-study
  STAR records are not counted. Activating either summary opens its focused task
  list and tasks do not expand inside the hero. Empty rows retain zero progress
  without explanatory copy. The progress fill reveals once after loading
  without bounce, and reduced motion renders the final value immediately. Color
  is always accompanied by task text and status.
- the Library content starts with a large `Library` heading. Its compact search
  control and `Practice` / `Exam` segmented control sit together at the right
  side of that heading on desktop and remain adjacent when stacked on mobile.
  They use a soft translucent glass treatment; active and primary states use
  restrained system blue
- the current Library sub-filter appears inline with the title as
  `Library / BBC2026⌄` (or the currently selected category). The former
  always-visible gold sub-filter row is hidden. Activating the title control
  opens a neutral, anchored category popover without pushing the task cards
  downward; choosing a category closes the popover and updates the title.
  Clicking outside or pressing Escape also closes it, and global search-driven
  category changes must update the visible title label.
- activating the circular Library search button expands the search input from
  that source control. Close or Escape clears the query, collapses it back to
  the button, and returns focus to the button.
- Library task cards use two columns on desktop and one column on narrow mobile
  widths. Existing content filters, card actions, navigation targets, and
  confirmation behavior are unchanged.
- Student Library search is global across every visible task, independent of
  the currently selected `Practice` / `Exam` and content-filter capsules. If the
  current capsule has no match, the interface automatically selects the capsule
  containing the best match; an exact Set ID match takes priority over general
  title or metadata matches.

Backend statuses:

- `to_do`
- `passed`
- `mastered`

Frontend rule:

- `passed` and `mastered` both appear in the far-left To Do List's
  `Finished` section.
- Do not split the student dashboard back into `PASSED` and `MASTERED` tabs unless the owner explicitly changes the product rule.
- To Do List is the single place for assignment reminders and finished-review
  entry; do not restore a lower Assignments page or filter capsule.
- Finished Vocabulary assignment cards open the same Learn entry used by
  Library Vocabulary cards, without automatically restoring Test/History mode.
- Student assignment messages live in the far-left To Do List; account and
  utility actions remain on the right, not as main navigation tabs.
- Message and unread-count reminders use red dots/badges consistently, including
  student replies, assignment notifications, teacher notification counts, and
  unread activity rows. Student assignment reminders are counted only on the
  far-left To Do List. It keeps future assignments visible in a separate
  `Upcoming` section even while current-week work remains unfinished, but
  future work never contributes to the red count. The To Do List badge includes
  only overdue/current-week unfinished assignments. Unseen teacher replies use
  the To Do List header bubble's own red badge.
  Viewing To Do List must not clear assignment reminders.
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
- The teacher notification bell groups attempts by student assignment thread,
  or by student and set for self-study. Each row shows the latest result and
  total attempt count, and its detail dialog shows the complete thread history.
- Teacher notification rows keep the student/action/task name on one line and
  truncate overflow with an ellipsis. A By-student-style latest-score capsule
  stays fixed on the far right. Below the title, the colored attempt-count
  capsule sits immediately left of the date/time: one attempt is blue, two are
  amber, and three or more are rose to make repeated work easier to scan.
- In the teacher header, the notification bell sits immediately to the left of
  the Argue review button. Argue uses the same raised-hand outline as exercise
  pages and inherits the teacher header's quiet gray icon treatment. Its finger
  segments render as one compound stroke so shared edges cannot become darker
  than the rest of the hand; unread review requests remain indicated by the red
  count badge.
- The teacher header Notifications, Argue, and Student lookup controls use one
  shared icon-button system: all three are 40px circles with the same border,
  translucent background, shadow, hover/focus movement, 20px icon box, round
  line caps/joins, and visually consistent 2.2px non-scaling strokes. The hand
  must not appear thinner than the bell or student-card outline.
- Opening the bell alone does not clear the top-right badge or red row state.
  Opening a grouped attempt row marks that thread's current attempts reviewed;
  a later attempt makes the same thread red again.
- Opening a grouped attempt row displays the thread detail at its top with the
  attempt chart visible and no attempt preselected. Selecting a chart bar is
  the only action that scrolls to its matching attempt card below.
- The teacher bell header includes `Read all`. It marks every currently loaded
  attempt thread read, clears the bell badge/red row treatment, and remains
  disabled when no unread thread exists. Attempts submitted afterward are new
  unread activity.
- The teacher notification modal header does not show `NOTIFICATIONS` or
  `Student attempts`. It is reserved as an action toolbar: a circular double-
  check `Read all` icon sits on the left and future action buttons may occupy
  the remaining space. The notification card is capped at roughly three-
  quarters of the viewport height and scrolls internally. It has no top-right
  `x`; a centered `Close` capsule sits outside and immediately below the card.
  The Read all icon keeps an accessible label/tooltip, shows a spinner while
  saving, and briefly turns green after a successful read-all action.
- The student assignment dialog opened from the far-left To Do List must be a
  fully opaque top-layer modal. Dashboard navigation capsules such as
  `Assignments`, `My Words`, and `Library` must never show through it.
- The To Do List dialog should always open. It shows open and finished
  assignments only. Assignment rows are compact whole-row
  targets: the short type label and title share the main line, with BBC tasks
  labelled `BBC` and all IELTS tasks labelled `IELTS`. Long titles stay on one
  line and scroll gently only when they overflow; reduced-motion mode uses a
  static ellipsis. Finished rows may show a small score at the right.
  Do not render separate `Start` or `Open` buttons. Clicking or keyboard-opening
  the row temporarily hides the bell and shows the same shared practice-entry
  confirmation used by Library before navigation. Dismissing that confirmation
  with `Close`, Escape, or the backdrop restores the same To Do List dialog and returns
  focus to the selected assignment row; `Enter` closes both layers and navigates.
- Student STAR counters live inside the top-right account panel, not in the always-visible header.
  Show assigned-task stars as the yellow counter and self-study/library stars
  as the blue counter beside it. Both counters are keyboard-accessible buttons.
  Activating one replaces the account summary inside the same card with a
  newest-first STAR history for that color. Each compact row shows task type,
  title, earned date, and best score and opens the linked best historical
  attempt. The circular Back control returns to the summary and restores focus
  to the originating counter; the external Close behavior remains unchanged.
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
- practice pages expose both `Back` and `Home` controls. `Back` first shows a
  leave-page confirmation, then returns exactly one browser-history step when
  the same-origin referrer path matches the validated `return` target. This
  preserves the previous Library filters, scroll position, and back-forward
  cache instead of creating a new Dashboard page. If that match cannot be
  verified, `Back` navigates to the safe `return` URL or the appropriate home
  fallback rather than risking older login or unrelated tab history. `Home`
  always goes directly to the student's dashboard, or to Teacher Library for
  `teacher=1` preview pages.

My Words:

- opens as a compact, vertically centered independent modal from the notebook
  icon beside the bell. The dialog plus its external `Close` capsule is capped
  at about 74% of the desktop viewport and 72% of the mobile viewport, so it
  never becomes a full-screen phone sheet.
- places matching green circular Search and Add icon buttons in the top-right.
  Search expands in place below the header. Add expands one word/short-phrase
  field only; Enter saves it, with no optional context field or visible Add
  text button.
- shows saved student-owned words and phrases from `studentVocabulary` in a
  simple two-column list. Every collapsed row uses two equal halves with a
  centered vertical divider: the English word is centered in the left half,
  while part of speech plus Chinese meaning are centered horizontally and
  vertically in the right half.
- expands a row to show phonetic spelling, browser pronunciation, English
  definition, source/context, saved date, retry when applicable, and removal.
  The speaker is not shown in the collapsed row; it sits beside the phonetic
  only after expansion. Search includes the dictionary fields.
- does not expose New/Learning/Mastered states, due filters, reveal-and-rate
  review, or any other review controls in the student interface.
- saving is immediate. A cache miss shows `Finding definition and part of
  speech...` while backend enrichment continues; a confirmed miss offers a
  quiet Retry action. Lookup failure never removes the saved word.
- is available across student learning and attempt-review pages. Single-letter
  words such as `a` and `I` are valid vocabulary items.
- visitors see a login prompt instead of personal data.
- its header notebook icon follows the same circular SVG treatment as the other
  right-side utility buttons; the standalone assignment button uses a checklist SVG.
- closing and reopening restores the modal's previous internal list scroll
  position; closing Search or Add does not close the modal.
- `my-words-modal-preview.html` is an isolated static design reference for this
  compact modal. It is not linked from production navigation, must not call
  CloudBase or contain real student data, and is not a second My Words runtime.

Student account menu:

- opens from the top-right identity chip.
- shows profile/account information, password change, and logout.
- is a centered independent modal using the same thick translucent glass card,
  softly dimmed/blurred backdrop, corner radius, and depth hierarchy as To Do
  List, Calendar, and My Words rather than an anchored dropdown.
- has no top-right close icon; one centered external `Close` capsule sits
  immediately below the Personal Center card and restores focus to the identity
  chip. Escape and backdrop dismissal behave the same way and background scroll
  remains locked while the modal is open.
- the `Change password` dialog must layer above the account panel and remain
  the topmost student-account surface while open.
- assignment reminders and finished work share the To Do List dialog.
- Teacher Replies uses a separate plain speech-bubble SVG button at the
  top-right of the default To Do List dialog. Focused This Week and Upcoming
  task-list modals omit this control and use the same green accent title
  typography as Personal Center.
  Its modal lists all resolved replies newest-first, including previously read
  history. Its top-left `Back` marks unseen items read when returning, clearing
  the bubble badge without removing history. Back is a clearly interactive
  glass capsule with a left arrow, visible border and shadow, plus hover, focus,
  and press feedback; it must not read as plain text.

## 4. Teacher Interface

All independent Teacher modals share one background scroll lock. Notifications,
Argue, Student lookup/details, assignment editors, practice-entry confirmation,
and success dialogs freeze the workspace at its current document position for
wheel, trackpad, and touch input. An internal modal scroller remains usable.
Stacked dialogs keep the lock until the final modal closes, then restore the
exact pre-modal page position.

The teacher page uses one spatial workspace with a horizontal segmented
navigation row at the top on desktop, iPad/tablet, and mobile. It must not move
to a left sidebar at wider breakpoints. Its three destinations, in order, are:

- `View`
- `Assign`
- `Library`

There is no separate teacher greeting/quotation hero or repeated content
heading. The `View` destination begins directly with the progress matrix; do
not place `TEACHER`, `View`, or a `New assignment` shortcut above it. Teachers
switch to assignment creation through the persistent `Assign` navigation item.
The top-left `Mr. Cat Academy` wordmark remains omitted on this authenticated
teacher surface. The solid black full-body leaping-cat mark sits at the far
left as the shared authenticated-workspace logo and matches the `40px`
footprint of the adjacent circular utility buttons, while the utility controls
remain aligned to the right. The header glass capsule and the workspace frame
below share the same left and right edges.

The top-right teacher chip opens a Personal Center panel. Its title is centered
as `PERSONAL CENTER`, without a separate `Teacher Account` heading or account
status row. The top-right circular student ID icon opens a standalone Student
lookup modal. That modal contains the student search/selection surface,
selected student info and progress, and an internal `+` action for creating a
student. The Student lookup, raised-hand Argue, and notification surfaces share
the notification card's width, viewport-centered position, height cap, and
centered external `Close` capsule immediately below the card. The picker
initially shows `Choose`
beside a magnifying-glass search action. Activating search replaces `Choose` in
place with the live search field; matching students update immediately and a
student row is selected directly without a separate Confirm action. The student
list opens as a floating layer above the student detail/progress cards instead
of being squeezed into the first card. The floating list uses the available
dialog height and scrolls internally on pointer and touch input.
The create-student modal uses a vertical field stack and, after success, shows
a standalone checkmark confirmation dialog with the new Login ID and initial
password. Closing or cancelling Create student restores its parent Student
lookup modal instead of dismissing both layers. Review requests open from a
separate top-right raised-hand button with a pending-count badge and display in
the shared-size standalone modal.
The notification bell opens a standalone student-attempt modal only; Review
requests must not be duplicated in the bell because they have their own
top-right Review entry.
The notification surface is a page-level fixed overlay, not a descendant whose
position is resolved against the tall workspace frame. Opening it must place the
message card immediately in the current viewport without requiring any page
scroll.

All other Teacher modal surfaces follow the same page-level rule, including
Review, Student lookup, Create student, assignment success, Assign Work and
Student pickers, matrix/student progress details, assignment editing, and
practice-entry confirmation. A modal must open inside the current viewport at
every page scroll position; long content scrolls inside the dialog rather than
placing the dialog farther down the document. Top-level modal surfaces must not
remain descendants of the backdrop-filtered workspace frame because that frame
would become their fixed-position containing block.

Teacher notification rows open standalone attempt detail dialogs inside the
notification surface. They must not switch to `View`, select matrix cells,
change matrix filters, or redraw the matrix, whether the attempt came from an
assigned task or self study. The attempt detail dialog must use the same
detail layout as a `View` matrix cell, showing every attempt for the relevant
assignment or self-study thread at a glance. It opens at the top with the full
attempt bar chart visible and with no attempt preselected. Only clicking a bar
highlights that attempt and scrolls to its matching detail card below. The
attempt detail dialog exactly covers the notification card footprint and uses
its same centered external `Close` position. Closing
the detail layer by that action, Escape, or its backdrop restores the unchanged
notification list instead of dismissing the notification surface. The detail
modal renders outside the notification list's scroll body, and attempt history
scrolls inside the fixed-size detail card. The notification header keeps its
double-check `Read all` control in a compact toolbar without a tall empty strip.

The teacher page defaults to `View` on entry, including when a stale
`?view=tasks` URL is refreshed. The explicit `?view=library` return URL remains
supported for returning from a teacher practice preview. `View` keeps the
current progress matrix and its three filters (`Class`, `Column`, and `Date`) exactly as designed;
do not add KPI cards above it. While assignment matrix data is
loading, the matrix area uses a textless loading state with visible grid lines,
subtle neutral light movement, and no centered spinner. On the first successful
matrix render, the real matrix content should softly fade and lift into place
instead of replacing the loading state abruptly.

On phone-width viewports, the matrix always enters its automatic `Fit` density
instead of inheriting a density saved on desktop. The sticky student column's
actual grid track must follow the compact displayed name (surname at `Fit`),
not merely shorten the text inside a desktop-width track. A manual phone
`−`/`Fit`/`+` adjustment may survive practice-preview Back navigation for that
visit, but it is not persisted as the next phone-load default.

Teacher visual style uses the same neutral Liquid Glass system shell as the
login, public Library, and student Dashboard. Header controls, sidebar,
workspace frame, and dialogs may use functional glass; the matrix, grouped
progress cards, and other dense data surfaces stay on quiet standard material
for legibility.
The workspace frame and matrix keep clean continuous rounded top corners. The
matrix scroll viewport clips its sticky and colored header cells to the same
rounded outline, so inner sidebar, header, or accent layers cannot show a
square contrasting tip inside those curves.
Selected tabs and primary actions use system blue without continuous rainbow
animation. Completion states remain functionally colored: passed/mastered stay
green, low scores stay red, and empty/not-yet cells stay neutral.

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
- choose Work first or Students first. The opposite picker should color-code
  existing assignment state for the selected counterpart: open `in_progress`
  pairs are colored and disabled; completed/mastered history is colored but
  remains selectable for reassignment
- set task parameters in a bottom Assign matrix, one selected Work item per row:
  required due week, passing percentage, and whether that task can earn STAR
- assign the selected work to the selected students

The Assign surface should stay visually minimal: the default Assign tab shows
the `Work` and `Students` summary surfaces side by side on desktop and stacked
on mobile, followed by the existing task-parameters matrix and the Assign
action. This is the hybrid layout: search, filters, and candidate lists remain
in their existing standalone picker dialogs, whose design and behavior are
preserved. There are no visible multi-step accordions or legend. Empty
Work/Students summaries and picker footers should not show `None selected` or
`Nothing selected` placeholder text.
Selected Work and Students render as one item per row in their summary cards,
and each row has a small `x` control for removing that item without reopening
the picker. The student picker should not include a `Select filtered` bulk
selection button.
Assignment creation continues to use server-side validation.
The task-parameters area renders like a compact matrix with columns for the
selected task, due week, passing percentage, and STAR. Each selected Work item
has its own row. Due week is mandatory and defaults to `This week`, with only
`This week`, `Next week`, and `Customize` in the first selector. Choosing
`Customize` reveals a week-number selector and labels the current Beijing-time
Wxx week clearly. Passing percentage is filled from that selected work's
default when possible. `Earn STAR` is unchecked by default; only when checked
does `Mastery %` appear and become required for that row. Passing and Mastery
values open the same compact vertical percentage wheel instead of a
number/text input. The wheel exposes five rows with a centered selected band,
uses native touch momentum and one-point snapping from `0` through `100`, and
commits only through `Done`; backdrop, `Cancel`, and Escape discard changes.
Keyboard users can adjust by one with arrow keys, by five with Page Up/Down,
or jump to the endpoints with Home/End. The same wheel is used when editing
selected assignments.

Family defaults shown when a set has no explicit override are Vocabulary
`90%` passing / `100%` mastery, BBC `80%` / `95%`, and general content
`50%` / `90%`.
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
- matrix size controls sit beside/below the filters as `−`, `Fit`, and `+`.
  Phone portrait defaults to `Fit`, which uses real responsive grid tracks (not
  a transformed screenshot) to keep the complete set of visible columns on
  screen for the normal six-to-seven-task teaching view. `+` progressively
  restores wider columns and internal horizontal scrolling; `−` reduces them,
  and `Fit` returns to the full-width overview. Desktop defaults to the current
  comfortable width. An explicit size choice is remembered locally on that
  device, while an untouched responsive default switches between phone Fit and
  desktop comfortable sizing when the breakpoint changes.
- matrix task headers retain only the stable task ID and task name. The
  week label must not also appear in this first row. Clicking the task header
  first opens the shared practice-entry confirmation dialog; only `Enter`
  opens that task in teacher preview, while `Close`, Escape, or the backdrop
  returns to the unchanged View matrix. In Fit and the tightest size, the
  stable ID is stacked into compact components and the task name is visually hidden;
  wider sizes restore the full ID and name without changing the link or its
  accessible label. Immediately below the task header and
  above all student score rows, the matrix adds one full `DUE AT` row: its sticky
  first-column cell reads `DUE AT`, and each task column always contains the
  zero-padded Beijing-time `Wxx` grouping label moved from the former task
  header. This label uses required `due_at`; legacy tasks temporarily fall back
  to the week derived from `assigned_at` until the due-week backfill is applied.
  It stays aligned with Assign Due week and the Date filter. The
  matrix's top-left header cell is visually empty instead of displaying
  `Student`. The sticky `DUE AT` first cell uses a neutral lavender-grey
  parameter surface with a small sliders icon. Each Wxx value appears inside a
  white/translucent purple-outline capsule with stronger hover, focus, and
  press feedback; green remains reserved for passed student task cells. Every
  cell in the row shares one height and continuous borders.
  At the phone portrait breakpoint, the empty header, `DUE AT`, and Wxx cells use
  the same compact padding and type scale, and the sticky first-column cells
  fill the shared grid track instead of deriving their rendered width from
  their own font size. Fit may hide the `DUE AT` text while retaining its
  sliders icon and accessible label.
- clicking a task's `Wxx` cell in the `DUE AT` row opens assignment management
  for all records
  represented by that visible column. A class/individual filter limits the edit
  scope to that class/student; no class filter means all currently visible
  students in the column. One save can update due week, passing
  percentage, mastery percentage, and Earn STAR for the complete scope. This
  parameter editor has no top-right close icon; its `Close` control is a
  standalone capsule centered outside and immediately below the dialog card.
  Its form contains exactly three direct rows: Due week, Passing %, and
  Mastery %. There are no per-field change checkboxes or explanatory footer
  paragraph. Due week uses a select; both percentages open the draggable
  scroll-wheel picker. The only checkbox is `Earn STAR` beside Mastery %;
  unchecked disables that picker. The footer contains a red `Cancel open
  assignments` button and `Save changes`. The red action opens a second
  confirmation modal with Keep/Cancel choices before calling the backend.
- matrix filters appear as compact unlabeled `Class`, `Column`, and `Date`
  select capsules on one row with equal visual width; all three default to all
  records. At phone width they divide the available row into three equal tracks
  instead of creating a separate horizontal filter scroller. `Column` uses
  `All type`, `Date` uses `All time`, and date filtering
  offers `This week - Wxx`, `Next week - Wxx`, `Last week - Wxx`, `All time`,
  and `Self study`; the three week labels shorten to `This Wxx`, `Next Wxx`,
  and `Last Wxx` at phone width so the selected value stays readable.
  Week filters use the assignment `due_at` timestamp, not student
  completion time, and calculate fixed Monday-to-Sunday natural weeks in
  Beijing time. Self-study records without an assignment are shown only by the
  `Self study` date option. Repeated assignments of the same set should render
  as separate matrix columns, even when they occur in the same week.
  Unclassed students appear in the `Class` menu by student name so a teacher can
  isolate one student's matrix rows without an `Individual` prefix.
- the matrix renders every student matching the current filters; do not hide
  later students behind a fixed first-page row cap
- the matrix student column shows only the student name, without Login ID or
  class, and sizes to the currently rendered names instead of using a wide fixed
  column. Comfortable density levels show the full saved name; the tightest
  non-Fit level extracts the English name when one is present; Fit shows the
  surname (the first Chinese character, or the final word of an English-only
  name). The top-left header stays visually empty and the compact `DUE AT`
  parameter label shortens with the column, while each row retains the full
  student name in its tooltip and accessible label.
- clickable matrix task cells open a floating dialog with a standalone `Close`
  capsule centered outside and immediately below the detail card. The dialog
  shows the practice title, a student
  name pill, a lock/best-score pill, an attempt score bar chart, and newest-first
  attempt cards. It must remain an independent page-level overlay and must not
  be clipped by the matrix card or rendered inline beneath the matrix. The
  overlay must sit above page-level progress controls such as the
  `By student` / `By task` capsule.
- matrix task-detail Close stays outside the scrollable card so it remains a
  distinct dismissal action. Attempt history uses compact 48px columns with a 14px Apple
  Health-style capsule bar rather than stretching one attempt across a wide
  track. The bar top shows the score, followed by `#N`, `P18m42s`, and
  `A12m08s` with tabular numerals and no internal spaces. Durations under one
  minute use `P42s`; durations over one hour use `P1h08m`. Missing Audio timing
  omits the A row. Subtle Passing and enabled STAR reference lines span the
  chart; not-passed bars are muted coral, passed bars are teal, mastered bars
  are restrained gold, and the best score has only a small gold dot. A selected
  bar gains a quiet outline and remains linked to its attempt card below. When
  attempts overflow horizontally, the Passing and enabled STAR reference lines
  span the full scrollable chart track through the final bar rather than ending
  at the initial viewport edge.
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
  uses the green check instead of a star. The two tightest matrix sizes stack a
  smaller status icon above the numeric score and omit only the `%` glyph; the
  full score remains in the cell's accessible label and detail dialog.
- clicking the left student-name column in the matrix opens an independent
  four-week progress modal matching the student's Dashboard progress board.
  Week labels and day squares are selectable, completed-work density and STAR
  states use the same visual rules, and the detail pane includes both assigned
  work and self-study completed by that student.
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
- assignment management can edit due week, passing percentage,
  and mastery percentage, or soft-cancel open selected assignments. `Due week`
  updates `due_at`, so the selected work moves to the chosen Wxx
  matrix column and week filter without changing immutable attempts. If only
  part of an original assignment batch moves, View splits that part into the
  new week while keeping same-batch/same-week records together. Cancelled assignments
  are hidden from teacher View progress and from the student's To Do without
  deleting attempts or completed history.
- task-column editing resolves every assignment in the visible filtered column;
  student-detail editing resolves one student's assignment only. When Earn STAR
  is off, Mastery % is disabled and does not constrain Passing %.
- student selection and student detail panels
- student account management actions such as class/system edit, password reset,
  deleting a student account, and account creation. Deleting a student account
  should remove that student from teacher-visible lists and View progress after
  confirmation.
- opening a practice from a View task header records the current View context.
  The practice page's application Back returns to the same Class/Column/Date
  filters, matrix density, By student/By task mode, expanded groups, document
  position, and matrix horizontal/vertical position. The entry confirmation
  dialog and matrix/detail modals are not restored. IELTS Reading and Listening
  keep their application Back controls in the exam bar rather than moving them
  to the lower-left practice navigation.
- a private-device, answer-stripped teacher snapshot may paint the prior matrix
  while CloudBase refreshes in the background. New progress updates
  automatically without resetting filters, collapsing groups, moving the page,
  or changing the first visible matrix task. Cached UI never overrides live
  CloudBase progress.

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
and `BBC2026` sub-filters. Student Library exposes these through the title-inline
category popover; Teacher Library keeps its existing visible sub-filter row.
BBC task cards should not show a year badge inside each task capsule; the year
belongs in the sub-filter layer. IELTS task
cards should not show the Cambridge book badge inside each task capsule.
IELTS book/filter labels belong in the Library filter layer rather than inside
task cards. DSE labels should read `DSE Reading`, `DSE Writing`, `DSE Integrated`,
and `DSE Speaking` without visible Paper numbers. Student popover choices and
the Teacher Library's visible row keep the compact capsule shape when grouping,
tabs, or filters change.
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
- a successful password reset opens the compact centered checkmark confirmation
  used by assignment success; it states `Password reset`, shows the student
  Login ID and initial password, and closes by Done, backdrop, or Escape
- delete account
- name/class/system editing

Use name editing for spelling corrections. Account deletion is for ending the
account lifecycle; after deletion the same Login ID may be used to create a new
account, but the new account does not inherit the deleted account's history.

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

### IELTS Reading

- The black exam bar is the single place for the set code; do not repeat the
  code beside or below the reading title.
- Paragraph-matching answer controls show only the paragraph letters (`A`,
  `B`, `C`, etc.), without redundant labels such as `A. Paragraph A`.
- Highlights in both the passage and question text persist in browser storage
  for the current set and identity, including after submission and reload.
  Students can clear one selected highlight or clear every highlight for the
  reading.
- Typed summary-completion blanks expand and contract with the answer length,
  within a practical minimum and maximum width.

### IELTS Listening

- A sticky lesson header at the top of the workspace shows the lesson title and source, above the questions.
- The header stays visible while scrolling through questions.

### BBC Practice

- BBC lessons may opt into a front-end-only render theme through
  `renderTheme` in their runtime JSON. The theme must not change grading IDs,
  submission behavior, History/Clear, Explain, Argue, or answer feedback rules.
- BBC practice pages show a top-corner `Download Practice` control when the
  current set has a generated worksheet PDF under
  `assets/pdf/bbc-six-minute-english/<set_id>/<set_id>-worksheet.pdf`. The
  download target is a static no-answer exercise PDF, not a browser print view.
- The BBC `classroom-worksheet` render theme presents the runtime as a
  worksheet-style handout: clean paper surface without ruled background lines,
  thick outer worksheet border, compact low-noise question numbers, full-width
  multiple-choice options, and a header subtitle limited to
  `BBC Six Minute English` plus the episode date in
  `YYYY-MM-DD` format. It must not show a separate question-count badge. Its
  title should use a classic serif face while the subtitle remains a compact
  sans-serif information line; the title, audio player, and exercise sheet
  should read as one continuous paper surface. Fill-in blanks should stay inline
  with the sentence as compact
  worksheet-style boxes that expand as students type. Fill-in questions should
  use the same low-noise divider treatment as multiple-choice questions and
  should use the available sheet width rather than a narrow card column. Each
  section title bar should keep its own `-` / `+` controls at the far right,
  and those controls should resize only the questions under that title. If a
  fill-in set has no explicit section label, the section title should be
  `Notes`. Multiple-choice question numbers in this theme should omit trailing
  punctuation, matching the fill-in number treatment, and options should use a
  quieter worksheet-body text style rather than heavy card text. Multiple-choice
  options should use one full-width column with open, borderless rows and circular
  A-D markers. Only hover and selection add a surface: selection uses a soft teal
  background and fills the chosen letter marker, without the right-side `✦` used
  by other BBC themes. If an option wraps, the continuation line should align
  with the option sentence rather than the option letter. The student identity
  should remain in the audio bar as the English name only rather than the title
  row, `Visitor` should not be shown there, and the floating History toolbar
  should not include `Clear`.
- On desktop, pressing Space toggles the BBC audio player only when focus is
  not inside an answer input, choice, button, select, textarea, or modal.
- A submitted BBC attempt should mark wrong questions even when answer feedback is still locked because the attempt did not pass.
- After a BBC answer is checked, correct blanks, matching fields, MC question
  cards, and the selected correct MC option use the same green result family as
  Vocabulary (`#f0fdf4` surface). Incorrect results use the same light-red
  family (`#fef2f2`). The yellow MC locked-answer reminder must never override
  a known correct or wrong result.
- History should refill the saved attempt answers into editable fields for not-passed, passed, and mastered attempts.
- History may show Explain and Argue controls only when backend review data marks feedback as available.
- BBC multiple-choice answers lock after the first submitted attempt. Reopening
  finished work or loading History should restore the submitted MC choices and
  keep those radio groups disabled.
- Clear removes visible answers, feedback, Explain, Argue, and local blank
  locks, but it must not unlock submitted BBC multiple-choice answers.
- BBC MC option selection may add only lightweight sound and visual state; do
  not add extra selected-state text. The blue render theme may show a right-side
  `✦` in blue, while the `classroom-worksheet` theme uses its filled circular
  letter marker and soft teal row surface instead.
- In the BBC blue render theme, the top lesson tools show `Worksheet` only,
  the exercise body does not show separate `Part 1` / `Part 2` headings, and
  the main submission button reads `Submit`.
- The BBC Argue sent/thanks dialog must include a visible Close button in both
  student mode and teacher preview mode.
- In the `classroom-worksheet` theme, multiple-choice answer, explanation,
  dispute-status, and question-action blocks must span the full question-card
  grid on phone, iPad, and desktop. They must never fall into the narrow
  question-number column or wrap into a vertical word strip.
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
  without repeating each word's source number. A green circular speaker beside
  the visible word uses browser `en-GB` speech so students can hear it without
  loading a separate audio asset.
- Spell rows show the same speaker beside the number and part of speech. Its
  accessible label must not contain the hidden answer, and playing it must not
  reveal or fill any spelling letters.
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
- Vocabulary PDF downloads appear only at the top of the vocabulary unit:
  `Wordlist` and `Practice` buttons use document icons with a small download
  badge instead of emoji or visible `Download` wording. Individual Study Set
  practice cards do not show per-set download buttons. Clicking `Practice`
  opens a download dialog. `Confirm` downloads the static all-groups worksheet
  in original order. `Customise` opens a group multiselect with an `All` chip
  that unchecks when any group is removed and rechecks when every group is
  selected again. The `Shuffle` control keeps group numbers and group order in
  place, but randomises each selected group's word bank and question order with
  a visible randomiser seed; shuffled questions are renumbered from `1`. Static
  and browser-generated Practice worksheets use enlarged print typography:
  roughly `10.8pt` for word banks and `10.4pt` for question sentences, with
  matching larger line spacing and row height.
- Vocabulary inline practice uses each study group's own `Check` button. Each
  question card shows a compact blue-green `?` button at the top right before
  and after checking; clicking it opens the correct answer and explanation in a
  floating popover so the practice layout does not shift. For private-answer
  vocabulary units, the first `?` click loads only that question's answer and
  explanation from the backend without checking or marking the whole group. The
  open explanation popover must sit above neighboring question cards and their
  `?` buttons, even when the popover is tall. After checking,
  correct cards turn green, incorrect cards turn light red, and each answer
  blank is replaced by inline feedback:
  correct answers show in green, while wrong answers show the submitted answer
  in red followed by an arrow and the correct answer in green. If the
  student left a blank unanswered, the submitted-answer side shows `X` instead
  of `No answer`. The `Check` button is replaced by a centered score pill such
  as `Score: 7 / 10` and an inline `Retry` button; `Retry` clears all practice
  answers and restores the group to an unchecked state. Inline practice does
  not show `Clear All`, `Hide Answer`, or a floating `Retry` control. The
  per-blank choice panel opens as a floating overlay so the question layout
  does not shift; its word choices are shuffled per question so they do not
  reveal the answer order, it has no `Clear` button, and its final chip is a
  blank underline option for leaving an answer empty. When local practice
  answers are present, checking is handled locally and does not call CloudBase.
  Legacy vocabulary units that still need CloudBase answer checks must show a
  friendly login/session message instead of raw SDK errors.
- Vocabulary practice does not expose Argue buttons in inline practice, Test,
  History, or teacher preview surfaces.

### Vocabulary Quiz

- The top mode switcher label remains `Cloze`. Inside Cloze, the setup area has
  two stacked task bars: a `Practice` bar on top and a `Quiz` bar below. The
  Practice bar uses numbered group chips so students can choose specific groups,
  with the right-side action labeled `Practice`. The Quiz bar keeps the current
  selected-set-count dropdown, with the right-side action labeled `Start Quiz`.
  Practice starts with no groups selected and its action disabled. The Quiz
  dropdown starts at five groups and does not expose the legacy 1-4 group
  self-study choices; each dropdown option shows only the set count and test
  duration, without a `Counts toward results` suffix. On mobile, both bars and
  their horizontally scrollable controls must remain inside the Cloze panel
  width. The Practice chip scroller must reserve its full content height so
  every numbered capsule is completely visible and touchable.
- All student-facing dialogs and status messages in the counted flow use
  `Quiz`; internal code, session actions, and stored attempt modes retain their
  existing `Test` identifiers for compatibility.
- Cloze Practice uses the same 90-second-per-selected-group timer, sticky set
  navigation, word bank, shuffled in-group question order, submission feedback,
  and teacher notification visibility as Cloze Test. Its recorded attempts are
  practice-only and do not update assignments, STAR, student progress, or the
  Teacher View matrix.
- Starting a Vocabulary Test opens a confirmation dialog warning that the timer
  cannot be paused or stopped.
- Cloze-mode timing gives each selected group 90 seconds, or 1.5 minutes.
- While a Vocabulary Test is running, the top of the Test view uses a sticky
  capsule bar like Vocabulary Learn. Numbered test-set capsules sit in a
  horizontal row; when there are more than six selected sets, the row scrolls
  horizontally instead of wrapping into multiple lines. The countdown timer
  remains a fixed red capsule at the far right of the sticky row. Cloze-mode
  numbered capsules use a gold glowing visual treatment in Test and a green
  treatment in Practice; the Test word-bank triangle toggle remains gold.
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
  changes into a compact `Retry` capsule, while the direct result count such as
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
- Student Vocabulary pages should not show a bottom-right floating `Retry`
  capsule. Retry actions belong inside the relevant task surface.
- Student Vocabulary views should not show a standalone bottom-right
  `Show Answers` capsule.

## 6. Status Labels

Preferred product labels:

| Backend | Student label | Teacher label |
| --- | --- | --- |
| `to_do` | TO DO | To Do / Working / Not started |
| `passed` | FINISHED | Passed / Finished |
| `mastered` | FINISHED + STAR | Mastered |

Teacher Assign and Teacher View assignment editing include STAR controls.
New assignments default to not earning STAR unless the teacher selects
`Earn STAR` during Assign. Turning `Can earn STAR` off keeps future completions
in `passed` / FINISHED and prevents new STAR creation for that assignment,
without revoking existing protected STAR records.

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

- Double-tapping must not zoom the page on touch devices. Normal single-finger
  scrolling and two-finger pinch-to-zoom remain available for accessibility.
- Shared shell pages must not introduce horizontal page scrolling at phone
  widths; internal teacher matrices may retain their intentional scroll region.
- Assignment action buttons should not wrap awkwardly.
- Listening controls should stay reachable while scrolling.
- Candidate popups should not cover question text.
- Text must not overflow buttons/cards.
- Teacher views should remain scannable on laptop screens during class.
- Teacher progress matrices may scroll horizontally on small screens instead of compressing text.
- Glass surfaces must remain readable when reduced transparency, increased
  contrast, or reduced motion is requested by the operating system.

## 8. Known UI Risks

- Cache query strings must be bumped after shared JS changes.
- Teacher preview and student mode can accidentally share UI paths; keep reveal logic separate.
- Vocabulary fallback JS is needed for local/file loading.
- My Words selection is allowed in answer, explanation, feedback, and result
  content regions, including text inside disabled answer-feedback buttons, but
  should still avoid active form controls, buttons, login dialogs, and
  teacher-only controls.
- On touch devices, My Words must preserve the browser's native selection
  highlight and selection handles after a long press. Tapping the site save
  button must not clear the captured word or phrase before it is saved.

## 9. Future UI Improvements

- Clearer STAR counter labels.
- Better teacher progress filters by class and curriculum.
- More consistent modal/dialog style across practice pages.
- More compact teacher dispute resolution flow.
- A small deployment/version indicator for teacher troubleshooting.
