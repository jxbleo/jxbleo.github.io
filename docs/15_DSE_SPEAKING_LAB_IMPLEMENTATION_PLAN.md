# DSE Speaking Lab V1 — Detailed Engineering Implementation Plan

> Status: approved product decisions; implementation-ready local plan.
>
> Audience: coding agents, including lower-capability agents. Follow the file
> boundaries, state machines, authorization rules, schemas, and test gates in
> this document exactly. Do not simplify privacy or durable-job behavior.
>
> Deployment status: local implementation only. Creating CloudBase collections,
> adding indexes, configuring provider credentials/timers, uploading functions,
> or publishing the static site remains owner-gated.

## 0. Executor protocol

### 0.1 Read before editing

Read these sources in this order. Do not begin implementation from this plan
alone:

1. `AGENTS.md`
2. `README.md`
3. `CONTEXT.md`, especially `DSE Speaking Lab`
4. `docs/01_PRODUCT_REQUIREMENTS.md`
5. `docs/02_ARCHITECTURE.md`
6. `docs/03_UI_UX_SPEC.md`
7. `docs/04_DATA_MODEL.md`
8. `docs/07_TESTING_CHECKLIST.md`
9. `docs/10_DEPLOYMENT.md`
10. `docs/11_AGENT_TROUBLESHOOTING.md`
11. `docs/adr/0003-durable-canonical-ai-boundaries.md`
12. `docs/adr/0004-discussion-scoped-voice-identity-and-share-snapshots.md`
13. the current source files listed in section 18 of this plan

### 0.2 Baseline commands

Run and record the result before editing:

```bash
git status --short --branch
npm run test:writing-tutor
npm run test:learning-reports
npm run verify:release
git diff --check
```

If a baseline command fails, record the existing failure in `AGENT_TODO.md` and
do not silently broaden this feature to repair unrelated code.

### 0.3 Hard execution rules

- Do not deploy or alter CloudBase resources.
- Do not request, print, or commit provider keys, CloudBase secrets, student
  credentials, audio, transcripts, voice samples, or report bodies.
- Keep every new collection `ADMINONLY`.
- Derive student/teacher identity from authenticated server context. A Student
  ID, Discussion ID, report ID, participant ID, or share ID is only a locator.
- Use direct top-level CloudBase writes. Never call `add({ data: row })`.
- Keep durable job rows metadata-only. Formal audio content, Voice References,
  transcripts, and model feedback never enter job rows or logs.
- Reuse the durable-AI invariants from ADR 0003. A browser request never owns a
  slow ASR, diarization, voice-match, or DSE-analysis call.
- Do not invent a production speech-provider API. Section 15 is an explicit
  provider benchmark gate. Test fixtures are allowed only inside tests.
- Do not add a framework. Continue static HTML, CSS, vanilla JavaScript, Node 18,
  and the existing CloudBase SDK.
- Do not add `ffmpeg`, an embedding model, or another dependency without an
  explicit owner decision and a recorded architecture decision.
- Preserve unrelated dirty files. Stage or commit only if the owner later asks.

## 1. Product outcome

Speaking Lab V1 lets an authenticated student create one HKDSE Group
Interaction Discussion, invite other system students by exact Student ID, add
session-only Guest Participants, record or upload the Formal Discussion audio,
register reusable Tencent voiceprints or record Discussion-scoped Voice
References on an authorized device, and receive a durable AI report.

The report is generated immediately under anonymous Speaker labels. VIP names
appear only after the corresponding student confirms `This is my voice` or a
teacher authoritatively locks the Voice Match. Guest names may appear internally
or in teacher-selected sharing, but always carry `Guest participant · Name not
verified`.

Every accepted VIP sees the complete internal Discussion Report. Every teacher
automatically has access to all Discussions. External access exists only through
fixed, expiring, server-built share snapshots.

## 2. Frozen product decisions

The executor must not reopen or reinterpret these decisions.

### 2.1 Scope and DSE rules

1. V1 supports only HKDSE English Language Paper 4 Part A Group Interaction.
2. Standard size is four participants; minimum report size is three; maximum is
   six. Two participants may record, but no DSE report is generated.
3. Default recording time is two minutes per listed participant:
   - three participants: six minutes;
   - four participants: eight minutes;
   - five participants: ten minutes;
   - six participants: twelve minutes.
4. The creator may adjust the timer before recording. The timer never changes
   participant count or rubric behavior.
5. Pronunciation and Delivery is not assessed in V1. Render it as `Not assessed`.
6. Analyse only Communication Strategies, Vocabulary and Language Patterns,
   and Ideas and Organisation. Each may receive a training estimate from 0–7.
7. Do not display an official Paper 4 total, `/28`, `/56`, predicted examination
   grade, or a fabricated pronunciation score.
8. Audio cannot prove eye contact, body language, or note reliance. Never claim
   to assess them.
9. The Discussion topic/prompt is required before DSE analysis. V1's first
   vertical slice accepts typed/pasted prompt text. Private image/PDF prompt OCR
   is a later milestone in this same plan and must reuse the durable upload
   boundary; it must not block the audio foundation.

### 2.2 Participants and invitations

1. Any active authenticated student may create a Discussion.
2. The creator is a listed VIP Participant and cannot remove themselves. If the
   creator will not participate, another participant must create the Discussion.
3. The creator is the only student who may add, remove, or rename Guest
   Participants. Teachers may add/remove roster slots before freeze and may
   rename a Guest later. V1 does not mutate roster membership after analysis;
   a membership correction then requires a new Discussion. Teacher's permanent
   highest authority applies to Voice Matches, which remain editable.
4. Other VIP Participants are added by exact Student ID. The server resolves it
   to `auth_uid`; the browser never grants access from Student ID alone.
5. A VIP invitation modal shows title, date, inviter, other invited VIP names,
   and Guest names with their unverified label.
6. Accept grants internal Discussion/report access. Decline grants no access but
   never blocks recording, analysis, or other participants' reports.
7. Every accepted VIP Participant may create their own Student Share Snapshot
   after their own voice is confirmed.
8. A Guest Participant has no account, invitation, confirmation action, internal
   report access, or share authority. A Guest sees data only if someone sends an
   external snapshot link.
9. Guest records are Discussion-scoped. Do not create a Guest directory, reuse
   Voice References or Guest voiceprints across Discussions, match Guests
   across Discussions, or create pseudo-accounts.
10. Guest entered names are editable after recording without re-running voice
    matching. A Guest name must not duplicate an existing visible participant
    label after case/whitespace normalization; the UI asks for a suffix such as
    `1` or `2`.
11. VIP identity remains keyed by `auth_uid`/Student ID. Two real VIP profiles
    with the same display name are still distinct and cannot be merged.

### 2.3 Voice identity

1. A VIP may explicitly register one reusable Tencent voiceprint from the
   student page; a teacher may register or replace a VIP voiceprint by Student
   ID or roster row. The VIP voiceprint follows `auth_uid` across Discussions.
2. A teacher may register a Guest voiceprint, but it is keyed only to that
   Discussion's `participant_id`, remains unverified, and is deleted when the
   participant or Discussion is deleted.
3. Reusable enrolment uses the fixed passage, explicit consent, and an 8–20
   second browser-created 16 kHz/16-bit/mono WAV sent directly to Tencent. The
   application never stores that WAV, its base64 form, or an embedding.
4. A Voice Reference remains a separate 15–20 second Discussion-scoped fallback
   recording of the same fixed passage. It is never part of DSE scoring.
5. Any accepted VIP device may record a missing/failed Voice Reference for any
   listed participant. A Guest uses a VIP's logged-in device.
6. Successful Voice References cannot be replaced by a student after matching.
   A failed/unclear sample may be reopened. A teacher may always reopen it.
7. ASR diarization creates stable internal Speaker Tracks such as `spk_01`; it
   does not create participant identity.
8. Voice matching proposes a one-to-one participant/Speaker association from a
   reusable voiceprint or Voice Reference. It is not legal identity verification.
9. A VIP hears the relevant sample when available and a short matched Formal
   Discussion excerpt. They choose `This is my voice` or `This isn't my voice`.
10. `This is my voice` confirms only that VIP's current mapping.
11. `This isn't my voice` opens an identity dispute; it does not let the student
   select another Speaker or edit any mapping.
12. A teacher has highest authority, may change or re-lock mappings repeatedly,
    and every change creates an audit event and report revision.
13. Until student confirmation or teacher lock, the VIP is displayed only as a
    Speaker label inside report and share projections, including the teacher's
    report preview. The private roster, invitation, Voice Reference target card,
    and teacher mapping editor still show the trusted roster name so users can
    record and correct the intended participant; those roster names never enter
    an anonymous report/share projection automatically.
14. Guests do not confirm or dispute Voice Matches. Their entered names remain
    explicitly unverified.
15. A low-confidence or unmatched voice is not forced onto a participant. It is
    a `Possible non-candidate voice`, excluded from Candidate evaluation.

### 2.4 Audio and retention

1. Support live browser recording and audio-file upload. Direct video upload and
   server-side video-to-audio extraction are not part of the first release.
2. Live recording displays visual-only warnings for sustained low volume,
   clipping, or unstable input. Never play a warning sound into the recording.
