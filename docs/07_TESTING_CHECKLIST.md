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
node --check assets/js/login-navigation.js
node --check assets/js/teacher.js
node --check assets/js/dashboard.js
node --check assets/js/my-words.js
node --check assets/js/practice-session.js
npm run test:login-redirect
npm run test:my-words
npm run test:assignment-schedule
npm run test:star-rewards
npm run test:attempt-emails
npm run test:protected-resources
npm run test:learning-reports
npm run test:cloudbase-auth
npm run test:intensive-listening
npm run test:teacheradmin-package
```

TeacherAdmin deployment-package checks:

- `test:teacheradmin-package` rebuilds the function ZIP from source and fails
  if any entry other than `index.js` / generated `package.json` is present;
- the total uncompressed archive size stays at or below 1,500,000 bytes;
- the bundled code contains the stable business markers
  `intensive_spelling_exemption`, `dispute_type`, and
  `INTENSIVE_DECISION_REQUIRED`, and does not contain the top-level
  `@cloudbase/manager-node` bundle;
- the local end-user adapter smoke test verifies all five signed end-user API
  request shapes without contacting CloudBase or reading production credentials.

Login-routing checks:

- npm run test:login-redirect rejects external, protocol-relative, nested, malformed, and login-page return targets;
- exact exercise/report query and hash context survives central login, while user and visitor parameters are stripped;
- index.html, Dashboard, My Words, Attempt Review, public Library, BBC, IELTS Reading/Listening, and Vocabulary load login-navigation.js before their dependent script;
- signed-out My Words and Attempt Review return to their exact query/hash, and public Library header login returns to Dashboard Library;
- Visitor mode never becomes an authenticated identity and still blocks answer, submission, and personal-word writes.

Registration-footer checks:

- the contact group shows `@猫先生英语` and a clickable
  `mailto:jxbleo@foxmail.com` link;
- the public login/home footer shows both `粤ICP备2026107102号-1` and
  `粤公网安备44030002015814号`;
- the public-security record includes the official badge and opens the Public
  Security Bureau query for code `44030002015814`;
- both records remain visible and readable at phone width.
- phone widths place the contact group and registration links on separate
  centered rows without horizontal overflow.

Home-screen icon checks:

- every root HTML page declares `mrcat-favicon-32.png`,
  `mrcat-apple-touch-icon.png`, and the single `site.webmanifest`;
- the manifest parses and references only the 192 px and 512 px Mr. Cat exports;
- icon dimensions are 32, 180, 192, 512, and 1024 square pixels, and no
  DSE/IELTS manifest, icon, logo, or legacy standalone cat asset remains.

Intensive Listening checks:

- public static output contains no reviewed word answers;
- `BBC-260813` shows one capsule linking `IL-BBC-260813`, while an unlinked BBC
  lesson shows none;
- Student Library contains no Intensive subtab, section, or standalone material
  card;
- unchanged wrong checks do not advance the reveal gate, correct positions lock,
  and reveal requires three effective checks;
- Show Answer records assisted completion without changing wrong or blank Word
  Slots to green; independently correct positions stay green, and legacy
  assisted all-green progress renders unknown positions neutrally;
- all Intensive Listening collections remain `ADMINONLY` and authenticated
  bootstrap returns the full redacted sequence once;
- `dictation` alone counts toward progress; `listen_only` and `skip` both appear
  in source order, play their own timestamp range, show the disabled
  `No typing needed for this sentence.` field, expose no grading actions, and
  then advance without changing progress or replay totals;
- required answers remain redacted while a Provided Word is returned and skipped
  by keyboard/checking;
- student and teacher Spelling Exemption requests enter Argue, `provide` updates
  the private material and policy revision, and Keep leaves spelling required;
- a successful student Intensive Listening Argue transitions to the BBC-style
  animated-heart thank-you state and exposes its external Close action;
- Teacher Argue renders spelling exemptions as dedicated green target-word cards
  with sentence/audio context and only Reject/Approve actions; Add/Replace remain
  limited to ordinary answer disputes;
- teacher Export Latest JSON contains modes and 1-based
  `providedWordPositions` without publishing that JSON statically.
- the Unit/Speaker row exposes previous/next sentence arrows, disables invalid
  directions at the material boundaries, includes every source segment, and
  preserves typed drafts while moving between units.

BBC/Vocabulary result-audio checks:

- submit below the passing threshold in each runtime and confirm the result
  dialog plays the same low descending “sigh” sound;
- submit a Passed result in each runtime and confirm both play the same bright
  rising sound;
- submit a Mastered result and confirm its visual STAR/mastery treatment remains
  distinct while its audio exactly matches Passed;
- verify Vocabulary timed Practice uses the same pass/not-passed mapping and a
  browser without Web Audio still shows and closes the result dialog normally.

Teacher attempt payload checks in `test:assignment-schedule` verify that
`listAttempts` omits question-level/private report fields, `listProgress` does
not duplicate nested attempts, and `getAttemptDetail` restores the authorized
single-attempt answers and BBC explanation.

### Teacher attempt-email tests

Run `npm run test:attempt-emails` and keep these cases:

- BBC creates one `bbc_batch_7m` event due exactly seven minutes after the
  source attempt; Vocabulary Quiz and timed Practice are immediately due;
  unrecorded inline Practice and IELTS create no email event.
- assignment and self-study thread keys exactly match the Teacher bell rule.
- a two-attempt email contains both scores and both attempt cards, labels the
  current event `NEW`, omits correct questions from mistake detail, and places
  attempt #2 before attempt #1 in HTML and plain-text output.
- legacy missing per-question answers/explanations are joined only from the
  private grading key inside the trusted function.
- a second Vocabulary email contains both attempts and their selected-group
  context; Quiz and timed Practice subjects include their mode, current `No.`,
  and historical best score. Vocabulary mail has no reply/reference headers,
  so every submission is an independent mailbox message; BBC alone keeps reply
  threading.
- the approved static email body has no product-brand heading, Login ID, or
  website/paper link; it contains Best/PASS/eligible STAR capsules and distinct
  submitted, expected, and explanation surfaces.
- `submitAttempt` catches outbox errors after the recorded attempt, while the
  dispatcher transactionally claims work, recovers claims older than ten
  minutes, assigns a deterministic SMTP `Message-ID`, and requires the private
  timer token.

Development CloudBase verification after owner deployment:

- one BBC attempt produces no email before the seven-minute boundary; retries
  in that window produce one email with all new bars and complete prior history;
- one Vocabulary Quiz/Timed Practice email arrives on the next minute tick;
  a second submission produces a separately visible second email containing
  attempts #1 and #2, with no conversation-header link to the first;
- an SMTP failure leaves the student submission successful, advances bounded
  retry state, and does not normally resend an event already marked `sent`;
- simulate a provider-accepted/database-update-failed edge case and confirm the
  deterministic `Message-ID` is reused so mailbox-side duplicate handling has
  the best available signal; do not claim SMTP provides strict exactly-once;
- email/opening email does not clear or review the Teacher bell thread;
- a deleted or paused Personal Center address receives nothing, and no SMTP
  credential, recipient address, or rendered body is stored in the event row;
- when every address is paused/deleted, the due event becomes `skipped` and is
  not sent after a later re-enable;
- two teacher-owned test inboxes receive the same message through BCC and
  neither rendered message exposes the other inbox address.

### STAR reward rule tests

- Blue STAR is non-redeemable, stable, and unique by student/set.
- Earn STAR off never compares or converts Blue STAR, even at 100%.
- Earn STAR on converts only when verified best percentage meets that
  assignment's STAR Rate.
- New Yellow STAR is unique by student/set; legacy duplicate Yellow credits are
  preserved.
- Legacy `source: "assignment"` records remain protected Yellow even if the old
  row has no `assignment_id`; before migration apply, `total = yellow + blue`.
- Wallet credits are idempotent and balances are sums of append-only deltas.
- One open Cash Request reserves explicit available achievement IDs.
- cancellation, rejection, and expiry release exactly the reservation.
- confirmation requires active evidence and moves reserved to spent once.
- refund is append-only, returns available credit once, and does not edit the
  completed redeem event.
- stale/repeated browser actions are idempotent and cannot double-spend.

### Learning-report V1 rule tests

Run `npm run test:learning-reports`; it executes the pure snapshot rules and the
mocked CloudBase service contract. Keep these cases as non-negotiable coverage:

- period construction uses `Asia/Shanghai`, not the machine/browser zone:
  Monday 00:00:00 starts a new weekly period, Sunday 23:59:59 ends it, and the
  first/last instant of every calendar month lands in exactly one monthly
  report;
- a retry or concurrent timer invocation creates/reuses one logical
  `class_id + period_type + period_key` report, does not duplicate leaderboard
  rows, preserves saved comments, and cannot regress `published` to `preview`;
- only one active `class_memberships` row is possible per student; transfer
  closes the old row, opens the new row, and never rewrites old snapshots;
- a student whose membership covers only part of a period receives personal
  detail with `not ranked` reason and is absent from the public rank order;
- server assignment classification marks complete active-class coverage as
  `class` and partial/individual selections as `individual`; only the former
  gets a `class_task_id` and enters report ranking;
- cancelled work is excluded; work passed by the report cutoff counts once by
  class task; work due in a future period or passed after the report cutoff is
  excluded from formal ranking; ties share rank;
- only valid countable self-study attempts contribute once per set, separately
  from rank. Vocabulary Practice at every selected-group count remains excluded;
- integer delta covers positive, negative, zero, and a zero prior period without
  rendering a percentage; family-level scores remain separate for `bbc`,
  `vocabulary`, `ielts-reading`, and `ielts-listening`;
- role-redaction tests prove a student payload includes no other student's
  `student_details`, comments, goals, membership rows, or attempt content;
  visitors, inactive users, unrelated students, and students requesting a
  preview are denied before any report payload is returned.

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
- `http://127.0.0.1:8000/reports.html`
- at least one BBC page
- at least one IELTS Reading page
- at least one IELTS Listening page
- at least one Vocabulary page
- `http://127.0.0.1:8000/dse-writing-guide.html`
- `http://127.0.0.1:8000/dse-writing-formats.html`

Public-share resource checks:

- both stable pages load without login and contain canonical `mrcatenglish.com` URLs,
  descriptions, Open Graph titles/descriptions/images, and the common site icon;
- login, Dashboard, Library, `content/sections.json`, and generated home catalog
  contain no link to either stable public resource;
- the brand, top `进入学习平台`, bottom CTA, and footer all lead to `index.html`;
- Share uses the native share sheet when available and otherwise copies the
  canonical URL; the old `temp-*` paths redirect and declare `noindex`;
- guide tabs, format tabs, checklist controls, and all six AI prompt-copy buttons
  work with pointer and keyboard input; no undefined `sendPrompt` error remains;
- at 390 px, tab rows scroll horizontally, content has no page-level horizontal
  overflow, CTA remains readable, and reduced-motion/transparency fallbacks work;
- `npm run build:static` includes both stable pages, both redirect aliases, and
  `assets/css/public-resource.css` plus `assets/js/public-resource.js`.

Run `node scripts/assign-bbc-render-themes.js 2026 --check` and confirm every
BBC 2026 runtime file and matching metadata file uses the same stable Luminous
Milk theme. Open one representative lesson for each of `milk-sage`,
`milk-blue`, `milk-pink`, and `milk-purple` at desktop and mobile widths; the
surface remains bright and readable while correct/wrong/locked feedback keeps
its shared green/red/yellow meaning.

IELTS Listening mode checks:

- a fresh student, assignment, visitor, or teacher-preview entry defaults to
  Practice Mode; Practice can pause, seek, replay, and select 0.75×, 1×, 1.25×,
  1.5×, or 2×;
- `Check Answers` returns feedback without creating an attempt, changing an
  assignment, entering FINISHED, or creating a STAR;
- starting Test confirms the destructive transition, clears Practice answers
  and feedback, restarts audio at 1×, and hides/disables pause, seek, and speed;
- an OS/browser interruption exposes Resume without enabling seeking; exiting
  Test creates no attempt; Test submit records `ielts_listening_test` plus
  `practice_mode: test` and unlocks Review playback controls;
- Try Again returns to clean Practice Mode at 1×, and refresh/leave during a
  running Test warns before discarding the unfinished test.

IELTS Argue checks:

- IELTS Reading and Listening show no new Argue control in student results,
  History, or teacher preview;
- direct student and teacher dispute calls for an IELTS set return
  `IELTS_ARGUE_NOT_AVAILABLE`, while existing historical disputes remain stored.
