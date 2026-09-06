# Changelog

## 2026-09-06 — Dashboard My Words direct add and Scan modal

- Split the Dashboard My Words preview header into a direct manual-entry `+`
  and a separate camera action, both with 44px touch targets.
- Added a required word-or-phrase field plus an optional 320-character Context
  sentence; saving retains the Context and starts normal dictionary enrichment.
- Opened the shared Scan Words flow in an independent centred Dashboard modal
  without navigating into My Words, restoring the preview on close and
  refreshing it after successful scanned-word commits.

## 2026-09-06 — Discard empty Individual Response drafts

- Deferred Individual Response database creation from question-open to the
  student's explicit `Upload & analyse` action.
- Made closing an interrupted pre-upload session discard any server row created
  during that upload attempt through a transactional empty-state recheck, while
  preserving every uploaded recording and every response with related work.
- Excluded legacy rows with no audio, analysis work, or report from student and
  teacher history lists so blank Part B cards cannot return.

## 2026-09-06 — Collapsible Part B history groups

- Kept Individual Response attempts grouped by Set while collapsing every Set
  by default to reduce sidebar density.
- Made the full Set summary an accessible disclosure control with response
  count, rotating chevron, immediate press feedback, and independently
  expandable question rows.

## 2026-09-06 — Refine Speaking Set identity and reading controls

- Restored one blue `year · Set number` identity line above the selected Set
  title without restoring source/type notes or duplicate badges.
- Extended the independent three-step text-size control to Part B and removed
  the Context original-material/source note from student rendering.
- Simplified Choose-a-Set cards by removing both `DSE Paper 4` and the redundant
  Context/Part A/Part B route row.

## 2026-09-06 — Simplify Set identity and add reading-size controls

- Reduced every selected Speaking Set overview card to its title by removing
  the secondary year/type/Set-number line and source note.
- Added independent, accessible minus/plus text-size controls to Context and
  Part A with three bounded reading sizes and clear disabled endpoints.
- Kept Part B unchanged and protected the centred section labels on narrow
  phone layouts.

## 2026-09-06 — Compact colored Dashboard workspace cards

- Matched each workspace title to its blue, teal, or orange card identity and
  increased the title size without changing the concise purpose copy.
- Reduced desktop and phone card height and vertical padding while preserving
  the right-side icons, the same-line Paper 4 capsule, and a comfortable tap
  target at 320px and wider.

## 2026-09-06 — Dashboard learning-workspace identities

- Renamed the three student Dashboard entrances to `Writing Space`, `Listening
  Studio`, and `Speaking Lab`, with concise purpose copy covering grammar and
  language, listening plus Shadowing, and DSE speaking feedback.
- Replaced the large `写`, `听`, and `说` identifiers with restrained
  rounded-square notebook-and-pen, headphones-and-waveform, and microphone
  icons while preserving their existing right-side phone position.
- Added a compact same-line `HKDSE Paper 4` capsule to Speaking Lab and kept the
  complete card responsive at 320px and wider.

## 2026-09-06 — Sidebar title-edit mode

- Removed the title pencil from the Writing toolbar so long titles can travel
  through the full safe width and fade cleanly at both action boundaries.
- Added one pencil beside New in the Writing sidebar; it toggles a restrained
  staggered title-shake mode in which selecting a title opens that writing's
  existing edit dialog without navigating into it.
- Added a static green alternative for Reduced Motion and regression coverage for
  title targeting, focus restoration, modal saving, and ordinary row navigation.

## 2026-09-06 — Dashboard My Words add entry

- Moved the primary add entry into the Dashboard My Words preview as a 44px
  upper-right `+` with two focused choices: `Direct Input` and `Scan`.
- Kept direct word/phrase entry inside the preview, including validation,
  immediate list refresh, and the existing automatic dictionary enrichment.
- Routed Scan into the complete My Words workspace and automatically opened the
  existing Scan Words surface there instead of duplicating its state on the
  Dashboard.
- Removed the preview's `My Words`, saved-total, `Recently saved`, and remaining
  `more words` fields while retaining the recent-word rows and `Open My Words`.

## 2026-09-06 — Simplify the pre-recording Discussion surface

- Reduced a newly created Discussion to one compact three-step progress card
  followed by the existing recording/upload card.
- Removed the duplicated title/date hero, status fact grid, prompt, and
  pre-analysis Candidate section while preserving the complete recording,
  review, and secure-upload flow.
- Kept queued/processing and completed report surfaces unchanged.

## 2026-09-06 — Group Part B history by Speaking Set

- Replaced the flat Individual Response history with one compact card per
  stable Speaking Set.
- Kept Q1, Q5, and any repeated attempts as separate selectable rows inside the
  matching Set card, preserving newest-first server order without overwriting
  response history.
- Added snapshot-based Set labels, question excerpts, dates, and analysis-state
  cues while keeping the mobile drawer compact and accessible.

## 2026-09-06 — Reliable full-screen Group recording surface

- Moved the live Group Discussion recorder into a temporary body-level portal
  for Requesting, Countdown, Recording, Ending, and Stopping states.
- Prevented filtered, overflow-hidden Discussion cards from becoming the fixed
  recorder's containing block and clipping it outside the current phone view.
- Restored the same recorder node and its event listeners to the original card
  on review, cancellation, permission failure, recorder failure, and completion.

## 2026-09-05 — Assign class members by default

- Made the Teacher Assign student picker automatically select every currently
  assignable member when a specific class is chosen, while preserving existing
  selections and individual removal controls.
- Kept the `All` filter non-selecting and refreshed the Teacher script cache
  version.

## 2026-09-05 — Compact fixed Scan Words selection drawer

- Stopped the Scan Words selected-candidate drawer from growing with long
  articles or large selections; candidates now scroll inside a fixed-height
  drawer while the OCR text remains visible.
- Reduced selected-word, Context, spacing, and Remove-control sizes while
  preserving touch-friendly actions, the fixed count header, and Add action.
- Kept the drawer compact when empty and made its existing count toggle collapse
  the complete drawer height as well as the internal list.

## 2026-09-05 — Group recording level guidance

- Replaced the dark full-screen Group Discussion recorder with a light,
  Apple-style ambient surface and a more legible live waveform.
- Fixed both opening and final countdown numbers to the visual viewport centre
  across phone, tablet, and desktop browser heights.
- Added smoothed full-screen quiet, suitable, too-loud, and microphone-signal
  states with matching plain-language guidance, while retaining delayed quality
  warnings to avoid reacting to brief pauses.
## 2026-09-04 — Centred Speaking dialogs on phones

- Replaced the phone-only bottom-sheet treatment with one viewport-centred
  layout for every Speaking Lab dialog, including the Individual Response
  recorder and Dashboard-return confirmation.
- Added dynamic-viewport height limits, safe-area-aware equal inline gutters,
  internal momentum scrolling, complete rounded corners, and retained sticky
  actions for long dialog content.
- Removed the mobile sheet grabber and added regression coverage preventing
  bottom anchoring from returning.

## 2026-09-03 — Individual Response report-index repair

- Replaced the production `speaking_reports` unique
  `discussion_id + report_version` index with a session-aware
  `discussion_id + response_session_id + report_version` index.
- Prevented separate first-revision Individual Responses from colliding on the
  shared `{ discussion_id: null, report_version: response-r1 }` key while
  retaining uniqueness for both Group Discussion and Individual Response
  reports.
- Requeued the affected failed IR job against its existing uploaded audio and
  completed Tencent ASR task; the report reached `ready` without re-recording.

## 2026-09-02 — Natural Student task-list scrolling

- Made To-Do, Finished, and Teacher Replies independently scrollable while the
  shared tab controls stay fixed and each tab retains its own position.
- Replaced Teacher Replies' resisted scroll-past-bottom gesture with native
  edge pagination that appends five older cards without blocking wheel,
  trackpad, or touch movement.
- Added focused regression coverage and refreshed Dashboard static asset
  versions.

## 2026-09-02 — Draft and Revised word counts

- Added a quiet bottom-right word count to the full-manuscript card, including the
  in-progress Draft-only state.
- Made the count follow the active Draft/Revised version, reconstructing Revised from
  persisted accepted student rewrites without another AI request.
- Kept counting aligned with the backend Writing token rule and added focused regression
  coverage plus refreshed static asset versions.

## 2026-09-02 — My Words Scan photo intake and progress redesign

- Rebuilt Scan Words photo intake around the Writing flow's familiar single
  `Add Photos` card and bottom source sheet for camera, library, and cancel.
- Replaced the thumbnail-button layout with one large current-photo preview,
  page navigation, remove, replace, add-photo, and an explicit five-photo count
  while retaining desktop drop and the existing preparation tools.
- Added a dedicated OCR-in-progress surface with an animated scanner, real
  completed-page progress, and remaining-page status instead of an empty Review.
- Added a successful-scan guide above the OCR result explaining tap-to-add and
  long-press phrase selection, including non-adjacent words in one sentence.
- Unified the flow with My Words green surfaces, responsive controls, accessible
  focus treatment, Reduced Motion, and Reduced Transparency behavior.

## 2026-09-01 — Immersive Speaking Discussion recording

- Made `Start Discussion` create and open the Set-backed Discussion directly, removing the redundant New Session dialog, inner `Discussions` controls, and student `Invite VIP` / `Add Non-VIP` controls.
- Added a server-backed Audio date beside existing-file selection; device recording resets it to the current Shanghai date.
- Rebuilt Group Discussion capture as a full-viewport microphone-level waveform with Chinese TTS, a five-second audible/visible opening countdown, and an automatic five-second ending alarm. An eight-minute target now stops at 8:05.
- Added reduced-motion/transparency/contrast fallbacks, focused frontend/backend contracts, and new static cache versions.

## 2026-09-01 — Speaking history states, sorting, and report unread markers

- Labelled the drawer actions `Voiceprint` and `Start New`, removed Candidate
  and status pills from Part A history, and added restrained state icons for
  processing, ready, failed, not-uploaded, and future practised states.
- Added a Filter-controlled date order with upload-time tie-breaking for
  multiple Discussions on the same date; statuses never override the chosen
  order.
- Added per-student, per-report-version unread acknowledgements. Ready reports
  show a red title dot and contribute to the toolbar dot until the report is
  successfully rendered, persist across devices, and become unread again only
  when a new report version is generated.

## 2026-08-31 — Writing Back confirmation boundary

- Removed the confirmation step when Back moves from a Composition to Writing Home.
- Kept direct sidebar dismissal and composer collapse, while reserving the leave
  confirmation exclusively for Writing Home to Student Dashboard navigation.
- Preserved the separate Discard confirmation because it permanently deletes eligible
  unsubmitted draft data rather than navigating backward.

## 2026-08-31 — Safari Speaking report width containment

- Constrained the ready Speaking report's grid, cards, and intermediate panels
  to the phone viewport so Safari cannot size the whole report from a long Turn
  tab row.
- Kept Turn navigation independently momentum-scrollable and preserved its
  edge-to-edge sticky presentation without allowing whole-page horizontal pan.
- Added static regression coverage and bumped the Speaking stylesheet/page
  cache versions used by the student and teacher entries.

## 2026-08-31 — Quote-aware Writing sentence boundaries

- Added a deterministic repair layer after English sentence segmentation so punctuation inside balanced straight or curly quotations does not create extra Sentence Revision cards.
- Kept lower-case dialogue tags and connecting clauses after quoted terminal punctuation with their grammatical sentence, while preserving blank-line paragraph boundaries.
- Distinguished quotation marks from possessive apostrophes and measurement marks, and added focused regression coverage for the primary and fallback tokenizers.

## 2026-08-31 — Simplified Speaking sidebar navigation

- Removed the duplicate Home action from the Speaking Lab drawer; the toolbar
  Back control remains the single Dashboard exit and retains its confirmation.
- Kept only the right-aligned Voiceprint and Choose-a-Set buttons in the drawer
  action row, preserving 44px touch targets on phone and desktop.
- Removed the unused Home styles and listener, and bumped the static cache
  versions for the changed Speaking assets.

## 2026-08-31 — Verified GitHub publication fallback

- Added one owner-gated repository publisher that gives ordinary Git Push a
  bounded attempt and uses GitHub's Git Data API only for recognized network
  failures.
- The fallback refuses dirty or divergent worktrees, serializes GitHub write
  requests, verifies every changed Blob SHA and the complete final Tree SHA,
  and updates `main` without force only while its original parent is unchanged.
- After an API publication, the matching commit is reconstructed locally so
  the release worktree and `origin/main` remain ready for the next fast-forward
  release.
- Added focused publisher contract tests and documented the required dry-run,
  Actions, and live-site verification steps.

## 2026-08-31 — Separate Writing Back and sidebar navigation

- Matched Speaking Lab's navigation hierarchy: Writing now keeps a dedicated
  circular Back arrow at the leading edge and the three-line sidebar trigger at
  the far-right edge after the optional title pencil.
- Removed the duplicate Home action from the sidebar. Back closes an open sidebar,
  safely returns a Composition to Writing Home, collapses an expanded local composer,
  or asks before leaving base Writing Home for Dashboard.
- Shortened the Brainstorming placeholders to `Writing prompt` and `Your writing`
  without changing their accessible labels or auto-growing behavior.

## 2026-08-30 — Calendar task-entry confirmation

- Made task capsules inside the Student Achievements calendar keyboard/click
  destinations that reuse the To Do List task-entry confirmation.
- Closing confirmation now restores the same calendar date, scroll position,
  and task focus; entering closes both modal layers before navigation.
- Extended the achievement projection with safe owned-work locators for BBC,
  Vocabulary, and Writing without returning answers or complete attempt data.

## 2026-08-30 — Faster task-entry dismissal

- Reduced the shared task-entry confirmation Close transition to 75% of its
  previous timing across Library, Student assignment lists, and Teacher task
  previews, while preserving the existing path, focus restoration, and scroll
  restoration.
- Kept unrelated modal exits unchanged and applied the same 75% reduction to
  the opacity-only Reduced Motion fallback.

## 2026-08-30 — Speaking Set navigation and complete Part A tasks

- Replaced the toolbar's leading drawer control with a contextual Back button;
  retained Discussion history and invitation notices in a trailing control.
- Added a Dashboard exit confirmation at Speaking home and made nested Speaking
  workspaces return to `Choose a Set`.
- Removed redundant inline Back controls, the Set section-progress strip, and
  01/A/B section tiles; centred the compact Context, Part A, and Part B labels.
- Restored each of the five imported Part A Task statements as structured Set
  data, rendered them before the discussion points, included them in frozen
  Discussion prompts, and exposed them in the teacher Set editor.

## 2026-08-30 — Detailed Speaking turn coaching

- Replaced new Group Discussion turns' single concise CS/IO comment with
  required strength, limitation, improvement, and English sample fields.
- Required every comment to explain evidence, effect, and a usable next action,
  while preserving the mandatory ASR safeguard and the Candidate's intention.
- Added structured student, teacher, and private-share presentation with a
  compatibility path for immutable V2/V3 reports.
- Raised the default bounded model output allowance to 16,000 tokens so a
  normal four-to-six Candidate Discussion can return the expanded JSON.

## 2026-08-30 — Direct report refresh loading

- Replaced the Set-library/list flash on refreshed Discussion links with one
  centred loading spinner followed directly by the requested report.
- Prioritized the target Discussion request after authentication and deferred
  Voiceprint, Set, and sidebar-list hydration until after the report is visible.

## 2026-08-30 — Continuous Speaker transcript cards

- Grouped adjacent ASR segments from the same Speaker into one visible speech
  card in both `Transcriptions` and Turn-by-Turn context.
- Kept original transcript segments unchanged for evidence, scoring, and audit;
  only the student-facing presentation is grouped.

## 2026-08-30 — Dimension and Turn navigation for Speaking reports

- Replaced the four simultaneous student score cards with CS/IO/VL/PD tabs and
  one detailed dimension panel, including phone sticky behavior below the
  Speaking toolbar.
- Versioned new Group Discussion reports so each assessed dimension owns its
  strengths, priority actions, and language suggestions while older immutable
  reports retain a labelled compatibility presentation.
- Reworked Turn-by-turn review into a Turn tab bar plus one selected review,
  with a vertically scrollable full-session context, yellow self highlighting,
  and stronger selected-turn emphasis. The Turn bar takes over the mobile sticky
  edge as its card enters view.
- Moved the complete script into a fifth `Transcriptions` row under Session
  Details and a centred dialog, and removed separate Complete Script/Voice ID
  report cards.

## 2026-08-30 — Simplified Speaking drawer and Voiceprint workspace

- Replaced the student Voiceprint dialog with a dedicated Speaking Lab
  workspace containing only the reading passage, privacy consent, press-and-hold
  microphone, concise feedback, and post-recording upload confirmation.
- Changed Voiceprint capture to begin on press and finish on release, discard
  samples below 10 seconds, retain valid recordings only in browser memory until
  explicit confirmation, and visually distinguish an existing voiceprint's
  update state.
- Moved Voiceprint to an icon beside the Set plus action and reduced the drawer
  to a `Part A` / `Part B` switch plus the existing Discussion or Response cards,
  removing duplicate navigation and `Your Work` headings.

## 2026-08-30 — Student Dashboard Achievements calendar

- Replaced the first Dashboard card's retired weekly progress area with a
  53-week Achievements contribution grid while preserving the greeting and
  motivational line.
- Added date-detail dialogs and completion-only rules: first qualifying BBC or
  Vocabulary participation, and corrected/completed Writing compositions.
- Added a separate authenticated calendar aggregate so year-long history does
  not block the assignment bootstrap; Speaking remains intentionally dormant
  until its correction/practice completion milestone is explicit.
- Fixed the phone detail dialog accidentally inheriting the Teacher sidebar's
  three-column layout. The dialog now keeps its header and Close action visible
  while long task lists scroll independently and respects phone safe areas.
- Replaced the Today animation with a static plum date marker inside the square.
  The number follows the server-provided Shanghai day, Today no longer uses a
  contribution level color or separate legend, and its accessible current-date
  state remains intact.
- Unified the contribution grid with the existing month-calendar surface.
  Clicking any past/today square now opens its month with that exact date
  selected and renders the same achievement projection below; the redundant
  header Calendar button and former compact achievement dialog were removed.

## 2026-08-30 — Full-width BBC audio waveform controls

- Replaced the BBC player's plain percentage rail with a real waveform decoded
  from each lesson's existing MP3, without adding a library or publishing a
  second timing source.
- Added 1×/2×/4×/8×/16×/32×/64× timeline zoom, horizontal inspection,
  pointer/touch seek, keyboard seeking, and a media-time playhead across every
  BBC render theme.
- Moved Play and `-5s` into the zoom toolbar so the waveform occupies the full
  player width, and removed the redundant student name from the time row.
- Kept linked Intensive Listening and worksheet actions side by side at the
  bottom of BBC lesson cards on phones instead of stacking them.
- Kept waveform failure non-blocking and fixed zoomed seeking to map against
  the full waveform width and the native media duration, preventing the prior
  visible-window time drift class.

## 2026-08-30 — Complete Teacher Speaking group reports

- Changed Teacher Speaking to load every Discussion through backend pagination
  and label ready rows as full reports.
