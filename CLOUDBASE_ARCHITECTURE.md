# Mr. Cat Academy CloudBase Architecture

## 1. Project Goal

Turn the current static resource website into a lightweight student learning
system without building a full LMS.

The first complete student flow is:

1. A teacher creates a student and assigns work.
2. The student logs in.
3. The student sees assigned work.
4. The student completes a practice set.
5. CloudBase grades the submission.
6. Every attempt is stored.
7. The assignment becomes `passed`, `mastered`, or remains `to_do`.
8. The student can use `Try Again` without losing earlier records.

The existing static practice pages should be retained and adapted instead of
being rebuilt all at once.

## 2. Ownership and Agent Boundaries

The Tencent Cloud account and every CloudBase environment belong only to the
project owner.

The owner retains control of:

- Tencent Cloud account access and MFA
- billing and account settings
- environment creation and deletion
- production deployment approval
- DNS, domain and ICP-related settings
- permission grants and revocation

Agents may:

- write and test repository code
- prepare cloud function source code
- prepare database migration scripts
- prepare deployment commands and checklists
- operate the development environment only after explicit approval

Agents must not:

- request or store the owner's account password
- commit `SecretId`, `SecretKey`, tokens or private credentials
- deploy to production without explicit owner approval
- modify billing, DNS, domain or account settings
- weaken database permissions to simplify development

The current development environment is:

```text
mrcat-dev-d9gwy2v1icdfdf597
```

The environment ID is public configuration, not a secret.

## 3. Student Interface

After login, students enter one mobile-first dashboard with three navigation
capsules:

- `Assignments`
- `Explore`
- `Profile`

### Assignments

The default view has three selectable status cards:

- `TO DO`: assignments below the passing threshold
- `PASSED`: assignments at or above the passing threshold but below mastery
- `MASTERED`: assignments at or above the mastery threshold

On first entry, `TO DO` is selected. Within each type, newly assigned work
appears first. Selecting a status card shows only that type without extra
explanatory sections.

Assignment statuses are:

```text
to_do
passed
mastered
```

`MASTERED` defaults to the most recent week. The student can switch between:

- 1 Week
- 1 Month
- All

These filters never delete database records.

### Explore

Explore contains the site's complete public learning catalog.

Logged-in students may complete any resource. A voluntary practice attempt is
stored even when the resource was not assigned. It does not create an
assignment and does not count as an assigned task completed.

### Profile

Profile shows:

- student name
- Student ID
- class group
- basic learning summary
- change password
- logout

## 4. Visitor Mode

Visitors enter the same dashboard.

- `Assignments` is empty.
- `Explore` remains available for browsing.
- `Profile` explains that the user is in Visitor Mode.
- Visitors cannot type, select or submit practice answers.

When a visitor first tries to interact with an answer control, show:

- `Log In`
- `Continue as Visitor`

Continuing as a visitor keeps the practice page open but does not unlock answer
controls.

Anonymous CloudBase authentication remains disabled. Visitor Mode is only a
frontend browsing state and receives no authenticated database access.

## 5. Identity Model

CloudBase built-in username/password authentication is used.

The public Student ID is the login username, for example:

```text
test001
```

CloudBase creates a permanent user ID for the authentication account. The
project stores that value as `auth_uid`.

`auth_uid` is:

- a database field, not a function
- always stored as a string
- the authoritative link between authentication and learning data
- independent of nickname, password, email and phone changes

All ownership checks use `auth_uid`. They must not trust a `student_id` sent by
the browser.

Future email, phone or WeChat login methods must bind to an existing student
identity instead of creating separate learning histories.

Student self-registration is not part of the first version.

## 6. Password Rules

Passwords are managed by CloudBase authentication and are not stored in the
`students` collection.

The student can change a password from Profile after confirming the current
password.

The teacher may force-reset a student's password to the agreed initial
password. Because CloudBase requires password complexity, the effective
initial password must satisfy its current validation rules. The current test
value follows this pattern:

```text
eight zeroes + uppercase A + lowercase a + underscore
```

The exact reset value must be server-side configuration, not duplicated across
frontend files.

After a teacher reset:

- previous credentials stop working
- `must_change_password` becomes `true`
- the student must change the initial password after login