- `http://127.0.0.1:8000/dse-topic-bank.html`

Protected topic-bank checks:

- visitor/no-session mode shows the metrics, two topic samples, mosaic, and login action
- the public page source and catalog do not contain a known full-report-only phrase
- login with a dedicated development student returns directly to the topic bank
- the full report loads only after `getProtectedResource` succeeds, shows the
  student full-edition state, and passes the SHA-256 integrity check
- a logged-out direct function call returns `AUTH_REQUIRED`
- the generated private payload is ignored by Git and the deployment ZIP contains it

Protected JUPAS report checks:

- visitor/no-session and teacher sessions remain on the metrics/excerpts preview
- an active student returns directly after login and loads the complete report
- the public page source does not contain the full caveats or official-source section
- the private report contains the corrected Lingnan `.pdf` URL with no visible `.pdf)` suffix
- the backend role policy permits `student` and rejects `teacher` for this resource

Shared shell visual checks:

- the login form does not show a `STUDENT ENTRY` eyebrow, while the Student ID,
  password, sign-in, visitor controls, and accessible form heading remain present
- the login welcome quote sits in the upper portion of the left panel with a
  compact gap below `Mr. Cat Academy`, without the previous large empty region
  above the quote on desktop or mobile; at 390px the welcome panel also ends
  shortly below the quote rather than retaining a 430px empty box
- reloading the login page selects a sentence from the Dashboard's existing
  motivational quote set, and repeated reloads can display different sentences
- `index.html`, `library.html`, `dashboard.html`, and `teacher.html` load the
  versioned `liquid-glass-shell.css` and `liquid-glass-shell.js` assets
- BBC, IELTS Reading, IELTS Listening, and Vocabulary practice runtimes do not
  load the shared shell assets and retain their own exercise presentation
- login and public Library keep their existing control order and layout;
  Dashboard and Teacher use the approved spatial workspace layouts while
  preserving navigation targets, form IDs, modal behavior, and business logic
- neutral transparent materials are used for functional navigation/dialog
  layers, while repeated content cards and teacher matrix panels remain quiet
  standard materials without stacked live blur
- system blue appears on selected/primary controls rather than tinting the
  entire page; semantic category and result colors remain recognizable
- at 390px viewport width, login, public Library, and visitor Dashboard do not
  introduce horizontal page scrolling
- on a touch phone or iPad, two quick taps do not zoom the page; single-finger
  scrolling and two-finger pinch zoom continue to work
- My Words, assignment/notification, account, login, and teacher management
  dialogs remain top-layer, readable, closable surfaces
- open each Student Dashboard dialog from To Do List, Teacher Replies,
  Calendar, My Words, Personal Center, STAR Wallet, password change, and My
  Words merge; each dialog card uses the same elastic fade/scale/lift entrance
  as task-entry confirmation, while the backdrop and external Close capsule do
  not jump. With reduced motion enabled, each opens directly in its final
  position without visible bounce
- close each Student Dashboard dialog with its explicit `Close` control and
  confirm the control responds on press, the card fades/downshifts/scales
  without bounce, the backdrop releases with it, and only then do focus, page
  scroll, and the underlying control return. With reduced motion enabled,
  confirm the exit is a short opacity-only fade. Reopen and close each dialog
  at least three times; every cycle must restore full opacity and working Close
  controls, and no transparent overlay may intercept the Dashboard afterward
- opening any independent Teacher modal from Notifications, Argue, Student
  lookup/cards, assignment tools, practice entry, or success feedback freezes
  the background for mouse wheel, trackpad, and touch gestures while its own
  scroll container remains usable
- open Teacher Personal Center, each utility, Student lookup and metric detail,
  create/success flows, assignment pickers/editor, percentage picker, cancel
  confirmation, matrix detail, and attempt detail; every dialog card uses the
  same elastic fade/scale/lift entrance as task confirmation, while backdrops
  and external Close capsules remain still. Reduced motion opens each card
  directly in its final position
- use every explicit Teacher `Close` control above and confirm the same shared
  no-bounce exit runs before the existing close handler, including nested
  attempt/matrix dialogs and the anchored Personal Center popover. Reopen each
  reusable utility at least three times and confirm the toolbar and workspace
  remain clickable after every close
- stacked Teacher modals remain background-locked until the last modal closes;
  closing it restores the exact pre-modal document position without a jump
- verify reduced transparency, increased contrast, and reduced motion media
  preferences keep text and focus states legible

Practice navigation checks:

- Student Dashboard does not render a cat logo in its header; the standalone
  To Do List button occupies the far-left position without extra brand width,
  while the header/workspace left and right edges stay aligned. The Teacher
  header logo remains unchanged. The welcome pane has no `STUDENT WORKSPACE`
  label. Its smaller,
  China-time-aware greeting stays on one line; short greetings remain still,
  only overflowing greetings reveal horizontally, and reduced motion falls
  back to a static ellipsis. The motivational sentence remains below it
- at desktop width the Dashboard greeting and weekly progress rows share one
  surface in two columns; below 900px they stack without page-level horizontal
  overflow or nested glass cards
- the loading state shows one quiet `THIS WEEK` label and inline skeleton track;
  after load, `THIS WEEK` and `UPCOMING` always appear in that order. This Week's
  denominator combines current-week assignments with every overdue unfinished
  assignment; its numerator is current-week finished work. Upcoming uses next
  week's completed/total values, and both exclude self-study STAR records
- when at least one overdue task exists, the full This Week progress track uses
  a slow red breathing halo even at `0%`; reduced motion replaces it with a
  static red border. Without overdue work it returns to the standard green track
- populated Upcoming keeps its blue track, percentage, and focused-list action;
  empty Upcoming has no track, no `0%`, and no click action, and instead shows a
  quiet calendar-check `NO TASKS` status
- while current-week work is unfinished, future assignments remain visible in
  the To Do List's Upcoming section but do not contribute to its red badge
- completing assignments updates the matching fill and numeric percentage
  without replacing or hiding either summary row
- clicking or keyboard-activating `THIS WEEK` or `UPCOMING` opens a
  focused Assignments modal containing only that due-date group's task rows;
  This Week places overdue unfinished work first with a restrained red pulse,
  tasks are not expanded directly in the hero, and task activation still opens
  the standard entry confirmation. Reduced motion replaces the pulse with a
  static red emphasis
- each active progress bar and numeric percentage are inline to the right of its section label; no right-side
  count or empty-state copy such as `6 of 6 open` or `No assignments this week`
  remains, and an empty week renders no fake task row
- reduced motion shows final progress values without the reveal animation, and
  increased contrast/reduced transparency keep both tracks and labels legible
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
- on BBC, Vocabulary, IELTS Reading, and IELTS Listening, both leave
  confirmations match the compact Student Logout alert: a translucent 320-pixel
  card, dimmed/blurred backdrop, and one hairline-separated bottom row. Confirm
  there is no separate `Leave this page?` title: the card contains one uniformly
  styled warning sentence. Green `Cancel` on the left dismisses without
  navigating, while red-text `Leave` on the right performs either Back or Home;
  neither dialog shows a separate `Close` action. Background scroll remains
  fixed, Tab stays inside the alert, Escape cancels, and Cancel restores focus
  to the originating control
- static practice data requests use the public app-version query, not
  timestamp cache busting such as `?_=` + `Date.now()`
- IELTS Reading shows the set code only in the black exam bar, reduces paragraph
  matching choices to letters, resizes typed blanks with their content, and
  restores passage/question highlights after submission or reload; `Clear` and
  `Clear All` remove the expected saved highlight records
- Vocabulary Quiz still abandons the active server session
  on page hide/leave and must not be restored as an ordinary draft

For BBC pages with worksheet PDFs, verify the top-corner `Download Practice`
link returns HTTP 200 for the current set's PDF, and render at least one
representative generated PDF page to confirm it contains no answer key or
explanation text.

After submitting a representative BBC lesson with both correct and incorrect
answers, verify correct blanks/matching/MC cards are green, incorrect ones are
light red, and the yellow MC locked-answer state does not cover either result.
Close the result dialog and verify the page stays on the same worksheet, only
incorrect blanks and matching selects are editable, every correct control and
every MC radio remains disabled, and no lock icon is added. `Submit Again`
must remain disabled until an editable answer changes; after the repeat submit,
verify a new attempt is recorded while every MC result is still scored from its
first submitted choice. Run `npm run test:bbc-correction` for the corresponding
static regression gate.
For a `classroom-worksheet` lesson, also verify Show Answers and History/Explain
content spans the complete fill-blank or multiple-choice card at phone, iPad,
and desktop widths instead of collapsing into the question-number column.

Stop the server after testing.

## 4. Student Flow Checklist

Use a dedicated development student account, never a real student account.

Check:

- login succeeds
- profile loads
- opening `Change password` from the account panel shows the password dialog
  exactly over the Personal Center footprint: card width/height and the lower
  Close position/size match pixel-for-pixel at phone, iPad, and desktop widths,
  and the Personal Center card is not visibly stacked underneath. Its `Change
  Password` heading is centered, the
  top-left back arrow closes only the password dialog and returns focus to
  `Change password`, and the centered `Save Password` is the only form action.
  Confirm there is no separate `Account` label, top-right close button, or
  Cancel action. Backdrop and Escape do nothing; the external `Close` below the
  card closes both dialog layers, returns to Dashboard, and restores focus to
  the identity chip
- opening STAR Wallet replaces Personal Center in the exact same card and Close
  footprint at phone, iPad, and desktop widths; long wallet views scroll inside
  the card without moving or resizing the lower Close. Confirm wallet content
  sits directly on the shared glass surface with no nested white profile card,
  and `STAR WALLET` uses the same centered green eyebrow typography as
  `PERSONAL CENTER`
- clicking `Log out` opens a centered Apple-style alert, 320 pixels wide and
  approximately 165 pixels tall, instead of signing out immediately. It has no
  heading bar, back arrow, or external Close. A hairline-separated bottom row
  contains `Cancel` and a red-text `Log out`; Cancel restores Personal Center
  and focus to `Log out`, while only confirmation clears the session and
  returns to login
- Teacher Personal Center `Log Out` opens that same alert family; Cancel restores
  the Personal Center and `Log Out` focus, while confirmation clears the teacher
  workspace cache, signs out, and returns to login
- Student ID, Class, and System rows respond to pointer and keyboard activation
  with a restrained text movement but do not navigate or edit data; no row
  retains a selected background or pressed scale after activation, and reduced
  motion uses a brief non-moving response
- activating the Personal Center `Finished` row replaces Personal Center with
  a focused, newest-first completed-task list in the exact same 430-by-490-pixel
  maximum card footprint and the same lower Close position and size. It uses
  the same category, title, score, chevron, and task-entry confirmation behavior
  as Assignments; its top-left back arrow restores Personal Center and focus to
  the `Finished` row
- opening Personal Center from the identity chip shows no top-right `×`; its
  centered card uses the same thick glass, softly dimmed backdrop, radius, and
  depth as To Do List, Calendar, and My Words. Its only `Close` capsule is
  centered outside directly below the card; only that Close dismisses it,
  restores focus to the identity chip, and restores background scroll. Escape
  and backdrop clicks leave it open
- one yellow STAR counter shows Available balance and is clickable/keyboard
  operable; it dismisses Personal Center and opens an independent STAR Wallet
  modal whose landing view has a gold pass containing only a large Yellow STAR
  and number, with no visible balance label or Blue count. A solid deep-green
  `Redeem` button is clearly stronger than the soft-green `STAR Source` and
  `History` capsules; those two destinations have no trailing numbers and use
  the same font, size, and weight as `Redeem`. Back returns to Personal Center,
  and the external Close matches other student dialogs before returning to the
  Dashboard
- in Chrome, opening STAR Wallet paints a normal light standalone wallet surface
  with visible content, never a blank black block;
  one malformed legacy history row shows its own unavailable placeholder while
  the rest of the wallet remains usable
- STAR Wallet Back returns to the still-open Personal Center and restores focus to
  the yellow counter; it must not trigger the global outside-click closer. The
  separate lower Close action dismisses the complete modal flow
- `STAR Source` has no explanatory sentence above its groups, lists Yellow
  assignment STARs above Blue self-study STARs, labels the Yellow heading
  `REDEEMABLE` and the Blue heading `NOT REDEEMABLE`, and does not repeat those
  labels inside source capsules. Source rows have no chevron, link semantics,
  task-entry confirmation, or practice navigation; converted Blue rows remain
  visible
