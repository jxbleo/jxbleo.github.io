# Listening: Dictation + Shadowing — Detailed Engineering Implementation Plan

## Implementation review status — 2026-09-05

The first implementation slice is complete in the worktree and has received a
main-agent security, product-rule, regression, and visual review. The review
corrected the Tencent WSS signature/handshake contract, made complete-listen
credit server-timed, prevented pre-reveal word leakage, added a transaction
single-take lock and upload registration, preserved independent Dictation and
Shadowing notification sessions, made Dictation reveal non-completing, and
replaced the teacher's raw segment-JSON editor with direct per-line controls.
It also added pre-upload provider gating, interrupted-upload cancellation,
single-track authoring switches, optimistic private drafts that cannot hide the
live material, stale-publication protection, immutable publication history, and
track-specific progress revision replacement.

The owner authorized rollout on 2026-09-05. The static site, four affected cloud
functions, six ADMINONLY collections, reviewed indexes, and the six-hour native
maintenance timer are deployed. Production Shadowing scoring remains
intentionally fail-closed until real-audio benchmarking approves the score
policy and Tencent SOE-N is enabled for the runtime; no real paid provider
request was made during deployment.

> Status: product decisions approved; implementation, review, and provider-
> disabled production rollout complete; real scoring activation remains gated
> by the benchmark and owner approval.
>
> Audience: coding agents, including lower-capability agents. Follow the frozen
> rules, state machines, data boundaries, API contracts, visual requirements,
> migration rules, and release gates exactly. Do not invent missing behavior.
>
> Scope of this execution: implement and verify locally. Do not deploy CloudBase
> functions, create production collections or indexes, import production data,
> configure credentials, or publish the static site unless the owner separately
> authorizes those exact actions.
>
> Supersession: this plan replaces the product rules in
> `docs/16_INTENSIVE_LISTENING_LIBRARY_IMPLEMENTATION_PLAN.md` wherever that
> document describes a Dictation-only product, calls the feature `Intensive
> Listening`, shows Track progress in the ordinary Library, or treats one
> percentage as the whole Listening result. Preserve the older document only as
> implementation history.

## 0. Executor protocol

### 0.1 Read before editing

Read these sources in order. Do not implement from this plan alone:

1. `AGENTS.md`
2. `README.md`
3. `CONTEXT.md`, especially `Listening`
4. `docs/01_PRODUCT_REQUIREMENTS.md`
5. `docs/02_ARCHITECTURE.md`
6. `docs/03_UI_UX_SPEC.md`
7. `docs/04_DATA_MODEL.md`
8. `docs/06_DECISIONS.md`
9. `docs/07_TESTING_CHECKLIST.md`
10. `docs/09_CONTENT_WORKFLOW.md`
11. `docs/10_DEPLOYMENT.md`
12. `docs/11_AGENT_TROUBLESHOOTING.md`
13. `docs/adr/0001-private-server-checks-for-intensive-listening.md`
14. `docs/adr/0003-durable-canonical-ai-boundaries.md`
15. this plan
16. every source file named in section 20

Study the current Writing and Speaking surfaces before styling Listening:

- `ai-tutor.html`, `assets/css/ai-tutor.css`, `assets/js/ai-tutor.js`
- `speaking-lab.html`, `assets/css/speaking-lab.css`,
  `assets/js/speaking-lab.js`
- `dashboard.html`, `assets/css/spatial-workspace.css`
- `teacher.html`, especially the existing Speaking workspace

### 0.2 Dirty-worktree rule

The repository contains an intentional uncommitted `CONTEXT.md` update from the
approved product-design session. Preserve it. Before editing, run:

```bash
git status --short --branch
git diff -- CONTEXT.md
git diff --check
```

Never reset, checkout, clean, or rewrite unrelated owner work. Patch current
files in place. Do not commit or push unless the owner separately requests it.

### 0.3 Baseline

Run these before edits and record the exact results in the final handoff:

```bash
npm run test:intensive-listening
npm run test:intensive-listening-library
npm run test:assignment-schedule
npm run test:attempt-emails
npm run test:writing-tutor
npm run test:speaking-lab
npm run verify:release
git diff --check
```

Verified baseline on 2026-09-05:

- Intensive Listening, notification, assignment scheduling, Writing, and
  Speaking tests pass.
- The assignment-scheduling VM harness includes `requestAnimationFrame`, and
  its dashboard assertions follow the current single-row weekly summary,
  achievement-calendar response, and integrated Teacher Replies tabs.

### 0.4 Hard rules

- Do not deploy or mutate CloudBase resources.
- Do not request, print, log, or commit Tencent credentials, SMTP credentials,
  timer tokens, student credentials, private transcripts, answers, recordings,
  provider payloads, or temporary audio URLs.
- Every new collection is `ADMINONLY`.
- The backend derives user identity and role from authenticated context.
- IDs supplied by the browser are locators, never authorization.
- Use top-level CloudBase records. Never use `add({ data: row })`.
- Immutable rows are created with stable IDs and `create`; never overwrite
  historical take or usage rows with `set`.
- Do not add a frontend framework. Continue static HTML, CSS, vanilla JS, and
  Node.js 18 CloudBase functions.
- Do not add Azure, another scoring provider, automatic provider failover, or a
  generic multi-provider framework.
- Isolate Tencent SOE-N behind one adapter so it can be tested and audited.
- Do not fabricate a score when Tencent is unavailable or the approved scoring
  policy is absent.
- Do not generate pronunciation diagnoses such as “you devoiced /z/.”
- Raw Student Take audio is temporary and private for seven days only.
- Provider errors, notifications, cleanup, and email must never corrupt saved
  Dictation progress or a previously stored Shadowing result.
- Preserve existing Dictation records and spelling Argue history.
- Update every affected numbered document in the same change.

## 1. Product outcome

The learner-facing feature is named `Listening`. A Listening Material contains
one audio or video source, one reviewed transcript, and one or both Practice
Tracks:

- `Dictation`: listen and complete word slots.
- `Shadowing`: listen, record the same wording, receive one score, and retry
  until the Segment reaches 80.

The ordinary Library continues to show the existing BBC/IELTS listening-
comprehension card and that exercise's existing progress. The card contains one
`Listening` action in the current `Intensive Listening` position. It never
shows Dictation/Shadowing labels or Track progress and never creates separate
Listening cards.

The Dashboard Listening entrance opens the existing dedicated material catalog,
renamed `Listening`. A material appears once. Opening it enters the Listening
surface; if both Tracks are enabled, the mode chooser appears inside that
surface. If one Track is enabled, the surface opens it directly.

The teacher gains a first-level `Listening` workspace for material management,
track editing, validation, privacy-safe review, publishing, and hiding. Existing
Dictation teacher preview and spelling approval remain. Real paid Shadowing
test scoring stays behind the same approved-policy and provider rollout gate as
student scoring; the local authoring release does not expose a free-form paid
test button.