- Expanded a teacher report from a summary into group analysis, every
  Candidate's CS/IO/VL/PD detail, all turn-by-turn coaching, and the complete
  teacher-visible transcript.
- Added an in-report `Share group report` flow with every Candidate name and
  report section selected by default, while preserving optional name and
  content redaction before the seven-day private snapshot is created.

## 2026-08-29 — Center Speaking modals on phones

- Overrode the browser's native mobile `dialog` maximum width and restored
  equal horizontal auto margins, keeping every Speaking modal bottom-aligned
  with matching 12px left and right insets.

## 2026-08-29 — Separate Speaking upload and student report surfaces

- Split the student Discussion into a preparation/upload phase and a distinct
  post-upload report phase with factual queued/processing progress and retained
  Candidate matching.
- Removed redundant ready-report navigation/status chrome so the completed
  report starts directly with its Discussion information card.
- Moved Candidate names, voice matching, and access actions into a dedicated
  `View Candidates` modal parallel to the existing Set-task modal.
- Replaced the completed report's first card with the selected Option A layout:
  a four-row split ledger for Date, Duration, Candidates, and Task. Candidate
  and Task rows open their independent dialogs, and Student Share now lives in
  the Candidate dialog.
- Added the restrained `SESSION DETAILS` eyebrow above the ledger, matching the
  existing `YOUR ANALYSIS` typography without adding a second heading level.
- Rebuilt the ready report as Discussion details with a modal Set task, the
  signed-in student's CS/IO/VL/PD analysis, and personal turn-by-turn coaching,
  followed by a collapsed complete script with warm-yellow self highlighting.
- Standardized dimension conjunctions to `&`, including the exact VL label
  `Vocabulary & Language Pattern`.
- Kept unconfirmed students from receiving another Candidate's analysis or
  transcript highlight, and kept PD explicitly unassessed.

## 2026-08-29

- Rebuilt the Speaking Lab formal browser recorder as a four-state Ready,
  Recording, Review, and Uploading flow. Removed Pause and competing controls,
  prevented repeated microphone sessions and visibility refreshes from
  replacing active controls, added periodic MediaRecorder data and explicit
  runtime-error handling, made preview a single toggle, retained stable upload
  retry identity, and combined verified upload with automatic analysis start.

- Connected reliable automatic voice matches to a visible student invitation
  inbox. A matched student's Speaking toolbar now shows a restrained message
  marker while invitations are pending; the left drawer highlights each
  matching Discussion, opens the existing confirmation dialog, refreshes
  immediately after accept/decline, and refreshes when the page becomes visible.
  This reuses `speaking_participants` and adds no notification collection.

- Fixed the Speaking Lab drawer's Home control so it uses a native link to the
  authenticated Student Dashboard. The separate `Discussions` control inside a
  selected Discussion continues to restore the Speaking mode-card surface.

- Added an explicit `Search voice matches` action beside the ready Discussion's
  Candidates count. It enqueues a durable voice-only rematch against the latest
  reusable VIP voiceprints, reuses the existing transcript/report, preserves
  confirmed or teacher-locked mappings, resumes across refresh, and invalidates
  external shares only when a new mapping is actually added. The UI shows
  queued/processing/completion/failure states without hiding the ready report.

- Separated the Student Dashboard's Writing, Intensive Listening, and Speaking
  entrances from the welcome hero into three aligned full-width pale-glass
  cards with blue, teal, and orange category washes. Restored visible workspace
  titles and circular `写` / `听` / `说` identifiers, and clarified the Speaking
  destination as HKDSE Paper 4 Group Interaction in both card and confirmation
  copy.

- Removed visible `Opening your writing…` copy from every Writing refresh path while retaining one accessible activity indicator, the single-shell restoration lifecycle, and the existing resolved-stage materialization.

- Rebuilt the Speaking Lab student home around two DSE Paper 4 mode cards:
  active Part A Group Discussion and a Part B Individual Response placeholder,
  followed by the reusable Voiceprint card. Replaced the toolbar back/name
  controls with the Writing-style hamburger and centered title, and moved the
  full Discussion list into an accessible left-side glass drawer. Its header
  now pairs Home with a New Discussion plus button. Fixed the phone closed state
  so the scrim cannot override its hidden attribute, blur the mode cards, or
  intercept their controls; page restoration also resets the drawer closed.
  Escape dismissal, Reduced Motion, Reduced Transparency, and high-contrast
  fallbacks remain. No backend contract or Speaking data flow changed.

- Renamed the Writing Home mode subtitles to `Grammar & Usage` and `Ideas & Structure`, clarified the source-form action hierarchy with a 30/70 low-emphasis Discard versus primary Submit/Scan row, and restored capsule-toolbar takeover in every revision skin by removing the rounded card's sticky-breaking overflow clip while retaining rounded control-row corners.

- Expanded the Writing toolbar title into all safe space between the hamburger and
  right actions, removed the revision percentage, fixed the title pencil at the
  far-right edge, and moved title editing into a readable Apple-style modal with
  keyboard focus containment, Cancel, Save, and inline error feedback.

- Preserved the Sentence Revision card's rounded upper corners in the green skin by clipping the card and rounding its control row, and replaced the skin brush with a recognizable palette SVG while retaining the existing 44px target and accessible labels.

## 2026-08-28

- Aligned the AI Tutor Writing toolbar with Speaking Lab geometry and material: a centered 1080px rounded glass bar now overhangs the centered 980px card column, while phones retain 14px outer gutters and the same translucent perimeter instead of reverting to a full-bleed strip.

- Simplified the in-progress Writing revision card by removing its visible `Sentence Revision` heading, adding an accessible locally persisted skin control beside the font controls, and making the Language Review-inspired green treatment the default while preserving the existing eight-color option. Number navigation now uses true circles and spans the full card width with safe-area-aware edge scrolling.

- Made Speaking Lab Session creation roster-free and moved identity work into
  one Candidates card. Formal audio now determines three-to-six Candidate
  tracks independently, then a private Tencent CI excerpt stage runs 1:N
  reusable-voiceprint matching at score 70 with a 10-point separation rule.
  Reliable VIP matches create invitations automatically; ambiguous, missing,
  or unavailable matches stay anonymous and DSE analysis continues.

- Corrected the Speaking Lab live-recorder disclosure state: Pause, Stop,
  Preview, and Upload recording remain hidden until `Record now` begins; the
  upload action uses an unavailable cursor while no recording exists and a wait
  cursor only during an actual transfer.

- Rebuilt AI Tutor Writing navigation around one responsive title-only sidebar.
  The toolbar now keeps a permanent hamburger, wide screens auto-dock the sidebar
  while retaining manual collapse, phone selection closes the overlay, unfinished
  work precedes newest completed work, and saved rows enter their current stage
  directly. The main area now contains only the existing Polishing/Brainstorming
  composer, with green `Start new Writing` and no home quota display.
- Moved student Composition title editing from individual portfolio rows to a
  compact pencil beside the centered toolbar title. Saving continues through the
  authenticated title action and updates both current and sidebar projections
  without changing activity order.

- Added a restrained interaction cue to already-correct Sentence Revision cards:
  pointer and keyboard activation now give the static card one short shake without
  flipping it, with a tint-only Reduced Motion fallback.

- Replaced Speaking Lab's manual temporary-COS `PUT` with the authenticated
  CloudBase browser upload API. The gateway now reserves one exact private path,
  accepts the SDK-returned file ID only for that path, verifies the real stored
  byte size, and only then marks the recording uploaded. A ten-minute client
  ceiling restores retry instead of leaving `Upload recording` spinning.

- Added evidence-linked turn-by-turn DSE Speaking review. The server now groups
  canonical transcript segments into real speaking turns and requires one
  validated CS and IO coaching item per Candidate turn. Student reports show
  the signed-in Candidate first, quote only server-derived ASR text, and place
  natural English `Try saying` samples beneath CS and IO as VL support. Student
  shares receive only the sharer's turn details; teacher shares have a separate
  turn-review content switch. Legacy reports remain readable without the new
  section.

- Redesigned the student Speaking Lab around the Academy's Apple-inspired
  Liquid Glass language: a calmer home hierarchy, responsive Discussion cards,
  a single-focus detail workspace, explicit three-step progress, grouped roster
  and voice-matching tools, a structured DSE report surface, and mobile bottom
  sheets. Entering a Discussion now withdraws the home surfaces, and explicit
  `[hidden]` handling prevents the list and detail from appearing together.

- Added a mandatory Speaking Lab ASR scoring safeguard: one suspicious,
  low-confidence, or confidence-unknown transcription token can no longer
  directly reduce a Candidate score, become a student criticism/exact
  correction, or support a pronunciation inference. Exact language criticism
  now requires repeated evidence across distinct segments or independently
  unambiguous surrounding syntax; model input carries normalized per-segment
  ASR confidence and an explicit uncertainty status.

- Made the Speaking Lab Bailian/Qwen structured-report adapter explicitly use
  non-thinking mode so the DSE result remains one JSON object in
  `message.content` instead of failing local schema parsing.
- Sent the Qwen output limit as `max_tokens` instead of the OpenAI-specific
  `max_completion_tokens`, preventing long four-candidate reports from being
  truncated by the provider's shorter default limit.
- Added content-free structured-output diagnostics for failed Speaking model
  calls so empty, non-JSON, and truncated responses can be distinguished
  without storing student transcript or model response text.
- Kept strict validation for required Candidate rows, domain scores, and
  same-Speaker evidence while discarding untrusted extra model fields during
  canonical projection. Harmless provider additions no longer reject a whole
  otherwise valid DSE report and are never persisted.
- Split parsed-report structural failures into safe object-level error codes so
  Candidate-array, Candidate-object, Domains-object, and assessed-domain
  failures can be diagnosed without storing model feedback text.
- Canonicalized Qwen's common single-object report wrapper and Speaker-keyed
  Candidate map into the same strict Candidate array before validating counts,
  scores, and same-Speaker evidence.

- Simplified manuscript OCR confirmation: successful `Use first line` now stays
  silent and preserves button focus, the editable manuscript sits directly on the
  yellow paper, and the centered `Confirm` action lives outside the paper below it.
- Extended the Sentence Revision feedback dividers to include the boundary between
  the original Language Review coaching and the first submitted rewrite feedback,
  while retaining the same divider between every later feedback round.
- Removed provider-generated warning bullet lists from student-facing Review Scan
  cards. OCR text, confidence marks, and deterministic sentence-mapping validation
  remain unchanged, while language or spelling observations stay out of this
  transcription-confirmation step.
- Added the environment-gated Tencent recording-file ASR adapter and durable
  submit/poll pipeline for Speaking Lab, including canonical Speaker tracks,
  incidental-voice exclusion, partial transcript preservation, and safe usage
  metadata.
- Added the independent OpenAI-compatible JSON-object DSE report adapter with
  server-only credentials, versioned three-domain prompt, strict local evidence
  validation, and atomic ready-report publication. Pronunciation remains
  explicitly unassessed.
- Kept both expanded Speaking runtime functions below CloudBase's code limit by
  removing only unused CloudBase AI/model and WeChat-client branches at bundle
  time; required SDK paths remain bundled, a 900,000-byte package guard prevents
  regressions, and automatic dependency installation stays disabled.
- Added the current voiceprint enrolment revision and latest Shanghai-time
  update to the Teacher Speaking target card, making successful replacements
  visible without a CloudBase console check.
- Changed the private Speaking AI worker from a timer custom-argument token to
  a strict Tencent timer envelope plus `speakingAiWorker.invoke: false`. This
  matches the current CloudBase trigger editor, keeps browser clients unable to
  invoke the worker, and avoids a secret that function-detail APIs may echo.
- Mapped Tencent ASR CAM authorization failures to the provider-not-configured
  state so students are not incorrectly told to repeat a valid recording.
- Unwrapped CloudBase's nested `getUploadMetadata().data` response in Speaking
  Lab so private MP3 uploads receive the URL, temporary token, authorization,
  CloudBase file ID, and COS file ID expected by the browser uploader.
- Removed redundant concurrent CloudBase login preflights from the authenticated
  Speaking page, then sequenced its initial Voiceprint and Discussion reads to
  avoid concurrent temporary-credential initialization inside the browser SDK.
  Page startup still verifies the student and every Speaking action remains
  server-authorized; bounded read/mutation timeouts prevent an indefinite
  `Loading` state and provide a refresh-and-retry message. A successful empty
  Discussion list now also clears the initial loading label after rendering.

> Product-level and architecture-level changes only.
> Do not record every tiny CSS tweak or variable rename here.

## 2026-08-28 — Unified student To-Do list

- Replaced the Student To Do List's separate `This Week` and `Upcoming` tabs
  with one `TO-DO` tab containing every unfinished teacher assignment, while
  retaining `FINISHED` for completed work.
- Gave the task-list card one responsive fixed height so empty and short lists
  no longer shrink it; longer lists continue scrolling inside the card.

## 2026-08-28 — Muted Dashboard workspace entrances

- Reworked the three hero entrances into pale blue-grey, sage, and warm-sand
  bands that sit quietly within the existing light Dashboard material.
- Removed their visible English category titles, character watermarks, arrows,
  and edge bars; selected a pen, headphones, and microphone as the identifiers.
- Added one-line overflow reveal on phones, a Reduced Motion fallback, more air
  below the top toolbar, and a confirmation step before ordinary navigation.

## 2026-08-28 — Continuous Writing refresh

- Replaced the two-stage Chinese Writing refresh sequence with one stable English
  loading surface and parallel Composition/Profile/History restoration.
- Added one restrained, top-anchored downward materialization for resolved Writing
  content, with an opacity-only Reduced Motion fallback and no artificial delay.

## 2026-08-28 — Draft-style OCR confirmation

- Reused the warm-yellow Draft paper material for OCR text confirmation.
- Moved image comparison into the trailing toolbar slot with reversible
  `Show image` / `Hide image` wording.
- Collapsed first-line title extraction into one reversible control that changes
  from `Use first line` to `Undo` and restores the original manuscript in place.

## 2026-08-28 — Rejected revision return focus

- Changed unsuccessful Sentence Revision checks to return directly to the first
  rejected sentence instead of resetting the review to the top.
- Added the existing Overdue-style red pulse to that card until the student edits
  it, with a static red Reduced Motion fallback.

## 2026-08-28 — Speaking Report anonymous invocation boundary

- Made the external Speaking Report reader establish anonymous CloudBase SDK
  state only when no current login exists, while retaining the expiring raw
  share token as the sole report capability.
- Documented the narrow `speakingLab` gateway exception; all Speaking
  collections remain `ADMINONLY` and every non-public action still performs
  server-side student/teacher authorization.

## 2026-08-28 — Completed Draft feedback hierarchy

- Promoted `AI Feedback` to a centered green dialog title bar with a full-width
  bottom hairline.
- Kept the source sentence directly on the dialog material with its proofreading
  wave instead of nesting it inside a second card.
- Standardized one hairline between the source and initial analysis and between
  every later feedback paragraph, without restoring sentence or round labels.

## 2026-08-27 — Unified light Dashboard hero

- Removed the weekly-progress surface from the Dashboard hero, leaving the
  personalized greeting and motivational sentence as its only header content.
- Moved the three Writing, Intensive Listening, and Speaking bands inside that
  same hero card and replaced their black group background with a shallow white
  glass surface.
- Kept the selected category gradients, trailing glyph watermarks, edge light
  bars, destinations, responsive layout, and accessible motion fallbacks.

## 2026-08-27 — Editorial Dashboard learning entrances

- Replaced the three pale Dashboard workspace cards with a shared dark
  editorial surface and blue, teal, and orange full-width course bands.
- Turned `写`, `听`, and `说` into large translucent trailing watermarks and
  replaced the arrow affordance with a restrained edge light bar.
- Added immediate press feedback, keyboard focus treatment, responsive phone
  sizing, and reduced-motion/high-contrast fallbacks without changing any
  Writing, Intensive Listening, or Speaking destination.

## 2026-08-27 — Permanent Draft annotations and completed feedback dialog

- Kept every original AI-flagged Draft sentence underlined after revision acceptance,
  so Draft remains the annotated source while Revised remains the corrected manuscript.
- Removed the entire Sentence Revision card once all required corrections pass and the
  Revised manuscript is available.
- Made every AI-flagged sentence in a completed Draft open a focus-trapped Apple-style
  feedback dialog with its initial analysis and saved feedback history; originally correct
  sentences give a restrained inline shake instead. Removed the dialog heading, centered
  the Draft/Revised segmented control, and kept Revised read-only.

## 2026-08-27 — Proofreading Draft and reconstructed Revised manuscript

- Restyled the original Draft as neutral paper and marked only revision-required
  source sentences with a restrained red proofreading wave. The approved surface
  now uses warm ivory paper, subtle fibre detail, and a warm natural shadow.
- Kept proofreading waves tied to the original AI review rather than revision progress,
  so acceptance does not rewrite the visual history of the Draft.
- Added a conditional `Draft / Revised` segmented control after all required
  sentence revisions pass. Completed records default to the reconstructed Revised
  manuscript while preserving original paragraph structure and the eight-color
  sentence navigation system.
- Reused persisted accepted student rewrites for reconstruction, so this completed
  manuscript view adds no model request or Token cost.

## 2026-08-27 — Original capsule marks and hidden revision samples

- Restored the earliest tiny plain capsule status marks: a green `✓` for accepted
  sentences and a red `×` for every sentence still requiring completion or checking.
- Removed the `Sample` action and reference panel from Sentence Revision while
  retaining `reference_revision` in the model schema and private stored result.
- Simplified the rewrite placeholder so it no longer refers to a hidden sample.

## 2026-08-26 — Runner tap surface and sentence-status color correction

- Expanded Runner jump input to every non-control point below the Writing toolbar,
  while links, buttons, fields, and other controls keep their own action.
- Slowed the Finished frost seal from roughly 1.4 to 1.7 seconds.
- Kept circular card status icons but changed correct to green and incorrect to
  red; capsule status marks now use plain green checks, black questions, and red
  crosses with no surrounding circle.

## 2026-08-26 — Provider Token ledger and completeness alerts

- Added an append-only per-provider-call Token ledger covering OCR, optional
  image location, both review modes, structural repair, revision OCR, and
  rewrite checking.
- Added terminal-job auditing for absent/incomplete provider usage and ledger
  persistence failures; safe alerts reuse the private teacher email outbox and
  never block a successful student result.
- Added normalization and audit contract tests plus owner-gated rollout
  instructions for the new ADMINONLY collection and three affected functions.

## 2026-08-26 — Sentence Revision hierarchy and pending review state

- Unified the `Language Review`, `Draft`, and `Sentence Revision` title
  typography; moved the non-sticky Sentence Revision title/font controls above
  the independently sticky sentence-number navigator.
- Replaced English card status fields and legacy capsule marks with one shared
  red circled-check / black circled-question / black circled-cross system that
  updates immediately as a student edits a revision.
- Added bounded, locally remembered analysis-text sizing and remeasurement of
  the active flip-card face.
- Added an accessible Submit-or-review dialog after confirmed revision-scan
  drafts return to Sentence Revision; scan import remains draft-only and does
  not bypass the existing server rewrite-check boundary.

