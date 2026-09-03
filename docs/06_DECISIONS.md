# 06 Decisions

## 2026-08-31: Writing sentence identity is quote-aware and server-owned

Decision:

Keep server-generated sentence IDs as the only language-review boundary. Run the platform English segmenter first, then deterministically merge candidate boundaries that fall inside a balanced straight/curly quotation or before a lower-case continuation after quoted terminal punctuation. Treat a blank-line paragraph break as a hard boundary, and do not treat possessive apostrophes or measurement marks as quotation pairs.

Reason:

General Unicode sentence segmentation recognizes punctuation boundaries but does not parse the outer grammar of direct speech. It can split one grammatical sentence into two valid IDs, forcing the model to review both fragments and recommend that they be reunited. Repairing this before the model call preserves stable, code-owned identity and keeps the model responsible only for analysis.

Trade-offs:

- The repair is deliberately conservative and does not attempt full syntactic parsing.
- A genuinely new sentence that incorrectly begins with a lower-case letter immediately after a closing quotation may be treated as a continuation; a paragraph break remains an explicit escape boundary.
- Existing stored reviews remain immutable and adopt the new boundary only after a deliberate new review.

## 2026-08-30: Turn coaching uses explicit evidence-effect-action fields

Decision:

Version new Group Discussion reports as `dse-speaking-report-v4`. For both CS
and IO, every canonical turn requires bounded `strength_zh`, `limitation_zh`,
`improvement_zh`, and `sample_en` fields. Keep immutable V2/V3 commentary
readable through a projection-only compatibility path. Use the existing hard
output cap of 16,000 tokens and make that cap the default for V4.

Reason:

A single free-form commentary field encouraged short, interchangeable feedback
and could not guarantee that students saw what worked, what constrained the
turn, or what to do next. Separate required fields make those teaching purposes
machine-checkable while retaining one model call and the existing privacy/ASR
safeguards.

Trade-offs:

- V4 responses are larger and may cost more than concise V2/V3 reports.
- A six-Candidate report has less output headroom, so the prompt bounds each
  field to one or two complete sentences and the provider budget uses 16,000.
- Historical reports remain immutable and cannot gain the new detail without a
  deliberate reanalysis that creates a new report version.

## 2026-08-30: Speaking coaching belongs to its assessed dimension

Decision:

Version Group Discussion reports as `dse-speaking-report-v3`. Each assessed
CS, IO, and VL domain owns its bounded strengths, priority actions, and language
suggestions alongside its score, commentary, and evidence IDs. Keep PD
unassessed. Do not migrate or rewrite ready reports; the browser provides a
labelled compatibility presentation for older Candidate-level coaching.

Reason:

A shared coaching list makes it unclear which DSE criterion a student should
improve and prevents a four-button report from remaining internally coherent.
Putting advice at the same validated boundary as its score and evidence keeps
the UI, prompt, stored report, and private share projection aligned.

Trade-offs:

- New structured responses are larger, but every list is capped at six items
  and the existing output-token ceiling remains sufficient.
- Historical reports cannot be perfectly reclassified without a new model call,
  so they remain immutable and visibly use their legacy grouping.
- Teacher and share surfaces can adopt the richer lists incrementally because
  the existing score/commentary fields and root compatibility arrays remain
  readable.

## 2026-08-30: Derive BBC waveforms from the played MP3 and keep media time authoritative

Decision:

Generate BBC waveform peaks in the browser by fetching and decoding the same
public `audioSrc` assigned to the hidden native media element. Retain only a
bounded peak array after decoding and add no waveform dependency or secondary
timestamp artifact. Treat `<audio>.duration` and `<audio>.currentTime` as the
only playback clock. At every zoom level, seek against the full scrollable
waveform rectangle rather than the visible viewport. At high zoom, cap the
canvas backing-store width while preserving the full CSS timeline width and
native media-time mapping.

Reason:

A separately generated image, transcript timeline, or viewport-relative
percentage can visually drift from the audio actually played, especially once
the timeline is zoomed and scrolled. The same-source normalized waveform plus
native media time removes those competing clocks and keeps future BBC imports
automatic.

Trade-offs:

- First entry downloads and briefly decodes the lesson MP3 to calculate peaks;
  playback itself is not delayed and browser caching normally reuses the file.
