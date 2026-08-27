# Intensive Listening Library — Detailed Engineering Implementation Plan

> Status: product design approved on 2026-08-27; implementation-ready local
> plan.
>
> Audience: coding agents, including lower-capability agents. Follow the frozen
> decisions, schemas, state transitions, file boundaries, and test gates in this
> document exactly. Do not reinterpret the product design while implementing.
>
> Deployment status: local implementation only. Creating or changing CloudBase
> indexes, uploading functions, importing production data, changing timers, or
> publishing the static site remains owner-gated.

## 0. Executor protocol

### 0.1 Read before editing

Read these files in order before touching source code:

1. `AGENTS.md`
2. `README.md`
3. `CONTEXT.md`
4. `docs/01_PRODUCT_REQUIREMENTS.md`
5. `docs/02_ARCHITECTURE.md`
6. `docs/03_UI_UX_SPEC.md`
7. `docs/04_DATA_MODEL.md`
8. `docs/09_CONTENT_WORKFLOW.md`
9. `docs/10_DEPLOYMENT.md`
10. `docs/11_AGENT_TROUBLESHOOTING.md`
11. `docs/adr/0001-private-server-checks-for-intensive-listening.md`
12. this plan
13. the current source files listed in section 18

Do not rely on an older description that says the BBC lesson capsule is the
only student-facing Intensive Listening entry. This approved plan replaces that
rule with a dedicated authenticated Intensive Listening Library while retaining
the direct BBC/IELTS links.

### 0.2 Dirty-worktree rule

The repository is intentionally dirty. A separate in-progress DSE Speaking Lab
implementation already overlaps these files:

- `dashboard.html`
- `assets/js/teacher.js`
- `teacher.html`
- `README.md`
- `AGENTS.md`
- numbered documentation files
- `package.json`

Before editing, run:

```bash
git status --short --branch
git diff -- dashboard.html assets/css/app.css package.json
```

Preserve every unrelated existing change. Do not reset, checkout, overwrite, or
reformat entire overlapping files. Patch the current working-tree version in
place. The new dashboard design must include the existing Speaking Lab entry;
it must not revert it.

### 0.3 Baseline commands

Run these before editing and record any pre-existing failure in `AGENT_TODO.md`
without broadening scope to repair unrelated work:

```bash
npm run test:intensive-listening
npm run test:attempt-emails
npm run test:assignment-schedule
npm run test:learning-reports
npm run test:speaking-lab
git diff --check
```

Run `npm run verify:release` if the current dirty Speaking Lab work already
passes its narrower tests. If it fails for a known unrelated unfinished file,
record that baseline and continue only with focused checks.

### 0.4 Hard rules

- Do not deploy anything.
- Do not log in to CloudBase or mutate production/development resources.
- Do not create collections or indexes through the CLI.
- Do not print or commit SMTP credentials, timer tokens, student credentials,
  private transcript text, accepted answers, or full student word entries.
- Keep all Intensive Listening and teacher-email collections `ADMINONLY`.
- Derive student and teacher identity from authenticated server context.
- Treat `assignment_id`, `set_id`, material IDs, and return URLs only as
  locators; authorize them server-side.
- Use top-level CloudBase records. Never write `add({ data: row })`.
- Do not create synthetic `attempts` rows for Intensive Listening sessions.
- Do not expose `content_version` as a product version. It may remain an
  internal compatibility generation only.
- Do not add a frontend framework or new runtime dependency.
- Email and bell failures must never fail playback, Check, Show Answer, progress
  saving, or assignment synchronization.
- Update cache-busting query strings and `assets/js/config.public.js` only after
  the implementation is stable; preserve concurrent version changes.

## 1. Product outcome

The authenticated Student Dashboard contains three full-width, vertically
stacked, equal-size learning capsules: Writing, Intensive Listening, and
Speaking. Intensive Listening opens a dedicated authenticated library that
lists every available `IL-*` material, joins the current student's safe
progress, and supports Continue, source filtering, search, sorting, Review, and
optional navigation to one linked listening-comprehension exercise.

BBC and IELTS exercises retain direct Intensive Listening entry points. The
ordinary Student and Teacher Libraries must not show standalone `IL-*` cards.
Teacher Assign continues to show assignable Intensive Listening sets.

Student audio activity creates private teacher learning-session notifications.
The first real audio playhead movement starts a session and queues an immediate
Started email. Continued activity rolls a three-minute inactivity deadline.
Three minutes without activity closes the session and queues a Paused summary;
reaching the applicable target closes it immediately as Completed. The Teacher
bell displays these events in the same activity surface without pretending that
they are immutable graded attempts.

## 2. Frozen product decisions

Do not reopen these decisions during implementation.

### 2.1 Dashboard capsules

1. Desktop uses three full-width horizontal capsules stacked vertically, not a
   three-column grid.
2. Mobile also stacks the same three capsules.
3. Order is Writing, Intensive Listening, Speaking.
4. No pictographic pen, headphone, or speaking icons appear.
5. The first visual element is an unboxed Chinese character aligned to the
   capsule's left padding and top-aligned with the English title:
   - `写` for Writing;
   - `听` for Intensive Listening;
   - `说` for Speaking.
6. The character is not centered in an icon tile and has no rounded icon
   background.
7. Titles and copy are exactly:
   - `WRITING` — `Upload a composition, strengthen your ideas, and improve your language.`
   - `INTENSIVE LISTENING` — `Catch every word, complete the transcript, and sharpen your listening.`
   - `SPEAKING` — `Record a discussion, review your performance, and speak with confidence.`
8. All three capsules keep equal structure, height, spacing, focus behavior,
   reduced-motion behavior, and right arrow.

### 2.2 Library and content relationships

1. Intensive Listening is an independent first-level student workspace.
2. The dedicated library is authenticated and is not an ordinary Library tab.
3. All currently available BBC Intensive Listening materials appear there when
   both their visible set and live CloudBase material exist.
4. Future BBC, IELTS, and stand-alone listening material uses the same library.
5. One audio maps to one Intensive Listening material.
6. One Intensive Listening material maps to zero or one primary comprehension
   exercise. Do not build a multi-practice picker.
7. A comprehension exercise may aggregate multiple audio/section units, but
   each audio/section still has at most one Intensive Listening material.
8. BBC cards may link directly to their single Intensive Listening material.
9. IELTS exposes the link inside the current Section page. There is no
   four-Section intermediate selector.
