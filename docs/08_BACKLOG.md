# 08 Backlog

> Product, technical, and documentation backlog.
> Update it when new work is discovered or priorities change.

## High Priority

- Add teacher-managed accepted spelling variants and a bounded abandoned-replay
  cleanup policy after the first Intensive Listening classroom trial.

- Verify deployed P0 backend fixes in CloudBase development:
  - low-score retry does not downgrade passed assignment
  - completed/STAR work can be reassigned
  - Argue approval can create or repair STAR
- Investigate teacher Progress data freshness after recent student completion.
- Add lightweight smoke-test script for JSON parsing, catalog links, and key static pages.
- Add pure rule tests for assignment status monotonicity, STAR protection, Argue regrade, and Vocabulary countability.
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
- Extract shared backend logic into `cloudfunctions/_shared/`.
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
- AI Tutor: move rewrite checking onto the durable `writing_ai_jobs` execution model; OCR, standardized review,
  and language review already use the shared queue/lease worker.
