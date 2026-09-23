# 08 Backlog

> Product, technical, and documentation backlog.
> Update it when new work is discovered or priorities change.

## High Priority

### Cleanup closeout and retained prerequisites (2026-09-21)

- Exact saved-live provenance reconciled the earlier intensiveListening,
  teacherAdmin and submitAttempt bundle differences. They were uncalled shared
  module additions, not missing target behavior. The final scoped function
  release has its own fresh code/config/ACL preflight and rollback packages.
- Listening `recordActivity` is still called on unit navigation and audio time
  updates; it is not dead code and remains. Backend-only aliases and the empty
  assignment-track runtime were retired after source/history, live metadata and
  log-retention review. Do not remove historical progress or session evidence.
- Keep teacherAdmin repair actions under their existing active-teacher guard.
  A missing UI caller does not make an operational API dead code. Source audit
  below distinguishes recurring repair tools from possible one-time migrations;
  production metadata was audited below; repair completion and old-client
  retirement must not be inferred from an action name or a zero candidate count.
- Dashboard duplicate normal warm-up requests are removed in phase two,
  with pagination retained only as a failure fallback. Keep the authoritative
  full result: bootstrap/pages do not reconstruct self-study, global-best/STAR
  repairs and wallet history. Real-account phase-two acceptance is complete.
- Remove Vocabulary/catalog JS fallbacks only after explicitly retiring their
  documented local-file compatibility and updating all generators/checks.
- IELTS Reading's retired Argue UI is removed in phase two after checking
  the explicit August 12 product policy and backend rejection paths. Stale UI
  wording and a test-only function expectation are corrected; Explain, teacher
  preview and historical feedback remain. No historical dispute is deleted.
- Reconcile the shared checkout's unfinished rebase separately. The cleanup
  is isolated on `codex/project-cleanup`, based on `origin/main` at 2267b364;
  original modified/untracked files were preserved and backed up locally.
- Review remaining private release worktrees individually; do not bulk-delete
  `.cloudbase-private`, which contains source material and deployment evidence.

### Runtime cleanup decisions (2026-09-21; source + production metadata)

| Candidate | Confirmed dependency or purpose | Decision / retirement prerequisite |
| --- | --- | --- |
| Listening `recordActivity` | Current browser navigation/audio calls; server starts/refreshes/closes teacher notification sessions | Keep. Effective-time tracking is not evidence that notification-session work is redundant. |
| Listening action aliases / assignment tracks | No committed client generation used the aliases; production has zero Listening assignment/track rows | Retired runtime aliases/track code. The empty ADMINONLY collection remains; no data deletion. |
| `backfillAcceptedAnswerRegrades` | Explicit product requirement; repairs historical results after accepted-answer changes | Keep as repair tooling, not a one-time migration assumed complete. Attempts are paged (max 200), but grading keys are loaded in full. |
| `backfillVocabularyContentVersionMismatch` | Repairs a specified set's stale content/grading-version incident | Keep for recovery. Reads all attempts for the selected set; no bounded page contract. |
| `backfillAssignmentDueWeeks` | Repairs missing/non-normalized due weeks; troubleshooting still references it | Possible retirement only after complete zero-candidate / zero-missing-source audit and old writer retirement. Output is limited, but every call reads all assignments. |
| `backfillLearningReportModel` | One-time class/report cutover; current writers enforce the canonical model | Retired after complete audit found zero profile/membership repairs and zero promotable legacy batches. |
| `migrateStarRewards` | One-time Yellow ledger/converted Blue cutover; current writers use the canonical shared STAR module | Retired after complete audit found zero missing/unclassified/normalization candidates. |
| Vocabulary/catalog JS fallbacks | `AGENTS.md` explicitly requires local-file loading compatibility | Keep unless the owner deliberately retires that supported use case. |

All five teacher actions were source-reviewed. The final decisions also use two
stable, complete, field-projected production metadata passes; no migration
handler was invoked. Future audits should remain bounded and aggregate-only;
applying a repair, changing permissions, or deleting history needs separate scope.

### Final read-only production audit (2026-09-21, 23:47 Shanghai)

