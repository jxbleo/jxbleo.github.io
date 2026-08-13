# 04 Data Model

> This document describes current backend and runtime data structures.
> Update it when fields, collections, statuses, ownership rules, or data flow changes.

## 1. Data Sources

The project uses several data layers:

- Public static content: `content/`, `data/`, audio/image assets
- Private generated import files: `.cloudbase-private/import/`
- CloudBase Authentication users
- CloudBase database collections
- Browser history/session/local storage and redacted IndexedDB snapshots for
  non-authoritative UI state

Only CloudBase cloud functions should read or write private collections.

## 2. Collection Overview

| Collection | Purpose |
| --- | --- |
| `students` | student and teacher profiles |
| `sets` | assignable/public learning resources |
| `assignments` | one assigned task instance |
| `attempts` | immutable countable submissions |
| `teacher_attempt_email_events` | private idempotent outbox and delivery audit for teacher attempt email |
| `grading_keys` | private answers and scoring rules |
| `system_config` | defaults such as passing/mastery |
| `student_set_achievements` | protected STAR records |
| `star_reward_ledger` | append-only Yellow STAR wallet entries |
| `star_redemption_requests` | Cash request workflow and audit snapshots |
| `star_redemption_evidence` | private Cash evidence metadata |
| `answer_disputes` | student/teacher Argue requests |
| `grading_key_history` | answer-rule change history |
| `student_vocabulary_items` | personal saved words |
| `vocabulary_lexicon` | shared curated/ECDICT/API dictionary entries |
| `vocabulary_lexicon_history` | private revision snapshots for shared dictionary entries |
| `vocabulary_dictionary_reports` | student reports requiring dictionary review |
| `vocabulary_test_sessions` | active/ended Vocabulary Test integrity sessions |
| `classes` | stable class entities used by class work and reports |
| `class_memberships` | current and historical student-class relationships |
| `learning_reports` | preview and published weekly/monthly report snapshots |

All collections should remain `ADMINONLY`.

## 3. `students`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `auth_uid` | string | CloudBase Auth user ID |
| `student_id` | string | human-facing Login ID for current profiles; internal `__deleted__:<profile-id>` archive key after deletion |
| `name` | string | compatibility whole display name derived from the separate name fields when they exist |
| `chinese_name` | string | teacher-confirmed Chinese name; may be empty for English-only students |
| `english_name` | string | teacher-confirmed English name; may be empty for Chinese-only students |
| `class_group` | string | class/group |
| `curriculum_track` | string | DSE, IELTS, etc. |
| `role` | string | `student` or `teacher` |
| `active` | boolean | account enabled in app |
| `must_change_password` | boolean | force password change |
| `delete_pending` | boolean | temporary marker while teacher deletion is in progress |
| `deleted` | boolean | true after teacher deletion completes |
| `deleted_at` | Date/null | teacher deletion time |
| `deleted_by_teacher_uid` | string/null | teacher who deleted the profile |
| `deleted_student_id_snapshot` | string | Login ID snapshot kept for audit/history |
| `deleted_name_snapshot` | string | display-name snapshot kept for audit/history |
| `deleted_student_id_released_at` | Date/null | time the deleted profile released its former Login ID for reuse |
| `teacher_activity_attempts_seen_at` | Date/null | legacy bell-open timestamp; no longer clears attempt-thread unread state |
| `teacher_activity_attempts_read_all_at` | Date/null | latest teacher `Read all` cutoff; attempts submitted at or before it are read |
| `teacher_activity_attempt_reviewed_ids` | array | attempt IDs opened from the teacher notification panel |
| `teacher_activity_attempt_reviewed_at` | Date/null | latest attempt-review marker update |
| `attempt_email_recipients` | array | teacher-only notification addresses; each item has `email_id`, normalized `email`, `enabled`, `created_at`, and `updated_at`; maximum 10 |
| `vocab_ai_day` | string | Shanghai `YYYY-MM-DD` for the student's current AI allowance |
| `vocab_ai_count` | number | successful student AI previews used on that Shanghai date |
| `created_at` | Date | created time |
| `updated_at` | Date | updated time |

Rules:

- `auth_uid` is the ownership key.
- `student_id` is unique among non-deleted profiles but is not used for
  authorization.
- Teacher actions require `role: "teacher"` and `active: true`.
- Only an authenticated active teacher may read or mutate their own
  `attempt_email_recipients` through `teacherAdmin`. New addresses are
  normalized, validated, deduplicated, and enabled by default. These addresses
  are returned only to that Teacher Personal Center and are never included in
  student/public responses.
- Student-facing functions should require `role: "student"`.
- Teacher deletion removes the CloudBase Auth end user, sets `active:false`
  plus deletion audit fields on the profile, archives `student_id` as
  `__deleted__:<profile-id>`, and hides the student from teacher student lists,
  Assign candidates, View progress, activity attempts, and Argue lists. The
  original Login ID remains in `deleted_student_id_snapshot` and can be used by
  a newly created account. Historical attempts, assignments, STAR records, and
  disputes are not hard-deleted or transferred to the new `auth_uid`.
- Teacher notification activity is grouped by student assignment thread, or by
  student and set for self-study. A thread is read when all its attempts were
  individually recorded in `teacher_activity_attempt_reviewed_ids`, or their
  submission times are at/before `teacher_activity_attempts_read_all_at`.
  Opening the bell alone changes neither marker. Opening one grouped row marks
  its current related attempts reviewed; `Read all` advances the cutoff and
  clears the now-redundant reviewed-ID list; any later attempt makes the thread
  unread again.
- Notification and Argue pagination adds no collection fields. The Teacher client
  requests ten notification summary threads per page and five Argue records per
  status page with opaque numeric cursors,
  keeps full notification detail only in current-tab memory. It first continues
  notification pagination automatically until the server-derived unread thread
  count is covered, then may fetch older ten-thread summary pages as the teacher
  scrolls the open bell list. Only unread threads are prefetched; older read-thread
  details remain on demand. Persistent Teacher IndexedDB records continue to omit
  attempts, submitted answers, correct answers, explanations, and grading keys.

