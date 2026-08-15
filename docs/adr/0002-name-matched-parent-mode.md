# Use Name-Matched, Read-Only Parent Mode Instead of Parent Accounts

Parent Mode deliberately accepts one active student's exact Chinese-and-English
name pair as its entry proof and issues a seven-day read-only session rather
than creating guardian accounts or verified family bindings. That session may
show the child's detailed submitted learning and classmates' task Best Scores,
but never permits learning actions or exposes classmates' answers, attempts, or
wrong-question details. This prioritizes a near-zero-friction family experience
while accepting that names are weaker proof than an authenticated guardian
identity; server-side rate limiting, narrow projections, and short-lived opaque
sessions contain that trade-off.

The browser establishes an invisible CloudBase anonymous identity solely to
satisfy the Web SDK transport requirement. That identity is not a Parent Mode
account and grants no access to other cloud functions; the environment security
rule keeps the authenticated, non-anonymous wildcard and permits only
`parentMode` as an exception.