- Low-memory or unsupported browsers may fail waveform decoding. They retain a
  flat interactive timeline and every playback/seek control.
- The 64× timeline can exceed browser canvas dimension limits. A bounded
  backing store is stretched across the full timeline so the visual stays
  available without creating a second clock or changing seek precision.
- The waveform is a navigation aid, not a transcript alignment or grading data
  source.

## 2026-08-29: Formal browser recording uses one four-state flow

Decision:

Model the student formal recorder as `idle`, `requesting/recording/stopping`,
`review`, and `uploading`, presented as four mutually exclusive Ready,
Recording, Review, and Uploading surfaces. Formal DSE recording has no Pause.
The verified upload automatically requests analysis, while an upload failure
returns to Review with the same operation ID.

Reason:

The previous independent buttons allowed a second recorder, Discussion
re-render, file upload, or navigation to compete with an active microphone
session. One primary action per state makes the common phone flow predictable
and lets the browser protect the in-memory Blob until the student explicitly
replaces or uploads it.

Trade-offs:

- Students who genuinely need an interruption must finish and record again.
- Browser backgrounding still depends on platform recording support, but the
  application no longer destroys its controls when the page becomes visible.
- Automatic analysis start removes one click; if that request fails after a
  verified upload, the existing uploaded-audio screen still offers manual retry.

## 2026-08-29: Historical voice rematching is a separate durable job

Decision:

Let an accepted VIP Participant or teacher explicitly search a ready
Discussion again after new reusable voiceprints are enrolled. Implement the
search as `job_type: "voice_rematch"` starting at the existing
`voice_matching` stage. It references the active ready report and formal audio,
but never calls ASR or the DSE analysis model and never mutates the report's
transcript, scores, or coaching.

Reason:

Voiceprints can be enrolled after a Discussion has finished. Re-running the
whole pipeline would add cost and could produce a different transcript or
assessment for what is only an identity update. A separate job keeps the ready
report continuously available, survives refresh through the existing worker,
and lets the same threshold/margin/one-to-one safeguards be reused.

Trade-offs:

- Tencent CI and voiceprint identification still incur their normal matching
  cost for each explicit search.
- Automatic rematching fills only safe empty/same mappings; a conflict,
  dispute, student confirmation, or teacher lock still requires teacher action.
- Mapping changes revoke existing external snapshots so a new share must be
  generated with the current identity projection.

## 2026-08-28: Candidate detection precedes optional identity matching

A Discussion is created without a roster. Tencent diarization first selects the
three-to-six strongest eligible Speaker Tracks as Candidates, independently of
who has been invited or named. Identity is then an optional projection: for
each Candidate with an uninterrupted 8–20 second turn, Tencent COS/CI produces
a private 16 kHz mono WAV and Tencent voiceprint group verification proposes
one VIP only at score 70 or above and a 10-point lead over the runner-up.
One-to-one resolution prevents one VIP from owning two tracks.

The CI adapter uses built-in `crypto` and `fetch`, so this architecture adds
no runtime dependency or ffmpeg binary. Derived clips are deleted immediately
after verification. The stage is fail-soft because identity does not determine
DSE evidence: no clip, no enrolled voiceprint, ambiguity, or provider failure
leaves a Speaker anonymous and continues analysis. Accepted proposals create
the existing invitation/confirmation flow; they do not bypass student consent
or teacher authority.

## 2026-08-28: Speaking turn review is server-keyed, complete, and concise

Per-utterance feedback uses server-derived canonical speaking turns rather than
provider sentence boundaries or model-generated quotations. A same-Candidate
run stays one turn until another voice/non-Candidate context or a 2.5-second gap
ends it. The structured model must return exactly one CS and IO review for every
turn ID. The server reconstructs quoted transcript/timing data and rejects
missing, duplicated, foreign, or invented IDs. This makes completeness and
evidence mechanical while preserving the existing ASR uncertainty safeguard.

Each domain has one short Traditional-Chinese observation and one achievable
English sample. Separate samples keep Vocabulary/Language support subordinate
to the requested CS and IO goal. Because a four-to-six Candidate report is now
longer, the code default structured-output budget increases from 8,000 to
12,000 tokens while retaining the 16,000 hard cap and environment override.

## 2026-08-28: Speaking reports discard untrusted extra model fields

