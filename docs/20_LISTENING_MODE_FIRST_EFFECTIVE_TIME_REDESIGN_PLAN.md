# Listening Mode-First + Effective Learning Time Redesign

## 0. Document status

- Product decisions: approved by the owner on 2026-09-07.
- Implementation status: built by the delegated Luna Extra High agent and
  reviewed/hardened by the primary agent locally on 2026-09-07; not yet
  released.
- Predecessor: `docs/19_LISTENING_DICTATION_SHADOWING_IMPLEMENTATION_PLAN.md`.
- This document supersedes the conflicting product and implementation rules in
  Plans 16 and 19. Those files remain historical records; do not silently edit
  them into pretending the earlier design never existed.
- Production deployment, CloudBase collection/index creation, function
  deployment, provider enablement, data import, and static publication remain
  owner-gated.

This is an execution document. An implementation agent should follow the order,
contracts, invariants, and acceptance tests below instead of reinterpreting the
product from the current UI.

## 1. Objective

Replace the current material-level Dictation/Shadowing chooser with a
mode-first Listening experience:

1. The student chooses `Dictation` or `Shadowing` at the top of the Listening
   Library.
2. Every material then opens in that selected mode.
3. The practice toolbar keeps Back on the left, mode-specific progress in the
   centre, and the mode switcher on the right.
4. Dictation and Shadowing use one teacher-reviewed canonical unit list. The
   teacher corrects text and timing once.
5. Dictation and Shadowing progress remain independent, while content updates
   change both current progress scopes together.
6. Listening is self-study only. `IL-*` materials must not be assignable.
7. Add durable, generic effective-learning-time records and project them into
   the student achievement calendar and teacher/report summaries.
8. Move Shadowing from Tencent sentence evaluation (`EvalMode=1`) to paragraph
   evaluation (`EvalMode=2`) so current canonical Dictation units can be reused
   without a 30-word product restriction.
9. Rework the first-pass UI to match the existing Writing and Speaking visual
   language: calm light surfaces, restrained colour, clear hierarchy, system
   typography, consistent toolbar geometry, and accessible motion.

## 2. Non-negotiable product rules

### 2.1 Naming and entry points

- Dashboard first-level workspace name: `Listening`.
- Internal mode names: exactly `Dictation` and `Shadowing`.
- The contextual action inside BBC and IELTS listening remains labelled
  `Intensive Listening`.
- Do not add Dictation or Shadowing progress to ordinary BBC/IELTS Library
  cards.
- Keep existing `intensive-listening.html` and
  `intensive-listening-library.html` URLs working.
- Remove the intermediate two-card track chooser.
- First account use defaults to Dictation. Later uses restore the student's
  server-backed last mode.
- An explicit safe same-origin URL `mode=dictation|shadowing` updates the
  account preference and opens that mode. Invalid values are ignored.

### 2.2 Toolbar contracts

Listening Library toolbar:

- left: Back;
- centre: plain-text `Dictation` or `Shadowing` plus a small downward chevron;
- right: balanced spacer;
- pressing the centre control opens an anchored two-row popover;
- current row has a checkmark; no long descriptions and no full-screen mode
  modal.

Practice toolbar:

- left: Back;
- centre: current-mode result progress bar;
- right: `Dictation`/`Shadowing` mode button and chevron;
- phone fallback may use the mode icon plus chevron, with a complete accessible
  name;
- do not add a second large `Listening` title above the exercise.

### 2.3 Catalog behaviour

- Every material card is one whole-card action for the selected top mode.
- Do not render two mode buttons on a card.
- Card status is mode-specific: `Start`, `Continue · x of y`, or `Completed`.
- Sort current-mode in-progress first, then not-started, then completed; use
  recent practice/publication ordering inside each group.
- Other-mode progress must not influence current-mode sorting.
- The catalog may show lightweight mode progress. Ordinary Library must not.
- Card activation is immediate; do not show a confirmation dialog.

### 2.4 Dictation progress

- A canonical `dictation` unit completes only at 100% correct.
- The material completes when every canonical Dictation unit completes.
- A checked result strictly greater than 50% saves correct and incorrect slot
  state. Exactly 50% does not qualify for persistence.
- A <=50% result must never erase a previously saved >50% snapshot.
- Correct saved slots remain correct/locked. Unresolved slots may show the
  latest qualifying wrong entry in red and remain editable.
- New edits save only after `Check`.
- Unchecked text cannot be scored or server-saved. Switching modes with
  unchecked text displays `Unchecked answers will not be saved.` and offers
  `Keep Practising` / `Switch Mode`.
- `Show Answer` becomes `Hide` while open. Focusing any answer slot hides the
  answer immediately.
- Only Dictation supports student Argue.

### 2.5 Shadowing progress and feedback

- Pass line is a server-configured product score of 80.
- Display one integer score, not provider metric clutter.
- Provider red/missing/misread evidence maps to red; a red word caps product
  score at 79.
- Yellow means close/unstable; yellow does not itself block an >=80 pass.
- Normal words have no coloured background.
- Red uses a solid underline and yellow a dotted underline so colour is not the
  only signal.
- Do not invent phoneme diagnoses or natural-language claims unsupported by the
  provider.
- Each segment keeps a monotonic historical Best Score.
- Latest valid Attempt owns latest word colours, latest feedback, and the
  browser-session replay, even if its score is below Best.
- Once qualified, a segment never becomes unqualified due to a later low take.
- Only the current take reaching 80 triggers automatic advance.
- Under 80: primary `Try Again`, secondary `Listen Again`; replay action is
  `Replay My Voice` and changes to `Stop Replay` while playing.
- Shadowing has no Argue and no teacher score override.

### 2.6 Shadowing transcript reveal