## 2. Frozen product decisions

Do not reopen these decisions during implementation.

### 2.1 Naming and entry points

1. Student-facing name: `Listening`.
2. Practice modes: `Dictation` and `Shadowing`.
3. Do not display `Intensive Listening` in new UI copy. Keep old URLs and IDs
   only for backward compatibility.
4. One Listening Material appears once in the dedicated Listening catalog.
5. The ordinary Library exposes one `Listening` action inside its existing
   listening-exercise card. No Track labels, Track badges, Track progress, or
   standalone `IL-*` card appears there.
6. BBC and IELTS follow the same rule. IELTS opens from the current Section;
   there is no four-Section intermediate selector.
7. Mode choice occurs only after entering Listening.
8. A material with one enabled Track opens that Track. A material with both
   enabled Tracks shows the internal chooser every time; do not force the last
   used mode.
9. One material links to zero or one listening-comprehension exercise. Both
   Tracks share that link.
10. A stand-alone material with no exercise remains reachable from the
    Dashboard Listening catalog.

### 2.2 Material and revision model

1. One material owns one primary Source Media item: audio or video.
2. Both Tracks share Source Media and one reviewed full transcript.
3. Dictation and Shadowing own independent Segment boundaries.
4. A material may enable Dictation only, Shadowing only, or both.
5. Publishing replaces the learner-visible material. Students never select or
   see versions.
6. Private audit snapshots may remain for teacher review.
7. A Dictation-only edit resets/recalculates Dictation progress only.
8. A Shadowing-only edit resets/recalculates Shadowing progress only.
9. A shared media or full-transcript edit resets/recalculates both Tracks.
10. Hiding preserves materials, progress, takes, assignments, and audit data.
    Ordinary deletion is not offered.

### 2.3 Dictation behavior

1. Preserve current fixed-position, case-insensitive word-slot grading.
2. Preserve Provided Words and spelling Argue.
3. Shadowing never has Argue.
4. Student `Show Answer` changes to `Hide` while the answer is visible.
5. Revealing the Dictation answer does not complete or advance the Segment.
6. Clicking or focusing any fillable word slot hides the answer immediately.
7. After revealing, the learner must finish the current Segment before normal
   automatic progression. The completed Segment remains marked assisted.
8. Teacher preview can reveal immediately and approve a Provided Word in place.
9. Context Only plays in sequence without grading. Skip is omitted from learner
   playback and progress. Normalize legacy `listen_only` to `context_only` at
   the service boundary while retaining input compatibility.

### 2.4 Shadowing core loop

1. The learner hears the current Segment, then records it.
2. Audio Source Media stops before recording begins.
3. For video, recording replays the same picture silently over the same Segment
   so the learner can dub it. Source audio is muted and must not be captured.
4. Permit approximately one second of end grace and allow early stop.
5. Each valid take shows one integer `Shadowing Score` from 0 to 100.
6. Fixed pass line: 80. Score 80 passes; 79 does not.
7. A passed Segment automatically advances after about one second.
8. Below 80 offers `Try Again` and `Continue`.
9. Continue adds the Segment to `To Improve`; it does not qualify it.
10. After the first pass through the material, return to `To Improve` until
    every Shadowing Segment qualifies.
11. Material progress is qualified Segments / total Shadowing Segments. Do not
    show or store a material average as the completion rule.
12. Retain the Segment's highest valid score. Lower retries never lower it.
13. Unlimited pedagogical retries are allowed across time; quotas may throttle
    costly bursts.
14. Shadowing completion requires every Segment's best score to be at least 80.
15. Context Only and Skip do not add scored requirements.
16. Shadowing has no Argue and no teacher score override. Retry is the only
    score-resolution path.

### 2.5 Transcript reveal

1. Before reveal, the reference transcript is not sent to or rendered by the
   browser. This is a data boundary, not just CSS hiding.
2. The learner selects `1`, `2`, `3`, `5`, or `Off`; default is `3`.
3. The setting persists per learner.
4. A complete audible Segment play increments the listen count.
5. Partial plays, taps, seeks, or silent video dubbing do not increment it.
6. At the selected count, the reviewed transcript appears automatically.
7. `Off` means never auto-reveal, but the selector remains accessible.
8. A pass before reveal is `Independent`.
9. A pass after reveal is `Assisted`; it still qualifies at 80.
10. Before reveal, score feedback must not leak words or word positions.

### 2.6 Shadowing feedback

1. Show one score, the reviewed transcript with word colour after reveal, and
   retry/continue controls.
2. Do not show a separate “what the model heard” transcript.
3. Normal/dark text means clearly matched.
4. Yellow means matched but borderline.
5. Red means omitted, clearly misread/unrecorded, provider MatchTag failure, or
   very low calibrated word accuracy.
6. A red word caps the final product score at 79.
7. Yellow may coexist with a passing score.
8. Add underline patterns so colour is not the only signal.
9. Unscored Reference Words stay visible after reveal but receive no colour and
   do not affect the product score.
10. The product score measures complete, intelligible, reasonably connected
    reproduction of the exact reviewed wording. It does not grade voice
    identity, gender, emotion, or imitation of the source speaker's accent.
11. Exact wording is required. Do not accept paraphrases.
12. Do not display an articulatory explanation inferred from low phoneme data.

### 2.7 Assignment, completion, and notifications

1. Teacher may assign Dictation, Shadowing, or Both.
2. Both creates two independent Track Participations under one student-facing
   Listening task card.
3. Both is FINISHED only when both required Tracks complete.
4. A single-Track assignment ignores completion of the non-required Track.
5. Listening assignment controls are Due week plus Track selection only.
6. Hide Passing %, Earn STAR, and Mastery % for Listening assignments.
7. Listening never earns a STAR.
8. Self-study and assigned Listening both create teacher bell/email activity.
9. First real progress starts a session:
   - Dictation: existing real playhead movement rule;
   - Shadowing: first valid stored evaluation result, even if below 80.
10. Started is queued immediately.
11. Real progress refreshes a rolling three-minute deadline.
12. Three minutes with no progress closes the session as Paused with the latest
    safe summary.
13. Completion closes it immediately.
14. Notifications identify `Listening · Dictation` or
    `Listening · Shadowing`.
15. Notifications never contain raw audio, transcript text, typed words,
    word-colour results, private URLs, or provider payloads.

### 2.8 Recording retention

1. Valid raw Student Take audio is private and retained for no more than seven
   days.
2. Invalid, silent, corrupt, rejected, or unclaimed audio is deleted promptly.
3. After deletion, retain safe take metadata: score, red/yellow reference word
   positions, Independent/Assisted state, timestamps, provider identifier,
   provider revision, and scoring-policy revision.