For Learning Reports V1, `chinese_name` and `english_name` are the authoritative
editable name parts. `name` remains a compatibility whole display value and is
server-derived as direct `ChineseEnglish` concatenation when both parts exist, or as the one
available part otherwise. A legacy `name` may be used as the whole display
fallback but must not be heuristically split; the owner/teacher must explicitly
backfill separate fields before a bilingual display is required. Teacher lists,
search, assignment selection, and student detail use one shared display rule.
Later profile corrections may refresh a preview but must not silently rewrite a
published report.

## 3a. `classes`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `class_id` | string | stable class identifier |
| `name` | string | teacher-facing/display class name |
| `normalized_name` | string | normalized name used to avoid accidental duplicate active classes |
| `active` | boolean | available for new assignments/memberships |
| `created_at` | Date | creation audit time |
| `updated_at` | Date | latest change time |
| `archived_at` | Date/null | archive time, if retired |

Rules:

- All report and class-scoped assignment relations use `class_id`, never a
  browser-supplied display string.
- Archiving preserves membership history and published reports.
- The legacy `students.class_group` remains a compatibility display mirror only
  during migration; it is not an authorization, report-scope, or history field.

## 3b. `class_memberships`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `membership_id` | string | stable membership identifier |
| `class_id` | string | related class |
| `student_uid` | string | owning student `auth_uid` |
| `active` | boolean | whether this is the student's current membership |
| `started_at` | Date | effective start time |
| `ended_at` | Date/null | effective end time |
| `student_id_snapshot` | string | Login ID snapshot for audit/display |
| `student_name_snapshot` | string | full display-name snapshot |
| `chinese_name_snapshot` | string/null | stable Chinese-name report display value |
| `english_name_snapshot` | string/null | stable English-name report display value |
| `ended_by_teacher_uid` | string/null | teacher who ended/changed membership |
| `created_at` / `updated_at` | Date | audit timestamps |

Rules:

- There may be at most one active membership for a `student_uid`. The trusted
  teacher action must close the previous row and open the next row safely; the
  browser cannot choose membership scope or effective dates.
- Closed rows are history and are never hard-deleted merely because a student
  transfers classes.
- A report's rank eligibility is calculated from membership coverage of the
  entire Shanghai period. A partial period (new admission, transfer, withdrawal)
  leaves a student out of the public ranking but retains that student's personal
  report detail with a machine-readable reason.
- Cutover migration creates one current membership from a nonempty legacy
  `class_group`; it must not invent prior membership intervals or backfill
  reports before cutover.

## 4. `sets`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `set_id` | string | stable exercise ID |
| `section_id` | string | content section |
| `title` | string | display title |
| `type` | string | broad type |
| `course` | string | course/category |
| `link` | string | page URL |
| `difficulty` | string | optional level |
| `estimated_minutes` | number/null | time estimate |
| `passing_percentage` | number/null | override passing threshold |
| `mastery_percentage` | number/null | override mastery threshold |
| `feedback_policy` | string/null | feedback behavior |
| `renderTheme` | string/null | optional front-end render theme for supported runtimes |
| `visible` | boolean | visible in Library/Explore |

Rules:

- `sets` controls authenticated Explore/Library visibility.
- Static catalog visibility and CloudBase visibility can drift; check both.
- When a set does not store an explicit threshold, the server family fallback
  is Vocabulary `90` passing / `100` mastery, BBC `80` / `95`, and general
  content `50` / `90`.
- Existing assignments keep their stored threshold snapshot even if a later
  family default changes.

## 5. `assignments`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `assignment_id` | string | unique assignment instance |
| `assignment_batch_id` | string/null | shared batch key for assignments created by the same teacher Assign action for the same set |
| `assignment_scope` | string | server-derived `class` or `individual`; report ranking trusts only `class` |
| `class_id` | string/null | stable related class for a class-scoped assignment |
| `class_task_id` | string/null | server-derived common task identity across the class-scoped assignment instances |
| `student_uid` | string | owner `students.auth_uid` |
| `set_id` | string | assigned set |
| `status` | string | `to_do`, `passed`, `mastered`, `cancelled` |
| `due_at` | Date | required due week stored as that Shanghai-time week's Sunday 23:59:59; canonical source for student reminders and Teacher View Wxx grouping |
| `assigned_at` | Date/null | deprecated compatibility mirror of `due_at`; legacy reads may use it only to derive a missing due week |
| `created_at` | Date | actual assignment creation audit time; not a schedule field |
| `passing_percentage` | number | assignment passing threshold |
| `mastery_percentage` | number | assignment mastery threshold |
| `mastery_enabled` | boolean | whether this assignment can become mastered / earn STAR; new Assign-created records default to false unless the teacher selects `Earn STAR` |
| `standards_updated_at` | Date/null | last teacher standards edit time |
| `standards_updated_by_teacher_uid` | string/null | teacher who last edited due/threshold standards |
| `schedule_updated_at` | Date/null | last Teacher View assigned-week correction time |
| `schedule_updated_by_teacher_uid` | string/null | teacher who last corrected `due_at` |
| `due_week_migrated_at` | Date/null | historical due-week normalization time |
| `due_week_migrated_by_teacher_uid` | string/null | authenticated teacher who applied the historical due-week backfill |
| `latest_attempt_id` | string/null | latest submission |
| `attempt_count` | number | countable attempts |
| `latest_percentage` | number/null | latest display percentage |
| `best_percentage` | number/null | best display percentage |
| `raw_best_percentage` | number/null | best raw percentage |
| `best_attempt_id` | string/null | best attempt |
| `best_improved_at` | Date/null | time the set-wide effective best score last increased strictly |
| `progress_updated_at` | Date/null | compatibility ordering timestamp; changes only with a strict best-score improvement |
| `answer_revealed` | boolean | answers shown |
| `mastery_locked` | boolean | mastery blocked after reveal |
| `completed_at` | Date/null | first passed time |
| `mastered_at` | Date/null | first mastered time |
| `cancelled_at` | Date/null | teacher cancellation time |
| `cancelled_by_teacher_uid` | string/null | teacher who cancelled the assignment |
| `cancel_reason` | string | optional cancellation note |
| `previous_status` | string/null | status before cancellation |
| `converted_from_self_study` | boolean | assignment was initialized from prior Explore/Library completion |
| `converted_self_study_attempt_id` | string/null | self-study attempt used for initial assignment summary |
| `converted_self_study_achievement_id` | string/null | self-study STAR converted to assignment STAR, when applicable |
| `completed_before_assignment` | boolean | assignment was already passed from prior set-wide Exercise Progress when created/integrated |
| `promoted_from_individual` | boolean | open individual assignment was reused by a later complete Class Assign |
| `promoted_to_class_batch_at` | Date/null | time the individual participation entered the class batch |
| `previous_individual_assignment_snapshot` | object/null | audit snapshot of the prior individual schedule/standards before class integration |