10. Ordinary Student and Teacher Libraries show no standalone `IL-*` cards.
11. Teacher Assign still shows assignable `IL-*` sets.
12. Removing or correcting a link never deletes either side's data.

### 2.3 Progress, assignments, and updates

1. Intensive Listening percentage means Completion, not answer accuracy.
2. Only `dictation` units are in the denominator. `listen_only` and `skip` are
   visible in sequence but do not count.
3. Independent and assisted completions are stored and displayed separately;
   both count toward Completion.
4. Assignment target defaults to 100 and maps to
   `assignments.passing_percentage` for compatibility.
5. Intensive Listening assignments always have `mastery_enabled: false`; they
   cannot Earn STAR.
6. Unassigned self-study progress stays in the Intensive Listening Library and
   does not create a Student Dashboard Finished item.
7. Assigned progress appears in normal To Do/Finished surfaces.
8. Every entry point shares the same current progress for a student/material.
9. Intensive Listening does not create BBC-style Attempt No. history.
10. Completed students may start a temporary Review. Review cannot lower the
    permanent record or reopen a finished assignment.
11. A learning-content update replaces the material in place. Students never
    see editions or versions.
12. Internally, a changed transcript/unit structure must use a new compatibility
    generation so current progress is recalculated entirely against the new
    material. Old records may remain private audit data but are not joined into
    current progress.
13. A previously finished assignment never moves backward after a material
    replacement.

### 2.4 Access and navigation

1. The complete library requires an active authenticated student.
2. A direct public BBC/eligible IELTS Intensive Listening URL may retain
   Visitor Listen Only, but Visitor receives no private boundaries, word slots,
   answers, progress, Show Answer, Check, or Argue.
3. Login returns to the exact material.
4. Opening from the dedicated library returns to the library.
5. Opening from BBC/IELTS returns to the exact source exercise and IELTS Section
   context.
6. Opening from an Assignment preserves `assignment_id` and displays Due week
   plus Completion target.
7. The material header and completion screen show `Listening Practice` only
   when the linked exercise is currently visible and authorized.
8. Unchecked local draft words survive a round trip to the linked exercise.

### 2.5 Teacher behavior

1. Teacher preview may Show Answer immediately without three student Checks.
2. In teacher preview, selecting an answer word opens one compact global-impact
   confirmation. Confirming immediately makes it a Provided Word.
3. A teacher-preview approval never creates a pending teacher dispute and never
   requires returning to the main Argue queue.
4. The direct change still appends an immutable grading-rule audit record.
5. Student spelling-exemption requests continue to enter the Teacher Argue
   queue and retain Reject/Approve behavior.
6. Materials are hidden, never hard-deleted, when withdrawn.

### 2.6 Learning-session notifications

1. Both self-study and assigned Intensive Listening sessions create Teacher
   bell events and teacher emails.
2. Merely opening the page, loading audio, or clicking Start does not begin a
   notification session.
3. The first actual movement of the audio playhead begins the session. This is
   audio playback position, not the Completion progress element.
4. A Started event is queued immediately even when Completion is 0%.
5. Check is not required to start a session.
6. While a session is active, real playback movement, replay, deliberate seek,
   unit navigation, effective Check, Show Answer, or unit completion refreshes
   the last-active time. Idle page presence and ineffective repeated controls do
   not refresh it.
7. Three rolling minutes without activity closes the session as Paused and
   queues the latest summary.
8. Reaching 100% for self-study/Review or the current Assignment Completion
   target closes the session immediately as Completed.
9. Activity after closure creates a new session and another Started event.
10. One student/material has at most one active session across browser tabs.
11. Different materials have independent sessions.
12. Review follows the same rules and is clearly labelled `Review`.
13. Each session owns at most one Started event and one Paused/Completed event.
14. Visitor, Teacher preview, and Parent Mode never create learning sessions.
15. Events and emails never include typed words, answer text, word-level marks,
    private audio URLs, or Argue data.

## 3. Explicit non-goals

Do not add these features:

- a public browseable Intensive Listening catalog;
- a normal Library Intensive Listening tab;
- standalone `IL-*` cards in Teacher Library;
- a four-Section IELTS Intensive Listening picker;
- multiple linked comprehension exercises per material;
- Intensive Listening STAR/mastery rewards;
- immutable question-level Attempt history for Intensive Listening;
- public transcript or answer JSON;
- phone-specific custom keyboard work beyond responsive support;
- teacher browser authoring for whole transcripts/segment boundaries;
- hard deletion of materials or history;
- a new email timer or new SMTP secret set when the existing one-minute
  `sendTeacherAttemptEmails` dispatcher can be safely extended;
- production deployment or data migration during this implementation.

## 4. Architecture overview

Use the existing static frontend plus CloudBase pattern:

```text
Dashboard capsule
    -> intensive-listening-library.html
        -> intensiveListening(action=listCatalog)
            -> visible sets + visible live materials
            -> current-version student progress
            -> open assignment context
        -> intensive-listening.html?set=...&return=...
            -> existing private bootstrap/check/reveal/replay
            -> activity heartbeat after audio currentTime advances
                -> current progress session metadata
                -> idempotent Started outbox event

one-minute sendTeacherAttemptEmails timer
    -> close active progress sessions idle for >= 3 minutes
    -> create idempotent Paused outbox event
    -> claim due Started/Paused/Completed events
    -> send private teacher BCC email

Teacher bell
    -> normal Attempts from attempts
    -> Intensive Listening summaries from IL-mode email outbox events
    -> one mixed, paginated, newest-first feed
```

Do not create synthetic Attempt documents. Reuse
`teacher_attempt_email_events` as the durable IL event/outbox source by adding
an explicit `event_kind` and IL-safe summary fields. Existing BBC/Vocabulary
rows remain valid with `event_kind` absent or `attempt`.

The active session state belongs on the current
`intensive_listening_progress` document. This gives one stable current session
per student/material generation without adding a browser-readable collection.
Completed session events live durably in the outbox and may be rendered in the
Teacher bell even when email delivery is skipped or fails.

## 5. Canonical identifiers and relationships

### 5.1 Material identity

- `set_id`: public product identity such as `IL-BBC-260813`.
- `material_id`: normally the same stable identity.
- `content_version`: private/internal compatibility generation. Never render it
  in library cards, URLs, headings, emails, reports, or Teacher summaries.
- `source_set_id`: source audio/exercise unit such as `BBC-260813` or
  `C20-T1-S1`.
- `linked_practice_set_id`: optional explicit primary exercise link. Fall back
  to `source_set_id` only when that set exists and is a listening exercise.

