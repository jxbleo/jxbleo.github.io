# IELTS Speaking Lab — V1 implementation and content handoff

Owner decisions confirmed 2026-09-14; implementation verification 2026-09-15.

## Scope

Dashboard has independent HKDSE Speaking Lab and IELTS Speaking Lab capsules.
IELTS is authenticated classroom free practice, limited to Part 2 and Part 3.
One topic joins its Part 2 cue card and related Part 3 questions. Students may
choose any question, stop early, preview/replace local audio, and submit questions
independently. Each new submitted practice is a separate permanent response.
No assignment, completion, STAR, Part 1, teacher topic editor, or voiceprint
workflow is added. Teachers can read all IELTS responses from Teacher Speaking's
IELTS entry, filtering by exact Login ID and topic. This reuses authentication;
a URL, query parameter, or supplied UID never grants teacher authority.

Part 2 offers an optional `One minute preparation` button on the recorder.
The preparation timer does not start the microphone. Recording starts explicitly
and lasts at most 120 seconds. Part 3 has no preparation timer and lasts at most
90 seconds. Both can stop early. Hiding the browser tab ends the current take
to preserve audio rather than continuing a background recording indefinitely.
The server tolerates two seconds of browser encoder/stop latency, using a
server-selected limit and rechecking provider duration before analysis. Existing
DSE keeps its 65-second limit and three-second transport tolerance.

Reports use exactly three cards when ready:

1. Session details, owned audio playback, and a collapsed Transcript.
2. Analysis: independent 1–9 integer training estimates for Fluency & Coherence,
   Lexical Resource, and Grammatical Range & Accuracy; Chinese commentary and
   exact English evidence excerpts. Pronunciation is not assessed; no overall
   band is generated. Insufficient evidence yields a null score and explanation.
3. Band 8 Answer: Chinese Thinking Prompt with optional English keywords, then
   an initially collapsed, original English Sample Answer targeting Band 8.
   It preserves the student's ideas where workable and develops them as needed.