- Account default: reveal after three complete audible listens.
- Allowed preferences: 1, 2, 3, 5, or `off`.
- Put the ear/listen counter in the media area's top-right, not the global
  toolbar.
- Count a listen only after at least 90% of the canonical media range plays
  audibly. Seeking to the end or silent dubbing playback does not count.
- Preference follows the account across materials and devices.
- Per-unit complete-listen count and reveal state persist across sessions and
  devices. Cap the stored count at the effective threshold; do not create an
  unbounded counter.
- `off` disables automatic reveal but keeps `Show Script`.
- Manual reveal is always allowed.
- Recording preserves the current reveal state and never reveals by itself.
- A successful score response always reveals the reference and word feedback.

### 2.7 Auto-advance

- After a current take reaches 80, render the result immediately.
- Show a visible approximately 1.5-second depletion bar before advancing.
- Any pointer, touch, or keyboard activation in the page cancels auto-advance.
- The cancellation event is consumed and must not activate the underlying
  target. The next deliberate activation works normally.
- Reduced Motion keeps an accessible static 1.5-second wait with the same
  cancellation semantics; it removes the moving depletion animation.

### 2.8 Audio and video

- Material media may be audio or video.
- Dictation plays source picture and sound.
- Shadowing listening plays source picture and sound.
- During a take, video restarts at the unit start with source sound muted while
  the microphone records the student.
- If simultaneous muted video playback and microphone recording is not
  supported, fall back to a still video frame plus recording.
- A recording may stop at any time after the minimum valid duration. Do not
  compare student duration to source duration as a grading rule.
- Safety auto-stop is `sourceDuration * 1.8 + 3 seconds`, capped at the provider
  300-second hard limit.
- Trim long leading/trailing silence locally before upload while preserving a
  small boundary pad and all internal pauses.
- `Thinking` is the only student-visible scoring wait label.

### 2.9 Temporary recording lifecycle

- One latest replay Blob may exist per practised Shadowing unit in the current
  open-material browser session.
- Switching units or modes within the material keeps those replay Blobs.
- A new valid take replaces only that unit's prior replay Blob.
- Exit, refresh, logout, account switch, or tab close revokes every Blob URL.
- When replay Blobs exist, in-app exit warns:
  `Your practice progress is saved. Your recordings are not. If you leave now,
  you won't be able to replay them.`
- Server upload objects are deleted immediately after a conclusive provider
  result. Failed cleanup is scheduled for bounded maintenance retry.
- Raw audio is never returned in teacher email/report/calendar payloads.

### 2.10 Effective learning time

- Completion remains result-based. Time never passes a unit, earns STAR, ranks a
  learner, completes an Assignment, or creates a reward.
- Store canonical time in seconds; UI normally renders minutes and `<1 min`.
- A local second is eligible only while the document is visible/focused and at
  least one qualifying condition is active:
  - audible source media playback;
  - Dictation input/edit activity;
  - microphone recording/countdown;
  - replaying source or `Replay My Voice`;
  - an explicit result/answer/feedback review window;
  - meaningful scrolling, touch, click, key input, or debounced pointer motion.
- After 20 seconds without a qualifying continuous state or qualifying page
  activity, pause the local timer.
- Hidden document, lost focus, device lock, or logout pauses immediately.
- `Thinking`, network wait, permission wait, error-page dwell, menus/modals, and
  auto-advance countdown do not count.
- A feedback/answer reveal creates at most a 20-second review window unless the
  student interacts again.
- A pause shorter than three minutes can resume the same learning session.
- Three inactive minutes closes the session; the next activity creates a new
  session.
- Sessions are permanent. Content update/hide and progress recalculation never
  delete time.
- Do not backfill guessed time from the nine existing Dictation progress rows.

### 2.11 Achievement calendar

- Listening activity lights a Shanghai day only when that day's accepted total
  reaches at least 60 seconds.
- Aggregate same day + material + mode into one calendar row.
- Row title: material title.
- Row detail: `Listening · Dictation` or `Listening · Shadowing`.
- Row result at far right: formatted time such as `18 min`, replacing the
  ordinary percentage/PASS string.
- Do not show `Completed` in the calendar row.
- Keep current Completion in the Listening Catalog and practice page.
- Calendar activation deep-links to that material/mode and therefore updates
  the global account mode.

### 2.12 Teacher and Assignment boundary

- `IL-*`/Intensive Listening materials are self-study and never assignable.
- Teacher Assign hides them.
- `teacherAdmin.createAssignments` rejects them even if a forged/stale browser
  payload supplies an IL set ID.
- Ordinary BBC/IELTS listening-comprehension question sets remain assignable.
- Production audit on 2026-09-06 found zero IL Assignments, so no destructive
  production data deletion is required.
- Keep the teacher Listening authoring/preview surface.
- Teacher preview does not write student progress/time/notifications and does
  not expose recording or call Tencent. Provider calibration belongs to a
  separate owner-gated test flow, never the ordinary teacher preview.

### 2.13 Notifications and reports

- Self-study Dictation and Shadowing produce teacher bell/email session
  summaries.
- First effective media/practice movement starts the notification session and
  queues its immediate Started event.
- Continued progress inside three minutes does not create repeated mail.
- Three inactive minutes closes the session and sends the latest aggregate.
- Aggregate by material session, never by sentence.
- Safe summary may include effective seconds, mode, unit completion/qualification
  counts, and material progress; never transcript, typed answers, word evidence,
  or audio.
- Teacher student detail and weekly/monthly report inputs may show Listening
  effective time split by Dictation/Shadowing.
- Do not put time into class ranking or ordinary exercise completion counts.
- Published report snapshots remain immutable; late offline time stays in raw
  activity/calendar data but does not mutate a published report.
- Parent Mode does not expose Listening time in this release.

## 3. Existing-state audit and migration constraints

At plan creation:

- production has 22 `IL-*` sets;
- production has nine `intensive_listening_progress` records;
- none are 100% complete;
- production has zero `listening_shadowing_progress` rows;
- production has zero IL Assignments;
- current code contains dual explicit tracks, track Assignments, a material
  chooser, `EvalMode=1`, a 30-word guard, seven-day server take cleanup, and no
  Listening projection in `getDashboard.getAchievementCalendar`;
- the shared checkout is dirty with unrelated Writing, Speaking, My Words, and
  Argue changes.

Implementation safety rules:

1. Do not reset, clean, stash, discard, or mass-format the checkout.
2. Inspect `git diff -- <file>` immediately before editing every already-dirty
   file.
3. Preserve unrelated hunks verbatim.
4. Do not edit `.cloudbase-private/` source/import files unless a focused test
   fixture requires ignored output; canonical content changes are not needed
   for this code release.
5. Do not deploy, push, create collections/indexes, import data, or enable
   Tencent scoring.
6. Do not commit generated `dist/` or deployment ZIP output.

## 4. Target domain model

### 4.1 Canonical material schema

Use one canonical unit array. New saved/published material should normalize to:

```json
{
  "schema_version": 3,
  "material_id": "IL-BBC-260813",
  "set_id": "IL-BBC-260813",
  "content_revision": "...",
  "media": {
    "kind": "audio",
    "src": "..."
  },
  "units": [
    {
      "unit_id": "unit-06",
      "speaker": "Speaker 3",
      "text": "Reviewed canonical transcript.",
      "start_seconds": 13.219,
      "end_seconds": 22.099,
      "practice_mode": "dictation",
      "slots": []
    }
  ],
  "modes": {
    "dictation": { "enabled": true },
    "shadowing": { "enabled": true }
  }
}
```

Rules:

- `unit_id`, timing, speaker, text, and order are shared.
- `practice_mode=dictation` means a scored unit in both modes.
- legacy `listen_only` normalizes to `context_only`.
- `context_only` is playable in both modes but does not enter either Completion
  denominator.
- `skip` remains stored/auditable but is not presented as a student training
  step and does not count time.
- Dictation `slots` remain private.
- Shadowing reference words derive deterministically from canonical `text`.
- Maximum reference length is 120 English words. Reject empty or >120 scored
  units before publish and before a paid call.
- One `content_revision` scopes both current Dictation and Shadowing progress.
  Any change to canonical media, timing, text, mode, order, or slots generates a
  new revision for both modes.
- A metadata-only title/source-label change may keep the content revision.

Backward compatibility:

- Runtime normalizer accepts schema 1 legacy `units` and schema 2 explicit
  `tracks`.
- Prefer a non-empty canonical `units` array.
- For old schema 2 without `units`, use Dictation segments as canonical and
  derive Shadowing behaviour from them.
- Do not persist duplicate Shadowing text/segments on the next teacher save.
- A schema-only migration with identical canonical semantics must preserve the
  existing Dictation content version so the nine current progress records do
  not reset without a teacher content change.

### 4.2 Mode preference

Add a safe server-owned student profile field:

```text
students.listening_mode_preference: "dictation" | "shadowing"
```

- Default missing/invalid to `dictation`.
- Student-only authenticated action may update only this allowlisted field.
- Do not accept a student UID from the browser.
- Library/catalog/bootstrap responses may return the safe value.

### 4.3 Effective-time collection

Add ADMINONLY `learning_activity_sessions`. Keep it generic even though only
Listening writes in this release.

Canonical session document:

| Field | Type | Rule |
| --- | --- | --- |
| `session_id` | string | immutable idempotency key |
| `student_uid` | string | authenticated owner |
| `student_id_snapshot` | string | audit only |
| `activity_type` | string | `listening` in this release |
| `material_id` / `set_id` | string | authorized visible material |
| `practice_mode` | string | `dictation` or `shadowing` |
| `content_revision` | string | audit snapshot, not an aggregation partition |
| `status` | string | `active`, `paused`, `closed` |
| `started_at` | Date | server timestamp |
| `last_received_at` | Date | server timestamp |
| `last_effective_at` | Date | end of last accepted span |
| `closed_at` | Date/null | server timestamp |
| `close_reason` | string/null | bounded allowlist |
| `effective_seconds` | integer | accepted total |
| `daily_seconds` | object | Shanghai `YYYY-MM-DD -> integer` |
| `unit_ids` | string[] | bounded unique canonical IDs |
| `last_sequence` | integer | monotonic per browser session |
| `accepted_windows` | object[] | bounded start/end/seconds/day audit windows |
| `integrity_flags` | string[] | bounded server-owned flags |
| `notification_session_id` | string/null | safe link to existing notification lifecycle |

Use a deterministic lock document or transaction-protected lease keyed by
student UID so overlapping tabs/devices cannot accrue duplicate seconds. A new
valid holder closes or supersedes the old lease; stale senders receive a benign
`ACTIVITY_SESSION_SUPERSEDED` response and stop their timer.

Recommended indexes for owner review:

1. unique `session_id`;
2. `student_uid + started_at desc`;
3. `student_uid + status + last_effective_at desc`;
4. `student_uid + activity_type + started_at desc`;
5. `set_id + started_at desc` for bounded teacher/report aggregation.

Do not store keystrokes, pointer coordinates, transcript, answers, audio paths,
provider response, or IP/device fingerprints in this collection.

### 4.4 Activity acceptance contract

The browser samples locally with monotonic `performance.now()`. It sends bounded
spans, not a naked claim such as `effective_seconds: 3600`.

On the first eligible student interaction, the browser must complete a
`startLearningActivity` handshake before it submits the first span batch. This
anchors the server-observed elapsed window without counting passive page-open
time and prevents a genuine first 60-second batch from being clamped to the
transport-tolerance allowance.