4. Do not create reusable voiceprints from Shadowing recordings.
5. Do not expose recordings in teacher email, bell bootstrap, logs, or public
   URLs.

### 2.9 Provider

1. Use Tencent Smart Oral Evaluation New Age (`SOE-N`) only.
2. English sentence mode uses `server_engine_type=16k_en`, `eval_mode=1`, and
   synchronous recording evaluation `rec_mode=1`.
3. Provider credentials remain CloudBase environment values.
4. If Tencent or the approved scoring policy is unavailable, return no score.
5. Do not retry an ambiguous request automatically when it may already have
   been billed.
6. Record provider identity `tencent_soe_n` and a provider/protocol revision on
   every terminal take.
7. Do not map or compare scores across providers.

## 3. Explicit non-goals

- Azure or other scoring providers.
- Automatic provider failover.
- Live streaming score updates during recording.
- Long-term raw recording archive.
- Voiceprint creation or speaker recognition.
- Student audio-file upload; V1 is live microphone recording only.
- Teacher score override or Shadowing Argue.
- Phoneme-level natural-language diagnosis.
- Voice similarity, emotion, gender, or source-accent imitation grading.
- Multiple exercises linked to one material.
- A new standalone Listening card in ordinary Library.
- Track progress in ordinary Library.
- Student-visible content versions.
- Public transcript JSON.
- Hard deletion of learning data.

## 4. Feasibility boundary

### 4.1 Tencent can provide

The adapter may consume only documented SOE-N evidence:

- `SuggestedScore`;
- overall `PronAccuracy`, `PronFluency`, and `PronCompletion`;
- `Words[]` reference/current word data;
- word `PronAccuracy`, timing, and `MatchTag`;
- phoneme scores for private audit/calibration only.

Tencent documents `MatchTag` as matched, inserted, missing, misread, or not in
the recording/dictionary. It also documents sentence mode as at most 30 English
words and synchronous recording mode as one complete audio item. Enforce those
limits before the paid call.

### 4.2 Deterministic application logic

The application, not Tencent, owns:

- authentication and material/Segment authorization;
- recording format, duration, byte-size, silence, and clipping validation;
- transcript reveal counts and persistence;
- exact reference text and unscored-word policy;
- one-in-flight, rate limits, global budgets, idempotency, deduplication;
- mapping provider words to stable reference-word indices;
- calibrated score transformation from an approved policy;
- red/yellow/normal state rules;
- red-word score cap;
- fixed pass line 80;
- best score, To Improve, completion, auto-advance, assignments;
- temporary file retention and deletion;
- notification and audit projections.

### 4.3 Must be validated empirically

Do not present these as guarantees until the benchmark gate passes:

- tolerance of British, American, and other intelligible accents;
- treatment of weak forms, linking, assimilation, and unreleased stops;
- red/yellow thresholds;
- raw-to-product score calibration;
- false pass and false fail rates around 80;
- word-location accuracy;
- score repeatability on the same recording;
- real-device median/P95 latency;
- microphone/VAD thresholds across iPhone, iPad, Android, and desktop.

## 5. Current-to-target migration

### 5.1 Keep compatibility URLs

Keep these paths so existing links continue working:

- `intensive-listening-library.html`
- `intensive-listening.html`

Rename visible headings, labels, confirmation text, and accessible names to
`Listening`. Do not rename the files during V1.

### 5.2 Legacy material fallback

Current live material has `audio_src`, `content_version`, and `units[]`.
The service must normalize it into the V2 domain without requiring an immediate
production rewrite:

```text
media.kind              = audio
media.src               = audio_src
tracks.dictation.enabled = true
tracks.dictation.revision = content_version
tracks.dictation.segments = units
tracks.shadowing.enabled = true for current reviewed BBC materials
tracks.shadowing.revision = "shadowing-derived-v1"
tracks.shadowing.segments = content-bearing non-Skip units mapped to stable IDs
```

Do not expose the private `text` during Dictation bootstrap or pre-reveal
Shadowing bootstrap. Derived Shadowing is a compatibility fallback; the first
teacher publication writes an explicit V2 Track.

For a material explicitly carrying V2 `tracks`, obey its enabled flags and do
not apply the fallback.

### 5.3 Existing progress

- Existing `intensive_listening_progress` remains authoritative Dictation
  progress.
- Do not rewrite old progress into Shadowing.
- New Shadowing progress starts empty.
- Preserve old `content_version` compatibility identity for Dictation.
- Add explicit `dictation_revision` and `shadowing_revision` in V2 projections.

### 5.4 Existing assignments

Legacy `IL-*` assignments with no Track selection become Dictation-only.
Do not silently require Shadowing for an existing student task.

## 6. Target architecture

```text
Dashboard Listening entrance
    -> Listening material catalog
        -> one card per material
        -> enter Listening material

BBC / IELTS exercise card
    -> one Listening action
        -> same Listening material

Listening material shell
    -> internal mode chooser
        -> Dictation runtime (existing path, corrected reveal flow)
        -> Shadowing runtime
            -> local capture + free validation
            -> reserve exact private take
            -> CloudBase Storage upload
            -> finalize + server validation + quota reservation
            -> Tencent SOE-N adapter
            -> calibrated score + stable word feedback
            -> progress + take + usage ledger
            -> seven-day cleanup worker

Teacher Listening workspace
    -> list/get/save draft/validate/preview/publish/hide
    -> Test scoring uses the same paid path and usage ledger
```

Keep the existing `intensiveListening` function as the authenticated feature
gateway. Add a small isolated `tencent-soe-n.js` provider module and pure
`shadowing-service.js` domain module. Add a maintenance function only for
cleanup/recovery; do not place provider calls in the browser.

## 7. Visual and interaction specification

### 7.1 Design relationship

Listening must look intentionally related to Writing and Speaking, not like a
separate template:

- same system font stack and optical hierarchy;
- same light neutral page background;
- same sparse floating toolbar geometry;
- same restrained glass material and border treatment;
- same card radius family and press feedback;
- same modal/sheet dimming behavior;
- same navigation logic and safe return behavior.

Use Speaking's two-mode composition as a structural reference and Writing's
focused work surface as a density reference. Do not copy their colours
verbatim. Listening's accent remains a subdued teal/blue-green.

### 7.2 Apple-style rules with measurable constraints

1. Light interface only for this release; background is near-white, never black.
2. Use one restrained page tint plus low-opacity local washes. No saturated
   full-card gradients, glowing neon borders, decorative blobs, or confetti.
3. Default surfaces:
   - background opacity approximately `.72–.90`;
   - blur approximately `18–26px` only on floating chrome;
   - border approximately `rgba(255,255,255,.65–.85)`;
   - one soft ambient shadow plus subtle inset highlight.
4. Use system fonts. Large headings use negative tracking around `-.03em` to
   `-.05em`; small labels may use slight positive tracking.