The reference is the [official IELTS descriptors](https://ielts.org/cdn/ielts-guides/ielts-speaking-band-descriptors.pdf).
IELTS's [scoring explanation](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail)
describes four equally weighted criteria. Three single-question estimates are
therefore not a complete Speaking band. ASR text and segment timings cannot
establish intonation, exact pauses, or pronunciation. Prompts must acknowledge
this limitation and must not penalize ambiguous recognition errors.

## Content research and current completeness

**Eight topic cards were imported into CloudBase and verified on 2026-09-15.**

The owner supplied `Desktop/cambridge-ielts-10-11-speaking.html` on 2026-09-15.
It contains four Tests per book: 8 Part 2 cue cards and 49 Part 3 questions
(24 for Cambridge 10, 25 for Cambridge 11). Each Test stays paired, preserving
question order, follow-up wording and discussion groups. Part 1 is excluded.
The final Part 2 “and explain” bullet is stored as the closing instruction.

The exact source backup, reproducible extraction script, source SHA-256 and
review notes are in `.cloudbase-private/sources/ielts-c10-c11/`. Normalized
input is `.cloudbase-private/sources/ielts-speaking.json`; validated JSON Lines
are `.cloudbase-private/import/ielts-speaking-sets-cloudbase.json`.
Verification means faithful extraction from the supplied HTML; the publisher
edition was not independently checked. The supplied C10 Test 4 second group
heading has a noted topic mismatch and is retained without silently changing
it. C11 Test 4 has seven Part 3 questions in the supplied document; all remain.

Owner clarification (2026-09-15): the initial import covers Cambridge IELTS
10 and 11 only, retaining each Test's original Part 2 / Part 3 pairing.
Other volumes in the research index are outside this initial import scope;
the seasonal bank remains a placeholder. The owner-supplied compilation is now prepared.

The [Cambridge preparation page](https://www.cambridgeenglish.org/exams-and-tests/ielts/preparation/)
lists IELTS 21 as the current volume. The publisher's
[IELTS 21 Academic excerpt](https://assets.cambridge.org/97810098/26723/excerpt/9781009826723_excerpt.pdf)
confirms four authentic papers; it is an introduction, not a complete speaking
corpus. [IELTS 20's official product record](https://shop.cambridge.org/english/product/2700250101)
likewise describes four papers. Research references and acquisition status for
volumes 1–21 are recorded in `content/speaking/ielts-source-index.json`.
This index does not certify uninspected per-test contents.

The complete copyrighted question bank was not copied from third-party websites.
This intake uses the owner-supplied HTML question file. Never fill
gaps with generated questions, label paraphrases as official wording, or force
an older speaking format into modern Part 2/3 fields. Inspect the source edition
and original grouping first. Keep complete raw content and normalized intake in
ignored `.cloudbase-private/sources/`; do not add it to public Git or `dist/`.
The existing static build excludes `content/speaking` as well.

The student library labels its sources `剑雅官方真题` and `当季题库`.
Cambridge topics use book → Test; seasonal topics use year → season. New seasons
do not hide older topics. The seasonal source is intentionally an empty
`Coming soon` placeholder. Cambridge 10/11 now has eight visible private topic records.

## Agent intake procedure

The owner provides source files; the agent performs extraction and review.
Do not ask the owner to hand-author JSON. Produce an array of topic objects with:

- `set_id`: `ielts-c<book>-t<test>` for Cambridge, or
  `ielts-season-<stable-key>` for seasonal topics.
- `source_kind`: `cambridge` or `seasonal`; `book`/`test` for Cambridge, or
  `year`/`season` for seasonal material. `test` is 1–4.
- `title`, `content_revision` (positive integer), `source_reference`
  (source filename/page or URL), `source_verified: true` only after review,
  and explicit `visible_to_students`.
- `part_2`: `text`, ordered `bullets`, optional `closing`. The normalizer supplies
  stable `question_id: p2`, `part: 2`, and `order: 1`.
- `part_3`: ordered questions with stable `question_id: p3_01`, etc., `text`, and
  optional original discussion-group label `group`. Preserve IDs on updates;
  display order may change independently.

Validate with `node scripts/prepare-ielts-speaking.js --source <private-file>`.
After reviewing the safe count/ID output, add `--write` to generate local JSON
Lines at `.cloudbase-private/import/ielts-speaking-sets-cloudbase.json`. This
does not contact CloudBase. Empty, duplicate, incomplete or unverified input is
rejected. No-source dry runs leave existing import files untouched.

## Backend and deployment

No new provider, model, library dependency, timer, or function is introduced.
The paired Speaking/Writing text-model policy remains unchanged. IELTS uses
`speakingLab` and the existing durable worker transport. Shared assets, jobs,
reports and responses retain the single `response_session_id` locator and add
`exam_family: ielts`; existing rows without that field remain DSE. Prompts,
rubric and report schema use `ielts-speaking-v1`. IELTS analysis is stored in
`ielts_analysis`, not `dse_analysis`. Browser projections whitelist fields and
exclude reports/question snapshots from IELTS history summaries.

Create one **ADMINONLY** collection, `ielts_speaking_sets`, with these indexes:

- Unique `set_id`.
- `visible_to_students ASC, source_verified ASC, set_id ASC`.
- `visible_to_students ASC, source_verified ASC, source_kind ASC, set_id ASC`.

The existing `speaking_individual_responses` unique `response_session_id` stays.
Add history indexes with the common prefix
`exam_family ASC, deleted_at ASC, recording_status ASC`, optional equality fields
from the following list, and suffix `created_at DESC, response_session_id DESC`:

- No optional fields (teacher all-history).
- `set_id` (teacher topic).
- `student_uid` (student history).
- `student_uid, set_id` (student topic).
- `student_id_snapshot` (teacher exact Login ID).
- `student_id_snapshot, set_id` (teacher Login ID plus topic).

Keep the shared `speaking_reports` unique locator index
`discussion_id + response_session_id + report_version`; the obsolete
`discussion_id + report_version` index must already be removed, or independent
responses collide. Existing audio, jobs and usage indexes remain valid.

Owner authorization is still required for collection/index creation, live
imports and deployment. Review the existing dirty working tree before any
publication. After content is provided and locally prepared:

```sh
npm run cloudbase:import:content -- --only ielts_speaking_sets
# Only after explicit owner authorization:
npm run cloudbase:import:content -- --only ielts_speaking_sets --apply
```

The importer defaults to inserting missing stable IDs. Never overwrite existing
topic revisions casually. Old session snapshots must remain unchanged.

Package `speakingLab` and `speakingAiWorker`, then deploy the authorized gateway
and worker before publishing static assets. Keep `speakingAiWorker` client
invocation denied and retain its existing timer. No model configuration apply
or secret changes are needed. Long-lived formal audio remains private; playback
returns an authorized temporary URL, never stores that URL in the response,
and does not put audio/transcripts/reports in browser persistent caches.

## Verification and release acceptance

`npm run test:ielts-speaking` uses original synthetic fixtures only. It exercises
source validation, authentication, spoofed UIDs, student ownership, teacher read
permissions, concurrent idempotent session creation, immutable audio submission,
trusted timing, two independent reports without collisions, durable analysis,
exact-quote validation, excluded overall/pronunciation scores, revision snapshots
and history pagination beyond 50 responses. Existing DSE suites must pass too.

Live acceptance remains pending: actual owner-supplied question intake, authorized
CloudBase rollout, microphone/upload checks on Safari/iOS and Android, a real
Tencent transcription plus model report, and teacher review. Automated fixture
tests establish contracts, not the accuracy of live IELTS band estimates.


## 2026-09-15 — Authorized IELTS Speaking rollout

Owner authorized publication. Created ADMINONLY `ielts_speaking_sets`, added
three topic indexes and six IELTS history indexes, and inserted only Cambridge
10/11 Tests 1–4. Live readback matched all eight source records (8 Part 2,
49 Part 3). Existing Speaking records and indexes were retained.

Both `speakingLab` and `speakingAiWorker` were deployed from a scoped release
copy based on `d5193d8c`; downloaded ZIP SHA-256 values match the uploaded
packages. Function configuration hashes before/after are identical, including
environment values and timer configuration; worker client invocation remains
denied. Speaking/Writing text models were checked together and preserved.

The static release version is `20260915-ielts-speaking-1`. Its scoped source
retains current main's DSE history, report refresh, recorder and model-attempt
auditing. Private source and import artifacts are excluded from the public
build. IELTS and full current DSE test suites, release checks and packaging
passed. Deployment evidence and rollback packages are private under
`.cloudbase-private/ielts-speaking-release-audit/`.

Browser automation timed out during release checks; no live student recording
or provider-generated IELTS report is claimed as tested. Device audio and
real-provider calibration remain acceptance follow-ups.