## 2026-08-26 — Frozen Finished state for Writing Runner

- Finished now pauses Runner physics and input immediately and prevents tab
  visibility/focus restoration from resuming the game.
- Added a one-time 1.4-second crystalline frost seal over the retained final
  Canvas frame; Reduced Motion receives the static final frost state.
- Kept the result action, Finished Dock reminder, and selected J6 sound active
  outside the frozen game surface.

## 2026-08-26 — Final Writing Runner sound hierarchy

- Selected the `P3` light pluck for collectible points and the `H4` low drop for
  obstacle deductions.
- Replaced the Finished reminder with the louder `J6` spacious rising jingle,
  retaining one sound per Dock bounce and a single cue under Reduced Motion.
- Routed all three synthesized cues through one bounded Web Audio compressor;
  Runner audio remains local-only, non-authoritative, and non-persistent.

## 2026-08-25 — Label-free Writing progress and consistent toolbar spacing

- Made `Uploaded` check immediately after the durable upload handoff, kept
  `Finished` pending until the saved result is ready, and removed the visible
  `Thinking` connector label while retaining the left-to-right energy motion.
- Replaced screen-specific mobile top-spacing patches with one 14px Writing
  stage inset covering every content state; compensated Writing Home so its
  existing visual spacing and the Sentence Revision takeover toolbar remain
  unchanged.

## 2026-08-25 — Non-disruptive AI interruption and five attempts

- Increased durable OCR, review, rewrite-check, and revision-OCR automatic
  attempts from three to five.
- Replaced full-page terminal AI errors with a red `Interrupted` waiting track,
  inline retry guidance, and one `Retry` action while preserving the live Runner
  and its in-memory score.
- Added authenticated durable manual requeue for failed OCR/rewrite/revision jobs;
  review Retry remains a fresh quota-controlled request. Removed duplicate failure
  navigation and re-upload actions in favor of the persistent toolbar Back.
- Renamed the waiting endpoints to `Uploaded` and `Finished`, moving `Thinking`
  onto the animated connector so its energy sweep reads as the active process;
  terminal failure changes that connector label to `Interrupted`.

## 2026-08-25 — Undoable OCR title extraction

- Added an optional title field to manuscript OCR confirmation with a mobile-safe
  `Use First Line` action that moves the title out of the text before review.
- Added immediate Undo that restores the previous title, manuscript markup, and
  image-region acknowledgement state; prompt OCR remains unchanged.
- Removed the redundant visible title label, aligned the title action controls,
  styled invalid extraction guidance in pale red, and made OCR comparison photos
  open the existing full-screen viewer without changing uncertainty-box behavior.

## 2026-08-25 — Immediate two-state Writing waiting game

- Replaced task-specific four-step waiting copy with one two-endpoint track and a
  continuous left-to-right energy connector.
- Started the Runner during the initial upload handoff, removing upload-only and
  AI-reading loader screens plus the redundant `Text is ready` result copy.
- Synchronized the periodic Finished Dock bounce with its reminder chime and
  fixed long waits so obstacles and collectibles replenish continuously.

## 2026-08-25 — Single-photo Writing scan staging

- Removed the student-entered Title field from new Writing source forms; existing
  AI title generation and portfolio title editing remain authoritative.
- Unified initial-draft and revision-photo staging around one current image, explicit
  previous/next navigation, a full enlarged viewer, and current/total counters.
- Replaced bottom Remove actions with `Add Photo`; destructive removal now starts from
  an in-image red close control and requires the shared Apple-style confirmation.

## 2026-08-25 — Compact adaptive Writing source controls

- Removed visible source-field headings and moved concise guidance into the controls
  while retaining accessible names.
- Standardized placeholder typography, changed Prompt/Writing to one-/three-row
  auto-growing fields, and replaced the faded fixed/student divider with a full line.

## 2026-08-25 — Ephemeral unsubmitted Writing input and Discard compatibility

- Removed pending Writing Home input from session storage. Before Submit/Scan,
  fields now survive only an in-page collapse and disappear on refresh or re-entry.
- Added startup cleanup for retired pending-composer keys and routed legacy empty
  drafts through the older safe discard action.
- Diagnosed production Discard failures as a static/function release mismatch:
  the deployed 2026-08-24 `writingTutor` returns `UNKNOWN_ACTION` for the newer
  `discardDraftComposition` request and must be upgraded with the static client.

## 2026-08-25 — Writing Home section labels and reversible composer

- Added the shared `New`, `Continue`, and `Review` labels above the three
  Writing Home regions.
- Made the selected Polishing/Brainstorming card a reversible accessible toggle:
  a second press collapses the composer while retaining every unsubmitted field.

## 2026-08-25 — Submit-bound Writing creation

- Removed server-side draft creation from the Polishing/Brainstorming selection
  path. Unsubmitted fields now remain in an owner-scoped session-only composer,
  stay on Writing Home after refresh, and never enter History or the URL.
- Moved the first Composition write to explicit text `Submit` or photo `Scan`;
  previously submitted initial drafts also reopen in the inline home composer
  instead of the retired standalone initial-entry screen.
- Corrected the `Your Writing` placeholder and first-line vertical alignment.

## 2026-08-25 — Writing navigation, photo choice, and waiting-game feedback

- Changed the Writing toolbar's left action from `History` to confirmed `Back`
  throughout an open Composition, returning to Writing Home while durable jobs
  continue; removed duplicate waiting-card navigation and re-upload actions.
- Reordered Writing Home as new writing, unfinished work, then completed work.
- Added one Apple-style camera/library action sheet for initial, prompt, and
  revision photos, with synchronous native input activation for iOS Safari.
- Started OCR waiting and polling immediately after upload handoff; placed Score
  inside the Runner, removed its Jump/instruction controls, added ground and
  airborne obstacles plus distinct collect/collision sounds, and renamed the OCR
  Ready action to `Check Text`.
- Removed the `OCR Review` heading while retaining `Compare with Image` and the
  centered `Confirm` action.

## 2026-08-25 — Dashboard progress and reply-history polish

- Simplified the Dashboard hero to its current-week progress only, removing the
  separate Upcoming / No Tasks row while retaining future work in To Do List.
- Replaced Teacher Replies' explicit five-item history button with a resisted
  scroll-past-bottom gesture, rotating progress feedback, and staggered
  five-card reveals.
- Removed the divider stroke through the Dashboard header calendar glyph.

## 2026-08-25 — Writing draft entry and prompt scanning

- Added the Dashboard Library-style entry confirmation—with title, status, and
  progress bar—before any Writing Home or History Composition is opened.
- Simplified the new-writing surface to icon-free `Polishing` / `Brainstorming`
  cards and reordered Brainstorming as Rubric, Writing Prompt, divider, Title,
  and Your Writing with icon-only bottom-right camera controls.
- Added durable purpose-aware prompt OCR that returns confirmed text to Writing
  Prompt without starting manuscript evaluation.
- Changed input-page Discard into a boxed, confirmed permanent deletion for only
  server-verified revision-1 drafts that have never entered processing; submitted,
  queued, reviewed, revised, completed, or Library-bound works remain undeletable.

## 2026-08-24 — Inline Writing Home composer

- Replaced the greeting-led four-panel Writing Home with a horizontal strip of
  all unfinished task pills followed by one `Start New` surface.
- `Polishing` and `Brainstorming` now expand Title/Your Writing in place; removed
  the Type/Scan switch and embedded a compact Scan action in the writing field.

## 2026-08-24 — Incomplete revision alert

- Replaced the Sentence Revision incomplete-submit status banner with a compact,
  one-action material alert.
- Incomplete Submit now turns every required card to `Your Attempt`, positions the
  first unfinished card, and focuses its input after `OK`; rewrite guidance is English.

## 2026-08-24 — Revision photo acquisition controls

- Added a separate Photo Library input beside Add Photo and Remove in revision
  photo staging, preserving one ordered eight-photo batch.
- Kept `Back` and `Start Scanning` on one phone row; Back returns to Sentence
  Revision without committing the staged photos or changing saved rewrite drafts.

## 2026-08-24 — Direct ready-result re-entry

- Opening an already-ready Writing Composition now renders its saved OCR,
  assessment, rewrite feedback, or Revision Scan result directly instead of
  synthesizing a completed waiting game.
- Active waits still pause at Ready, but remove the redundant ready heading and
  use a periodic reduced-motion-safe Dock-style bounce on the Ready node/label.

## 2026-08-24 — Simplified initial Writing photo staging

- Removed manual forward/back ordering from the first-draft photo preview while
  preserving capture and selection order.
- Standardized each preview to a top-left `Page current/total` badge and one
  bottom-right English `Remove` action.
- Added a shared post-render viewport reset for structural and full-screen Writing
  transitions, preventing iPhone/iPad Safari from retaining a stale bottom scroll
  position after tall photo or result content disappears.

## 2026-08-24 — Visitor access for Intensive Listening and AI Tutor

- Visitors can play and replay the lesson's existing public BBC audio without
  invoking the private Intensive Listening function or receiving private
  sentence boundaries.
- Visitors cannot type, check, reveal answers, Argue, read progress, or write
  any learning record.
- AI Writing Tutor now checks for a student session before private API calls and
  shows non-students a contact modal for requesting a temporary student account.
- Kept the existing My Words visitor behavior unchanged.

## 2026-08-24 — AI Tutor waiting experience

- Simplified the first Writing screen to two compact training-mode buttons,
  mode-specific fields, concise `Submit` / `Scan` actions, and a small red
  `Discard` with an Apple-style confirmation for non-empty input.
- Unified the four durable AI waiting cards around server-derived Saved,
  Queued, Analysing, and Ready stages, with an explicit Uploading boundary
  before the server confirms a persistent Job.
- Added the optional, dependency-free Mr. Cat Runner Canvas interaction. It is
  temporary and local to the waiting card, has no formal Game Over or rewards,
  and cannot delay or alter the real AI result.
- Added bounded success handoff, reduced-motion/hidden-tab fallbacks, and
  idempotent Runner cleanup for success, failure, navigation, refresh, and
  pagehide paths.

## 2026-08-22 — Intensive Listening answer-reveal correctness

- Kept `Completed with answer` progress semantics while stopping Show Answer
  from marking every wrong or blank Word Slot green.
- Preserved independently correct positions across reveal and neutralized the
  synthetic all-green marks stored by the previous reveal implementation.

## 2026-08-22 — AI Tutor composition continuity

- Rebuilt OCR Review as a focused paragraph editor with only `OCR Review`,
  `Compare with Image`, and one centered `Confirm` footer action. Removed
  `Upload Again` from this review step. Structured uncertain
  OCR substrings now appear as dismissible pale-red inline marks, while one Enter
  creates a visibly spaced paragraph without storing presentation markup.
- Changed student-facing CEFR levels from Chinese within-band labels to compact
  minus/base/plus notation such as `B1-`, `B1`, and `B1+`.
- Added a required structured CEFR Writing Estimate to new General Language
  Reviews: A1–C2, lower/middle/upper position, and a concise Simplified Chinese
  manuscript-specific rationale displayed before the Language Review overview.
- Reduced the writing toolbar to History, the current title, and required-sentence
  revision percentage. Moved Home and New into History and removed the post-Check
  instruction banner.
- Preserved the open Composition in the page URL so refresh returns to the same
  owner-checked server workflow instead of the AI Tutor home.
- Added the current AI/student title to the flexible toolbar center, with measured
  bidirectional overflow motion and a Reduced Motion ellipsis fallback.
- Made indexed Sentence Revision backgrounds visible before interaction and removed
  the former dark left-edge accent.
- Lowered the phone-only Sentence Revision rewrite-focus resting position by 24px
  while preserving the existing iPad and desktop behavior.
- Added `Scan Revisions` inside editable Sentence Revision. Students may capture
  or select answer photos, review durable OCR mappings, manually assign unresolved
  rows, and explicitly import confirmed rows into revision drafts. Import adopts
  the reviewed scan text for the corresponding unfinished draft but never runs
  `Check` automatically. Number markers accept `8`, `8.`, `8、`, `8)`, and `(8)`.
- Bound revision OCR to private uploads, a durable `revision_ocr` job, strict
  schema validation, server canonicalization, and a pending scan result before
  confirmed draft persistence. Queued/processing scans resume after leaving,
  refresh, re-login, or disconnect, with safe retry and photo cleanup after the
  durable scan result is stored.
- Fixed both initial/replacement composition photo uploads and Sentence Revision
  scans when an existing Composition stores `pending_upload: null`. Upload state
  now uses an atomic whole-field replacement before any AI call, avoiding
  CloudBase dotted-path write failures and preserving idempotent retry behavior.
- Rebuilt Review Scan rows as stacked cards with a Vocabulary-style red original-
  sentence selector above an editable OCR rewrite box. Selection is limited to
  unfinished revision-required sentences, already-correct/accepted work is excluded
  by both client and server, and another card's target is disabled to prevent
  duplicate assignment.
- Reduced Review Scan to its sentence cards and footer actions. Removed page-level
  instructions, matching labels, handwritten-number copy, and typed/scanned choice
  controls; confidence is now a tiny accessible high/medium/low symbol, and Import
  is the explicit boundary that adopts the reviewed scan text for unfinished drafts.
- Made successful scan import return with every revision-required card showing its
  attempt face. Renamed the muted rewrite-field label to `Your Attempt` and the lone
  Sentence Revision footer action from `Check` to `Submit`.
- Removed the Sentence Revision instruction line and moved Scan Revisions beside
  `Submit` as a compact, accessible camera-only footer button on every viewport.
- Preserved per-sentence rewrite feedback across Submit rounds instead of replacing
  the previous commentary. Analysis cards now separate chronological
  feedback rounds with a thin divider, including safe round-1 migration for legacy
  latest-only rewrite results and operation-ID replay protection.
- Removed visible “第几次点评” labels from Sentence Revision. Durable round data is
  unchanged; the card now presents only the feedback copy with a thin divider
  between consecutive submissions.
- Added a pre-upload `Revision Photos` queue for photographed corrections. The
  first photo now opens previews instead of uploading, students may add/remove up
  to eight photos, and `Start Scanning` sends the complete ordered batch. Review
  confirmation is now labelled `Confirm Scanning` and activates only after every
  recognized row has a unique valid sentence and non-empty text.


## 2026-08-20

### Added

- Promoted the two former `Champ` DSE writing handouts to stable public share
  URLs with a shared mobile-first Mr. Cat Academy editorial shell, social
  metadata, native-share/copy fallback, print styling, and one-way homepage CTA.
- Added `noindex` compatibility redirects from both historical `temp-*` URLs.

### Changed

- Added the clickable `jxbleo@foxmail.com` contact address beside
  `@猫先生英语` in the homepage footer, with a separate centered contact row on
  narrow screens.
- Replaced the broken Article/Essay `sendPrompt` behavior with a working copyable
  AI-coaching prompt and made guide tabs/checklist controls keyboard accessible.
- Kept login, Dashboard, Library, and generated catalogs free of reverse links
  to the public share resources.

### Deployment scope

- Static-only release. No CloudBase function, collection, data import, or
  migration is required.


## 2026-08-19

### Added

- Added the approved Public Security Bureau registration badge and
  `粤公网安备44030002015814号` verification link beside the existing ICP record
  in the public homepage footer.

### Changed

- Unified the favicon and Add to Home Screen identity across every root page
  using the owner-supplied Mr. Cat face. Removed the separate DSE/IELTS icon
  sets, manifests, curriculum-logo images, old standalone cat image, and
  profile-driven icon switching.
- Simplified the public login alternatives to an `or` divider followed by
  `Continue as parent` and `Continue as visitor`, removing the separate
  visitor-mode note.
- Added the low-emphasis `@猫先生英语` handle to the official registration footer
  and grouped the handle, ICP record, and public-security record in one
  responsive footer bar.
- Unified Dashboard, My Words, Attempt Review, public Library, BBC, IELTS, and Vocabulary login routing through the central `index.html` form. Validated same-origin return targets preserve the original page query/hash while rejecting external or nested destinations and stripping legacy `user`/`visitor` identity parameters.
- Removed embedded Student ID entry from public Library, BBC, and IELTS Reading. Practice pages now derive identity from authenticated CloudBase profile state or explicit Visitor mode.

### Deployment scope

- Static-only release. No CloudBase function, collection, data import, or migration is required.

## 2026-08-18

### Changed

- BBC result Close now returns students directly to inline correction on the
  same worksheet. Only incorrect fill-blank and matching controls reopen;
  correct answers and every multiple-choice group stay disabled. Repeat submit
  activates after an editable answer changes, creates a new immutable attempt,
  and preserves server-enforced first-submission scoring for all BBC MC items.


## 2026-08-17

### Added

- Added Dictation, Listen Only, and Skip segment behavior to Intensive Listening.
- Added student/teacher word-level Spelling Exemption Argue, teacher approval,
  live policy refresh, Provided Words, and teacher-only latest-JSON export.
- Added private iCloud source backups for all 17 BBC Intensive Listening
  materials as self-contained JSON plus readable Markdown transcripts.
- Added four further BBC Intensive Listening materials: `IL-BBC-260611`,
  `IL-BBC-260618`, `IL-BBC-260716`, and `IL-BBC-260806`, bringing every visible
  2026 BBC lesson through 13 August into the shared runtime.

### Changed

- Reduced the `teacherAdmin` deployment bundle by replacing its unused
  top-level CloudBase manager entry with a small, protocol-compatible end-user
  API adapter. Added a reproducible package-size gate and artifact checks so
  `CodeUnzipSizeLimit` failures are caught before owner upload; teacher account
  operations and Intensive Listening Argue behavior remain unchanged.
- Matched the student Intensive Listening Argue success state to BBC Argue with
  the animated heart, thank-you message, and external Close action.
- Replaced the generic Teacher Argue treatment for Intensive Listening spelling
  exemptions with a dedicated green target-word card, sentence highlight,
  timestamped audio preview, global-impact warning, and only the two valid
  Reject/Approve decisions.
- Skip and Listen Only segments now remain visible and audible in the student
  sequence. They use the normal practice card with a disabled no-typing field,
  advance after playback, and remain excluded from completion and replay totals.
- Added Previous Sentence and Next Sentence arrows beside the Intensive
  Listening Unit/Speaker labels. Adjacent navigation preserves local drafts,
  includes passive listening segments, autoplays the selected segment, and
  disables invalid directions at material boundaries.
- Reclassified 232 fixed BBC idents, host greetings, website/worksheet
  promotions, and closing segments as Skip while preserving source text and
  timestamps. The 16 version-1 materials advance to content version 2;
  `IL-BBC-260813` advances from version 2 to version 3.
- Made CloudBase the live published source after import while retaining private
  iCloud JSON as the portable authoring and recovery package.
- Standardized repeat timestamped-JSON intake and renamed the owner backup
  folders to `Scripts JSON` and `Scripts MD`.

## 2026-08-16

### Added

- Added the authenticated shared Intensive Listening runtime, private server
  checking/progress function, timestamped JSON importer, and first material
  `IL-BBC-260813`.