3. Uploaded poor-quality audio is flagged. If evidence is not reliable, show
   `Not reliably scorable` rather than forcing a score.
4. Formal Discussion audio is retained indefinitely until a teacher-authorized
   whole-Discussion deletion. Students cannot download it.
5. Voice Reference files are deleted seven days after successful matching.
   Retain only the mapping, confirmation/audit state, and safe quality metadata.
6. Reusable enrolment audio is never stored by the application. Tencent retains
   the provider-side voice template until an authorized delete; application
   rows retain only the private provider locator and lifecycle/audit metadata.
7. Browser playback is best-effort protected: no download controls, no external
   link exposure, strict authorization, and very short-lived internal URLs.
   Do not claim a browser stream is technically impossible to capture.

### 2.5 Internal and external reports

1. The internal report is generated under Speaker labels without waiting for
   voice confirmation.
2. Accepted VIP Participants see the entire internal report, including other
   participants' detailed feedback. Teachers see every Discussion/report.
3. Student Share Snapshots require the sharing VIP's confirmed/teacher-locked
   voice. They show the sharer's real name only.
4. A Student Share Snapshot includes group analysis and the sharer's full
   personal analysis. Other Speakers receive only anonymous interaction/group
   contribution summaries, not their detailed error lists.
5. Student snapshots omit the complete transcript, participant roster, Student
   IDs, Voice References, Formal Discussion audio, internal title, and internal
   identity/dispute records. Use the fixed title `DSE Group Discussion Report`.
6. Teacher Share Snapshots may be generated at any time. The teacher selects
   content sections and independently selects which participants display names.
7. The teacher name selector defaults to all participants selected. Deselecting
   one participant replaces that name everywhere with a snapshot-local Speaker
   alias.
8. A selected VIP still appears as a Speaker until student confirmation or
   teacher lock. A selected Guest displays the entered name plus
   `Guest participant · Name not verified`.
9. Student IDs, raw audio, Voice References, private URLs, job state, and audit
   rows are never externally shareable.
10. Share snapshots use unguessable random tokens, store only token hashes,
    expire after seven days, can be revoked, and are not authenticated internal
    report pages.
11. A snapshot never changes silently. Critical report/mapping corrections
    revoke affected old snapshots; the user creates a new one.
12. Per-link Speaker aliases are regenerated and stable only within that one
    snapshot. The product hides names but cannot guarantee that familiar readers
    will never infer identity from conversation content.

## 3. Explicit non-goals

Do not add these to V1 unless the owner later changes scope:

- individual monologue speaking analysis;
- pronunciation, accent, phoneme, fluency, or prosody scoring;
- official DSE score prediction;
- body-language or camera analysis;
- automatic real-name publication without student confirmation or teacher lock;
- Guest accounts, Guest invitations, Guest login, Guest history, or Guest share
  links;
- direct video upload/transcoding;
- real-time live transcription or live scoring;
- collaborative editing of mappings by students;
- raw-audio download, public audio, or permanent public PDF URLs;
- a new frontend framework;
- production provider enablement before the real-audio benchmark in section 15.

## 4. Canonical state model

Do not use one overloaded `status` field for every lifecycle. Store independent
state axes so invitation, recording, analysis, identity, and sharing cannot
silently overwrite one another.

### 4.1 Discussion state

`speaking_discussions` uses:

- `roster_status`: `draft | frozen`
- `recording_status`: `missing | recording | uploaded | invalid`
- `analysis_status`: `not_ready | queued | processing | ready | failed`
- `active_report_version`: positive integer or `null`
- `deleted_at`: `null` or teacher-authorized deletion time

`roster_status: frozen` begins when the creator presses `Start AI Analysis`.
After that, students cannot add/remove participants. Guest display-name edits
remain allowed and create a report/name revision without changing audio.

### 4.2 Invitation state

VIP participant `invitation_status` is:

- creator: `accepted` from creation;
- invited student: `pending | accepted | declined`.

Declined participants remain in the recorded roster and analysis scope if a
Speaker Track exists, but they lose every student read/share action. They appear
under a name only after teacher lock because they cannot confirm after decline.

Guest `invitation_status` is always `not_applicable`.

### 4.3 Voice-reference state

`voice_reference_status` is:

`missing | uploading | uploaded | quality_failed | matched | deletion_due | deleted`

The transition from `matched` to `deletion_due` sets `delete_after` to seven days
after the successful match. Confirmation is not required for deletion.

### 4.4 Identity state

VIP `identity_status` is:

`unmatched | ai_matched | student_confirmed | disputed | teacher_confirmed`

Guest `identity_status` is:

`unmatched | ai_matched | teacher_confirmed`

Display-name eligibility:

- `student_confirmed` or `teacher_confirmed`: VIP name may be projected;
- all other VIP states: Speaker alias only;
- Guest `ai_matched`/`teacher_confirmed`: entered name may be projected only
  where product rules allow, always with the unverified badge.

### 4.5 Job state

`speaking_ai_jobs.status` is:

`queued | processing | succeeded | failed | superseded`

Job types:

- `discussion_analysis`: audio quality, transcription/diarization, canonical
  Candidate set, then DSE report;
- `identity_match`: compares available Discussion Voice References with stable
  Speaker Tracks and proposes one-to-one mappings;
- `prompt_ocr`: later milestone for a private image/PDF prompt.

Every job uses stable `operation_id`, bounded attempts, an expiring lease,
`next_retry_at`, dispatch token, safe error code, and active-job guard. Never put
audio URLs, audio bytes, transcript text, prompt text, participant names, Student
IDs, or report feedback in a job row.

## 5. Permission matrix

All browser responses are server projections. A hidden frontend button is not
authorization.

| Action | Creator | Accepted VIP | Pending VIP | Declined VIP | Guest | Teacher | External token |
| --- | --- | --- | --- | --- | --- | --- | --- |
| View invitation summary | n/a | yes | yes | no | no | yes | no |
| Accept/decline own invitation | n/a | no | yes | no | no | no | no |
| View internal Discussion/report | yes | yes | no | no | no | yes | no |
| Add/remove Guest before freeze | yes | no | no | no | no | yes | no |
| Rename Guest | yes | no | no | no | no | yes | no |
| Upload Formal Discussion audio | yes | yes | no | no | no | yes | no |
| Record missing Voice Reference | yes | yes | no | no | no | yes | no |
| Confirm/dispute own Voice Match | own only | own only | no | no | no | no | no |
| Change any Voice Match | no | no | no | no | no | yes | no |
| Generate Student Share Snapshot | confirmed own voice only | confirmed own voice only | no | no | no | no | no |
| Generate Teacher Share Snapshot | no | no | no | no | no | yes | no |
| Read one external snapshot | no special right | no special right | no | no | no | no | valid unexpired token |
| Download original audio | no | no | no | no | no | no | no |

Teacher authority is derived by loading the current authenticated UID's active
`students.role: teacher` profile. Student ownership is always derived from the
current authenticated UID and a `speaking_participants.student_uid` row.

## 6. CloudBase collections and indexes

Every collection below is `ADMINONLY`. Use top-level documents. Store dates as
CloudBase/JavaScript Date values, not display strings.

### 6.1 `speaking_discussions`

One row per Discussion:

```json
{
  "discussion_id": "discussion_<stable-random-id>",
  "creator_uid": "authenticated-auth-uid",
  "title": "Internal title",
  "discussion_date": "Date",
  "prompt_text": "Confirmed DSE task text",
  "prompt_source": "typed",
  "prompt_version": "dse-speaking-prompt-v1",
  "participant_count": 4,
  "duration_seconds": 480,
  "roster_status": "draft",
  "recording_status": "missing",
  "analysis_status": "not_ready",
  "formal_audio_asset_id": null,
  "active_analysis_job_id": null,
  "active_identity_job_id": null,
  "active_report_version": null,
  "created_at": "Date",
  "updated_at": "Date",
  "deleted_at": null,
  "deleted_by_teacher_uid": null
}
```

Rules:

- `participant_count` is server-derived from current non-removed participant
  rows; never trust a browser count.
- `duration_seconds` defaults from participant count and may be changed before
  recording within `180..1800` seconds.
- Require non-empty prompt text before `Start AI Analysis`.
- A Discussion with fewer than three non-removed participants must not start
  DSE analysis and must not generate a report. In particular, two participants
  never receive a transcript-only substitute through this V1 action.
- Do not hard-delete after processing. Teacher deletion marks the aggregate and
  schedules private audio cleanup while retaining the minimum audit tombstone.

Indexes:

- unique `discussion_id`;
- `creator_uid + created_at`;
- `analysis_status + updated_at`;
- `active_analysis_job_id`;
- `active_identity_job_id`.

### 6.2 `speaking_participants`

One current participant projection per Discussion slot:

```json
{
  "participant_id": "participant_<stable-random-id>",
  "discussion_id": "discussion_...",
  "participant_kind": "vip",
  "student_uid": "auth_uid-or-null",
  "student_id_snapshot": "server-derived-or-null",
  "display_name_snapshot": "server-derived VIP name or entered Guest name",
  "guest_name_normalized": null,
  "added_by_uid": "creator-auth-uid",
  "invitation_status": "accepted",
  "invited_at": "Date-or-null",
  "responded_at": "Date-or-null",
  "voice_reference_asset_id": null,
  "voice_reference_status": "missing",
  "matched_speaker_key": null,
  "match_confidence": null,
  "identity_status": "unmatched",
  "identity_confirmed_at": null,
  "identity_confirmed_by_uid": null,
  "identity_confirmation_source": null,
  "removed_at": null,
  "created_at": "Date",
  "updated_at": "Date"
}
```

Rules:

- `participant_kind` is `vip | guest`.
- VIP name and Student ID snapshots come only from the trusted `students` row.
- Guest has `student_uid: null`, `student_id_snapshot: null`, and
  `invitation_status: not_applicable`.
- Enforce one current VIP row per `discussion_id + student_uid`.
- Enforce normalized Guest-label uniqueness transactionally in the service;
  CloudBase indexes alone are not sufficient for nullable/mixed participant
  kinds.
- Do not use `display_name_snapshot` as a key.
- A Guest rename changes only display fields and report/share versions. It never
  changes `participant_id`, audio asset IDs, or `matched_speaker_key`.

Indexes:

- unique `participant_id`;
- `discussion_id + removed_at`;
- `student_uid + invitation_status + updated_at`;
- `discussion_id + student_uid`;
- `discussion_id + matched_speaker_key`.

### 6.3 `speaking_audio_assets`

One private stored-audio record:

```json
{
  "asset_id": "speaking_audio_<stable-id>",
  "discussion_id": "discussion_...",
  "participant_id": null,
  "asset_kind": "formal_discussion",
  "student_uid_scope": null,
  "upload_operation_id": "client-stable-id",
  "status": "uploading",
  "file_id": "private-cloudbase-file-id",
  "cloud_path": "speaking-lab/...",
  "mime_type": "audio/webm",
  "expected_size_bytes": 123,
  "actual_size_bytes": null,
  "duration_ms": null,
  "quality_status": "pending",
  "quality_codes": [],
  "uploaded_at": null,
  "matched_at": null,
  "delete_after": null,
  "deleted_at": null,
  "created_at": "Date",
  "updated_at": "Date"
}
```

Rules:

- `asset_kind` is `formal_discussion | voice_reference | prompt_source`.
- `participant_id` is required only for `voice_reference`.
- Direct upload paths are server-created and request-scoped.
- Accept audio MIME types only from an explicit allowlist. V1 starts with
  `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-m4a`, and
  `audio/aac`; validate actual stored size after upload.
- Initial maximum Formal Discussion size is 120 MB. Initial maximum Voice
  Reference size is 12 MB. Constants must live server-side and be mirrored only
  for friendly browser validation.
- Store no public URL. Temporary playback/provider URLs are minted only inside
  authorized actions and never persisted.
- Formal audio `delete_after` remains null. Voice Reference `delete_after` is
  set after successful matching.

Indexes:

- unique `asset_id`;
- `discussion_id + asset_kind + status`;
- `participant_id + asset_kind + status`;
- `status + delete_after`;
- `upload_operation_id`.

### 6.4 `speaking_ai_jobs`

Metadata-only durable queue:

```json
{
  "job_id": "speaking_job_<stable-id>",
  "operation_id": "client-stable-id",
  "job_type": "discussion_analysis",
  "discussion_id": "discussion_...",
  "discussion_revision": 1,
  "formal_audio_asset_id": "asset-id-or-null",
  "reference_asset_ids": [],
  "reusable_voiceprints": [{
    "participant_id": "participant-id",
    "voiceprint_profile_id": "private-profile-id",
    "enrollment_revision": 1
  }],
  "status": "queued",
  "stage": "audio_quality",
  "attempt_count": 0,
  "max_attempts": 5,
  "dispatch_token": "private-random-token",
  "lease_token": null,
  "lease_until": null,
  "next_retry_at": "Date",
  "safe_error_code": null,
  "prompt_version": "dse-speaking-prompts-2026-08-27.1",
  "schema_version": "dse-speaking-report-v1",
  "rubric_version": "dse-group-interaction-v1",
  "provider_config_version": "speaking-provider-v1",
  "created_at": "Date",
  "updated_at": "Date",
  "finished_at": null
}
```

Rules:

- Do not store transcript, prompt, names, Student IDs, audio URLs, model
  responses, share tokens, dispatch payloads, or provider credentials.
- Stable `job_id` is derived from authenticated scope, Discussion, job type,
  revision, and operation ID. Use `doc(stableId).create(row)` and replay the
  existing compatible job after uncertain delivery.
- Only the current active job plus current lease may publish.
- Retry transient network/429/5xx/timeouts. Do not retry schema/domain-invalid
  output indefinitely.
- A later Discussion audio revision supersedes an older active job.

Indexes:

- unique `job_id`;
- `discussion_id + status`;
- `status + next_retry_at`;
- `status + lease_until`;
- `operation_id`.

### 6.5 `speaking_reports`

One immutable published report version plus optional current pipeline draft:

```json
{
  "report_id": "speaking_report_<discussion-id>_v1",
  "discussion_id": "discussion_...",
  "report_version": 1,
  "status": "ready",
  "report_eligibility": "eligible",
  "audio_quality": {},
  "transcript": {
    "language": "en",
    "duration_ms": 0,
    "speaker_tracks": [],
    "segments": []
  },
  "candidate_speaker_keys": [],
  "non_candidate_speaker_keys": [],
  "dse_analysis": {},
  "prompt_version": "dse-speaking-report-v1",
  "schema_version": "dse-speaking-report-v1",
  "rubric_version": "dse-group-interaction-v1",
  "model_metadata": {},
  "created_at": "Date",
  "published_at": "Date"
}
```

Transcript shape:

```json
{
  "speaker_tracks": [
    {
      "speaker_key": "spk_01",
      "speech_duration_ms": 95000,
      "turn_count": 12,
      "candidate_status": "candidate",
      "candidate_reason": "roster_match"
    }
  ],
  "segments": [
    {
      "segment_id": "seg_0001",
      "speaker_key": "spk_01",
      "start_ms": 1020,
      "end_ms": 4120,
      "text": "...",
      "asr_confidence": 0.91,
      "evaluation_role": "candidate"
    }
  ]
}
```

Rules:

- `evaluation_role` is `candidate | non_candidate_context`.
- Speaker keys and segment IDs are server-canonical and never model-invented.
- A report stores Speaker evidence, not names. Every viewer projection joins
  current participant/mapping state. This prevents a rename from rewriting
  transcript evidence.
- Ready report versions are immutable. A mapping/name/report correction creates
  a new version or a separate projection revision; never mutate an external
  snapshot in place.
- `model_metadata` contains safe protocol/model/hostname/version fields only.

Indexes:

- unique `report_id`;
- unique logical `discussion_id + report_version`;
- `discussion_id + status + report_version`.

### 6.6 `speaking_identity_events`

Append-only identity audit:

```json
{
  "event_id": "speaking_identity_event_<stable-id>",
  "discussion_id": "discussion_...",
  "participant_id": "participant_...",
  "speaker_key_before": null,
  "speaker_key_after": "spk_01",
  "event_type": "ai_matched",
  "actor_role": "system",
  "actor_uid": null,
  "match_confidence": 0.92,
  "safe_reason_code": null,
  "created_at": "Date"
}
```

`event_type` is:

`ai_matched | student_confirmed | student_disputed | teacher_locked |
teacher_remapped | reference_reopened`

Never store audio URLs, transcripts, names, Student IDs, free-text student
complaints, or biometric embeddings.

Indexes:

- unique `event_id`;
- `discussion_id + created_at`;
- `participant_id + created_at`.

### 6.7 `speaking_share_links`

One fixed external snapshot:

```json
{
  "share_id": "speaking_share_<random-id>",
  "token_hash": "sha256-hex",
  "discussion_id": "discussion_...",
  "report_id": "speaking_report_...",
  "share_kind": "student",
  "created_by_uid": "auth-uid",
  "student_sharer_participant_id": "participant-id-or-null",
  "content_selection": {},
  "name_visible_participant_ids": [],
  "snapshot_payload": {},
  "status": "active",
  "expires_at": "Date",
  "created_at": "Date",
  "revoked_at": null,
  "revoked_by_uid": null,
  "revoke_reason": null
}
```

Rules:

- Store only SHA-256 token hash. Return the raw 32-byte base64url token once.
- `snapshot_payload` is already redacted, size-bounded, and safe for the exact
  share configuration. The public read action returns this projection, never a
  raw report joined in the browser.
- External token lookup checks `status`, expiry, and token hash using constant-
  time comparison where practical.
- Student snapshots never accept browser-provided content/name configuration.
- Teacher snapshot selections are revalidated against report/participant IDs.
- Revoke the creator's prior active Student snapshot for the same report before
  creating a replacement.

Indexes:

- unique `share_id`;
- unique `token_hash`;
- `discussion_id + status`;
- `created_by_uid + share_kind + status`;
- `status + expires_at`.

### 6.8 `speaking_model_usage_events`

Append-only safe provider-cost ledger, one row per physical provider call:

- stable `event_id` from job ID, attempt, stage, and call index;
- Discussion/job/operation scope;
- provider/model/protocol/request ID and HTTP status;
- input/output/total/cached/reasoning Token counts when supplied;
- audio seconds billed when supplied;
- `usage_status: recorded | missing`;
- no prompt, transcript, audio, names, Student IDs, feedback, URLs, secrets, or
  provider response body.

Indexes:

- unique `event_id`;
- `job_id`;
- `discussion_id`;
- `model + created_at`.

### 6.9 `speaking_voiceprints`

One reusable Tencent provider locator per scoped subject:

```json
{
  "voiceprint_profile_id": "speaking_voiceprint_<stable-id>",
  "subject_key": "vip:<auth_uid>|guest:<participant_id>",
  "subject_kind": "vip",
  "student_uid": "auth-uid-or-null",
  "participant_id": null,
  "discussion_id": null,
  "provider": "tencent_asr",
  "provider_voiceprint_id": "private-provider-locator",
  "provider_group_id": "mrcat_speaking",
  "status": "active",
  "passage_version": "dse-reusable-voiceprint-v1",
  "sample_duration_ms": 15000,
  "enrollment_revision": 1,
  "consent_source": "student_self_confirmation",
  "enrolled_by_uid": "actor-uid",
  "enrolled_at": "Date",
  "updated_at": "Date",
  "deleted_at": null
}
```

VIP subject keys use only authenticated UID. Guest subject keys use only the
current Discussion participant ID. No enrolment WAV/base64, name, Student ID,
embedding, or provider response body enters this row. Deletion clears the
provider locator and retains private lifecycle metadata.

Indexes:

- unique `voiceprint_profile_id`;
- unique `subject_key`;
- `status + subject_kind + discussion_id`.

### 6.10 `speaking_voiceprint_events`

Append-only enrol/update/delete audit with unique `event_id`, operation/profile/
subject locators, subject kind and Guest scope, event type, enrollment revision,
actor UID/role, provider/request ID, and `created_at`. It contains no audio,
name, Student ID, template, embedding, score, transcript, or raw response.

Indexes:

- unique `event_id`;
- unique `subject_key + operation_id`;
- `subject_key + created_at`.

## 7. Cloud function boundaries

Create two functions. Keep Discussion business logic in a pure shared module so
permissions and share redaction can be tested without CloudBase.

### 7.1 `speakingLab`

Authenticated gateway plus one token-authorized public read action.

Student actions:

- `listWorkspace`: accepted Discussions, pending invitations, safe summaries;
- `createDiscussion`;
- `getDiscussion`;
- `addVipParticipant`;
- `addGuestParticipant`;
- `renameGuestParticipant`;
- `removeParticipant` before roster freeze;
- `respondToInvitation` for current VIP only;
- `startAudioUpload`;
- `finishAudioUpload`;
- `startVoiceReferenceUpload`;
- `finishVoiceReferenceUpload`;
- `startAnalysis`;
- `confirmOwnVoice`;
- `disputeOwnVoice`;
- `getVoiceConfirmationPlayback`;
- `createStudentShare`;
- `revokeOwnStudentShare`.
- `getMyVoiceprint`;
- `saveMyVoiceprint` for the authenticated student's own UID only;
- `deleteMyVoiceprint` for the authenticated student's own UID only.

Teacher actions:

- `listTeacherDiscussions` with pagination/filters;
- `getTeacherDiscussion`;
- `teacherUpdateVoiceMapping`;
- `teacherReopenVoiceReference`;
- `teacherRenameGuest`;
- `teacherUpdateRoster` using explicit safe operations;
- `createTeacherShare`;
- `revokeTeacherShare`;
- `teacherDeleteDiscussion` with a separate confirmation boundary.
- `teacherGetVoiceprintTarget` by exact Student ID or current participant row;
- `teacherSaveVoiceprint` for a VIP or current Discussion Guest;
- `teacherDeleteVoiceprint` for the same authorized target scopes.

Public token action:

- `getSharedReport`.

`getSharedReport` is the only action that does not require an active student or
teacher profile. It accepts a raw share token, hashes it server-side, loads one
active/unexpired snapshot, and returns only `snapshot_payload` plus safe expiry
metadata. It never accepts a report ID as authority.

Internal worker action:

- `processQueuedJob` requires matching private dispatch token from the job row.
  Browser callers cannot select or claim jobs.

### 7.2 `speakingAiWorker`

One-minute timer worker. The environment-level function ACL must set
`speakingAiWorker.invoke` to `false`, which blocks every browser SDK call while
CloudBase timer triggers continue to run. Accept only the standard timer event
whose `Type` is `Timer`, `TriggerName` is `speaking-ai-worker-minute`, and
`Time` is parseable. The current CloudBase trigger editor does not expose a
custom argument, so this worker deliberately has no timer token.

Responsibilities:

1. recover expired `processing` leases;
2. dispatch due queued jobs;
3. mark attempt-exhausted jobs failed with safe codes;
4. delete expired unconfirmed uploads;
5. delete Voice Reference files after `delete_after`;
6. delete provider-side Guest voiceprints after participant/Discussion removal;
7. expire share-link rows;
8. audit missing provider usage events without logging private data;
9. never generate a report itself inside the timer request; dispatch to the
   private processor and return promptly.

### 7.3 Pure shared module

Create `cloudfunctions/_shared/speaking-lab.js` containing only deterministic
helpers such as:

- normalization and participant-label collision checks;
- default duration and participant-count eligibility;
- permission predicates;
- identity/name-display rules;
- one-to-one mapping canonicalization;
- Candidate/non-Candidate canonicalization;
- report schema canonicalization and evidence validation;
- Student Share projection;
- Teacher Share projection;
- exact-name redaction;
- snapshot-local alias generation;
- share invalidation predicates.

The module must not initialize CloudBase, call a provider, read environment
variables, or use browser APIs.

## 8. Durable audio workflow

### 8.1 Formal Discussion upload

Use the same two-phase pattern as Writing Tutor:

```text
authenticated startAudioUpload
  -> validate Discussion access and stable operation ID
  -> create/replay speaking_audio_assets uploading row
  -> return request-scoped private upload metadata

browser uploads bytes directly to private CloudBase Storage

authenticated finishAudioUpload
  -> revalidate ownership/scope
  -> inspect actual stored file info and size
  -> mark asset uploaded
  -> attach it to Discussion
  -> no model call inside this request
```

If `finishAudioUpload` response is lost, the client reuses the same operation ID
and asset ID. `getDiscussion` may safely complete a still-verifiable pending
upload handoff, as Writing Tutor does. Never create a second asset because the
browser did not receive a response.

Replacing Formal Discussion audio before analysis creates a new audio asset and
supersedes the old one. Once analysis has started, students cannot replace it;
only a teacher may start a corrected revision.

### 8.2 Browser live recording

Use `MediaRecorder` only after explicit microphone permission. Codec selection:

1. `audio/webm;codecs=opus` when supported;
2. `audio/mp4` when supported;
3. browser default audio MediaRecorder type;
4. if none exists, show file-upload fallback.

Recorder rules:

- do not upload while the user is still recording;
- maintain elapsed time from a monotonic clock, not interval tick count;
- allow pause/resume only if the final browser Blob remains valid;
- warn at the selected duration but do not silently cut a speaking turn;
- cap recording at 30 minutes and stop safely;
- show a clear microphone-denied/file-upload alternative;
- revoke object URLs on replacement/navigation;
- never put audio Blob data in localStorage, sessionStorage, IndexedDB, or logs.

### 8.3 Live quality meter

The quality meter is advisory, local, and never a DSE score. Use Web Audio
`AnalyserNode` while recording, with thresholds centralized as named constants.

Initial thresholds to validate on devices:

- ignore the first five seconds while input stabilizes;
- low-volume warning after at least four continuous seconds below approximately
  `-45 dBFS`;
- clipping warning when at least 1% of samples in a recent one-second window
  exceed absolute amplitude `0.98`;
- input-loss warning when the stream is muted/ended or energy is effectively
  zero for three seconds;
- remove a warning only after two seconds of recovery to prevent flashing.

Visible copy should be actionable: `Move the phone closer`, `The sound is
clipping`, or `Microphone signal lost`. No beep, spoken warning, vibration, or
automatic stop. These thresholds are UX heuristics; server-side audio quality
remains authoritative.

### 8.4 Voice Reference upload

Use the same two-phase private upload boundary under one participant. The fixed
passage is versioned server-side and also rendered by the browser:

> Many people have different ideas. I will listen carefully, explain my view,
> and respond clearly to the group before we reach a conclusion.

Store `voice_reference_passage_version: dse-voice-reference-v1`. The sample is
not accepted solely because the browser says its length. The provider pipeline
must validate usable speech duration and quality.

Students may start or replace a reference upload while the participant's status
is `missing`, `uploading`, `uploaded`, or `quality_failed`. `uploaded` remains
replaceable only because no successful match exists yet. A successful match
changes the state to `matched`/`deletion_due` and closes student replacement.
Teacher reopen appends an audit event and clears the current sample projection
without deleting prior audit evidence.

### 8.5 Internal playback

`getVoiceConfirmationPlayback` revalidates that:

- caller is the exact VIP participant whose mapping is being confirmed, or an
  active teacher;
- Discussion and current mapping still exist;
- requested asset belongs to that Discussion;
- requested time bounds are within the formal audio duration.

Return temporary private URLs with the shortest practical lifetime, plus only
the matched `start_ms`/`end_ms`. The browser renders custom play/pause controls
without native download controls and stops at `end_ms`. Never return these URLs
to share snapshots or store them in browser persistence.

## 9. Durable AI workflow

### 9.1 Analysis readiness

`startAnalysis` server-validates:

- caller is creator or another accepted VIP;
- roster is three to six listed, non-removed participants; two participants
  must be rejected without generating a report;
- prompt text is non-empty and within the size limit;
- Formal Discussion asset is uploaded and actual file exists;
- no current compatible analysis job is already active;
- duration and MIME/size metadata are plausible.

It freezes roster membership, creates/replays one stable
`discussion_analysis` job, stores `active_analysis_job_id`, dispatches
asynchronously, and returns immediately.

Voice References are not a readiness requirement. The report first publishes
under Speaker labels.

### 9.2 `discussion_analysis` stages

Stages are durable server progress markers, not fake browser percentages:

1. `audio_quality`
2. `transcription`
3. `speaker_canonicalization`
4. `dse_analysis`
5. `publishing`

After each expensive stage, publish its private result to the current
`speaking_reports` pipeline aggregate before advancing the metadata-only job.
If a later stage retries, reuse the committed earlier result rather than paying
for ASR again.

Audio quality may finish as:

- `scorable`;
- `scorable_with_warning`;
- `not_reliably_scorable`.

For `not_reliably_scorable`, publish the transcript when usable, but do not call
the scoring model or force domain scores.

### 9.3 Speaker/Candidate canonicalization

Provider diarization labels are untrusted. The server creates stable ordered
`spk_01`, `spk_02`, etc. by first speech start, then assigns stable ordered
segment IDs.

Before DSE evaluation:

1. reject empty/negative/reversed/out-of-duration timestamps;
2. cap segment and transcript sizes;
3. normalize overlap without inventing words;
4. calculate speech duration and turn counts server-side;
5. identify clusters too brief or low-confidence to be a Candidate;
6. compare the reliable cluster count with listed participant count;
7. mark unmatched/brief incidental clusters as `non_candidate_context`;
8. never force an extra voice into the roster to make counts equal.

Initial non-Candidate signals should include:

- no reliable Voice Reference/roster match;
- isolated very short speech not sustained as a participant turn;
- provider confidence below the tested threshold;
- speaker count above the listed Candidate count;
- a track explicitly rejected by teacher canonicalization.

Do not use one timing threshold as unquestionable truth. Store safe reason codes
and validate them with the owner's real recordings in section 15.

### 9.4 Independent identity matching

Whenever stable Speaker Tracks and at least one usable reusable voiceprint or
Voice Reference exist, create/replay an `identity_match` job. It may run after
the report is ready.

Rules:

- compare only identities authorized for the current roster: VIP reusable
  voiceprints by `auth_uid`, Guest reusable voiceprints by current
  `participant_id`, and Voice References from the same Discussion;
- solve a one-to-one assignment; never map two participants to one Speaker;
- require a tested confidence and separation margin over the next-best match;
- uncertain rows remain `unmatched` rather than guessed;
- never store a provider embedding or reusable biometric vector;
- publish proposed matches and append `ai_matched` events transactionally;
- set Voice Reference deletion deadline after successful matching;
- do not insert participant names into the transcript/report payload.

### 9.5 Retry and stale-result rules

- Maximum five automatic attempts per job activation.
- Each claim uses a random lease token and bounded lease duration.
- Only current `active_*_job_id`, Discussion revision, and lease may publish.
- A terminal analysis failure retains uploaded audio and any valid transcript
  stage. UI shows one safe Retry action.
- Manual retry reuses the same saved audio and earlier valid stages.
- Changing Formal Discussion audio supersedes prior work and increments revision.
- Guest rename does not call ASR or AI.
- Teacher mapping corrections do not call ASR; report/view projections rebind
  existing Speaker evidence.

## 10. Provider contracts and report AI

### 10.1 Speech provider interface

`cloudfunctions/speakingLab/speech-provider.js` keeps this interface:

```js
async function inspectAudio(options)
async function transcribeAndDiarize(options)
async function matchVoiceReferences(options)
```

Normalized `transcribeAndDiarize` output contains only:

```json
{
  "language": "en",
  "duration_ms": 480000,
  "speaker_tracks": [{ "provider_speaker_id": "A", "confidence": 0.9 }],
  "segments": [{
    "provider_speaker_id": "A",
    "start_ms": 0,
    "end_ms": 1200,
    "text": "...",
    "confidence": 0.9
  }],
  "usage": {}
}
```

Normalized voice-match output contains participant asset ID, provider speaker
ID, score, and optional next-best score only. It contains no names.

The first environment-gated implementation candidate uses Tencent
`CreateRecTask` once and durable `DescribeTaskStatus` polling with
`EngineModelType=16k_en`, `ChannelNum=1`, `ResTextFormat=1`, ordinary
`SpeakerDiarization=1`, and automatic speaker count. It remains disabled until
the real-audio benchmark in section 15 passes. A deterministic fixture adapter
may be injected only by unit tests; never expose a browser `demo=1` or
environment flag that produces fake student reports.

#### 10.1a Reusable Tencent voiceprint adapter

`cloudfunctions/_shared/tencent-asr-voiceprint.js` uses Tencent ASR API version
`2019-06-14` and TC3-HMAC-SHA256 signing for `VoicePrintEnroll`,
`VoicePrintUpdate`, `VoicePrintDelete`, `VoicePrintVerify`, and
`VoicePrintGroupVerify`. It reads the runtime-provided Tencent credential names
plus optional non-secret `SPEAKING_TENCENT_ASR_REGION`,
`SPEAKING_TENCENT_VOICEPRINT_GROUP_ID`, and endpoint override. It fails closed
with `SPEAKING_VOICEPRINT_NOT_CONFIGURED`, validates the WAV before any call,
uses an opaque hashed nickname, and returns only safe normalized IDs, scores,
decision, duration, and request ID. Never log the payload or raw response.

### 10.2 DSE report model interface

Create a separate OpenAI-compatible structured-text adapter using only
`SPEAKING_AI_TEXT_*` server environment names. Do not reuse `WRITING_AI_*`
credentials implicitly.

Required environment names, documented without values:

- `SPEAKING_AI_TEXT_API_KEY`
- `SPEAKING_AI_TEXT_API_URL`
- `SPEAKING_AI_TEXT_MODEL`
- `SPEAKING_AI_TEXT_PROTOCOL`
- `SPEAKING_AI_TEXT_MAX_OUTPUT_TOKENS`
- `SPEAKING_AI_TIMEOUT_MS`
- `SPEAKING_ASR_PROVIDER`
- `SPEAKING_ASR_ENGINE_MODEL_TYPE`
- optional `SPEAKING_ASR_ENDPOINT`

The first supported text protocol is `chat_json_object`. Provider JSON validity
does not replace `canonicalizeReport`: Candidate completeness, evidence ownership,
score bounds, and forced pronunciation non-assessment remain local server rules.

Support the same local structural-validation and bounded repair principles as
Writing Tutor. Do not share secret values, provider URLs, or prompts in logs.

### 10.3 DSE model input

The server sends:

- confirmed DSE task text as untrusted delimited data;
- versioned three-domain V1 rubric instructions;
- server-canonical Candidate Speaker keys;
- ordered segments with stable IDs and timestamps;
- `non_candidate_context` segments explicitly marked as context that must not
  receive Candidate analysis or scores;
- audio-quality flags;
- no participant names, Student IDs, invitation states, or share configuration.

The system prompt must say that a brief unmatched voice may be an outside person
who is not a Candidate. It must not evaluate that voice, count it toward group
size, assign it a Candidate score, or attribute its language to another Speaker.
It may use the line only as minimal conversational context for a Candidate's
response.

### 10.4 Structured report schema

Create a strict versioned schema with `additionalProperties: false` at every
object level. Required root:

```json
{
  "group_summary_zh": "...",
  "group_strengths": [],
  "group_priorities": [],
  "discussion_flow": [],
  "candidates": []
}
```

Each Candidate object:

```json
{
  "speaker_key": "spk_01",
  "summary_zh": "...",
  "domains": {
    "communication_strategies": {
      "score": 5,
      "commentary_zh": "...",
      "evidence_segment_ids": ["seg_0008"]
    },
    "vocabulary_language_patterns": {
      "score": 4,
      "commentary_zh": "...",
      "evidence_segment_ids": ["seg_0011"]
    },
    "ideas_organisation": {
      "score": 5,
      "commentary_zh": "...",
      "evidence_segment_ids": ["seg_0017"]
    },
    "pronunciation_delivery": {
      "status": "not_assessed"
    }
  },
  "strengths": [],
  "priority_actions": [],
  "language_suggestions": [],
  "interaction_summary": {}
}
```

Language suggestions may include original transcript excerpt, explanation, and
improved alternative, each attached to existing segment IDs. They must not
claim pronunciation evidence.