Status rule:

```text
to_do -> passed -> mastered
```

Status is monotonic. Later lower-scoring attempts update latest fields but do not downgrade assignment completion.
Assignment summary fields such as `attempt_count`, `latest_attempt_id`,
`latest_percentage`, `best_attempt_id`, and `best_percentage` project the
student's authoritative Exercise Progress for the same `student_uid + set_id`
from all countable immutable attempts, regardless of `assignment_id`.
`assignment_id` remains the attempt's historical submission context. Timed
Vocabulary Practice is excluded. BBC attempts after the earliest answer reveal
or mastery lock remain history but cannot improve effective Best. The first
attempt establishing a score wins ties, so `best_improved_at` changes only on a
strict increase and drives FINISHED recency.
Class learning-report snapshots apply the same set-wide pool at the report
cutoff; a qualifying attempt does not need to be bound to that Class Task's
assignment row.

Teachers must choose a due week during Assign. `teacherAdmin` normalizes it to
that Shanghai-time week's Sunday 23:59:59 and stores it in `due_at`, which
drives student Overdue / This Week / Upcoming behavior and Teacher View Wxx
matrix grouping/date filters. `created_at` remains the creation audit timestamp.
For rolling deployment compatibility, new and updated records may mirror the
same normalized value into deprecated `assigned_at`; new business logic must
not treat it as a second schedule. Assign accepts per-task row parameters, so
different selected `set_id` values in one teacher operation may use different
`due_at`, `passing_percentage`, `mastery_percentage`, and `mastery_enabled`
values. Teachers may edit an existing assignment's `due_at`,
`passing_percentage`, `mastery_percentage`, and `mastery_enabled` from the View
surface. Changing `due_at` moves that assignment to the chosen Wxx matrix
group/date filter but does not change `created_at` or attempt timestamps. New
Assign-created records default to `mastery_enabled: false`; `mastery_percentage`
is required during Assign only when the teacher selects `Earn STAR` for that
task row. Those edits affect future submissions and display standards, but do
not automatically regrade historical attempts or downgrade completed
assignments and protected STAR records. When `mastery_enabled` is false, future
submissions can pass but cannot automatically move that assignment to
`mastered` or create a new STAR. In that disabled state, `mastery_percentage`
is inactive: it is not required by the View editor and does not constrain a
new `passing_percentage`. Re-enabling Earn STAR requires an explicit usable
mastery percentage at or above Passing %.
The matrix task-header bulk editor does not introduce a shared mutable class
standard record. It resolves the visible column to explicit `assignment_id`
values and updates those assignment documents individually, preserving the
assignment-level ownership and audit model.

Learning Reports V1 adds a derived class-task marker without replacing the
per-student assignment model. During assignment creation/update, the trusted
server determines whether the effective recipient set exactly covers the
class's active membership set. Only then may it store
`assignment_scope: "class"` with `class_id` and a common `class_task_id`.
Any individual selection, partial class selection, or ambiguous legacy record
uses `assignment_scope: "individual"` and is excluded from formal class-report
ranking. Browser data must never set these fields or turn an individual task
into class work.

During migration, `getDashboard` and `teacherAdmin` derive an effective
Sunday-end `due_at` from legacy `assigned_at`, then `created_at`, when the
canonical field is missing. The authenticated teacher-only
`backfillAssignmentDueWeeks` action is dry-run by default and can persist those
normalized weeks in bounded batches. Records with none of those date sources
are reported and never silently assigned an invented week.

Teachers may cancel any selected non-cancelled assignment by `assignment_id`,
including `passed`, `mastered`, and legacy `done` records. Cancellation is a
soft state change to `status: "cancelled"`, never a delete. Cancelled assignments
are hidden from the student dashboard and teacher View progress and rejected by
`submitAttempt`, but old attempts remain immutable history and still contribute
to the authoritative set-wide Exercise Progress. Completion facts and protected
STAR records are not revoked. Reassignment creates a new row initialized from
that historical global best, so it may be immediately complete under the new
assignment's standards.

Reassignment rule:

- Open assignment (`to_do`, legacy `not_done`, legacy `failed`) blocks an
  ordinary duplicate assignment. Exception: a later server-verified complete
  Class Assign reuses an open individual row, replaces its assignment parameters
  with the class parameters, and promotes the common batch transactionally.
- Completed history (`passed`, `mastered`, legacy `done`) does not block future reassignment.
- Cancelled history (`cancelled`) does not block future reassignment.
- Reassignment creates a new `assignment_id`.
- New assignments also receive an `assignment_batch_id` shared by the records
  created for the same set in one teacher Assign action. Teacher View may use
  this together with the current `due_at` week to render repeated
  assignments of the same set as separate matrix columns without splitting one
  class assignment into per-student columns. If a teacher later moves only part
  of a batch to a different week, that week becomes a separate matrix column.
- If the student already has a completed self-study attempt for the same
  `set_id`, the new assignment is initialized from that best self-study attempt:
  `passed` when it meets the assignment passing percentage, `mastered` when it
  meets mastery and `mastery_enabled` is not false. Only mastered conversions
  create or convert an assignment STAR.
- More generally, any prior countable attempt for that `student_uid + set_id`
  initializes the new participation's global best. If it meets the selected
  Passing %, `completed_before_assignment: true` and Finished are immediate.

## 5a. `learning_reports`