- Added an `Intensive Listening` capsule to explicitly linked BBC lesson cards.
- Added 16 more BBC Intensive Listening materials from `BBC-260319` through
  `BBC-260730`, using the teacher-provided source segments as student units.

### Changed

- Kept Intensive Listening as a single contextual entry on linked BBC lesson
  cards and removed its separate Student Library category and card.
- Reimported `IL-BBC-260813` with 83 millisecond-timed source units; the complete
  17-material batch contains 1,447 units and 16,495 private word slots.
- Switched all 2026 BBC Listening lessons to the default green-glass rendering
  by removing their blue theme overrides.
- Unified BBC, Vocabulary, IELTS Reading, and IELTS Listening `Back` / `Home`
  confirmations with the Student Logout Apple-style glass alert, including
  a consistent warning hierarchy, focus containment/restoration, scroll locking, and
  accessibility fallbacks. IELTS Listening now uses the shared practice alert
  instead of its legacy leave-page dialog.
- Simplified that shared leave alert to one uniformly styled warning sentence,
  retained the green `Cancel`, and standardized the only destructive action as
  red-text `Leave` for both Back and Home.
- Added the same explicit Apple-style confirmation before Teacher Personal
  Center logout; only the confirmed action clears the teacher cache and session.
- Lowered the Tencent COS multipart-upload threshold from 5 MB to 4 MB after a
  4.79 MB BBC audio object stalled on the single-request upload path. The
  resumable deploy now routes that file through the proven 1 MB chunk path.

## 2026-08-15

### Added

- Added a Teacher View matrix axis-swap control beside the size controls.
  Desktop defaults to student rows/task columns, while phone portrait defaults
  to student columns/task rows for small-class scanning and long vertical task
  lists; each responsive orientation preference is remembered independently.

### Changed

- Parent Mode now collapses overlapping class-membership history to one student
  column and labels passing thresholds as `合格线：80%` throughout its family UI.
- Moved the production static release track to a dedicated Tencent COS static
  website while retaining GitHub `main` as the source of truth and CloudBase as
  the trusted backend.
- Made GitHub-to-COS publication incremental and resumable. Large media use
  bounded multipart uploads, completed objects survive a failed run, and later
  runs skip the already synchronized public artifact.
- Restored ordinary deployments to a 90-minute timeout with stale in-progress
  runs cancelled when a newer `main` release starts.
- Upgraded the shared browser CloudBase SDK from `2.28.6` to `2.32.0` to avoid
  the credential-bootstrap null dereference reported as
  `null is not an object (evaluating 't.scope')`.
- Vocabulary Quiz and timed Practice now retry only a read-only authenticated
  login preflight, show a friendly non-submission error when authentication
  cannot be verified, and never blindly retry the mutating submit call.
- Recorded Vocabulary Quiz and timed Practice submissions now carry a stable
  client submission ID. `submitAttempt` derives an atomic document ID from it
  and returns the existing immutable attempt on a replay, preventing duplicate
  attempts and downstream side effects. Quiz timing, heartbeat, assignment
  locking, visibility interruption, and anti-cheat deadlines are unchanged.

## 2026-08-13

### Added

- Added a teacher-only `Add as accepted answer` shortcut to eligible wrong
  questions in Notification paper reports. It uses the existing audited Argue
  `add` semantics and upward-only historical regrade, assignment, and STAR
  repair flow.

## 2026-08-12

### Changed

- Added an allowlisted CloudBase static-site build so GitHub `main` can publish
  the public frontend to Tencent hosting without exposing backend source,
  repository documentation, scripts, or private local artifacts.
- Added the official ICP registration number and Ministry of Industry and
  Information Technology link to the public homepage footer.
- IELTS Listening now defaults to a seekable, speed-adjustable Practice Mode;
  the locked one-pass flow is named Test Mode and is the only recorded path.
- New IELTS Reading and Listening Argue requests are disabled in runtime UI and
  trusted backend actions while historical dispute records remain intact.
- Vocabulary Quiz and timed Practice now send every recorded submission as an
  independent mailbox message. Subjects include `Quiz No. n` or
  `Practice No. n`, while second and later messages retain cumulative history
  for the same assignment/self-study set. BBC keeps its existing reply-threaded
  seven-minute batches.
- Counted Vocabulary Quiz sessions now lock the exact assignment or self-study
  context from start through draft restore and submission. A second open-task
  lookup can no longer move the first submission to another assignment.
- Equal-due assignments use a stable ID tie-breaker. Mid-Quiz assignment
  creation does not capture self-study work, while cancelled or missing locked
  assignments stop before any attempt is recorded.
- Teacher View can now soft-cancel any non-cancelled assignment, including
  Passed and Mastered rows, so obsolete participation can be removed from the
  matrix after class membership or assignment-scope changes.
- Completed-assignment cancellation preserves immutable attempts, set-wide
  Exercise Progress, completion timestamps, historical best scores, and
  protected STARs. Reassignment still initializes from the historical global
  best and may therefore be immediately complete.
- Changed the development attempt-email sender display name to `猫先生英语`
  while retaining the existing iCloud sender address.

## 2026-08-11

### Added

- Added a private teacher attempt-email outbox and timer-only SMTP dispatcher.
- Added fixed seven-minute BBC batching and immediately due cumulative
  Vocabulary Quiz/Timed Practice emails with complete history bars and
  mistake-only answer comparisons.
- Added bounded retry/audit state, stable email conversation metadata, and pure
  notification rendering/policy tests.
- Added Teacher Personal Center Email management with add, delete, enable/pause,
  a ten-address limit, private BCC delivery, and no-recipient skip behavior.

### Changed

- `submitAttempt` now queues eligible email events after immutable attempt
  storage without making email delivery part of grading success.
- Added Nodemailer 9.0.5 as a bundled CloudBase-function dependency; SMTP
  transport, sender, Teacher URL, and timer settings remain environment-only,
  while recipient addresses are teacher-owned profile settings.
- Simplified the Teacher Personal Center email surface to one blue `EMAIL
  NOTIFICATIONS` heading, one add control, and address-level enable/pause
  switches; removed explanatory, count, refresh, status, and delete chrome.
- Activated the explicitly authorized development email dispatcher with a
  server-only token and enabled one-minute SCF timer; the token is absent from
  source and deployment transcripts.
- Changed attempt-email subjects to student name, exercise title, and historical
  best score only, and reversed chart/detail/plain-text history to newest first.
- Matched the email body to the approved static Teacher attempt-card preview:
  identity plus threshold capsules, newest-first chart/cards, and distinct
  submitted/expected/explanation surfaces, without branding or website links.

### Fixed

- Fixed Teacher Personal Center email creation failing because its private
  recipient-record ID helper was missing; the development `teacherAdmin`
  function was redeployed with a regression assertion.

## 2026-08-10

### Fixed

- Reduced Student Dashboard time-to-first-use with an owner-scoped redacted
  warm cache and a lightweight `getDashboard.dashboardBootstrap` response.
  To Do and Finished now start with 10 rows and append 10 at the scroll edge;
  public first-task data, unread Teacher Replies, remaining summaries, STAR,
  self-study, wallet, and complete history hydrate silently after first paint.
- Normalized student identity handling so Chinese and English names remain
  separate authoritative fields, while `name` is a server-derived bilingual
  compatibility display using direct `ChineseEnglish` concatenation with no
  separator. Teacher lists, search, Assign, Account editing, and
  the student identity card now share the same rule; legacy unsplit names are
  shown as one review-required value instead of falsely reporting that their
  embedded English name is absent.
- Fixed shared Student/Teacher Close animations retaining their invisible final
  frame after a reusable dialog was hidden. Reopening Calendar, Library task
  confirmation, Teacher utilities, and other persistent dialogs now restores
  the complete visible surface and never leaves a transparent input-blocking
  overlay behind.

### Changed

- Added a shared Student/Teacher modal close transition: explicit Close
  controls now respond immediately, then dismiss dialog material and backdrop
  through a restrained no-bounce fade, downshift, and scale before existing
  focus and scroll restoration runs. Reduced-motion mode uses a short
  opacity-only exit.
- Standardized BBC and Vocabulary post-submit result audio into two states:
  not-passed uses the selected low descending “sigh,” while Passed and Mastered
  share the existing bright rising success sound. Vocabulary result dialogs now
  play the same score-based feedback as BBC.
- Changed Teacher Notifications to fill and extend the bell list in automatic
  ten-thread scroll pages, removing its manual `Load more` control. The header
  bell now keeps a circular loading state until the unread count resolves, and
  background private-detail prefetch remains limited to unread threads; older
  read history loads summaries only until a teacher opens a thread.

## 2026-08-09

### Changed

- Replaced Teacher startup's all-history Notifications and Argue reads with
  five-item pages. The bell automatically advances until every unread thread is
  cached, then silently prefetches authorized answer details from newest to
  oldest with two-request concurrency; earlier read history and each Argue
  status advance through `Load 5 more`.
- Removed visible spinner states from the Teacher bell and Argue controls,
  separated notification feed IDs from matrix attempt history, and kept all
  prefetched answers/explanations in current-tab memory only.

## 2026-08-08

### Changed

- Unified assigned and self-study results into one highest-score Exercise
  Progress per student and set. Already-completed work now enters a new
  assignment as Finished immediately, Vocabulary can keep improving, BBC obeys
  its score lock, and tied/lower retries no longer move FINISHED ordering.
- Changed complete Class Assign so an existing open individual assignment is
  integrated into the class batch instead of skipped, and added per-task Assign
  previews for Not started, Existing progress, and Already finished students.
- Kept Yellow STAR authority assignment-owned: historical mastery produces a
  Yellow STAR only when the teacher enables Earn STAR.

- Changed the Dashboard notebook from immediate navigation into a unified
  glass quick-preview dialog showing the seven most recent words, pronunciation,
  the saved/remaining counts, and a fixed `Open My Words` route to the complete
  workspace. Full search, editing, Notes, sorting, and export remain outside the
  Dashboard preview.
- Replaced the Student completion calendar's white/green selected-day outline
  with the Vocabulary Quiz confirmation's flowing gold-edge treatment while
  preserving each day's completion fill, STAR marker, and a static reduced-motion
  fallback.
- Connected the Dashboard notebook to the dedicated My Words header with a
  reversible same-origin shared-surface transition, plus a top-right material
  fallback and reduced-motion path. The transition begins immediately and never
  waits for personal vocabulary data.
- Replaced the blocking full-workspace My Words loading sheet and one-shot
  200-row startup request with a visible shell, local card/detail skeletons, an
  18-row owner-scoped warm first page, and 30-row continuation pages. Complete
  Search, A–Z/Z–A, Review statistics, and Export now finish remaining pages only
  when those features need them; logout clears the session cache.

## 2026-08-07

### Fixed

- Removed the stale desktop-only `75vh` cap from Teacher notification attempt
  details, so the stacked detail card now exactly covers the Notifications card
  footprint on desktop as it already did on mobile.

### Changed

- Added passed self-study sets to the shared Student FINISHED projection, so To
  Do List, Personal Center, and the monthly calendar count them without waiting
  for assignment. Completion uses the first passing date, score/review uses the
  best attempt, completed assignments deduplicate the same set, and timed
  Vocabulary Practice remains teacher-notification-only.
- Clarified the Vocabulary recording boundary: selected-group count never makes
  Practice count toward student completion. Timed Cloze Practice keeps its
  notification-only activity attempt for teacher visibility, while only Quiz
  attempts can count toward scores, FINISHED, the student calendar, STAR, or
  learning reports.
- Restored compact `#n` attempt labels, moved Vocabulary Quiz/Practice and
  selected-set metadata into the attempt header's first column, compressed
  Practice group selections into an ascending sequence with `X` for group 10,
  and added a one-time restrained reveal for answer comparisons after their
  authorized detail requests finish, with an opacity-only reduced-motion
  fallback.

## 2026-08-06

### Changed

- Standardized independent Student dialogs that place `Close` below the card
  as Close-only surfaces. Personal Center, STAR Wallet, To Do List, Teacher
  Replies, Calendar, task-entry confirmation, and mobile My Words detail now
  ignore backdrop clicks and Escape while preserving explicit workflow actions;
  Vocabulary worksheet download and student Argue confirmation follow the same
  rule, as do BBC/Vocabulary result dialogs and Vocabulary quiz notices with
  explicit actions.
- Replaced the Student To Do List's three stacked collapsible assignment
  sections with fixed top `This Week`, `Upcoming`, and `Finished` buttons. Each
  button shows its task count, switches one visible list, and supports standard
  keyboard tab navigation while preserving existing due-week grouping.
- Split the Vocabulary Practice download dialog into a landing view and a
  dedicated `Customize your download` view with a back arrow, removed the
  redundant custom-view choices and Cancel action, and added one external
  `Close` action below the dialog card.
- Made each Student Teacher Replies card the question-navigation target: card
  titles are centered, question prefixes and inline navigation buttons are
  removed, and clicking or keyboard-activating a card now opens a confirmation
  before navigating to the original question.
- Consolidated the mobile My Words density controls into one layout picker with
  one-, two-, and three-column choices, preserved the selected layout in the
  browser, and replaced the ambiguous Export ellipsis with a download icon
  while retaining all existing export ranges, fields, Excel, and PDF actions.
- Simplified the mobile My Words detail card around the word, speaker, POS,
  English definition, optional forms, and labelled Source/Note boxes. Moved
  Close below the card, removed redundant detail/status/placeholder labels,
  made the three-dot menu dismiss on outside click, and prevented iOS focus zoom
  for Edit word and Add/Edit Note.

## 2026-08-05

### Fixed

- Fixed the dedicated My Words workspace treating its rounded clipping surface
  as the sticky toolbar's scroll container. My Words now opens without a blank
  toolbar offset, and the expanded Export time-range capsules remain fully
  visible instead of sliding underneath the toolbar.
- Matched Teacher STAR Redemption to the Notifications utility footprint on
  desktop and mobile, corrected the centered title and top-left return control,
  and brought its dialog, header, backdrop, and request cards into the shared
  translucent glass hierarchy.
- Prevented Teacher notification attempt details from replaying their entrance
  animation when the authorized per-attempt detail requests or reviewed-state
  update re-render the open dialog.

### Changed

- Simplified Teacher BBC/Vocabulary notification attempt cards to one header
  row with submission number, Shanghai date/time, and the paper action. Removed
  repeated card scores and duration metadata, normalized BBC internal question
  IDs to `Qn`, and changed Vocabulary context to a Quiz set count or the
  student's selected Practice-number capsules.
- Redesigned Student Teacher Replies cards for clearer mobile scanning: titles
  use the existing overflow track, questions use inline `Qn.` prefixes, status
  capsules sit in the Submitted header, answer columns no longer use an arrow,
  actions are status-neutral, and each card shows the original Argue submission
  time in Shanghai time.
- Removed the standalone Learning Reports icon from the Student Dashboard.
  Published student reports remain accessible through authenticated shared
  report links, and the report reader and its authorization rules are unchanged.
- Fixed Student lookup STAR and Completed metrics rendering in normal document
  flow after hiding the lookup, which exposed the Teacher homepage instead of
  the requested detail. Both now remain fixed over the viewport, and the
  lookup's STAR Redemption and create-student icons match the main header's
  40px neutral outline controls.
- Replaced the external Close controls in Student lookup's STAR Redemption,
  STAR Source, and Completed dialogs, plus Create Student's top-right `x`, with
  consistent top-left back arrows that restore the originating lookup/detail.
- Redesigned the Student lookup detail summary around a bilingual identity
  capsule and three icon-led STAR, Completed/Total, and Account actions. Account
  fields and edits now live in a dedicated back-navigated dialog, and the old
  bottom Account settings disclosure has been removed without changing the
  Progress Calendar.
- Aligned the Teacher Review Approved and Rejected filters with Pending's
  neutral label styling and moved each handled-request total directly below its
  label, while retaining Pending's red unresolved alert.
- Prevented the Visitor Dashboard learning-report entry from clearing Visitor
  mode and bouncing through login. Explicit visitors now remain on an empty
  report surface without calling the private report service; ordinary signed-out
  shared links still require login.

- Moved Teacher student-detail Class editing into Account settings, using an
  active-class selector with a final `Customize` option whose new-class input
  appears only after selection. The top Class metric is now read-only, the
  student My Words panel is removed, and the lookup detail is constrained to
  vertical internal scrolling without horizontal panning.
- Removed the duplicated selected-student name from the Student lookup title
  bar and removed its Overall Progress card. STAR and Completed summary metrics
  now open independent dialogs for authoritative Yellow/Blue STAR provenance
  and To Do/Finished task detail; STAR history loads only on click for the
  selected student.
- Replaced the Student Dashboard My Words modal with a dedicated authenticated
  `my-words.html` workspace. Desktop now combines a fixed Study/Word List
  Sidebar with a Notebook-style index/detail split; mobile uses sticky tabs,
  remembered one/two-column English grids, bounded long-word scrolling, and an
  independent word-detail modal while retaining all edit, Note, dictionary,
  merge, report, removal, and export capabilities.
- Unified every Student Dashboard dialog card with the task-entry
  confirmation's elastic fade, scale, and upward-settle entrance while keeping
  backdrops, external Close controls, and reduced-motion behavior stable.
- Extended the same restrained elastic entrance to every independent Teacher
  dialog card, including utilities, student/detail flows, assignment tools,
  confirmations, and matrix details, without moving their backdrops or external
  Close controls.

## 2026-08-04

### Added

- Added explicit, reusable content editions without renaming existing set IDs.
- Added one-card Student Library discovery with in-place V1/V2/V3 score buttons,
  while Teacher Assign and all record-owned entry points remain concrete-set based.
- Added redacted per-set Library progress, optional stale-content protection, and
  BBC question-text snapshots for safer historical review after small revisions.

### Changed

- Made the Learning Reports scheduler consume the SCF timer's private
  `CustomArgument` from `event.Message`, allowing the daily development timer
  to remain authenticated without accepting browser-selected report inputs.
- Added an explicit `Close report` action to the learning-report reader so a
  teacher, student, or parent can clear the current report and immediately
  choose another report, including on narrow screens.

## 2026-08-03

### Added

- Defined Learning Reports V1: stable classes and membership history, trusted
  class-task scope, Shanghai-time weekly/monthly previews, teacher comments,
  immutable published snapshots, and due-period completion tie ranks.
- Added the role-aware shared-report contract: one `reports.html?report=` link
  can be posted manually to an ordinary WeChat group, while students receive
  only the leaderboard plus their own detail and teachers receive full report
  administration. Browser print/PDF is the V1 export path.
- Recorded the owner-gated CloudBase rollout required for report collections,
  indexes, functions, timer configuration, migration, and development QA.

### Changed

- Simplified Teacher student lookup to a name-only searchable list with class
  filtering, then aligned both student detail surfaces around Class, STAR, and
  Completed/Total metrics plus a shared monthly week-band completion calendar.
  Removed the Attempts/status metadata treatment from the student identity area.
- Changed Teacher startup to load lightweight attempt/progress summaries and
  keep private question-level report details out of the bootstrap response,
  preventing accumulated history from exceeding CloudBase's 6 MB response-body
  limit. Opening a notification thread now automatically makes bounded
  per-attempt detail requests so every attempt card starts with its wrong-answer
  comparison expanded.