Two complete metadata passes, each paged at 100 rows with an explicit upper
bound, returned identical projected data across seven collections. This is a
stable observed interval, not a transactional snapshot. The comparison uses
current source rules after saved-live provenance reconciliation.
No migration handler, write, account impersonation, answer or grading-key read
was performed. Only aggregate evidence is retained in the original checkout's
ignored `.local/cleanup-release-audit/retirement-metadata-audit.json`.

| Scope | Observed result | Cleanup decision |
| --- | --- | --- |
| Assignment due weeks | Fresh post-repair audit: 798 assignments; 243 remaining candidates, 245 missing `due_at`, one non-normalized date and 3 missing sources. | Keep due-date compatibility and `backfillAssignmentDueWeeks`; do not bulk-normalize history as a cleanup side effect. |
| Due-week status population | 51 `mastered`, 42 `cancelled`, 144 `passed`, 5 `to_do`, 1 `done` | Historical completed/cancelled/excluded rows remain deliberate compatibility dependencies. |
| Class/report metadata | 36 active students; zero proposed class creation, profile change, membership change or multiple-active-membership cases | No class repair is indicated by this comparison. |
| Assignment scope | 206 batches: 27 already scoped, zero promotable legacy batches; 147 partial/mixed-recipient and 32 existing non-legacy-scope batches are skipped | Skips are not automatically faults or missing migrations; do not promote partial or explicitly individual work. |
| STAR migration | 166 achievements: 78 Yellow, 88 Blue; zero missing credits, converted Blue rows, unclassified achievements or normalization candidates | Migration entry retired; current STAR writers retained. |
| Old Listening assignments | Zero `assignment_kind: listening`, zero `IL-*` assignment rows, zero assignment-track rows | Backend-only aliases/track runtime retired; active `recordActivity` retained. |

### Approved due-week repair and next cleanup plan (2026-09-21, 22:56 Shanghai)

The owner reviewed exact records and approved 37 enabled-account open rows.
Only their null `due_at` fields were filled with BSON dates, based on actual
Shanghai `created_at`: Mon–Fri -> same week, Sat/Sun -> next week, Sunday
23:59:59. Thirteen effective weeks shifted later; 24 did not. Five deleted /
deleting-account rows and three anomalous/source-less rows were excluded.
Before/after comparisons verified all other fields and all eight exclusions
unchanged. No all-history backfill handler was invoked. See Deployment for
private backup/evidence and rollback conditions.

The aggregate table above is the earlier snapshot. The historical remainder
includes completed/cancelled work and the excluded records; it has NOT been
re-audited collection-wide after the repair and does not justify removing fallback.

Next stages, ordered by their dependencies:

1. **Completed:** owner accepted the repaired historical weeks and phase-two
   real-account student/teacher behavior. No new rollout was needed.
2. **Completed:** exact saved-live provenance and current bundle inputs were
   reconciled for intensiveListening, teacherAdmin and submitAttempt. The only
   differences are uncalled later additions in transitive CommonJS modules:
   Writing Argue mail, Intensive Listening email rendering, and chunked Speaking
   analysis helpers respectively. No target behavior is missing and no hash-only
   deployment is indicated. Preserve the shared checkout's unfinished rebase.
3. **Completed:** Listening retirement assessment. Committed browser generations
   use canonical action names; no static service worker exists; production has no
   old assignment/track rows. Retired aliases/track runtime, kept `recordActivity`.
4. **Completed:** repair-tool decision. Retired the completed report/STAR
   migrations; kept accepted-answer/content-version repairs and due-week
   compatibility. No history was migrated merely to make code deletable.

Reconciliation evidence: the saved live intensiveListening bundle exactly
rebuilds from `194bbb53`; submitAttempt from `e6cb5901`; teacherAdmin from
`2267b364` with `_shared/speaking-lab.js` at `65f48489`. Current source differs
in exactly one bundled input per function. Relevant regression suites pass.
Private hashes/input maps remain under `.local/cleanup-release-audit/`; no
student data, prompts, answers or credentials are in the committed summary.

Vocabulary/catalog JS local-file fallbacks stay under the existing product
contract. Duplicate content records and the original checkout rebase remain
separate, owner-scoped work; neither is included in this database repair.

### Existing product work

- Add teacher-managed accepted spelling variants and a bounded abandoned-replay
  cleanup policy after the first Intensive Listening classroom trial.