5. Controls respond on pointer-down with scale around `.97–.98` in 100–140ms.
6. Do not animate layout height continuously while the learner types/records.
7. Mode transitions start from the current surface and use a critically damped,
   non-bouncy 300–400ms transform/opacity treatment.
8. Auto-advance uses a brief completion state, then a spatially consistent
   replacement; no carousel flourish.
9. Destructive or privacy-significant actions may confirm. Ordinary mode
   selection, retry, reveal setting, and navigation do not need confirmation.
10. Every screen answers where the learner is, what to do now, current Segment
    position, and how to leave.

### 7.3 Listening catalog

- Toolbar title: `Listening`.
- Keep source filter, search, newest/oldest, and one material card per material.
- A card may show safe Dictation and Shadowing progress because this catalog is
  inside Listening.
- Never surface this Track progress inside ordinary Dashboard Library cards.
- Show enabled modes as quiet text or a compact segmented summary, not bright
  badges.
- Primary action is `Start`, `Continue`, or `Review` based on the selected
  material's internal progress; opening still leads to the internal mode logic.

### 7.4 Mode chooser

- Two equal cards on tablet/desktop, one column on narrow phones.
- Dictation card: quiet text-entry symbol and one-sentence explanation.
- Shadowing card: quiet microphone/wave symbol and one-sentence explanation.
- Show independent progress in each card.
- No giant English marketing title, leaderboard, or decorative illustration.
- Entire card is the target; visible button text is optional when mapping is
  obvious, but keyboard focus and accessible labels are required.

### 7.5 Dictation work surface

- Preserve the word-slot interaction and keyboard behavior.
- Reduce the current oversized hero/stats treatment. The material title, mode,
  Segment position, compact progress, media control, word slots, feedback, and
  actions should fit as one focused task hierarchy.
- `Show Answer`/`Hide` is a toggle in the same position.
- When answer hides due to word-slot focus, keep focus in the selected slot and
  announce `Answer hidden` through the status region.
- Teacher-only export and preview tools remain visually secondary.

### 7.6 Shadowing work surface

Order the content as follows:

1. compact material/mode/Segment context;
2. audio or video stage;
3. listen-count control and reveal threshold;
4. one primary record control;
5. local recording state/wave level;
6. evaluation waiting state;
7. one large score;
8. transcript word feedback only when transcript is revealed;
9. `Try Again` and `Continue` only when score is below 80.

Record control states:

```text
ready -> requesting_permission -> recording -> validating -> uploading
      -> evaluating -> passed | retryable_result | retryable_error | outcome_unknown
```

Use plain, specific labels. Do not fake a numeric progress bar during provider
evaluation. Use an indeterminate status and preserve the take locator so refresh
can resume polling.

### 7.7 Responsive behavior

- Desktop: maximum content width aligned with Writing/Speaking; toolbar floats
  inside the same outer margins.
- iPad portrait/landscape: no horizontal page overflow; video remains within
  the content card; mode cards may be two columns when each remains at least
  300px.
- Phone: single-column mode cards, 44px minimum targets, safe-area padding,
  transcript wraps normally, actions remain reachable above the browser bottom
  inset.
- Rotation preserves the active Segment, recording state, and draft inputs.
- Do not rely on hover.

### 7.8 Accessibility

- Full keyboard navigation and visible focus.
- `aria-live` for recording, validation, evaluation, score, pass, and
  auto-advance status.
- Red/yellow word states include distinct underline patterns and accessible
  labels.
- Honour `prefers-reduced-motion`, `prefers-reduced-transparency`, and
  `prefers-contrast`.
- Reduced Motion replaces slide/spring motion with short cross-fades.
- Reduced Transparency uses opaque near-white surfaces and removes blur.
- Do not autoplay audio on initial page load; playback begins from an explicit
  user action.

## 8. Data model

All collections are `ADMINONLY`.

### 8.1 Extend `intensive_listening_materials`

Keep current fields and add V2 fields:

| Field | Type | Rule |
| --- | --- | --- |
| `schema_version` | number | `2` for explicit dual-Track material |
| `media` | object | `{ kind: audio|video, src, mime_type }` |
| `transcript_revision` | string | shared transcript compatibility identity |
| `tracks.dictation` | object | enabled, revision, ordered segments |
| `tracks.shadowing` | object | enabled, revision, ordered segments |
| `linked_practice_set_id` | string/null | zero or one exercise |
| `publication_status` | string | draft is separate; live row is published/hidden |
| `published_at/by` | date/string | current publication audit |

Dictation Segment:

```json
{
  "segment_id": "dict_001",
  "start_seconds": 1.25,
  "end_seconds": 4.8,
  "speaker": "Neil",
  "text": "Private reviewed text",
  "practice_mode": "dictation",
  "slots": []
}
```

Shadowing Segment:

```json
{
  "segment_id": "shadow_001",
  "start_seconds": 1.25,
  "end_seconds": 4.8,
  "speaker": "Neil",
  "text": "Private reviewed text",
  "practice_mode": "shadowing",
  "reference_words": [
    { "word_id": "rw_001", "text": "Private", "unscored": false }
  ]
}
```

Context Only and Skip are legal in each Track. Only training Segments count.

### 8.2 New `listening_material_drafts`

One current teacher draft per material:

- `draft_id`, `material_id`, `base_publication_revision`;
- `draft_revision` for optimistic concurrency;
- complete private proposed material;
- `validation` summary;
- `created_at/by`, `updated_at/by`;
- no student progress.

### 8.3 New `listening_material_history`

Immutable publication snapshots:

- stable history ID;
- material ID;
- previous and new common/Track revisions;
- impact classification: Dictation, Shadowing, or Both;
- teacher UID and timestamp;
- private material snapshot or bounded audit reference.

Students never query this collection.

### 8.4 New `listening_shadowing_progress`

One current record per `student_uid + material_id + shadowing_revision`:

- `progress_id`, student/material/revision identity;
- `reveal_threshold` (`1|2|3|5|off`);
- `segment_states` keyed by stable Segment ID;
- `qualified_segment_count`, `segment_count`, `percentage`;
- `completed`, `completed_at`;
- active notification-session metadata;
- created/updated timestamps.

Each Segment state stores only:

- `complete_listen_count`;
- `transcript_revealed`;
- `best_score`;
- `best_take_id`;
- `best_word_states` with stable word IDs and `normal|yellow|red|unscored`;
- `qualified`, `assisted`, `independent`;
- `in_to_improve`;
- safe latest timestamp.

### 8.5 New `listening_shadowing_takes`

Immutable or append-only terminal metadata for each valid logical take:

- `take_id` and unique `student_uid + client_take_id` identity;
- student/material/Segment/reference/revision identity;
- upload path/file ID while retained;
- byte size, duration, audio hash;
- lifecycle status;
- provider and scoring-policy revisions;
- raw private provider scores/evidence, bounded and free of secrets;
- product score and stable word states;
- Independent/Assisted snapshot;
- `delete_after`, `audio_deleted_at`, cleanup status;
- created/uploaded/evaluated timestamps;
- safe categorized error;
- no full log copy and no public URL.