### 5.2 Activity thread identity

Use the existing grouping rule:

```text
assigned:   <student_uid>::assignment::<assignment_id>
self-study: <student_uid>::self-study::<set_id>
review:     <student_uid>::self-study::<set_id>
```

Review uses the self-study thread but every event contains
`practice_context: "review"`.

### 5.3 Session identity

Create an unguessable server ID when a new session starts:

```text
ils_<24 random hex characters>
```

Event IDs are deterministic from the session:

```text
<session_id>::started
<session_id>::final
```

Create these documents with `doc(event_id).create(...)`. If the create reports
that the row already exists, treat it as idempotent success. Never use `set` to
overwrite a sent event.

## 6. Data model changes

### 6.1 `sets` additions for Intensive Listening

The importer and preparation scripts should populate these safe top-level
fields for `section_id: "intensive-listening"`:

| Field | Type | Rule |
| --- | --- | --- |
| `source_family` | string | normalized `bbc`, `ielts`, or future stable key |
| `source_label` | string | student label such as `BBC` or `IELTS` |
| `series_label` | string | e.g. `BBC 6 Minute English` |
| `published_on` | string | `YYYY-MM-DD` when known |
| `source_set_id` | string | source audio/exercise unit |
| `linked_practice_set_id` | string/null | zero-or-one exercise link |
| `dictation_unit_count` | number | safe count only |
| `sequence_unit_count` | number | safe total segment count |
| `mastery_enabled` | boolean | always `false` for IL sets |

Keep `passing_percentage: 100` as the default Completion target. Do not expose
private text in these rows.

For linked practice sets, add the safe inverse field:

| Field | Type | Rule |
| --- | --- | --- |
| `intensive_listening_set_id` | string/null | one linked IL material for this audio/Section |

Static runtime JSON keeps the existing camelCase
`intensiveListeningSetId` convention.

### 6.2 `intensive_listening_materials` additions

Store the same source/link metadata on the private live material so catalog
listing does not depend on static files:

```text
source_family
source_label
series_label
published_on
source_set_id
linked_practice_set_id
```

Existing BBC rows missing the new fields must remain readable. Derive BBC
fallbacks from `source_set_id`/`IL-BBC-YYMMDD` and derive the date as
`20YY-MM-DD`. Do not require a destructive production rewrite for the first
code rollout.

### 6.3 `intensive_listening_progress` session fields

Add only server-written fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `notification_session_id` | string/null | active or most recently closed session |
| `notification_session_status` | string | `active`, `paused`, or `completed` |
| `notification_practice_context` | string | `self_study`, `assignment`, or `review` |
| `notification_assignment_id` | string/null | authorized session assignment snapshot |
| `notification_target_percentage` | number | 100 or authorized assignment target |
| `notification_session_started_at` | Date | server start time |
| `notification_last_active_at` | Date | last accepted activity |
| `notification_session_due_at` | Date/null | active inactivity deadline |
| `notification_start_percentage` | number | current/replay Completion at start |
| `notification_start_completed_count` | number | count at start |
| `notification_latest_percentage` | number | latest safe summary |
| `notification_latest_completed_count` | number | latest total completed |
| `notification_latest_independent_count` | number | latest independent total |
| `notification_latest_assisted_count` | number | latest assisted total |
| `notification_closed_at` | Date/null | server close time |
| `notification_close_reason` | string/null | `idle` or `target_met` |

Do not store typed entries or audio URLs in these fields.

Recommended owner-gated index:

```text
notification_session_status ASC, notification_session_due_at ASC
```

The implementation must remain correct with a bounded fallback scan if the
development index has not yet been created; deployment documentation must make
the index a release prerequisite before enabling production session email.

### 6.4 `teacher_attempt_email_events` extensions

Existing attempt rows remain unchanged. Add these IL event fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `event_kind` | string | `intensive_listening_session` for IL rows |
| `session_id` | string | source IL session |
| `session_phase` | string | `started`, `paused`, or `completed` |
| `practice_context` | string | self-study, assignment, or review |
| `occurred_at` | Date | bell/email ordering time |
| `session_started_at` | Date | start snapshot |
| `session_ended_at` | Date/null | final snapshot |
| `session_duration_seconds` | number/null | final duration |
| `start_percentage` | number | Completion when session began |
| `completion_percentage` | number | current/final Completion |
| `completed_unit_count` | number | safe count |
| `independent_unit_count` | number | safe count |
| `assisted_unit_count` | number | safe count |
| `new_completed_unit_count` | number | final minus start, minimum zero |
| `target_percentage` | number | session target |
| `target_met` | boolean | final target state |

For compatibility, also set `submitted_at = occurred_at`, `mode =
"intensive_listening"`, `delivery_policy =
"intensive_listening_immediate"`, and the normal student/set/assignment/thread
fields. Do not set `attempt_id` on IL rows.

Recommended owner-gated indexes:

```text
mode ASC, submitted_at DESC
thread_key ASC, submitted_at ASC
```

## 7. Trusted catalog endpoint

Add `action: "listCatalog"` to `cloudfunctions/intensiveListening/index.js`.
Handle it after authenticated profile resolution but before `loadMaterial`,
because catalog listing has no selected set.

### 7.1 Authorization

- Require an active profile with `role: "student"`.
- Teacher uses existing preview/Assign paths, not this student catalog action.
- Visitor cannot call it.

### 7.2 Reads

In bounded pages, load:

1. visible `sets` where `section_id: "intensive-listening"`;
2. visible `intensive_listening_materials` matching those set IDs;
3. current authenticated student's progress records;
4. non-cancelled assignments for that student and those set IDs;
5. candidate linked practice sets, then retain only visible ones.

Filter the response to the intersection of visible set plus visible live
material. This prevents cards whose private material import is missing.

### 7.3 Safe response

Return only:

```js
{
  success: true,
  materials: [{
    set_id,
    title,
    source_family,
    source_label,
    series_label,
    published_on,
    estimated_minutes,
    dictation_unit_count,
    sequence_unit_count,
    href,
    linked_practice: null | { set_id, title, href },
    progress: {
      percentage,
      best_percentage,
      completed_count,
      independent_count,
      assisted_count,
      replay_count,
      updated_at,
      completed_at
    },
    open_assignment: null | {
      assignment_id,
      due_at,
      completion_target,
      status
    }
  }]
}
```

Do not return unit IDs, segment timing, speaker, slot count per sentence,
punctuation, Provided Words, answers, exact wrong entries, drafts, or old
generation progress.

