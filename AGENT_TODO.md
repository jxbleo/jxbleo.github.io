# Agent QA To Do List

Current status: source reconciliation and primary-checkout cleanup, 2026-10-04.
Past release notes and superseded local-only states are preserved in
[the QA archive](docs/archive/AGENT_TODO_THROUGH_20261002.md).
Use [08 Backlog](docs/08_BACKLOG.md) for product debt and
[10 Deployment](docs/10_DEPLOYMENT.md) for release boundaries.

## Current follow-up

- The original project directory now runs `codex/project-cleanup-oct03` normally.
  Stale rebase bookkeeping was ended with `--quit`; no commits were replayed or
  reset. Previous main/HEAD refs and all dirty/untracked work remain recoverable.
- Unshipped drafts are in ignored `.cloudbase-private/cleanup-20261004/`.
  Read `README.txt` and `remaining-drafts.json`; `restore-drafts.py` recreates
  the old editable checkout in a new path. Review individual changes before
  restoring them; do not replace the current tree wholesale with the old one.
- BBC/Vocabulary unused-result cleanup was published on 2026-10-04 after a fresh
  132-path public check. Only two HTML objects and their unused crown image were
  changed in COS. Public readback hashes match; source synchronization skips CI
  to preserve the independently verified scoped release. Cloud-function sources
  include recent local implementation; fresh live package/config verification
  is still required before any separately authorized backend release.
- Keep the remaining due-week repair/compatibility paths. The last recorded
  September audit is historical evidence, not a fresh count or authorization
  to modify assignments. Preserve source-less rows and all immutable history.
- Native iPhone/iPad microphone, keyboard and real email/WeChat delivery checks
  remain manual acceptance items. Offline test success does not prove delivery.
- Review duplicate CloudBase content and retained unmerged worktrees only in
  their own scoped tasks. Do not delete private sources or production records.

## Recording new work

Keep this file limited to actionable, current QA items. Record completed work
in `docs/05_CHANGELOG.md`; retain lengthy release evidence under `docs/archive/`
or ignored private evidence directories. Never paste credentials or student data.

## Local QA Credentials

Automated login tests may read credentials from `.qa-secrets.local` when that
file exists on this machine. The file is ignored by Git. Use only dedicated
development test accounts, never the owner's real teacher account or a real
student account.

Future agents should look for the test-login setup in the repository root:

- Local file: `.qa-secrets.local` (ignored by Git; do not print values)
- Template file: `.qa-secrets.example`
- Keys: `MR_CAT_TEST_BASE_URL`, `MR_CAT_TEST_TEACHER_ID`,
  `MR_CAT_TEST_TEACHER_PASSWORD`, `MR_CAT_TEST_STUDENT_ID`,
  `MR_CAT_TEST_STUDENT_PASSWORD`

Useful search command:

```bash
rg -n "MR_CAT_TEST|qa-secrets|TEST_TEACHER|TEST_STUDENT" -S . .gitignore AGENTS.md AGENT_TODO.md
```

Create it from `.qa-secrets.example` and fill in local values:

```bash
cp .qa-secrets.example .qa-secrets.local
```