The teacher can reset a password but cannot read the student's current
password.

## 7. Database Collections

All collections use `ADMINONLY`. Browsers never read or write them directly.
Cloud functions are the only data access layer.

### students

```text
auth_uid: string
student_id: string
name: string
class_group: string
curriculum_track: "DSE" | "A-Level" | "AP" | "IB" | "Zhongkao" | "Gaokao" | ""
role: "student"
must_change_password: boolean
active: boolean
email: string | null
phone: string | null
created_at: server timestamp
updated_at: server timestamp
```

Required indexes:

- unique `auth_uid`
- unique `student_id`

### sets

One record describes one public practice resource.

```text
set_id: string
section_id: string
title: string
type: string
course: string
link: string
difficulty: string
estimated_minutes: number | null
passing_percentage: number | null
mastery_percentage: number | null
feedback_policy: string | null
visible: boolean
created_at: server timestamp
updated_at: server timestamp
```

Existing IDs remain canonical:

- `BBC-260319`
- `C7-T1-P1`
- `NGSL-A`

Configuration resolution order:

1. set-specific value
2. section-specific value
3. system default

The first system-wide passing percentage is `50`.

### assignments

One record represents one assignment of a set to one student.

```text
assignment_id: string
student_uid: string
set_id: string
status: "to_do" | "passed" | "mastered"
assigned_at: server timestamp
due_at: timestamp | null
passing_percentage: number
mastery_percentage: number
completed_at: timestamp | null
mastered_at: timestamp | null
latest_attempt_id: string | null
attempt_count: number
latest_percentage: number | null
best_percentage: number | null
raw_best_percentage: number | null
best_attempt_id: string | null
best_correct_count: number | null
best_question_count: number | null
answer_revealed: boolean
answer_revealed_at: timestamp | null
mastery_locked: boolean
mastery_locked_at: timestamp | null
created_at: server timestamp
updated_at: server timestamp
```

The same set may be assigned more than once. Each assignment therefore needs
its own `assignment_id`.

### attempts

Every countable submission creates a new immutable attempt record.

```text
attempt_id: string
student_uid: string
student_id_snapshot: string
set_id: string
assignment_id: string | null
mode: string
attempt_number: number
answers: object
question_results: array
correct_count: number
question_count: number
percentage: number
passing_percentage: number
mastery_percentage: number
passed: boolean
mastered: boolean
raw_percentage: number
display_percentage: number
mastery_eligible: boolean
mastery_blocked_reason: string
feedback_policy: string
started_at: timestamp
submitted_at: server timestamp
duration_seconds: number | null
practice_context: "assignment" | "resource"
grading_version: string
```

Attempts are append-only. A retry never overwrites an earlier attempt.

### grading_keys

Private grading material:

```text
set_id: string
grading_version: string
answers: object
explanations: object
scoring_rules: object
updated_at: server timestamp
```

This collection contains:

- correct answers
- explanations
- evidence
- accepted answer variants
- scoring rules

These fields must be removed from public GitHub content before the new grading
flow is considered complete.

### system_config

System and section defaults:

```text
config_key: string
value: object
updated_at: server timestamp
```

Initial grading defaults:

```json
{
  "default_passing_percentage": 50,
  "default_mastery_percentage": 90,
  "default_feedback_policy": "always"
}
```

Supported feedback policies should include:

- `always`
- `passed_only`

The first version uses `always`.

### student_set_achievements

Permanent, monotonic completion records:

```text
achievement_id: unique string
student_uid: auth UID
student_id_snapshot: string
set_id: string
status: "star"
protected: true
source: "assignment" | "explore"
assignment_id: string | null
claimed_at: timestamp | null
first_earned_at: timestamp
first_qualifying_attempt_id: string
best_attempt_id: string
best_percentage: number
created_at: timestamp
updated_at: timestamp
```

Assignment star claims use `source: "assignment_claim"` and store
`assignment_id`. They are counted for the student dashboard star counter and do
not block later assignments of the same `set_id`.

One student may claim one STAR per mastered assignment. A STAR may update its
best attempt and score, but it must never be deleted, revoked or downgraded by
ordinary application logic. Later passing-standard changes affect future
submissions only.

### answer_disputes