### 7.4 Assignment choice

If multiple historical assignments exist for one material, expose only the
newest non-cancelled open assignment. Completed assignments do not force a
self-study library visit back into an old assignment context.

## 8. Dedicated student library frontend

Create:

- `intensive-listening-library.html`
- `assets/css/intensive-listening-library.css`
- `assets/js/intensive-listening-library.js`

Use static HTML, CSS, and vanilla JavaScript. Load the existing favicon,
manifest, CloudBase SDK, `config.public.js`, `cloudbase-client.js`, and central
login navigation conventions.

### 8.1 Page structure

1. A compact header with Back to Dashboard and `INTENSIVE LISTENING`.
2. A search control.
3. Dynamic source filters: `All`, then source labels present in the response
   (`BBC`, `IELTS`, future sources).
4. Sort control with `Newest` default and `Oldest` alternative.
5. `Continue Listening`, rendered only when at least one material has current
   percentage `> 0 && < 100`.
6. `All Materials`.
7. Loading, empty, no-search-results, and recoverable-error states.

### 8.2 Sorting

- Continue: `progress.updated_at` descending, then published date descending,
  then title.
- All/Newest: published date descending, then title.
- All/Oldest: published date ascending, then title.
- Completed materials remain in chronological order and do not move to a
  separate bottom bucket.

### 8.3 Search

Case-insensitive search across title, source label, series label, set ID, BBC
date, and IELTS Book/Test/Section identifiers. Search is global across source
filters: when a query is active, show every match and do not require the user to
switch filters first.

### 8.4 Card content

Each card shows only:

- source label;
- title;
- published date or IELTS Book/Test/Section identity;
- dictation unit count;
- Completion progress bar and percentage;
- after starting: `<n> independent · <n> with answers`;
- primary `Start`, `Continue`, or `Review`;
- optional weaker `Listening Practice` action.

Do not display internal versions or `IL-*` IDs as prominent UI. The ID may
remain searchable and in accessible/debug metadata.

### 8.5 Card destinations

- Start/Continue/Review opens `intensive-listening.html` in the same tab.
- Add an authorized open `assignment` query only when `open_assignment` exists.
- Always add a validated same-origin `return` pointing to the library URL.
- Review opens the normal completed screen first; `Clear & Start Again` creates
  the existing temporary replay.
- Listening Practice uses the server-returned visible href and adds a safe
  return to the exact Intensive Listening material.

### 8.6 Responsive/accessibility requirements

- Cards may use two columns on wide screens and one column on narrow screens;
  this rule applies to material cards, not the three Dashboard capsules.
- Keyboard focus, visible focus rings, semantic links/buttons, reduced motion,
  and text alternatives are required.
- Do not nest links/buttons inside an outer clickable link.

## 9. Dashboard capsule implementation

Patch the current working-tree `dashboard.html`; do not restore the committed
pre-Speaking version.

Recommended markup:

```html
<section class="student-skill-entries" aria-label="Learning workspaces">
  <a class="student-skill-card writing" ...>
    <span class="student-skill-glyph" aria-hidden="true">写</span>
    <span class="student-skill-copy"><strong>WRITING</strong><span>...</span></span>
    <span class="student-skill-arrow" aria-hidden="true">→</span>
  </a>
  ... 听 ...
  ... 说 ...
</section>
```

The glyph is an unboxed left column. Align it with the English title, not the
vertical center of an icon tile. Keep each capsule full width. Do not use a
desktop grid.

Patch `assets/css/app.css` around the existing `.student-ai-tutor-*` rules. It
is acceptable to retain compatibility selectors, but the final DOM must not
show the old SVG/bookmark, `◎`, `AI Tutor`, or `DSE Speaking Lab` homepage
labels. Internal page titles may remain specific.

Destinations:

- Writing -> current `ai-tutor.html` URL/version;
- Intensive Listening -> `intensive-listening-library.html`;
- Speaking -> current `speaking-lab.html` URL/version.

## 10. Ordinary Library and linked-practice entry points

### 10.1 Metadata propagation

Update these paths to preserve the optional relationship:

- `scripts/build-home-catalog.js`
- `scripts/prepare-cloudbase-data.js`
- `cloudfunctions/getResources/index.js`
- BBC/IELTS content importers where applicable

Static metadata field: `intensiveListeningSetId`.

CloudBase set field: `intensive_listening_set_id`.

Authenticated resource responses may return this safe locator, but must not
return any private IL material structure.

### 10.2 Student BBC Library card

Patch `libraryBuildCard` in `assets/js/dashboard.js` so a BBC item with an
explicit linked Intensive Listening ID has two sibling actions:

- primary card/action -> BBC practice;
- weaker `Intensive Listening` -> direct linked material with a return to the
  exact Dashboard Library view.

The current card is an outer `role="link"`. Refactor linked cards so interactive
elements are not nested. Preserve keyboard activation and existing edition,
status, search, and styling behavior.

### 10.3 IELTS Section runtime

`ielts-listening.html` currently represents one Section set such as
`C7-T1-S1`. When its root lesson JSON has `intensiveListeningSetId`, render one
`Intensive Listening` action in the lesson header. Link directly to that
material and set the return URL to the complete current IELTS URL, including
set, assignment, teacher/visitor mode, focus, and any Section state.

Do not show an IELTS link when metadata is absent. Do not build an intermediate
Section chooser.

### 10.4 Teacher Library filtering

In `assets/js/teacher.js`, explicitly exclude sets whose section/type is
`intensive-listening` from Teacher Library card rendering. Do not remove them
from Assign candidate data. Teacher Assign must continue to find and preview
stand-alone IL sets.

## 11. Intensive Listening practice-page integration

Patch:

- `intensive-listening.html`
- `assets/css/intensive-listening.css`
- `assets/js/intensive-listening.js`
- `cloudfunctions/intensiveListening/index.js`
- `cloudfunctions/intensiveListening/service.js` only for pure/testable helpers

### 11.1 Header/navigation

- Default return from a library visit is the dedicated library, not Dashboard.
- Preserve a supplied validated same-origin return.
- Show material source/title and Completion.
- If bootstrap returns an authorized linked practice, show a weaker
  `Listening Practice` control in the header.
- If opened with an authorized active Assignment, show Due week and Completion
  target.
- Completion screen uses `Continue to Listening Practice` when linked;
  otherwise `Back to Intensive Listening`.

The backend, not a browser-supplied href, returns the linked-practice href and
assignment summary.