The Speaking report boundary validates every required Candidate, assessed
domain score, and evidence segment, then constructs a fresh canonical object.
Unknown root, Candidate, or domain fields are discarded instead of causing the
entire report to fail. This is safe because no provider object is stored
directly, and it makes the boundary resilient to harmless metadata such as a
provider-echoed schema version.

The same boundary unwraps one unambiguous report object and converts a
Speaker-keyed Candidate map into an array. It then applies the unchanged known
Speaker, Candidate-count, score, and evidence ownership rules before storing a
fresh canonical report.

> Architecture Decision Records for important product and technical choices.
> Add a record when introducing a new dependency, platform, architecture pattern, data model rule, or major product constraint.

## 2026-08-25: Preserve Runner across terminal AI failure

Decision:

Project terminal OCR, review, rewrite-check, and revision-OCR failures into the
existing waiting card as a red `Interrupted` state rather than replacing the
card. The persistent endpoints remain `Uploaded` and `Finished`; the connector's
`Thinking` process label becomes `Interrupted`. Keep the Canvas and its ephemeral score alive, expose exactly one Retry
action, and leave navigation to the persistent Back toolbar. Durable jobs receive
five automatic attempts. Manual Retry requeues the validated active OCR/rewrite/
revision job; review Retry creates a fresh quota-controlled operation after the
failed reservation is released.

Reason:

Replacing the page made an infrastructure failure feel like lost work and erased
the activity students were using during a long wait. A retained physical surface
preserves spatial continuity, while the red track communicates that real progress
has stopped. Server-owned retry keeps ownership, revision, private-photo, quota,
and idempotency checks authoritative.

Trade-offs:

- Runner score remains intentionally local and disappears on refresh.
- A manual Retry begins a new five-attempt budget and can therefore increase AI
  cost, but only after an explicit student action.
- Review Retry cannot reuse a released usage reservation; it must pass the daily
  quota boundary again.

## 2026-08-24: Keep waiting interaction Canvas-only and non-authoritative

Decision:

Implement `Mr. Cat Runner` as a small native Canvas IIFE loaded before the AI
Tutor client. The client owns the waiting DOM, server status projection,
polling, Ready handoff, synthesized completion cue, and lifecycle; the Runner
exposes only jump, task-state, pause/resume, destroy, and safe in-memory
snapshot controls (with a legacy finish method retained for compatibility but
never used by the V2 success path).

Reason:

Waiting is a real durable-job state, not a game session. A Canvas-only module
keeps the interaction lightweight, avoids a new dependency, and makes it
impossible for score, distance, collectibles, collisions, or jump state to
become a hidden source of AI progress, rewards, analytics, or persisted student
data. A student-clicked result action preserves agency when the real result is
ready. Completion sound is synthesized with Web Audio only, and failure to
create or play it is ignored.

Trade-offs:

- The interaction is intentionally an endless visual diversion with an
  ephemeral local score rather than a reward or progression system.
- A missing Canvas or animation API reduces the card to its accessible status
  and real polling; it must never block the waiting or result experience.


## 2026-08-19: Centralize Login Entry and Validate Return Routing

Decision:

Keep `index.html` as the only credential-entry surface. A dependency-free shared `login-navigation.js` accepts only same-origin root-level HTML destinations, preserves their query/hash context, strips legacy `user`/`visitor` parameters, and supplies a safe page fallback. Inner pages may offer explicit Visitor mode but may not keep a separate Student ID allowlist or treat URL/local presentation identity as authorization.

Reason:

Duplicated inner login forms drifted from CloudBase Authentication, lost deep-link context, and allowed stale browser identity parameters to influence presentation. One validated route keeps authentication consistent while preserving the exact exercise, report, assignment, attempt, and focus location that initiated login.

Trade-offs:

- Every page that calls the helper must load it before its page-specific script and bump both cache query strings together.
- This is frontend routing only; CloudBase functions remain the authorization boundary.
- Visitor browsing remains available, but switching from Visitor to login performs a full central-login navigation.

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

## 2026-08-31: Use Git Data API as a Verified Push-Network Fallback

Decision:

Keep ordinary Git Push as the first static-source publication path, but bound
its wait time. When and only when an owner-authorized Push fails for a
recognized GitHub HTTPS network condition, allow the repository publisher to
use GitHub's Git Data API with exact Blob and Tree verification and a
non-force branch-reference update.