One student review request per `attempt_id + question_id`:

```text
dispute_id: unique string
student_uid: auth UID
set_id: string
attempt_id: string
assignment_id: string | null
question_id: string
question_text_snapshot: string
submitted_answer: any
answer_snapshot: any
explanation_snapshot: string
student_reason: optional string
status: "pending" | "approved" | "rejected"
decision: "keep" | "add" | "replace" | null
teacher_note: optional string
created_at: timestamp
resolved_at: timestamp | null
```

Only a recorded wrong answer owned by the authenticated student may be
disputed. The same question in the same attempt cannot be disputed twice.

### grading_key_history

Every teacher-approved answer-rule change stores the answer before and after,
grading versions, dispute ID, teacher UID and timestamp. This history is never
public and must not be removed when a grading key changes.

## 8. Server-Side Grading

The browser submits answers, not a trusted score.

The grading cloud function:

1. verifies the authenticated `auth_uid`
2. verifies that the student is active
3. loads the private grading key
4. calculates the score on the server
5. resolves the effective passing percentage
6. stores a new attempt
7. updates the assignment summary when applicable
8. returns only the permitted feedback

The first version returns correct answers and explanations after every
countable submission.

Future `passed_only` behavior:

- passed: return score, answers and explanations
- failed: return score and failed status only

## 9. Assignment Completion

For ordinary practice sets:

- percentage greater than or equal to the effective passing percentage:
  `done`
- percentage below the effective passing percentage: `failed`

A failed attempt is still permanently stored.

`Try Again`:

- clears answers and feedback in the page
- starts a fresh attempt
- does not delete previous attempts
- may change a failed assignment to done after a later passing submission

Once an assignment has passed, later retries do not remove its completed
status. Later attempts are still recorded and update latest/best summaries.

Backend star claims do not create fake assignments and do not block teachers
from assigning the same `set_id` again later.

Opening a STAR shows the best attempt's submitted answers and correctness only.
Correct answers and explanations are returned only immediately after a new
submission, never by the historical review endpoint.

## 9A. Argue Review

After a countable submission, each wrong result may be sent to the teacher with
an optional note. The teacher chooses:

- `Keep Original Ruling`
- `Add as Accepted Answer`
- `Replace Correct Answer`

`Add` keeps existing accepted answers. `Replace` removes the old answer from
future grading, while preserving it in `grading_key_history`.

Approval updates the private CloudBase `grading_keys` document and increments
`grading_version`. It regrades only the disputed student's attempt. Past
attempts from other students never change automatically. Future submissions
use the updated rule.

Argue-based regrading may improve a historical result and create a STAR, but it
must never reduce a score or revoke an existing STAR.

## 10. Vocabulary Rules

Only Vocabulary `Test Mode` can create a countable attempt.

The student chooses the number of groups. The actual groups are randomly
selected.

### 1-4 groups

- self-test only
- no database attempt
- no assignment status change
- frontend warning states that four groups or fewer do not count

### 5 or more groups

- countable submission
- server-side grading
- stored in `attempts`
- assignment becomes done or failed according to the effective passing rate

Vocabulary attempt metadata includes:

```text
selected_group_count
selected_group_ids
group_results
```

Each group result records:

```text
group_id
correct_count
question_count
percentage
```

The overall percentage determines pass or fail.

## 11. Cloud Functions

The initial backend should expose narrowly scoped functions:

### getCurrentStudent

- reads authenticated UID from CloudBase context
- returns safe profile data only
- rejects inactive or unlinked users

### getDashboard

- returns only the authenticated student's assignments
- merges safe set metadata
- returns assignment summaries, not private grading keys

### getResources

- returns visible resource metadata
- does not return grading keys

### submitAttempt

- grades answers server-side
- stores every countable attempt
- updates assignment status and summaries
- enforces Vocabulary's minimum five-group rule
- applies feedback policy

### changePassword

- changes only the authenticated student's password
- clears `must_change_password` after success

### resetStudentPassword

- teacher-only operation
- resets to the configured initial password
- sets `must_change_password` to true
- must not be callable by ordinary students

### teacherAdmin