### 11.2 Bootstrap response

For students and teachers, extend bootstrap with safe:

```text
source_label
series_label
linked_practice: null | { set_id, title, href }
assignment_context: null | { assignment_id, due_at, completion_target, status }
```

Validate assignment ownership, set match, and non-cancelled state. Validate
linked practice visibility.

### 11.3 Audio activity heartbeat

Add `action: "recordActivity"` for active students only.

Client rules:

1. Do not call on page load or Start click.
2. Observe the audio element's real `currentTime`.
3. The first forward movement after playback begins sends immediately.
4. While the playhead continues moving, send at most one heartbeat every 30
   seconds.
5. A deliberate seek/replay/unit-navigation action may send immediately, but
   coalesce calls so no more than one request occurs in five seconds.
6. Do not send typed word values.
7. Network failure shows a restrained sync warning and retries on later
   activity; it never pauses audio.
8. Stop heartbeats for Visitor and Teacher preview.

Payload is limited to:

```js
{
  action: "recordActivity",
  set_id,
  assignment_id: optional locator,
  replay_id: optional locator,
  activity_type: "audio_progress" | "replay" | "seek" | "unit_navigation"
}
```

Do not trust client timestamps, percentages, role, duration, or context.

Check/Show Answer do not start a session on their own. If a session is already
active, successful/effective Check, Show Answer, and completed-unit writes
refresh the session and update its safe summary server-side.

### 11.4 Teacher immediate Provided Word

For Teacher preview:

1. Show Answer remains immediately available.
2. Clicking a required answer word opens the existing compact modal in teacher
   wording.
3. Replace `Send Argue` with `Approve`.
4. Confirm `Provide this word for every student?`.
5. Call a teacher-only direct action.
6. Transactionally change the slot to Provided, increment `policy_revision`
   once, convert an all-Provided unit to `listen_only`, append
   `grading_key_history`, and return the new safe material policy.
7. Do not create a pending `answer_disputes` row for teacher preview.
8. Student submission remains unchanged.

Extract/reuse one server helper for the actual Provided Word mutation so
`teacherAdmin` student-dispute approval and direct teacher preview cannot drift.
The helper must authorize teacher identity before mutation and be idempotent
when the word is already Provided.

## 12. Assignment behavior

### 12.1 Teacher Assign UI

Detect IL by `section_id`, `type`, or `set_id` prefix fallback. For an IL row:

- label the threshold `Completion target`;
- default to 100;
- show Due week;
- hide/disable Earn STAR and Mastery controls;
- submit `mastery_enabled: false`;
- never auto-select the linked comprehension exercise.

Teacher Library filtering must not affect Assign candidate availability.

### 12.2 Server revalidation

In `teacherAdmin`, force all newly created/edited IL assignments to:

```text
mastery_enabled = false
passing_percentage = validated Completion target (default 100)
```

Ignore any browser attempt to enable mastery/STAR for IL. Preserve normal due
week, duplicate-open, class-promotion, edit, and cancellation rules.

### 12.3 Assignment synchronization

Keep the current `syncAssignments` monotonic behavior in
`intensiveListening`. Use current best Completion against each assignment's
target. Do not create attempts or achievements. Cancelled assignments remain
terminal.

### 12.4 Teacher/Parent/report projections

- Teacher student detail and matrix show Completion plus independent/assisted
  counts for IL, without an Attempt history panel.
- Parent Mode may show assigned status and Completion only; no self-study,
  word detail, replay count, Argue, or audio route.
- Learning Reports count qualified assigned IL Class Tasks like other Class
  Tasks. Do not average IL Completion with BBC/IELTS scores.
- Self-study IL may appear only in the report Self-study section as completed
  material count/details and never changes class rank.

Reuse assignment state wherever it already supplies the correct projection.
Add direct progress reads only where independent/assisted detail is required.

## 13. Three-minute session state machine

Implement this state machine server-side. The browser only sends activity
signals.

### 13.1 No session

`recordActivity` after real audio movement:

1. authenticate active student;
2. load current material/current progress;
3. validate optional assignment ownership/set/non-cancelled state;
4. decide context:
   - active replay -> `review`, target 100, replay progress summary;
   - authorized open assignment -> `assignment`, target assignment Passing %;
   - otherwise -> `self_study`, target 100;
5. create a random session ID;
6. snapshot current safe progress;
7. set status `active`, start/last-active `now`, due `now + 180 seconds`;
8. create the deterministic Started outbox event;
9. return success without waiting for SMTP.

The Started event Completion may be zero.

### 13.2 Active session, activity before deadline

Update only:

- `notification_last_active_at = now`;
- `notification_session_due_at = now + 180 seconds`;
- latest safe progress/count snapshots.

Do not create another Started event.

### 13.3 Active session, activity after deadline but before timer closure

Inside one transaction/logical idempotent operation:

1. close the expired session as Paused at its prior last-active snapshot;
2. create its deterministic final outbox event;
3. start a new session at `now`;
4. create the new deterministic Started event.

Do not revive the expired session merely because the timer was late.

### 13.4 Target met

After a progress-changing Check/Show Answer/replay completion:

1. if an active session exists, update its latest summary;
2. if percentage is at least the target, close it immediately as Completed;
3. clear due time;
4. create the deterministic final event with `target_met: true`.

If no audio movement ever started a session, Check alone must not create a
session or email.

### 13.5 Timer idle closure

At the start of every authorized `sendTeacherAttemptEmails` invocation:

1. find a bounded page of active progress rows with due time `<= now`;
2. transactionally reload each row;
3. skip it if no longer active or its deadline moved;
4. close as Paused using the latest stored safe summary;
5. create the deterministic final event;
6. continue through bounded pages without exceeding function time.

Use server timestamps. A closed page/browser does not need to send a final
request.

### 13.6 Multi-tab concurrency

All session transitions must use a transaction or stable compare-and-update
against the one current progress document. Two tabs may both send activity;
only one session ID and one Started event may result. Duplicate event creation
is idempotent success.

### 13.7 Mail disabled/failure

Session events still exist for the Teacher bell when:

- no teacher email recipient is enabled (`skipped`);
- SMTP fails and retries;
- SMTP reaches terminal `failed`.

Email delivery status must never be used as bell visibility or read state.

## 14. Email dispatcher changes

Patch:

- `cloudfunctions/_shared/attempt-email-notifications.js`
- `cloudfunctions/sendTeacherAttemptEmails/index.js`
- `scripts/test-attempt-email-notifications.js`