One logical report exists per `class_id + period_type + period_key`. It begins
as a mutable teacher-only preview and ends as an immutable published snapshot.

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `report_id` | string | stable report identifier used by `reports.html?report=` |
| `status` | string | `preview` or `published` |
| `class_id` / `class_name` | string | snapshotted report class identity/display name |
| `period_type` | string | `weekly` or `monthly` |
| `period_key` | string | stable Shanghai-period key; display labels are not the authority |
| `period_start` / `period_end` | Date | inclusive natural Shanghai period boundaries |
| `snapshot_cutoff_at` | Date | preview generation cutoff or final period cutoff for a published report |
| `membership_snapshot` | array | report-time member UID, membership identity, dates, and rank eligibility; fixed display names live in the two projections below |
| `leaderboard` | array | rank-safe class comparison projection |
| `student_details` | array/object | one per-student detailed snapshot, including teacher comment/goals |
| `report_url` | string | canonical `reports.html?report=<encoded-id>` relative URL |
| `snapshot_version` | number | format/version marker for the materialized report snapshot |
| `generated_at` | Date | latest preview/final materialization time |
| `published_at` | Date/null | final publication time |
| `created_at` / `updated_at` | Date | audit timestamps |

`leaderboard` entries expose only safe common fields: frozen Chinese/English
display fields when supplied (otherwise the frozen whole display fallback),
rank/rank eligibility, due-period class-task denominator,
report-cutoff completed count, integer completion delta, and separate self-study
count. `student_details` additionally holds this student's per-family details,
non-ranking reason, teacher comment, and at most three next goals. Family keys
must remain distinct (`bbc`, `vocabulary`,
`ielts-reading`, `ielts-listening`, and future named families); the report
cannot manufacture one cross-family average score.

Snapshot rules:

- A preview may be regenerated idempotently, but saved teacher comments/goals
  must survive the refresh by their authorized student identity.
- Publishing derives final data at `snapshot_cutoff_at`, preserves comments,
  and never silently rewrites the resulting report. Preview refresh, comment
  save, and publish use transactional status checks so a concurrent writer
  cannot regress `published` to `preview`. A later grading correction requires
  an explicit audited correction/republication path.
- Formal rank counts unique `class_task_id` values whose `due_at` belongs to
  the period and whose first passing completion is on/before that report's
  snapshot cutoff. A monthly report can therefore count a task completed later
  in the same month even when its already-published due-week report stays missed.
  Cancelled assignments do not contribute to the denominator. Equal counts
  receive the same rank; no score, time, or average-score tiebreaker exists.
- Countable self-study is a separate distinct-`set_id` measure based on
  `assignment_id: null` attempts that first pass in the period. Report-excluded
  Vocabulary modes remain excluded; it never changes class rank.
- This collection stays `ADMINONLY`. Cloud functions return role-redacted
  projections rather than a raw report document.

## 6. `attempts`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `attempt_id` | string | unique attempt |
| `student_uid` | string | owner |
| `student_id_snapshot` | string | display snapshot |
| `set_id` | string | set |
| `assignment_id` | string/null | assignment or self-study |
| `mode` | string | runtime mode |
| `practice_mode` | string/null | `test` for recorded IELTS Listening Test attempts; old `ielts_listening` attempts are treated as Test compatibility records |
| `answers` | object | submitted answers |
| `question_results` | array | per-question result |
| `correct_count` | number | correct count |
| `question_count` | number | question count |
| `raw_percentage` | number | raw score |
| `percentage` | number | display score |
| `display_percentage` | number | display score |
| `passed` | boolean | this attempt passed |
| `mastered` | boolean | this attempt mastered |
| `grading_version` | string | grading key version |
| `adjusted_question_results` | array | upward-only regraded per-question result |
| `adjusted_percentage` | number | upward-only regraded score |
| `adjusted_by_grading_history_id` | string/null | grading rule change that caused the adjustment |
| `bulk_regrade_source` | string/null | student/teacher Argue source for historical adjustment |
| `submitted_at` | Date | submit time |
| `duration_seconds` | number/null | existing page/test-start-to-submit duration |
| `audio_started_at` | Date/null | first successful audio play time for audio-based practice |
| `audio_to_submit_seconds` | number/null | first-audio-play-to-submit duration for audio-based practice |
| `practice_context` | string | `assignment`, `resource`, or `practice` |
| `selected_group_count` | number/null | Vocabulary group count for recorded Quiz/timed Practice |
| `selected_group_ids` | array | ordered Vocabulary group IDs selected for recorded Quiz/timed Practice |
| `group_results` | array | per-group score summaries for recorded Quiz/timed Practice |

Rules:

- Attempts are append-only.
- IELTS Listening Practice self-checks use `mode: "ielts_listening_practice"`
  only for the grading request and never create an attempt. Recorded Test
  submissions use `mode: "ielts_listening_test"` and `practice_mode: "test"`.
- Try Again creates a new attempt.
- Failed attempts are still stored.
- Self-study attempts use `assignment_id: null` only when the student has no open assignment for the same `set_id`.
- If a student submits a Library/Explore entry that matches an open assignment, `submitAttempt` stores the attempt with that `assignment_id`.
- `getDashboard` derives one self-study completion projection per distinct
  visible `set_id` once a countable `assignment_id: null` attempt reaches the
  set passing standard. It uses the first passing submission as `completed_at`,
  the best attempt for score/review, and the latest attempt for recent activity.
  A completed assignment projection for the same set suppresses the duplicate
  self-study row; an open assignment with a higher teacher threshold does not
  erase the already-earned self-study completion.
- Vocabulary timed Practice writes a notification-only activity attempt using
  `mode: "vocabulary_practice_timed"` and `practice_context: "practice"`, at
  any selected-group count. It is forced to `assignment_id: null` and excluded
  from assignment summaries, FINISHED, the student calendar, learning reports,
  STAR, student progress, and future assignment initialization. Learn inline
  practice writes no attempt.
- The teacher-only attempt view returns `selected_group_ids` and redacted
  per-group summaries for recorded Vocabulary Quiz/timed Practice reports. It
  also resolves per-question explanations from the current private grading key
  so BBC mistake reports can display explanations without exposing them in
  public runtime data.