### 10.5 Server canonicalization

After schema validation, the server must:

1. require exactly one Candidate object per canonical Candidate Speaker;
2. reject missing, duplicate, unknown, or non-Candidate Speaker keys;
3. order Candidates by the server's stable Speaker order;
4. require integer domain scores `0..7` for the three assessed domains;
5. restore authoritative domain labels and `pronunciation_delivery` status;
6. reject evidence IDs absent from the transcript;
7. require every Candidate evidence ID to belong to that Candidate's Speaker;
8. derive evidence timestamps/text from canonical segments instead of trusting
   model echoes;
9. cap commentary/list lengths and strip unexpected markup;
10. derive all totals/counts locally;
11. never accept a model-provided participant name or official overall score.

## 11. Student interface

### 11.1 Entry and page shell

Add a `Speaking Lab` card on `dashboard.html` near `AI Tutor`, before Library.
It opens `speaking-lab.html`. The page requires an active student login; visitor,
anonymous, teacher, inactive, or missing-profile states show a clear return/login
surface and do not request Discussion data.

Use one responsive page, not a permanent page per Discussion. A query locator
such as `?discussion=<discussion_id>` may restore the selected Discussion but is
never authorization.

Primary workspace states:

- Discussion list/invitation inbox;
- create/edit Discussion;
- recording/upload;
- Voice References;
- processing/waiting;
- internal report;
- share management.

### 11.2 Discussion list

Show:

- `New Discussion`;
- pending invitation cards first;
- active/recent Discussions newest first;
- title, date, participant count, analysis state, and user's invitation/voice
  state;
- no Guest report links or account actions.

Pagination is server-backed; do not place complete history in bootstrap.

### 11.3 Invitation modal

Pending invite opens a modal showing:

- Discussion title;
- Discussion date;
- inviter's server-derived name;
- other VIP invitees' names;
- Guest entered names plus `Guest participant · Name not verified`;
- `Accept` and `Decline`.

Accept/Decline uses current authenticated UID only. Disable the pressed action
until the one server response settles; stable idempotency prevents double state
changes.

### 11.4 Creation wizard

Steps:

1. Details: internal title, date, required DSE prompt text.
2. Participants: creator fixed; add VIP by exact Student ID; add Guest by entered
   name; total three to six for DSE scoring.
3. Timing: derived default with manual adjustment.
4. Review and create.

Do not fetch/display a profile until the server has resolved the Student ID.
Never send a browser-selected UID or role. Show duplicate/current-participant,
inactive, missing, self-add, and max-participant errors distinctly.

### 11.5 Recording/upload screen

Provide two explicit choices:

- `Record now`;
- `Upload audio`.

Recording screen contains:

- elapsed/target timer;
- microphone quality meter and visual warning;
- participant count and internal title;
- Pause/Resume when supported;
- Stop with confirmation for accidental early stop;
- local playback before upload;
- Replace local recording before server upload;
- one `Upload recording` action.

Upload accepts only audio files. Do not advertise video support. Show upload
progress using `fetch`/XHR only if the existing metadata endpoint supports it;
never fake server-analysis progress from upload progress.

### 11.6 Voice Reference screen

Render one participant card per active roster slot:

- VIP confirmed display name from server profile or Guest entered name/badge;
- current reference status;
- fixed passage;
- `Record sample` only when allowed;
- 15–20 second target indicator;
- clear quality-failure retry message;
- no control to select/change Speaker mapping.

Any accepted VIP may use the current device to fill a missing participant
sample. The card must require a final visual confirmation of the selected
participant before microphone recording begins, preventing accidental card
mix-ups without adding a legal-responsibility checkbox.

### 11.7 Processing screen

Poll `getDiscussion` immediately, then serially at three seconds visible and ten
seconds hidden; wake on focus, online, and visibility. Use generation IDs so a
stale response cannot replace a newly opened Discussion.

Display factual stages only:

- Audio uploaded;
- Preparing transcript;
- Analysing discussion;
- Report ready.

Do not show invented percentages or remaining time. Leaving/refreshing never
cancels the durable job. Terminal failure shows safe error copy and Retry when
authorized.

### 11.8 Internal report

Render:

- eligibility/audio-quality banner;
- DSE task text;
- group summary, strengths, priorities, and flow;
- participant/Speaker navigation;
- three assessed 0–7 domain estimates;
- `Pronunciation & Delivery — Not assessed`;
- evidence timestamps and transcript excerpts;
- language suggestions;
- complete internal transcript under current identity projection;
- Voice Confirmation card for current VIP when `ai_matched`;
- identity status badges.

Identity projection:

- current user's or another VIP's confirmed/teacher-locked match: name;
- unconfirmed/disputed VIP: `Speaker N`;
- matched Guest: entered name plus unverified badge;
- unmatched/non-Candidate track: anonymous system label.

Report evidence stays attached to `speaker_key`; the UI never rewrites stored
analysis by array index.

### 11.9 Voice confirmation

Show only to the exact accepted VIP being confirmed:

- Voice Reference play button;
- matched formal excerpt play button;
- `This is my voice`;
- `This isn't my voice`.

Confirmation must include current participant ID, Speaker key, and mapping
revision. The server rejects stale confirmation after a teacher remap.

After `This isn't my voice`, show `Identity under review`; disable Student Share
until teacher correction/lock. Do not ask the student who the correct Speaker is.

### 11.10 Student sharing

Create button is enabled only when the caller's current mapping is
`student_confirmed | teacher_confirmed`.

Student cannot configure the snapshot. After creation show:

- copy link;
- expiry date;
- revoke;
- generate replacement, which revokes the prior link.

Do not offer PDF or raw report download in V1.

## 12. Teacher interface

### 12.1 Entry

Add `Speaking` as a teacher workspace section. Keep the large Speaking code in
`assets/js/teacher-speaking.js`; do not add thousands of unrelated lines to
`assets/js/teacher.js`. `teacher.js` may own tab activation and pass the verified
teacher session into the module.

### 12.2 Discussion list/detail

Teacher list supports server pagination and filters for date, title, student,
analysis state, identity disputes, and audio-quality warning.

Detail contains:

- roster and invitation states;
- audio/upload/analysis status;
- report version and safe provider metadata;
- transcript/report;
- Voice Reference/matched-excerpt playback controls;
- identity mapping editor;
- share builder;
- teacher-only deletion action with confirmation.

### 12.3 Identity editor

Render all Candidate Speaker Tracks on one side and participant rows on the
other. The teacher selects a one-to-one mapping. Before save:

- reject duplicate Speaker assignment;
- reject non-existent or non-Candidate Speaker keys;
- warn about unassigned listed participants;
- do not force non-Candidate tracks into the roster.

Save calls `teacherUpdateVoiceMapping` with explicit participant/Speaker pairs
and current mapping revision. The server revalidates all pairs transactionally,
updates projections, appends events, increments mapping/report projection
revision, and revokes affected snapshots. Teacher can edit again later.

Student disputes remain visible even after teacher lock. They are feedback, not
authority over the mapping.

### 12.4 Teacher share builder

Separate two groups of controls.

Content selection, default checked unless impossible for the report:

- group summary;
- group scores/analysis;
- individual domain estimates;
- individual language suggestions;
- evidence excerpts/timestamps;
- complete transcript;
- teacher comments when that feature exists.

Name visibility:

- one checkbox per active participant;
- `Select all` and `Clear all`;
- all participants selected by default;
- show preview label for what will actually appear:
  - confirmed/teacher-locked selected VIP: real name;
  - unconfirmed selected VIP: Speaker alias;
  - selected Guest: entered name plus unverified badge;
  - deselected participant: Speaker alias.

The browser sends participant IDs and content flags. The server reloads the
report and mapping, applies rules, redacts hidden names from every field, and
stores the final snapshot. Never trust browser-rendered preview HTML as the
snapshot.

## 13. External snapshot projection

### 13.1 New page

Create `speaking-report.html#share=<raw-token>` so the raw token stays in the
browser fragment rather than ordinary static-server request logs. The reader
may accept the old query form only as a compatibility fallback. The page uses
`assets/js/speaking-report.js`. It establishes CloudBase anonymous state when
the visitor has no current login so the Web SDK can invoke the public function,
but anonymous auth grants no report
authority. The raw share token is the only external capability and is checked
server-side.

Page rules:

- `noindex, nofollow` metadata;
- no internal navigation, participant links, account lookup, or login action;
- show expiry and report generation time;
- no audio elements;
- no download/print button;
- graceful expired/revoked/not-found state without revealing which condition
  matched;
- never write token or payload to localStorage/IndexedDB;
- do not include token in analytics/log messages.

### 13.2 Student snapshot algorithm

Server algorithm:

1. require caller is accepted VIP Participant;
2. require own identity confirmed/teacher-locked and mapped to a Candidate
   Speaker;
3. load ready report and current participant/mapping state;
4. assign caller name to caller's Speaker only;
5. assign fresh aliases to every other Speaker;
6. include group summary/analysis;
7. include caller's full individual report;
8. reduce other Candidate sections to anonymous interaction/group-contribution
   summaries;
