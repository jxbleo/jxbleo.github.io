# ADR 0005: Reusable Tencent voiceprints with scoped Guest identity

Status: Accepted
Date: 2026-08-27

DSE Speaking Lab may register a reusable Tencent ASR voiceprint after explicit
consent because the per-Discussion recording ritual adds avoidable friction and
Tencent's per-check cost is low. A VIP voiceprint is keyed to the authenticated
student UID and may be reused across Discussions; a Guest voiceprint is keyed
only to that Discussion's Guest Participant and never becomes a Guest account or
cross-Discussion identity. Mr. Cat Academy retains only the private Tencent
`VoicePrintId`, scope, consent source, revision, and audit metadata—not the
enrolment audio or a biometric embedding. Temporary Voice References remain a
fallback, student confirmation and teacher override remain mandatory identity
safeguards, and server-built share-snapshot redaction from ADR 0004 is unchanged.
