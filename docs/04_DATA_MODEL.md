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
| `grading_keys` | private answers and scoring rules |
| `system_config` | defaults such as passing/mastery |
| `student_set_achievements` | protected STAR records |
| `answer_disputes` | student/teacher Argue requests |
| `grading_key_history` | answer-rule change history |
| `student_vocabulary_items` | personal saved words |
| `vocabulary_lexicon` | shared curated/ECDICT/API dictionary entries |
| `vocabulary_test_sessions` | active/ended Vocabulary Test integrity sessions |

All collections should remain `ADMINONLY`.

## 3. `students`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `auth_uid` | string | CloudBase Auth user ID |
| `student_id` | string | human-facing Login ID for current profiles; internal `__deleted__:<profile-id>` archive key after deletion |
| `name` | string | display name |
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
| `created_at` | Date | created time |
| `updated_at` | Date | updated time |

Rules:

- `auth_uid` is the ownership key.
- `student_id` is unique among non-deleted profiles but is not used for
  authorization.
- Teacher actions require `role: "teacher"` and `active: true`.
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

## 5. `assignments`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `assignment_id` | string | unique assignment instance |
| `assignment_batch_id` | string/null | shared batch key for assignments created by the same teacher Assign action for the same set |
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

Status rule:

```text
to_do -> passed -> mastered
```

Status is monotonic. Later lower-scoring attempts update latest fields but do not downgrade assignment completion.
Assignment summary fields such as `attempt_count`, `latest_attempt_id`,
`latest_percentage`, `best_attempt_id`, and `best_percentage` are derived from
immutable attempts. `submitAttempt` should recompute those summary fields from
the linked assignment attempts after recording a countable assignment attempt.
Teacher progress views may use linked attempts as a fallback if stored summary
fields are missing or stale.

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
`mastered` or create a new STAR.
The matrix task-header bulk editor does not introduce a shared mutable class
standard record. It resolves the visible column to explicit `assignment_id`
values and updates those assignment documents individually, preserving the
assignment-level ownership and audit model.

During migration, `getDashboard` and `teacherAdmin` derive an effective
Sunday-end `due_at` from legacy `assigned_at`, then `created_at`, when the
canonical field is missing. The authenticated teacher-only
`backfillAssignmentDueWeeks` action is dry-run by default and can persist those
normalized weeks in bounded batches. Records with none of those date sources
are reported and never silently assigned an invented week.

Teachers may cancel selected open assignments by `assignment_id`. Cancellation
is a soft state change to `status: "cancelled"`, never a delete. Cancelled
assignments are hidden from the student dashboard and teacher View progress,
and rejected by `submitAttempt`, but old attempts remain immutable history and
can still be found through set-level History. Completed `passed` / `mastered`
assignments and protected STAR records are skipped by normal cancellation.

Reassignment rule:

- Open assignment (`to_do`, legacy `not_done`, legacy `failed`) blocks duplicate assignment.
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
| `practice_context` | string | `assignment` or `resource` |

Rules:

- Attempts are append-only.
- Try Again creates a new attempt.
- Failed attempts are still stored.
- Self-study attempts use `assignment_id: null` only when the student has no open assignment for the same `set_id`.
- If a student submits a Library/Explore entry that matches an open assignment, `submitAttempt` stores the attempt with that `assignment_id`.
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
| `assignment_id` | string/null | assignment STAR or self-study |
| `status` | string | `star` |
| `protected` | boolean | should be true |
| `source` | string | `assignment_claim`, `self_study`, legacy `explore` |
| `first_earned_at` | Date | first qualifying time |
| `first_qualifying_attempt_id` | string | first qualifying attempt |
| `best_attempt_id` | string | best attempt |
| `best_percentage` | number | best percent |

Rules:

- STAR is backend-owned.
- STAR is monotonic and protected.
- Assignment STAR is keyed by `assignment_id`.
- Self-study STAR has `assignment_id: null`.

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
| `auto_regrade_scanned_attempt_count` | number | attempts scanned after `add`/`replace` |
| `auto_regrade_adjusted_attempt_count` | number | attempts improved after `add`/`replace` |

Rules:

- One student dispute per `attempt_id + question_id`.
- Only wrong recorded questions can be disputed by students.
- Teacher-originated disputes may have no `attempt_id`.
- Teacher dispute lists hide student disputes linked to assignments whose
  current status is `cancelled`.
- `add` and `replace` update future grading and also trigger automatic upward
  regrading for historical attempts with the same set/question/submitted answer.
- Historical regrading may improve attempts, assignment summaries, and STAR
  records, but must not lower scores or revoke protected records.
- Previous grading changes can be repaired with the paginated teacher-only
  `backfillAcceptedAnswerRegrades` action.

## 10. `vocabulary_test_sessions`

Purpose: server-side integrity session for countable Vocabulary Test mode
only. A session is created before a 5+ group Vocabulary Test begins, receives
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

- Only 5+ group Vocabulary Test mode creates a session.
- Vocabulary Test `due_at` is based on 90 seconds, or 1.5 minutes, per selected
  group.
- `submitAttempt` grades countable Vocabulary Tests from the session's
  `question_ids` and private grading snapshots, not from a browser-provided
  question list or a grading key that changed after the test started.
- The browser must send the public unit `contentVersion` when starting,
  resuming, heartbeating, and submitting. A missing or mismatched version is
  rejected with `VOCABULARY_CONTENT_OUTDATED` before grading.
- Missing submitted answers for session questions count as blank answers.
- A different `client_instance_id` is blocked from student cloud-function
  surfaces while a session is active. The browser must generate this ID in
  memory for each page load rather than storing it in `sessionStorage`, because
  cloned tabs can inherit session storage.
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

Rules:

- Collection remains `ADMINONLY`; only trusted functions and owner imports write.
- `normalized_word` and `lexicon_id` are unique.
- Project-curated entries take precedence over ECDICT and external API data.
- External misses and failures are throttled on the student item rather than
  creating repeated provider requests.

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
| `lookup_status` | string | `pending`, `ready`, or `not_found` |
| `lookup_error` | string | bounded last lookup note |
| `lookup_retry_after` | Date/null | retry throttle |
| `dictionary` | response-only object | joined shared lexicon view; not required in stored item |
| `learning_status` | string | `new`, `learning`, or `mastered` |
| `review_due_at` | Date | next scheduled review |
| `review_interval_days` | number | current rule-based interval |
| `review_streak` | number | consecutive Know count |
| `last_reviewed_at` | Date/null | most recent review response |

Rules:

- Only active students can save.
- Visitors and teachers cannot save.
- Browser must call `studentVocabulary`, not write database directly.
- Words may be saved either from selected page text, including answer and
  explanation content, or from the manual My Words add form.
- Forgot schedules one day, A little schedules three days, and Know advances
  through 7, 14, and 30 days. Three consecutive Know responses mark Mastered.

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

It must not be the source of truth for:

- completion
- STAR
- assignment status
- grading
- ownership

## 12. Data Model Risks

- Legacy public JSON still contains some answers.
- Grading-key import and teacher Argue updates need reconciliation.
- Some old status words still exist for compatibility.
- Shared backend status logic should be extracted to reduce drift.