Reason:

This development network repeatedly reaches `api.github.com` while
`github.com:443` Push connections stall for more than a minute. Repeating the
same Push blocks releases even though the reviewed source and GitHub API remain
available.

Trade-offs:

- Good: release completion no longer depends on one long-lived Git smart-HTTP
  connection.
- Good: the remote SHA must remain unchanged, every changed Blob is
  content-address verified, and the final GitHub Tree must exactly match local
  `HEAD^{tree}`.
- Good: `force: false` preserves branch fast-forward protection and existing
  GitHub Actions continue to run from `main`.
- Cost: multiple local commits may become one API release commit.
- Cost: mutating API calls must be serialized and paced to respect GitHub
  secondary rate limits.
- Cost: the publisher must reconstruct the API commit locally after success so
  later releases do not start from divergent histories.

Review condition:

Remove the fallback if GitHub smart-HTTP becomes consistently reliable, or if
the repository adopts required signed commits, Git LFS, submodules, or branch
rules that the current verified fallback does not support.

## AI Tutor model boundary and record ownership

Decision:

- AI output is treated as typed data, not trusted prose. Every model call uses a
  versioned strict JSON Schema and server-side semantic alignment checks. The
  server derives standardized overall scores from canonical criterion scores,
  derives whether a sentence requires rewriting from its canonical status, and
  derives rewrite acceptance from meaning preservation, target resolution, and
  absence of new errors; it never trusts contradictory summary flags from AI.
- General Language Review represents CEFR as a manuscript-scoped typed estimate:
  one A1–C2 enum, one lower/middle/upper enum, and one Simplified Chinese
  rationale. The UI maps the position to minus/no-suffix/plus compact notation
  and never parses a free-text level or exposes Chinese position labels. This
  prevents a writing sample estimate from becoming an
  implied official score or a permanent student-wide proficiency label.
- The model boundary is vendor-neutral and optimized for mainland deployment.
  Text and vision endpoints are configured separately. Qwen, DeepSeek, Kimi, or
  another compatible provider may be selected without changing product code.
  Native JSON Schema is preferred; JSON Object is accepted only with local
  schema validation and one automatic structural repair attempt. Every result
  freezes non-secret provider/model/protocol metadata so model changes can be
  evaluated later without exposing credentials.
- Provider cost accounting is an append-only event ledger, not an estimated
  field on the latest Composition. One row represents one physical HTTP model
  response, including an automatic JSON-repair response. Both Chat Completions
  and Responses usage shapes normalize to input/output/total counts while raw
  missing values remain missing. A durable-job audit and metadata-only teacher
  alert make telemetry failure visible without making telemetry a dependency of
  the student's successful OCR or review result.
- The student's selected Assessment Framework is authoritative. The system does
  not spend another model call attempting to classify or override it.
- AI Tutor uses Composition and usage-ledger records outside the existing
  Assignment/Attempt/STAR model.
- Long model calls use a CloudBase-database durable queue rather than a browser
  request as the owner of work. The authenticated action creates a stable
  metadata-only job, internal asynchronous dispatch begins processing, and a
  token-protected one-minute worker recovers queued jobs and expired leases.
  Publishing verifies both the active Composition job ID and the worker lease in
  one transaction. This choice avoids a new queue service while preserving
  refresh/re-login recovery and safe same-Composition replacement.
- Durable jobs remain metadata-only even when their recoverable input contains
  student text. Rewrite checking stages that input under the owned Composition's
  `pending_rewrite_check`; the queue stores only its stable operation,
  Composition/revision scope, lifecycle, lease, and safe error metadata. The
  worker resolves the staged body only after claiming the current job.
- Rewrite drafts deliberately use a two-stage durability boundary. Local,
  ownership-scoped persistence protects every keystroke before submission;
  `pending_rewrite_check` becomes the cloud authority only after `Check`. Neither
  layer is cleared on uncertain delivery or model failure, and successful result
  publication is the sole cleanup boundary.