- `History` lists every Cash request newest first and keeps View proof, Add photo,
  and Cancel controls with the applicable request
- Redeem opens Cash directly, shows no money amount/rate, and its integer slider
  is exactly 1..available; zero balance disables submission
- creating Cash freezes exact Yellow STAR credits and replaces the form with the
  one open request; cancellation releases them
- student/teacher evidence upload shows private previews, enforces three active
  images and 10 MB original size, and moves the request to Awaiting teacher
- completed/rejected/refunded status becomes an unread STAR Wallet notification;
  opening `History` marks only the current student's results seen
- displayed counts and list lengths match achievement and append-only ledger
  projections, including grandfathered legacy duplicate Yellow STARs
- forced password change appears when expected
- Dashboard opens directly on the `Library` workspace and has no lower
  Assignments or My Words navigation
- the far-left checklist button is visually separated from the right-side
  utility controls, with the Teacher Replies bubble immediately to its right.
  It opens a modal whose initially selected button is `THIS WEEK`, with no separate
  `ASSIGNMENTS` heading or Teacher Replies control. Its shorter,
  internally scrolling card has no
  top-right `×` or in-card footer button; a single `Close` pill sits below and
  outside the card. Escape and backdrop clicks do not dismiss the modal
- the default Assignments modal has three equal-width, sticky top buttons:
  `THIS WEEK`, `UPCOMING`, and `FINISHED`, each with an accurate count. Only the
  selected category is visible, click and keyboard Left/Right/Home/End switch
  categories, and empty categories show a compact empty state. Finished rows
  remain ordered by completion time with the newest first
- a countable self-study attempt that reaches the set passing standard appears
  once in To Do List FINISHED, the Personal Center Finished count/list, and the
  completion calendar on its first passing date without waiting for assignment
- a later better self-study attempt updates the displayed best score without
  moving the first completion date; a finished assignment for the same set
  suppresses the duplicate self-study row, while an open higher-standard
  assignment may coexist with the prior self-study completion
- `vocabulary_practice_timed` activity attempts continue to notify the teacher
  but never appear in FINISHED, Personal Center counts, or the student calendar
- the hero shows This Week and Upcoming completion summaries without inline task
  rows; activating one opens its focused task-list modal. This Week includes
  overdue unfinished work first, followed by current unfinished and finished
  work. Both focused modals use green Personal Center title typography and do
  not render the Teacher Replies icon or unread badge
- every untouched assignment has a red `0%` pill aligned with the finished score
  position; no task row displays `TO DO` text. A failed submission remains open
  and replaces `0%` with its red historical-best percentage; only `passed` /
  `mastered` assignments move to `FINISHED` and use the green score pill
- To Do List assignment rows have no separate `Start` / `Open` buttons; the whole
  compact row is keyboard/click accessible, labels BBC work as `BBC` and every
  IELTS Reading/Listening task as `IELTS`, and keeps titles on one line. Only an
  overflowing title scrolls to reveal its full text; reduced-motion mode keeps
  it static with an ellipsis. The row opens the shared Library-style entry
  confirmation before navigation
- closing that entry confirmation with its lower `Close` returns
  to the same To Do List dialog and selected assignment row; choosing `Enter` closes
  both modal layers and opens the task. Escape and backdrop clicks keep the
  confirmation open
- the student assignment entry uses a checklist SVG rather than a bell or a
  single completion checkmark; its glass color, stroke weight, and visible icon
  size match the neighboring Teacher Replies control rather than using a unique
  green fill or oversized glyph
- the main header has a plain speech-bubble SVG immediately to the right of To
  Do List; it has no embedded checkmark and opens `Teacher Replies`
  even when the history is empty; all resolved replies appear newest-first,
  previously read replies remain after closing/reopening, and only unread
  replies contribute to the bubble button's red badge
- Teacher Replies has no top-left Back or in-card close icon. Its header shows
  only `TEACHER REPLIES` in the same green eyebrow typography as Personal Center,
  with no `xx replies in your history` line. A centered `Close` capsule sits
  outside and directly below the card in the same style as other independent
  student dialogs. Only Close dismisses the dialog, marks currently unseen
  items read, clears the bubble badge without changing the To Do List badge,
  restores the main Dashboard and bubble focus, and keeps question navigation
  working from each complete reply card. Escape and backdrop clicks leave the
  dialog open and do not mark replies read
- each Teacher Replies card shows its centered task title first on the same
  bounded overflow-scrolling track used by task rows. The saved question has no
  `Qxx.` prefix and wraps cleanly on phone and iPad. `Expected` and `Submitted`
  have no arrow between them; short values place their boxes side by side, while
  long values or narrow screens wrap them into full-width rows. The bottom row
  places the `Argued` timestamp on the left and the status capsule on the right;
  the timestamp matches the dispute's `created_at` in Shanghai time. There is
  no inline navigation button: clicking a card or
  pressing Enter/Space opens the shared confirmation with a `Go to question`
  action; cancelling returns focus to the same card. An old reply without a
  question snapshot shows an unavailable message while its card remains usable
- the notebook icon remains in the right-side utility group and opens My
  Words in an independent modal
- the calendar icon remains in the right-side utility group and opens a
  student-only, Monday-first monthly completion calendar; it contains no `Wxx`
  labels, cannot navigate beyond the current month, and includes both finished
  assignments and self-study STAR records
- the calendar icon contains today's `Asia/Shanghai` day number. Verify both a
  single-digit and double-digit date remain centered on Safari, the accessible
  label includes day/month, and returning to the page after Shanghai midnight
  refreshes the number without a backend request
- selecting an active calendar date shows every task completed that day with
  its type, score, and STAR state; empty dates show a quiet empty state, today
  and the selected day remain distinguishable without relying on color alone,
  and future dates are disabled
- the completion calendar has no `Progress` header/subtitle, completed total, or
  active-days total; its month/year navigation begins at the top of the content
  area. It uses the same translucent glass card and external Close capsule as
  Assignments. Each completed task row matches Assignments with a
  left category capsule, scrolling one-line middle title, right score and
  chevron; click/Enter/Space opens the shared entry confirmation, closing it
  restores the same calendar row, and Enter opens the correct practice URL
- at 390px phone, iPad, and desktop widths, all seven date columns remain fully
  visible with no horizontal page overflow; only Close dismisses the modal and
  restores focus to the calendar button, while Escape and backdrop clicks leave
  it open
- On iPad Safari, cold-load the Dashboard and open Calendar for the first time.
  Every date number must be vertically and horizontally centered in its square
  before and after changing months, selecting a day, rotating, and reopening
  the modal; STAR markers remain independently anchored at bottom-right
- Library shows a large heading with the search button and `Practice` / `Exam`
  control grouped beside it; clicking the button expands an anchored search
  input, while Close and Escape clear/collapse it and restore focus to the button
- the current Library category is shown inside the title as
  `Library / current category⌄`; the old always-visible gold category row is not
  rendered. Clicking the category opens an anchored popover without moving the
  cards, and selection, outside click, and Escape close it with correct focus
  and `aria-expanded` state
- Library task cards render as two columns on desktop and one column at 390px
- after selecting `NGSL`, searching for a BBC Set ID such as `BBC-250102`
  automatically activates the matching BBC year capsule and shows that task;
  searching for `C7-T1-S1` from Practice similarly activates `Exam` and
  `IELTS Listening`
- a Library query with no matches shows one global no-results message instead
  of a placeholder card from the previously selected capsule
- the Dashboard notebook icon navigates to `my-words.html`, retains no hidden My
  Words dialog runtime, and warms at most the bounded first page after primary
  Dashboard content is ready
- open My Words at desktop, tablet, and 390px phone widths. Desktop keeps the
  Sidebar and split notebook; mobile replaces the Sidebar with sticky tabs and
  keeps the word grid within the viewport
- at iPad and desktop split widths, scroll the left word index to its middle and
  bottom and select words there. Confirm only the left index moves, while the
  right detail remains anchored, updates immediately, and starts the newly
  selected word at the top of its pane.
  If the detail is taller than its pane, confirm it has its own independent
  scroll; the phone layout must continue using normal document scrolling
- compare the same saved word on phone, iPad, and desktop. Confirm the visible
  information order is identical: word and speaker, POS and English definition,
  optional Forms, Source box, and Note box. On iPad/desktop the content remains
  in the fixed right pane, has a circular pencil instead of the old three-dot
  menu, and never opens a modal. Its pencil shows the same spelling warning and
  edits Word, every Source sentence, and Note together without auto-focusing
- open phone detail cards for long words and multi-word phrases and confirm the
  title always stays on one line, reducing its font size to fit rather than
  wrapping. At iPad/desktop widths, confirm the word occupies the first row, the
  speaker sits immediately beside it, and the pencil is at the far right of that
  same row instead of consuming a separate row above the word
- while signed in with an empty feedback message, switch from Review to My
  Words and confirm the toolbar begins directly below the primary navigation;
  expand Export and confirm `All`, `This Week`, `This Month`, and `This Year`
  are fully visible and do not slide underneath the sticky toolbar
- at 390px, confirm the second toolbar action opens one compact picker with
  one-, two-, and three-column choices; each choice changes the word grid,
  closes the picker, updates its pressed state, and survives reload. Confirm the
  next action is a `中` SVG toggle: the initial grid is English-only, its first
  press shows a left-aligned `part of speech Chinese meaning` line below every
  word with no middle dot, its second press hides those lines, and the choice
  survives reload. Confirm the download
  icon remains after it and still opens the complete Export panel
- reopen the one/two/three-column picker, then drag/scroll the word list without
  choosing a density; confirm the picker closes as soon as list motion begins
- scroll near the middle and bottom of a long word list, open Export at each
  position, and confirm the complete parameter panel appears directly below the
  visible download button without scrolling upward or moving the word list.
  With it open, drag, wheel, or scroll the word list and confirm it closes
  immediately
- confirm Export presents time range first, printable fields second, one
  Excel/PDF selector third, and one full-width `Export` button last. There is no
  `Select all results` button. The fields row starts with `Default`; selecting it
  restores exactly English, Chinese, Part of Speech, and English Definition
- open a saved word on phone and confirm a circular pencil is outside and above
  the card, while Close is the only control below it. The card has no three-dot
  menu, `WORD DETAILS`, `Saved word`, `Teacher
  reviewed`, or `Pronunciation pending`; it shows word plus speaker, then POS
  plus English definition, optional Forms, a labelled Source box with sentence,
  origin, and date, and a labelled Note box
- confirm the mobile detail card appears first and the word is spoken once only
  after approximately one second; pressing the speaker during that delay speaks
  it on demand and cancels the pending automatic playback
- click the external pencil and confirm the spelling/dictionary-loss warning is
  shown before editing begins. Continue and confirm the card remains at the same
  scale and scroll position with no input focused or selected automatically.
  Then tap the desired field and verify the English word, Source
  sentence, and Note are editable together, while source origin/date and
  dictionary fields remain read-only. Save once and confirm all three changes
  persist; focusing any input or textarea on iPhone/iPad does not zoom the page
- open and close words on a phone-width layout and confirm both state changes
  are immediate: the modal does not travel, scale, shrink, materialize, fade, or
  flash its destination. Confirm the locked scroll position does not jump and
  the originating word remains visibly selected after Close. Escape and
  backdrop clicks leave the detail open. At iPad and desktop split widths,
  confirm clicking a word never opens an overlay or locks the page: it selects
  the left-side word and updates only the right-side detail. Resize an open phone
  modal into the split layout and confirm it closes while preserving selection
- Add uses the green circular header control and exposes only one Enter-to-save
  field. Search belongs to Word List; leaving Word List clears the query while
  keeping sort and density preferences
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
- Vocabulary countable tests use `90%` passing and `100%` mastery by default;
  BBC uses `80%` and `95%`; both remain overridable by the set or assignment
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
- editing a student's Name saves the corrected display name without changing
  Login ID, auth UID, assignments, or attempts
- clicking Class in a student detail shows existing active classes in a select,
  keeps the manual name field hidden initially, and reveals it only after the
  bottom `Customize` option is selected; choosing an existing class or saving a
  custom class updates the profile and leaves exactly one active membership
- reset password enables the auth user, sets `must_change_password`, and then
  opens the compact checkmark confirmation with the Login ID and initial
  password; Done, backdrop, and Escape close it and restore reset-button focus
- deleting a student account removes the CloudBase Auth end user, hides the
  student from Students, Assign candidates, View progress, activity attempts,
  and Argue lists, while preserving historical attempts/assignments in storage