- Teacher bootstrap list responses contain attempt summaries only and do not
  embed `question_results`, `group_results`, correct answers, or explanations.
  The full teacher-only attempt view is returned by an explicit single-attempt
  detail action after teacher authorization. Opening one notification thread
  may call that action once for each attempt in the thread so answer comparison
  cards start expanded, without changing the summary/bootstrap payload.
- Student historical review may return correct answers and explanations for
  attempts that are already passed/mastered, or when the linked assignment has
  `answer_revealed: true`. Attempts below the passing threshold still return
  only submitted answers and correctness. Loading an eligible historical review
  does not itself set `answer_revealed`.
- Argue `add`/`replace` may add upward-only adjusted fields to old attempts;
  original submitted answers and raw attempt history remain preserved. Linked
  assignment status updates still respect the assignment's passing percentage,
  mastery percentage, and `mastery_locked` state.
- The manual `backfillAcceptedAnswerRegrades` action may add the same adjusted
  fields with `bulk_regrade_source: "grading_key_backfill"`.

## 6a. `teacher_attempt_email_events`

Purpose: private outbox and bounded delivery audit for ordinary-email copies of
Teacher attempt notifications. One recorded eligible `attempt_id` owns one
event document and repeated queue writes overwrite that same pending identity
rather than creating duplicates.

| Field | Type | Meaning |
| --- | --- | --- |
| `event_id` | string | idempotent event identity; equal to `attempt_id` |
| `attempt_id` | string | immutable source attempt |
| `thread_key` | string | same assignment/self-study grouping used by the Teacher bell |
| `student_uid` | string | source student owner |
| `set_id` | string | source set |
| `assignment_id` | string/null | assignment thread or self-study |
| `mode` | string | `bbc`, `vocabulary_test`, or `vocabulary_practice_timed` |
| `delivery_policy` | string | `bbc_batch_7m` or `vocabulary_immediate` |
| `status` | string | `pending`, `processing`, `sent`, `failed`, or `skipped` |
| `retry_count` | number | bounded SMTP retry count |
| `submitted_at` | Date | source attempt time |
| `window_started_at` | Date | fixed batch anchor for this event |
| `window_ends_at` | Date | seven-minute BBC end or immediate Vocabulary time |
| `due_at` | Date | next eligible dispatch time, advanced only for retry backoff |
| `processing_token` | string/null | transactional claim token |
| `processing_started_at` | Date/null | claim audit time |
| `sent_at` | Date/null | successful SMTP handoff time |
| `provider_message_id` | string | SMTP message identifier returned for the successful handoff; earlier sent events supply threading references |
| `last_error` | string | bounded non-secret provider error code/message |
| `last_failed_at` | Date/null | most recent failed delivery |
| `skipped_at` | Date/null | due time at which no enabled teacher address existed |
| `skip_reason` | string | bounded reason such as `NO_ENABLED_TEACHER_EMAIL` |
| `created_at` / `updated_at` | Date | outbox audit timestamps |

Rules:

- The collection remains `ADMINONLY`; no browser reads or writes it.
- `event_id` is unique. `submitAttempt` writes the event only after the attempt
  exists, and an outbox failure never changes the successful grading response.
- BBC delivery claims all pending events in the same thread whose timestamps
  fall inside the first event's fixed seven-minute window. Vocabulary claims
  one due event at a time.
- Email rendering reads immutable attempts through the event cutoff. Therefore
  every Vocabulary email is cumulative without accidentally showing a later
  attempt that had not happened at that event's timestamp.
- A transaction moves claimed rows from `pending` to `processing` before SMTP.
  Success moves them to `sent`; failure returns them to `pending` with
  exponential backoff, up to five tries, then `failed`. A claim still in
  `processing` after ten minutes is returned to `pending` so a crashed function
  invocation cannot strand the event.
- Each SMTP handoff derives a fresh `Message-ID`, including bounded retries or
  an explicit resend. QQ Mail may silently discard a second accepted handoff
  with an already-seen ID. Business idempotency instead comes from the unique
  outbox `event_id` and transactional claim. `In-Reply-To` / `References` use a
  prior sent event's `provider_message_id` to retain task threading. SMTP still
  cannot guarantee strict exactly-once delivery if the provider accepts a
  message and the following database update fails; in that rare case a retry
  may produce a visible duplicate rather than an invisible lost notification.
- The outbox never stores SMTP passwords, timer tokens, recipient addresses, or
  rendered email bodies. Those settings remain function environment values.
- The current allowlist is for teacher-owned inboxes only and uses BCC. Future
  guardian delivery requires an authorized student-to-guardian mapping and
  per-student routing, not a shared global recipient list.
- Delivery resolves enabled recipients from active teacher profiles at send
  time. When none exist, the claimed event becomes `skipped`; re-enabling an
  address affects future events and does not send the skipped history.
- Sent email does not update any Teacher bell read marker.

## 7. `grading_keys`

Private grading fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `set_id` | string | set ID |
| `grading_version` | string | version |
| `answers` | object | correct answers / accepted variants |
| `explanations` | object | explanations/evidence |
| `scoring_rules` | object | grading type and options |
| `updated_at` | Date | update time |

Rules:

- Not public.
- Teacher-approved Argue changes are authoritative.
- Bulk imports must not blindly overwrite higher-version CloudBase records.

## 8. `student_set_achievements`

STAR fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `achievement_id` | string | unique ID |
| `student_uid` | string | owner |
| `student_id_snapshot` | string | display snapshot |
| `set_id` | string | set |
| `assignment_id` | string/null | qualifying assignment or null for Blue STAR |
| `star_type` | string | `yellow` or `blue`; legacy rows infer from assignment_id |
| `status` | string | Yellow `star`; Blue `active` or `converted` |
| `protected` | boolean | true only for Yellow STAR |
| `reward_eligible` | boolean | true only for Yellow STAR |
| `source` | string | `assignment_claim`, `self_study`, legacy `assignment` / `explore`; legacy `assignment` is protected Yellow even when `assignment_id` is absent |
| `first_earned_at` | Date | first qualifying time |
| `first_qualifying_attempt_id` | string | first qualifying attempt |
| `best_attempt_id` | string | best attempt |
| `best_percentage` | number | best percent |
| `passing_percentage_snapshot` | number/null | threshold when the achievement was earned |
| `mastery_percentage_snapshot` | number/null | default Blue threshold or assigned STAR Rate |
| `converted_to_achievement_id` | string/null | Yellow STAR created from this Blue STAR |
| `converted_from_achievement_id` | string/null | Blue STAR that led to this Yellow STAR |
| `converted_at` | Date/null | conversion time |