### 14.1 Policy

Add:

```text
EMAIL_POLICIES.INTENSIVE_LISTENING_IMMEDIATE = "intensive_listening_immediate"
```

IL Started/final events are due at `occurred_at`. They are claimed one at a
time, not BBC-batched. Keep retry, stale-claim recovery, BCC recipient lookup,
Message-ID, skip, and credential rules unchanged.

### 14.2 Renderer

Branch before attempt loading when `event_kind`/mode identifies IL. Never query
`attempts` or `grading_keys` for this event.

Started email includes only:

- student display name and Login ID;
- material/source title;
- `Assignment`, `Self-study`, or `Review`;
- Shanghai start time;
- starting/current Completion;
- target when assigned.

Paused/Completed email adds:

- Shanghai start/end;
- session duration;
- current Completion;
- newly completed units;
- total independent/assisted counts;
- target and whether met.

Use escaped HTML plus a plain-text equivalent. Do not include answers, entries,
unit sentences, private audio, or Argue.

Suggested stable subjects:

```text
<Student> | <Material> | Started <n>%
<Student> | <Material> | Paused at <n>%
<Student> | <Material> | Completed <n>%
```

Use the existing thread header and prior provider message reference for the
same `thread_key` when available. A retry still uses a fresh Message-ID.

## 15. Teacher bell integration

Do not place IL events into `attempts`.

Patch `teacherAdmin` notification actions and `assets/js/teacher.js` to support
a mixed feed.

### 15.1 Normalized feed item

Normalize IL rows to:

```js
{
  activity_id: event_id,
  activity_type: "intensive_listening",
  thread_key,
  student_uid,
  student_id,
  student_name,
  set_id,
  set_title,
  assignment_id,
  occurred_at,
  session_phase,
  practice_context,
  completion_percentage,
  completed_unit_count,
  independent_unit_count,
  assisted_unit_count,
  new_completed_unit_count,
  target_percentage,
  target_met,
  unread
}
```

No per-question detail endpoint is called for IL.

### 15.2 Pagination

Keep ten unique threads per page and newest-first ordering without loading all
attempt history. Extend the cursor to carry independent offsets, for example:

```js
{ attempt_offset: 0, intensive_offset: 0 }
```

For backward compatibility, a numeric cursor means
`{ attempt_offset: cursor, intensive_offset: 0 }`.

Fetch bounded windows from `attempts` and IL-mode outbox events, normalize,
merge by event time, apply `exclude_thread_keys`, and return a cursor containing
the consumed raw offset for each source. Add pure helper tests for merge order,
deduplication, cursor advancement, and one-source exhaustion.

### 15.3 Thread detail

When an IL thread opens, return its Started/Paused/Completed session events
oldest-to-newest. Render compact cards. Do not show an Attempt score chart,
paper icon, wrong answers, or answer-detail loading.

### 15.4 Read state

Reuse the current Teacher activity read-all timestamp and reviewed-ID list for
both Attempt IDs and IL `event_id` values. The unread count is the union of
unread unique Attempt threads and IL threads. Sent/skipped/failed email status
does not affect unread state.

## 16. Content importer and current BBC compatibility

Patch `scripts/import-intensive-listening.js` so it is not BBC-hardcoded.

### 16.1 Accepted source metadata

Support optional input/CLI fields:

```text
sourceFamily / --source-family
sourceLabel / --source-label
seriesLabel / --series-label
publishedOn / --published-on
sourceSetId
linkedPracticeSetId / --linked-practice-set-id
```

Fallback rules:

- `IL-BBC-*` -> family `bbc`, label `BBC`, series `BBC 6 Minute English`;
- `IL-C*-T*-S*` or explicit IELTS source -> family/label `ielts`/`IELTS`;
- otherwise require a human-readable source label for new material.

Only BBC writes the inverse relationship into a BBC runtime automatically by
ID fallback. IELTS/pure materials use the explicit linked-practice ID and
update the matching content/runtime only when the target exists and schema is
known. Never title-match relationships.

### 16.2 Public metadata

Keep `content/intensive-listening/*.json` answer-free and continue setting
`catalogVisible: false`, because ordinary home/Teacher Library generation must
not include IL cards. Add safe explicit counts/source/link metadata for tooling
and tests.

### 16.3 Replacement semantics

- Metadata-only edits may keep the internal compatibility generation.
- Any transcript, segment boundary, practice mode, or slot structure change
  must increment internal `content_version`.
- The UI never says V1/V2 and catalog has one card.
- The new generation starts current progress from zero while old private rows
  remain untouched.
- Do not bulk-delete old progress.

### 16.4 Current 21 BBC rows

Do not require the private iCloud sources merely to build the frontend. Code
must support existing deployed rows through fallback source/date derivation.
Update committed safe metadata files mechanically only when needed. Never
invent or expose transcript text.

## 17. Documentation updates required with implementation

Update all applicable sources in the same change:

- `AGENTS.md`: replace the old “BBC capsule only” IL entry rule; add dedicated
  library, no ordinary IL cards, replacement/reset semantics, and three-minute
  notification invariants.
- `README.md`: add the dedicated library and IL session email behavior; include
  the new test command if one is added.
- `CONTEXT.md`: add stable terms such as Intensive Listening Library,
  Completion target, IL learning session, Started, Paused, and Completed.
- `docs/01_PRODUCT_REQUIREMENTS.md`: all frozen product decisions.
- `docs/02_ARCHITECTURE.md`: catalog action, heartbeat, session state, outbox,
  timer closure, mixed bell feed, and link flow.
- `docs/03_UI_UX_SPEC.md`: three Dashboard capsules, library layout/cards,
  return behavior, Assignment context, teacher direct approval, and bell cards.
- `docs/04_DATA_MODEL.md`: every field/index in section 6.
- `docs/05_CHANGELOG.md`: dated implementation summary.
- `docs/06_DECISIONS.md`: internal generation/no product versions, outbox reuse,
  server timer closure, and no synthetic attempts.
- `docs/07_TESTING_CHECKLIST.md`: section 19/20 tests.
- `docs/08_BACKLOG.md`: only genuine deferred items such as dedicated phone
  word-slot optimization; do not add completed work.
- `docs/09_CONTENT_WORKFLOW.md`: generalized IL importer/link/source metadata
  and replacement process.
- `docs/10_DEPLOYMENT.md`: packaging, owner-created indexes, rollout order,
  smoke tests, and rollback.
