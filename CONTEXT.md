# Mr. Cat Academy Domain Language

This glossary defines the shared product language for Mr. Cat Academy. It
describes domain concepts only; implementation rules belong in the numbered
project documentation.

## Content Editions

**Edition Family**:
One lesson or learning unit whose alternative complete exercise editions are
presented together for discovery.
_Avoid_: Assignment group, grading version

**Content Edition**:
One independently assignable and gradable exercise set within an Edition
Family, such as V1 or V2. Each edition owns its own progress and STAR outcomes.
_Avoid_: Revision, display variant

**Latest Edition**:
The Content Edition currently identified as the newest choice in an Edition
Family. Being latest does not invalidate or replace a Previous Edition.
_Avoid_: Required edition, automatic default

**Previous Edition**:
A non-latest Content Edition that remains a complete selectable exercise.
_Avoid_: Deleted content, archived content

**Grading Revision**:
A limited prompt, answer, accepted-variant, or explanation change within one
Content Edition. It is not a new Content Edition.
_Avoid_: V2, replacement set

**Attempt Snapshot**:
The question, submitted answer, grading result, and grading context retained
from one countable submission for faithful historical review.
_Avoid_: Current answer key, live exercise content

## AI Tutor Writing

**Writing Composition**:
One student's writing work from initial prompt/manuscript through review and
training. Re-uploading within the same workspace revises this Composition;
starting New Writing creates another one.
_Avoid_: Assignment, attempt, uploaded photo

**Confirmed Manuscript**:
The student-approved text that becomes the authoritative source for writing
review, whether it was typed directly or corrected after OCR.
_Avoid_: OCR output, uploaded image, model transcription

**Assessment Mode**:
The one review purpose selected for a Writing Composition at a time: General
Language Review or Standardized Content Review.
_Avoid_: Automatically detected exam type, combined review

**Standardized Content Review**:
Writing feedback evaluated against the student's selected examination Rubric,
including an estimated score derived under that Rubric.
_Avoid_: Official exam score, General Language Review

**General Language Review**:
Sentence-level language feedback that preserves the student's intended meaning
and does not produce an examination score.
_Avoid_: Content score, automatic language upgrade

**CEFR Writing Estimate**:
An approximate compact CEFR level such as B1-, B1, or B1+ evidenced by one
Confirmed Manuscript's writing performance, not the student's overall proficiency.
_Avoid_: Certified CEFR level, examination score

**Sentence Training**:
The follow-up activity in which the student rewrites identified sentences after
reading language feedback; required sentences complete together before feedback.
_Avoid_: Full Composition rewrite, answer copying

## Exercise Progress and Assignment Participation

**Exercise Progress**:
One student's authoritative, set-wide learning result for one Content Edition,
derived from every countable attempt regardless of which assignment or Library
entry created it.
_Avoid_: Assignment score, latest submission

**Best Score**:
The highest eligible score in Exercise Progress. A tie or lower retry remains
history but does not replace the attempt that first established that score.
_Avoid_: Latest score, average score

**Best Score Improved At**:
The submission time when Best Score last increased strictly. FINISHED ordering
uses this learning event, not an assignment creation time or a lower retry.
_Avoid_: Last attempted at, assigned at

**Assignment Participation**:
A teacher-created reporting and reward context for an exercise. It applies its
Passing, Earn STAR, mastery, due-week, and class-report rules to the student's
existing Exercise Progress without becoming a separate learning record.
_Avoid_: Exercise Progress, attempt owner

**Completed Before Assignment**:
An Assignment Participation that is already Finished when created because the
student's prior Exercise Progress meets its Passing standard.
_Avoid_: Auto-completed attempt, teacher-awarded pass

**Promoted Class Participation**:
An open individual Assignment Participation reused in a later whole-class
Assign operation and moved into that Class Task instead of being duplicated or
skipped.
_Avoid_: Duplicate class assignment, reassignment

## Classes and Learning Reports

**Class**:
A teacher-managed group whose active students receive the same class work and
appear together in periodic learning comparisons.
_Avoid_: Class group string, assignment batch

**Class Membership**:
One student's time-bounded participation in one Class. A student has at most
one active membership, while ended memberships remain part of report history.
_Avoid_: Current class label, permanent class ownership