- after deletion completes, creating a new student with the same Login ID
  succeeds with a new `auth_uid`; the deleted profile retains the old Login ID
  snapshot and its historical records are not attached to the new account
- Assign shows available students
- Assign keeps the main tab surface to selected work/student chips and opens
  standalone picker dialogs for work and student search/filter selection
- Assign shows visible static catalog items missing from CloudBase `sets` as
  disabled import-required rows instead of hiding them
- Assign still resolves imported CloudBase `sets` when the live `sets`
  collection has more than 200 visible records
- Student and Teacher Library expose only `Practice` and `Exam` top-level
  filters; lesson sections appear under Practice
- Student Practice Library title-popover choices show `BBC2024`, `BBC2025`,
  `BBC2026`, `NGSL`, `NAWL`, `TK2`, `Oxford5000`, `DSE`, and `IELTS`, with no
  generic `Vocabulary`, `Grammar`, `Writing`, or `Grammar Lessons` choice;
  Teacher Library keeps its existing visible sub-filter row
- switching Practice/Exam or using global Library search keeps the inline
  category title synchronized with the active category
- Teacher Assign filters, Teacher View matrix type filters, and student
  assignment cards show Vocabulary sets as `NGSL`, `NAWL`, `TK2`, or
  `Oxford5000`
- teacher notifications merge multiple attempts from the same student
  assignment thread, or the same student/set self-study thread, into one row
- a grouped notification shows its attempt count and opens the complete attempt
  history for that thread
- each BBC/Vocabulary attempt card header keeps `#n`, Shanghai date/time, and
  the paper icon on one row, with no repeated `Attempt` label, percentage, page
  duration, or audio duration; the bar chart still shows percentages
- BBC wrong-answer rows show compact sequential labels such as `Q6` even when
  stored IDs use `Blank_06`, `Question_06`, or `MC_06`
- Vocabulary Quiz cards place `Quiz` plus the selected set count below `#n` in
  the header's first column; timed Practice cards place `Practice` followed by
  one ascending, separator-free group sequence there, use `X` for group 10,
  and remain on one line (for example, groups 1/2/3/5/10 show `1235X`).
- the notification attempt-detail card exactly matches the underlying
  notification card footprint on desktop as well as mobile; newly loaded answer
  comparisons reveal once with a restrained transition, do not replay during
  later interaction, and use opacity only when reduced motion is requested
- teacher notification task labels stay on one line with ellipsis overflow;
  latest score remains fixed at the far right, while the attempt-count capsule
  sits before date/time and changes blue/amber/rose for 1/2/3+ attempts
- opening the teacher notification bell alone does not clear the header badge
  or red unread row styling
- Teacher startup shows the circular loading state on Notifications until the
  lightweight unread count resolves, then atomically replaces it with the final
  badge or plain bell; Argue remains non-blocking and the desk does not wait for
  either full list before rendering
- notification summaries arrive in newest-first ten-thread pages; when 11, 20,
  or more unread threads exist, background paging continues until all unread
  threads are represented, then stops before older read history
- unread notification details and public question text prefetch top-to-bottom in
  current-tab memory; no more than two private detail requests run concurrently
- opening Notifications shows the first ten-thread summary page; scrolling near
  its bottom appends exactly the next ten-thread page,
  with no `Load more` button and no duplicate request while a page is pending
- opening Notifications does not recursively fetch extra read-history pages just
  to fill a tall desktop card; each actual scroll-edge arrival requests one page
- scroll-loaded read-history threads do not prefetch attempt details; only unread
  threads warm answer comparisons, while opening any row still loads its complete
  authorized thread on demand
- opening a grouped attempt notification clears its red state; a later attempt
  in the same thread makes it red again while unopened threads remain red
- an ordinary in-progress assignment cannot be duplicated; a complete Class
  Assign reuses an existing open individual record and promotes it into the
  class batch with the new class parameters
- completed/mastered/STAR work can be reassigned
- completed reassignment creates a new `assignment_id`; class integration of an
  open individual record preserves its `assignment_id`
- Assign supports choosing Students before Work and Work before Students; the
  opposite picker color-codes prior assignment state
- Assign marks open `in_progress` student/work pairs as mergeable for a complete
  Class Assign, while completed/mastered pairs stay colored and selectable
- every selected task previews Not started, Existing progress, and Already
  finished counts with student details before confirmation
- Assign selected Work and Students render one row per item, each with a small
  remove control that clears that selection without reopening the picker
- Student picker no longer shows a `Select filtered` bulk-select button
- Assign task parameters render as one row per selected Work item with Task,
  Date, Passing %, and STAR columns
- Assign Date offers only `This week`, `Next week`, and `Customize`; Customize
  reveals Week/Date controls, and Week clearly labels the current Wxx week
- Assign supports different dates/weeks, passing percentages, and STAR settings
  for different selected Work rows in the same submit
- Passing % and Mastery % open a complete five-row wheel on phone, iPad, and
  desktop; touch/trackpad scrolling snaps to whole percentages and does not
  scroll the page behind the modal
- Wheel Cancel, backdrop, and Escape preserve the old value; Done commits it;
  arrow/Page/Home/End keys and Enter work without a pointer
- Assignment editing uses the same wheel and checks the matching change toggle
  after a committed value
- Assign rejects an `Earn STAR` row until `Mastery %` is filled, and stores
  checked STAR assignments with `mastery_enabled: true`
- Assign-created work for a future Week appears in Teacher View under that Wxx
  assignment column/date filter
- Library opens practice pages in `teacher=1`
- Show Answers uses teacher route and does not lock student mastery
- Progress reflects recent attempts
- a 96% assigned Vocabulary Quiz followed by a 100% Library/other Quiz updates
  student FINISHED and Teacher View to 100%, regardless of selected group count
- a later equal or lower countable score remains in History but does not change
  `best_improved_at` or move the FINISHED row forward
- a BBC attempt submitted after answer reveal/mastery lock remains History and
  cannot increase the effective Best Score
- Teacher page opens to View by default, and the initial matrix loading state
  shows only the animated grid/radar wash without visible loading copy or a
  centered spinner
- Teacher workspace keeps `View`, `Assign`, and `Library` in one horizontal
  segmented navigation row above the content on desktop, iPad/tablet, and
  mobile, with no left-sidebar breakpoint or repeated destination heading
- loading or refreshing `teacher.html` or a stale `?view=tasks` URL opens
  `View`; the explicit `?view=library` practice-return URL still restores
  Library before remote data finishes
- Teacher has no standalone greeting hero, top-left `Mr. Cat Academy` wordmark,
  or `TEACHER` / `View` / `New assignment` block. The shared black full-body cat
  logo appears at the far left with the same `40px` footprint as the adjacent
  circular utility buttons, while the notification, Review, student lookup, and
  account controls remain aligned to the right. The top utility glass aligns
  exactly with the workspace frame below, and View begins directly with the
  matrix while keeping the existing `Class`, `Column`, and `Date` controls
- the workspace and matrix top corners stay continuously rounded; inspect both
  top corners of the View matrix while horizontally scrolled and confirm sticky
  or colored header cells cannot expose a contrasting square tip inside the
  curve
- Student lookup keeps the `+` action, live name search, and visible class
  filter. List rows show only student names. Opening a student shows one
  identity capsule with Chinese and English names plus exactly three action
  capsules: STAR count with a star icon, Completed/Total with a check-circle,
  and Account. It shows no Attempts, Login ID, class, System, or Active metadata
  in the summary. Dragging or swiping
  within the detail moves only vertically; mouse, trackpad, and touch gestures
  cannot pan the card or content horizontally
- Create and edit one bilingual student and verify CloudBase stores separate
  `chinese_name` / `english_name` values while server-derived `name` is
  direct `ChineseEnglish` concatenation. Search must match either language in Students and Assign.
  A legacy profile with only a mixed `name` must remain one fallback label with
  a review hint; it must never be heuristically assigned to the Chinese field
- On a returning student account, verify cached assignment summaries and counts
  paint before the live Dashboard response, then update silently without a
  spinner or blank reset. Explicit logout must delete the Student IndexedDB
  snapshot, and inspecting that store must show no reply body, attempt answers,
  correct answers, explanations, grading keys, credentials, or auth tokens
- With more than 20 assignments, verify bootstrap returns no more than 10 To Do
  and 10 Finished rows, each list appends exactly 10 at its internal scroll edge,
  all unread Teacher Replies are ready in memory, and earlier read replies use
  `Load 5 more`
- clicking Account opens an independent dialog containing names, Login ID,
  class, System, reset password, and delete account. The main student detail has
  no bottom Account settings disclosure. The dialog's class editor lists existing active classes
  with `No class` first and `Customize` last. The custom class-name input stays
  hidden until Customize is selected; its top-left back arrow restores the same
  student detail and Account focus. The detail contains no teacher-facing My Words section
- after selecting a student, the lookup title bar shows only the Back control
  and does not repeat the name already shown in the first identity card
- clicking STAR opens an independent source dialog grouped into Yellow
  assignment and Blue self-study records with title, earned date, best score,
  and conversion state; it makes one selected-student `getStudentStarSources`
  request and closing it restores the Student lookup and STAR focus. Confirm
  the dialog stays centered over the viewport instead of revealing the Teacher
  homepage or appearing below the current scroll position
- clicking Completed opens a separate dialog containing both To Do and Finished
  counts and task rows; it also stays centered over the viewport, and closing
  restores Completed focus. The main student detail contains no Overall
  Progress card
- the Student lookup STAR Redemption and create-student actions match the main
  Teacher header controls: 40px circular glass buttons, 20px outline SVGs, and
  the same neutral icon color
- STAR Redemption, Create Student, STAR Source, and Completed each show a
  top-left back arrow and no external bottom `Close`; Create Student has no
  top-right `x`. Returning restores the Student lookup, selected student detail
  where applicable, scroll lock, and keyboard focus
- both Student lookup detail and the View matrix student modal render the same
  monthly week-band calendar. Previous/next month bounds work, Monday-first
  dates align correctly across 4/5/6-week months, completion density and STAR
  markers use progress summaries (including self-study), and selecting a day or
  Wxx band refreshes the completed-work detail without exposing answer data
- Assign shows side-by-side Work and Students summaries on desktop, keeps all
  current picker modal designs and behaviors, and retains the per-task parameter
  matrix below; the summaries stack at 390px
- every selected Assign task row has a mandatory Due week selector; submitting
  without a valid due week is rejected by `teacherAdmin`, while This week,
  Next week, and custom Wxx choices persist as Shanghai-time Sunday 23:59:59
- `npm run test:assignment-schedule` verifies required due-week enforcement,
  Sunday normalization, backward-compatible `assigned_at` alias handling, and
  dry-run/apply legacy backfill behavior; it also exercises the exact Dashboard
  model so Upcoming stays out of the red count while the two homepage progress
  summaries remain visible and overdue work contributes to This Week progress.
  Its large-history fixture includes 60 distinct historical sets and must load
  all assignments with one batched `sets` read rather than one read per set
- with a student that has at least 40 distinct historical assignments, reload
  Dashboard several times and confirm CloudBase `getDashboard` logs remain
  successful, Finished and Calendar retain history, and no invocation ends with
  status `433` or `Invoking task timed out`
- if `getDashboard` is unavailable, the student page shows `Unable to load the
  dashboard` with a `Retry` button and `UNAVAILABLE` weekly status; it must not
  claim that the account has no assignments
- Open the Assign Work and Student pickers before and after the Assign page has
  become taller than the viewport; both dialogs must remain centered in the
  current viewport with an internally scrolling list and no blank page area
- At both page scroll 0 and a deep View/Assign scroll position, open every
  Teacher top-level surface (Review, Student lookup, Create student, success,
  Work picker, Student picker, matrix/student detail, assignment editor,
  notification and practice-entry confirmation). Each must be mounted outside
  the backdrop-filtered workspace, appear immediately in the current viewport,
  and require no page scrolling to reach its content or Close action
- top-right circular student ID icon opens the standalone student lookup
  modal at roughly three-quarters of its former desktop size; its centered
  `Close` capsule sits outside below the card, and Choose expands a floating
  scrollable list above the student detail/progress cards instead of clipping
  the list to the first card. The magnifying-glass action replaces Choose in
  place with a live search field; both modes keep pointer/touch scrolling inside
  the list. Search filters immediately, clicking a row selects it without
  Confirm, and closing Create student by its close control, backdrop, or Escape
  restores the same Student lookup modal. The modal's internal `+` opens
  create-student, and View no longer shows student info/progress below the matrix