Example request:

```json
{
  "action": "recordLearningActivity",
  "session_id": "activity-uuid",
  "sequence": 4,
  "mode": "shadowing",
  "spans": [
    {
      "client_start_ms": 120000,
      "client_end_ms": 128000,
      "effective_seconds": 8,
      "reason": "recording",
      "unit_id": "unit-06"
    }
  ]
}
```

Server validation:

- authenticate student and reload visible material;
- accept only allowlisted mode/reason/unit IDs;
- require a valid held lease/session ID;
- reject duplicate/out-of-order `sequence` without double-counting;
- cap one accepted span to 60 seconds and one flush to the server-observed
  elapsed window plus a small transport tolerance;
- clamp negative/future/non-finite values;
- split accepted seconds at Shanghai midnight;
- bound `unit_ids`, `accepted_windows`, and integrity flags;
- never trust a browser-supplied total or student identity;
- return accepted cumulative seconds and safe sync status.

Flush locally every 60 effective seconds and additionally on unit switch, mode
switch, visibility loss, Back, successful completion, logout, and `pagehide`.
Keep unsent batches in account-scoped durable browser storage with stable
session/sequence IDs. V1 may use `localStorage` because the queue is capped at
120 small transcript-free metadata spans; move to IndexedDB only if the payload
or retention requirement grows. Purge the prior account queue on logout/account
switch. Late upload is idempotent but subject to server caps; never fabricate
offline time that cannot be bounded. When the queue is full, stop local accrual
until a successful flush frees capacity rather than creating an unbounded claim.

## 5. Cloud function/API changes

### 5.1 `intensiveListening`

Add/refactor these authenticated actions:

- `listCatalog`: return `preferred_mode`, safe progress for both modes, and no
  Assignment lookup/projection.
- `setModePreference`: validate and update only the authenticated student's
  preference.
- `getTrack`/`bootstrap`: use canonical shared units and the account/default URL
  mode.
- `startLearningActivity`: reserve one active lease and create a session on the
  first actual eligible activity, not page open.
- `recordLearningActivity`: validate and append/merge bounded effective spans.
- `pauseLearningActivity`: flush and mark paused without closing if under the
  three-minute window.
- `closeLearningActivity`: idempotently close with a bounded reason.
- optional `getLearningActivitySummary`: safe current material/mode/session
  totals for the student progress sheet.

Remove or neutralize new-use Assignment branches:

- ignore/reject `assignment_id` for ordinary self-study entry;
- do not query Assignments in catalog;
- stop updating `listening_assignment_tracks`;
- retain narrow read compatibility only if needed to avoid breaking an old URL,
  but never permit creation of a new Listening Assignment.

### 5.2 Tencent adapter

In `cloudfunctions/intensiveListening/tencent-soe-n.js`:

- change signed query `eval_mode` from `1` to `2`;
- change reference validation from max 30 to max 120 words;
- bump provider revision/cache namespace so sentence-mode results are not
  silently reused as paragraph-mode results;
- keep `server_engine_type=16k_en`, non-streaming complete audio, private
  signing, final-result-only handling, bounded timeout, and fail-closed errors;
- continue normalizing overall and word-level evidence only;
- tests must assert `eval_mode=2` and the 120/121 boundary.

Do not enable `LISTENING_SHADOWING_SCORING_ENABLED` in code or configuration.
Real-audio benchmark approval remains a deployment gate.

### 5.3 Recording validation and cleanup

- Client converts to mono 16kHz 16-bit PCM WAV.
- Client removes only leading/trailing low-RMS silence and retains padding.
- Client/server minimum duration is at least two seconds after trimming.
- Server maximum duration is the canonical unit's dynamic safety cap and never
  above 300 seconds.
- Validate byte length, header, channels, rate, depth, duration, silence, and
  clipping before claiming paid usage.
- Continue one-in-flight take and stable client-take idempotency.
- Keep same-audio/reference/policy/provider duplicate cache.
- After final score or conclusive non-retryable result, delete provider upload
  immediately and clear `file_id/upload_path` from student-safe views.
- On cleanup failure, keep a private delete-pending locator for maintenance.
- Ambiguous post-send outcomes are never automatically re-sent.

### 5.4 Quotas

Implement/configure the approved guardrails:

- one in-flight take per student;
- at least the existing minimum interval between provider calls;
- maximum 20 valid scored calls per rolling five minutes;
- maximum 250 valid scored calls per Shanghai day per student;
- global daily and monthly server-configured caps;
- duplicate cached responses do not claim another billable usage row;
- budget/rate failures disable only new scoring, not Dictation/media playback.

Keep quotas server-side and record the actual billable boundary immediately
before the outbound call.

### 5.5 Teacher Admin

- Filter IL sets out of Assign candidates and selected-task parameters.
- Add a server rejection such as `LISTENING_NOT_ASSIGNABLE` before creating any
  Assignment row for an Intensive Listening set.
- Remove the Dictation/Shadowing Assignment checkbox controls and payload
  generation from `assets/js/teacher.js`.
- Keep ordinary listening-comprehension sets assignable.
- Refactor Listening authoring to canonical `units` with one editable source.
- Replace separate editable Dictation and Shadowing track tabs with one
  `Transcript & Units` editor plus `Dictation Preview` and `Shadowing Preview`.
- Validation covers media, ordered/non-overlapping valid ranges, non-empty
  canonical text, private Dictation answers, at least one scored unit, and <=120
  English reference words.
- Saving draft never mutates live material; publish remains optimistic and
  auditable.
- A canonical content change generates one new shared content revision and
  makes both current progress scopes recalculate.
- Metadata-only edits should not reset progress.

### 5.6 Achievement calendar and reports