9. omit complete transcript and roster;
10. include only caller evidence excerpts plus strictly necessary redacted group
    excerpts;
11. replace known hidden participant names in every retained string;
12. omit internal title and use fixed external title;
13. size-check and deep-copy allowed fields into `snapshot_payload`.

### 13.3 Teacher snapshot algorithm

Server algorithm:

1. require active teacher;
2. load ready report/current identities;
3. validate content flags against a closed allowlist;
4. validate selected participant IDs belong to the Discussion;
5. resolve display labels using section 12.4 rules;
6. assign fresh aliases for every hidden/unconfirmed Speaker;
7. apply the same label map to headings, tables, evidence, and transcript;
8. redact exact known hidden names and snapshots inside free text;
9. preserve Guest unverified badge whenever a Guest name is shown;
10. omit all fields outside the closed projection schema;
11. store the final fixed payload.

### 13.4 Redaction limits

Implement deterministic redaction for:

- current and snapshotted Chinese/English/full display names;
- case-insensitive English-name matches with safe word boundaries;
- exact Guest entered names;
- obvious labels in transcript such as `Name,` or `Name:`.

Do not claim this can detect every nickname or conversational clue. The external
page should include a restrained privacy note: names are hidden according to
the share settings, but people familiar with the conversation may still infer
identity.

### 13.5 Snapshot invalidation

Revoke all active Discussion snapshots after:

- Formal Discussion audio replacement;
- transcript/report regeneration;
- teacher Speaker remapping;
- a previously disputed VIP becoming mapped differently.

Guest rename revokes only active teacher snapshots whose
`name_visible_participant_ids` contains that Guest. Student snapshots remain
valid because they never contain Guest names.

VIP confirmation that changes only an internal unconfirmed label does not
silently modify old snapshots. A newly eligible VIP may create a new Student
snapshot; teacher may generate a new teacher snapshot.

## 14. Prompt image/PDF milestone

Typed/pasted DSE prompt text is sufficient for the first executable vertical
slice. Add private prompt-image/PDF intake only after the audio pipeline and
permissions pass their tests.

Required later behavior:

1. creator selects image or PDF;
2. browser requests private upload metadata under the Discussion;
3. confirmed upload creates/replays a metadata-only `prompt_ocr` job;
4. worker extracts/recognizes task text through a configured provider;
5. student reviews and edits extracted text;
6. explicit `Confirm prompt` makes it authoritative;
7. source file is deleted after confirmation or seven-day expiry;
8. DSE analysis never starts from unconfirmed OCR output;
9. PDF/image bytes, OCR text, and private URLs never enter the job row or logs.

Do not import Writing Composition concepts or write the prompt into
`writing_compositions`. Reuse architecture, not ownership aggregates.

## 15. Real-audio provider benchmark gate

This feature is not production-ready merely because fixture tests pass. The
owner will supply representative DSE recordings. Before choosing or enabling a
speech provider, create an ignored local benchmark manifest under
`.cloudbase-private/` and compare at least:

- one mainland-accessible low-cost ASR/diarization provider;
- one higher-accuracy fallback;
- the intended Voice Reference matching route.

Never commit audio or full benchmark transcripts.

### 15.1 Required sample set

Use owner-provided recordings covering, where available:

- three, four, five, and six Candidates;
- male/female and similar-sounding voices;
- Cantonese-accented English;
- overlap/interruption;
- quiet speaker and distant phone;
- noisy classroom;
- a brief outside voice that is not a Candidate;
- uploaded audio and browser-recorded audio;
- correct and intentionally swapped Voice Reference labels.

### 15.2 Human-reviewed benchmark truth

For each recording, prepare private truth containing:

- Candidate count;
- approximate speaker-turn boundaries;
- known Candidate/Speaker mapping;
- a human-corrected transcript sample;
- outside-voice intervals;
- audio quality notes.

### 15.3 Metrics

Measure:

- English word error rate on reviewed spans;
- speaker diarization error or turn-attribution accuracy;
- Candidate count accuracy;
- Voice Reference mapping accuracy and uncertainty calibration;
- outside-voice exclusion precision/recall;
- timestamp usability;
- failure/retry behavior;
- median and p95 processing time;
- cost per 3/4/5/6-person Discussion;
- provider availability from the production region.

### 15.4 Release thresholds

Do not hard-code thresholds until the benchmark is measured. Record the selected
values in `docs/06_DECISIONS.md`. At minimum, production must demonstrate:

- no forced mapping when confidence is inadequate;
- no systematic Candidate loss in normal four-person recordings;
- stable segment timestamps adequate for evidence playback;
- outside brief voices excluded more often than real Candidates;
- bounded retry and idempotent cost behavior;
- acceptable cost approved by the owner.

If no provider passes voice matching for six participants, release transcription
and anonymous Speaker reports only; do not fake name confirmation.

## 16. Error codes and user copy

Use closed safe codes. Cloud functions return friendly messages without raw SDK
or provider errors.

| Safe code | User-facing behavior |
| --- | --- |
| `AUTH_REQUIRED` | Return to login |
| `STUDENT_REQUIRED` | Student-only access message |
| `TEACHER_REQUIRED` | Teacher session message |
| `DISCUSSION_NOT_FOUND` | Generic unavailable state |
| `DISCUSSION_ACCESS_DENIED` | Generic unavailable state |
| `ROSTER_FROZEN` | Roster can no longer be changed |
| `DSE_REQUIRES_THREE_TO_SIX` | Two participants or more than six cannot generate a report |
| `STUDENT_NOT_FOUND` | No active student found for that exact ID |
| `PARTICIPANT_ALREADY_ADDED` | Already in this Discussion |
| `GUEST_NAME_DUPLICATE` | Add a distinguishing suffix |
| `AUDIO_FILE_INVALID` | Choose a supported audio file |
| `AUDIO_UPLOAD_INCOMPLETE` | Retry the same upload handoff |
| `AUDIO_QUALITY_NOT_SCORABLE` | Transcript may be available; no forced score |
| `VOICE_REFERENCE_LOCKED` | Only teacher can reopen |
| `VOICE_MATCH_STALE` | Refresh before confirming |
| `VOICE_MATCH_UNCERTAIN` | Remains Speaker; no forced match |
| `VOICE_CONFIRMATION_REQUIRED_FOR_SHARE` | Confirm voice before sharing |
| `SPEAKING_PROVIDER_NOT_CONFIGURED` | Feature not enabled; no fake report |
| `SPEAKING_AI_TIMEOUT` | Durable retry/interrupted state |
| `SPEAKING_AI_SCHEMA_INVALID` | Safe interrupted state |
| `SPEAKING_AI_EVIDENCE_INVALID` | Safe interrupted state |
| `SHARE_NOT_AVAILABLE` | Same message for missing/expired/revoked token |

Logs may include the safe code, job ID, Discussion ID, stage, attempt, and time.
Never log event bodies or whole database rows while diagnosing these errors.

## 17. Implementation phases

Execute in order. Do not start a later phase while the current phase's tests
fail.

### Phase A — Pure domain contracts

1. Create `cloudfunctions/_shared/speaking-lab.js`.
2. Implement normalization, eligibility, identity projection, mapping
   canonicalization, Candidate exclusion, Student/Teacher share projection, and
   invalidation helpers.
3. Create `scripts/test-speaking-lab-rules.js` with exhaustive pure tests.
4. Add `npm run test:speaking-lab` initially pointing at the pure test.

Exit gate:

- no CloudBase required;
- all permission/projection edge cases pass;
- hidden names do not survive in tested headings, evidence, or transcript.

### Phase B — Backend foundation

1. Add `cloudfunctions/speakingLab/` and `cloudfunctions/speakingAiWorker/`.
2. Implement authentication helpers and action routing.
3. Implement Discussion, invitation, Guest, upload, confirmation, teacher
   mapping, snapshot, and public token actions.
4. Implement durable queue/lease/retry/cleanup without a production provider.
5. Add fixture-injected service tests; fixture injection must be impossible in
   production entry routing.

Exit gate:

- Student ID never authorizes a read/action;
- declined/pending/Guest access is denied server-side;
- raw report documents never leave backend actions;
- duplicate operation delivery is idempotent;
- link token hash, expiry, revocation, and redaction pass.

### Phase C — Student frontend

1. Add page, JS, CSS, Dashboard entry, invitation/modal flows.
2. Add live recorder, file upload, local quality warnings, Voice Reference UI.
3. Add durable polling and report/confirmation/share rendering.
4. Add page-level static/UI contract tests.

Exit gate:

- microphone denied/file upload fallback works;
- no audio persists in browser storage;
- unconfirmed VIP never appears by name;
- Guest never receives an access/share control;
- student cannot configure a privacy-unsafe snapshot.

### Phase D — Teacher and external frontend

1. Add Speaking teacher section/module.
2. Add mapping editor and configurable share builder.
3. Add external snapshot page.
4. Test name multi-select, full redaction, link states, and keyboard/modal access.

Exit gate:

- teacher selected/unselected name projection is consistent everywhere;
- selected but unconfirmed VIP remains Speaker;
- Guest badge is never omitted when its name is visible;
- public page cannot fetch internal report/audio.

### Phase E — Provider adapters and benchmark