- Teacher View `By student` expands a student into a history list with best
  percentage fixed on the far right, and clicking a task opens the same
  independent detail modal as the top matrix
- Teacher View progress mode tabs show only `By student` and `By task`; the
  capsule sticks over the main Assign/View/Library tabs while scrolling, and
  `By task` summaries show Total plus Avg with unfinished assignments excluded
- Teacher View expands to the desktop workspace width and does not stay capped
  at the narrower student dashboard shell width
- clicking or keyboard-activating a linked task header at the top of the
  Teacher View matrix first opens the shared practice-entry confirmation;
  `Close`, Escape, and backdrop dismissal preserve the unchanged matrix, while
  `Enter` opens its `teacher=1` practice preview and `Back` returns to
  `teacher.html?view=view`
- Open the shared practice-entry confirmation from Student To Do, Student
  Library, Student Calendar, Teacher Library, and a Teacher View task header.
  A not-yet-passing score must use the same neutral gray ribbon and text in
  every entry point; passing remains green and mastered remains gold
- before entering a Teacher View preview, select non-default Class/Column/Date
  filters, change matrix density, horizontally scroll the matrix, scroll the
  page into grouped progress, switch By student/By task, and expand a group.
  Application Back must restore every one of those states and the same visible
  matrix/group anchor; the practice-entry confirmation and detail modals must
  remain closed. Repeat once with bfcache disabled/evicted to exercise the
  history/session fallback. IELTS Reading and Listening Back controls remain in
  their existing top exam bars.
- Save a wide Teacher View density on desktop, then load the same site on a
  phone-width viewport. The matrix must start in Fit, show the surname in the
  sticky first column, and make the actual first grid track compact with no
  desktop-width blank area. A manual phone density change may survive preview
  Back navigation, but a fresh phone load must return to Fit.
- With live progress, an IndexedDB-cached progress item, and a legacy assignment
  record in turn, confirm the matrix `Wxx` control and the task-cell detail
  `Edit` action both open the assignment-parameter dialog. The three record
  shapes may identify the assignment by `assignment_id`, `_id`, or
  `progress_id: assigned::<id>`; Save and Cancel must send the same resolved ID.
- after one successful live Teacher load, reload or reopen Teacher on the same
  private device and confirm the redacted IndexedDB matrix snapshot paints
  before the authoritative refresh. Inspect stored data to confirm it has no
  attempts, submitted/correct answers, explanations, grading keys, credentials,
  or auth tokens; explicit logout removes the account cache.
- while Teacher View is open and scrolled, create a newer student submission.
  The periodic/visibility refresh must update the relevant progress and
  notification data automatically without resetting filters, collapsing groups,
  moving page/matrix scroll, or changing the first visible task column.
- First successful matrix render transitions in with a soft fade/lift instead
  of abruptly replacing the loading state
- Teacher shell uses neutral glass for functional layers and system blue for
  selected/primary controls, without continuous rainbow movement or overriding
  passed/mastered green states and low-score red states
- Grouped progress items below the matrix keep quiet neutral/green status
  styling instead of repeated rainbow-filled mode tabs, student capsules, or
  stat pills
- Top-right teacher icon buttons show compact spinner states while loading and
  header capsules do not show separate rainbow underline accents
- Teacher header bell, Argue hand, and Student lookup buttons have identical
  40px circular bounds, matching surface/hover/focus styles, 20px icon boxes,
  and equal-looking 2.2px strokes; the hand is not visibly thinner
- Progress still reflects assignment attempts after attempts/assignments exceed
  one CloudBase read page
- View matrix shows completed status from linked attempts even if assignment
  summary fields are stale
- View matrix shows a green check, not a star, for completed assignments whose
  `mastery_enabled` is false
- View matrix date filtering uses required assignment `due_at` in Beijing-time
  natural weeks: `This week` is Monday-Sunday of the current Beijing week,
  `Next week` is the following Beijing Monday-Sunday range, `Last week` is the
  previous Beijing Monday-Sunday range, and `Self study` shows records without
  an assignment separately
- View matrix task headers show only task ID and task name, with no Wxx label;
  clicking a header opens that task's teacher preview. Exactly one DUE AT row
  appears below the headers and above student scores, its sticky first cell
  reads `DUE AT`, and every assigned task cell contains its zero-padded Wxx
  due-week grouping label; legacy missing `due_at` records use their derived
  fallback only until migration. Week numbering starts
  at the first Monday of the relevant year. The top-left matrix header is
  visually empty. The DUE AT row uses a lavender-grey parameter surface, a
  sliders icon, and purple-outline Wxx capsules rather than passed-state green;
  hover/focus/press makes editable Wxx cells more prominent. All row cells keep
  equal height, continuous borders, and exact column alignment. Verify this at
  phone portrait width (below 760px) as well as phone landscape/desktop width;
  rotating the device must not shift the DUE AT first cell or Wxx boundaries
- At a 390px portrait viewport, clear the saved matrix-density and axis
  preferences and verify the default `Fit` state is transposed: student names
  form the top columns, tasks continue as vertical rows, and a three-to-four
  student class fits without horizontal matrix scrolling. Compact sticky task
  labels retain both teacher-preview entry and editable Wxx; status icons sit
  above scores without `%`, and student names truncate rather than widening
  their columns
- Matrix `−`, `Fit`, `+`, and axis-swap controls respond immediately. Axis swap
  changes between student rows/task columns and task rows/student columns while
  preserving filters and page position; task preview, Wxx editing, student
  detail, and score detail work in both orientations. Desktop and phone axis
  choices persist independently, and crossing the 760px breakpoint loads the
  saved choice or the desktop-standard/phone-transposed default. `+` increases the
  real task-column width and eventually restores full task names and horizontal
  scrolling, `−` steps back down, and `Fit` returns to the complete-width
  overview. Reload preserves an explicit choice on that device; with no saved
  choice, crossing the 760px breakpoint switches between phone Fit and desktop
  comfortable sizing
- Verify the sticky student column follows the same density changes: comfortable
  levels show full names and size to the longest visible one, the tightest
  non-Fit level shows an extracted English name when available, and Fit shows
  the Chinese surname or English-only final name. Short names must result in a
  genuinely narrower first column, while hover text, accessible labels, and the
  student-detail action continue to use the full saved name
- At phone width, the Class, Column, and Date filters share one equal-width row
  and do not create their own horizontal scroller. Changing any filter keeps
  the density controls working and recalculates Fit for the resulting column
  count; phone week labels read `This Wxx`, `Next Wxx`, and `Last Wxx` without
  clipping
- Clicking a matrix task's Wxx cell in the DUE AT row opens one parameter editor
  for every
  assignment in that visible column; a class/individual filter limits the IDs
  to that scope, and saving due/pass/mastery/Earn STAR updates all represented
  students without changing assignments hidden by the filter. Confirm its old
  top-right close icon is absent and the standalone `Close` capsule sits outside
  and directly below the editor card on phone and desktop widths
- the parameter editor has exactly three rows and no explanatory footer or
  per-field change checkboxes: Due week selects directly, Passing % and Mastery
  % use the draggable scroll wheel, and only Earn STAR has a checkbox
- with Earn STAR off, Mastery % is visibly disabled and may be lower than a new
  Passing % without blocking save; turning Earn STAR on requires Mastery % at
  or above Passing %
- the footer's Cancel assignments control uses muted red text, a pale red
  tint, and a fine border rather than a solid red fill; hover/focus may gently
  strengthen the tint, while the second confirmation retains the stronger
  destructive treatment. Keep assignments, backdrop, or Escape return safely
  to the editor, and destructive confirmation affects every explicit
  non-cancelled assignment ID in scope, including passed/mastered records
- cancelling a passed/mastered assignment removes it from active Student and
  Teacher View assignment projections without deleting immutable attempts,
  set-wide completion progress, best score, completion timestamps, or protected
  STARs; a later reassignment still initializes from the historical global best
- opening Edit from one student's assignment detail submits only that student's
  assignment ID, while a task-column Wxx edit submits every visible filtered
  student assignment in that column
- View matrix renders repeated assignments of the same set as separate columns,
  including repeated assignments in the same week
- View matrix includes every student matching the current filters, including
  students beyond the first dozen sorted rows
- Clicking the matrix left student-name column opens an independent four-week
  progress modal with that student's Total, Done, and Avg summary; its Wxx
  labels, Mon-Sun squares, completion-density/STAR states, and selected day or
  week detail match the student Dashboard and include completed self-study
- Clicking a matrix cell opens the independent page-level detail modal instead
  of rendering the detail inline under the matrix; its `Close` capsule is
  centered outside and directly below the scrollable detail card
- Opening a teacher notification attempt for the first time shows the full
  attempt-detail dialog height; closing and reopening should not be required
  to get the normal modal size
- Opening a teacher notification attempt plays the dialog entrance exactly
  once. Loading the authorized per-attempt comparisons and persisting the
  reviewed state update the open dialog without replaying its scale/lift motion
- Teacher notification `Read all` clears every current unread thread and bell
  badge, persists after reload, stays disabled when everything is read, and a
  later attempt becomes unread
- The Dictionary notebook icon is absent from the teacher page header and sits
  at the far right of the notification modal toolbar; clicking it opens the
  unchanged Dictionary workspace
- the Teacher header Yellow STAR badge counts Awaiting proof and Awaiting teacher
  Cash requests; its modal opens in the current viewport, locks background
  scroll, sorts pending oldest-first, and restores icon focus on close
- STAR Redemption matches the Notifications card width and viewport footprint
  at desktop and phone sizes. Its title remains mathematically centered, its
  back arrow stays inset at the card's top-left, and the backdrop, dialog,
  sticky header, and request cards retain distinct translucent glass depths
- a request with no active evidence cannot be confirmed; after opening evidence,
  Confirm cash given requires a second confirmation and atomically changes
  reserved to spent once even after double-click/retry
- rejection requires a reason and releases reservation; completed records remain
  immutable, while Refund appends a reasoned correction and returns the credit
- teacher evidence upload can append a correction after completion; superseding
  an image never removes the original from authorized history
- Teacher notification modal has no `NOTIFICATIONS` / `Student attempts` text;
  the left double-check icon exposes a `Read all` tooltip and accessible name,
  spins while saving, briefly turns green on success, and sits in a compact
  toolbar without a tall empty header strip. The notification card
  uses at most about three-quarters of the viewport height with internal
  scrolling; it has no top-right `x`, and its centered `Close` capsule sits
  outside immediately below the card on desktop and mobile. Opening the bell at
  any page scroll position places the card in the current viewport immediately;
  no blank overlay or downward page scroll is required
- Opening a task from the teacher notification list replaces the list with an
  attempt-detail card at the exact same width, height, centered position, and
  external `Close` position. Closing by `Close`, Escape, or detail backdrop
  restores the notification list instead of closing the bell surface
- On first opening a teacher notification thread, the detail scroll position is
  at the top with the complete attempt chart visible, no bar/card is preselected,
  and the page does not jump to the latest answer card
- On that first opening, every attempt card shows a temporary loading state and
  then its wrong-answer/correct-answer comparison without requiring the paper
  icon/back round trip. Multiple attempts are fetched as separate authorized
  detail requests, while `listAttempts` remains summary-only.
- At desktop and phone widths, the comparison table's Q-number column stays
  visibly narrower than either answer column; long answers wrap inside the two
  remaining columns without widening the dialog.
- The top-right raised-hand Argue dialog and Student lookup dialog use the same
  card bounds, centered position, internal scrolling, and external `Close`
  capsule design as the teacher notification dialog at desktop and phone widths
- Matrix attempt cards show `Page ... · Audio ...` timing for audio attempts
  and keep older/non-audio attempts readable when audio timing is absent
- Matrix/notification attempt charts use 48px attempt columns and 14px capsule
  bars at phone, iPad, and desktop widths. Each shows score, `#N`, compact
  no-space timing such as `P18m42s` / `A12m08s`, omits A when unavailable, and
  horizontally scrolls without widening the visible bars when attempts overflow
- Attempt charts place muted Passing and enabled STAR reference lines at the
  correct score heights; tapping a bar adds the selected outline and still
  scrolls to the matching attempt card below. Reduced motion removes press and
  width transitions without removing selection feedback
- Open the paper report for a BBC attempt containing both correct and wrong
  answers: only wrong questions appear, and each shows student answer, correct
  answer, and the private answer explanation. An all-correct BBC attempt shows
  the no-wrong-answers state.
