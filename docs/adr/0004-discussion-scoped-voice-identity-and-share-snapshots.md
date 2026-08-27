# ADR 0004: Discussion-scoped voice identity and server-built share snapshots

Status: Accepted
Date: 2026-08-27

DSE Speaking Lab deliberately avoids a permanent student voiceprint: every
Discussion uses new Voice References, deletes those references seven days after
successful matching, and keeps only the current participant-to-Speaker mapping
and its audit history. External sharing is also a server-side projection rather
than a live report URL: a Student Share Snapshot may identify only its confirmed
VIP creator, while a Teacher Share Snapshot exposes only the content and names
selected by the teacher. This costs more per Discussion and requires snapshot
invalidation after identity corrections, but it limits biometric retention,
prevents a report locator from becoming authorization, and makes privacy rules
enforceable outside browser presentation code.
