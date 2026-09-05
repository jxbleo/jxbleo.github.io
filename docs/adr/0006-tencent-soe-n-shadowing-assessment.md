# ADR 0006: Isolated Tencent SOE-N assessment for Listening Shadowing

## Status

Accepted for the local Listening V2 vertical slice; production enablement is
owner-gated.

## Context

Shadowing needs a pronunciation signal, while the existing Dictation grader is
text/slot based. The provider protocol, credentials, raw audio retention, and
cost boundary must not enter browser code or alter immutable Dictation history.

## Decision

Use one server-only `tencent-soe-n.js` adapter. It signs the Tencent WebSocket
request, pins the approved `16k_en`/evaluation parameters, normalizes provider
words and scores, and classifies failures. The gateway reserves one private take,
validates mono 16 kHz 16-bit WAV, writes one usage row exactly before the
outbound request, and never retries an ambiguous post-send outcome. Product
scoring is integer 0–100 with pass at 80; any red word caps the score at 79.
Transcript/reference words are withheld until complete-play reveal and raw valid
audio is cleaned within seven days by a timer-token-gated maintenance function.

## Consequences

The feature can fail closed without exposing a fake production score. Provider
fixtures are injected into automated tests and cannot be selected by a browser.
The owner must approve the policy, configure credentials, create ADMINONLY
collections/indexes, benchmark quality/cost, and run real-device smoke tests
before enabling production scoring.