- Open recorded Vocabulary Quiz and timed Practice attempts: both reports show
  only wrong questions, use the correct `Quiz` / `Practice` label, and retain
  every selected group ID. Practice creates a teacher notification but does not
  alter the View matrix, assignment summary, FINISHED, or student calendar.
- From a Notification paper report, a wrong non-empty answer with no Argue shows
  `Add as accepted answer`. Clicking once disables the button, adds the variant
  to the private grading key, writes approved dispute/history audit rows,
  upward-regrades matching historical attempts, refreshes assignment/STAR
  projections, removes the button, and does not create a student Teacher Replies
  inbox item. Blank, already-correct, IELTS, and any
  existing-Argue question must not expose or accept this action. The same paper
  opened from View does not show the shortcut.
- Set a task to non-default Passing and Mastery values, submit an attempt, then
  open it from both Teacher View and the notification bell. Both charts must
  show the backend assignment values. For a historical thread whose assignment
  is unavailable, the chart must use the backend attempt snapshot; if neither
  response contains a threshold, the browser omits that line instead of
  displaying a fixed 50/90 fallback.
- With enough attempts to require horizontal scrolling, the Passing and enabled
  STAR dashed lines remain visible continuously through the rightmost bar at
  phone, iPad, and desktop widths
- View shows only `By student` and `By task` groupings without Open/Watch status labels
- `By task` bars sort student completion from low to high and open the same
  independent detail modal as matrix cells
- editing due week/pass/mastery in View updates only the selected assignment
  records; due week changes `due_at` and moves them to
  the chosen Wxx matrix group/filter without changing attempts; moving one
  record from a shared batch splits only that record into the new week column
- an assignment whose frontend stable ID is its document `_id` (legacy records
  without `assignment_id`) updates successfully from a task-cell Edit, and a
  mixed batch containing canonical IDs plus `_id` fallbacks updates every row
- when an edit resolves zero records, the editor stays open and reports a
  refresh/retry error instead of closing with `0 assignment(s) updated`
- after matrix re-rendering and after a task-detail modal is moved into the
  shared modal root, its Edit button and the visible Wxx parameter button each
  still open exactly one assignment editor
- `scripts/test-assignment-due-weeks.js` executes the real Teacher delegated
  click handler with `assignmentEditScopes` cleared and a legacy
  `assigned::<document-id>` record; the test passes only when one
  `.assignment-edit-overlay` is appended and reports an explicit retry error
  rather than opening a partial editor when the requested assignment is absent
- Student lookup opens with its search field and `+` action in the top bar;
  selecting a result replaces the search field with the student's name, and
  the back control restores the searchable student list
- Argue list loads and groups disputes in five-record status pages; `Load 5 more`
  appends the next page and status totals remain complete
- Argue status tabs use the same neutral uppercase label styling; Approved and
  Rejected show quiet background-free totals directly below their labels, while
  Pending shows a red notification count
  only when unresolved requests exist
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

## 5a. Learning Reports V1 Checklist

Prepare a dedicated development class with at least: two full-period members
  who tie, one partial-period transfer, one student with only self-study, a
  cancelled class task, a due-week completion, a later-in-month completion, and a
future-due completion. Do not use real parent/student credentials.

Check:

- creating/transferring members preserves exactly one active membership per
  student and preserves the ended historical row;
- a complete class assignment is server-labelled with the common class task
  ID, while a selected subset remains individual and is absent from ranking;
- weekly and monthly previews use Shanghai dates at Sunday/month-end edges;
  the preview can be opened by a teacher but not a student;
- saving a comment and goals, regenerating the preview, and publishing preserve
  the teacher text while recomputing weekend learning facts;
- final reporting counts due-period class tasks passed by its own cutoff exactly
  once, excludes cancelled/individual/after-cutoff/future-due work, and assigns
  equal ranks for equal completion counts; a later-in-month pass remains missed
  in the immutable weekly report but counts in the monthly report;
- the partial-period transfer is not ranked, has an explicit reason in its own
  view, and does not leak a private detail row to classmates;
- self-study displays separately and does not change formal rank; score/trend
  sections distinguish BBC, Vocabulary, IELTS Reading, and IELTS Listening
  rather than calculating one mixed average;
- deltas show `+N 项`, `-N 项`, or a neutral zero/new-record state without a
  percentage, including a zero prior period;
- a shared `reports.html?report=` link sends a signed-out user to login and
  returns after login; a student sees only leaderboard plus their own detail;
  a different class's student and an inactive profile are denied;
- the Student Dashboard has no standalone Learning Reports icon;
- after choosing `Continue as Visitor`, directly opening `reports.html` stays
  on an empty list and reading surface, makes no `learningReports` request,
  preserves Visitor mode, and does not bounce between the report page and
  login;
- opening `Close report` removes the `report` query parameter without signing
  out, returns to the report chooser, focuses the report list, and allows a
  different weekly/monthly report to open on both desktop and phone widths;
- inspect the network response and page source after student login: no other
  student comment, goal, attempt, membership history, or `student_details`
  record is delivered and then hidden by JavaScript;
- an active teacher sees full report/preview controls; student controls cannot
  call `generatePreview`, `saveComment`, or `publishReport` successfully;
- repeated manual preview/publish actions and a simulated duplicate timer run
  leave one report, one rank projection, one final status, and no lost comments;
- `Print / PDF` prints only the current authorized projection and has no editor,
  sidebar, another student's private detail, answers, or Argue content;
- `Copy report link` and `Copy WeChat text` create a valid same-origin URL and
  text, but V1 does not send a message or operate a personal-WeChat robot.

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
  `npm run test:cloudbase-auth` for credential-preflight retry boundaries, and
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
- every Learn word card shows a circular speaker beside the visible word; a
  click speaks that word in browser `en-GB` speech without navigating or
  changing the selected Study Set
- every generated Spell row omits the source word number and shows the same
  speaker beside its part of speech; it speaks the hidden target without
  filling/revealing letters, and its accessible label does not expose the answer
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
  replaces it with a centered correct/total score pill plus inline `Retry` after
  checking
- Vocabulary inline practice has no `Clear All`, no `Hide Answer`, and no
  floating `Retry` button
- each blank's choice panel opens as a floating overlay that does not push
  questions down, has no `Clear` button, and ends with a blank underline chip
- checking Vocabulary inline practice turns correct cards green, wrong cards
  light red without pulsing, and writes correct or wrong-to-correct
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
- Vocabulary `Practice` download `Customize` opens a dedicated
  `Customize your download` view: `Confirm` / `Customize` and `Cancel` are not
  visible, the top-left arrow returns to the landing choices, and the external
  `Close` action below the card dismisses the full dialog; removing any group
  unchecks `All`, and selecting every group rechecks `All`
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
- `Start Quiz` shows the timed-quiz warning before questions appear
- Cloze/Test timing gives each selected group 90 seconds
- running Test mode disables other Vocabulary mode tabs and warns on
  browser-level leave/back attempts
- Cloze setup keeps the top-level `Cloze` tab, then shows a Practice row above
  a Quiz row. Practice uses selectable numbered group chips and a `Practice`
  action; Quiz uses the selected-set-count dropdown and a `Start Quiz` action.
- Practice opens with no group selected and its action disabled; Quiz offers
  only 5-or-more set counts, with no 1-4 self-study options and no `Counts
  toward results` suffix in its dropdown labels.
- On mobile widths, both Cloze setup rows, the Practice chip scroller, the Test
  selector, and both actions remain inside the outer panel; every numbered
  Practice capsule is fully visible rather than vertically clipped.
- counted-flow confirmation, in-progress, interruption, submit, and redo copy
  consistently says `Quiz`, while stored test/session identifiers are unchanged
- Cloze Practice starts a timer using 90 seconds per selected group, shuffles
  question order inside each selected group, writes a
  `vocabulary_practice_timed` activity attempt with `assignment_id: null`, and
  appears in the teacher notification bell.
- Cloze Practice at 1-4, 5, or more selected groups does not update assignment
  status, student progress, FINISHED, self-study STAR records, learning reports,
  or Teacher View matrix scores.
- Quiz and timed Practice run an authenticated preflight before their mutating
  submission call. Simulate the historical SDK `t.scope` credential failure:
  only the read-only login check retries once, the submit function is not
  called, the Practice timer has not started, and the page shows a friendly
  message saying no answers were submitted.
- Re-send one completed Quiz payload and one timed Practice payload with the
  same `client_submission_id`: each replay returns the original `attempt_id`
  with `idempotent_replay: true`, while the attempts collection, attempt number,
  assignment/STAR projections, and email outbox each remain unchanged.
- Reusing a `client_submission_id` under a different authenticated student,
  set, or Vocabulary mode produces a different attempt ID and never exposes
  another student's attempt.
- running Test mode shows a sticky top bar with numbered test-set capsules and
  the timer centered in the same row; clicking a number jumps to that set
- Test set numbers remain gold, while Practice set numbers and set badges are
  green during the timed question flow
- Test set headings show numbers only, without `Test Set` text
- manual Test submit asks for early-submit confirmation, while time-up submits
  automatically
- the visible Test submit button says `Submit`
- the result modal has only one `Close` action
- after Test submission, answer feedback appears inside each question blank
  using the same treatment as Vocabulary Learn
- the Test result summary and `Retry` button appear below the test questions,
  not above them
- student Vocabulary views do not show a bottom-right floating `Retry` capsule
- student Vocabulary views do not show a bottom-right `Show Answers` capsule
- Timed Cloze Practice at any selected-group count creates only a
  notification-only CloudBase activity attempt
- Quiz creates a countable attempt and retains its selected-group details
- 5+ selected Test groups create a `vocabulary_test_sessions` record before
  questions appear and submit with its `test_session_id`
- a Library/self-study Quiz remains self-study if an assignment for the same set
  is created before submission
- a Quiz opened without an assignment URL remains attached to the exact
  assignment selected at start even if another open assignment becomes newer;
  equal due dates use a stable assignment-ID tie-breaker
- restoring a Quiz draft uses the server session's locked assignment, not the
  current page URL or a fresh open-assignment lookup
- cancelling the locked assignment during a Quiz returns
  `VOCABULARY_TEST_ASSIGNMENT_CANCELLED`, closes the session, and writes no attempt
- countable Vocabulary Test submission grades the session's recorded question
  IDs, not a browser-edited question list
- switching apps/tabs or hiding/leaving the page during a 5+ group Test marks
  the session abandoned and does not create an attempt
- another device or browser tab for the same account is blocked from student
  cloud-backed features while a 5+ group Vocabulary Test is active
- heartbeat runs about every 10 seconds; one transient network failure shows a
  reconnecting status, preserves entered answers, and retries instead of
  ending the test
- a recovered heartbeat inside 60 seconds clears the reconnecting status and
  keeps the same session active; sessions with no successful heartbeat for
  more than 60 seconds become abandoned
- explicit expired/closed/device-blocked/content-outdated heartbeat errors
  still end the test immediately, and hiding/leaving the page still abandons it
- auth-preflight retry and an idempotent response replay do not change the
  original Quiz `started_at`, deadline, heartbeat timeout, submit grace period,
  device/tab ownership, selected questions, or locked assignment
- group metadata is stored
- the Dashboard notebook opens a glass preview with no more than the seven most
  recent active words. Each row shows English, POS, a one-line Chinese meaning,
  and pronunciation; the header uses the true total, and the fixed footer shows
  the remaining count plus `Open My Words`
- the preview shares the Dashboard modal width/material, external `Close`, and
  exact-position page lock. On a short phone only the seven-word body scrolls;
  the header, full-workspace action, and external Close remain available.
  Backdrop and Escape do not dismiss it, and explicit Close restores notebook
  focus
- `Open My Words` enters `my-words.html`; legacy `dashboard.html#my-words`
  redirects there, and Dashboard never mounts search, add, edit, delete, Notes,
  sorting, export, or a second complete personal-vocabulary runtime
- throttle the first My Words data request and confirm the `My Words / Review`
  row plus the full Search/layout/Export/sort toolbar are visible immediately
  and remain at the same coordinates; stable card/detail skeletons occupy only
  the future content positions and are replaced in place by the first 18 real
  words. There is no full-height loading sheet or whole-list reveal
- with more than 18 saved words, confirm scrolling near the index bottom appends
  30-row pages without resetting selection or moving the detail pane. Search,
  A–Z/Z–A, Review totals, and Export must finish all remaining pages before
  presenting a complete result
