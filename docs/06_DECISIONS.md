# 06 Decisions

> Architecture Decision Records for important product and technical choices.
> Add a record when introducing a new dependency, platform, architecture pattern, data model rule, or major product constraint.

## 2026-08-17: Keep one credential entry with validated same-origin returns

Decision:

Use `index.html` as the only credential entry. Inner login actions build their
destination with `MrCatLoginNavigation.loginHref(currentUrl, fallback)`, which
accepts only a validated same-origin `.html` return target and removes legacy
`user` / `visitor` parameters. Dashboard, My Words, and Attempt Review pass
their current full URL so query strings and hashes survive a signed-out
redirect.

Reason:

One credential surface avoids divergent login behavior and makes it possible to
preserve the user's actual work context. Same-origin validation prevents a
return parameter from becoming an open redirect, while ignoring browser-supplied
identity keeps authorization in CloudBase authenticated context.

Trade-offs:

- Good: public Library login can return to the authenticated Dashboard Library,
  and exercise-specific login can return to the exact exercise.
- Good: no backend schema, function, or data migration is needed.
- Cost: every page with an inner login action must load the shared helper before
  its page-specific JavaScript and keep its cache-busting version aligned.

Review condition:

Revisit only if the site adds a new credential provider or a route that cannot
be represented by a same-origin `.html` URL; do not restore `user` / `visitor`
URL identity semantics as a shortcut.


## 2026-08-17: Separate Intensive Listening Authoring Packages from Live Policy

Decision:

Keep self-contained transcript JSON and readable Markdown in the owner's private
iCloud folder as portable authoring and backup artifacts. After import,
`intensive_listening_materials` is the live runtime source. Segment behavior is
explicitly Dictation, Listen Only, or Skip. Teacher-approved Spelling Exemptions
update a slot-level policy and `policy_revision` without changing the material's
segmentation version. Teacher export reconstructs a current source JSON.

Reason:

A browser cannot safely rewrite a local iCloud file, while teacher and student
Argue must affect active practice without publishing complete answers or waiting
for a static deployment. Keeping the live rule in the ADMINONLY material also
lets current students receive a small revision-triggered refresh.

Trade-offs:

- The local JSON is a portable master package, not the live database after
  publication; export it after online policy changes when an offline snapshot is
  wanted.
- Segmentation changes still require a new `contentVersion`; a spelling
  exemption is a compatible, relaxing policy revision.
- No new collection is introduced: requests reuse `answer_disputes`, accepted
  audit uses `grading_key_history`, and the material holds the active rule.

## 2026-08-16: Keep Intensive Listening Answers Behind Server Checks

The static browser receives the complete safe unit/timing/slot structure once,
but never receives reviewed words before the three-check reveal boundary.
`intensiveListening` grades each unit and stores redacted progress in three
`ADMINONLY` collections. Timestamped transcript records remain final units; the
website does not re-segment them or create per-unit audio files.

## 2026-08-15: Retry Authentication Reads and Atomically Deduplicate Vocabulary Writes

Decision:

Use CloudBase browser SDK 2.32.0. Before Vocabulary Quiz/timed Practice writes,
retry only the read-only login-state preflight once when credential bootstrap
hits the known null-scope failure. Never automatically retry the mutating cloud
function call. Give each recorded Vocabulary submit action a stable client ID,
derive a student/set/mode-scoped 32-character attempt document ID, and create it
atomically with `doc(id).create` so a replay returns the immutable attempt.

Reason:

SDK 2.28.6 can dereference `credentials.scope` while credentials are null, and
a request response may be lost after the server has stored the attempt. Retrying
only the authentication read avoids duplicate writes; atomic attempt creation
handles explicit, sequential, and concurrent replays without a new collection.

Trade-offs:

- Existing cached clients without a client submission ID retain the legacy
  random attempt-ID path until refreshed.
- The deterministic ID is a hash scoped by authenticated UID and does not trust
  a browser identity, score, or assignment.
- Quiz session timing, heartbeat, visibility interruption, selected-question
  snapshot, and assignment lock stay independent and unchanged.

## 2026-08-11: Use a Private Outbox and SMTP for Teacher Attempt Email

Decision:

Recorded BBC and Vocabulary attempts create idempotent private outbox events
after attempt storage. A separate token-authenticated timer function claims and
sends them through ordinary-email SMTP. BBC uses a fixed seven-minute window
anchored to the first submission. Every Vocabulary Quiz and timed Practice
event is immediately due and renders cumulative history through that event.
Email reuses the Teacher bell's thread key and mistake-only private projection,
but never changes bell read state. The thread key remains a data-grouping key:
only BBC batches continue an SMTP conversation with `In-Reply-To` and
`References`. Every Vocabulary Quiz and timed Practice event sends as an
independent mailbox message with its mode and attempt number in the subject,
while retaining cumulative thread history in the body.

Nodemailer 9.0.5 is the only new runtime dependency. It is bundled into the
`sendTeacherAttemptEmails` deployment ZIP. SMTP credentials remain CloudBase
environment variables; recipient addresses are authenticated teacher-profile
settings managed from Personal Center. The dispatcher resolves only enabled
addresses at send time and uses BCC. With no enabled address, a due event is
marked skipped rather than retained for later backfill.

Reason:

The owner needs timely ordinary-email visibility without adopting WeCom.
Calling SMTP directly inside student grading would make an external provider a
submission dependency, while sending every BBC retry separately would hide the
short correction sequence in noise. An outbox separates learning truth from
delivery, supports bounded retries, and gives Vocabulary the requested
attempt-by-attempt cumulative comparison.

Trade-offs:

- Good: student submission remains successful when SMTP is unavailable.
- Good: one event per `attempt_id` plus transactional claims limits duplicates.
- Good: later Vocabulary messages include all earlier attempts in the thread.
- Good: every Vocabulary submission remains individually visible instead of
  being hidden inside an email client's conversation fold.
- Cost: a new `ADMINONLY` collection, indexes, timer, environment settings, and
  delivery monitoring are required.
- Cost: “immediate” means the next one-minute dispatcher tick plus provider
  delivery latency; BBC means seven minutes plus the next tick.
- Cost: private wrong-answer comparisons leave CloudBase and enter the owner's
  enabled teacher mailbox, so mailbox security and retention become part of the
  privacy boundary.

Review condition:

Revisit if the owner adopts an official push channel, needs multiple teachers
with different student scopes, or requires a managed transactional-email API
instead of mailbox SMTP.

## 2026-08-10: Student Dashboard Uses Redacted Stale-While-Revalidate Startup

Decision:

Keep CloudBase authoritative while allowing a separate owner-scoped,
maximum-24-hour Student IndexedDB summary snapshot. Startup requests ten To Do
and ten Finished assignment summaries plus counts; complete attempts, reply
history, STAR provenance, wallet history, self-study reconstruction, and
protected resource merging wait until after first paint.

Privacy boundary:

Never persist Teacher Reply bodies, per-attempt detail, submitted/correct
answers, explanations, grading keys, credentials, or auth tokens. Explicit
logout deletes the cache.

Reason:

This improves perceived and actual first-use latency without adding a
collection, weakening authorization, or turning browser state into learning
truth.

## 2026-08-08: Separate Set-Wide Exercise Progress From Assignment Participation

Decision:

One student has one authoritative Exercise Progress per `student_uid + set_id`.
It uses the highest eligible countable attempt across assigned and self-study
entry points. Vocabulary Quiz may improve indefinitely; BBC stops accepting
score improvements after its answer-reveal/mastery lock. A tie or lower retry
does not change the Best Score owner or Finished ordering.

Assignments remain immutable/auditable participation contexts for due dates,
teacher statistics, Passing standards, Class Tasks, and Yellow STAR authority.
Creating an assignment applies those standards to existing progress immediately.
A whole-class Assign reuses an existing open individual participation for the
same student/set and promotes it into the common class batch.

Reason:

The student's learning result should not depend on whether the same exercise was
opened from a five-group Quiz, ten-group Quiz, Library, or an old assignment URL.
At the same time, teachers need assignment-specific deadlines, reporting scope,
and exclusive control of Yellow STAR rewards.

Trade-offs:

- Good: teacher and student views agree on one explainable highest score.
- Good: assigning already-completed work produces immediate, honest statistics.
- Good: class aggregation no longer loses a student who first received the work individually.
- Cost: assignment summary fields are projections and must be repaired together.
- Cost: BBC lock state must be consulted anywhere historical progress is rebuilt.

Review condition:

Revisit only if a future exercise family needs intentionally separate progress
per assignment instance rather than per Content Edition.

## 2026-08-05: Move My Words Into a Dedicated Responsive Workspace

Decision:

Student My Words uses one authenticated `my-words.html` runtime instead of a
full Dashboard modal. Desktop follows the Learning Reports workspace pattern
with a persistent Study/Word List Sidebar and a Notebook index/detail split.
Mobile preserves the same information architecture with sticky top tabs, a
remembered English-only one/two-column index, and a bounded modal for one word's
complete detail. Study remains an explicit static placeholder until the owner
defines a learning model; no familiarity state or backend fields are inferred.

Reason:

The personal vocabulary feature has become a durable learning destination with
editing, Notes, merge, dictionary review, AI fallback, and export. Constraining
the entire feature to a compact Dashboard modal limits browsing and future
learning design, while using the desktop split unchanged on a phone wastes most
of the screen.

Trade-offs:

- Good: one production runtime owns personal-vocabulary management.
- Good: desktop density and mobile reachability are optimized independently.
- Good: the existing `studentVocabulary` boundary and data model remain intact.
- Cost: a separate page adds another static CSS/JavaScript entry point.
- Deferred: Study logic, progress, review scheduling, and assessment remain
  intentionally undefined.

Review condition:

Revisit when the owner defines the actual learning loop or when cross-device
view preferences justify a server-owned preference field.

## 2026-08-03: Use Immutable, Role-Redacted Class Learning Reports

Decision:

Learning Reports V1 uses three new `ADMINONLY` collections: `classes`,
`class_memberships`, and `learning_reports`. A student has one active class
membership at a time, while prior memberships remain as history. The backend,
not a browser-selected group, derives whether per-student assignment instances
make one complete class task. Weekly/monthly report periods use
`Asia/Shanghai`, begin as teacher-only previews for comments and goals, then
become immutable published snapshots at the final cutoff.

Formal class ranks compare only the number of due-period unified class tasks
passed no later than their deadline (and never after the report cutoff). Equal
counts share a rank. Self-study, category scores, and integer period deltas
remain separate so no cross-family average or accidental tiebreak changes the
rank.

The published URL is `reports.html?report=<encoded-id>`. It is a shared
authenticated link: an active student sees the common leaderboard and only that
student's personal detail; an active teacher sees the complete teacher view.
The initial ordinary-WeChat workflow is copy link/text then teacher manual send.
PDF output uses the browser print dialog.

Reason:

The report needs to be fair after a transfer, reproducible after a deadline,
and safe when one URL is posted in a parent group. A client-side live
calculation would be both fragile and an authorization leak; a separate parent
identity or an unofficial personal-WeChat robot would add disproportionate
operations and privacy risk.

Trade-offs:

- Good: historical membership and published data can be explained and audited.
- Good: one simple group link works without creating parent accounts or public
  per-student URLs.
- Good: the system does not depend on a fragile personal-WeChat automation.
- Cost: migration, indexes, a timer, and explicit server-side redaction are
  mandatory before enabling the feature.
- Cost: students/parents must log in with the existing student account; teacher
  comments may need a final review when weekend facts change.

Review condition:

Revisit if the owner adopts an official parent-notification channel, requires
multiple-teacher ownership, or needs formal correction/version history exposed
to families at scale.

## 2026-08-02: Keep Protected Reports Out of the Static Repository

Decision:

GitHub Pages stores only a useful visitor preview. A complete protected
report is generated from a reviewed local source into an ignored private
module, bundled only into an ignored CloudBase function ZIP, and returned in
bounded chunks after the backend verifies an active profile and the resource's
own `allowed_roles` policy. A resource may be student-only even when another
resource in the same bundle permits teachers.
The browser verifies the SHA-256 manifest before rendering the full report in a
sandboxed iframe.

Reason:

CSS blur is presentation, not access control: any full text shipped in public
HTML can be recovered from source or by disabling styles. Reusing CloudBase
Authentication provides a real authorization boundary without introducing a
second account system or a new hosting provider.