1. Receive owner audio.
2. Benchmark providers privately.
3. Record provider/threshold decision.
4. Implement only the selected documented adapter.
5. Run contract tests plus real-audio evaluation.

Exit gate:

- owner approves cost/quality;
- no forced/false voice matching;
- non-Candidate prompt/schema behavior validated;
- provider usage ledger complete.

### Phase F — Documentation, packaging, owner handoff

1. Update every document in section 19.
2. Run all tests in section 20.
3. Package changed functions locally.
4. Generate, but do not apply, an owner deployment plan.
5. Report exact collections/indexes/timer/environment values the owner must
   configure without exposing values.

## 18. File-level work order

### 18.1 Add

- `speaking-lab.html`
- `speaking-report.html`
- `assets/js/speaking-lab.js`
- `assets/js/speaking-report.js`
- `assets/js/teacher-speaking.js`
- `assets/js/voiceprint-recorder.js`
- `assets/css/speaking-lab.css`
- `assets/css/speaking-report.css`
- `cloudfunctions/_shared/speaking-lab.js`
- `cloudfunctions/_shared/tencent-asr-voiceprint.js`
- `cloudfunctions/speakingLab/index.js`
- `cloudfunctions/speakingLab/package.json`
- `cloudfunctions/speakingLab/prompts.js`
- `cloudfunctions/speakingLab/schemas.js`
- `cloudfunctions/speakingLab/speech-provider.js`
- `cloudfunctions/speakingLab/model-provider.js`
- `cloudfunctions/speakingAiWorker/index.js`
- `cloudfunctions/speakingAiWorker/package.json`
- `scripts/test-speaking-lab-rules.js`
- `scripts/test-speaking-lab-service.js`
- `scripts/test-speaking-lab-ui.js`
- `scripts/test-speaking-voiceprints.js`

### 18.2 Modify

- `dashboard.html`: Speaking Lab entry and versioned assets.
- `teacher.html`: Speaking section/container and versioned module.
- `assets/js/teacher.js`: minimal Speaking tab integration only.
- `assets/css/app.css`: only shared shell rules that truly cannot live in the
  Speaking stylesheets.
- `assets/js/config.public.js`: cache version.
- `package.json`: `test:speaking-lab`.
- `scripts/generate-deploy-plan.js`: recognize new functions/collections if
  explicit collection planning is added.
- `README.md` and required numbered documentation.
- `AGENTS.md` only for durable cross-feature invariants and deployment order;
  do not paste this entire plan into AGENTS.
- `AGENT_TODO.md` after QA.

### 18.3 Do not modify for convenience

- Writing Composition collections or Writing Tutor provider credentials;
- assignment, attempt, STAR, learning-report, or Parent Mode schemas;
- CloudBase permissions to allow direct browser reads;
- `deploy-packages/*.zip` by hand;
- existing exercise runtimes.

## 19. Required documentation updates during implementation

- `docs/01_PRODUCT_REQUIREMENTS.md`: full frozen Speaking product behavior.
- `docs/02_ARCHITECTURE.md`: functions, durable jobs, private storage, share
  projection, provider boundary.
- `docs/03_UI_UX_SPEC.md`: student/teacher/external flows and responsive states.
- `docs/04_DATA_MODEL.md`: every collection/field/state/index.
- `docs/05_CHANGELOG.md`: dated product/architecture entry.
- `docs/06_DECISIONS.md`: reusable Tencent voiceprint scope and retention;
  provider choice after benchmark; no pronunciation in V1; snapshot sharing.
- `docs/07_TESTING_CHECKLIST.md`: all automated/manual gates.
- `docs/08_BACKLOG.md`: video extraction, pronunciation, PDF export, provider
  fallback, stronger streaming protection, and later individual speaking mode.
- `docs/10_DEPLOYMENT.md`: collections/indexes, two functions, timer, env names,
  packaging, rollout order, rollback.
- `docs/11_AGENT_TROUBLESHOOTING.md`: safe diagnosis after implementation finds
  repeatable failures.
- `README.md`: feature and command map.
- `AGENTS.md`: only stable invariants.

## 20. Automated and manual verification

### 20.1 Pure/server tests

`npm run test:speaking-lab` must cover at least:

1. participant counts 2/3/4/5/6/7;
2. duration defaults and manual bounds;
3. Student ID resolution never grants access by itself;
4. creator/accepted/pending/declined/Guest/teacher matrix;
5. Guest normalized-name collision and rename independence;
6. one-to-one Voice Match and duplicate Speaker rejection;
7. stale student confirmation rejection;
8. teacher re-lock/re-map authority;
9. unconfirmed VIP name hidden in all projections;
10. Guest badge present wherever Guest name is visible;
11. unmatched extra voice becomes non-Candidate;
12. DSE Candidate list excludes non-Candidate context;
13. report schema missing/duplicate/unknown/reordered Speaker keys;
14. invalid/foreign evidence segment IDs;
15. score outside `0..7` rejected;
16. pronunciation forced to `not_assessed`;
17. Student snapshot contains only sharer detailed analysis;
18. Student snapshot omits transcript/roster/audio/internal title;
19. Teacher per-participant name selection and exact-name redaction;
20. random alias map stable within one snapshot and different across snapshots;
21. raw token not stored; expired/revoked/missing return same safe failure;
22. duplicate upload/job delivery is idempotent;
23. stale lease/result cannot publish;
24. Guest rename invalidates only affected teacher name snapshots;
25. mapping/report correction invalidates all affected snapshots;
26. logs/jobs/usage rows exclude forbidden content fields.

### 20.2 Browser/static tests

Cover:

- required HTML/JS/CSS references and cache versions;
- no inline raw secrets/provider URLs;
- microphone capability/fallback branches;
- quality warnings do not emit sound or stop timer;
- invitation modal content/accept/decline;
- Guest no-access/no-share controls;
- current VIP-only confirmation card;
- share disabled until own confirmation;
- teacher name multi-select default all;
- external page noindex and no audio/download controls;
- safe empty/loading/failed/expired states;
- keyboard focus, Escape/backdrop, and background scroll lock;
- `prefers-reduced-motion` for animated meters/transitions.

### 20.3 Syntax/release commands

Run:

```bash
node --check assets/js/speaking-lab.js
node --check assets/js/speaking-report.js
node --check assets/js/teacher-speaking.js
node --check cloudfunctions/speakingLab/index.js
node --check cloudfunctions/speakingAiWorker/index.js
npm run test:speaking-lab
npm run test:writing-tutor
npm run test:learning-reports
npm run verify:release
npm run build:static
npm run package:functions -- speakingLab speakingAiWorker
npm run release:plan
git diff --check
git status --short --branch
```

Inspect generated ZIPs without printing code or secrets and confirm each contains
only bundled `index.js` and `package.json`.

### 20.4 Manual browser matrix

Test at minimum:

- iPhone Safari current;
- iPad Safari current;
- Chrome desktop;
- one Android Chrome device if available;
- reduced motion;
- microphone allowed/denied/ended;
- live recording and audio upload;
- refresh during upload handoff, queued analysis, processing, and ready report;
- two concurrent tabs using the same operation;
- creator plus pending/accepted/declined VIP;
- one or more Guests;
- teacher remap after student dispute;
- student and teacher share links before/after confirmation;
- expired/revoked link.

Do not claim production ASR/voice matching passed until section 15 real-audio
benchmark and owner-authorized development deployment are complete.

## 21. Deployment order and rollback

Owner-only deployment order:

1. Create all new `ADMINONLY` collections.
2. Add indexes and verify unique-index creation on empty/development data.
3. Configure provider environment names/values only after benchmark.
4. Deploy `speakingLab` and `speakingAiWorker` from the same commit.
5. Set `speakingAiWorker.invoke` to `false`, then configure the one-minute
   `speaking-ai-worker-minute` timer without a custom argument.
6. Run authenticated backend smoke tests in development.
7. Publish cache-busted static pages/assets.
8. Test one controlled Discussion with non-sensitive development audio.
9. Only then enable ordinary student entry.

Rollback:

- hide/remove the static Speaking entry first;
- stop the worker timer if provider calls must stop;
- roll back functions together;
- retain Discussion/report/audit rows and private audio unless an explicit
  teacher deletion policy is executed;
- revoke active share links;
- never drop collections or mass-delete history as a rollback shortcut.

## 22. Completion definition

Local implementation is complete only when:

- every Phase A–D acceptance test passes;
- production provider paths fail closed rather than creating fake output;
- documentation matches code;
- functions package successfully;
- no deployment occurred;
- the handoff names the exact provider benchmark and owner CloudBase actions
  still required.

Production release is complete only after Phase E benchmark, owner provider
approval, development deployment, real-audio QA, and owner-authorized static
publication.

## 23. Executor final report format

The implementing agent must end with:

1. files added/changed;
2. behavior completed by phase;
3. tests run with pass/fail result;
4. deliberately unimplemented provider/deployment work;
5. new collections/indexes/functions/timer/env names requiring owner action;
6. privacy/security risks still remaining;
7. `AGENT_TODO.md` entry location.

Do not say “the feature is finished” when only fixture tests pass or when no
speech provider has passed the owner's real-audio benchmark.