- enter and return between Dashboard and My Words in a browser with same-origin
  document transitions and in the fallback path. The notebook/header surface
  follows the same top-right route both ways; reduced motion uses no spatial
  travel, and rapid Back still navigates even if the previous transition skips
- desktop My Words keeps the header and Study/Word List Sidebar visible;
  Word List uses an approximately 300px index plus a flexible detail pane and
  automatically selects the first recent word
- mobile replaces the Sidebar with sticky tabs, initially shows an English-only
  two-column grid, remembers the single/two/three-column choice in the browser,
  closes the density picker when the word list moves, and does not auto-open a
  word on first entry. The `中` toolbar toggle reveals POS plus Chinese beneath
  every card together and remembers whether that extra line is visible
- truly overflowing mobile words animate only inside their own tile with the
  existing bounded 7–14 second task-title rhythm; ordinary words remain still
  and reduced-motion mode uses ellipsis
- selecting a word at phone width opens one bounded detail modal with an
  external pencil above it and no three-dot menu, then speaks the word once after
  approximately one second. The modal locks
  the background, closes without animation, restores the list/search/sort/
  density/scroll context, and leaves the originating tile selected. At iPad and
  desktop split widths, selection does not auto-play or open a modal; it updates
  the right detail pane and keeps the selected word highlighted in the left list
- Study contains only an honest static placeholder, real saved/Shanghai-week
  counts, and recent words; it exposes no learning-state or progress model
- Add Word expands one line below the header. Word List owns Search,
  Recent/A–Z/Z–A, mobile density, and an Export panel that anchors below the
  visible download button at every list scroll depth
- My Words can save selected text from answer, explanation, feedback, and
  result regions, including disabled answer-feedback buttons
- in a BBC fill-blank question, multiple-choice question, option, and matching
  instruction, selecting the first word excludes the adjacent question/option
  label both from the visible selection and the saved My Words text; genuine
  numeric content such as `5G technology` is preserved
- the anchored `Add to My Words` capsule fades, lifts, and scales into place
  without a bounce, reverses cleanly when dismissed, and becomes a short
  opacity-only transition with reduced motion enabled
- long-pressing selectable lesson text on iPhone and iPad keeps the native
  selection highlight and handles visible while `Add to My Words` is offered
- tapping `Add to My Words` on a touch device saves the captured text once,
  without a duplicate touch/click submission
- My Words accepts single-letter words such as `a` and `I`
- a curated/shared-lexicon word displays dictionary details immediately after
  save/list, while an unknown word saves first and then enriches automatically
- a dictionary timeout leaves the word visible as pending, a confirmed miss is
  throttled and offers Retry, and a cached unknown word does not call the
  external provider again for another student
- My Words search matches Chinese meaning, English definition, and part of speech
- Word List search visibly filters English and dictionary fields without losing
  the current sort or mobile density preference
- pronunciation uses browser speech without exposing a provider key; opening a
  mobile word detail speaks once automatically after approximately one second
  and the speaker remains available
- a failed multi-word lexicon query falls back to individual reads, so known
  entries such as `expense`, `details`, and `widespread` still show dictionary data
- desktop selection and mobile detail show phonetic plus adjacent speaker,
  Chinese/English definitions, source/context, retry, Note, and confirmed
  removal; external dictionary provider branding is not shown
- `my-words-modal-preview.html` loads as a standalone sample-only design
  reference, has no CloudBase/network data calls, and is not linked from the
  production Dashboard or Library navigation
- the student My Words interface contains no Today/New/Learning/Mastered
  filters, due review, Reveal, Forgot, A little, or Know controls
- the mobile pencil warns about spelling/dictionary loss, then edits the English
  word/phrase, every displayed Source context, and Note in one save; a spelling change
  re-runs dictionary lookup, provenance/dictionary fields stay read-only,
  Source accepts at most 320 characters, and Note at most 500 characters
- Use base, Edit word, Add/Edit Note, Cancel, and Done keep the same selected
  word visible across rerenders; if editing changes the record ID, selection
  follows the new record
- regular high-confidence forms such as `worked` can show `Base: work`, while
  ambiguous or irregular candidates are not guessed automatically
- selecting a base-form recommendation when both cards exist opens a Merge
  Group selector; only checked cards merge, examples preserve original forms,
  Notes receive original-form labels, and Undo restores all cards within 10 seconds
- export starts with all active words selected; Shanghai This Week/Month/Year
  replace the selection using `activity_updated_at`, and manual checkboxes can
  adjust it afterward
- `.xlsx` output is a valid OpenXML ZIP and preserves English/Chinese/Note text;
  PDF opens a printable table containing only the selected rows and fields
- a confirmed dictionary miss can request AI at most ten times per Shanghai
  day; the prompt contains only the word and one context, never student identity
  or Note, and no shared draft is written before preview confirmation
- the first confirmed AI result becomes the one shared unreviewed record;
  another student reuses it, and teacher publication replaces it while creating
  private history and resolving open reports
- the teacher Dictionary workspace separates Missing, AI Drafts, Reported, and
  Reviewed; Student Vocabulary is a separate read-only view with student identity
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

- `npm run build:static` succeeds and `dist/` contains `index.html` but no
  `cloudfunctions/`, `scripts/`, `docs/`, or `AGENTS.md`
- the latest `Deploy static site to Tencent COS` GitHub Actions run is green;
  its summary accounts for all built files as uploaded or unchanged
- the COS static-website homepage and at least one changed page/resource return
  HTTP 200 before DNS is switched
- static files are pushed/published
- changed cloud functions have rebuilt ZIPs
- `npm run test:teacheradmin-package` passes for any `teacherAdmin` release and
  the recorded archive stays below the uncompressed-size guardrail
- CloudBase development functions are uploaded
- required collections exist and are `ADMINONLY`
- `teacher_attempt_email_events` exists and remains `ADMINONLY`; its event ID
  uniqueness and due/thread query indexes exist before the email timer is enabled
- a newly sent attempt-email event records the SMTP accepted/rejected counts,
  final response code, and provider queue response without storing credentials
- Learning Reports V1: `classes`, `class_memberships`, and `learning_reports`
  exist and remain `ADMINONLY`; required uniqueness/query indexes exist before
  the report functions or timer are enabled
- Learning Reports V1: the report functions and matching static
  `reports.html`/`reports.js` release are deployed from the same reviewed
  source, the timer internal token is configured only in CloudBase, and a
  development-only dry run proves idempotent preview/final behavior
- `vocabulary_lexicon_history` and `vocabulary_dictionary_reports` exist and
  remain `ADMINONLY` before deploying the new dictionary actions
- cache query strings are bumped for changed shared JS
- at least one development account flow is tested

## 10. Known Testing Gaps

Parent Mode regression checks:

- a student with two period-overlapping membership-history rows appears in
  exactly one class-matrix column;
- task cards, matrix task rows, task detail summaries, and chart threshold
  lines use `合格线：80%`-style Chinese labels and never `PASS 80%`.

- No automated CloudBase integration tests.
- No pure unit tests for assignment status, STAR, and Argue rules yet.
- No automated browser smoke for teacher/student login yet.
- No automated grading-key reconcile check yet.
- No scheduled-report integration harness or production timer monitoring yet;
  until added, use the Learning Reports V1 checklist against development data.

High priority improvement:

- Add a lightweight pure JS rule test suite for backend status/STAR/Argue logic.

## 11. Content Edition Checks

- `npm run test:content-editions` passes.
- Unversioned content opens the existing confirmation with no version buttons.
- A synthetic V1/V2 family renders one Library card and two unselected buttons,
  ordered latest first, with independent scores.
- Selecting a version updates title, score/status ribbon, and Enter URL.
- Assignment/History/STAR links with a concrete `set_id` bypass the selector.
- Teacher Assign displays V1 and V2 as separate selectable rows.
- Catalog build rejects duplicate edition numbers or multiple latest editions.
- Optional BBC `contentVersion` must match the private grading version; stale
  submissions are rejected instead of graded with mismatched keys.

## AI Tutor Writing

- Run `npm run test:writing-tutor` and all release verification.
- At phone, iPad, and desktop widths, confirm the page shows only one top toolbar
  over card content: `History` at far left, current title centered, and revision
  percentage at far right. Confirm Home and New appear inside History and that
  there is no student chip, brand mark,
  `AI Tutor / Writing Studio` label, secondary toolbar, or persistent sidebar.
- Confirm Portfolio starts closed at every width. Open it, then separately close
  it by re-clicking the trigger, its close button, the scrim, and `Escape`.
  Confirm `aria-expanded`, focus restoration, background scroll lock, and prior
  page scroll position are correct for every path.
- Click Home inside History and confirm the custom dialog appears before navigation.
  Cancel by button and `Escape`, then confirm leaving during queued OCR and queued
  review returns to Dashboard without cancelling either cloud job; reopening the
  Composition resumes the same job.
- Confirm History Home is red and the alert matches the Dashboard/BBC compact
  glass style: `Cancel` is the green left split action, `Leave` is the red right
  split action, and Cancel receives initial keyboard focus.
- Verify direct text and 2–8 page photo flows; OCR must preserve errors and
  uncertain text, while confirmed photos become unavailable after cleanup.
- On OCR Review, confirm the only fixed fields are `OCR Review`,
  `Compare with Image`, and one horizontally centered `Confirm`, with
  the editable manuscript directly below the heading and no `Upload Again` action. The image toggle must
  open/close split view on desktop/iPad and an image-above-text view on phone.
- Return an exact uncertain substring from OCR and confirm it is marked with a
  pale-red fill and dark-red text, without an underline. Clicking it must remove
  the mark without moving the caret; editing it must also remove the mark, and
  confirmed text must contain neither HTML nor styling. Press Enter once between
  two paragraphs and confirm a visible paragraph gap, then reload the confirmed
  manuscript and verify the same two paragraphs remain.
- Verify both modes are mutually exclusive; standardized review requires prompt
  and framework, while language review works without a prompt and shows no score.
- Submit an obvious IELTS response under HKDSE and confirm the selected framework
  is retained without warning or reclassification.
- Confirm strict schema rejection and sentence ID/original alignment rejection.
- Confirm OCR accepts a valid object wrapped once as a JSON string or one-item
  array, and merges a valid multi-page array in page order, while malformed or
  schema-invalid content is still rejected.
- Disconnect or close the browser immediately after upload confirmation. Confirm
  `finishPhotoUpload` has created exactly one stable `writing_ai_jobs` row, OCR
  continues without the browser, and refresh/re-login/reopen resumes that job.
  Confirm a retry reuses its operation/job ID and does not call the model twice.
- Disconnect immediately after `开始批改` in both modes. Confirm `evaluate` returns a queued review job, the
  one-minute worker finishes it without the browser, reopening resumes queued/processing state, and the original
  standardized review remains present when the same Composition proceeds to language review.
- Click Sentence Revision `Check`, then disconnect or close the browser before
  the model returns. Confirm `submitRewrites` has staged exactly one
  `pending_rewrite_check`, created exactly one metadata-only rewrite job, and
  returned queued state without waiting for Qwen. Refresh, re-login, and reopen
  the Composition independently; each must resume the same queued/processing
  check and render its eventual result.
- Type distinct partial rewrites in several sentences without pressing `Check`,
  refresh, close/reopen, and briefly disconnect. Confirm each value restores only
  for the same authenticated student, Composition revision, and sentence ID; a
  second account on the same device must not hydrate it.
- After pressing `Check`, inspect both layers: the local draft must remain while
  the exact batch exists in `pending_rewrite_check`. Force request-delivery
  uncertainty, retryable provider failure, terminal failure, refresh, and browser
  closure; both layers must remain recoverable. Only successful result publication
  may clear them. If a result requires another revision, confirm the submitted
  text is restored from persisted rewrite results.
- Repeat the same rewrite operation ID while its job is queued and processing,
  and again after success. Confirm all deliveries resolve to one job and one
  provider call. Confirm the job row and logs contain no original sentence,
  student rewrite, coaching text, reference revision, or model feedback.
- On the first rewrite submission where stored `rewrite_results` is `null`,
  confirm the completion transaction uses whole-field `db.command.set`, produces
  a readable result object without `PathNotViable`, clears
  `pending_rewrite_check`, and changes status only for the current active job and
  lease. Force a stale/superseded worker and confirm it cannot publish.
- Force one transient provider failure and confirm queued retry, bounded attempt
  count, lease expiry recovery, and final success/failure for OCR, review, and
  rewrite-check jobs. Start a replacement
  job while the first is processing and confirm only `active_job_id` can publish.
