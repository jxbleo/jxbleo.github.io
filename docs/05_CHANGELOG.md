# Changelog

> Product-level and architecture-level changes only.
> Do not record every tiny CSS tweak or variable rename here.

## 2026-06-16

### Added

- Added the human-readable documentation system under `docs/`.
- Added product requirements, architecture, UI/UX, data model, decisions, testing checklist, backlog, deployment/content/troubleshooting entries.
- Added `docs/09_CONTENT_WORKFLOW.md` and `docs/10_DEPLOYMENT.md` as numbered documentation entry points.
- Added owner-gated release helper scripts for verification, function packaging, and deploy-plan generation.
- Added owner-run CloudBase CLI content import helper with dry-run and insert-missing apply mode.

### Changed

- Moved product requirements into `docs/01_PRODUCT_REQUIREMENTS.md`.
- Moved technical repeated-issues log into `docs/11_AGENT_TROUBLESHOOTING.md`.
- Kept root-level pointer files for stable links.
- Replaced the root README with a current project entry point and document map.
- Updated `AGENTS.md` reading order and documentation update rules.
- Documented that agents may prepare release artifacts but must not execute CloudBase deployment without exact owner authorization.

### Fixed

- Backend source now keeps assignment status monotonic across lower-scoring retries.
- Teacher assignment source now allows completed/STAR work to be reassigned.
- Argue regrading source now creates or repairs STAR records when mastery is reached.
- Student dashboard/submit cloud functions now reject teacher profiles.

### Documentation

- Documented the intended long-term docs workflow.
- Documented repeated technical failure modes for future Agent handoff.

## 2026-06-15

### Added

- Added personal My Words feature with a `studentVocabulary` cloud function and shared selection UI.
- Added dashboard My Words panel.

### Changed

- Confirmed student dashboard uses `TO DO` and `FINISHED`, while backend keeps `to_do`, `passed`, and `mastered`.

### Fixed

- Fixed IELTS Listening teacher preview audio startup.
- Fixed mobile student assignment capsule layout.
- Blocked personal vocabulary saves from answer/result/feedback regions.

## 2026-06-13

### Added

- Imported BBC June/July listening lessons.
- Created Agent QA memory file.

### Changed

- Strengthened BBC import workflow and CloudBase import notes.
- Clarified Vocabulary runtime and fallback behavior.

### Fixed

- Fixed BBC blank placeholder length issue.
- Documented CloudBase JSON Lines import requirement.

## 2026-06-12

### Added

- Added Teacher Argue grouped task view.
- Added backend STAR and assignment mastery model.
- Added teacher Library answer preview through `teacherAdmin`.

### Changed

- Assignment statuses moved toward `to_do`, `passed`, and `mastered`.
- Student dashboard STAR count became backend-backed.
- Assignment thresholds can be set by teacher.

### Fixed

- Separated teacher answer reveal from student answer reveal.