Rules:

- STAR is backend-owned and never derived from browser storage.
- New Yellow STARs are protected, reward eligible, and unique by
  `student_uid + set_id`. Historical assignment-keyed duplicates remain valid.
- Blue STARs are stable but not reward eligible. Active Blue STARs are unique by
  `student_uid + set_id`; conversion retains the Blue row as `converted` and
  links it to the Yellow row.
- Existing Yellow STAR blocks new Blue creation for the same student and set.
- Blue-to-Yellow comparison runs only when the assignment has
  `mastery_enabled: true`; the verified historical percentage is compared with
  that assignment's mastery snapshot, never merely with the Blue status.
- `getDashboard.star_achievements` is a redacted, newest-first unified view with
  type, conversion state, set metadata, score, threshold snapshots, and linked
  historical attempt.
- Reward redemption never updates or deletes this collection.

## 8a. `star_reward_ledger`

| Field | Type | Meaning |
| --- | --- | --- |
| `ledger_id` | string | idempotent unique event ID |
| `student_uid` | string | wallet owner |
| `request_id` | string/null | related Cash Request |
| `achievement_ids` | string[] | exact Yellow STAR credits affected |
| `entry_type` | string | `credit`, `reserve`, `release`, `redeem`, `refund` |
| `available_delta` | number | signed available-balance change |
| `reserved_delta` | number | signed reserved-balance change |
| `spent_delta` | number | signed spent-total change |
| `actor_uid` | string | authenticated student/teacher or `system` |
| `reason` | string | bounded audit reason |
| `created_at` | Date | immutable event time |

Rules:

- Rows are append-only. Never update or delete them in normal code.
- One Yellow achievement has one idempotent `credit::<achievement_id>` entry.
- Balance is the sum of deltas, never a number accepted from the browser.
- Reserve/release/redeem/refund actions run transactionally with request state.

## 8b. `star_redemption_requests`

| Field | Type | Meaning |
| --- | --- | --- |
| `request_id` | string | unique Cash Request ID |
| `student_uid` | string | owner |
| `student_id_snapshot` | string | audit Login ID |
| `student_name_snapshot` | string | audit display name |
| `reward_type` | string | V1 always `cash` |
| `star_count` | number | whole Yellow STAR count |
| `achievement_ids` | string[] | reserved Yellow STAR credits |
| `status` | string | `awaiting_proof`, `awaiting_teacher`, `completed`, `rejected`, `cancelled`, `expired`, `refunded` |
| `evidence_count` | number | completed, non-superseded photos |
| `expires_at` | Date | seven days after creation |
| `student_seen` | boolean | current result read state |
| `student_seen_at` | Date/null | result read time |
| `decision_reason` | string | required rejection/refund reason |
| `created_at` / `updated_at` | Date | audit times |
| `completed_at` / `rejected_at` / `cancelled_at` / `expired_at` / `refunded_at` | Date/null | terminal state times |
| `processed_by_teacher_uid` | string/null | confirming/rejecting/refunding teacher |

Rules:

- A student may have at most one `awaiting_proof` or `awaiting_teacher` request.
- Cash amount and exchange rate are absent by design.
- Completion requires at least one completed active Evidence Photo.
- Terminal state changes are represented in both the request audit fields and
  append-only ledger; an old terminal record is never reused.

## 8c. `star_redemption_evidence`

| Field | Type | Meaning |
| --- | --- | --- |
| `evidence_id` | string | unique ID |
| `request_id` | string | owning Cash Request |
| `student_uid` | string | request owner |
| `uploader_uid` | string | authenticated uploader |
| `uploader_role` | string | `student` or `teacher` |
| `status` | string | `uploading`, `active`, `superseded`, `failed` |
| `original_file_id` | string | private CloudBase Storage file ID |
| `display_file_id` | string | compressed display copy file ID |
| `original_name` | string | sanitized client file-name snapshot |
| `mime_type` | string | verified image MIME |
| `size_bytes` | number | verified original size, max 10 MB |
| `upload_expires_at` | Date | short-lived upload slot expiry |
| `created_at` / `uploaded_at` / `superseded_at` | Date/null | audit times |

Rules:

- Each request has at most three active/completed Evidence Photos.
- Upload paths are generated by the backend and scoped to request/evidence IDs.
- Database rows store file IDs only; authorized reads return short-lived URLs.
- Evidence is permanent after successful registration. A wrong image is marked
  superseded and a new row is appended; it is not overwritten.

## 9. `answer_disputes`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `dispute_id` | string | unique ID |
| `requester_role` | string | `student` or `teacher` |
| `student_uid` | string | requester/owner UID |
| `set_id` | string | set |
| `attempt_id` | string/null | linked attempt |
| `assignment_id` | string/null | linked assignment |
| `question_id` | string | disputed question |
| `question_text_snapshot` | string | durable question text |
| `submitted_answer` | any | submitted answer |
| `answer_snapshot` | any | answer at time |
| `explanation_snapshot` | string | explanation at time |
| `student_reason` | string | note |
| `status` | string | `pending`, `approved`, `rejected` |
| `decision` | string/null | `keep`, `add`, `replace` |
| `teacher_note` | string | teacher reply |
| `student_seen` | boolean | whether the student has opened this resolved reply |
| `student_seen_at` | Date/null | when the resolved reply was marked seen |
| `created_at` / `updated_at` / `resolved_at` | Date/null | request, latest-update, and resolution audit times; Teacher Replies displays `created_at` as the student's Argue submission time |
| `auto_regrade_scanned_attempt_count` | number | attempts scanned after `add`/`replace` |
| `auto_regrade_adjusted_attempt_count` | number | attempts improved after `add`/`replace` |