- Rewrite publication keeps two deliberately different projections. The merged
  `rewrite_results.results` remains the latest per-sentence completion state used
  by progress and retry behavior, while append-style
  `rewrite_results.feedback_history` batches preserve every successful model
  feedback round for the student. Batch `operation_id` values make publication
  idempotent. When a legacy record has only its latest merged result, the next
  successful check promotes that recoverable snapshot to round 1 before appending
  the new round; feedback overwritten before this release cannot be reconstructed.
- Sentence analysis and rewriting are two modes of one card, not adjacent panels.
  Mutual exclusion keeps the student from copying while composing; the same
  explicit state supports pointer, keyboard, assistive technology, and a
  non-spatial reduced-motion alternative.
- Nested AI artifacts are whole values at the database boundary. Publishing the
  first rewrite result over `rewrite_results: null` must use
  `db.command.set(...)` in the guarded completion transaction, just like first
  review publication; dotted child updates are not an acceptable substitute.
- Same-screen re-upload is success-then-swap on one Composition; successful AI
  usage remains append-only even when the current Composition is replaced.
- An operation ID is valid for exactly one student, Composition revision, mode,
  and Rubric. Reuse under another scope is rejected rather than replaying an
  unrelated result. Review persistence and usage-ledger success are committed
  together before metadata-only email and profile-observation side effects.
- The first release supports official IELTS framework summaries, HKDSE Paper 2,
  and Cambridge International AS & A Level English Language 9093 Paper 2. The
  Cambridge shorter writing, reflective commentary, and extended writing tasks
  remain separate Rubrics because their AO and maximum marks differ.

Why:

This makes UI parsing deterministic, prevents accidental exam reclassification,
keeps quota billing auditable, and preserves the established meanings of
Assignment and Attempt.

Review condition:

Revisit when adding a new assessment board, CEFR level-up variants, or a human
moderation workflow.

Detailed incident evidence and the reusable gate for every future AI feature are
recorded in `docs/adr/0003-durable-canonical-ai-boundaries.md`.

## 2026-08-22: Keep photographed Sentence Revision as a reviewed draft import

Decision:

- `Scan Revisions` is an affordance inside editable Sentence Revision, not a
  second submission or a new sentence source. The student supplies the existing
  global sentence number at the beginning of each photographed answer. The
  accepted marker forms are `8`, `8.`, `8、`, `8)`, and `(8)`; punctuation is
  optional and whitespace is recommended.
- Private photo upload and the durable `revision_ocr` job are one resumable
  operation. The job is scoped to one student, Composition, Composition revision,
  and operation ID. Its strict structured response is only a candidate; server
  canonicalization validates the number against the current sentence list and
  preserves unresolved or ambiguous rows for human review.
- Camera capture is staged locally before that operation begins. Repeated native
  picker changes append to one ordered queue of at most eight photos; only
  `Start Scanning` freezes the batch fingerprint and crosses into private upload.
  This gives single-capture mobile cameras an explicit add-more path without
  weakening the durable boundary after submission.
- OCR output first lands in a guarded pending scan result. The student must review
  each sentence card, manually assign a sentence where necessary, and explicitly
  press `Confirm Scanning` to adopt the reviewed card text. Confirmation replaces the corresponding
  unfinished draft; returning without confirmation preserves it. Only confirmed rows are
  persisted as scanned revision drafts, and they
  flow through the existing `Check` action; import never auto-checks.

Why:

Handwritten numbering gives the system a stable mapping without asking a vision
model to infer sentence order from a photo. Separating candidate OCR from
confirmed drafts makes uncertainty visible, protects typed work from silent
replacement, and keeps model output from becoming a grading or completion event.

Review condition:

Revisit if photographed answers need bulk classroom import, a new marker grammar,
or teacher-side approval; those changes would require a new ownership and audit
decision.

## AI Tutor shell and title ownership

Decision:

- AI Tutor has one top toolbar and card-based page content. The former brand
  lockup is removed; its position becomes the portfolio trigger. Portfolio is a
  single, initially closed overlay drawer at every breakpoint rather than a
  persistent tablet/desktop layout column. All close affordances converge on one
  accessible controller.
- Returning to Dashboard uses an application confirmation dialog. Leaving the
  page does not cancel OCR or review because durable jobs, not the browser, own
  their execution.
- An unnamed review may receive one two-to-six-English-word suggested title in
  the existing structured model response. This does not justify another model
  request, durable job, quota reservation, or usage charge.