Extend `getDashboard.getAchievementCalendar` to query bounded
`learning_activity_sessions` for the authenticated student and rolling window.
`buildAchievementCalendar` accepts `learningActivities=[]` and adds Listening
day rows without changing BBC/Vocabulary/Writing rules.

Safe Listening calendar item:

```json
{
  "achievement_key": "listening:2026-09-07:shadowing:IL-BBC-260813",
  "type": "listening",
  "date": "2026-09-07",
  "set_id": "IL-BBC-260813",
  "mode": "shadowing",
  "title": "Who Does the Housework?",
  "detail": "Listening · Shadowing",
  "result": "18 min",
  "effective_seconds": 1080,
  "open_href": "intensive-listening.html?set=IL-BBC-260813&mode=shadowing"
}
```

- Aggregate seconds before rendering.
- Exclude day totals below 60 seconds.
- Keep `<1 min` support for detail summaries outside the day-light threshold.
- Update dashboard renderer to use the server-provided safe result/open route;
  do not reinterpret Listening as PASS.
- Add teacher/report aggregation helpers that sum accepted session day buckets
  without exposing raw windows.
- Parent Mode remains unchanged.

### 5.7 Notifications/email

- Add `effective_seconds` and mode-safe summary fields to existing Listening
  session event builders.
- Start only on actual media/practice movement.
- Keep immediate Started plus three-minute idle closure semantics.
- Do not create one event per sentence or per provider take.
- Update email/bell copy to `Listening · Dictation` or
  `Listening · Shadowing` and show formatted effective time.
- Preserve recipient settings, BCC, muted-inbox behaviour, timer, and
  idempotency.

## 6. Frontend state machines

### 6.1 Library state

```text
auth-loading
  -> catalog-loading
  -> ready(mode=dictation|shadowing)
       -> mode-popover-open
       -> mode-switching
       -> ready(new mode)
  -> recoverable-error
```

- Render a server default only after authentication; a validated local cache may
  prevent visual flicker but must yield to server preference.
- Mode switch updates the button immediately, closes the anchored popover,
  cross-fades mode-specific progress, persists preference, and rolls back with
  a visible retry if persistence fails.
- Entire card opens with current mode and safe return route.

### 6.2 Practice parent controller

One parent controller owns:

- current mode;
- canonical units and per-mode progress;
- unit index;
- toolbar progress;
- mode popover;
- unsaved Dictation guard;
- Shadowing replay Blob map;
- activity tracker/session;
- exit warning and cleanup.

Do not let independent Dictation and Shadowing scripts race to hide/show shared
surfaces. Expose narrow mode-controller methods such as `enter`, `leave`,
`hasUnsavedWork`, `flush`, and `destroy`.

Mode switching:

1. Reject/disable while recording, upload, or `Thinking` is active.
2. If Dictation has unchecked input, show the approved warning.
3. Flush activity time and pause the old mode.
4. Preserve browser replay Blobs because the material session remains open.
5. Persist account preference.
6. Select destination's first incomplete/unqualified unit; if all complete,
   open the first unit for review.
7. Cross-fade the workspace without a full reload.

### 6.3 Dictation controller

- Preserve existing keyboard behaviour and private server grading.
- Add best-progress-merge persistence for >50% checked states if not already
  present.
- Hide answer on any slot focus/input.
- Unit navigation remains free; unsaved checked-state rules still apply.
- Mark activity for audible playback, input, review, scroll/touch, and explicit
  feedback interaction.

### 6.4 Shadowing controller

```text
ready-hidden|ready-revealed
  -> listening
  -> ready
  -> countdown
  -> recording
  -> preparing-audio
  -> uploading
  -> Thinking
  -> result-failed | result-under-80 | result-qualified
  -> auto-advance-pending
  -> next-unit | stayed
```

- Keep one active unit visually dominant.
- Adjacent context may be present at low contrast but must not expose a hidden
  transcript.
- `Thinking` and request state are live-region accessible but not noisy.
- Current score is visually primary immediately after a take; Best is secondary
  when different.
- Returning to a unit shows Best as persisted summary and labels word colours
  `Latest attempt feedback`.
- Replay buttons use the current session Blob map, never a server URL.
- An invalid take must not replace replay/feedback or count as an Attempt.
- On provider failure, retain current Blob for replay and an explicit manual
  retry path. Do not silently re-send an ambiguous request.

### 6.5 Effective-time client tracker

Create a reusable module, preferably `assets/js/learning-activity.js`, with no
Listening transcript or answer knowledge.

Required public API:

```js
tracker.configure({ activityType, materialId, mode, contentRevision });
tracker.markInteraction(reason, unitId);
tracker.setContinuous(reason, active, unitId);
tracker.flush(reason);
tracker.pause(reason);
tracker.close(reason);
tracker.summary();
```

Implementation rules:

- monotonic time only for local accumulation;
- one-second sampler or `requestAnimationFrame`-independent interval;
- `document.visibilityState`, focus/blur, pagehide, and online/offline handling;
- 20-second last-interaction expiry;
- continuous media/recording state overrides the interaction expiry only while
  genuinely active;
- pointer motion is distance-thresholded/debounced and cannot generate raw
  coordinate storage;
- `Thinking`, modal-open, and mode-popover state explicitly suspend eligibility;
- batch queue is bounded and account-scoped;
- every request is idempotent;
- UI uses server-accepted totals after sync, while clearly marking a temporary
  unsynced local increment if shown.

## 7. Visual design specification

The target feeling is calm, focused, and native to the existing Mr. Cat
Writing/Speaking surfaces. Do not invent a high-saturation game skin.

### 7.1 Reference tokens

Reuse or closely match the established Speaking values:

- system font stack with optical sizing;
- ink around `#172126`;
- muted text around `#65747c`;
- pale page background around `#f5f9f8` with very low-opacity ambient teal,
  blue, and warm radial fields;
