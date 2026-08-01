# 08 Backlog

> Product, technical, and documentation backlog.
> Update it when new work is discovered or priorities change.

## High Priority

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

## Medium Priority

- Extract shared backend logic into `cloudfunctions/_shared/`.
- Clean old documentation references to `done/failed`, three-card dashboard, and STAR blocking reassignment.
- Improve teacher Progress filters by class, student, set, and curriculum track.
- Add browser smoke coverage for visitor mode, student login, and teacher preview.
- Add automated authenticated CloudBase integration coverage for My Words edit,
  merge/undo, AI draft races, teacher replacement history, and report resolution.
- Continue private-answer migration for legacy public runtime JSON.
- Add checksum/version comparison between cloud-function source and deployed ZIPs.

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
- Notifications or messaging.
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