- Narrowed the question-number column in Teacher wrong-answer comparison tables
  so submitted and correct answers receive most of the available width.
- Changed Teacher BBC and Vocabulary paper reports to show mistakes only.
  BBC wrong-question cards now include the private grading explanation.
- Added explicit Vocabulary `Quiz` / timed `Practice` labels to teacher attempt
  notifications and reports, and exposed the recorded selected group IDs for
  timed Practice review without changing its progress/STAR exclusions.
- Unified the Teacher Notifications, Review, Dictionary, and STAR Redemption
  utilities around one equal-size independent modal and external Close layout.
- Simplified STAR Redemption to one centered title and moved Review status
  filters to the top, with visible Pending, Approved, and Rejected totals.

### Fixed

- Made report preview/comment/publish transitions transactional, serialized
  active membership changes, and promoted complete class assignment batches
  atomically so concurrent or partial writes cannot corrupt published reports
  or leaderboard scope.

## 2026-08-02

### Added

- Added a visitor-preview/student-only access boundary to the standalone港八大
  DSE/JUPAS weighting report. The complete report now travels through the
  authenticated protected-resource function instead of public GitHub Pages HTML.
- Added the HKDSE Writing & Speaking Topic Bank to both DSE Writing and DSE
  Speaking Library categories. Visitors receive a structured preview with
  mosaicked locked content; active students and teachers receive the complete
  report through a new authenticated, integrity-checked CloudBase resource
  function. The complete HTML remains outside the public Git repository.

### Changed

- Removed the final `Further Questions` section from the protected HKDSE topic
  bank and redeployed the regenerated full report.

### Fixed

- Fixed the Lingnan University official-source URL that previously left a
  visible `.pdf)` suffix outside the link.
- Prevented one transient CloudBase heartbeat failure from immediately
  interrupting a countable Vocabulary Test. The page now preserves answers,
  shows a reconnecting state, and retries for up to 60 seconds, while explicit
  session errors and page/app switching remain terminal integrity events.

## 2026-08-01

### Added

- Added the V1 Yellow STAR wallet and Cash Request product model: append-only
  credit/reservation/redemption/refund history, private permanent evidence,
  student Cash workflow, and teacher approval queue.
- Added unified My STARs requirements with Available/Lifetime totals and mixed
  Yellow/Blue provenance, plus the teacher header STAR request badge.
- Added student My Words editing, personal Notes, conservative base-form
  recommendations, explicit multi-card merge with preserved examples/combined
  Notes, and a 10-second undo.
- Added Word List export selection by Shanghai natural week/month/year or
  manual checkboxes, with configurable fields and `.xlsx` or print-to-PDF
  table output.
- Added the bounded AI fallback for confirmed dictionary misses. Students
  preview before publishing the first shared AI draft; teachers can review and
  replace the current shared entry from a new Dictionary workspace, while old
  versions remain in private history.

### Fixed

- Fixed My STARs Back reopening Personal Center and then immediately closing it
  again when the same click reached the Dashboard outside-click handler.
- Fixed expanded My Words details collapsing whenever Use base, Edit word,
  Add/Edit Note, Cancel, or Done re-rendered the list. Expanded state now follows
  the vocabulary record, including when an edit changes its record ID.
- Fixed the student unified My STARs view appearing as a blank black compositor
  block in Chrome after switching content inside Personal Center. My STARs now
  opens as an independent opaque modal with its own Close action; it also
  tolerates malformed legacy history rows individually and shows an explicit
  recoverable error state if the wallet itself cannot render.
- Preserved legacy protected STAR rows with `source: "assignment"` and no
  `assignment_id` as Yellow during wallet migration and normal dashboard
  classification.
- Added teacher read-only access to individual student My Words data and a
  review queue for missing, AI-draft, reported, and reviewed shared entries.

### Changed

- Reworked the student STAR Wallet around the selected Golden Pass / Solid
  Priority direction: a label-free gold balance card, deep-green Redeem action,
  and separate soft-green `STAR Source` / `History` capsules. Provenance groups
  Yellow above Blue, while Cash request status and evidence live in History.
- Added task counts to the student To Do List's This Week, Upcoming, and
  Finished headings. Empty Upcoming is now a compact non-expandable `0` heading
  instead of opening an extra `No upcoming assignments` message.
- Simplified the student STAR Wallet header to one `STAR WALLET` title plus
  Yellow and Blue count pills. Removed the redundant `My STARs` title and the
  Available / Lifetime Yellow / Active Blue summary tiles.
- Changed new Yellow STAR uniqueness to one per student and set while preserving
  historical duplicate Yellow STARs. Blue STARs are now stable, non-redeemable
  achievements that remain as converted history after a qualifying teacher
  assignment creates the Yellow STAR.
- My Words export dates now use student activity timestamps rather than
  background dictionary-enrichment timestamps. Familiarity-based filters and
  vocabulary Practice export remain deferred.
- When the optional AI provider is not configured, the student-facing lookup
  action now presents a simple under-development message instead of backend
  configuration terminology.

## 2026-07-31

### Changed

- Restyled the assignment-parameter editor's first-stage Cancel open
  assignments action as a restrained Apple-style destructive control: muted
  red text, a pale translucent tint, a fine border, and immediate press
  feedback replace the former solid red fill. The second confirmation retains
  its stronger red treatment so the destructive hierarchy remains explicit.

### Fixed

- Removed the Teacher attempt chart's browser-side 50/90 threshold fallback.
  Matrix and notification charts now prefer the current backend assignment
  standards, fall back only to backend attempt snapshots when the assignment is
  unavailable, and omit missing lines rather than inventing values. Self-study
  progress responses now include backend-resolved Passing and Mastery fields.
- Fixed the Teacher View assignment-parameter editor failing before it could
  create its modal because the click path referenced the nonexistent
  `assignmentMasteryEnabled` function. The editor now uses the existing
  `assignmentCanEarnStar` rule, and Wxx/detail Edit triggers carry stable
  assignment IDs so a matrix re-render cannot invalidate the edit selection.
  A click-level unit test now executes the real Teacher handler and requires an
  assignment editor DOM node to be appended, including the legacy document-ID
  fallback and a cleared transient scope registry.

## 2026-07-26

### Fixed

- Fixed iPad Safari occasionally placing calendar date numbers near the top of
  their square on first modal open. Date buttons now reset native appearance
  and use explicit two-axis Flex centering with a stable line height.
- Fixed the Teacher View matrix retaining a desktop density preference on
  phones, which shortened the displayed student name without reliably
  compacting the sticky name column. Phone loads now start in automatic Fit,
  the mobile Fit grid explicitly honors the calculated compact name track, and
  phone/desktop history restoration no longer crosses viewport modes.
- Fixed Teacher View assignment-parameter editing for legacy assignment records
  that have no explicit `assignment_id`. Matrix cell Edit and Wxx column edits
  now resolve canonical `assignment_id` values, database document `_id`
  fallbacks, and cached `assigned::<id>` progress keys consistently in the
  eligibility check, editor scope, update payload, and cancellation payload.
  The editor no longer closes with a false success when the backend updates zero
  records. Edit activation uses one delegated handler so both Wxx cells and
  task-detail modals remain operable after matrix re-rendering or relocation
  into the shared modal root.
- Fixed student Dashboard histories intermittently appearing empty when
  `getDashboard` exceeded its former three-second CloudBase execution window.
  The function now reads the student's assignments, attempts, achievements,
  and disputes concurrently and resolves visible set metadata in bounded batch
  queries instead of one serial query per set. Dashboard request failures now
  show an explicit Retry state instead of being presented as an account with no
  assignments. Deploy the rebuilt `getDashboard` function and set its execution
  timeout to at least 10 seconds; 15 seconds is recommended as headroom.

### Added

- Added clickable yellow assignment and blue self-study STAR counters in the
  student Personal Center. Each opens a same-card, newest-first task provenance
  list backed by `student_set_achievements`, including earned date, best score,
  and a link to the best historical attempt. The response is designed so a
  future reward ledger can reference permanent achievements without consuming
  or rewriting them.
- Added a compact assignment-style success confirmation after a teacher resets
  a student password, including the Login ID and configured initial password.
- Added a student-only Progress calendar in the Dashboard's right-side utility
  group. The
  Monday-first monthly view combines finished assignments and self-study STAR
  records, uses compact daily activity intensity and STAR markers, and shows
  the selected day's task/score details without exposing Teacher View `Wxx`
  grouping. The existing `getDashboard` response supplies all required data,
  so no CloudBase deployment or data migration is required.
- Added a speech-bubble Teacher Replies button to the top-right of the student
  To Do List modal. It opens a permanent newest-first reply history and keeps
  unread replies on its own red badge instead of mixing them into assignment
  sections.

### Changed

- Added the current `Asia/Shanghai` day number inside the student header's
  Calendar icon with local midnight/visibility refresh and no backend request.
  Removed the To Do List button's special green treatment and oversized glyph
  so it matches the other header controls in color, stroke, and visual scale.
- Reordered each student Teacher Replies card to show the task title, question
  number, and saved original question text before its decision details. Renamed
  the answer comparison labels from `Before` / `Yours` to `Expected` /
  `Submitted` for clearer student-facing meaning. The dialog now removes its
  Back control and history-count subtitle, uses the same green eyebrow heading
  as Personal Center, and closes from the standard external `Close` capsule.
- Moved the student Teacher Replies bubble from the To Do List dialog to the
  main header immediately beside the To Do List button. Removed the default
  dialog's `ASSIGNMENTS` heading and made centered This Week, Upcoming, and
  Finished disclosures all expandable and initially open, with sequential
  sticky headers that replace one another as the dialog scrolls.
- Matched the student My Words modal's outer width, height, centered screen
  position, mobile breakpoint sizing, and external Close spacing to the
  Calendar modal while retaining independent internal list scrolling.
- Centered the checkmark inside the empty Upcoming calendar icon instead of
  positioning it in the calendar's lower-right corner.
- Standardized untouched student assignment rows on a red `0%` score instead of
  `TO DO`, while attempted failures continue to show their red historical best.
  Strengthened Teacher Replies `Back` into an arrowed glass capsule with visible
  border, depth, hover/focus, and press feedback.
- Added a red breathing state to the This Week progress track whenever overdue
  work is included. Empty Upcoming now removes its misleading `0%` track and
  becomes a non-interactive calendar-check `NO TASKS` state, while populated
  Upcoming retains its existing blue progress presentation.
- Converted Student Personal Center from an anchored account dropdown into the
  same centered thick-glass modal system used by To Do List, Calendar, and My
  Words, including backdrop/Escape dismissal, scroll locking, focus restoration,
  and the existing external Close capsule. Focused This Week and Upcoming lists
  now omit the Teacher Replies icon and use green Personal Center typography.
- Matched the student `ASSIGNMENTS` heading to the green `PERSONAL CENTER`
  typography. This Week is now an open-by-default disclosure, Finished remains
  closed by default and newest-first, and both section count pills were removed.
- Simplified the student completion calendar by removing its `Progress` header,
  subtitle, completed total, and active-days total. The month/year navigation
  now begins at the top of the modal content.
- Moved Student Personal Center dismissal to one external `Close` capsule below
  the card, and replaced Teacher Replies close controls with a top-left `Back`
  action that returns to the originating Assignments modal.
- Changed the student hero to show fixed clickable This Week and Upcoming
  summaries with true completion bars and numeric percentages. This Week now
  includes overdue unfinished work in its progress total and focused list,
  where overdue rows appear first with a restrained red pulse.
- Retitled the student To Do List modal to a smaller centered purple
  `ASSIGNMENTS` label and removed the translucent rectangular title backing.
- Simplified the Teacher View assignment-parameter editor to three direct rows:
  Due week, scroll-wheel Passing %, and scroll-wheel Mastery %. Removed the
  per-field change checkboxes and explanatory footer; Earn STAR is now the only
  checkbox and exclusively enables Mastery %. Moved the red Cancel open
  assignments action beside Save changes and added a dedicated second-step
  confirmation modal. Column edits still target the full visible filtered
  scope, while student-detail edits remain individual.
- Unified background scroll locking across every independent Teacher modal,
  including Notifications, Argue, Student lookup/details, assignment tools,
  entry confirmations, and success dialogs. Nested modals retain the lock until
  the final layer closes and then restore the prior document position.
- Refined the Teacher View matrix student column so it sizes to the names
  actually shown at each `−` / `Fit` / `+` density. Wider levels retain the
  full name, the tightest non-Fit level uses the English name when available,
  and Fit uses the Chinese or English surname while preserving the full name
  for tooltips, accessibility, and student-detail actions.
- Moved the Teacher matrix assignment-parameter and task-detail `Close`
  controls into standalone capsules below their dialog cards, removing the
  parameter editor's top-right close icon while retaining its form actions.
- Removed the visible `Student` label from the matrix's top-left header and
  restyled the DUE AT row as a lavender-grey parameter band with a sliders icon
  and outlined Wxx controls, reserving green for passed student task cells.
- Removed the cat logo from the Student Dashboard header so the standalone
  far-left To Do List control uses less horizontal space. The Teacher header
  logo is unchanged.
- Replaced the student assignment bell with a checklist-style `To Do List`
  button at the far left of the Dashboard header, separated from the right-side
  utilities. Renamed the default assignment modal accordingly, moved Teacher
  Replies into that modal's top-right corner, and simplified it to a plain
  speech-bubble SVG without an embedded checkmark.
- Changed Teacher notification thread opening to show the attempt bar chart
  first, without preselecting or scrolling to the notification's latest
  attempt. Clicking a chart bar remains the explicit action that highlights and
  scrolls to the corresponding answer detail below.
- Extended Teacher attempt-chart Passing and STAR reference lines across the
  complete horizontally scrollable attempt track, including the final bar when
  a student has many attempts.
- Simplified the student Assignments modal by removing its three top summary
  capsules, renaming the default open-work section to `This Week`, and making
  `Finished` a closed-by-default native disclosure. Restyled the Progress
  calendar with the same Apple-style thick glass material and unified its task
  rows with Assignments, including overflow title motion, score placement,
  keyboard access, entry confirmation, and practice navigation.
- Expanded the hero-card `Overdue`, `This Week`, and replacement `Upcoming`
  sections in place by default using the same compact task rows as To Do List.
  Moved each progress bar beside its section label and removed right-side count
  and empty-state copy such as `6 of 6 open` and `No assignments this week`.
  `This Week` places unfinished rows before finished rows.
- Changed `getDashboard` to return all resolved student Argue replies with
  their `student_seen` state. Marking replies seen now clears only the unread
  badge and preserves the history; a `getDashboard` CloudBase deployment is
  required, with no data migration.

## 2026-07-25

### Changed

- Changed family grading defaults to Vocabulary `90%` passing / `100%` STAR
  and BBC `80%` / `95%`, with matching fallbacks in assignment creation,
  grading, dashboard repair, and generated CloudBase set/config data. Existing
  assignments retain their stored thresholds.
- Replaced Teacher Assign and assignment-edit percentage number fields with a
  shared Apple-style vertical wheel: five visible rows, native inertial
  scrolling, integer snapping, explicit Cancel/Done, background scroll lock,
  reduced-motion handling, and keyboard controls.
- Renamed Vocabulary Cloze post-completion actions from `Redo` to `Retry` in
  both timed Practice/Quiz review and inline practice, including confirmation
  copy; internal action identifiers and behavior remain unchanged.
- Reworked Teacher matrix/notification Attempt charts into compact 14px
  capsule bars inside 48px touch columns, with score, attempt number,
  `P18m42s` / `A12m08s` timing, Passing/STAR reference lines, restrained status
  colors, best/selected indicators, and reduced-motion support.

### Fixed

- Fixed BBC yellow `classroom-worksheet` answer and explanation blocks being
  auto-placed into the narrow multiple-choice number column. Dynamic feedback
  and action areas now span the full card at phone, iPad, and desktop widths.
- Restored native iPhone/iPad text-selection highlighting and handles for My
  Words by removing the delayed `Selection.removeAllRanges()` call while
  retaining the protected single-tap save flow on the custom button.
- Bumped the shared My Words script cache version on BBC, IELTS Reading, IELTS
  Listening, Vocabulary, Dashboard, and Attempt Review pages.
- Removed the redundant `Counts toward results` suffix from Vocabulary Cloze
  Test dropdown options and fixed the phone layout so the horizontally
  scrollable Practice number capsules retain their full height and touch area.
- Renamed the student-facing counted Vocabulary Cloze choice from `Test` to the
  lighter `Quiz`, with a `Start Quiz` action and consistent quiz wording across
  its confirmation, progress, interruption, submission, and retry dialogs.

## 2026-07-24

### Changed

- Refined Vocabulary Cloze setup for mobile: Practice now starts with no group
  selected, Test exposes only countable 5+ group choices, and timed Practice
  uses green set numbers while Test retains the gold treatment.

## 2026-07-23

### Changed

- Split Vocabulary Cloze setup into stacked Practice and Test rows. Cloze
  Practice now lets students choose specific groups, runs the same timed
  shuffled-question flow, records practice-only attempts for teacher
  notifications, and stays out of assignment progress, STAR, and Teacher View
  matrix scoring.
- Fixed Teacher notification attempt details so opening a grouped attempt row
  positions the internal modal directly on the target attempt card, instead of
  first showing the top attempt chart and then delayed-scrolling downward.

Audit scope: static frontend plus `submitAttempt`, `getDashboard`, and
`teacherAdmin` cloud-function source changes; CloudBase function deployment is
required before the new saved Practice behavior works in production. No content
data import is required.

## 2026-07-15

### Changed

- Unified assignment scheduling around a required Due week. New assignments
  normalize `due_at` to Shanghai-time Sunday 23:59:59; Student Overdue, This
  Week, Upcoming, bell counts, and Teacher View Wxx grouping now use that one
  field. Future work stays visible in the bell but is excluded from its red
  count, and next week's progress replaces This Week only after the current
  week is complete or empty. Added a dry-run-first teacher backfill for legacy
  `assigned_at` records.
- Made Teacher practice Back context-preserving: returning from a View matrix
  preview now restores the same filters, matrix density, grouped-progress
  expansions, page position, and internal matrix scroll/visible-column anchor,
  without restoring the entry confirmation dialog. IELTS exam Back controls
  remain in their existing top bars.
- Added an account-scoped, answer-stripped IndexedDB snapshot for faster Teacher
  workspace paint, followed by authoritative CloudBase revalidation. Visible
  Teacher View progress now refreshes automatically while preserving the
  current spatial context, and explicit logout removes the private cache.
- Added the My Words-style browser pronunciation button to every Vocabulary
  Learn word card and Spell row. Both use local `en-GB` speech synthesis; Spell
  playback does not reveal or fill the hidden answer, and no backend or audio
  asset is required.
- Replaced the oversized student My Words surface with the approved compact,
  vertically centered modal. Search and Add now share matching top-right icon
  controls, Close sits outside below the card, manual entry is one Enter-to-save
  field, and review states/filters were removed. Word rows now use centered
  equal English/Chinese halves with a vertical divider, while pronunciation
  appears beside the phonetic only after expansion.