- glass around `rgba(251,253,253,.76)`;
- hairlines around `rgba(74,95,106,.13)`;
- large glass shadow comparable to `0 24px 64px rgba(45,67,78,.12)`;
- small card shadow comparable to `0 12px 34px rgba(45,67,78,.09)`;
- Listening may keep restrained teal identity, but accent colour belongs on
  progress, selected state, and primary action—not every card background.

### 7.2 Geometry and typography

- Toolbar geometry matches Speaking: 44px circular controls, approximately
  76px total height, 22px floating-glass radius, safe-area spacing.
- Main content max width approximately 1080px; readable text columns stay much
  narrower.
- Primary panels 24–30px radius; compact controls 12–15px radius.
- Touch targets minimum 44x44px.
- Large headings use tight negative tracking; body text uses comfortable line
  height and near-zero tracking.
- No black page background. Video itself may use a dark letterbox only inside
  its bounded media frame.
- Avoid stacked translucent layers. A popover floats over a solid/stronger
  material rather than glass-on-glass blur soup.

### 7.3 Interaction and motion

- Immediate pressed feedback (`scale(.96-.98)`) starts on pointer down/`:active`.
- Popover materializes from its trigger with transform origin anchored to the
  button; exit follows the same path.
- Ordinary transitions are critically damped/no overshoot, roughly 300–400ms
  response. Do not add bounce without a momentum gesture.
- Mode content uses a small opacity/transform cross-fade and remains
  interruptible except during the explicitly locked recording/provider state.
- Auto-advance depletion is a status countdown, not decorative motion.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, and
  `prefers-contrast` all receive explicit styles.

### 7.4 Responsive contracts

- Validate at 1440, 1024, 768, and 390 CSS pixels.
- Desktop/tablet may show complete text labels.
- Phone uses one column and keeps primary actions above the bottom safe area.
- Long mode/material names truncate or gently scroll only when genuinely
  overflowing; Reduced Motion keeps a static readable fallback.
- Video preserves aspect ratio and does not crop source subtitles.
- On-screen keyboard must not cover the active Dictation slot/action.
- Use Wake Lock only while actively recording when supported; release on stop,
  pause, hidden page, and teardown.

### 7.5 Accessibility

- Semantic buttons, progressbar values, menu/menuitem or equivalent accessible
  popover roles, focus restoration, Escape dismissal, and visible focus rings.
- Red/yellow word status has underline/pattern and accessible label.
- Live regions announce recording start/stop, Thinking, score/error, and
  auto-advance cancellation without repeating the whole transcript.
- Any-click auto-advance cancellation includes keyboard input and consumes only
  the cancellation event.
- Modal scroll lock restores exact scroll position and focus.

## 8. Exact file-level work map

The implementation agent must verify the map against current code and add only
necessary files.

### Student HTML/CSS/JS

- `intensive-listening-library.html`
  - replace static centred Listening title with mode selector/popover markup;
  - keep auth/loading/error semantics;
  - add accessible menu and safe status region.
- `assets/js/intensive-listening-library.js`
  - server-backed mode state;
  - mode-specific progress/sort/card status;
  - whole-card navigation with `mode` and safe `return`;
  - remove Assignment projection.
- `assets/css/intensive-listening-library.css`
  - align toolbar/cards with Speaking/Writing tokens;
  - anchored popover, mode cross-fade, responsive/reduced preferences.
- `intensive-listening.html`
  - remove track chooser and large duplicate mode headings;
  - install practice toolbar progress + right mode button/popover;
  - add activity time/progress sheet, Shadowing result/auto-advance UI, and
    replay-aware leave copy;
  - preserve Dictation Argue markup only.
- `assets/js/intensive-listening.js`
  - adapt Dictation into parent mode-controller contract;
  - implement >50% persistence/merge if missing;
  - Show/Hide and focus-to-hide;
  - integrate tracker markers and guarded switching.
- `assets/js/listening-shadowing.js`
  - one-unit game loop, shared canonical units, reveal counter, countdown,
    recording, silence trim, replay map, Thinking/result states, cancellable
    auto-advance, dynamic recording cap, video fallback.
- `assets/js/learning-activity.js` (new if no reusable module exists)
  - generic tracker and bounded sync queue.
- `assets/css/intensive-listening.css`
- `assets/css/listening-shadowing.css`
  - consolidate duplicated visual primitives where practical;
  - implement approved Apple-style layout and accessibility states.
- `dashboard.html`, `assets/js/dashboard.js`, `assets/css/app.css`
  - calendar Listening time row and route;
  - preserve unrelated dirty hunks exactly.

### Teacher

- `teacher.html`
  - one canonical Listening editor; two previews, not two editable text tracks.
- `assets/js/teacher-listening.js`
  - canonical units draft/validation/publish payload.
- `assets/js/teacher.js`
  - remove IL Assign candidates/track parameter controls and payloads.
- existing teacher CSS location(s)
  - style only the changed authoring structure using existing teacher language.

### Backend/shared

- `cloudfunctions/intensiveListening/index.js`
  - canonical schema, preference, time APIs, no Assignment updates, activity
    summaries, new recording limits, immediate cleanup.
- `cloudfunctions/intensiveListening/shadowing-service.js`
  - shared-unit normalization; latest-vs-best semantics; max120 validation.
- `cloudfunctions/intensiveListening/tencent-soe-n.js`
  - EvalMode 2/provider revision/120 boundary.
- `cloudfunctions/_shared/intensive-listening-notifications.js`
  - time-safe session projection.
- `cloudfunctions/sendTeacherAttemptEmails/index.js`
  - close idle activity/notification sessions and render safe time summary.
- `cloudfunctions/teacherAdmin/index.js`
  - no IL Assignments; canonical teacher authoring; teacher time summaries.
