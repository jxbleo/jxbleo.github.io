# 04 Data Model

> This document describes current backend and runtime data structures.
> Update it when fields, collections, statuses, ownership rules, or data flow changes.

## 1. Data Sources

The project uses several data layers:

- Public static content: `content/`, `data/`, audio/image assets
- Private generated import files: `.cloudbase-private/import/`
- CloudBase Authentication users
- CloudBase database collections
- Browser localStorage for non-authoritative UI state

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

All collections should remain `ADMINONLY`.

## 3. `students`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `auth_uid` | string | CloudBase Auth user ID |
| `student_id` | string | human-facing Login ID |
| `name` | string | display name |
| `class_group` | string | class/group |
| `curriculum_track` | string | DSE, IELTS, etc. |
| `role` | string | `student` or `teacher` |
| `active` | boolean | account enabled in app |
| `must_change_password` | boolean | force password change |
| `created_at` | Date | created time |
| `updated_at` | Date | updated time |

Rules:

- `auth_uid` is the ownership key.
- `student_id` is unique but not used for authorization.
- Teacher actions require `role: "teacher"` and `active: true`.
- Student-facing functions should require `role: "student"`.

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
| `visible` | boolean | visible in Library/Explore |

Rules:

- `sets` controls authenticated Explore/Library visibility.
- Static catalog visibility and CloudBase visibility can drift; check both.

## 5. `assignments`

Core fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `assignment_id` | string | unique assignment instance |
| `student_uid` | string | owner `students.auth_uid` |
| `set_id` | string | assigned set |
| `status` | string | `to_do`, `passed`, `mastered`, `cancelled` |
| `assigned_at` | Date | assignment time |
| `due_at` | Date/null | due time |
| `passing_percentage` | number | assignment passing threshold |
| `mastery_percentage` | number | assignment mastery threshold |
| `standards_updated_at` | Date/null | last teacher standards edit time |
| `standards_updated_by_teacher_uid` | string/null | teacher who last edited due/threshold standards |
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

Teachers may edit an existing assignment's `due_at`, `passing_percentage`, and
`mastery_percentage` from the View surface. Those edits affect future
submissions and display standards, but do not automatically regrade historical
attempts or downgrade completed assignments and protected STAR records.

Teachers may cancel selected open assignments by `assignment_id`. Cancellation
is a soft state change to `status: "cancelled"`, never a delete. Cancelled
assignments are hidden from the student dashboard and rejected by
`submitAttempt`, but old attempts remain immutable history and can still be
found through set-level History. Completed `passed` / `mastered` assignments
and protected STAR records are skipped by normal cancellation.

Reassignment rule:

- Open assignment (`to_do`, legacy `not_done`, legacy `failed`) blocks duplicate assignment.
- Completed history (`passed`, `mastered`, legacy `done`) does not block future reassignment.
- Cancelled history (`cancelled`) does not block future reassignment.
- Reassignment creates a new `assignment_id`.

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
| `practice_context` | string | `assignment` or `resource` |

Rules:

- Attempts are append-only.
- Try Again creates a new attempt.
- Failed attempts are still stored.
- Self-study attempts use `assignment_id: null` only when the student has no open assignment for the same `set_id`.
- If a student submits a Library/Explore entry that matches an open assignment, `submitAttempt` stores the attempt with that `assignment_id`.
- Argue `add`/`replace` may add upward-only adjusted fields to old attempts;
  original submitted answers and raw attempt history remain preserved.
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
- `add` and `replace` update future grading and also trigger automatic upward
  regrading for historical attempts with the same set/question/submitted answer.
- Historical regrading may improve attempts, assignment summaries, and STAR
  records, but must not lower scores or revoke protected records.
- Previous grading changes can be repaired with the paginated teacher-only
  `backfillAcceptedAnswerRegrades` action.

## 10. `student_vocabulary_items`

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

Rules:

- Only active students can save.
- Visitors and teachers cannot save.
- Browser must call `studentVocabulary`, not write database directly.

## 11. Browser Local Storage

LocalStorage may hold:

- visitor mode
- draft answers
- page preferences
- highlights
- identity hints

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
