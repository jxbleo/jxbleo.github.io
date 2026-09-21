# 08 Backlog

> Product, technical, and documentation backlog.
> Update it when new work is discovered or priorities change.

## High Priority

### Remaining cleanup prerequisites (2026-09-21)

- Release preflight found live/main bundle differences in intensiveListening,
  teacherAdmin and submitAttempt. All six source cleanups preserve executable
  code, so their live functions are intentionally retained. Reconcile these
  existing differences separately before any future function deployment.
- Listening `recordActivity` is still called on unit navigation and audio time
  updates; it is not dead code. Any retirement of this path, action aliases or
  assignment-track compatibility requires a separate replacement/dependency
  audit, read-only live data/call-log checks and an old-client cache window.
  Do not remove historical progress or session evidence.
- Keep teacherAdmin repair actions under their existing active-teacher guard.
  A missing UI caller does not make an operational API dead code. Source audit
  below distinguishes recurring repair tools from possible one-time migrations;
  production metadata was audited below; repair completion and old-client
  retirement must not be inferred from an action name or a zero candidate count.
- Dashboard duplicate normal warm-up requests are removed in phase two,
  with pagination retained only as a failure fallback. Keep the authoritative
  full result: bootstrap/pages do not reconstruct self-study, global-best/STAR
  repairs and wallet history. A new supplement endpoint is not needed for this
  cleanup. Real-account phase-two browser acceptance remains pending.
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

### Remaining runtime cleanup audit (2026-09-21; source-only)

| Candidate | Confirmed dependency or purpose | Decision / retirement prerequisite |
| --- | --- | --- |
| Listening `recordActivity` | Current browser navigation/audio calls; server starts/refreshes/closes teacher notification sessions | Keep. Effective-time tracking is not evidence that notification-session work is redundant. |
| Listening action aliases / assignment tracks | Exported router contracts and historical assignment-track reads/updates remain | Keep pending old-client usage window and historical-data audit; no collection deletion. |
| `backfillAcceptedAnswerRegrades` | Explicit product requirement; repairs historical results after accepted-answer changes | Keep as repair tooling, not a one-time migration assumed complete. Attempts are paged (max 200), but grading keys are loaded in full. |
| `backfillVocabularyContentVersionMismatch` | Repairs a specified set's stale content/grading-version incident | Keep for recovery. Reads all attempts for the selected set; no bounded page contract. |
| `backfillAssignmentDueWeeks` | Repairs missing/non-normalized due weeks; troubleshooting still references it | Possible retirement only after complete zero-candidate / zero-missing-source audit and old writer retirement. Output is limited, but every call reads all assignments. |
| `backfillLearningReportModel` | Repairs profiles, class memberships and legacy class assignment scope | Possible retirement only after all profile/membership/scope pages and skipped cases are resolved. Student/assignment output pages do not bound its four collection scans. |
| `migrateStarRewards` | Creates missing Yellow credits and converted Blue history | Possible retirement only after a complete dry run has zero pending credits/converted Blue rows and no legacy producer remains. Scans all achievements plus per-Yellow ledger lookups. |
| Vocabulary/catalog JS fallbacks | `AGENTS.md` explicitly requires local-file loading compatibility | Keep unless the owner deliberately retires that supported use case. |

All five teacher actions were inspected for their default no-apply paths. This
table is source review, not a live migration invocation or proof of zero pending records.
Do not invoke a full-scan action merely because its response exposes a `limit`.
Any follow-up production audit should first confirm live/source parity and use
authorized, bounded, read-only queries with aggregate-only output; no student
answers, identifiers or grading keys should enter the cleanup report. Applying
a repair, changing permissions, or deleting historical data needs separate scope.

### Phase-three read-only production audit (2026-09-21, 17:25 Shanghai)

Two complete metadata passes, each paged at 100 rows with an explicit upper
bound, returned identical projected data across seven collections. This is a
stable observed interval, not a transactional snapshot. The comparison uses
current source rules; known live/source bundle differences remain unresolved.
No migration handler, write, account impersonation, answer or grading-key read
was performed. Only aggregate evidence is retained in the original checkout's
ignored `.local/cleanup-release-audit/retirement-metadata-audit.json`.

| Scope | Observed result | Cleanup decision |
| --- | --- | --- |
| Assignment due weeks | 798 assignments; 282 lack `due_at`. Of these, 279 have a usable fallback date and 3 lack a usable source. One additional existing due date is not normalized. | Keep due-date compatibility and `backfillAssignmentDueWeeks`; 280 proposed updates are not authorization to apply. |
| Due-week candidates by status | 42 `to_do`, 144 `passed`, 51 `mastered`, 1 `done`, 42 `cancelled` | Do not bulk-normalize completed/cancelled history as a code-cleanup side effect. Review open work separately. |
| Class/report metadata | 36 active students; zero proposed class creation, profile change, membership change or multiple-active-membership cases | No class repair is indicated by this comparison. |
| Assignment scope | 206 batches: 27 already scoped, zero promotable legacy batches; 147 partial/mixed-recipient and 32 existing non-legacy-scope batches are skipped | Skips are not automatically faults or missing migrations; do not promote partial or explicitly individual work. |
| STAR migration | 165 achievements / 83 ledger rows; zero missing Yellow credits, converted Blue rows, unclassified achievements or normalization candidates | No STAR apply is indicated. Keep the repair entry until live-code parity and operational retirement are established. |
| Old Listening assignments | Zero `assignment_kind: listening`, zero `IL-*` assignment rows, zero assignment-track rows | No row dependency found for this snapshot. Old-client calls and server-source drift still block API retirement; keep active `recordActivity`. |

Safe next steps, without expanding code cleanup into a data migration:

1. Keep all runtime compatibility identified above; there is no new backend
   deployment in phase three and no reason to redeploy the already-live phase two.
2. If due-week normalization is requested separately, first confirm the live
   helper's behavior, prepare a private per-record before/after proposal and
   backup, and review the 42 open candidates separately from 196 completed and
   42 cancelled records. Do not infer dates for the three source-less rows.
3. Apply only explicit owner-approved records with stale-value checks, then
   compare task grouping/overdue state and immutable history. Do not use an
   unscoped all-history backfill just to enable deleting a helper.
4. Only revisit removal of report/STAR migration APIs and empty Listening
   compatibility after live-source reconciliation and an old-client/call-log
   retirement window. The two grading repair tools remain operational tools.

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