- `cloudfunctions/getDashboard/index.js`
- `cloudfunctions/getDashboard/achievement-calendar.js`
  - authenticated bounded time query and calendar aggregation.
- `cloudfunctions/learningReports/index.js` and report rule helpers only if
  required for the approved personal time summary; do not change rankings.

### Import/build/docs/tests

- source/import normalization scripts that currently emit duplicate tracks;
- `package.json` only for new focused test scripts—no new runtime dependency
  unless unavoidable and recorded;
- update Docs 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, and 11 according to
  `AGENTS.md`;
- keep Plans 16 and 19 historical and add a superseded note/link if useful;
- update README's Listening summary and test command list.

## 9. Implementation sequence

Do not attempt a single unreviewable rewrite. Use these slices in order.

### Slice A — Pure domain contracts and tests

1. Add canonical schema v3 normalization tests.
2. Prove schema 1 and schema 2 compatibility.
3. Prove Dictation/Shadowing unit IDs/timing/text are identical.
4. Change Tencent adapter tests to EvalMode 2 and 120/121 boundaries.
5. Add effective-time pure aggregation/Shanghai split/idempotency tests.
6. Add calendar Listening-time projection tests.

Exit gate: focused pure tests pass before UI/controller changes.

### Slice B — Backend APIs and safety

1. Implement preference read/write.
2. Implement activity session/lease/flush/close APIs.
3. Remove Assignment catalog/update paths and add create rejection.
4. Switch provider mode/revision/limits.
5. Implement dynamic WAV duration checks and immediate cleanup.
6. Extend notification safe summaries.

Exit gate: forged identity/mode/unit/time/assignment requests fail server-side;
all failure paths remain fail-closed.

### Slice C — Library mode-first experience

1. Replace toolbar title with anchored selector.
2. Remove intermediate chooser dependency.
3. Render mode-specific card state/sorting.
4. Preserve safe return/deep-link/login behaviour.
5. Match Speaking/Writing visual tokens and responsive states.

Exit gate: catalog works in both modes without opening a material and has no IL
Assignment affordance.

### Slice D — Practice parent + Dictation

1. Establish one parent controller and toolbar contract.
2. Adapt Dictation without regressing keyboard/check/Argue behaviour.
3. Implement mode guard and destination first-incomplete selection.
4. Integrate activity tracker.
5. Implement unit progress sheet.

Exit gate: all existing Dictation focused tests plus new persistence/switch/time
tests pass.

### Slice E — Shadowing game loop

1. Implement reveal counter and account preference.
2. Implement video/listen/countdown/record/trim/upload/Thinking/result states.
3. Implement latest-vs-best display and per-unit replay map.
4. Implement 1.5-second cancellable advance.
5. Implement errors, quotas, offline state, and cleanup.
6. Complete mobile/Reduced Motion/contrast styling.

Exit gate: no paid provider call can be reached by invalid audio, unauthorized
unit, duplicate in-flight take, or unavailable policy.

### Slice F — Calendar, teacher, reports, documentation

1. Calendar day aggregation and time rows.
2. Teacher detail/report safe aggregates.
3. Canonical one-source authoring UI.
4. Remove Assign UI/server ability.
5. Update all required docs and release checklist.

Exit gate: the full release verifier and all focused/regression tests pass.

## 10. Automated test matrix

Extend existing focused scripts or add narrowly named scripts. At minimum test:

### Canonical content

- legacy units normalize to both modes with identical IDs/timing/text;
- explicit old tracks normalize through canonical Dictation source;
- context-only and skip denominators;
- 120 words accepted, 121 rejected;
- shared content change changes both current progress revisions;
- metadata-only change preserves revision;
- schema-only equivalent migration preserves existing Dictation progress scope.

### Mode preference and catalog

- missing preference defaults Dictation;
- only authenticated owner may set mode;
- invalid mode rejected/ignored safely;
- catalog sorting/progress changes by mode;
- ordinary Library progress remains unchanged;
- safe deep link and return validation;
- no Assignment query/projection and no IL Assign candidate.

### Dictation

- >50 persists; 50 and below do not replace;
- correct slot merge is monotonic;
- wrong qualifying draft remains editable;
- unchecked mode switch warning;
- answer opens as Hide and slot focus hides it;
- Argue remains Dictation-only.

### Shadowing

- EvalMode 2 signed query;
- provider cache revision prevents old result reuse;
- red cap 79, yellow may pass, server precise threshold before integer display;
- latest feedback/Blob semantics separated from Best;
- qualified state monotonic;
- current <80 never auto-advances despite historical Best >=80;
- 90% complete audible listen tokens and reveal preference persistence;
- scoring reveals transcript;
- invalid/silent/short/clipped/too-long audio rejected pre-provider;
- dynamic recording limit;
- duplicate take cache; single in-flight lock; quotas/global budgets;
- immediate storage deletion and cleanup retry;
- no Shadowing Argue.

### Effective time

- eligible continuous states count;
- 20-second inactivity pauses;
- hidden/blurred page pauses immediately;
- Thinking/modal/permission/network/auto-advance do not count;
- feedback review capped at 20 seconds unless reactivated;
- three-minute session close/resume boundary;
- 60-second batching and duplicate/out-of-order sequence idempotency;
- forged totals/future spans rejected/clamped;
- one active lease prevents overlap;
- Shanghai midnight split;
- logout/account switch purges local owner queue;
- material update/hide does not delete sessions;
- no historical time backfill.

### Calendar/reports/notifications

- under60-second day excluded;
- same day/material/mode aggregated;
- different modes remain separate rows;
- right result is minutes, not PASS/Completed;
- click route contains safe set/mode;
- Started + three-minute close aggregation, never per segment;
- safe mail/bell payload excludes transcript/answers/audio/word evidence;
- report time does not alter ranking/completion;
- published snapshots immutable; Parent Mode unchanged.