Terminal lifecycle values:

```text
reserved | uploaded | validating | evaluating | scored | invalid |
provider_failed | outcome_unknown | rejected_quota
```

Never change a scored take's score. Progress may point to a newer better take.

### 8.6 New `listening_shadowing_usage`

Append-only cost/idempotency ledger:

- call/take/student/material/Segment IDs;
- client take ID and audio/reference hashes;
- provider and scoring-policy revisions;
- reserved/sent/terminal status;
- estimated billable unit count;
- bounded provider request ID and safe error category;
- timestamps.

Never store base64 audio, secrets, student names, full transcript, or signed URL.

### 8.7 New `listening_assignment_tracks`

One row per required Track under one `assignments` parent:

- `participation_id`, `assignment_id`, `student_uid`, `set_id`, `track`;
- `status: to_do|completed|cancelled`;
- progress count/total/percentage projection;
- completed/updated timestamps.

Unique identity:

```text
assignment_id + track
```

Legacy assignment with no rows is projected as Dictation-only.

### 8.8 `system_config` scoring policy

Add one private config record such as
`listening_shadowing_score_policy`:

- `status: draft|approved|disabled`;
- `revision`;
- raw-to-product calibration coefficients or lookup table;
- red/yellow word thresholds;
- pass line fixed at 80;
- allowed score coefficient;
- benchmark metadata and approval timestamp.

Production provider calls fail closed unless status is `approved`.

## 9. API contract

Continue using authenticated `intensiveListening` and keep old actions working.
Every action returns `{ success }` and a stable safe `code` on failure.

### 9.1 Student/catalog actions

- `listCatalog`: safe material metadata and safe per-Track progress for the
  dedicated Listening catalog only.
- `bootstrap`: material shell metadata, enabled Tracks, assignment requirement,
  and safe progress. Never return pre-reveal Shadowing transcript.
- `getTrack`: track-specific redacted Segments.
- `setRevealThreshold`: validate and store 1/2/3/5/off.
- `recordCompleteListen`: server validates Segment/Track and increments once per
  unique complete-play token. Browser timers alone are not authoritative.
- Preserve Dictation `check`, `reveal`, `policy`, `startReplay`, and spelling
  actions with corrected reveal semantics.

### 9.2 Take actions

- `reserveShadowingTake`
- browser uploads live-captured WAV to the exact reserved private path
- `finishShadowingTake`
- `getShadowingTake`
- `continueShadowingSegment`

`reserveShadowingTake` validates:

- active student;
- visible material;
- Shadowing enabled;
- scored Segment belongs to current revision;
- assignment ownership when supplied;
- no other in-flight take;
- rate/global budget availability;
- stable `client_take_id` idempotency.

`finishShadowingTake` validates:

- same authenticated owner and reserved take;
- exact reserved Storage path and returned file ID;
- expected maximum size;
- WAV decode, PCM 16kHz/16-bit/mono;
- duration bounded by Segment duration plus grace;
- non-silent/non-corrupt audio;
- audio hash and exact-duplicate cache;
- current reference/scoring/provider revision.

It then claims one call, sends exactly one Tencent request, persists the result,
updates progress and assignment participation, and returns the safe result. If
the function loses certainty after sending, mark `outcome_unknown`; do not send
again automatically.

### 9.3 Teacher actions

- `listTeacherMaterials`
- `getTeacherMaterial`
- `createMaterialDraft`
- `saveMaterialDraft`
- `validateMaterialDraft`
- `publishMaterialDraft`
- `discardMaterialDraft`
- `setMaterialVisibility`
- future owner-gated `testShadowingScore` after the scoring benchmark is
  approved; it is not part of the local authoring release
- existing immediate Provided Word approval/export actions

Every teacher action verifies active teacher role. Draft save uses optimistic
`draft_revision`; stale clients receive a conflict and must reload.

## 10. Tencent SOE-N adapter

Create `cloudfunctions/intensiveListening/tencent-soe-n.js`.

### 10.1 Configuration

Read only environment values:

- `TENCENTCLOUD_APPID`
- `TENCENTCLOUD_SECRETID`
- `TENCENTCLOUD_SECRETKEY`
- bounded endpoint override for tests only;
- `LISTENING_SHADOWING_SCORING_ENABLED`.

Never accept these from an event. Validate the endpoint hostname and WSS scheme.

### 10.2 Request

- `wss://soe.cloud.tencent.com/soe/api/<appid>`
- HMAC-SHA1 signature over sorted, non-URL-encoded parameters as documented;
- URL-encode every actual query key/value including signature;
- unique UUID `voice_id`;
- `server_engine_type=16k_en`;
- `eval_mode=1`;
- `rec_mode=1`;
- `voice_format=1` for WAV;
- `text_mode=0` unless a reviewed explicit pronunciation format is later added;
- approved policy `score_coeff` only;
- maximum 30 English reference words;
- once-only complete binary WAV send followed by the required
  `{"type":"end"}` text message;
- bounded connect/result timeout below the Cloud Function timeout.

Add a direct `ws` dependency to this function only if Node 18 does not provide
the required WebSocket client. Record that dependency in `docs/06_DECISIONS.md`
and package it with the function; do not rely on a transitive dependency.

### 10.3 Response normalization

Return a private normalized object:

```json
{
  "provider": "tencent_soe_n",
  "provider_revision": "soe-n-wss-v1",
  "request_id": "bounded",
  "suggested_score": 0,
  "pron_accuracy": 0,
  "pron_fluency": 0,
  "pron_completion": 0,
  "words": [
    {
      "reference_word": "...",
      "word": "...",
      "match_tag": 0,
      "pron_accuracy": 0,
      "begin_ms": 0,
      "end_ms": 0
    }
  ]
}
```

Keep phoneme arrays private only when needed for benchmark audit; never project
them to the learner and bound their stored size.

### 10.4 Error classes

Map provider text/codes to stable categories:

- not configured;
- invalid reference;
- invalid audio;
- quota/rate limited;
- provider unavailable;
- timeout before send;
- outcome unknown after send;
- invalid provider response.

Do not show raw provider error strings to students.

## 11. Capture and local validation

Implement a browser WAV encoder using Web Audio APIs or reuse an existing
dependency-free recorder pattern. Do not upload browser-native WebM and expect
the provider to normalize it.

Required output:

- PCM WAV;
- 16,000 Hz;
- 16-bit;
- mono.

Free local validation before reservation/upload:

- microphone permission;
- non-empty frames;
- minimum voiced duration;
- maximum duration from Segment length plus grace;
- RMS/silence check;
- clipping ratio warning/failure threshold;
- maximum encoded bytes;
- no simultaneous audible Source Media.