- Replaced the Student Library's always-visible gold sub-filter row with a
  title-inline `Library / current category⌄` control. Its anchored neutral
  popover closes after selection, outside click, or Escape and stays synchronized
  with category changes triggered by search or the Practice/Exam switch.
- Replaced the Student Dashboard's separate completion and four-week progress
  cards with one compact weekly-focus surface. It preserves the greeting and
  motivation, conditionally shows a muted-red overdue share, always shows
  China-time weekly completion from teacher-planned assignments, excludes
  self-study STAR records, and opens scope-filtered Assignment lists.
- Unified Teacher page-level modal behavior so notifications, attempt details,
  Student lookup/create, Review/Argue, assignment pickers/editors, matrix
  details, and practice-entry confirmation stay centered in the current
  viewport, use internal scrolling, and return to their parent surface on
  Close, Escape, or backdrop dismissal.
- Simplified Teacher Student lookup to direct row selection with an in-place
  search control, corrected the student-picker overlay stacking, kept Teacher
  navigation above workspace content, and normalized the raised-hand icon and
  header-logo sizing.
- Added practice-entry confirmation before Teacher View matrix task-header
  navigation and made the matrix responsive/user-resizable with `−`, `Fit`, and
  `+`; phone portrait can fit the normal six-to-seven-task overview while wider
  modes retain horizontal scrolling and full labels.
- Fixed Student assignment modal return/focus behavior when practice-entry
  confirmation is dismissed, while confirmed navigation still opens the
  selected assignment.
- Added `my-words-modal-preview.html` as an isolated, unlinked static design
  reference for the compact My Words modal. It contains sample-only data and
  does not call CloudBase.

Audit scope: commits `1f3fbec` through `4fcaa3d`, plus the static My Words
preview artifact committed with this documentation pass. All changes are
static frontend/documentation changes; no CloudBase function deployment or
data import is required.

## 2026-07-14

### Changed

- Removed the visible `STUDENT ENTRY` eyebrow from the login form while
  retaining its screen-reader heading and all existing authentication controls.
- Added an explicit rounded clip to the Teacher View matrix scroll viewport so
  sticky and colored header layers cannot leave small square tips inside its
  top-left or top-right corners.
- Moved the shared black full-body cat logo from the far right to the far left
  of both authenticated Student and Teacher headers, leaving all utility and
  account controls grouped on the right.
- Replaced the Student Dashboard's top-left line-art cat with the solid black
  full-body leaping-cat logo and placed the same mark at the far right of both
  authenticated Student and Teacher headers. The logo has a restrained idle
  motion, a reduced-motion fallback, and does not change existing header
  control hooks or behavior.
- Fixed the Teacher View matrix's phone-portrait `DUE AT` row alignment by
  making sticky first-column cells fill the shared grid track and applying the
  same compact padding, font size, and row height to `Student`, `DUE AT`, and
  Wxx cells below the 760px breakpoint.
- Applied the shared Liquid Glass presentation shell to login, public Library,
  Student Dashboard, and Teacher, then added spatial workspace layouts for the
  authenticated Student and Teacher surfaces without changing backend state or
  practice-runtime designs.
- Tightened desktop/mobile login and Dashboard spacing, kept the login page's
  randomized motivational quote, and refined Student notification, assignment,
  progress-loading, and practice-entry interactions.
- Refined Teacher View layout, Due/Wxx alignment, default View restoration, and
  grouped notification behavior while preserving the existing assignment,
  attempt, and unread-state rules.

Audit scope: commits `9f0b9b6` through `bd5c85d`. These changes are static
frontend/documentation updates only; no CloudBase deployment or data import is
required.

## 2026-07-13

### Changed

- Fixed BBC post-submit result colors so correct answers remain green and wrong
  answers use the Vocabulary-style light red; the yellow MC lock reminder no
  longer overrides known correct/wrong feedback.
- Allowed Login IDs to be reused after a completed student account deletion.
  Deleted profiles now keep the original ID in an audit snapshot and use an
  internal archive key, while recreated accounts receive a new `auth_uid` and
  do not inherit the deleted account's history.
- Added direct student-name editing to Teacher Student Detail so spelling
  corrections no longer require deleting an account.
- Renamed the Teacher View matrix's sticky `Due` label to `DUE AT` and matched
  its text edge, padding, font size, and weight to the `Student` header above;
  the shared grid already provides identical column boundaries.
- Matched the Teacher View matrix's sticky `Due` cell to the colorful
  Student/task header surface, and normalized the full Due/Wxx row's font,
  centering, height, padding, and borders to keep every column aligned.
- Limited the Teacher notification card to roughly three-quarters of the
  viewport height with internal scrolling, and replaced its top-right `x` with
  a centered external `Close` capsule below the card.
- Fixed Teacher View's `Due` row so every assigned task displays the `Wxx`
  grouping label moved from the old header position, including legacy tasks
  without a `due_at` value.
- Removed `Wxx` from the first Teacher View header row so it contains only the
  task ID and set name, and restored header clicks as direct task-preview links.
  The separate `Due / Wxx` cells now open the class-wide parameter editor for
  due date, passing, mastery, Earn STAR, and the other assignment settings.
- Made student-bell assignment rows shorter and fully clickable. The rows now
  keep a compact type label, a one-or-two-line title, an optional finished score,
  and a directional cue instead of separate `Start` / `Open` buttons; opening a
  row uses the shared Library practice-entry confirmation before navigation.
- Unified the teacher header bell, Argue hand, and student-card controls as
  matching 40px circular icon buttons. All three now share the same surface,
  hover/focus treatment, 20px icon size, and 2.2px non-scaling line weight;
  the hand and student-card artwork were adjusted for equal visual weight.
- Refined the student Dashboard monthly-progress loading state: the four-week
  grid now advances through a staggered diagonal cell wave, and the detail side
  uses one large loading capsule with `Loading progress` inside instead of two
  stacked capsules plus separate text.
- Reworked teacher notification rows with a fixed right-side latest-score
  capsule matching By student, single-line ellipsized task labels, and colored
  attempt-count capsules placed immediately before the date/time.
- Replaced the teacher notification modal's text heading with an action toolbar.
  `Read all` is now a left-aligned accessible double-check icon with pending,
  success, unread, and disabled states; Close remains on the right and the
  middle space is available for future controls.
- Added `Next week - Wxx` to the Teacher View Date filter, using the next
  Beijing-time Monday-to-Sunday range from assignment `assigned_at`.
- Added a full-width Due row immediately below the original Teacher View task
  header: its first cell reads Due and each task cell shows only Wxx. Clicking a
  Due/Wxx cell opens one bulk parameter editor for the current class/visible
  column, covering assign week, due date, passing, mastery, and Earn STAR across
  all represented students; task-header clicks open the task itself.

## 2026-07-12

### Changed

- Made shared My Words lexicon joins resilient: dictionary lookups now use
  CloudBase-safe batches of ten and fall back to per-word reads instead of
  silently leaving every card in a pending state when one batch fails.

- Simplified collapsed My Words cards to word, part of speech, Chinese meaning,
  and pronunciation, with details on expansion; added New/Learning/Mastered
  states and rule-based daily reveal-and-rate review without AI calls.

- Changed shared practice `Back` navigation to use one verified browser-history
  step when the previous same-origin page matches the safe return target. This
  restores the existing Library/Dashboard instance through back-forward cache,
  while direct links and uncertain history still use the safe URL fallback.

- Unified student and Teacher View `By student` monthly-progress task details
  with the teacher matrix visual hierarchy: full wrapping task titles now take
  priority, with compact task-type and best-score metadata aligned together on
  the right for iPad and smaller layouts.

- Upgraded My Words with immediate-save dictionary enrichment, a shared curated
  and optional ECDICT lexicon, cached external English dictionary fallback,
  phonetic/POS/definition display, pronunciation, retry throttling, and import
  tooling for the shared lexicon.

- Made Teacher View matrix task headers open their corresponding teacher
  practice preview and return to Teacher View.

## 2026-07-11

### Changed

- Made completed-task capsules in the student Dashboard four-week progress
  board reopen their task through the shared practice-entry confirmation.

- Simplified IELTS Reading set headers and paragraph-matching choices, made
  typed blanks follow answer length, and persisted both passage and question
  highlights in browser storage with per-highlight and clear-all controls.

- Added Vocabulary content/grading version handshakes and server-side answer
  snapshots for countable tests. Stale pages are rejected before grading,
  active tests retain their start-time grading rules, drafts are isolated by
  content version, and release checks now validate all Vocabulary JSON/JS,
  Word Bank, and question-key structure.
- Added a teacher-only, dry-run-first historical repair for Vocabulary
  content-version mismatches. It identifies whole attempts from multiple legacy
  answer signatures and regrades only upward while preserving original history.
- Locked CloudBase SDK versions and changed cloud-function ZIP generation to
  bundle reachable runtime dependencies. Deployments no longer drift with npm
  range resolution or exceed the CloudBase code-unzip limit because an online
  installer expanded the full SDK dependency tree.

- Changed the student Dashboard progress board so the completion meter centers
  its `Finished / total` value, week labels open weekly completion summaries,
  blank selections stay visually quiet, and loading states reserve the meter and
  board layout before dashboard data arrives.
- Changed student Dashboard assignment reminders to live in the top-right bell:
  the bell now opens a message center with open assignments, finished
  assignments, and teacher replies, while open-assignment counts only clear when
  assignments are completed.

## 2026-07-10

### Changed

- Changed the student Dashboard top billboard into a four-week progress board:
  students now see recent completion squares with weekday/week labels, summary
  counts, and a selected-day completion detail pane before the assignment list.
- Changed the Dashboard billboard summary from three separate count cards into
  one completion progress bar, and expanded the randomized greeting and
  motivational copy shown above the progress board.

## 2026-07-09

### Added

- Added shared practice navigation with explicit `Back` and `Home` controls.
  Student practice returns now use safe same-origin `return` targets from
  Dashboard or Library, while teacher previews return to Teacher Library.
- Added static no-answer worksheet PDF downloads for all current BBC listening
  lessons, exposed through a top-corner `Download Practice` button on
  `bbc.html`.
- Added exam-style no-answer worksheet PDF downloads and fold-and-cover
  wordlist PDF downloads for all current NGSL, NAWL, Oxford5000, and THINK2
  Vocabulary units, with full-unit download links and generated single-set PDF
  files.
- Added a Vocabulary `Practice` download dialog with `Confirm` for the static
  full worksheet and `Customise` for selected-group worksheet PDFs, including
  per-group word-bank/question shuffling from a visible randomiser seed.
- Updated the Vocabulary PDF controls to use document/download icons with
  `Wordlist` and `Practice` labels, and removed the per-set download button from
  inline Study Set practice.

### Changed

- Changed Vocabulary inline practice `?` explanations so students can reveal a
  question's answer and explanation before clicking `Check`; private-answer
  units load only the selected question's feedback from the backend.
- Changed practice and catalog static-data fetches to use the public
  `appVersion` cache key instead of timestamp cache busting, so normal browser
  caching and back/forward restoration can keep practice pages faster while
  still refreshing after version bumps.
- Added a Teacher Assign task-parameters area for Week/Date scheduling,
  passing percentage, and explicit `Earn STAR` selection. New assignments now
  default to no STAR earning unless the teacher checks `Earn STAR`; checked STAR
  assignments require `Mastery %`.
- Changed Teacher Assign pickers so Work and Students can be chosen in either
  order. The opposite picker now color-codes prior assignment state, disables
  open `in_progress` pairs, and keeps completed pairs selectable for
  reassignment.
- Changed Teacher Assign selected Work/Students summaries to show one selected
  item per row with a small remove control, and removed the student picker's
  `Select filtered` bulk-select button.
- Changed Teacher Assign task parameters into a per-selected-task matrix. Each
  task now has its own date/week, passing percentage, and optional Earn STAR /
  mastery setting in the same Assign submit.

## 2026-07-08

### Added

- Added `THINK2-U12` as a TK2 Vocabulary unit with 36 words, 4 quiz groups, and
  private CloudBase grading data.
- Added `Oxford5000-R`, `Oxford5000-S`, and `Oxford5000-T` as Oxford5000
  Vocabulary units, covering words `1701-2000` with 30 quiz groups and private
  CloudBase grading data, bringing Oxford5000 coverage to `001-2000`.

### Changed

- Changed NGSL, NAWL, and Oxford5000 Library task capsules so the eyebrow reads
  `vocabulary` and the top-right metadata shows the source word-number range,
  while keeping the main card title unchanged.
- Changed Student and Teacher Library BBC practice entry points from one `BBC`
  sub-filter into `BBC2024`, `BBC2025`, and `BBC2026` year-specific sub-filters.
- Changed BBC Argue question controls from an orange `!` to a raised-hand SVG,
  and added the student's submitted answer to the `Tell me why.` dialog before
  the reason textarea.
- Fixed BBC completed-attempt entry so a passed/mastered history URL can
  automatically render Explain and Argue controls without requiring students to
  press `History` first.
- Added a BBC `classroom-worksheet` render theme and applied it to the 2024 BBC
  lessons for review, giving those pages a worksheet-style paper layout with
  serif exam-style lesson titles, compact question numbering, boxed fill-in
  blanks, a default `Notes` fill-in section, section-local text-size controls,
  separated fill-in rows, rounded multiple-choice option boxes, and
  English-name-only student identity in the audio bar.
- Changed the Vocabulary mode switcher label from `Use` to `Cloze`, aligned
  Cloze timing to 90 seconds per selected group in the frontend and
  `submitAttempt`, and removed empty `None selected` / `Nothing selected`
  placeholders from the Teacher Assign work/student pickers.

## 2026-07-07

### Added

- Added `Oxford5000-A`, `Oxford5000-B`, `Oxford5000-C`, `Oxford5000-D`,
  `Oxford5000-E`, `Oxford5000-F`, `Oxford5000-G`, `Oxford5000-H`,
  `Oxford5000-I`, `Oxford5000-J`, `Oxford5000-K`, `Oxford5000-L`,
  `Oxford5000-M`, `Oxford5000-N`, `Oxford5000-O`, `Oxford5000-P`, and
  `Oxford5000-Q` as the first Oxford5000 Vocabulary units, covering words
  `001-1700` with 170 quiz groups and private CloudBase grading data.
- Added countable Vocabulary Test integrity sessions through
  `vocabulary_test_sessions`: 5+ group tests now create a server session before
  questions appear, heartbeat while active, validate `test_session_id` on
  submit, and grade the session's recorded question IDs.

### Changed

- Restored the current NAWL vocabulary units in Library while keeping old
  superseded NAWL letter records retired in CloudBase.
- Changed Student and Teacher Library to use only `Practice` and `Exam` as
  top-level filters, with lesson sections folded into Practice.
- Split Vocabulary surfaces into `NGSL`, `NAWL`, `TK2`, and `Oxford5000`
  capsules/labels in Student Library, Teacher Library, Teacher Assign filters,
  Teacher View matrix type filters, and student assignment cards; removed the old Library
  `Vocabulary`, `Grammar`, `Writing`, and `Grammar Lessons` sub-filters.
- Changed teacher notification read behavior: opening the bell clears the
  header badge, while red attempt rows remain until the teacher opens a related
  attempt for that same student assignment.
- Changed countable Vocabulary Test anti-cheat behavior so switching apps/tabs,
  hiding/leaving the page, heartbeat timeout, or session expiry abandons the
  session without recording an attempt or changing assignment status.
- Changed the Vocabulary Test start confirmation to remind students to turn on
  Do Not Disturb before starting.
- Changed Vocabulary Use timing from 2 minutes per selected group to 1.5
  minutes per selected group.
- Changed the Vocabulary Test interruption notice to show a clear `Close`
  dialog when a student returns after leaving the page or switching windows.
- Changed Teacher Assign success feedback from the small page message line to
  a standalone checkmark dialog with a bottom `Close` button.
- Fixed Vocabulary Test `Redo` so the Start button returns to a clickable
  `Start` state after clearing a completed review.
- Blocked other devices or browser page instances from student cloud-backed
  features while the same account has an active countable Vocabulary Test.
- Changed the client page-instance identifier to per-page-load memory state so
  cloned/new tabs cannot inherit the active test's owner ID.

## 2026-07-03

### Changed

- Changed Teacher View matrix assignment columns to show `Wxx` week labels based
  on Beijing-time assignment dates, with `W00` before the year's first Monday,
  and to keep repeated assignments of the same set as separate columns.
- Replaced the teacher student enable/disable UI with account deletion: deleting
  removes the CloudBase Auth end user, marks the student profile deleted, and
  hides the student from teacher-visible lists and progress surfaces.
- Changed Teacher View matrix date filtering to use Beijing-time natural weeks
  based on assignment `assigned_at`, and added a separate `Self study` date
  option for records without an assignment.
- Changed new Vocabulary assignments to default to STAR earning disabled; a
  teacher must turn `Can earn STAR` on from View before the assignment can
  become mastered / earn STAR.
- Changed Teacher View matrix cells so completed assignments with STAR earning
  disabled show a green check instead of a star.
- Changed teacher notification attempt details to render outside the
  notification list scroll body, preventing the first-open dialog from
  appearing unusually short.
- Changed finished Vocabulary assignment cards to open the Learn entry like
  Library cards instead of automatically entering Test/History mode.
- Refined Vocabulary Learn so numbered group capsules stay in a sticky learning
  bar while the word bank appears only after `Go to Practice`, expands and
  collapses more slowly, omits extra labels and controls, and collapses when
  students scroll back into the word-card area.
- Changed Vocabulary inline practice so `Check` turns into a score plus inline
  `Redo`, removes `Clear All` and floating Redo controls, and writes answer
  feedback directly into each blank.
- Changed Vocabulary inline practice choice panels to shuffle word choices per
  question, preventing the visible choice order from matching the answer order.
- Refined Vocabulary inline practice feedback: wrong answers use a static
  light-red state, the score shows only correct/total, action pills are
  centered, and the per-blank choice panel opens as a floating overlay with a
  final blank underline chip instead of a `Clear` button.
- Changed unanswered wrong Vocabulary inline practice blanks to display `X`
  instead of `No answer`.
- Restored Vocabulary inline practice explanations for local checks.
- Changed Vocabulary inline practice explanations to use always-visible `?`
  buttons with floating popovers, and removed the wrong-card pulse animation.
- Changed Vocabulary inline practice so every question card renders the `?`
  explanation button, even before the popover is opened.
- Refined Vocabulary Test mode with a sticky numbered test-set bar and inline
  timer, number-only test-set labels, Learn-style inline answer feedback after
  submit, a `Submit` button label, a top timer position that becomes `Redo`
  after submission, and a centered top correct/total result.
- Refined Vocabulary Test mode so the sticky test-set bar includes the current
  set's word bank below the numbered capsules and updates both the active
  number and word bank while scrolling between test sets.
- Refined Vocabulary question explanation controls so sticky Learn/Test word
  banks layer above `?` buttons while scrolling, `?` buttons stay optically
  centered on iPad, and Test results show only the direct correct/total count.
- Refined Vocabulary Learn/Test sticky word banks with a triangle toggle that
  preserves the student's manual open/closed choice, and hid Test explanation
  `?` buttons until submission or history review.