Rules:

- One student dispute per `attempt_id + question_id`.
- Only wrong recorded questions can be disputed by students.
- Teacher-originated disputes may have no `attempt_id`.
- A teacher quick acceptance from a Notification paper report creates an
  immediately approved teacher-originated dispute linked to the attempt, with
  `source: teacher_attempt_review_quick_accept`; this preserves one durable
  audit path for grading-rule changes. Its requester ownership remains the
  teacher, while `affected_student_uid` and display snapshots identify the
  reviewed learner; it does not create a student Teacher Replies inbox item.
- Resolved student-originated disputes remain in the student's permanent
  Teacher Replies history after `student_seen` becomes true; that flag controls
  only the standalone reply button's unread badge.
- Teacher dispute lists hide student disputes linked to assignments whose
  current status is `cancelled`.
- `add` and `replace` update future grading and also trigger automatic upward
  regrading for historical attempts with the same set/question/submitted answer.
- Historical regrading may improve attempts, assignment summaries, and STAR
  records, but must not lower scores or revoke protected records.
- Previous grading changes can be repaired with the paginated teacher-only
  `backfillAcceptedAnswerRegrades` action.

## 10. `vocabulary_test_sessions`

Purpose: server-side integrity session for countable Vocabulary Quiz mode
only. A session is created before a Vocabulary Quiz begins, receives
heartbeats while the page remains active, and is closed when the test submits,
is abandoned, expires, or is replaced by another same-page test.

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `test_session_id` | string | stable session ID |
| `student_uid` | string | owner auth UID |
| `student_id_snapshot` | string | display snapshot |
| `set_id` | string | Vocabulary set |
| `assignment_id` | string/null | linked assignment if any |
| `assignment_doc_id` | string/null | exact locked assignment document used to prevent submit-time rebinding |
| `status` | string | `active`, `submitted`, `abandoned`, or `invalidated` |
| `selected_group_count` | number | official group count |
| `selected_group_ids` | array | official selected groups |
| `question_ids` | array | official submitted/graded question set |
| `grading_version` | string | public content/private grading version locked at test start |
| `grading_answers_snapshot` | object | private answer snapshot for the session question IDs |
| `grading_explanations_snapshot` | object | private explanation snapshot for the session question IDs |
| `client_device_id` | string/null | browser/device identifier for diagnostics |
| `client_instance_id` | string | per-page-load in-memory identifier used for ownership checks |
| `started_at` | Date | server start time |
| `due_at` | Date | timer deadline |
| `expires_at` | Date | deadline plus submit grace |
| `last_heartbeat_at` | Date | latest active-page heartbeat |
| `heartbeat_timeout_seconds` | number | timeout threshold |
| `integrity_flags` | array | reasons such as `page_hidden` or `heartbeat_timeout` |
| `attempt_id` | string/null | recorded attempt after submit |
| `created_at` / `updated_at` | Date | audit timestamps |

Rules:

- Only Vocabulary Quiz mode creates a session; Practice never does. The current
  Quiz selector starts at five groups.
- Vocabulary Quiz `due_at` is based on 90 seconds, or 1.5 minutes, per selected
  group.
- `submitAttempt` grades countable Vocabulary Quizzes from the session's
  `question_ids` and private grading snapshots, not from a browser-provided
  question list or a grading key that changed after the test started.
- The browser must send the public unit `contentVersion` when starting,
  resuming, heartbeating, and submitting. A missing or mismatched version is
  rejected with `VOCABULARY_CONTENT_OUTDATED` before grading.
- Missing submitted answers for session questions count as blank answers.
- `assignment_id: null` is an intentional self-study lock, not a request to
  auto-bind an assignment at submit time. A counted Quiz submit loads the exact
  `assignment_doc_id`, then verifies the stable assignment ID, student owner,
  set, and non-cancelled state. A missing, replaced, or cancelled locked
  assignment closes the session and does not create an attempt.
- A different `client_instance_id` is blocked from student cloud-function
  surfaces while a session is active. The browser must generate this ID in
  memory for each page load rather than storing it in `sessionStorage`, because
  cloned tabs can inherit session storage.
- `heartbeat_timeout_seconds` is 60. The browser normally heartbeats every 10
  seconds and retries transient network failures within that window; one failed
  network request does not itself close or abandon the session.
- Leaving the page, switching apps/tabs, heartbeat timeout, or timer expiry
  closes the session as `abandoned` and does not create an attempt or change
  assignment status.
- Abandoned/invalidated sessions are audit records only; they are not teacher
  progress records in the first implementation.

## 11. `vocabulary_lexicon`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `lexicon_id` | string | deterministic hash ID |
| `normalized_word` | string | unique lookup key |
| `word` | string | display headword |
| `phonetic` | string | phonetic spelling when available |
| `part_of_speech` | string | one or more lexical categories |
| `english_definition` | string | compact primary English definition |
| `chinese_meaning` | string | Chinese meaning when available |
| `word_forms` | string | inflections/derived forms when available |
| `senses` | array | bounded external dictionary senses |
| `source_type` | string | `curated`, `ecdict`, or external provider |
| `source_name` / `sources` | string/array | attribution |
| `verified` | boolean | teacher-curated status |
| `review_status` | string | `external`, `ai_draft`, or `reviewed` |
| `created_by_student_uid` | string/null | first student who confirmed an AI draft |
| `reviewed_by_teacher_uid` | string/null | teacher who published the current reviewed version |
| `updated_at` | Date | current shared-version update time |

Rules:

- Collection remains `ADMINONLY`; only trusted functions and owner imports write.
- `normalized_word` and `lexicon_id` are unique.
- Project-curated entries take precedence over ECDICT and external API data.
- External misses and failures are throttled on the student item rather than
  creating repeated provider requests.
- One `normalized_word` has one current visible shared record. A confirmed AI
  draft uses `source_type: "ai_draft"`, `review_status: "ai_draft"`, and
  `verified: false`; teacher publication overwrites that record with
  `review_status: "reviewed"` and `verified: true`.