Server repeats every security-relevant validation. Browser validation exists
for speed and cost protection, not trust.

## 12. Scoring and word feedback

Create pure functions in `shadowing-service.js` and unit-test them heavily.

### 12.1 Reference mapping

1. Tokenize only from the reviewed teacher transcript.
2. Keep stable `word_id` values.
3. Normalize apostrophes/case for alignment without changing displayed text.
4. Align Tencent `ReferenceWord`/`MatchTag` entries to stable reference indices.
5. Inserted provider words do not create learner-visible transcript words.
6. Missing/misread/unrecorded reference words map red.
7. Unscored words are excluded before score aggregation and render `unscored`.
8. Ambiguous alignment biases toward yellow/neutral, never an unsupported red.

### 12.2 Product score

1. Read the approved private scoring policy.
2. Transform documented raw evidence into one rounded integer.
3. Clamp 0–100.
4. If any scored reference word is red, cap at 79.
5. `score >= 80` qualifies.
6. Store raw evidence privately and product output separately.
7. Never silently recompute an old take after a policy revision.

### 12.3 Duplicate cache

Cache/reuse only when all are identical:

- audio hash;
- Segment/reference hash;
- material/Shadowing revision;
- unscored-word policy;
- scoring-policy revision;
- provider/protocol revision.

A cache hit must still create the logical Student Take metadata and update the
current learner's progress, but must not create a second paid-call ledger row.

## 13. Abuse and cost controls

Enforce on the server even if the browser is modified:

1. One in-flight paid evaluation per student.
2. Short minimum interval between accepted valid takes.
3. Initial adjustable limits:
   - 6 valid evaluations per Segment per 10 minutes;
   - 60 per student per hour;
   - 250 per student per Shanghai calendar day.
4. Shared school IP is a secondary signal only, never the primary identity.
5. Global daily budget from private configuration.
6. Alert thresholds at 50%, 75%, 90%, and 100%.
7. At 100%, reject new provider calls without damaging prior progress.
8. Multi-tab limits use server state.
9. A stable `client_take_id` and unique index prevent double click/retry billing.
10. The server owns reference text, Segment, engine, mode, strictness, and
    provider parameters.
11. Reject Context Only/Skip scoring.
12. Reject forged student UID, arbitrary transcript, arbitrary Segment, file
    upload, or provider parameters.
13. One-time upload reservation: exact path, owner, purpose, expiry, and
    single-use.
14. No automatic retry after ambiguous provider timeout.
15. 429 may wait/retry the same unsent reservation only; provider 5xx is
    bounded; auth/billing errors open a circuit breaker.
16. Reconcile app usage ledger with Tencent console outside the student request.

## 14. Temporary audio lifecycle

Create `cloudfunctions/listeningMaintenance` or an equivalently isolated
maintenance module invoked by an owner-configured timer.

Responsibilities:

- delete scored valid audio at or after `delete_after`;
- delete invalid/orphaned/unclaimed uploads earlier;
- retry deletion idempotently;
- mark `audio_deleted_at` only after confirmed deletion;
- find old `reserved/uploaded/validating` rows and resolve safely;
- never retry `outcome_unknown` provider calls;
- emit bounded operational counts, not file IDs or student data.

The student request must not wait for seven-day cleanup. Production provider
retention must be documented separately; app deletion does not claim provider
deletion.

## 15. Assignments and progress projection

### 15.1 Teacher Assign UI

For a Listening row:

- show Due week;
- show one segmented Track control: Dictation / Shadowing / Both;
- hide Passing %, Earn STAR, and Mastery %;
- default legacy/current material to enabled Tracks, preferring Both when both
  are available;
- reject selection of a disabled Track.

### 15.2 Backend creation

Create one parent `assignments` row and one or two
`listening_assignment_tracks` rows in a transaction or compensating idempotent
workflow. Store `assignment_kind: listening` and
`required_listening_tracks` on the parent as a safe projection.

### 15.3 Completion

- Dictation participation completes when every Dictation Segment completes.
- Shadowing participation completes when every Shadowing Segment qualifies.
- Parent assignment becomes `passed`/FINISHED only when every required
  participation is complete.
- No `mastered`, no STAR, no percentage threshold.
- Cancellation cancels parent and participation rows but preserves learning
  progress and takes.

### 15.4 Dashboard

One grouped assignment card shows required mode names and safe progress. Do not
render two task cards for Both. Existing self-study progress remains in the
Listening workspace; ordinary Library still shows only exercise progress.

## 16. Notifications

Extend current safe Listening session infrastructure rather than creating fake
attempts.

- Add `practice_track: dictation|shadowing`.
- Use Track-specific thread identity or include Track in the self-study thread
  key so one active mode cannot close the other's session.
- Shadowing starts only after the first valid evaluated take is durably stored.
- A later stored take, new qualified Segment, or To Improve change refreshes
  activity.
- Complete immediately when the selected Track completes.
- Idle close is three minutes.
- Teacher bell and email labels are `Listening · Dictation` or
  `Listening · Shadowing`.
- Safe summary fields are progress counts and percentage only.
- Existing Dictation notification behavior remains, with renamed copy.

## 17. Teacher Listening workspace

### 17.1 Navigation

Add one first-level `Listening` item to the existing Teacher sidebar using the
same geometry, typography, responsive collapse, active state, and keyboard
behavior as View/Assign/Library/Speaking.

### 17.2 Material list

Each row/card shows:

- title and source;
- audio/video;
- enabled Tracks;
- linked exercise;
- Draft/Published/Hidden;
- last update.

Search and source/status filters must remain usable on iPad and phone.

### 17.3 Editor

Use one common editor plus a three-way segmented control:

```text
COMMON | DICTATION | SHADOWING
```

Common fields:

- title, source labels, publication date;
- media kind/src/mime;
- full reviewed transcript;
- linked exercise;
- enable Dictation and/or Shadowing.

Track timeline requirements:

- native or custom media player with current time;
- ordered Segment list;
- numeric start/end fields;
- drag handles when practical, with numeric fields authoritative;
- preview Segment;
- edit text and speaker;
- split, merge, reorder;
- set training, Context Only, or Skip;
- visible validation errors near the affected Segment.

Dictation-only tools:

- slots and Provided Words;
- immediate Show Answer;
- student preview;
- Export Latest JSON;
- spelling policy audit.

Shadowing-only tools:

- stable reference words;
- Unscored toggles;
- silent video dubbing preview;
- transcript reveal preview;
- real `Test scoring`.

`Test scoring` clearly states that it uses one evaluation. It uses the same
validation, provider adapter, policy, ledger, quota, and temporary retention as
student takes, but uses a teacher test context and never changes student
progress.

### 17.4 Validation and publish

Deterministically validate before publish:

- at least one Track enabled;
- media valid for kind;
- finite ordered timestamps within media duration;
- no unintended overlap within a Track;
- provider-scored Segment has 1–30 English words;
- nonempty reviewed text for training Segments;
- valid Dictation slots;
- Unscored words belong to the reference;
- Context Only/Skip do not count;
- linked exercise exists and is a listening exercise;
- revision impact is classified.

Workflow:

```text
Draft -> Validate -> Preview Dictation -> Preview Shadowing ->
Impact confirmation -> Publish
```

The impact confirmation explicitly names which Track progress will be
recalculated. Publish is transactional/idempotent and writes immutable history.

## 18. Content authoring and importer

Update `scripts/import-intensive-listening.js` without exposing transcript text
to public files.

- Accept schema V1 and V2.
- Normalize `listen_only` input to `context_only` in V2 output.
- Preserve V1 import compatibility.
- Support media kind/audio/video metadata.
- Support shared transcript plus independent Track Segments.
- Support enabled Track flags and Shadowing Unscored words.
- Generate only safe public catalog metadata.
- Keep `catalogVisible: false` for ordinary Library.
- Keep one inverse `Listening` link on the BBC/IELTS exercise.
- Do not write Shadowing transcript or reference words under `data/`.
- Export teacher-edited V2 source JSON with both Tracks and current revisions.

## 19. Documentation and ADR updates

Update in the same implementation:

- `README.md`
- `CONTEXT.md` only if implementation discovers a genuine domain term gap
- `docs/01_PRODUCT_REQUIREMENTS.md`
- `docs/02_ARCHITECTURE.md`
- `docs/03_UI_UX_SPEC.md`
- `docs/04_DATA_MODEL.md`
- `docs/05_CHANGELOG.md`
- `docs/06_DECISIONS.md`
- `docs/07_TESTING_CHECKLIST.md`
- `docs/08_BACKLOG.md` for benchmark/deployment-only remainder
- `docs/09_CONTENT_WORKFLOW.md`
- `docs/10_DEPLOYMENT.md`
- `docs/11_AGENT_TROUBLESHOOTING.md`

Create `docs/adr/0006-tencent-soe-n-shadowing-assessment.md` recording:

- Tencent-only decision for mainland availability;
- server-side WSS adapter and credential boundary;
- approved-policy gate;
- post-record rather than live evaluation;
- no provider failover;
- seven-day raw audio retention;
- alternatives considered and consequences.

## 20. File-by-file execution map

Inspect and modify as necessary:

### Student UI

- `intensive-listening-library.html`
- `assets/css/intensive-listening-library.css`
- `assets/js/intensive-listening-library.js`
- `intensive-listening.html`
- `assets/css/intensive-listening.css`
- `assets/js/intensive-listening.js`
- add focused modules only if they reduce risk, for example
  `assets/js/listening-recorder.js` and `assets/js/listening-shadowing.js`
- `dashboard.html` and `assets/js/dashboard.js` only for naming/confirmation or
  assignment projection changes
- `bbc.html`
- `ielts-listening.html`

### Teacher UI

- `teacher.html`
- `assets/js/teacher.js`
- `assets/css/app.css`
- reuse `assets/css/spatial-workspace.css` patterns; add a dedicated
  `assets/css/teacher-listening.css` only if it keeps the large shared stylesheet
  safer

### Backend

- `cloudfunctions/intensiveListening/index.js`
- `cloudfunctions/intensiveListening/service.js`
- add `cloudfunctions/intensiveListening/shadowing-service.js`
- add `cloudfunctions/intensiveListening/tencent-soe-n.js`
- `cloudfunctions/intensiveListening/package.json` and lockfile if `ws` is used
- `cloudfunctions/intensiveListening/cloudbaserc.json` timeout/memory only when
  justified and documented
- add `cloudfunctions/listeningMaintenance/` if cleanup cannot safely reuse an
  existing private timer worker
- `cloudfunctions/teacherAdmin/index.js`
- `cloudfunctions/_shared/intensive-listening-notifications.js`
- `cloudfunctions/sendTeacherAttemptEmails/` for Track-safe session delivery
- dashboard/report functions that project assignment status

### Content/build

- `scripts/import-intensive-listening.js`
- `scripts/prepare-cloudbase-data.js`
- `scripts/build-static-site.js`
- `scripts/package-cloudfunctions.js` if a new function is added
- `scripts/generate-deploy-plan.js`
- `package.json`

### Tests

- preserve and update `scripts/test-intensive-listening.js`
- replace outdated dedicated-library assertions in
  `scripts/test-intensive-listening-library.js`
- add `scripts/test-listening-shadowing.js`
- add `scripts/test-listening-shadowing-provider.js`
- add `scripts/test-listening-authoring.js`
- extend assignment, dashboard, notification, packaging, and release tests
- fix the pre-existing `requestAnimationFrame` VM shim in
  `scripts/test-assignment-due-weeks.js`

## 21. Implementation sequence

Follow this order. Keep the site runnable after each milestone.

### Milestone 1 — Rename and compatibility foundation

- Add V2 material normalizer and pure Track helpers.
- Rename visible UI to Listening.
- Preserve old URLs and existing Dictation tests.
- Correct Dictation Show Answer/Hide behavior.
- Update direct BBC/IELTS label to Listening.

Gate:

```bash
npm run test:intensive-listening
npm run test:intensive-listening-library
```

### Milestone 2 — Dual-Track UI with deterministic fixtures

- Add mode chooser and Shadowing state machine.
- Add audio/video media abstraction.
- Add reveal threshold/listen count.
- Add local WAV capture/validation.
- Add deterministic test-only scoring fixtures inaccessible from production
  browser actions.
- Complete Apple-style responsive CSS and accessibility.

Gate: new UI/domain tests plus manual viewport review.

### Milestone 3 — Durable Shadowing backend

- Add collections/schema helpers, take lifecycle, progress, idempotency,
  quotas, duplicate cache, and assignment participation.
- Add provider-policy fail-closed behavior.
- Add Tencent adapter with mocked network tests.
- No real provider call in automated tests.

Gate: provider signature/normalization/error tests and service tests.

### Milestone 4 — Teacher authoring

- Add Teacher Listening workspace.
- Implement draft/get/save/validate/publish/hide.
- Implement common/Dictation/Shadowing timeline editing.
- Implement preview and test scoring.
- Preserve spelling approval and export.

Gate: authoring authorization, validation, concurrency, and impact tests.

### Milestone 5 — Assignments, notifications, and cleanup

- Add Track selection and grouped task projection.
- Add Track-safe sessions and email/bell summaries.
- Add seven-day cleanup/recovery worker.
- Add package/deploy-plan coverage.

Gate: assignment, notification, cleanup, package, and report regression tests.

### Milestone 6 — Documentation and full verification