**Reporting Period**:
A completed Shanghai-calendar week or natural month whose learning facts are
captured together.
_Avoid_: Rolling range, live dashboard window

**Learning Report Preview**:
An incomplete teacher-only view of a Reporting Period that can receive teacher
comments before the period closes. Its calculated facts may still change.
_Avoid_: Published report, final snapshot

**Published Learning Report**:
The fixed class and student learning snapshot created after a Reporting Period
closes. Later activity does not silently rewrite it.
_Avoid_: Live progress, protected reference report, attempt report

**Class Task**:
One assignment batch given to every report-eligible member of the same Class
under the same due-period expectations.
_Avoid_: Individual assignment, self-study item

**Completed Class Item**:
One Class Task that a student reached its Passing standard for by the relevant
report cutoff. Repeated attempts do not create additional completed items.
_Avoid_: Submission count, attempt count, mastery count

**Self-Study Activity**:
A countable unassigned learning attempt kept outside Class Task completion and
Class ranking.
_Avoid_: Optional class task, bonus ranking point

**Class Leaderboard**:
The real-name, period-specific ordering of eligible Class members by Completed
Class Items, with equal counts sharing the same rank.
_Avoid_: Overall ability ranking, cross-course score ranking

## Intensive Listening

**Listening Segment**:
One timestamped part of an Intensive Listening Material whose teaching behavior
is explicitly Dictation, Listen Only, or Skip.
_Avoid_: Sentence, physically cut audio file

**Dictation Segment**:
A Listening Segment whose required Word Slots must be transcribed before the
segment is complete.
_Avoid_: Every transcript row, listen-only passage

**Listen-Only Segment**:
A Listening Segment that students hear in sequence without typing or grading.
_Avoid_: Skipped Segment, free-answer question

**Skipped Segment**:
A Listening Segment intentionally omitted from student playback and progress,
such as a fixed ident, greeting, promotion, or closing.
_Avoid_: Listen-Only Segment, deleted source text

**Word Slot**:
One fixed positional word in a Dictation Segment. It is either Spelling Required
or a Provided Word; punctuation remains outside the slot.
_Avoid_: Character-length hint, automatically aligned answer

**Spelling Exemption**:
A teacher-approved rule that changes one Spelling Required Word Slot into a
Provided Word for every learner using that material version.
_Avoid_: Accepted spelling variant, corrected transcript

**Provided Word**:
A Word Slot whose reviewed word is shown automatically and does not need to be
typed or graded.
_Avoid_: Revealed answer, accepted typo

## Personal Vocabulary

**My Words Entry**:
A word or short phrase saved by one student, together with its personal source
and learning history.
_Avoid_: Dictionary entry, vocabulary lesson item

**Word Correction**:
A student-initiated change to the text of an existing My Words Entry that keeps
it as the same personal learning record. If the corrected text matches another
entry, the student chooses whether to merge them.
_Avoid_: Delete and re-add, rename

**Merge Candidate**:
Two My Words Entries that may represent inflected forms of the same base word
and can therefore be offered to the student for merging. A candidate suggestion
does not change either entry by itself. The initial product recognizes only
high-confidence regular plural, third-person, past-tense, and `-ing` relations;
derivations and ambiguous or irregular relations are excluded.
_Avoid_: Duplicate, automatic merge

**Word Merge**:
A student-confirmed combination of two Merge Candidates into one My Words
Entry whose text is the base form. Personal history and non-empty Personal
Notes from both entries are retained.
_Avoid_: Automatic correction, overwrite

**Merge Group**:
A base-form My Words Entry together with all of its current Merge Candidates,
presented in one review so the student can choose which forms to merge. Entries
the student does not select remain unchanged.
_Avoid_: Pairwise merge buttons, merge all automatically

**Saved Example**:
One preserved occurrence of a My Words Entry as the student originally met or
saved it, including the original form, source, context, and save date. Word
Correction and Word Merge do not rewrite Saved Examples.
_Avoid_: Dictionary example, current headword

**Recommended Headword**:
A high-confidence base form suggested for the current text of a My Words Entry,
whether or not another related entry already exists. It is an optional student
action and never changes the entry automatically.
_Avoid_: Automatic lemmatization, spelling correction