### Assignment boundary

- Teacher Assign does not render IL candidates;
- forged `createAssignments` with `IL-*` is rejected before any write;
- BBC/IELTS comprehension sets still assign normally;
- no deletion/mutation of nine existing self-study progress rows.

## 11. Commands and verification

Run targeted tests first, then broader release checks. Expected baseline commands:

```bash
npm run test:intensive-listening
npm run test:intensive-listening-library
npm run test:listening-shadowing
npm run test:listening-shadowing-provider
npm run test:listening-authoring
npm run test:assignment-schedule
npm run test:learning-reports
npm run test:attempt-emails
npm run verify:release
npm run build:static
git diff --check
```

Add a focused effective-time test command if the logic is not naturally covered
by the current scripts, for example `test:listening-activity`.

Package verification may run locally after tests:

```bash
npm run package:functions -- getDashboard intensiveListening teacherAdmin sendTeacherAttemptEmails learningReports
npm run release:plan
```

Packaging and a deploy plan are not deployment authorization.

## 12. Manual browser and device QA

Use a local HTTP server, never `file://`.

For 1440, 1024, 768, and 390 widths verify:

1. Library and practice toolbar geometry aligns with Speaking.
2. Background stays light; cards are restrained and readable.
3. Mode popover originates at the trigger, restores focus, and closes by
   outside press/Escape.
4. Mode switch changes every subsequent material action.
5. Practice switch chooses destination first incomplete/unqualified unit.
6. Dictation warning, Show/Hide, slot focus, keyboard, and Argue.
7. Shadowing reveal count, video mute during take, manual early stop, replay,
   Thinking, under80 retry, >=80 countdown, and cancel-anywhere consumption.
8. Exit warning appears only when replay Blobs exist.
9. Permission denial, offline, provider disabled, quota, unknown outcome, and
   cleanup failure all show truthful recovery UI.
10. Activity timer pauses after 20 seconds of genuine inactivity and immediately
    on backgrounding; scrolling/typing/playback resumes it.
11. Calendar row shows `n min`, not PASS or Completed.
12. Teacher editor changes one canonical transcript and previews both modes.
13. Teacher Assign contains no IL material.
14. Reduced Motion/Transparency/Contrast and keyboard-only operation.
15. Dynamic text size and phone keyboard do not hide the active control.

Real-device owner-gated acceptance before enabling provider scoring:

- current iPad/iPhone Safari;
- current desktop Chrome/Safari;
- WeChat in-app browser if students use it;
- real Tencent paragraph-mode calls using anonymized strong/medium/weak samples,
  including 40–48-word units;
- validate score distribution, red/yellow words, response time, call count, and
  cost;
- calibrate policy but keep visible pass line 80;
- delete benchmark audio afterwards.

## 13. Deployment/data plan (owner-gated)

Do not execute this section without a new explicit owner authorization for the
exact production actions.

1. Review the final diff and confirm unrelated dirty work is absent from the
   release patch.
2. Create `learning_activity_sessions` as ADMINONLY.
3. Create and verify the reviewed indexes.
4. Deploy backend readers before static UI only if old static remains compatible;
   otherwise use the coordinated order below.
5. Recommended coordinated order:
   - teacherAdmin Assignment rejection and authoring compatibility;
   - intensiveListening canonical/preference/activity/provider-disabled APIs;
   - getDashboard/report/email readers;
   - static Library/practice/dashboard/teacher files;
   - sendTeacherAttemptEmails/report functions;
   - content schema import only if actually required after dry-run.
6. Keep Shadowing scoring fail-closed during structural rollout.
7. Smoke-test Dictation, preference, time session, calendar, teacher authoring,
   and forged IL Assignment rejection.
8. Run real Tencent paragraph-mode benchmark and owner review.
9. Only then approve/configure the score policy and enable scoring.
10. Verify CloudBase function runtime, timeout, triggers, environment variables,
    permissions, collection security, and static hashes after release.

No historical effective-time backfill runs. No IL Assignment deletion runs.

## 14. Rollback strategy

- Static rollback: restore prior Library/practice/dashboard assets while leaving
  additive activity data untouched.
- Backend rollback: keep schema-v3 normalizer backward compatible so an earlier
  material remains readable; do not delete new collections during rollback.
- Provider rollback: set scoring disabled; never switch silently back to
  sentence mode under the same provider/cache revision.
- Activity rollback: stop new writes but retain accepted sessions. Calendar and
  report readers must tolerate the collection being absent during staged
  rollout.
- Assignment rejection is intentionally sticky: do not re-enable IL Assignments
  as a rollback shortcut.

## 15. Definition of done

Implementation is complete only when all statements are true:

- mode is chosen at the Library top and controls every material;
- no intermediate chooser remains;
- practice toolbar is Back / progress / mode;
- Dictation and Shadowing derive from one canonical teacher-reviewed unit list;
- Tencent adapter uses paragraph mode and max120 validation;
- approved Shadowing scoring/latest/Best/reveal/replay/advance rules pass tests;
- effective time follows the 20-second/three-minute rules, is idempotent,
  server-bounded, permanent, and queryable;
- calendar rows show daily mode/material minutes without PASS/Completed;
- Teacher Assign cannot show or create IL Assignments;
- teacher authoring edits one source and previews both modes;
- existing nine Dictation records remain intact and no fake historical time is
  created;
- UI matches current Writing/Speaking light Apple-style language at all required
  widths and accessibility preferences;
- private transcript, answers, provider evidence, credentials, and audio do not
  cross their existing boundaries;
- focused tests, regressions, release verification, static build, and diff check
  pass;
- documentation is updated;
- no deployment/push/provider enablement occurs without explicit owner approval.