- Refined Vocabulary Learn/Test sticky bars to sit as an opaque top layer while
  scrolling, made Vocabulary Use set capsules gold-glowing with centered gold
  test-card set badges, and let Test prompts use full width before post-submit `?`
  explanation buttons appear.
- Refined Vocabulary Test number rows so larger selected test ranges scroll
  horizontally while the timer stays fixed at the right.
- Refined Vocabulary Learn/Use word-bank controls so the triangle sits in a
  fixed far-left rail outside the horizontally scrolling number capsules, while
  Use keeps the red countdown timer at the right and shows `Redo` there after
  submission.
- Changed the Vocabulary mode switcher labels to `Learn`, `Spell`, and `Use`
  while preserving the existing underlying spelling and timed-test flows.
- Fixed Vocabulary inline practice `Check` so local-answer units no longer call
  CloudBase, and legacy units show a friendly login/session message instead of
  the raw `t.scope` SDK error.
- Removed auto-numbering from Vocabulary practice word-bank chips and removed
  the plus/minus font controls from vocabulary practice cards.

## 2026-07-02

### Added

- Added assignment-level `mastery_enabled` support so teachers can turn off
  future mastered/STAR earning for selected assignments while still allowing
  passed / FINISHED completion.

### Changed

- Vocabulary assignments opened from the student dashboard now land on the
  normal learning entry first instead of automatically restoring/entering Test
  mode.
- Merged the Vocabulary word list and practice flow into `Learn`: numbered
  Study Set filters now expose inline `Go to Practice` practice cards, with a
  score shown beside `Check Answers`.
- Removed the duplicate in-view Words heading and search box from Vocabulary
  Learn.
- Removed the student Vocabulary bottom-right `Show Answers` capsule while
  keeping the submitted Test review `Redo` capsule.
- Raised the student `Change password` dialog above the account panel so it is
  the topmost surface after opening from the profile menu.

## 2026-07-01

### Changed

- Updated teacher View matrix filters so `Class`, `Column`, and `Date` default
  to all records in one compact unlabeled row; date filtering now offers
  `This week`, `Last week`, and `All time` based on assignment time, and
  unclassed student options show the student name without an `Individual`
  prefix.
- Added a compact paper icon button to each teacher matrix/notification attempt
  card so teachers can open that attempt's full-work review, including all
  recorded questions, submitted answers, correctness, correct answers, and
  attempt-history context.
- Added a sticky Study Set filter row to Vocabulary Words so students can jump
  between `All` words and numbered study-set word groups while keeping search
  scoped to the selected group.
- Updated BBC history review so passed/mastered historical attempts
  automatically show per-question Explain/Argue icon entry points on entry,
  while below-passing attempts keep those actions hidden.
- Fixed BBC multiple-choice question spacing so the stem and choices use the
  available width on iPad/tablet layouts instead of reserving action-button
  space before the buttons exist.
- Updated My Words so students can save selected text from answer/explanation
  content and manually add a word or phrase from the My Words dashboard view.

## 2026-06-30

### Fixed

- Fixed BBC finished-assignment review so multiple-choice answers are restored
  and locked after the first submitted attempt, preventing students from
  changing MC choices when reopening finished work.
- Changed teacher bell attempt details to use the same modal layout as View
  matrix cells, showing the full attempt history while scrolling to the
  clicked attempt.
- Kept teacher matrix-style modal Close actions fixed at the bottom while
  long attempt histories scroll above them.
- Changed submitted Vocabulary Test review to use the bottom-right floating
  `Redo` capsule and removed the old page-bottom Redo button.
- Updated teacher assignment creation so prior completed Library/Explore work
  initializes the new assignment as already passed or mastered, making it
  visible as completed in teacher progress views.
- Updated BBC practice so desktop Space toggles audio when no answer/control is
  focused, moved BBC Explain/Argue into compact question-box `?`/`!` icon
  buttons, and changed the teacher Review icon to `!`.

## 2026-06-24

### Added

- Added audio-to-submit timing for audio practice attempts and displayed
  teacher attempt timing as `Page ... · Audio ...` when available.
- Moved teacher student lookup into a top-right standalone modal with an
  internal create-student `+`, leaving the View page focused on the matrix.
- Changed teacher View `By student` groups into a full-width student history
  list where each task shows its best percentage and opens the same matrix
  detail modal used by matrix cells.
- Changed the teacher header student entry to a circular student ID icon and
  fixed the lookup modal's Choose/Search student list so it expands and scrolls
  inside the modal.
- Removed the teacher View `By class` progress mode, made the remaining
  `By student` / `By task` capsule sticky over the main View tabs, and changed
  `By task` summaries to show only Total and an Avg that excludes unfinished
  assignments.
- Changed teacher View `By task` score bars to open the same independent
  detail modal as matrix cells instead of expanding inline details.
- Added an independent student timeline modal from the matrix student-name
  column so teachers can inspect a student's overall assigned-work history.

## 2026-06-23

### Added

- Added assignment-level teacher management for selected assignment records,
  including due date, passing percentage, mastery percentage, and soft
  cancellation of open assignments.
- Added backend `cancelled` assignment state with audit fields. Cancelled work
  is hidden from the student dashboard and teacher View progress, rejected by
  old assignment submit links, preserves historical attempts, and does not
  block reassignment.
- Made the teacher page open to `View` by default and added a textless animated
  matrix loading state with visible grid lines and a centered spinner.
- Added a soft fade/lift transition for the first successful teacher matrix
  render so loaded data does not appear abruptly.
- Restyled the teacher interface with the selected warm animated rainbow theme
  while keeping progress status colors readable.
- Added compact spinner loading states for the teacher header icon buttons and
  removed separate rainbow underline accents from header capsules.
- Reduced repeated rainbow fills in grouped progress items below the teacher
  matrix so student capsules and stats stay visually quiet.
- Restored the teacher matrix cell detail as an independent page-level modal
  and kept the grouped progress mode tabs visually quiet.
- Widened the teacher page shell on desktop so the default View matrix adapts
  to available horizontal space.
- Added lightweight BBC MC option click feedback: a soft bell sound and a
  right-side `✦` marker, with the blue render theme using a blue marker.
- Fixed the teacher View matrix layout so wide task sets scroll horizontally
  inside the matrix card instead of widening the whole page.
- Updated teacher View matrix interactions so touch devices can still scroll
  the page vertically, notification attempt details open independently of the
  matrix, and unclassed students can be filtered as individual Class options.

### Fixed

- Fixed student and teacher practice-entry dialogs so they close before
  navigation and do not reappear when browser Back returns from a practice page.

## 2026-06-22

### Changed

- Simplified the teacher View matrix toolbar to only `Class`, `Column`, and
  `Date`, with `Date` defaulting to `This month`.
- Adjusted teacher View matrix status colors so `Not yet` is neutral white,
  while `Passed` and `Mastered` share the same green cell background;
  `Mastered` uses a solid green circle with a white star.

### Fixed

- Fixed BBC History result coloring so server-adjusted correct answers from
  Argue/backfill clear stale wrong and local lock classes before rendering.
- Fixed teacher bell attempt notifications so retry attempts can open the View
  matrix detail even when the assignment completion date differs from the
  clicked attempt date.

## 2026-06-21

### Changed

- Adjusted the student Assignments navigation count to float outside the glass
  tab and added a stronger golden glow to the `Show Finished` capsule.
- Simplified the student account panel footer into two small action capsules
  and removed the `Password change required` account-panel field.
- Changed `Show Finished` to stay bottom-docked while collapsed and reveal
  finished work with the selected golden ribbon effect when opened.
- Moved student account-panel stars onto the name row and normalized profile row
  height/divider spacing.
- Changed practice-page return controls from `Home` to confirmed `Back`
  behavior that returns one browser-history page with a dashboard fallback.
- Tightened the teacher View matrix student-name column so it sizes to the
  visible names instead of reserving a wide fixed column.
- Changed teacher View matrix status cells to the selected icon-plus-color
  treatment: orange `Not yet`, green check `Passed`, and glowing gold-star
  `Mastered`.
- Added a front-end Vocabulary Test lock flow: start warning dialog, locked Test
  view while timed work is active, early-submit confirmation, time-up automatic
  submit, and post-result wrong-question marking.
- Changed Vocabulary Test post-submit review so the result modal has only one
  Close action, wrong questions reveal inline explanations, and Redo is a
  separate confirmed action from the reviewed test page.

### Fixed

- Fixed BBC History from the student Library entry by letting `bbc.html` resolve
  the current student's best attempt for the set when the URL does not include
  `history` or `assignment` context.
- Returned the resolved `assignment_id` from `submitAttempt` so a Library-opened
  assignment submission can keep follow-up answer reveal actions linked to the
  assignment.
- Added a Close action to the BBC Argue sent/thanks dialog for both student
  submissions and teacher-preview Argue submissions.
- Changed teacher Argue `add`/`replace` resolution to automatically scan
  historical attempts for the same set/question/submitted answer and apply
  upward-only score, assignment, and STAR repairs.
- Added a teacher-only paginated `backfillAcceptedAnswerRegrades` action for
  repairing historical attempts against current grading keys after older Argue
  approvals.

## 2026-06-20

### Changed

- Changed the student Assignments `Show Finished` / `Hide Finished` control
  from a stamp treatment to a lower-positioned gold capsule matching the
  Library badge style.
- Changed the student dashboard top billboard to a pale aurora-rainbow
  animated background while keeping its existing content and layout.
- Changed the student main navigation and student Library category tabs to a
  soft translucent glass style with subtle rainbow active states.
- Standardized message and unread reminder dots/badges to red across student
  and teacher surfaces.
- Changed the teacher create-student modal to a vertical field layout and added
  a checkmark confirmation dialog after successful account creation.
- Renamed the teacher `Tasks` tab to `Assign` and changed the top-right Review
  entry to a question-mark icon button.
- Simplified teacher `Assign` so the main surface shows only selected work
  and student chips, while search, filters, and candidate selection live in
  standalone picker dialogs.
- Updated teacher `Assign` to merge visible static catalog items missing from
  CloudBase `sets` as disabled import-required rows, so newly published BBC
  lessons are visible while CloudBase import state is checked.
- Increased teacherAdmin content read limits for `sets` and `grading_keys` so
  teacher Assign/View surfaces still resolve content after repeated CloudBase
  imports push collection counts beyond 200 records.

### Fixed

- Updated `submitAttempt` so Library/Explore submissions automatically attach
  to the student's open assignment for the same `set_id` when the browser does
  not pass an `assignment_id`.
- Replaced fixed first-page backend reads in `teacherAdmin`, `getDashboard`,
  and `getResources` with paginated reads for assignment, attempt, set, student,
  dispute, and STAR data.
- Changed assignment submission to recompute assignment summary fields from
  linked attempts after recording an attempt, reducing stale summary and
  duplicate-click race issues.
- Updated teacher progress display to derive finished status from linked
  attempts when assignment summary fields are stale.
- Updated the teacher View matrix to render every student matching the current
  filters instead of only the first 12 sorted rows.

## 2026-06-19

### Changed

- Simplified student Assignment task capsules to match Library card density and
  replaced the finished drawer control with a sticky stamp-style `Show
  Finished` / `Hide Finished` entry without counts.
- Made student Assignment cards open the original task when the card body is
  clicked, while preserving explicit button actions.
- Split the student account panel STAR row into yellow assigned-task stars and
  blue self-study/library stars.
- Changed finished Assignment card actions from `Improve Accuracy` / `Beat Your
  Best` text buttons into clickable `PASSED` / `MASTERED` stamps.
- Removed `Go` buttons from student/teacher Assignment and Library capsules so
  the whole capsule opens the practice item while explicit secondary buttons
  keep their own actions.
- Simplified teacher `Assign` into two minimal multi-select panels: `Work` with
  search and `Column`, and `Students` with search and `Class`.
- Moved teacher Review out of Tasks into a top-right icon button that opens an
  independent modal with Pending, Approved, and Rejected tabs.
- Changed the teacher notification bell into a standalone attempts-only modal;
  clicking an attempt opens the matching View matrix detail and highlights that
  specific attempt.
- Reversed the top-right create-student `+` styling to the same light button
  with purple icon treatment as the Review and notification buttons.
- Aligned teacher Assign Work-list ordering with the matching Library column's
  natural date or numeric sort.
- Expanded teacher matrix detail dialogs with answer-view lock status and a
  latest-attempt wrong-answer comparison table.
- Redesigned teacher matrix detail dialogs around a title/pill header,
  clickable attempt score bars, and newest-first wrong-answer attempt cards.
- Refined teacher matrix detail bars: centered the outside Close button,
  prevented single attempts from stretching full width, and mapped bar colors
  to not-passed, passed, and mastered states.
- Simplified teacher matrix score-lock pills so the lock icon appears only
  after answers have been viewed and locked.
- Redesigned the student login page around a bright floating-paper welcome
  ritual with lightweight listening, vocabulary, writing, and speaking motion
  elements.
- Added task names under task IDs in the teacher View matrix header.
- Moved the create-student shortcut into the teacher Personal Center, centered
  the panel title, and removed the account status row.
- Moved create-student to a single top-right header `+` beside notifications
  and changed account creation into a standalone modal.
- Replaced the task-entry browser confirmation with a shared custom dialog for
  student Assignment/Library and teacher Library capsules, including status and
  best-score reminders.

## 2026-06-18

### Changed

- Refactored the student dashboard around `Assignments`, `My Words`, and `Library`.
- Moved student account actions and teacher replies into the top-right account/message controls.
- Replaced student assignment status tabs with a default TO DO list and a collapsed `Finished & Wins` achievement drawer focused on completed-count momentum.
- Refactored the teacher desk around `Tasks`, `View`, and `Library`.
- Moved teacher `Review` under `Tasks`, changed `Updates` into a notification bell, and added a progress matrix to `View`.
- Changed Vocabulary default thresholds to `80%` passing and `100%` mastery,
  while other current content keeps the `50%` / `90%` defaults.
- Added a failed Vocabulary Test result action that lets students return to
  group selection and start a fresh test.
- Unified student and teacher Library capsules, simplified DSE labels, moved
  student STAR counters into the account panel, and added class filtering to the
  teacher assignment matrix.
- Expanded teacher `View` with `By student`, `By class`, and `By task` progress
  groupings, low-to-high task score bars, clickable single-assignment details,
  and scoped due/pass/mastery editing for existing assignments.
- Standardized student and teacher Library ordering so BBC follows release
  date and IELTS follows Cambridge book, Test, then Section/Passage.
- Replaced the student Assignments achievement drawer summary with a smaller
  `Finished` completion button focused on total completed count.
- Moved the yellow IELTS book/tag visual treatment out of task cards and onto
  the Library sub-tab layer.
- Clarified IELTS Library card labels and simplified the student account panel
  into quiet profile rows with stars and finished count.
- Aligned student Assignment task capsules with the compact Library task card
  structure.
- Added class, recent-task count, and column controls to the teacher View
  matrix, removed the top summary cards from View, and made matrix cells open
  per-student assignment attempt details.
- Refined the teacher View matrix: `Recent` now defaults to 7, the toolbar has
  a `Date` basis selector, the student list shows names only, and clicked cells
  show teacher-only correct answers for wrong questions.
- Updated the teacher View matrix controls to `Class`, `Column`, `Recent`,
  `Date`, changed `Date` to week/month/custom range filtering, and moved matrix
  cell details into a floating dialog with a close button.
- Added front-end-only BBC `renderTheme` support and applied the `blue-studio`
  theme to `BBC-250619` and `BBC-250626` without changing grading IDs or
  attempt behavior.
- Adjusted My Words touch handling so mobile and tablet selection can show the
  site save button without leaving the browser's native selection callout over
  the interaction.
- Renumbered NAWL vocabulary units as an independent sequence from `NAWL-A` to
  `NAWL-J`, instead of continuing the NGSL letter sequence.

### Documentation

- Updated the UI/UX spec for the new student and teacher navigation model.
- Documented the independent NAWL vocabulary ID rule for future imports.

## 2026-06-16

### Added

- Added the human-readable documentation system under `docs/`.
- Added product requirements, architecture, UI/UX, data model, decisions, testing checklist, backlog, deployment/content/troubleshooting entries.
- Added `docs/09_CONTENT_WORKFLOW.md` and `docs/10_DEPLOYMENT.md` as numbered documentation entry points.
- Added owner-gated release helper scripts for verification, function packaging, and deploy-plan generation.
- Added owner-run CloudBase CLI content import helper with dry-run and insert-missing apply mode.

### Changed

- Moved product requirements into `docs/01_PRODUCT_REQUIREMENTS.md`.
- Moved technical repeated-issues log into `docs/11_AGENT_TROUBLESHOOTING.md`.
- Kept root-level pointer files for stable links.
- Replaced the root README with a current project entry point and document map.
- Updated `AGENTS.md` reading order and documentation update rules.
- Documented that agents may prepare release artifacts but must not execute CloudBase deployment without exact owner authorization.

### Fixed

- Backend source now keeps assignment status monotonic across lower-scoring retries.
- Teacher assignment source now allows completed/STAR work to be reassigned.
- Argue regrading source now creates or repairs STAR records when mastery is reached.
- Student dashboard/submit cloud functions now reject teacher profiles.

### Documentation

- Documented the intended long-term docs workflow.
- Documented repeated technical failure modes for future Agent handoff.

## 2026-06-15

### Added

- Added personal My Words feature with a `studentVocabulary` cloud function and shared selection UI.
- Added dashboard My Words panel.

### Changed

- Confirmed student dashboard uses `TO DO` and `FINISHED`, while backend keeps `to_do`, `passed`, and `mastered`.

### Fixed

- Fixed IELTS Listening teacher preview audio startup.
- Fixed mobile student assignment capsule layout.
- Blocked personal vocabulary saves from answer/result/feedback regions.

## 2026-06-13

### Added

- Imported BBC June/July listening lessons.
- Created Agent QA memory file.

### Changed

- Strengthened BBC import workflow and CloudBase import notes.
- Clarified Vocabulary runtime and fallback behavior.

### Fixed

- Fixed BBC blank placeholder length issue.
- Documented CloudBase JSON Lines import requirement.

## 2026-06-12

### Added

- Added Teacher Argue grouped task view.
- Added backend STAR and assignment mastery model.
- Added teacher Library answer preview through `teacherAdmin`.

### Changed

- Assignment statuses moved toward `to_do`, `passed`, and `mastered`.
- Student dashboard STAR count became backend-backed.
- Assignment thresholds can be set by teacher.

### Fixed

- Separated teacher answer reveal from student answer reveal.

## 2026-08-21 — Durable AI Tutor jobs

- Hid zero-data New Writing placeholders from History and portfolio counts. Leaving
  one now calls an owner-scoped, server-guarded discard action; abandoned empty rows
  are pruned after a short safety window without exposing general Composition deletion.
- Replaced inline sentence checks with explicit top-right `CORRECT ✓`, `REVISED ✓`,
  and `NEEDS REVISION ×` states. Navigation capsules now use semantic-green checks
  for completed sentences and semantic-red crosses for unresolved sentences.