**Dictionary Details**:
Shared lexical information looked up from the current text of a My Words Entry,
including pronunciation, part of speech, and definitions. One current shared
record serves all students who save the same word or phrase; students cannot
edit its structured fields directly.
_Avoid_: Personal definition, student note

**Shared AI Draft**:
Dictionary Details generated when the first student requests AI help for a
Missing Dictionary Entry. The one draft is shared across students until a
teacher replaces or confirms its current content.
_Avoid_: Personal AI result, verified dictionary entry

**Personal Note**:
An optional, editable plain-text note attached to one My Words Entry. It is
private to that student and supplements rather than replaces Dictionary
Details; when entries merge, their non-empty notes are retained together with
their original-form labels.
_Avoid_: Definition, dictionary correction

**Word List Export**:
A student-created snapshot of selected My Words Entries arranged as a study
table. The student chooses which optional vocabulary details it contains and
exports it as an Excel workbook or table-formatted PDF; English is always
included and other study fields are optional.
_Avoid_: Practice worksheet, assignment

**Export Selection**:
The set of My Words Entries included in a Word List Export, formed by selecting
all entries, applying a Shanghai-calendar update period, or manually checking
individual entries. A period initially selects all matching entries and the
student may then remove or add individual selections; future familiarity
filters may further narrow the set.
_Avoid_: Vocabulary set, permanent list

**Export Activity Date**:
The most recent date on which the student saved, corrected, merged, or changed
the Personal Note of a My Words Entry. Background dictionary enrichment does
not change this date.
_Avoid_: Database update time, dictionary lookup time

**Missing Dictionary Entry**:
A saved word or phrase for which no shared Dictionary Details are currently
available. The student's entry remains usable and may hold a Personal Note or
request creation of a Shared AI Draft while waiting for teacher-maintained
details.
_Avoid_: Invalid word, failed save

**Dictionary Review Queue**:
The teacher-facing collection of Missing Dictionary Entries awaiting possible
manual or AI-assisted completion, together with Shared AI Drafts and reported
entries awaiting review. It is separate from Student Vocabulary View.
_Avoid_: Student notes, student vocabulary list

**Dictionary Issue Report**:
A student's private request for a teacher to review the current shared
Dictionary Details. It does not let the student modify shared content and is
not shown to other students.
_Avoid_: Dictionary edit, Argue request

**Teacher-Reviewed Entry**:
The current shared Dictionary Details after a teacher has confirmed or replaced
its content. It supersedes the active Shared AI Draft for student display.
_Avoid_: AI draft, personal note

**Student Vocabulary View**:
The teacher-authorized view of an individual student's My Words Entries,
including that student's personal records and content.
_Avoid_: Shared dictionary

**Shared Dictionary View**:
The teacher workspace for reviewing, creating, and maintaining Dictionary
Details used across students. A teacher update replaces the active content of
the same shared record rather than creating a second student-facing version.
_Avoid_: Student vocabulary list

## STAR Rewards

**Blue STAR**:
A stable, non-redeemable achievement earned by mastering a set through
self-study. It remains active until it is converted to the set's Yellow STAR.
_Avoid_: Protected STAR, cash credit

**Yellow STAR**:
A protected, redeemable achievement earned for one set only when a teacher has
enabled Earn STAR and the student meets that assignment's STAR Rate.
_Avoid_: Blue STAR, wallet balance

**STAR Rate**:
The teacher-selected mastery percentage for an assignment whose Earn STAR
setting is enabled.
_Avoid_: Passing rate, default mastery rate

**Available STAR Balance**:
The number of Yellow STAR credits a student can currently place into a Cash
Request after completed spending and active reservations are accounted for.
_Avoid_: Lifetime STAR count, achievement count

**Cash Request**:
A student's request to redeem a selected whole number of available Yellow
STARs through an in-person exchange confirmed by the teacher. It records no
cash amount or exchange rate.
_Avoid_: Cash payment, gift order

**Evidence Photo**:
A private, permanent image attached by the student or teacher to one Cash
Request as evidence of the in-person exchange.
_Avoid_: Teacher authentication, public receipt

**STAR Reservation**:
The temporary allocation of specific Yellow STAR credits to one pending Cash
Request so they cannot be spent again before completion, rejection, expiry, or
cancellation.
_Avoid_: Redemption, deletion

