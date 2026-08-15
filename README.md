# Mr. Cat Academy

Mr. Cat Academy is a small teaching web application for English learning. It
combines a static website with Tencent CloudBase backend functions so the
teacher can assign practice, students can submit work, and the system can keep
countable attempt history.

The project is still in an early but usable stage. Backend rules and data
boundaries matter more than visual polish right now.

## What It Does

- Student login and visitor browsing
- Visitor previews plus authenticated delivery of protected reference reports
- Student dashboard with assigned work and finished work
- Teacher page for student management, assignment, library preview, and Argue
- Shared practice runtimes for BBC, IELTS Reading, IELTS Listening, and
  Vocabulary
- Server-side grading through CloudBase functions
- Immutable countable attempts
- Near-real-time private teacher attempt emails: BBC retries batch for seven
  minutes, while every recorded Vocabulary Quiz/Timed Practice sends promptly
  with cumulative thread history; Teacher Personal Center controls which of up
  to ten private BCC inboxes are enabled
- Protected STAR/mastery records
- Yellow-STAR Cash requests with private evidence and teacher confirmation
- Dedicated personal My Words workspace with editing, Notes, merge suggestions,
  responsive word browsing, Excel/PDF export, and a teacher-reviewed shared
  dictionary fallback
- Weekly and monthly class learning reports: one authenticated shared link shows
  the class leaderboard while each family sees only its own learner's details

## Current Stack

| Layer | Current choice |
| --- | --- |
| Frontend | Static HTML, CSS, vanilla JavaScript |
| Hosting | Tencent COS static website; GitHub `main` is the source of truth |
| Backend | Tencent CloudBase cloud functions |
| Auth | CloudBase username/password Authentication |
| Database | CloudBase database collections with `ADMINONLY` permissions |
| Runtime content | Public JSON under `data/` and metadata under `content/` |
| Private grading data | CloudBase `grading_keys` generated from local private sources |
| Function runtime | Node.js 18 |
| Scheduled reports | CloudBase timer invokes a trusted report-generation function |

`npm run build:static` creates the public-only `dist/` release artifact. It is
an allowlist copy step rather than a bundler: Cloud functions, scripts,
documentation, and private local files are never published with the website.

## Local Run

From the repository root:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/index.html
```

Use a local HTTP server instead of `file://` when testing pages that fetch JSON,
audio, or JS fallback data.

## Common Commands

```bash
npm run verify:release
npm run test:assignment-schedule
npm run test:content-editions
npm run test:my-words
npm run test:learning-reports
npm run test:attempt-emails
npm run package:functions:all
npm run release:plan
node scripts/build-home-catalog.js
node scripts/prepare-cloudbase-data.js
git diff --check
```

`scripts/prepare-cloudbase-data.js` writes ignored private output under
`.cloudbase-private/`. Do not commit that directory.

The release scripts are owner-gated. They verify, package, and generate a local
deploy plan, but they do not log in to CloudBase or deploy anything.

## Deploy

Static site deployment and CloudBase deployment are separate:

- Static files: commit and push HTML/CSS/JS/data/audio changes. GitHub Actions
  builds `dist/` and incrementally synchronizes it to Tencent COS.
- Cloud functions: edit `cloudfunctions/<name>/`, rebuild the matching ZIP in
  `deploy-packages/`, then upload it in the CloudBase console.
- CloudBase data: run `node scripts/prepare-cloudbase-data.js`, then dry-run
  and apply the owner-only CLI import with
  `npm run cloudbase:import:content` and
  `npm run cloudbase:import:content -- --apply`.
- Owner-gated helper: run `npm run release:plan` to create
  `.cloudbase-private/deploy-plan.md` for review.

Learning-report releases additionally require the owner to create the three
new `ADMINONLY` collections and their indexes, configure the CloudBase timer,
and deploy the matching report functions. The static `reports.html` page alone
does not generate or authorize reports.

See [docs/10_DEPLOYMENT.md](docs/10_DEPLOYMENT.md) before deploying backend or
data changes.

## Main Directories

| Path | Purpose |
| --- | --- |
| `cloudfunctions/` | CloudBase function source, including scheduled private teacher-email dispatch |
| `deploy-packages/` | Generated function ZIPs for manual upload |
| `assets/js/` | Shared browser logic |
| `assets/css/` | Shared styling |
| `content/` | Canonical metadata and some source content |
| `data/` | Browser-readable runtime data and generated catalog |
| `scripts/` | Content import, catalog build, private CloudBase data preparation |
| `docs/` | Product, architecture, data, testing, and maintenance documents |

## Documentation Map

Read these first when taking over the project:

- [AGENTS.md](AGENTS.md): binding rules for coding agents
- [docs/01_PRODUCT_REQUIREMENTS.md](docs/01_PRODUCT_REQUIREMENTS.md): product
  goal, user roles, business rules, and high-level backend behavior
- [docs/02_ARCHITECTURE.md](docs/02_ARCHITECTURE.md): technical architecture
  and data flow
- [docs/04_DATA_MODEL.md](docs/04_DATA_MODEL.md): CloudBase collections,
  fields, statuses, and ownership rules
- [docs/11_AGENT_TROUBLESHOOTING.md](docs/11_AGENT_TROUBLESHOOTING.md):
  repeated technical issues and fast diagnosis notes

Supporting docs:

- [CONTEXT.md](CONTEXT.md): shared product language and domain terms
- [docs/03_UI_UX_SPEC.md](docs/03_UI_UX_SPEC.md)
- [docs/05_CHANGELOG.md](docs/05_CHANGELOG.md)
- [docs/06_DECISIONS.md](docs/06_DECISIONS.md)
- [docs/07_TESTING_CHECKLIST.md](docs/07_TESTING_CHECKLIST.md)
- [docs/08_BACKLOG.md](docs/08_BACKLOG.md)
- [docs/09_CONTENT_WORKFLOW.md](docs/09_CONTENT_WORKFLOW.md)
- [docs/10_DEPLOYMENT.md](docs/10_DEPLOYMENT.md)

## Documentation Rule

When code changes product behavior, architecture, UI, data fields, deployment,
or testing expectations, update the matching document in the same change.
Important product or architecture changes also belong in
[docs/05_CHANGELOG.md](docs/05_CHANGELOG.md).

## Current Status

The project is a focused lightweight LMS, not just a static exercise site. The
most important backend principles are:

- Cloud functions are the trusted backend boundary.
- Browser code must not decide identity, ownership, scoring, or teacher access.
- Attempts are immutable history.
- Assignment and STAR progress should be monotonic.
- Correct answers and explanations belong in private CloudBase grading data,
  not public runtime JSON.
- Learning-report scope, membership, ranking, snapshots, and access decisions
  are server-derived; a shared report link is not a public data endpoint.

Known technical risks are tracked in [docs/08_BACKLOG.md](docs/08_BACKLOG.md)
and [docs/11_AGENT_TROUBLESHOOTING.md](docs/11_AGENT_TROUBLESHOOTING.md).
