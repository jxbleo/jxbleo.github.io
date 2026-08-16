# Keep Intensive Listening Answers Behind Server Checks

Intensive Listening preloads the full public exercise structure and audio, but
keeps reviewed words and accepted variants in `ADMINONLY` data. Each `Enter`
check sends one unit's slots to an authenticated CloudBase action, which returns
only positional correctness; the three-second Start Ritual prewarms that action,
non-critical telemetry syncs asynchronously, and a failed check preserves every
local entry. This accepts a measurable network round trip at check time rather
than exposing the answer set for offline browser grading; weak-network and cold-
start latency must therefore pass prototype testing before release.