**STAR Refund**:
An append-only correction that returns previously redeemed Yellow STAR credits
without editing or deleting the completed Cash Request.
_Avoid_: Undo, record deletion

## DSE Speaking Lab

**Discussion**:
One DSE Group Interaction workspace whose Candidate tracks, access participants,
formal recording, speaker identities, AI analysis, and share snapshots belong
together. It may be created before any participant names are entered.
_Avoid_: Speaking attempt, audio file, chat room

**VIP Participant**:
An authenticated Mr. Cat Academy student manually invited or automatically
proposed from a reliable Reusable Voiceprint match. A VIP Participant may
accept or decline access, confirm their own voice, and create a Student Share
Snapshot after that confirmation.
_Avoid_: Registered speaker, account holder, member ID

**Guest Participant**:
A Discussion-scoped participant without a Mr. Cat Academy account. The entered
name is unverified, creates no login or long-term profile, and grants no report
or sharing authority.
_Avoid_: Non-speaker, temporary account, invited student

**Candidate**:
A reliable Speaker Track selected from the Formal Discussion Recording for DSE
analysis, whether or not its person has been named or invited.
_Avoid_: Listed participant, every detected voice, invitee

**Formal Discussion Recording**:
The authoritative group audio captured or uploaded for one Discussion and used
for transcription, speaker separation, and DSE analysis.
_Avoid_: Voice Reference, confirmation clip, transcript

**Voice Reference**:
A short, temporary fallback recording made for one participant in one
Discussion and used only to compare that participant with Formal Discussion
speech. It is optional and is not part of normal Session setup.
_Avoid_: Reusable Voiceprint, formal answer, account identity

**Reusable Voiceprint**:
A Tencent-held voice template created from one explicit enrolment recording and
reused to propose Speaker matches. A VIP Reusable Voiceprint belongs to the
student account; a Guest Reusable Voiceprint belongs only to that Discussion's
Guest Participant.
_Avoid_: Voice Reference, legal identity, raw voice recording

**Voiceprint Enrolment**:
The consented act of creating or replacing one Reusable Voiceprint from a short
fixed-passage recording made by the student or in the teacher's presence.
_Avoid_: Voice Confirmation, Voice Match, Discussion recording

**Speaker Track**:
One stable diarized voice cluster from a Formal Discussion Recording. It keeps
an anonymous Speaker label until a permitted voice confirmation makes a name
eligible for display.
_Avoid_: Candidate, student, voice sample

**Non-Candidate Voice**:
A Speaker Track that is too brief, unreliable, incidental, or outside the six
strongest eligible tracks. Identity matching is not required for Candidate
status. A Non-Candidate Voice may remain as marked context but is excluded from
Candidate scoring.
_Avoid_: Failed Candidate, Guest Participant, low-scoring speaker

**Voice Match**:
The current one-to-one association between a participant and a Speaker Track,
proposed from a Reusable Voiceprint or Voice Reference and replaceable by a teacher.
_Avoid_: Account verification, legal identity, permanent voice recognition

**Voice Confirmation**:
A VIP Participant's acceptance of their own Voice Match, or a teacher's
authoritative lock of that match. It controls name display but does not change
the underlying transcript or speaker analysis.
_Avoid_: Invitation acceptance, Voice Reference, report approval

**Discussion Report**:
A versioned DSE Group Interaction analysis whose evidence remains attached to
stable Speaker Tracks even when names or Voice Matches change.
_Avoid_: Official DSE score, transcript, shared link

**Student Share Snapshot**:
A fixed, expiring external projection created by a voice-confirmed VIP
Participant. It identifies only that sharing participant and keeps every other
participant anonymous.
_Avoid_: Live report, invitation link, authenticated report

**Intensive Listening Library**:
An authenticated student catalog backed by visible sets plus live private
materials. Cards expose source metadata, Completion progress, one optional
linked practice exercise, and a safe same-origin return; transcript units,
answers, and timing remain server-only.
_Avoid_: Public transcript catalog, ordinary Library tab, or local progress as
the authority.

**Teacher Share Snapshot**:
A fixed, expiring external projection whose content and per-participant name
visibility are selected by a teacher at creation time.
_Avoid_: Live teacher report, public report, Student Share Snapshot