- Confirm unconfirmed photos remain privately previewable during OCR but are
  deleted no later than seven days; confirming text deletes them immediately.
- With only the shared Qwen model configured as `qwen3.7-plus`, confirm OCR uses
  `qwen3.7-flash` and text evaluation continues to use `qwen3.7-plus`.
- Confirm duplicate/missing criterion and sentence IDs are rejected. Confirm
  IELTS overall band is calculated from its four criterion scores, DSE total is
  the sum of its three domain marks, and A Level totals use their single AO mark
  rather than trusting the model's `overall_score` string.
- Confirm an operation ID replays only for the same Composition revision, mode,
  and Rubric; cross-scope reuse must fail without another charge or result.
- Confirm reference revision and rewrite input never display together, skipped
  capsules remain marked, and feedback is batch-only.
- After language review completes, confirm the page has exactly three primary
  cards in this order: `Language Review`, `Draft`, and `Sentence Revision`.
  Confirm there is no fourth layout container presented as a card.
- Confirm `Language Review` begins with `CEFR Writing Estimate` before its
  overview. Test A1 and C2 boundaries plus lower/middle/upper positions; verify
  they render as A1-/A1/A1+ and C2-/C2/C2+, the rationale is Simplified Chinese,
  and no 偏下/中段/偏上 position label appears.
  Confirm the copy scopes the estimate to this manuscript rather than claiming
  a certified or overall student level. Open a historical review without
  `cefr_estimate` and confirm it remains readable without a fabricated value.
- In Sentence Revision, confirm the number capsules scroll horizontally on
  touch and pointer devices; selecting a number scrolls to and highlights the
  matching sentence. Confirm the full sentence list is always present and there
  is no progress copy, instructional hint, sequential mode, layout toggle, or
  pair of layout icons beneath or beside the capsule row.
- Compare normal, active, completed, and review capsules and confirm every computed
  border is the same 1px solid width. Completed capsules show a tiny green check below the
  number; incomplete/review capsules show a tiny red cross, and the status
  slot is not clipped by the horizontal scroller. Completed aria-labels include “已完成”.
- Scroll until the capsule bar reaches the top and confirm it replaces the main
  toolbar at `top: 0` on phone, iPad, and desktop. Confirm it releases naturally
  after leaving the Sentence Revision card.
- Confirm each manuscript sentence uses the same color as its number capsule and
  correction-source highlight. Click both the manuscript mark and capsule and
  confirm they activate the same index and scroll to the same correction row.
- Use one manuscript containing multiple sentences in one paragraph and at least
  two paragraphs separated by a blank line. Confirm `Draft` keeps same-paragraph
  sentences together, preserves the blank-line paragraph boundary, and applies a
  different indexed color to each sentence. Repeat with a long sentence at 320px;
  it must wrap naturally rather than becoming an atomic sentence-width block.
- Focus a highlighted Draft sentence with the keyboard and confirm Enter and Space
  activate its capsule and revision row just like a pointer click.
- Confirm sentence highlighting has no underline or bottom border, uses no site
  primary green, and repeats blue, orange, purple, rose, indigo, coral, gold, and
  deep pink only after eight sentences, in the same positional order across
  manuscript marks, capsules, and revision rows.
- At 320px, 375px, and 430px widths, test long unbroken English/model text,
  multi-photo preview, reference answers, and correction cards. The page must
  remain viewport-width; only the capsule row may scroll horizontally.
- Confirm every revision-required sentence uses one two-sided card. The front
  contains the original English sentence and one single-paragraph Chinese analysis;
  the back contains the same original sentence and student revision input. Confirm the two faces are
  never visible or exposed to accessibility APIs together, and that `Grammar Analysis`,
  `Word Choice`, other category labels, and separate issue/summary/result rows are absent;
  opening the reference answer on the analysis face must not expose or erase the
  back input, and flipping to the input must hide both analysis and reference. For
  an effective sentence, confirm only the top metadata row (`CORRECT ✓`) and original
  sentence render—without a grammar box, `Your Attempt`, a textarea, an inline sentence
  icon, or a reference-answer action. Its capsule remains complete with a green check.
- Switch a revision card front/back with click, Enter, and Space. Confirm state,
  focus order, accessible names, textarea draft, capsule, and sentence identity
  remain synchronized. Enable reduced motion and confirm there is no 3D rotation;
  an immediate swap or short crossfade still exposes exactly one face.
- At 320px, 375px, and 430px widths, flip into a rewrite input and confirm the
  card settles below the number navigator with the original sentence and input
  visible above the keyboard, approximately 24px lower than the prior phone
  position. Repeat at iPad width and confirm its existing position is unchanged.
- Confirm every Sentence Revision source row begins with exactly one matching one-based
  number, including effective rows. In editable mode, the footer contains only one
  `Submit` button aligned right on desktop and full-width on phone; the old unfinished
  hint, long submit labels, and arrow icon are absent. Empty submission still returns
  the student to the first unfinished sentence. Confirm the row number follows the
  BBC classroom worksheet treatment—small, heavy, baseline-aligned, with no border,
  circular background, or capsule shape. This must remain visually distinct from
  the top navigation capsules.
- Confirm every editable rewrite face labels its field `Your Attempt` in the muted
  supporting-text color, while the textarea content remains visually primary. After
  a successful Review Scan import, confirm every revision-required card opens on that
  attempt face with the original sentence and imported correction visible together.
- Confirm the Sentence Revision heading has no explanatory line beneath it. The bottom
  action row must show a 44px camera-only button immediately left of `Submit`; its
  accessible name remains `Scan Revisions`, and phone width must keep both controls on
  one row rather than stretching the camera into a full-width text button.
- Before Check and after a rejected Check, confirm the unresolved capsule shows a
  small red cross rather than a dot or question mark. After acceptance, confirm the capsule
  shows a green check and the card's top-right state reads `REVISED ✓`. The accepted card must open
  on the persisted corrected sentence as display text, with no disabled textarea;
  only an explicit flip may reveal the original sentence and grammar analysis.
- Submit the same incorrect sentence at least three times. Confirm the analysis
  face keeps the original coaching first, then shows `第 1 次点评`, `第 2 次点评`,
  and `第 3 次点评` in chronological order with a thin divider before each round.
  Refresh and sign in again to confirm every round remains. Replay the same
  operation ID and confirm it does not create a duplicate round. For a legacy
  latest-only record, confirm the existing feedback becomes round 1 and the next
  successful submission becomes round 2.
- Confirm an effective/no-change sentence has the same bordered face as every other
  Sentence Revision card, while still exposing no grammar analysis, textarea, Sample,
  or flip target. Confirm the bare number is top-left and `CORRECT ✓` is top-right.
  Use long wrapped sentences and verify the sentence takes the full card width and line
  two aligns under the first sentence letter at desktop and phone widths.
- Compare a long analysis face with a short accepted rewrite face. After every flip,
  confirm the card smoothly follows the visible content height and leaves no blank block
  for the hidden face. Repeat after resizing phone-to-tablet and with Reduced Motion on.
- Confirm “我记住了，开始改写”“返回查看分析”“查看参考句” are absent. Click the
  analysis text, blank card space, and corrected sentence to flip the same physical
  card. Then click and type in the textarea and click its label; none may flip the
  card accidentally. Keyboard-focus the full-face native button and use Enter/Space.
- Confirm the only reference control is exactly `Sample`, positioned at the
  analysis paragraph's trailing edge with the revealed reference directly below.
  Toggling Sample must not flip the card, erase a draft, or change its accessible
  face state.
- Confirm idle `History` and `New` use identical white-background, green-text
  secondary styling inside their respective surfaces. Opening History may invert
  only the toolbar trigger; New remains inside the drawer.
- With six required sentences, accept three and confirm the far-right toolbar value
  reads `50%`; originally correct sentences must not change the denominator. Confirm
  the accessible name reports completed, total, and remaining counts, a review with
  no required sentences reads `100%`, and the value is hidden before sentence review.
  After a rejected Check, confirm no “统一检查完成” instruction appears below the toolbar.
- Open a saved Composition at each workflow state, refresh the browser, and confirm
  the same Composition and server-backed step return instead of the AI Tutor home.
  Confirm returning home clears the locator, while an already-pruned empty locator
  falls back cleanly without an error loop.
- Confirm the current AI/student title appears between Home and History/New. Test a
  long title at phone, iPad, and desktop widths: it must stay inside the toolbar and
  travel horizontally with end pauses. With Reduced Motion enabled it must remain
  still and truncate with an ellipsis.
- Before clicking any capsule, confirm every Sentence Revision row already shows its
  indexed pale background. Navigate among rows and confirm the background remains
  stable and no dark vertical line appears on the left edge.
- Click `New` and enter nothing. Confirm the placeholder never appears in History or
  its total, then leave and verify it is discarded. Repeat by clicking `New` twice.
  Add a title, prompt, manuscript, selected/uploaded photo, queued job, or result and
  confirm the non-empty Composition is never removed and no Delete control appears.
- Review an unnamed new Composition in both assessment modes. Confirm the same
  successful model response supplies one two-to-six-English-word title, creates
  no second provider call/job/quota event, and replaces the empty/legacy display
  title atomically with the review.
- Rename a portfolio item inline, verify cancel and validation behavior, and
  confirm later review/re-upload never overwrites a student-authored title.
  Confirm a historical literal `Untitled writing` remains manually editable and
  a future review may fill it only when it has never been manually named.
- Retry one operation ID and confirm one quota event/charge. Force AI failure and
  confirm quota release. Test boundary at exactly the daily limit and limit zero.
- Confirm replacement failure preserves the current Composition; successful
  confirmation clears prior current reviews without deleting the usage ledger.
- Confirm teacher settings load lazily, accept 0–100000, and email contains no
  student prompt, manuscript, feedback, or image.
- Confirm Cambridge 9093 Paper 2 exposes three separate Rubrics and enforces
  whole-mark ranges of 0–15, 0–10, and 0–25 for Shorter Writing, Reflective
  Commentary, and Extended Writing respectively.
- In editable Sentence Revision, open `Scan Revisions` on phone and iPad and
  verify both accessible camera capture and photo-library selection. Check marker
  variants `8`, `8.`, `8、`, `8)`, and `(8)`, with omitted punctuation and with
  recommended whitespace before the answer.
- Repeat both ordinary photo upload/re-upload and `Scan Revisions` on a saved
  Composition whose `pending_upload` field is explicitly `null`. Confirm the
  start call replaces the entire upload object, returns upload metadata, and
  reaches durable OCR enqueue without `Cannot create field ... in element
  {pending_upload: null}`. The contract test must verify `db.command.set(...)`
  coverage for both upload entry points and the revision-job handoff.
- Verify duplicate, missing, out-of-range, and empty markers never auto-map to a
  sentence. Exercise low-confidence markers, line-wrapped handwriting, and a
  page with both mapped and unresolved answers; confirm the tiny high `✓`, medium
  `!`, and low `?` confidence symbols have accessible names. Manually assign
  an unresolved answer and verify the sentence identity is shown before import.
- On every Review Scan card, confirm the upper box has the same pale-red fill and
  red-border feel as a wrong Vocabulary question, and shows the global number plus
  original sentence. Clicking anywhere in it must open the native sentence selector;
  the lower inset OCR sentence must remain directly editable. Verify originally
  correct and already accepted sentences never appear, another card's selected
  target is disabled, changing that card releases the old target, and the server
  rejects any crafted import that targets completed work or duplicates a sentence.
- Confirm scan results are reviewed before import and that import only fills the
  selected revision drafts. It must not call `Check`, mark any sentence accepted,
  or create a rewrite result. Verify the page contains no heading, instruction,
  missing-sentence summary, mapping badge, handwritten-number label, or typed/scanned
  choice controls. With an existing draft, confirm Import replaces it with the
  reviewed scan text, while returning without import preserves it unchanged.
- Disconnect after upload, during `Queued`/`Processing`, and before import. Refresh,
  re-login, and reopen the same Composition; verify the same operation/revision
  resumes, duplicate delivery is idempotent, and stale-revision results cannot
  publish. Force provider/schema/canonicalization failures and verify a recoverable
  failure state, safe retry, no silent draft mutation, and no orphan private photos.
- Verify imported scanned drafts survive reload and can be edited through the
  existing Sentence Revision flow. Confirm private scan photos are deleted after
  the durable pending scan result is stored and by expiry cleanup, and that camera/select controls, status
  text, focus order, keyboard use, and the mobile keyboard remain accessible.
