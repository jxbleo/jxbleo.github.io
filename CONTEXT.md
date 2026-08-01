# Mr. Cat Academy Domain Language

This glossary defines the shared product language for Mr. Cat Academy. It
describes domain concepts only; implementation rules belong in the numbered
project documentation.

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