## 12. `student_vocabulary_items`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `vocab_id` | string | deterministic ID |
| `student_uid` | string | owner |
| `text` | string | saved word/phrase |
| `normalized_text` | string | normalized uniqueness key |
| `status` | string | `active` or `archived` |
| `source_set_id` | string/null | source set |
| `source_title` | string | source title |
| `source_path` | string | source URL/path |
| `context` | string | short surrounding text |
| `times_added` | number | repeat saves |
| `personal_note` | string | student-only free note, maximum 500 characters |
| `saved_examples` | array | bounded source/context snapshots preserving the original form |
| `activity_updated_at` | Date | last student save/resave/edit/note/merge activity used by export filters |
| `lookup_status` | string | `pending`, `ready`, or `not_found` |
| `lookup_error` | string | bounded last lookup note |
| `lookup_retry_after` | Date/null | retry throttle |
| `dictionary` | response-only object | joined shared lexicon view; not required in stored item |
| `learning_status` | string | `new`, `learning`, or `mastered` |
| `review_due_at` | Date | next scheduled review |
| `review_interval_days` | number | current rule-based interval |
| `review_streak` | number | consecutive Know count |
| `last_reviewed_at` | Date/null | most recent review response |
| `merge_undo` | object/null | short-lived source snapshots and expiry for the 10-second merge undo |

Rules:

- Only active students can save.
- Visitors and teachers cannot save.
- Browser must call `studentVocabulary`, not write database directly.
- Paginated list responses use an integer read cursor over the existing
  `student_uid + status + updated_at` ordering and return `next_cursor`,
  `has_more`, and page-zero `total_count`. These are response controls, not
  stored fields. Mutations continue to use stable `vocab_id` ownership checks.
- Words may be saved either from selected page text, including answer and
  explanation content, or from the manual My Words add form.
- Forgot schedules one day, A little schedules three days, and Know advances
  through 7, 14, and 30 days. Three consecutive Know responses mark Mastered.
- Editing may update `text`/`normalized_text`, `personal_note`, and up to eight
  displayed saved Source contexts in one `updateWord` request. A Source edit
  updates the corresponding `saved_examples` snapshots while preserving their
  source identities and saved dates; the first context is also mirrored to the
  top-level `context` compatibility field. Dictionary
  details remain a joined shared view; a spelling change without a matching
  lexicon record returns pending/empty dictionary details for enrichment. If
  the target normalized text already exists, the edit becomes an explicit merge
  flow rather than creating a duplicate.
- Merge archives selected source cards under the same student, preserves
  `saved_examples`, combines Notes with original-form labels, and stores only
  enough snapshots for the immediate undo operation.

## 12a. `vocabulary_lexicon_history`

Core fields include `lexicon_id`, `normalized_word`, `before`,
`changed_by_teacher_uid`, and `changed_at`. The replacement is the current
`vocabulary_lexicon` record. History is
teacher/backend-only audit data and is never returned to students.

## 12b. `vocabulary_dictionary_reports`

Core fields include `normalized_word`, `lexicon_id`, `student_uid`,
`student_id_snapshot`, `vocab_id`, `reason`, `status`, `created_at`,
`resolved_at`, and `resolved_by_teacher_uid`. Reports are teacher-readable; student ownership
is derived from authentication, never from browser-supplied identity.

## 13. Browser Storage

LocalStorage may hold:

- visitor mode
- draft answers
- page preferences
- highlights
- identity hints

Teacher workspace navigation state may also use:

- `history.state` for the current history entry's View/Library filters,
  expanded groups, matrix density, stable scroll anchors, and scroll offsets
- tab-scoped `sessionStorage` as a validated Back fallback when the original
  history entry cannot be reused
- account-scoped IndexedDB for a maximum-24-hour teacher workspace snapshot on
  the owner's private device

The IndexedDB snapshot may contain student display profiles, public set
metadata, assignment summaries, and progress summary fields. Nested attempts,
submitted answers, correct answers, explanations, grading keys, passwords, and
auth tokens must not be cached there. Explicit teacher logout deletes the
account snapshot. Cache hydration is presentation-only and must immediately
revalidate against CloudBase.

The Student Dashboard uses a separate owner-keyed IndexedDB snapshot with the
same 24-hour maximum age. Allowed fields are redacted assignment and public-set
summaries, To Do/Finished/Upcoming counts, weekly aggregate counts, assignment
and self-study STAR totals, the unread Teacher Reply count, and cache timestamps.
Teacher Reply bodies, per-attempt detail payloads, submitted/correct answers,
question results, explanations, grading keys, passwords, and tokens are
excluded. This cache is presentation-only, is replaced by live CloudBase data,
and is deleted on explicit logout. No collection schema or migration is added.

It must not be the source of truth for:

- completion
- STAR
- assignment status
- grading
- ownership
- report ranking, membership, published snapshots, or other students' report details

## 12. Data Model Risks

- Legacy public JSON still contains some answers.
- Grading-key import and teacher Argue updates need reconciliation.
- Some old status words still exist for compatibility.
- Shared backend status logic should be extracted to reduce drift.
- Report membership/cutover dates and Shanghai-time boundaries require dedicated
  rule tests before historical reports are trusted.
- A shared report URL is safe only if `learningReports` redacts the response
  server-side; hiding entries in `reports.js` is not a data boundary.

## 14. Content Editions

Optional `sets` fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `edition_family` | string | stable grouping key shared by V1/V2/V3 |
| `edition_number` | number | positive edition number |
| `edition_label` | string | compact label such as `V2` |
| `is_latest_edition` | boolean | exactly one true when a family has multiple visible editions |
| `content_version` | string/null | optional public/private compatibility version for stale-client rejection |

The original set keeps its existing `set_id`; edition identity never replaces
`set_id`. Attempts may additionally store `content_version`, and each
`question_results[]` entry may store `question_text_snapshot`. Historical
correct answers and explanations already stored in the attempt are authoritative
for review; current `grading_keys` are fallback only when a legacy attempt lacks
those fields.

`getDashboard.library_progress` is a response-only redacted array keyed by
concrete `set_id`; it is not a new collection.
