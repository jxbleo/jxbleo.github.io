# Agent QA To Do List

## Completed — DSE contact icons and mobile hand-off (2026-10-16)

All 23 handouts show four icon-only contacts; Video Channels is removed. Mobile search icons attempt their apps with explicit HTTPS fallback. Scoped publication and source/build/runtime checks passed. Real installed-app iPhone/Android confirmation remains a verification limit; see the current deployment record.

## Completed — DSE WeChat contact (2026-10-16)

All 23 handouts now copy the owner WeChat ID `jxbleo_` from the new header control. Scoped publication/readbacks, responsive UI and handout/build checks passed; source artifacts match live bytes. Existing share links remain valid. See the current deployment record.

## 2026-10-16 — Cat/social toolbar completed

Published all 23 handouts with restored cat, improved typography and platform/contact entries. 23 COS and 46 public checks passed. Desktop/390px/320px QA and handout tests passed; third-party login/results are platform-controlled. Stable links retained, no backend action needed. See latest deployment record.

## 2026-10-16 — DSE student header follow-up completed

Published all 23 handout header/action changes and five reader scripts with stable addresses; 28 COS readbacks and 66 public checks passed. Scoped source, tests and documentation updated. Desktop/mobile reader checks passed locally; final live screenshot automation timed out. Refresh existing links. See `docs/10_DEPLOYMENT.md` and ignored `.cloudbase-private/handout-header-release-20261016/`. No remaining owner action or backend deployment.

## 2026-10-16 — Independent DSE handouts published

Owner continued the prepared cutover. Published 23 independent pages plus 12 dedicated assets, then the three Teacher integration/catalog objects. All 38 COS readbacks and 76 public SHA-256 checks across apex/www matched the frozen release. Eight existing predictable handout/alias objects were backed up and removed; all nine retired policy paths return a non-content response on both domains (18 checks). No matching DSE plaintext source objects existed under the old study-guides prefix. No unrelated live object was synchronized or removed.

Deployed only `teacherHandoutLinks` (Node.js 18, 256 MB, 10 seconds). The function is Active, and its three packaged core files match the reviewed ZIP. Two live unauthenticated/spoofed-identity requests were denied without returning the directory. No collection, student record, other function, model, billing or permission setting changed. Configured both handout CI secrets without printing their values. Private stage, backups and receipts live in `.cloudbase-private/handout-cutover-20261016/`.

The source release uses an isolated worktree based on the verified remote main, removes four previously tracked plaintext/alias files, and includes only the handout implementation plus the necessary Teacher directory entry. It uses `[skip ci]` because current production also contains unrelated scoped releases not yet reconciled to main; do not run a full-site COS sync from this older source baseline. GitHub Pages uses legacy main/root publication; its settings and repository visibility stay unchanged. Previously public Git history and third-party saved copies remain outside URL retirement.

The isolated source passed `verify:release`, the full `test:release`, build and both real-artifact boundary checks. A dedicated Teacher UI contract test runs independently of unrelated classroom/RE fixtures. Existing local desktop/mobile and actual copy/paste checks remain valid. This production browser automation timed out while the Mac was locked; authenticated live Teacher UI interaction and native print pagination are not certified. Live file delivery and unauthorized access denial were verified independently.

The local owner share list now reads an ignored `publication.json` receipt, matching map/source digests before displaying a published status. It still never becomes a public index. The active Teacher directory is the regular place to copy individual share links.


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
