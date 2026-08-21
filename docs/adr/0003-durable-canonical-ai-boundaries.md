# ADR 0003: Durable and canonical AI boundaries

Status: Accepted
Date: 2026-08-21

## Context

The first AI Tutor writing rollout exposed failure modes that apply to every
future AI feature in Mr. Cat Academy:

1. A browser request is not a durable owner of a slow model call. Both OCR and
   writing review returned `Network error` when CloudBase or the browser stopped
   waiting before Qwen finished.
2. Upload completion and AI-job creation cannot be separate browser-dependent
   steps. A closed tab can otherwise leave private files without recoverable
   work.
3. OpenAI-compatible providers are transport-compatible, not behavior-identical.
   Qwen returned JSON wrapped as a string, one object per image page, and echoed
   sentence text with normalized whitespace or punctuation.
4. Strict JSON Schema is necessary but insufficient. Structurally valid output
   can still contain missing, duplicate, unknown, or reordered domain IDs.
5. Exact model echoes are not authoritative. Requiring Qwen's `original` field
   to match the manuscript byte-for-byte caused
   `WRITING_AI_SENTENCE_ALIGNMENT_FAILED` even when its analysis was usable.
6. Retries need stable identity and quota semantics. A lost response must not
   create another charge, Composition, or provider call.
7. A successful upload command is not proof that production is serving new
   code. CloudBase function status and the static cache-busted asset must both
   be verified.

No incident record may contain API keys, full endpoint URLs, dispatch or lease
tokens, student manuscripts, OCR text, model feedback, or student identity.

## Decision

Every slow AI capability must use the following boundary:

1. The authenticated action validates input, creates a stable `operation_id`,
   reserves quota idempotently when applicable, and creates a metadata-only
   durable job. It returns immediately.
2. A cloud worker claims the job with a bounded attempt count and expiring lease.
   A timer recovers queued jobs and expired leases without a browser session.
3. The model response is normalized for explicitly supported provider wrappers,
   then validated against a versioned local schema.
4. The server performs domain canonicalization after schema validation. Stable
   IDs must be complete and unique. Authoritative source fields—original text,
   score scales, Rubric labels, state transitions, and acceptance rules—come
   from server data, never from a model echo or summary flag.
5. Result publication, job completion, and usage success are guarded by the
   current lease plus `Composition.active_job_id` in a transaction. A stale job
   becomes `superseded` and cannot overwrite newer work.
6. Retryable failures keep the reservation. Terminal failure releases it
   idempotently. Successful use is charged exactly once.
7. The client polls the Composition, supports refresh/re-login/reopen, and keeps
   the same logical operation ID while delivery is uncertain.

The model adapter remains vendor-neutral. Qwen, DeepSeek, Kimi, or another
mainland-accessible provider may be selected through server environment values,
but each model/protocol combination must pass the same contract tests before use.

### Qwen configuration lessons

The current production adapter uses server-only `WRITING_AI_*` environment
values. Text review and vision/OCR may use different model and protocol values;
the shared API key is allowed only in the function environment. The observed
working shape is an OpenAI-compatible Chat Completions base ending in
`compatible-mode/v1`, a Qwen text model for reviews, and a lower-latency
vision-capable Qwen model for OCR. `chat_json_schema` should be used only when
that exact model supports native structured output; otherwise
`chat_json_object` still requires local schema validation and the bounded repair
attempt. `WRITING_AI_VISION_IMAGE_TRANSPORT=url` means the function supplies
short-lived private image URLs to the vision request.

CloudBase environment keys must use the exact repository-documented uppercase
names and contain only letters, digits, and underscores. Values must not include
UI labels, surrounding quotes, or copied whitespace. A key shown in a screenshot
or terminal transcript must be rotated; documentation records variable names and
protocol decisions, never credential values.

## Incident log and reusable diagnosis

| Symptom or code | Confirmed cause | Durable correction | Do not do |
|---|---|---|---|
| Photo upload succeeds, then browser shows `Network error` | OCR awaited the vision model inside the browser request | `finishPhotoUpload` confirms storage and enqueues one stable OCR job in the same server handoff | Do not only increase the browser timeout |
| OCR remains “in cloud” forever | Function update was not active, a dispatch was lost, or an old row had no durable job ID | Verify function deployment; timer redispatches queued/expired leases; convert non-resumable legacy state to a specific recoverable failure | Do not ask the student to create another Composition automatically |
| `$ must be an object` or schema-invalid OCR | Provider returned a JSON string wrapper or a page-array root | Normalize only documented wrappers/page arrays, then run the same strict local validation | Do not disable schema validation |
| OCR succeeds, `开始批改` returns `Network error` | Standardized/language review still awaited the text model synchronously | Enqueue `job_type: review`, return queued state, and poll the Composition | Do not change the model name without an error indicating model availability |
| `WRITING_AI_SENTENCE_ALIGNMENT_FAILED` with all expected sentence IDs | Qwen normalized whitespace/punctuation in echoed `original` | Validate complete unique IDs, order by server sentence units, and restore exact originals from the manuscript | Do not weaken missing/duplicate/unknown-ID checks |
| Lost response or repeated click | The client could generate another operation identity | Keep a stable logical operation ID; create job/usage rows under stable IDs and replay them | Do not use random IDs per HTTP retry |
| Replacement model call fails | Old review was cleared before new AI work succeeded | Stage `pending_replacement` and publish success-then-swap | Do not destroy the committed review at draft-save time |
| Provider call fails after quota reservation | Reservation and failure handling were separate/non-idempotent | Release only a still-`reserved` usage row in a transaction | Do not decrement quota outside an idempotent guard |
| Code upload reports success but behavior is unchanged | Production function was `UpdateFailed`, wrong package directory was uploaded, or static cache stayed old | Bundle the function, upload from the extracted bundle, require `Deployment completed`, bump the client asset version, and verify the static workflow | Do not infer active production from one CLI upload line |

During the 2026-08-21 rollout, four failed General Language Review usage events
were observed with the same safe alignment error code. Each was confirmed as
`failed` with `released_at` set; no manuscript or student identifier was copied
into this incident record. Repetition of one safe code across retries was the
signal to fix canonicalization instead of changing the model.

## Required observability

Persist only safe metadata:

- job ID, operation ID, job type, review mode, Composition ID/revision;
- status, attempt count, safe error code, retry/lease timestamps;
- prompt/schema/Rubric versions and non-secret model/protocol metadata;
- usage ID, word count, Shanghai day, reservation/success/release status;
- deployment commit and function modification/status evidence in maintenance logs.

Keep these fields out of logs and job rows:

- API keys, authorization headers, full provider URLs, internal tokens;
- manuscript/OCR/feedback payloads and uploaded-image URLs;
- student names, login IDs, email addresses, or other personal data.

## Release gate for future AI features

- Prove browser disconnect, refresh, re-login, and duplicate delivery recovery.
- Force a transient provider failure, lease expiry, terminal failure, and stale
  result publication.
- Test provider wrappers plus malformed, missing-ID, duplicate-ID, unknown-ID,
  reordered-ID, and normalized-source-text responses.
- Verify canonical server rules override contradictory model fields.
- Verify one logical operation creates one job and one quota charge.
- Verify terminal failure refunds quota and preserves committed user data.
- Verify deployed function status, timer recovery, asset cache version, and the
  public release workflow.

## Consequences

AI features require more backend state and contract testing, but model latency,
browser lifetime, and harmless provider formatting variations no longer control
product correctness. The remaining synchronous `submitRewrites` model call is a
known exception and should move onto the same durable job boundary before it is
treated as production-hardened.