- Verify deployed P0 backend fixes in CloudBase development:
  - low-score retry does not downgrade passed assignment
  - completed/STAR work can be reassigned
  - Argue approval can create or repair STAR
- Investigate teacher Progress data freshness after recent student completion.
- Add lightweight smoke-test script for JSON parsing, catalog links, and key static pages.
- Extend the existing assignment/STAR/Argue/Vocabulary rule suites only for
  demonstrated coverage gaps; these suites already exist and pass locally.
- Build a grading-key reconcile workflow so local imports do not overwrite teacher-approved CloudBase corrections.
- Pass durable `question_text` from every practice runtime's Argue submission path.
- Add optional owner-only CloudBase CLI workflow after testing the local release helpers.
- Attempt-email outbox/indexes, `submitAttempt`, `teacherAdmin`,
  `sendTeacherAttemptEmails`, and the matching Personal Center UI were deployed
  to development on 2026-08-11. The owner still needs to enter the iCloud SMTP
  app password and non-secret mail settings in the CloudBase console, add and
  enable the two test inboxes in Personal Center, and verify delivery with a
  development student. The authorized one-minute timer was enabled on
  2026-08-12.
- Learning Reports V1 development collections/indexes, report functions, and
  the class/membership/assignment-scope migration were completed on 2026-08-04.
  Before enabling it for a real class, publish the matching static report page,
  verify timer idempotency and response redaction with development accounts,
  then obtain explicit owner approval for the timer token and schedules.

## Medium Priority

- Define the My Words Study learning loop before replacing its honest static
  placeholder; decide prompts, feedback, progress ownership, and whether any
  review schedule belongs in the backend.
- Shared backend modules already exist under `cloudfunctions/_shared/`. Extract
  further code only when concrete duplication is confirmed and behavior parity
  is tested; do not introduce another abstraction layer as a generic cleanup.
- Clean old documentation references to `done/failed`, three-card dashboard, and STAR blocking reassignment.
- Improve teacher Progress filters by class, student, set, and curriculum track.
- Add browser smoke coverage for visitor mode, student login, and teacher preview.
- Add automated authenticated CloudBase integration coverage for My Words edit,
  merge/undo, AI draft races, teacher replacement history, and report resolution.
- Continue private-answer migration for legacy public runtime JSON.
- Add checksum/version comparison between cloud-function source and deployed ZIPs.
- Add scheduled-report observability: timer failure alerting, generated/published
  status dashboard, and an audited correction/republication workflow.
- Add attempt-email delivery observability for failed/retried events, SMTP
  rejection/bounce visibility, and a teacher-only resend/recovery action.
- Track Tencent CloudBase Node SDK updates that replace its legacy Axios and
  lodash database dependencies. The 2026-08-11 production-dependency audit of
  `@cloudbase/node-sdk@3.18.1` reports upstream high-severity advisories; npm's
  suggested `3.0.0` is an invalid downgrade here, so do not apply
  `npm audit fix --force`. Reassess when Tencent publishes a compatible refresh.

## Low Priority

- Improve consistency of modals across practice pages.
- Decide whether browser-generated pronunciation is sufficient long term;
  device voices vary, and a fixed recorded accent would require an explicit
  audio-asset or trusted-provider plan.
- Add clearer teacher-side activity/read state.
- Add better empty/developing states for future sections.
- Reduce duplicated inline practice-page logic over time.
- Improve local development startup instructions.

## Later / Optional

- Multi-teacher roles and organization model.
- Bind teachers to students/assignments, then partition Yellow STAR Cash
  authority so only the responsible teacher can process those requests.
- Open the Gifts destination after the owner defines inventory and fulfillment.
- Parent accounts.
- Add verified student-to-guardian email bindings, consent/audit state, and
  per-student delivery before any parent address receives attempt mail. Never
  reuse the global teacher inbox allowlist for unrelated parents.
- Consider additional official notification channels only after ordinary-email
  delivery is stable; preserve the shared private outbox rather than coupling a
  new channel to student grading.
- Evaluate an official family notification channel (verified email, WeCom, or
  Mini Program subscription) only after the report content is proven useful;
  do not use personal-WeChat RPA/third-party account robots as a shortcut.