- Moved each bare sentence number into a compact top metadata row so the sentence
  keeps the full card width. Flip cards now measure the active face and animate to
  its natural height, eliminating hidden-face blank space after a successful revision.
- Added two-layer Sentence Revision draft persistence: typing is saved locally
  per student/Composition/revision/sentence, while `Check` stages the submitted
  batch in `pending_rewrite_check`. Both layers survive refresh, disconnect, and
  failed checks and are cleared only after successful result publication.
- Replaced simultaneous analysis/input presentation with one mutually exclusive
  two-sided sentence card: analysis on the front, original sentence plus input on
  the back. Added keyboard semantics and a non-rotating reduced-motion state swap.
- Restyled Sentence Revision row numbers as BBC worksheet-style bare sequence
  numbers, replaced unresolved capsule dots with question marks, and made accepted
  cards open on the student's corrected sentence with an inline colored check.
- Unified effective sentences into the same bordered card system, aligned wrapped
  sentence text with a hanging number column, made the whole available card surface
  the flip target, removed instructional flip buttons, and replaced the reference
  control with a trailing `Sample` action.
- Migrated Sentence Revision `Check` from a synchronous browser-owned model call
  to a durable `writing_ai_jobs` rewrite-check job. Submitted rewrite text is
  staged only in `writing_compositions.pending_rewrite_check`; the queue remains
  metadata-only. The client now polls and restores queued/processing/completed
  checks across network loss, refresh, browser closure, and re-login without a
  duplicate provider call.
- Fixed first rewrite-result persistence when `rewrite_results` is `null` by
  atomically replacing the whole field with `db.command.set(...)` in the
  successful job transaction, avoiding CloudBase `PathNotViable` expansion.
- Renamed the three language-review cards to `Language Review`, `Draft`, and
  `Sentence Revision`. Simplified every sentence row to the original sentence,
  one consolidated Chinese grammar analysis, and the student input area; removed
  the capsule-row progress copy and instructional hint.
- Collapsed effective sentences in Sentence Revision to the original sentence and
  an accessible matrix-style circular SVG checkmark colored by sentence. These rows
  no longer show a grammar box or disabled revision input, while the server-normalized
  rewrite requirement remains the authoritative decision.
- Reduced each required sentence's grammar box to one paragraph of Chinese feedback.
  Removed the `Grammar Analysis` heading, issue-category labels such as `Word Choice`,
  and the separate issue, summary, and result rows.
- Unified every sentence capsule to one 1px solid outline and moved completion state
  to a tiny checkmark below the number. Added the one-based number before every
  Sentence Revision source sentence, and reduced the footer to one `Check` button
  without the former unfinished-sentence hint or arrow.
- Matched the AI Tutor `New` toolbar action to idle `History` with a white
  background and green text instead of a filled-green primary button.
- Restored the confirmed manuscript's paragraph flow in `Draft`. Sentence highlights
  now use keyboard-accessible inline fragments and keep boundary spaces/newlines
  outside the highlight, so multiple colored sentences remain in their original paragraph.
- Removed sentence-highlight underlines and changed the shared manuscript,
  capsule, and revision accent cycle to eight colors: blue, orange, purple, rose,
  indigo, coral, gold, and deep pink, keeping the site's primary green reserved
  for its existing meaning.
- Simplified AI Tutor to one top toolbar over card-based content. Removed the
  brand icon and `AI Tutor / Writing Studio` lockup, moved the portfolio control
  into that position, and made the left portfolio drawer initially collapsible
  across phone, iPad, and desktop. Toggle, close, scrim, and `Escape` now share
  the same close behavior.
- Added an application confirmation before the toolbar back arrow returns to
  Dashboard, explicitly preserving durable OCR and review work in the cloud.
- Added editable portfolio titles and a same-review-response AI suggestion of
  two to six English words for unnamed work. Student-authored titles are never
  overwritten; legacy `Untitled writing` can be renamed manually or filled by a
  later review, with no extra AI request or quota charge.
- Refined AI Tutor navigation with a red Back arrow and the shared compact
  `Cancel / Leave` Apple-style alert used by student practice surfaces.
- Made the sentence-number bar replace the primary toolbar at the top of the
  viewport, corrected phone-width overflow, and linked each manuscript sentence,
  number capsule, and correction source through one consistent color and scroll target.
- Reorganized the completed language-review screen into exactly three primary
  cards: Language Review, Draft, and Sentence Revision.
  Sentence Revision now uses a horizontally scrollable number navigator over
  one continuous list; removed the sequential/list switch and both layout icons.
- Required Simplified Chinese sentence commentary, explanations, and suggestions
  while preserving English source sentences and reference revisions.

- Fixed first-review persistence from `language_review: null` or
  `standardized_review: null` by atomically replacing nested result objects;
  CloudBase must not expand the initial payload into dotted child updates.

- Added `docs/adr/0003-durable-canonical-ai-boundaries.md` as the reusable incident log and release gate for future AI features; it records no credentials or student content.

- Fixed Qwen language-review rejection when the model normalized whitespace or punctuation in its echoed `original`;
  sentence IDs remain strict while the server restores the authoritative original text.

- Moved standardized-content and general-language evaluation off the browser request and onto the existing
  `writing_ai_jobs` queue, with stable operation identity, lease/retry recovery, active Composition guards, and
  terminal quota release.
- Added leave, refresh, re-login, and same-request retry UX for review work; entering language review preserves the
  prior standardized result on the same Composition.
- Kept manuscripts and AI feedback out of job rows; review jobs store metadata-only mode, Rubric, usage, and version scope.

## 2026-08-20 — AI Tutor Writing foundation

### Added

- Added the independent AI Tutor writing workspace and Dashboard entry.
- Added private multi-photo OCR, student confirmation, standardized content
  review, sentence language coaching, batch rewrite checking, and portfolio/profile data.
- Added strict versioned AI schemas and authoritative IELTS/HKDSE framework prompts.
- Added teacher per-student daily word limits, idempotent usage accounting, and
  metadata-only teacher email outbox/delivery function.
- Enabled Cambridge International AS & A Level English Language 9093 Paper 2
  with separate Shorter Writing, Reflective Commentary, and Extended Writing rubrics.
- Simplified student-facing framework names to IELTS Task 1/2, DSE Paper 2, and
  A Level 9093 task variants; hid General Training Task 1 from new selections.
- Added deterministic server derivation for overall scores, rewrite-required
  state, and rewrite acceptance; scoped idempotency keys to one Composition
  revision/mode/Rubric and made review-plus-usage finalization atomic.
- Preserved the standardized Rubric identity when a reviewed Composition moves
  into general language coaching.
- Replaced the vendor-specific model call with independently configurable text
  and vision adapters for mainland OpenAI-compatible providers, including local
  schema validation and one repair retry for JSON Object models. Stored safe
  model/protocol metadata with each AI artifact for future provider comparison.
- Made same-Composition replacement success-then-swap: candidate text is staged
  until the replacement review succeeds, so failed re-upload evaluation keeps
  the prior manuscript, reviews, and observations.
- Retained one logical evaluate/rewrite operation ID across lost-response retries
  to prevent duplicate model work and quota charges.
- Normalized Qwen OCR responses that contain one extra JSON string or
  single-item array wrapper before applying the same strict schema validation.
  Replaced the misleading client-side Network error with actionable OCR
  format/timeout guidance.
- Defaulted Qwen photo OCR to `qwen3.7-flash` when no separate vision model is
  configured, while keeping `qwen3.7-plus` for writing evaluation. This keeps
  OCR below the browser wait boundary without weakening the grading model.
- Made OCR tolerant of Qwen returning one structured object per photo page and
  added persisted OCR job state plus client polling. A browser request timeout
  now keeps waiting on the same Composition, and refresh/reopen resumes it.
- Replaced request-bound OCR with an `ADMINONLY` durable AI-job queue. Upload
  confirmation now enqueues OCR in the same server handoff; async dispatch plus
  a one-minute recovery worker survives tab/browser closure, retries transient
  failures with leases, and rejects stale results after re-upload.
- Added explicit leave-and-resume OCR UX and seven-day timed deletion for
  unconfirmed private photos. Corrected deployment verification to require the
  cloud function's final `Active` state after uploading a bundled ZIP.

# 2026-08-24：OCR uncertainty image overlay

- Added a separate strict OCR-location schema and prompt for indexed ambiguous spans, with explicit
  normalized-page coordinates and untrusted-image safety boundaries.
- Added server canonicalization and a bounded optional locator call. OCR transcription remains successful
  when locator timeout, provider, schema, or coordinate validation fails; no second durable job is created.
- Added accessible SVG page overlays linked to editor marks, responsive intrinsic-ratio layout, cache-busted
  Tutor assets, tests, and operational documentation.

# 2026-08-24：AI Tutor Waiting Experience V2

- Replaced generic waiting capsules with task-specific four-node progress
  tracks for OCR, review, rewrite, and Revision Scan.
- Added a local-only Runner Score, green collectibles, repeat/air/landing-buffer
  jumps, and one-time collision deductions; no Runner state crosses the browser
  page or durable AI boundary.
- Reworked browser polling to serialize `getComposition`, use visible/hidden
  cadence and transient-error backoff, wake on visibility/focus/online, and
  discard stale Composition/operation generations.
- Successful jobs now remain on a Ready card with one synthesized two-note cue
  and a student-clicked result action. Reopening a completed job is silent and
  does not stop the Runner before the click.

# 2026-08-24：AI Tutor source copy and staged camera flow

- Renamed the source controls to `Polishing`, `Brainstorming`, `Type`, and `Scan`,
  and changed the language-entry fields to `Title` (`Optional`) and `Your Writing`.
- Kept direct text entry as the default. Selecting photo mode now immediately
  invokes the native rear camera, then returns to a multi-page staging surface
  with explicit camera and photo-library additions.
- Preserved the eight-page preview/reorder/remove workflow and made the bottom
  green `Scan` the only action that uploads the batch and starts OCR.

# 2026-08-24：Action-first AI Writing home

- Replaced the permanent marketing hero and three feature explanations with an
  adaptive Writing workspace: newest unfinished Continue card, direct mode
  quick starts, three recent compositions, and real Writing Focus patterns.
- Added a compact `Writing` home toolbar state with remaining daily word quota,
  an asymmetric wide-screen grid, ordered phone layout, horizontally scrollable
  recent cards, restrained materials, press feedback, and accessible motion fallbacks.
- Made `createComposition` validate and persist the mode selected from the home
  quick-start cards so an immediate refresh cannot revert Brainstorming to Polishing.

# 2026-08-24：Stable Revision Photo staging

- Replaced the multi-column photographed-revision preview with a one-photo snap
  carousel and a centered live current/total indicator; removed the redundant
  `Revision Photos` heading and capacity-style `x / 8` display.
- Moved `Add Photo` beside each current photo's `Remove` control while preserving
  the eight-photo batch boundary and the single bottom `Start Scanning` commit.
- Reset the staging surface below the sticky toolbar after camera/library return,
  selected the newest addition, and capped preview height to prevent the retained
  bottom scroll and oversized single-image behavior seen on iPad and phone.

## 2026-08-27 — DSE Speaking Lab V1 foundation

Added local Speaking Lab domain contracts, authenticated gateway and durable
worker scaffolding, private upload/share boundaries, student and teacher
surfaces, external redacted report page, static contract tests, and
owner-gated packaging documentation. Production provider adapters remain
disabled pending real-audio benchmark and CloudBase deployment.

## 2026-08-27 — Reusable Tencent voiceprints

Added a server-only Tencent ASR voiceprint adapter with TC3 signing, strict
16 kHz mono-WAV validation, enrol/update/delete/verify/1:N operations, private
VIP/Discussion-scoped Guest lifecycle records, consent/audit events, and Guest
cleanup. Added student self-service and teacher VIP/Non-VIP recording surfaces
using one in-memory browser WAV recorder. The application retains no enrolment
audio or biometric embedding. Production collection creation, configuration,
function deployment, and provider smoke tests remain owner-gated.

## 2026-08-27 — Intensive Listening Library

Added the authenticated Intensive Listening catalog, safe server catalog
contract, dashboard capsules, linked BBC/IELTS entry points, assignment-aware
practice navigation, three-minute activity sessions, mixed Teacher bell rows,
and safe IL email summaries. Added importer metadata propagation and focused
local contract tests. Production indexes, data import, timer configuration,
and deployment remain owner-gated.

## 2026-08-30 — DSE Paper 4 Speaking Set Library

Added Set-first Speaking navigation, teacher Set editing with immutable IDs and
revision checks, frozen Discussion/report snapshots, five initial MOCK Sets,
and one-question 65-second Individual Response Sessions. Added a dedicated Part
B prompt/schema, private durable analysis pipeline, retry-safe student report,
Voiceprint sidebar navigation, public-build exclusion for Speaking Set source,
and focused service/UI/seed tests.

## 2026-08-30 — Apple-style Speaking Set card flow

Reworked the student Set library, selected-Set task view, and Individual
Response workspace into a restrained vertical card system aligned with the
Speaking report and Writing correction surfaces. Added clearer year/source
identity, Context/Part A/Part B wayfinding, direct action mapping, responsive
phone layouts, press feedback, material depth, and reduced-motion,
reduced-transparency, and increased-contrast fallbacks. Backend behavior and
stored Set/Response data are unchanged.

- Kept `Choose a Set` and the standalone Voiceprint card out of every opened
  Discussion workspace, including completed reports reached from the sidebar.

## 2026-09-01 — Student Dashboard welcome hierarchy

- Rebalanced the Achievements card so the time-aware student greeting reads as
  quiet context and the rotating motivational sentence becomes the primary
  medium-large heading.
- Added phone and tablet typography tuned independently for legible tracking,
  leading, and balanced wrapping without changing the Achievements calendar.
- Promoted the motivational sentence to the semantic `h1`, retained the combined
  live-region announcement, and cache-busted the shared workspace stylesheet.

## 2026-09-02 — Complete DSE Paper 4 Set library

- Added 306 visible PP practices for 2012-2019 and 2023-2026 with stable IDs,
  original adapted Contexts, four Part A points and eight Part B questions.
- Corrected the duplicated 2017 Set 4.1 Part B source list and added regression
  coverage for `Keeping the Elderly Active`.
- Retained but hid the five historical MOCK seeds, added student/teacher filters
  and bounded rendering, and changed Set lists to metadata-only projections.

## 2026-09-03 — Year-by-year Paper 4 content audit

- Cross-referenced all 306 Past Paper practices in twelve independent yearly
  audits using official HKEAA material where public, complete HKEAA-branded
  scans where available, and explicitly graded secondary/recalled sources.
- Replaced generic Context templates with 150–220-word topic-specific original
  mock articles that are clearly labelled as non-official.
- Corrected task contexts, titles, missing/replaced questions and printed Part B
  order while preserving all stable Set/point/question IDs and historical
  report snapshots. High-risk fixes include 2013 Set 10.1, 2017 Set 8.3,
  swapped 2023 Sets 1.1/1.3 and 2025 Set 6.1.
- Added durable audit evidence, a deterministic audit merger, regression checks
  for child-ID/order independence, and a guard against raw recall generation
  overwriting the reviewed library.
- Imported revision 2 into the development CloudBase `speaking_sets` collection:
  306 audited Past Paper practices are student-visible and the five retained
  historical MOCK seeds remain hidden.

### 2026-09-02 — My Words Scan V1

Added authenticated five-page photo intake with local crop/mask editing,
private per-page OCR jobs, canonical token/phrase review, resumable commit,
daily quotas, expiry, and worker cleanup. Existing My Words dictionary
enrichment remains the post-commit path. Main-agent review added draggable crop
handles, a mask-only eraser, monotonic candidate sync, transactional upload/
quota/commit guards, retryable cleanup, safe usage telemetry, and focused
behavior tests. Production rollout on 2026-09-02 created the three ADMINONLY scan collections and documented indexes, deployed the three related functions, enabled the private one-minute worker timer, and enabled Scan Words for all active students.

## 2026-09-02 — Natural mobile motivational wrapping

- Let the Dashboard motivational heading use the full available phone width and
  normal line-fill wrapping, preventing balanced text from creating an avoidable
  fourth line with conspicuous empty space on earlier lines.
- Retained balanced wrapping on tablet and wider layouts, and cache-busted the
  shared workspace stylesheet for the phone-only correction.

## 2026-09-02 — Matching Achievements summary numbers

- Styled the Active Days number with the same restrained green accent used by
  the Achievements total while keeping both labels muted.
- Preserved singular/plural labels and the existing compact live-region summary,
  and cache-busted the shared stylesheet and Dashboard script for the revised
  numeric markup.

## 2026-09-02 — Set detail and Part B modal recorder

- Collapsed the selected-Set identity into one `YYYY Past Paper · Set X.X` line
  and removed the duplicate PP badge row.
- Standardised the centred Part headings as `Part A - Group Discussion` and
  `Part B - Individual Response`.
- Replaced each Part B card's nested Start action with a full-card disclosure
  that opens the 65-second microphone recorder in a focused modal over the Set.
### 2026-09-05 — Listening V2 vertical slice

Added a unified Listening material chooser, separate Dictation/Shadowing
progress, server-only Shadowing scoring with Tencent SOE-N isolation, bounded
WAV validation/quota/idempotency paths, teacher material authoring actions and
editor, track-aware assignment records, and owner-gated seven-day cleanup.
Legacy Intensive Listening remains compatible and no CloudBase production
resources were changed. Main-agent review added server-timed playback credit,
pre-upload provider gating, a cross-tab single-take lock, transcript-safe word
feedback, non-completing Dictation reveal, separate Dictation/Shadowing email
sessions, direct per-line teacher controls, track enable switches, isolated
optimistic drafts, immutable publication history, and revision-specific
progress replacement. Final regression review also restored numeric Argue
pagination after the notification feed adopted compound cursors, moved Git
publication fixtures into a temporary object database, and raised Shadowing
selectors, navigation, and take actions to 44px touch targets. The final
provider audit also added Tencent's required `{"type":"end"}` text frame after
the one permitted `rec_mode=1` binary WAV message.

### 2026-09-05 — Listening V2 provider-disabled production rollout

- Published commit `dad41862` to GitHub `main` and deployed the complete static
  site to CloudBase Hosting.
- Created and verified all six Listening V2 collections as `ADMINONLY`, with the
  reviewed identity, lookup, quota, and cleanup indexes.
- Deployed `intensiveListening`, `teacherAdmin`,
  `sendTeacherAttemptEmails`, and `listeningMaintenance`; raised the two
  Listening timeouts to 30 and 60 seconds respectively.
- Added the six-hour `listeningMaintenanceEvery6Hours` timer and accepted the
  trusted native SCF timer envelope while retaining the private token fallback.
- Kept Tencent SOE-N scoring disabled and the score policy unapproved pending
  representative real-audio benchmarking and explicit owner activation.

## 2026-09-06 — Listening practice toolbar spacing

- Matched the narrow-screen Listening practice toolbar's top offset to the
  Writing and Speaking workspaces while preserving larger device safe-area
  insets.
- Cache-busted the Listening practice stylesheet and added a focused regression
  assertion for the mobile toolbar position.