- Title precedence is explicit: a student-authored title is permanent authority;
  AI may fill only a `pending_ai` title, including an eligible historical
  `Untitled writing` fallback. The Composition
  records that ownership instead of inferring it from current title text after a
  student rename.

Why:

One shell model avoids breakpoint-dependent navigation, while explicit title
ownership prevents a useful AI convenience from erasing student intent. Folding
the suggestion into an already billable review keeps cost and idempotency stable.

Review condition:

Revisit if portfolio becomes a full-page information architecture, collaborative
title editing is introduced, or titles need localization beyond short English
labels.

## Separate best-effort OCR location call (2026-08-24)

Decision: keep OCR transcription and uncertainty location as two structured model calls inside the same
claimed OCR job, with the second call optional and bounded. Never create a second durable job or make the
transcription commit depend on rectangles.

Why: transcription is the required student-facing result and already has durable lease/idempotency
semantics. A separate strict contract keeps coordinates out of the stable OCR schema, lets the server
reject hallucinated/out-of-range boxes without clamping, and makes provider failures harmless to the
successful text result. Only safe provider metadata and canonical temporary regions are stored.

## Purpose-bound initial OCR (2026-08-25)

Decision: use the existing private upload and durable OCR job pipeline for both
manuscript and Writing Prompt photos, but persist `ocr_purpose: writing|prompt`
through upload rows, pending state, job identity, public projection, and OCR result.
Include the purpose in the client operation fingerprint. A prompt confirmation
may update only `prompt_text`; it clears the OCR state and private photos and must
not call evaluation.

Why: one durable pipeline preserves close-browser recovery and model hardening,
while an explicit purpose prevents an idempotent replay or resumed job from putting
prompt text into the student manuscript or triggering a review unexpectedly.

Review condition: revisit only if prompt extraction later needs a distinct schema
for images containing diagrams, tables, or multi-part source materials.

## Speaking formal-audio upload transport (2026-08-28)

Decision: reserve the exact private Storage path in `speakingLab`, upload the
file with the authenticated CloudBase browser SDK, then send the SDK-returned
CloudBase file ID to `finishAudioUpload`. The gateway accepts only a file ID
whose object key equals the reserved path and whose actual Storage size equals
the expected size. The browser abandons the waiting state after ten minutes.

Why: manually returning COS URL/token/authorization fields coupled Speaking Lab
to an unstable metadata shape and left failed transfers in an indefinite busy
state. The official browser SDK owns credential refresh and authenticated
transfer behavior, while exact-path and size verification preserves the server
trust boundary. Existing evidence-photo and Writing upload transports are not
changed by this decision.

Review condition: revisit only if CloudBase documents that authenticated SDK
uploads cannot support the required recording sizes or resumability, and retain
the same server-reserved path plus post-upload verification boundary.

## DSE Speaking identity and provider boundary (2026-08-27)

Speaking Lab originally stored no reusable voiceprint or biometric embedding.
ADR 0005 supersedes the no-reusable-voiceprint part: a consenting VIP may now
hold one Tencent voiceprint keyed by authenticated UID, while a Guest
voiceprint remains scoped to one Discussion participant. Mr. Cat Academy stores
the private provider locator and lifecycle/audit metadata but never enrolment
audio or an embedding. Voice References remain Discussion-scoped fallbacks and
are deleted seven days after a successful match; formal recordings remain
private for the Discussion lifetime. Reports
retain stable anonymous Speaker keys and server-derived evidence. Student and
Teacher shares are immutable server-built snapshots with snapshot-local aliases
and exact-name redaction.

The speech/text provider is an explicit interface. The first implementation
candidate is Tencent recording-file recognition (`16k_en`, ordinary Speaker
diarization) plus an independently configured OpenAI-compatible JSON-object
model for the DSE report. It remains environment-disabled until the owner's
real-audio benchmark and rollout gate are complete. ASR submits once and polls
one Task ID; the server converts provider Speaker IDs into stable Speaker keys,
marks incidental tracks as non-Candidate context, and validates all model
evidence locally. Pronunciation and delivery are not assessed in V1. Fixtures
are test-only and cannot be selected from browser input, production environment
flags, or queue metadata.