- Update all numbered docs and ADR.
- Update cache-busting query strings once.
- Build static artifact and inspect exclusion of private content.
- Run every test in section 23.

## 22. Benchmark and production enablement gate

Implementation may ship locally with provider integration disabled. Do not
enable production Shadowing scoring until a teacher-reviewed benchmark exists.

Recommended benchmark:

- 20–30 students;
- approximately 20 sentences each;
- 400–600 clips;
- mixed levels, accents, devices, noise, omissions, substitutions;
- teacher pass/fail and problem-word labels.

Provisional release gates:

- pass/fail agreement at least 85%;
- false pass no more than 10%;
- false fail no more than 10%;
- problem-word location agreement at least 80%;
- repeated identical audio normally within 3 score points;
- production-like P95 result latency no more than 4 seconds.

Raw benchmark audio still follows seven-day deletion. Retain labels and safe
results. If the gate fails, keep `status: draft|disabled`; do not lower the
product standard silently.

## 23. Verification matrix

### 23.1 Focused automated tests

Add scripts and run:

```bash
npm run test:intensive-listening
npm run test:intensive-listening-library
npm run test:listening-shadowing
npm run test:listening-shadowing-provider
npm run test:listening-authoring
npm run test:assignment-schedule
npm run test:attempt-emails
npm run test:learning-reports
npm run test:parent-mode
npm run test:writing-tutor
npm run test:speaking-lab
npm run test:teacheradmin-package
npm run package:functions -- intensiveListening listeningMaintenance teacherAdmin sendTeacherAttemptEmails
npm run verify:release
git diff --check
```

If `listeningMaintenance` is not created, omit it from the package command and
document which existing worker owns cleanup.

### 23.2 Security/cost cases

Test all of these:

- double click;
- refresh after upload;
- two tabs;
- same audio with new client ID;
- forged UID/reference/Segment/Track/provider params;
- Context Only/Skip scoring attempt;
- invalid/corrupt/wrong-format/silent/too-long audio;
- upload to wrong Storage path;
- expired/resused reservation;
- 6/10m, 60/h, 250/day, and global cap;
- Tencent 429, 5xx, auth failure, malformed response;
- timeout before send and ambiguous timeout after send;
- crash after provider success but before browser response;
- duplicate cached evaluation;
- seven-day and orphan cleanup;
- logs and responses contain no secret/transcript/audio/base64/private URL.

### 23.3 Product cases

- legacy material opens Dictation and derived Shadowing without data rewrite;
- explicit Dictation-only/Shadowing-only/both materials;
- BBC and IELTS one Listening entry, no Track display in ordinary Library;
- stand-alone Listening-only material from Dashboard catalog;
- Dictation Show Answer -> Hide -> slot focus hides -> must finish Segment;
- teacher immediate reveal and Provided Word approval;
- audio listen then record;
- video silent dubbing with muted source audio;
- reveal 1/2/3/5/off and complete-play counting;
- pre-reveal pass Independent; post-reveal pass Assisted;
- red caps 79; yellow can pass; unscored does not affect score;
- pass auto-advances after about one second;
- below 80 Try Again/Continue and To Improve completion;
- best score never falls;
- no Shadowing Argue or override;
- Both assignment one card/two participations;
- legacy assignment remains Dictation-only;
- common/Track-specific publication impact;
- hidden material preserves history.

### 23.4 Visual QA

Inspect real rendered pages at minimum:

- 1440×900 desktop;
- 1180×820 iPad landscape;
- 820×1180 iPad portrait;
- 390×844 phone;
- 320px narrow phone;
- increased text size;
- Reduced Motion;
- Reduced Transparency;
- increased contrast.

Compare side by side with current Writing and Speaking. Reject the first pass if
Listening has louder colour, heavier shadows, larger decorative areas, denser
toolbar controls, weaker typography, or inconsistent card geometry.

Use browser screenshots for review. Confirm no horizontal overflow, clipped
modals, unreachable actions, layout jumps, or auto-advance focus loss.

## 24. Acceptance checklist

Implementation is complete only when all are true:

- [ ] Visible product name is Listening.
- [ ] Ordinary Library has one Listening link and no Track/progress additions.
- [ ] Dashboard Listening catalog contains one card per material.
- [ ] Mode choice exists only inside Listening.
- [ ] Dictation behavior and history are preserved, with corrected answer hide.
- [ ] Shadowing audio and video flows work with deterministic tests.
- [ ] Pre-reveal transcript is absent from the browser response.
- [ ] One score, red/yellow/normal feedback, pass 80, red cap 79.
- [ ] To Improve and best-score logic are correct.
- [ ] Tencent calls are server-only, once-only, policy-gated, and cost-limited.
- [ ] No fake score is produced during provider failure.
- [ ] Raw take audio deletes after seven days and invalid audio deletes sooner.
- [ ] Teacher Listening editor can change Segment timing/text and publish safely.
- [ ] Teacher Test scoring is counted and disclosed.
- [ ] Listening assignments use Track selection and one grouped card.
- [ ] Notifications distinguish Dictation/Shadowing and obey three-minute idle.
- [ ] Apple-style visual QA passes across desktop, iPad, and phone.
- [ ] Accessibility preference modes work.
- [ ] All documentation, tests, package rules, and cache versions are current.
- [x] Deployment mutations are recorded in the 2026-09-05 rollout record;
  provider scoring remains disabled pending benchmark approval.

## 25. Executor handoff

The implementing agent must finish with a concise report containing:

1. files changed;
2. product behavior implemented;
3. data/CloudBase resources required but not created;
4. provider configuration required but not requested;
5. tests run with exact pass/fail result;
6. visual viewport checks performed;
7. remaining benchmark/deployment gates;
8. any deviation from this plan and why.

Do not claim production readiness when the scoring policy benchmark, Tencent
configuration, collections/indexes, function deployment, data import, or static
publication remains owner-gated.
## 本地执行记录（2026-09-05）

本地工作树已完成第一版可运行纵向切片：统一 Listening 入口与模式选择、
Dictation 兼容/`listen_only` 归一化、Shadowing 保密前端与 reserve/upload/
finish 后端、SOE-N 隔离适配器、评分/配额/幂等/WAV 清理边界、教师
Listening 编辑器、轨道作业记录、内容导入字段、维护函数、ADR 0006 与
自动化测试。未创建 CloudBase 集合/索引/定时器，未批准真实评分策略，未
配置密钥，未部署或发布。全仓库 29 组测试、静态构建、发布校验、云函数打包、
差异格式检查，以及实际浏览器的浅色桌面/平板与 390×844 手机 Shadowing
视觉检查均已通过；视觉检查后把录音、切句和阈值控件统一提高到 44px 触控
尺寸。完整生产验收仍需 owner-gated Tencent 真实评分基准、CloudBase 集合/
索引/定时器配置、函数部署、数据迁移与线上 smoke test；这些不得由本地实现
代替。