- verifies an active `role: "teacher"` profile on every request
- creates active CloudBase authentication users and matching student profiles
- rolls back a newly created authentication user if profile creation fails
- updates safe student profile fields and active status
- resets student passwords to a server-configured initial password
- creates assignments
- returns assignment and attempt summaries
- never returns saved answers or private grading keys

No admin function should rely on a frontend flag such as `role: "teacher"`.
Teacher authorization must be verified server-side.

## 12. Public and Private Content

GitHub may contain:

- reading passages and listening prompts
- questions and choices
- public resource metadata
- static pages and assets
- CloudBase environment ID

CloudBase private storage contains:

- answers
- explanations and evidence
- accepted answer variants
- scoring rules
- student profiles
- assignments
- attempts and scores

The existing public JSON files currently contain answers. Migration is
therefore a required project step, not an optional later enhancement.

Migration must:

1. extract private grading fields
2. import them into `grading_keys`
3. generate public question-only JSON
4. update pages to consume the public format
5. verify that no answers remain in public repository history going forward

Removing answers from current files does not erase old Git history. This
system reduces casual access but cannot make previously committed answers
cryptographically secret. New and revised grading keys should no longer be
committed.

## 13. Repository Structure

The first migration should preserve existing practice URLs.

```text
index.html
dashboard.html
bbc.html
ielts-reading.html
vocabulary.html

assets/
  css/
    app.css
  js/
    cloudbase-client.js
    auth.js
    dashboard.js
    practice-session.js

cloudfunctions/
  getCurrentStudent/
  getDashboard/
  getResources/
  submitAttempt/
  changePassword/
  resetStudentPassword/

content/
data/
scripts/
```

Moving practice pages into `pages/` is deferred because it would change
existing URLs and relative asset paths without helping the first milestone.

## 14. Catalog Synchronization

GitHub content remains the source for public lesson metadata during the first
implementation.

CloudBase `sets` stores the dashboard-facing resource catalog. To avoid manual
drift, a later local synchronization script should:

1. read the repository catalog
2. show the proposed changes
3. require owner confirmation
4. update only the development environment
5. never deploy to production automatically

Student records, assignments, attempts and private grading keys must never be
overwritten by catalog synchronization.

## 15. Time Rules

All student-facing times use China Standard Time:

```text
Asia/Shanghai (UTC+8)
```

CloudBase should store timestamps as absolute server times. The frontend
formats them as Beijing time.

Overdue unfinished assignments remain visible and receive an `Overdue` label.

## 16. Implementation Phases

### Phase 1: Safety and foundation

- add repository secret protections
- add agent operating rules
- add public CloudBase configuration
- scaffold shared frontend modules
- scaffold cloud functions
- document deployment without deploying production

### Phase 2: Authentication and dashboard

- replace the current homepage with login entry
- build the three-section dashboard
- support Visitor Mode
- connect `test001`
- implement Profile and forced password change

### Phase 3: Private answer migration

- define normalized public question and private grading formats
- extract BBC, IELTS and Vocabulary answer data
- import development grading keys
- remove grading data from public runtime files
- verify the repository no longer serves current answers

### Phase 4: Practice integration

- add authenticated practice sessions
- block Visitor answer controls
- integrate BBC grading
- integrate IELTS Reading grading
- integrate Vocabulary Test Mode grading
- implement Try Again

### Phase 5: Full development test

Required acceptance flow:

```text
test001 logs in
-> sees an assignment
-> opens the existing practice page
-> submits answers
-> server grades and stores the attempt
-> assignment displays Done or Failed
-> Try Again creates another independent attempt
```

Also verify:

- voluntary Resource attempts are stored
- Visitor submissions are impossible
- one student cannot access another student's data
- four-group Vocabulary tests create no database records
- five-group Vocabulary tests do create records
- dashboard date filters do not delete data

### Phase 6: Owner-reviewed production preparation

- create a separate production environment
- repeat collection and permission setup
- import approved production data
- run security and privacy checks
- deploy only after explicit owner approval

## 17. Out of Scope for the First Milestone

- full teacher administration panel
- automatic class-wide assignment creation
- parent accounts
- messaging and notifications
- email or SMS login
- rank lists or competition features
- payment features
- production deployment

The UID-based identity design keeps future email and SMS login additions from
requiring a learning-data redesign.