- `docs/11_AGENT_TROUBLESHOOTING.md`: missing cards, idle final not sent,
  duplicate session, stale function, and mixed bell pagination diagnosis.

Do not overwrite concurrent Speaking Lab documentation. Merge additions into
the current working tree.

## 18. File-level implementation inventory

### 18.1 New files

- `intensive-listening-library.html`
- `assets/css/intensive-listening-library.css`
- `assets/js/intensive-listening-library.js`
- `scripts/test-intensive-listening-library.js`
- this plan (already created before execution)

Create another shared/test helper only if it materially reduces duplicated
session/feed logic. Prefer:

- `cloudfunctions/_shared/intensive-listening-notifications.js` for pure event,
  session-summary, and email-rendering helpers; and/or
- `cloudfunctions/_shared/intensive-listening-spelling.js` for the Provided Word
  transaction contract.

Do not create unnecessary wrapper files.

### 18.2 Existing frontend files

- `dashboard.html`
- `assets/css/app.css`
- `assets/js/dashboard.js`
- `intensive-listening.html`
- `assets/css/intensive-listening.css`
- `assets/js/intensive-listening.js`
- `ielts-listening.html`
- `bbc.html` only if return/link behavior needs a focused patch
- `teacher.html` only if existing markup needs a focused hook
- `assets/js/teacher.js`
- `assets/js/config.public.js`

### 18.3 Existing backend/shared files

- `cloudfunctions/intensiveListening/index.js`
- `cloudfunctions/intensiveListening/service.js`
- `cloudfunctions/teacherAdmin/index.js`
- `cloudfunctions/getResources/index.js`
- `cloudfunctions/getDashboard/index.js` only if assignment labels/projections
  require it
- `cloudfunctions/parentMode/index.js` only if current generic assignment
  projection leaks or omits required Completion
- `cloudfunctions/generateLearningReports/index.js` and/or shared report logic
  only for the confirmed IL report projection
- `cloudfunctions/_shared/attempt-email-notifications.js`
- `cloudfunctions/sendTeacherAttemptEmails/index.js`

### 18.4 Content/tooling/test files

- `scripts/import-intensive-listening.js`
- `scripts/build-home-catalog.js`
- `scripts/prepare-cloudbase-data.js`
- `scripts/test-intensive-listening.js`
- `scripts/test-attempt-email-notifications.js`
- `package.json`
- affected safe `content/intensive-listening/*.json` metadata only when needed
- `data/home-catalog.json` and `data/home-catalog.js` after the generator

Do not edit private iCloud sources, `.cloudbase-private` committed state, audio,
or deployment ZIPs as source.

## 19. Test plan

### 19.1 Pure service tests

Add deterministic tests for:

- source/date fallback derivation;
- safe catalog view excludes units/answers/timing/slots;
- Start event IDs and final event IDs are stable;
- session starts only from `recordActivity`, not Check alone;
- heartbeat rolls deadline to exactly `now + 180 seconds`;
- expired activity closes old session then opens a new one;
- target met closes immediately;
- replay context labels Review and uses replay progress;
- multi-tab duplicate start results in one session/event;
- final event contains safe counts but no word data;
- direct teacher Provided Word is idempotent and increments policy only once;
- existing student dispute approval remains valid.

### 19.2 Catalog/UI static tests

`scripts/test-intensive-listening-library.js` should assert:

- three Dashboard cards remain full-width/stacked and ordered 写/听/说;
- old SVG/`◎` homepage marks are absent;
- exact approved English titles/copy exist;
- dedicated library assets are loaded;
- Continue, All Materials, source filter, search, Newest/Oldest, and all empty
  states exist;
- cards use Start/Continue/Review correctly from fixtures;
- linked practice is optional;
- ordinary catalog contains no `IL-*` item;
- Teacher Library excludes IL while Assign code still accepts it;
- BBC relation is preserved through catalog/resource view;
- IELTS Section renders a link only when metadata is present;
- URLs preserve a same-origin encoded return;
- no answer/private field appears in safe catalog fixtures.

Use pure functions or a minimal DOM fixture. Do not add jsdom.

### 19.3 Email tests

Extend `test:attempt-emails` with:

- immediate IL policy/due time;
- Started subject/body;
- Paused/Completed subject/body;
- Assignment/self-study/Review labels;
- independent/assisted/new unit counts;
- HTML escaping;
- absence of typed words, answer text, slots, private audio, and grading-key
  loads;
- one event claimed at a time;
- skipped-without-recipient behavior preserved;
- existing BBC seven-minute and Vocabulary immediate tests unchanged.

### 19.4 Teacher bell tests

Add pure merge/pagination fixtures for:

- interleaved Attempt and IL event time ordering;
- ten unique threads;
- duplicate same-thread suppression;
- independent cursor advancement;
- one source empty;
- unread union and reviewed event IDs;
- IL thread rendering has no paper/detail fetch;
- existing Attempt prefetch limit remains two.

### 19.5 Assignment/report tests

Assert:

- IL assignment defaults target to 100 and mastery false;
- forged mastery true is rejected/normalized server-side;
- linked practice is not auto-assigned;
- Completion updates assignment monotonically;
- assisted completion counts;
- cancelled assignment stays cancelled;
- finished assignment does not regress after new content generation;
- Parent Mode returns assigned Completion only;
- Class Task completion can count in reports without score averaging;
- self-study IL never affects class rank.

### 19.6 Syntax/release gates

At minimum run after implementation:

```bash
npm run test:intensive-listening
npm run test:intensive-listening-library
npm run test:attempt-emails
npm run test:assignment-schedule
npm run test:learning-reports
npm run test:speaking-lab
npm run verify:release
npm run package:functions -- intensiveListening teacherAdmin getResources sendTeacherAttemptEmails
git diff --check
```

Include other affected function packages when code changes them. Packaging is
local verification only and is not deployment.

### 19.7 Manual local browser matrix

Serve through HTTP, never `file://`:

```bash
python3 -m http.server 8000
```

Verify:

1. Dashboard desktop: three vertical full-width capsules, correct glyph/title.
2. Dashboard phone: same order, no overflow.
3. Library: loading, search, source filters, Continue, Newest/Oldest, empty
   search, Start/Continue/Review.
4. BBC card: primary BBC and secondary IL actions both keyboard-operable.
5. IL material: return to library and return to exact BBC/IELTS page.
6. Teacher preview: immediate Show Answer and in-place Provided confirmation.
7. Visitor: full-audio listen-only, no catalog/private calls.
8. Session: no event on load/Start; first playhead movement creates Started;
   active playback does not duplicate; three-minute idle creates Paused on timer
   smoke test; completion creates final immediately.