ASR output is treated as fallible evidence rather than Candidate ground truth.
The versioned DSE prompt receives each segment's normalized ASR confidence plus
an explicit `confidence_unknown`, `low_confidence`, or `higher_confidence`
status. Unknown confidence is neither accepted as accurate nor rejected as
wrong. One suspicious token cannot cause a deduction, direct criticism, or
exact correction; such criticism requires repetition across distinct segments
or syntax that remains unambiguous without the suspicious token. This boundary
stays in the rubric prompt instead of deterministic report post-processing,
because the canonical report schema cannot reliably distinguish an exact
language correction from broader evidence-based coaching. Local tests lock the
instruction and input metadata, and every generated report records the prompt
version used.

Tencent's normal diarization output does not supply per-Speaker audio that can
be sent safely to the existing single-speaker voiceprint verification API.
Therefore reusable voiceprint auto-matching is never guessed from turn order or
performed on the mixed Discussion file. The 2026-08-28 Candidate-first decision
implements the required private CI excerpt boundary; results still remain under
Speaker labels until student confirmation or teacher mapping.

The Speaking gateway and its private timer Worker remain fully bundled. The
provider pipeline made the generic SDK bundle exceed the current environment's
expanded-code limit, although the compressed archive remained small. For
`speakingLab` and `speakingAiWorker` only, the package builder replaces the
SDK's unused AI/model and WeChat-client import branches with empty build-time
modules and fails if either generated `index.js` exceeds 900,000 bytes. The
required auth, database, storage, function-invocation, configuration, and
signing paths remain in the bundle, and automatic dependency installation
remains disabled. This is narrower than an SDK rewrite, introduces no
dependency, and is guarded by the normal service and package contract tests.

### Intensive Listening session summaries

Intensive Listening uses the existing private attempt-email outbox rather
than synthetic Attempt documents. A server-generated ils session ID and
deterministic Started/final event IDs make retries and concurrent tabs
idempotent. The one-minute dispatcher owns idle closure and uses the existing
teacher recipient policy; safe counts are the only email/bell payload.

### Speaking Sets and Part B are separate domain objects

Speaking Sets use their own ADMINONLY collection rather than the general LMS
`sets` schema. Set IDs and Part A/Part B child IDs are stable; teacher content
edits increment a revision while every created Session stores a frozen snapshot.
Individual Response is a separate one-owner Session, not a one-person Group
Discussion. It reuses private asset/job/report infrastructure only through an
explicit `session_type` and exactly one Session locator. PP/MOCK is metadata,
not a publication state. Speaking Set source is excluded from the public static
artifact and is imported through an owner-gated CloudBase workflow.

### Complete Paper 4 corpus and summary/detail boundary (2026-09-02)

Keep one canonical private corpus with stable PP Set IDs. The 306 visible
past-paper practices preserve verified identity and question intent while using
original adapted Context prose. Retain the five original MOCKs for history but
hide them from new practice. List operations return metadata summaries; full
content is fetched only when one authorized Set is opened. This protects the
private source and avoids returning all 306 Contexts on every library load.

### Paper 4 evidence hierarchy and audited regeneration (2026-09-03)

Past-paper identity and task content use a recorded evidence hierarchy:
official HKEAA material, then a complete HKEAA-branded scan, then independent
topic indexes, then multiple candidate-recall sources. Lower-tier wording is
valid only as clearly labelled practice paraphrase. Official Context articles
are not reproduced; every preparation article is original mock prose tied to
the verified task. Year-scoped audit artifacts are durable private source, and
a deterministic merger—not the raw Markdown generator—owns canonical rebuilds.
Stable child IDs survive display-order corrections; `order` remains the only
display sequence. Existing Session/report snapshots never migrate with later
content corrections.
### Dedicated Scan domain (2026-09-02)

Scan sessions/pages/jobs are separate from writing and vocabulary-test data so
temporary OCR and image retention cannot leak into learning history. Native
Canvas avoids a new dependency. Candidates are reconstructed server-side from
owned token IDs, and commits reuse a shared personal-vocabulary upsert to keep
deduplication and enrichment behavior consistent.

The scan-specific adapter reuses the existing Writing vision transport rather
than introducing another provider stack. That transport exposes an optional
callback immediately before the outbound model request; Scan Words uses it as
the quota boundary, while all existing Writing callers retain identical
behavior. This keeps provider configuration/protocol handling unified without
coupling scan sessions to Writing compositions.