Trade-offs:

- Good: visitors cannot recover the complete report from GitHub Pages source.
- Good: existing student and teacher accounts work without migration.
- Cost: publishing a revised full report requires regenerating and deploying
  the function ZIP as well as publishing the static preview.
- Cost: the browser makes several authenticated chunk requests before the full
  report appears.

Review condition:

Revisit if protected artifacts become numerous enough to justify private
CloudBase Storage plus short-lived signed downloads instead of function bundles.

## 2026-08-01: Use an Append-Only Yellow STAR Wallet and Teacher-Confirmed Cash Requests

Decision:

Personal Center STAR histories remain projections of `student_set_achievements`.
Yellow STARs are protected, redeemable, and newly unique by student/set; Blue
STARs are stable but non-redeemable and retain a converted history. Cash spending
uses a separate append-only ledger that references exact Yellow
`achievement_id` values. A request reserves credits, needs private photo
evidence, and becomes spent only after the current teacher confirms the in-person
exchange. Cash amount and exchange rate are deliberately outside the system.

Reason:

An earned STAR is both a student-facing achievement and an audit trail for the
task that produced it. Keeping reward transactions separate preserves that
history, supports reversals and policy changes, and prevents a redemption bug
from erasing learning evidence.

Trade-offs:

- Good: Personal Center always explains where every displayed STAR came from.
- Good: future balances and redemptions can be audited independently.
- Cost: the release needs three ADMINONLY collections, transactional/idempotent
  wallet rules, private storage upload slots, and migration/reporting before the
  student UI is enabled.
- Deferred: Gifts, money values, biometrics, and multi-teacher/student reward
  ownership remain outside V1.

## 2026-07-25: Use One Native-Scroll Percentage Wheel for Teacher Thresholds

Decision:

Teacher Assign and assignment editing use one shared vertical `0–100` picker
for Passing and Mastery percentages. It is built from native overflow scrolling
plus CSS scroll snap, with five visible rows, a fixed center selection band,
explicit Cancel/Done, and equivalent keyboard commands.

Reason:

Thresholds are bounded integer choices rather than free-form text. A compact
wheel is easier to target on phones and feels consistent across iPhone, iPad,
trackpad, mouse, and keyboard without adding a UI dependency.

Trade-offs:

- Good: native touch momentum remains responsive and interruptible.
- Good: one picker keeps create/edit behavior and validation consistent.
- Cost: choosing a distant value may take more scrolling than typing.
- Cost: the component must preserve focus, reduced-motion behavior, and
  background scroll locking itself.

Review condition:

Revisit if thresholds require decimals, values outside `0–100`, or a smaller
fixed option set better served by a segmented control.

## 2026-07-15: Use Required Due Weeks as the One Assignment Schedule

Decision:

Every assignment requires a `due_at` week normalized to Shanghai-time Sunday
23:59:59. Student Overdue / This Week / Upcoming behavior, red reminder counts,
and Teacher View Wxx grouping all use that field. `created_at` remains the
creation audit time, while `assigned_at` is only a rolling-deployment/legacy
compatibility mirror and fallback source.

Reason:

Separate optional assigned-week and due-date concepts allowed unfinished work
to remain in the bell while appearing in neither This Week nor Overdue. One
required schedule makes teacher intent and student reminders consistent.

Trade-offs:

- Good: no open assignment can be created without a clear deadline week.
- Good: future work can remain visible without inflating the red reminder.
- Cost: legacy assignments need a reviewed, bounded due-week backfill.
- Cost: the model supports weekly deadlines rather than arbitrary due times.

Review condition:

Revisit only if the product later needs separate release dates and deadlines;
that would require two explicitly named fields and distinct visibility rules.

## 2026-07-15: Layer the Shared Visual System Over the Static Frontend

Decision:

Keep the existing static pages and add the shared visual system as modular
`liquid-glass-shell` and `spatial-workspace` CSS/JavaScript layers. Login and
public Library use presentation-only shell styling; authenticated Student and
Teacher pages may use the spatial layout and one page-level modal root while
preserving existing DOM hooks and backend boundaries.

Reason:

The owner wants a coherent, responsive interface without replacing the current
vanilla JavaScript application or risking CloudBase grading/account behavior.

Trade-offs:

- Good: visual and responsive changes remain statically deployable.
- Good: modal and workspace behavior can be shared without a framework.
- Cost: CSS precedence and page-level stacking require disciplined tests.
- Cost: practice runtimes deliberately remain visually separate.

Review condition:

Revisit only if the static pages become unmaintainable or a framework migration
is separately approved.

## 2026-07-15: Preserve Teacher Context With History State and a Redacted Local Snapshot

Decision:

Keep practice navigation as normal same-origin page navigation, use bfcache plus
`history.state` for exact contextual Back, and use a tab-scoped recovery copy
when a safe fallback URL must reload Teacher. On private teacher devices, keep a
maximum-24-hour IndexedDB snapshot of the Teacher workspace with attempts and
answer material removed, then revalidate automatically against CloudBase.

Reason:

Returning from a Teacher View preview should feel spatially continuous even
when the browser evicts bfcache, while cold Teacher progress loads should not
wait for every unrelated Students, Review, notification, and Library request.
The snapshot improves first paint without making browser storage authoritative.

Trade-offs:

- Good: normal Back can restore the same filters, expanded groups, and nested
  scroll positions without converting the site to a single-page framework.
- Good: a redacted cached matrix appears quickly and live progress replaces it
  automatically without moving the teacher's current view.
- Good: no new library, framework, backend field, or CloudBase deployment.
- Cost: IndexedDB lifecycle, cache schema versioning, anchor restoration, and
  background refresh behavior require explicit browser tests.
- Cost: a private device may briefly show a stale progress summary until the
  authoritative refresh finishes.

Review condition:

Revisit if teacher devices become shared, if multiple teachers share one Login
ID, if the cached payload grows materially, or if CloudBase adds a supported
server revision/conditional-fetch mechanism.

## 2026-07-15: Use Browser Speech for Lightweight Vocabulary Pronunciation

Decision:

Use `SpeechSynthesisUtterance` with `en-GB` for My Words and Vocabulary
Learn/Spell pronunciation controls instead of adding a new audio service or one
audio asset per vocabulary item.

Reason:

The words are already present in public runtime data, pronunciation is
non-countable practice feedback, and browser speech avoids provider keys,
CloudBase changes, and large audio libraries.

Trade-offs:

- Good: no backend deployment, content migration, or new dependency.
- Good: direct user clicks satisfy normal mobile browser playback rules.
- Cost: voice quality and availability vary by device/browser.
- Cost: homographs may use the device voice's default pronunciation.

Review condition:

Revisit if the owner requires one fixed recorded accent, offline audio, or
pronunciation-specific handling for homographs.

## 2026-06-16: Use Static Frontend With CloudBase Backend

Decision:

Use static HTML/CSS/vanilla JavaScript for the frontend and Tencent CloudBase for authentication, cloud functions, and database.

Reason:

The project is a small-to-medium teaching application maintained by a teacher with AI/developer assistance. A static frontend keeps deployment simple, while CloudBase provides enough backend capability for login, private grading, assignments, and attempts.

Trade-offs:

- Good: simple hosting, no frontend build system, easy to inspect pages.
- Good: CloudBase provides managed auth and database.
- Cost: backend deployment is manual and separate from static publishing.
- Cost: vanilla JS pages can become large without discipline.

Review condition:

Revisit if the frontend becomes hard to maintain, if multi-teacher commercial features require a richer backend, or if CloudBase limitations block required workflows.

## 2026-06-16: Keep Database Collections ADMINONLY

Decision:

All CloudBase collections remain `ADMINONLY`; browsers access data only through cloud functions.

Reason:

The system stores student data, assignments, attempts, private answers, accepted variants, and teacher corrections. Direct browser access would make permissions fragile.

Trade-offs:

- Good: simple security model.
- Good: grading keys stay private.
- Cost: more cloud function code is needed.

Review condition:

Only revisit if CloudBase supports a proven safer row-level permission design and there is a clear need.

## 2026-06-16: Store Correct Answers in Private `grading_keys`

Decision:

Correct answers, accepted variants, explanations, evidence, and scoring rules belong in CloudBase `grading_keys`, not public runtime JSON.

Reason:

Students should not be able to casually inspect public files to get answer keys. Teachers also need server-authoritative grading and Argue corrections.

Trade-offs:

- Good: supports trusted server-side grading.
- Good: supports answer rule history.
- Cost: content import has two layers: public data and private grading import.
- Cost: legacy public answers need gradual cleanup.

Review condition:

Do not reverse this. Only improve tooling around import/reconcile.

## 2026-06-16: Use Owner-Gated CloudBase Release Automation

Decision:

Use local helper scripts for release verification, cloud-function packaging, and
deploy-plan generation, but keep actual CloudBase deployment, data import,
environment variables, and cloud credentials under owner control.

Reason:

The project is maintained with AI/Codex assistance, but CloudBase account
authority, billing, production resources, and secrets must remain with the
owner. Semi-automation removes repetitive packaging and checklist work without
giving agents cloud authority.

Trade-offs:

- Good: faster releases with a repeatable local process.
- Good: agents can prepare artifacts without seeing secrets.
- Good: the owner has a clear review point before upload/import.
- Cost: deployment still requires a manual owner action.
- Cost: generated plans depend on reviewing the current dirty working tree.

Review condition:

Revisit only if the owner wants CI/CD. Any future CI/CD should be manually
triggered and require owner approval before CloudBase secrets are available.

## 2026-06-16: Use Insert-Missing CLI Import for Content Data

Decision:

Use `scripts/cloudbase-import-content.js` as the owner-run CLI path for
CloudBase content imports. The script dry-runs by default and writes only when
`--apply` is passed. Its default apply mode uses insert-missing semantics for
`sets` and `grading_keys`.

Reason:

Most content releases add new `set_id` records. Re-importing local
`grading_keys` with blind overwrite could erase teacher-approved Argue changes
made directly in CloudBase. Insert-missing import removes the console upload
step while preserving CloudBase as the authority for revised grading rules.

Trade-offs:

- Good: content imports can be done from the terminal.
- Good: repeat imports are safer because existing grading keys are not changed.
- Cost: intentional corrections to existing grading keys need explicit
  `--overwrite-existing` after owner review.

Review condition:

Revisit after a proper grading-key reconcile workflow exists.

## 2026-06-16: Attempts Are Immutable

Decision:

Every countable submission creates a new attempt record. Retries do not overwrite earlier attempts.

Reason:

The teacher needs full learning history, retry tracking, and reliable dispute handling.

Trade-offs:

- Good: auditability and progress history.
- Good: disputes can target exact historical answers.
- Cost: dashboards must aggregate attempts carefully.

Review condition:

Do not remove immutable attempts. Add archival/reporting tools if volume grows.

## 2026-06-16: Assignment Status Is Monotonic

Decision:

Assignment status can move `to_do -> passed -> mastered`, but normal code cannot downgrade it.

Reason:

A later low-scoring retry should not erase a student's already completed assignment. Latest attempt and best attempt are separate concepts.

Trade-offs:

- Good: completion is stable and teacher-friendly.
- Cost: UI must distinguish latest score from best/completion status.

Review condition:

Only revisit if the teacher explicitly wants assignment completion to reset under a new assignment instance.

## 2026-06-16: Completed Work Can Be Reassigned

Decision:

Completed, passed, mastered, or STAR history does not block assigning the same set again. Only an open assignment blocks duplication.

Reason:

Teachers may want repeated practice at different times. Historical completion should be preserved, not used as a permanent block.

Trade-offs:

- Good: preserves old attempts while allowing spaced repetition.
- Cost: dashboards and reports must treat assignment instances separately.

Review condition:

Revisit if teacher workflows require explicit "do not repeat" curriculum rules.

## 2026-06-16: Student Dashboard Shows Two Buckets

Decision:

Student dashboard displays `TO DO` and `FINISHED`; backend keeps detailed `passed` and `mastered`.

Reason:

The owner confirmed the simpler student view is preferred. STAR/mastery can still be shown inside finished cards.

Trade-offs:

- Good: less confusing for students.
- Cost: teacher/reporting views must expose more detail when needed.

Review condition:

Only split again if the owner explicitly asks for separate Passed/Mastered student tabs.

## 2026-06-16: Documentation System Uses Numbered Docs

Decision:

Use root `README.md` and `AGENTS.md`, with detailed canonical docs under `docs/01...`.

Reason:

The project is maintained by humans and AI Agents. Numbered docs create a stable reading order and reduce repeated rediscovery.

Trade-offs:

- Good: easier handoff.
- Cost: documentation must be kept current.

Review condition:

Revisit if docs become too fragmented or are no longer being updated.

## 2026-06-16: Do Not Introduce a Frontend Framework Yet

Decision:

Do not rewrite the app in React/Vue/Next or add a build tool at this stage.

Reason:

The current code is static and deployable. The biggest risks are backend rules, data flow, and documentation, not component technology.

Trade-offs:

- Good: no build/dependency burden.
- Cost: large HTML files need discipline and documentation.

Review condition:

Revisit if UI complexity grows enough that static pages slow development or cause frequent regressions.

## 2026-07-09: Generate Vocabulary PDF Downloads With ReportLab

Decision:

Use a local Python ReportLab script to generate static Vocabulary PDF downloads
from `content/vocabulary/<set_id>.json`: no-answer practice worksheets and
fold-and-cover wordlists.

Reason:

The owner wants student downloads to feel like deliberate worksheet handouts,
not browser printouts of the interactive page. Static PDFs keep the student
experience simple, avoid browser-specific print layout drift, and do not
require CloudBase or runtime grading access.

Trade-offs:

- Good: stable A4 pagination, headers, footers, and no-answer exercise output.
- Good: download buttons can link to ordinary static files.
- Good: no frontend PDF library or CloudBase function is needed.
- Good: the current worksheet style is a black-and-white exam-paper table with
  no logo or image dependency, a simple source/unit header, top-right
  `Name`/`Date`/`Score` tags, a black `SET` word-bank ribbon, and two-column
  question tables without a separate answer column.
- Good: wordlist PDFs embed a local CJK TrueType font for Chinese meanings and
  render emoji cues to small images before embedding them, avoiding missing
  glyph boxes in PDF viewers.
- Cost: generated PDFs must be rebuilt when vocabulary prompts or groups
  change.
- Cost: the local generation environment needs Python with ReportLab and
  Pillow for emoji wordlist rendering.

Review condition:

Revisit if worksheet styling becomes too complex for ReportLab or if the owner
wants dynamic per-student PDF content.

## 2026-07-09: Use Browser PDF Generation Only for Custom Vocabulary Worksheets

Decision:

Keep the static ReportLab Vocabulary PDFs as the default `Confirm` download,
and add a small local browser PDF generator for `Customise` downloads that need
selected groups or shuffled worksheet order.

Reason:

The owner wants `Download Practice` to support custom group selection and a
randomiser that shuffles each selected group's word bank and question order.
Pre-generating every group combination and shuffle permutation is not practical,
while a browser-generated PDF can use the already public no-answer vocabulary
question data without calling CloudBase or exposing grading keys. Keeping the
static full worksheet as the default preserves the most stable path for normal
classroom use.

Trade-offs:

- Good: no external CDN, network dependency, or CloudBase function is required
  for custom worksheet downloads.
- Good: static all-groups and single-group PDFs remain available for the common
  non-shuffled cases.
- Good: shuffled worksheets use a hidden randomiser seed so the dialog stays
  simple while selected groups and group order remain stable.
- Cost: the local browser generator duplicates the public no-answer worksheet
  layout used by the Python ReportLab source, so visual worksheet changes must
  be mirrored in both implementations.
- Cost: custom multi-group or shuffled PDFs depend on browser Blob downloads.

Review condition:

Revisit if custom worksheet PDFs need CJK wordlist text, richer typography, or
server-side archival.

## 2026-07-12: Dictionary-First My Words Enrichment

Decision:

Enrich personal saved words with a shared `vocabulary_lexicon`: project-curated
Vocabulary entries first, an optional frequency-bounded ECDICT import second,
and Free Dictionary API only for remaining cache misses. Personal saves return
before the browser requests enrichment.

Reason:

Students need dependable parts of speech and definitions without paying for a
large-language-model call on every saved word. The project already contains
thousands of bilingual curated entries, while shared caching makes repeated
unknown words a single provider lookup across all students.

Trade-offs:

- Good: no model cost and near-immediate curated/ECDICT results.
- Good: external outages never block or remove a saved personal word.
- Good: fixed backend-only provider access avoids exposed keys and arbitrary URLs.
- Cost: ECDICT data must be prepared and owner-imported separately.
- Cost: Free Dictionary API provides English data but generally no Chinese meaning.
- Cost: provider results require attribution and do not have a paid SLA.

Review condition:

Revisit the provider only if lookup reliability or licensing no longer fits the
product, or if contextual sense selection later justifies a bounded AI fallback.

## 2026-08-01: Keep One Current Shared Dictionary Entry With Hidden History

Decision:

Use one current `vocabulary_lexicon` record per normalized word for curated,
external, student-confirmed AI, and teacher-reviewed content. The first
student-confirmed AI result becomes the shared draft. A teacher publication
replaces that current record and stores the old/new snapshot in
`vocabulary_lexicon_history`; students never see parallel old-version cards.

Reason:

One visible current record keeps frontend rendering and backend lookup
deterministic while still preserving an audit trail. Personal student Notes
stay exclusively on `student_vocabulary_items` and are never overwritten by a
shared dictionary update.

Trade-offs:

- Good: every student resolves a word to the same current shared entry.
- Good: a teacher correction takes effect immediately without duplicate cards.
- Good: hidden history supports audit and rollback tooling later.
- Cost: teacher publication is a replacement operation and therefore requires
  history to be written before the current record changes.
- Cost: AI drafts need a visible unreviewed label and issue-report path until a
  teacher reviews them.

Review condition:

Revisit only if the product later needs side-by-side dictionary editions or
language/curriculum-specific definitions for the same normalized word.

## 2026-08-04: Model Substantive Rewrites as Independent Sets

Decision:

Keep every existing `set_id` immutable. When the owner explicitly declares a
new edition, create a new suffixed set such as `BBC-250904-V2` and relate it to
the original through explicit edition metadata. Group editions only in Student
Library discovery; keep scoring, Assignments, Attempts, and STARs independent.

Reason:

This preserves all current ownership and history keys while allowing students
and teachers to use V1 and V2 side by side. It avoids a cross-collection rename
migration and prevents old and new scores from being compared as one exercise.

Trade-offs:

- Good: old assignments and history remain valid without migration.
- Good: each edition can earn its own STAR and use independent thresholds.
- Cost: public content, `sets`, and private grading keys must be published for
  each concrete edition.
- Cost: small same-edition revisions can still produce different grading
  versions; history therefore requires immutable snapshots and upward-only repair.

Review condition:

Revisit if the owner later wants archived editions hidden from Student Library
or Teacher Assign. No archive behavior is part of the current release.
## 2026-08-12: Publish the GitHub Main Branch to Tencent COS Static Hosting

Decision:

Keep GitHub as the source of truth and automatically publish successful
`main`-branch static builds to a Tencent COS static-website bucket through
GitHub Actions. Build an explicit `dist/` allowlist rather than serving the
repository root. CloudBase remains the trusted backend and is deployed
separately.

Reason:

The owner wants an ordinary Git push to update the student-facing custom domain
and wants rollback to remain a normal Git revert. The repository also contains
cloud-function source, internal documentation, scripts, and deployment files
that must not become static website resources.

Trade-offs:

- Good: one reviewed Git history drives both collaboration and static release.
- Good: the hosted artifact contains only intended public frontend resources.
- Good: incremental object synchronization avoids retransmitting the full
  audio library after an ordinary source change.
- Cost: every new public top-level file type or public directory must be added
  deliberately to `scripts/build-static-site.js`.
- Cost: the COS bucket, custom-domain certificate, DNS, and narrowly scoped CAM
  deployment identity require separate owner-managed configuration.
- Cost: automatic static publication does not deploy CloudBase functions or
  apply database changes; those remain separately owner-gated.

Review condition:

Revisit if the project adopts a frontend bundler, needs staged promotion, or
adds public resources outside the current allowlist.