- Commercial billing/subscription features.
- Email/phone/WeChat login binding.
- Rich analytics dashboard.
- Add familiarity metadata and familiarity-based My Words export filters after
  the owner defines the learning model.
- Finalize the My Words PDF visual design with the owner; the first release uses
  a clean print-ready table and browser Save as PDF.
- Consider Vocabulary Practice worksheet export separately from the current
  Word List-only export.
- Migration to a frontend framework if static HTML becomes too hard to maintain.
- Add explicit student-visible / teacher-assignable edition archive controls only
  after the owner asks to hide an older edition; all editions remain visible now.

## Commercial Readiness Checklist

Before commercial use, review:

- production CloudBase environment separation
- backup/export plan for student data and attempts
- privacy policy and data retention rules
- account recovery workflow
- monitoring/error visibility
- manual admin procedures
- grading key backup and restore
- security review of cloud functions and database permissions
- AI Tutor: consider Cambridge 9093 Papers 1, 3, and 4 only if source-text and language-data inputs are added
- AI Tutor: optional CEFR A2/B1/C1 language-upgrade variants
- AI Tutor: targeted grammar/content lessons generated from repeated Writing Observations
- AI Tutor: human moderation and model-quality evaluation dataset before high-stakes use

- Speaking Lab: benchmark and approve the implemented Tencent recording-file
  recognition and OpenAI-compatible DSE report adapters on real student audio;
  video extraction, pronunciation/delivery assessment, PDF export, stronger
  streaming upload protection, and an individual speaking mode remain out of
  V1. Add provider fallback only after a measured quality/cost review. Benchmark
  reusable Tencent voiceprints across devices and accents, define the production
  confidence/separation thresholds, monitor the 1000-voiceprint AppID limit, and
  add an owner-facing capacity/cleanup audit before enabling automatic matches.
  The private Tencent CI excerpt boundary is implemented but still needs
  owner-gated bucket binding, least-privilege CAM review, real-audio conversion
  benchmarking, cleanup verification, and cost monitoring before production
  automatic matching is considered accepted.

- Intensive Listening: owner-gated notification-session index and production
  timer rollout; benchmark large catalog scans and mixed bell pagination.
- Intensive Listening: future source-specific importer validation and
  authoring tooling remain outside the first release.

- Speaking Set Library: future Viewpoint Bank, Useful Language, structured
  search/filtering, Part B sharing, pronunciation/delivery assessment, and
  richer teacher Individual Response comparison remain outside this release.

Scan Words V1 is implemented. Keep context-specific dictionary senses, image
token boxes, PDF scanning, scan history, and context-aware AI enrichment as
explicit post-V1 backlog items; they are intentionally outside this release.
### Listening V2 follow-up

Owner-gated production policy approval, Tencent cost/quality benchmarking,
collection indexes, timer configuration, and real-device microphone smoke tests
remain rollout work. Future iterations may add richer phoneme feedback and
teacher analytics, but must preserve the 80/79 product boundary and private
provider contract.

## IELTS Speaking V1 rollout follow-up (2026-09-15)

Local feature code is implemented. The owner-supplied Cambridge 10/11 HTML
has been extracted and checked: eight paired cards, 8 Part 2 and 49 Part 3
questions, with private local import artifacts ready. Live import is verified. Seasonal bank intentionally stays a placeholder. Collection/index setup and both Speaking function updates are complete. Finish
real microphone, ASR/report and teacher-view acceptance after static publication. First-version pronunciation remains
unassessed by owner decision; no overall band is inferred. See
[handoff](IELTS_SPEAKING_LAB.md).


## 2026-09-16 — Speaking feedback acceptance

After rollout, verify report/audio playback and email entry on the owner's
actual devices. The scoped release is based on current main and passes its full
DSE/IELTS suites; stale-root recorder/capsule failures do not affect this release.

### Listening retirement source sync (2026-09-23)

The Dictation-only backend and scoped COS static release are live, but GitHub
`main` still predates the Shadowing removal. Source commit `239ce0c7` is saved
on `codex/retire-listening-shadowing`. Reconcile the current COS public tree
with GitHub source before merging it to `main` or running the full static
workflow; that workflow deletes obsolete objects and can overwrite other
concurrent production changes. Keep the private rollout snapshots until the
source and live site match.