9. Teacher bell: mixed ordering, IL cards, read state, no answer fetch.
10. Email: enabled development inbox receives safe Started/final summaries only
    after explicit owner-authorized deployment/testing.

Stop any local server started by the executor.

## 20. Implementation sequence

Follow this order. Do not jump directly to styling before trusted contracts.

### Milestone 1 — Pure contracts and backward compatibility

- [ ] Add pure source/catalog/session/outbox helpers.
- [ ] Extend importer metadata with BBC fallbacks and generic explicit source.
- [ ] Keep existing metadata `catalogVisible: false`.
- [ ] Add failing-then-passing service tests.
- [ ] Prove current 21 BBC safe metadata still validates.

### Milestone 2 — Trusted catalog and relationship propagation

- [ ] Add `listCatalog` before `loadMaterial`.
- [ ] Join only visible sets plus visible live materials.
- [ ] Return only current safe progress and authorized open assignment.
- [ ] Propagate inverse linked ID through static catalog, prepared sets, and
      `getResources`.
- [ ] Add backend/static privacy tests.

### Milestone 3 — Dedicated library

- [ ] Create HTML/CSS/JS.
- [ ] Implement auth redirect/return.
- [ ] Implement Continue, filters, global search, sorting, cards, and states.
- [ ] Add static/fixture tests.

### Milestone 4 — Dashboard and ordinary Library links

- [ ] Patch the current Speaking-aware Dashboard markup.
- [ ] Implement exact 写/听/说 capsule design.
- [ ] Refactor BBC cards into valid sibling actions.
- [ ] Add conditional IELTS Section link.
- [ ] Exclude IL from Teacher Library only, not Assign.
- [ ] Run Speaking regression tests immediately after overlapping edits.

### Milestone 5 — Practice navigation and teacher direct approval

- [ ] Extend bootstrap authorized context.
- [ ] Update header/completion CTA and return behavior.
- [ ] Implement shared Provided Word mutation.
- [ ] Implement teacher in-place confirmation/approval.
- [ ] Preserve student Argue behavior and audit.

### Milestone 6 — Assignment/projection semantics

- [ ] Specialize IL Assign controls.
- [ ] Revalidate mastery false/default Completion target server-side.
- [ ] Add Teacher detail/matrix safe counts.
- [ ] Verify Parent/report projections and patch only where required.

### Milestone 7 — Session heartbeat and outbox

- [ ] Implement `recordActivity` and client throttling.
- [ ] Add current progress session fields/transitions.
- [ ] Create Started/final events idempotently.
- [ ] Close target-met sessions immediately.
- [ ] Add concurrency/state-machine tests.

### Milestone 8 — Timer, email, and Teacher bell

- [ ] Close idle sessions before normal email dispatch.
- [ ] Render safe IL email without attempts/grading keys.
- [ ] Add mixed bell feed/cursor/thread rendering/read state.
- [ ] Preserve existing BBC/Vocabulary email and Attempt bell behavior.

### Milestone 9 — Documentation, versions, full verification

- [ ] Update every document in section 17.
- [ ] Update asset cache versions without overwriting concurrent versions.
- [ ] Run all section 19 tests and packages.
- [ ] Inspect `git status` and `git diff --check`.
- [ ] Do not stage, commit, push, import, create indexes, or deploy unless the
      owner separately asks.

## 21. Owner-gated rollout plan

The implementation Agent must document but not perform these actions.

Recommended rollout after local approval:

1. Review/create the new indexes from section 6.
2. Import/update safe IL set/material metadata for current rows without deleting
   old progress.
3. Deploy `sendTeacherAttemptEmails` first so it understands new event rows.
4. Deploy `teacherAdmin` and any report/Parent projections.
5. Deploy `getResources`.
6. Deploy `intensiveListening` last among event producers.
7. Publish static assets only after all required functions are live.
8. Keep the existing one-minute email timer; do not create a second timer.
9. Smoke test with one dedicated development student and enabled teacher inbox.
10. Confirm Started arrives on the next one-minute tick and Paused arrives on
    the first tick after three minutes of inactivity.

Rollback order:

1. hide the Dashboard Intensive Listening capsule/static library entry;
2. deploy the previous `intensiveListening` to stop producing new IL events;
3. allow or deliberately skip already-created outbox events;
4. deploy previous bell/email readers;
5. retain all progress/outbox/session audit rows; do not bulk-delete them.

## 22. Final acceptance checklist

The task is complete only when all are true:

- [ ] Dashboard shows three full-width vertical capsules with left-aligned
      写/听/说 glyphs and exact English text.
- [ ] Existing Speaking Lab work still loads and its tests pass.
- [ ] Dedicated authenticated IL library shows only live, visible materials.
- [ ] Current BBC materials are available without public transcript data.
- [ ] Continue/search/source/sort/Start/Review work.
- [ ] Ordinary Student and Teacher Libraries have no standalone `IL-*` cards.
- [ ] BBC direct link and conditional IELTS Section link work.
- [ ] One IL maps to at most one visible comprehension exercise.
- [ ] Assignment target/mastery rules are server-enforced.
- [ ] Teacher Show Answer and direct Provided approval work in place.
- [ ] No session begins on page load or Start click.
- [ ] First audio playhead movement creates exactly one Started event.
- [ ] Activity rolls a three-minute deadline.
- [ ] Idle/target completion creates exactly one safe final event.
- [ ] Multiple tabs do not duplicate sessions or email events.
- [ ] Teacher bell displays IL sessions without synthetic attempts or answer
      detail requests.
- [ ] Started and final emails contain no typed words/answers/private audio.
- [ ] Email failure cannot fail learning progress.
- [ ] Material replacement uses one visible card and current-generation
      progress only.
- [ ] Parent/report/self-study ranking boundaries are preserved.
- [ ] Documentation, tests, packaging, and cache versions are current.
- [ ] No CloudBase mutation or deployment was performed.

## 23. Handoff format

The executor's final handoff must state:

1. files changed, grouped by frontend/backend/tooling/docs;
2. exact behavior implemented;
3. tests run with pass/fail results;
4. baseline failures that predated the task;
5. generated packages, if any;
6. owner-gated collection/index/import/deploy steps still required;
7. remaining risks, especially timer cadence, mixed-feed pagination, and
   unverified real CloudBase concurrency;
8. confirmation that unrelated Speaking Lab changes were preserved.
