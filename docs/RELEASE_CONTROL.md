# Scoped release control

Use this entry for the project's owner-authorized `.cloudbase-private/<package>/publish.cjs`
releases. It wraps existing publishers without changing their frozen patches,
transaction checks, immutable assets or receipt contracts. The GitHub CI deployment
path remains separate. Never upload the accumulated local HTML or dist snapshot.

```sh
npm run release:status -- vocabulary-source-back-20261106
npm run release:preflight
# Add --database for a publisher that reads/writes CloudBase documents:
npm run release:preflight -- --database
# Read-only check against a static-file receipt:
npm run release:verify -- vocabulary-source-back-20261106
# Only after owner authorization and scoped package preparation:
npm run release:run -- PACKAGE_NAME
npm run release:run -- PACKAGE_NAME --database
```

All paths resolve from the script's repository, including when invoked by absolute
path from another working directory. `status` without a name inventories immediate
package folders only; nested offline fixtures are never promoted to production evidence.

## What each result means

- `receipt-present`: the package has a root receipt from a previous execution.
  Inspect its contents and the latest attempt. This is not current live verification.
- `no-receipt` / `prepared-or-partial`: no completion is established. Inspect the
  package's saved plan, guards and readbacks before deciding whether to resume.
- `blocked-before-publisher`: preflight failed; this invocation never started the publisher.
- `failed-or-partial-needs-readback`: the publisher started but did not establish
  completion. Remote writes may have happened; timeout does not mean rollback.
- `publisher-completed-with-receipt`: this execution exited successfully and produced
  a new parseable receipt. Completion semantics still belong to the scoped publisher.

`verify` supports `files[]` / `objects[]` with `key` and SHA-256, checks both public
domains, and saves a timestamped verification result tied to the receipt hash.
It does not verify database state, browser behavior, or dependencies not listed in
those arrays. Audio/database receipts without that schema explicitly require the
package's own read-only verifier. A hash difference may mean a newer release, not
a broken deployment. Do not rerun an old publisher to force old hashes back online.

## Preflight and recovery

Preflight checks existing CLI credential presence/expiry, DNS, public HTTP, an
authenticated COS HEAD of index.html, and optionally a read of one sets document
(discarded without logging content). Every probe runs in a subprocess with a
15-second hard deadline; network requests also have shorter internal deadlines.
Expired credentials get one non-interactive `tcb env list --json` refresh with a
10-second deadline. Missing credentials or failed refresh need `tcb login`.
No secrets, response bodies or student data are printed. Read permission does not
prove write permission; only the scoped publisher can establish its actual outcome.

On a sandbox DNS/network failure, the Agent must request the existing sandbox
escalation mechanism for this same read-only preflight. Do not disable security or
change machine DNS/proxy settings as a guess. If the tool invocation never returns,
the command's own timeout may never have started: distinguish tool execution from
an observed network error. Do not claim that this script fixes the app's executor.

The runner keeps a repository-wide exclusive lock for cooperating scoped releases,
prints a heartbeat every 30 seconds, and terminates the publisher's process group
after ten minutes. It records attempts under `<package>/control-attempts/` and the
latest summary in `release-control-state.json`; it never overwrites receipt.json.
SIGINT/SIGTERM are recorded as interrupted, potentially partial attempts. A forced
kill of the runner can leave `release-control.lock`; inspect its PID and any remaining
publisher before manually clearing a stale lock. Never remove an active lock.
Direct legacy commands and other machines do not honor this local lock; the original
publishers' concurrency guards remain essential.

An existing receipt blocks `run` by default. After inspecting live state, a scoped,
already-authorized retry may use `--resume`. The runner never automatically retries
remote mutations. It requires a changed receipt on successful resume, so a stale
receipt cannot turn a failed/no-op process into a new success claim.

For new publisher implementations, use explicit stage names and errors containing
target ID plus expected/actual record counts. Validate target identity before preparing
media. CloudBase transactions must use supported document reads/writes; do not use
transaction `.where()`. Never weaken missing/duplicate/concurrent-change guards.

Validation: `npm run test:release-control` exercises failure-before-write, partial
write, successful completion, stale receipts, login refresh, timeouts and locking
using temporary local fixtures. It makes no production calls.
