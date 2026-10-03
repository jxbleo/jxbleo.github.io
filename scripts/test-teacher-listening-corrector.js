#!/usr/bin/env node
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { correctedUnits } = require('../cloudfunctions/teacherAdmin/listening-correction')

const existing = [
  { unit_id: 'opening', start_seconds: 0, end_seconds: 2, text: 'Welcome.', practice_mode: 'skip', slots: [] },
  { unit_id: 'lesson', start_seconds: 2, end_seconds: 5, text: 'The old line.', practice_mode: 'dictation', slots: [
    { slot_id: 'old-1', answer: 'The', accepted_answers: ['the'], spelling_requirement: 'required' },
    { slot_id: 'old-2', answer: 'old', accepted_answers: ['old'], spelling_requirement: 'required' },
    { slot_id: 'old-3', answer: 'line', accepted_answers: ['line'], spelling_requirement: 'provided' },
  ] },
]
const fixed = correctedUnits([
  { timestamp: '00:00.000-00:02.100', speaker: 'Host', text: 'Welcome.' },
  { timestamp: '00:02.100-00:05.000', speaker: 'Guest', text: 'The new line.' },
], existing)
assert.equal(fixed[0].practice_mode, 'skip')
assert.equal(fixed[0].slots.length, 0)
assert.equal(fixed[1].unit_id, 'lesson')
assert.deepEqual(fixed[1].slots.map((slot) => slot.answer), ['The', 'new', 'line'])
assert.equal(fixed[1].slots[0].slot_id, 'old-1')
assert.equal(fixed[1].slots[2].spelling_requirement, 'provided')
assert.equal(fixed[1].slots[2].suffix, '.')
const unprovided = correctedUnits([
  { timestamp: '00:00-00:02', text: 'Welcome.', practiceMode: 'skip' },
  { timestamp: '00:02-00:05', text: 'The old line.', practiceMode: 'dictation', providedWordPositions: [] },
], existing)
assert.equal(unprovided[1].slots[2].spelling_requirement, 'required', 'explicit empty positions remove a previous provided word')
const preserved = correctedUnits([
  { timestamp: '00:00-00:02', text: 'Welcome.', practiceMode: 'skip' },
  { timestamp: '00:02-00:05', text: 'The old line.', practiceMode: 'dictation' },
], existing)
assert.equal(preserved[1].slots[2].spelling_requirement, 'provided', 'legacy rows without an explicit choice preserve provided words')
assert.throws(() => correctedUnits([{ timestamp: '00:01-00:00', text: 'Bad' }], existing), /LISTENING_CORRECTION_SEGMENT_INVALID/)
assert.throws(() => correctedUnits([{ timestamp: '00:00-00:02', text: 'Only intro', practiceMode: 'skip' }], existing), /LISTENING_CORRECTION_NO_DICTATION/)
const split = correctedUnits([
  { unitId: 'opening', timestamp: '00:00-00:02', text: 'Welcome.', practiceMode: 'skip' },
  { unitId: 'lesson', timestamp: '00:02-00:03', text: 'The new' },
  { timestamp: '00:03-00:05', text: 'line.' },
], existing)
assert.equal(new Set(split.map((unit) => unit.unit_id)).size, 3)
assert.equal(split[2].practice_mode, 'dictation')
const root = path.resolve(__dirname, '..')
const page = fs.readFileSync(path.join(root, 'teacher-listening-corrector.html'), 'utf8')
const teacher = fs.readFileSync(path.join(root, 'teacher.html'), 'utf8')
const admin = fs.readFileSync(path.join(root, 'cloudfunctions/teacherAdmin/index.js'), 'utf8')
assert.match(page, /transcript-corrector\.js/)
assert.match(page, /teacher-listening-corrector\.js/)
assert.match(page, /assets\/listening-corrector\/transcript-corrector\.js/)
assert.doesNotMatch(page, /tools\/intensive-listening-authoring/)
for (const file of ['transcript-corrector.js', 'transcript-corrector-model.js', 'transcript-corrector.css', 'vendor/wavesurfer.esm.js', 'vendor/regions.esm.js', 'vendor/timeline.esm.js', 'vendor/WAVESURFER-LICENSE.txt']) {
  assert.ok(fs.existsSync(path.join(root, 'assets/listening-corrector', file)), `Missing hosted corrector asset: ${file}`)
}
assert.match(teacher, /href="teacher-listening-corrector\.html"[^>]*>[^<]*waveform corrector[^<]*<\/a>/i)
assert.match(page, /<section class="load-card" id="load-card" hidden>/)
assert.match(page, /<header class="teacher-corrector-bar" id="teacher-corrector-bar">/)
assert.equal((page.match(/class="workspace-topbar"/g) || []).length, 0, 'Teacher editor must have one consolidated top card')
assert.match(page, /<textarea id="text-editor" rows="1"/)
assert.match(page, /data-practice-mode="skip"/)
assert.match(page, /id="provided-word-list"/)
const teacherCorrector = fs.readFileSync(path.join(root, 'assets/js/teacher-listening-corrector.js'), 'utf8')
const corrector = fs.readFileSync(path.join(root, 'assets/listening-corrector/transcript-corrector.js'), 'utf8')
assert.match(teacherCorrector, /await openLive\(\)/, 'Selecting a material must open the live editor directly')
assert.match(corrector, /function resizeTextEditor\(\)/)
assert.match(corrector, /window\.addEventListener\('resize', resizeTextEditor\)/)
assert.match(admin, /applyListeningCorrection/)
const uniqueStart = admin.indexOf('async function singlePublishedListeningMaterial(')
const uniqueEnd = admin.indexOf('\nasync function applyListeningCorrection(', uniqueStart)
assert.ok(uniqueStart >= 0 && uniqueEnd > uniqueStart)
const singleMaterialSource = admin.slice(uniqueStart, uniqueEnd)
const correctionStart = uniqueEnd + 1
const correctionEnd = admin.indexOf('\nfunction listeningValidation(', correctionStart)
assert.ok(correctionEnd > correctionStart)
const correctionSource = admin.slice(correctionStart, correctionEnd)

;(async () => {
  const { importTranscriptPayload, segmentPracticeMode, providedWordPositions } = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(root, 'assets/listening-corrector/transcript-corrector-model.js')).toString('base64'))
  const originalRows = [{ timestamp: '00:00.000-00:02.000', speaker: 'Host', text: 'A short sentence', practiceMode: 'dictation', providedWordPositions: [2] }]
  const annotationState = { segments: importTranscriptPayload(originalRows).segments, publishedSignature: null, changed: false }
  const status = { textContent: '', classList: { toggle() {} } }
  const annotationStart = corrector.indexOf('function annotationSignature(')
  const annotationEnd = corrector.indexOf('\nfunction markExported(', annotationStart)
  assert.ok(annotationStart >= 0 && annotationEnd > annotationStart)
  const annotationContext = { state: annotationState, segmentPracticeMode, providedWordPositions,
    $: () => status, document: { body: { dataset: { correctorMode: 'teacher' } } },
    window: { dispatchEvent() {} }, Event }
  vm.createContext(annotationContext)
  vm.runInContext(corrector.slice(annotationStart, annotationEnd), annotationContext)
  annotationState.publishedSignature = vm.runInContext('annotationSignature(state.segments)', annotationContext)
  vm.runInContext('markChanged()', annotationContext)
  assert.equal(annotationState.changed, false, 'unchanged live transcript is clean')
  annotationState.segments[0].text = 'A changed sentence'
  vm.runInContext('markChanged()', annotationContext)
  assert.equal(annotationState.changed, true, 'text edit enables publication')
  annotationState.segments[0].text = 'A short sentence'
  vm.runInContext('markChanged()', annotationContext)
  assert.equal(annotationState.changed, false, 'undoing to the published text clears the change')
  annotationState.segments[0].extra.providedWordPositions = []
  vm.runInContext('markChanged()', annotationContext)
  assert.equal(annotationState.changed, true, 'provided word changes count as edits')
  annotationState.segments[0].extra.providedWordPositions = [2]
  vm.runInContext('markChanged()', annotationContext)
  assert.equal(annotationState.changed, false)

  const updateApplyStart = teacherCorrector.indexOf('function updateApply(')
  const updateApplyEnd = teacherCorrector.indexOf('\nasync function call(', updateApplyStart)
  assert.ok(updateApplyStart >= 0 && updateApplyEnd > updateApplyStart)
  const controls = new Map()
  const control = id => { if (!controls.has(id)) controls.set(id, { disabled: false, hidden: false }); return controls.get(id) }
  const buttonState = { busy: false, materials: [{ material_id: 'IL-ONE' }], selected: 'IL-ONE',
    current: { material_id: 'IL-ONE' }, editingMaterialId: 'IL-ONE' }
  const buttonContext = { state: buttonState, $: control, document: { querySelector: () => ({ hidden: false }) },
    window: { MrCatTranscriptCorrector: { hasUnpublishedChanges: () => annotationState.changed } } }
  vm.createContext(buttonContext)
  vm.runInContext(teacherCorrector.slice(updateApplyStart, updateApplyEnd), buttonContext)
  vm.runInContext('updateApply()', buttonContext)
  assert.equal(control('teacher-corrector-apply').disabled, true, 'Update is disabled when nothing differs from live')
  annotationState.changed = true
  vm.runInContext('updateApply()', buttonContext)
  assert.equal(control('teacher-corrector-apply').disabled, false, 'Update enables after a real edit')
  annotationState.changed = false
  vm.runInContext('updateApply()', buttonContext)
  assert.equal(control('teacher-corrector-apply').disabled, true, 'Update dims again after restoring the published content')

  let rows = []
  const single = vm.runInNewContext(`(${singleMaterialSource})`, {
    db: { collection: () => ({ where: () => ({ limit: () => ({ get: async () => ({ data: rows }) }) }) }) },
    LISTENING_MATERIAL_COLLECTION: 'intensive_listening_materials',
  })
  assert.equal(await single('IL-ONE'), null)
  rows = [{ material_id: 'IL-ONE' }]
  assert.equal((await single('IL-ONE')).material_id, 'IL-ONE')
  rows = [{ material_id: 'IL-ONE' }, { material_id: 'IL-ONE' }]
  await assert.rejects(single('IL-ONE'), /LISTENING_DUPLICATE_MATERIAL/)

  let publishedReplacement = null
  let draftWrites = 0
  const live = { material_id: 'IL-ONE', publication_revision: 3, publication_status: 'published', visible: true, units: [{ unit_id: 'old' }] }
  const correction = vm.runInNewContext(`(${correctionSource})`, {
    listeningMaterialId: String,
    singlePublishedListeningMaterial: async () => live,
    intensiveListeningService: { normalizedMaterial: value => value, sourceMaterial: value => value },
    text: String,
    getOne: async () => null,
    LISTENING_DRAFT_COLLECTION: 'listening_material_drafts',
    listeningCorrection: { correctedUnits: () => [{ unit_id: 'new' }] },
    listeningDraftFromEvent: value => value.material,
    saveListeningMaterial: async () => { draftWrites += 1 },
    publishListeningMaterial: async (_event, _teacher, replacement) => { publishedReplacement = replacement; return { success: true } },
  })
  const result = await correction({ material_id: 'IL-ONE', publication_revision: 3, transcript: [] }, { auth_uid: 'teacher' })
  assert.equal(result.success, true)
  assert.equal(draftWrites, 0, 'web correction must not create a second draft copy')
  assert.equal(publishedReplacement.units[0].unit_id, 'new')
  assert.match(admin, /\.doc\(current\._id\)\.update\(payload\)/)
  assert.match(admin, /\.doc\(id\)\.create\(payload\)/)
  assert.match(admin, /LISTENING_PUBLICATION_VERIFY_FAILED/)
  assert.match(admin, /sequence_unit_count: normalized\.units\.length/)
  const applyStart = teacherCorrector.indexOf('async function apply(')
  const applyEnd = teacherCorrector.indexOf('\nfunction requestExport(', applyStart)
  assert.ok(applyStart >= 0 && applyEnd > applyStart)
  const applySource = teacherCorrector.slice(applyStart, applyEnd)
  const ui = { 'teacher-corrector-apply': { disabled: false } }
  const editState = { current: { material_id: 'IL-ONE', publication_revision: 3 }, busy: false, materials: [] }
  let downloads = 0
  let applied = 0
  let cleared = 0
  let completed = ''
  const publish = vm.runInNewContext(`(${applySource})`, {
    state: editState,
    $: (id) => ui[id] || { textContent: '' },
    showProgress: () => {},
    finishProgress: (_success, detail) => { completed = detail },
    updateApply: () => {},
    message: () => {},
    clearDraft: () => { cleared += 1 },
    exportCurrent: () => { downloads += 1 },
    requestAnimationFrame: (callback) => callback(),
    window: { MrCatTranscriptCorrector: {
      snapshot: () => ({ payload: [{ timestamp: '00:00-00:02', text: 'Edited' }] }),
      markApplied: () => { applied += 1 },
    } },
    call: async (action) => action === 'applyListeningCorrection'
      ? { material: { material_id: 'IL-ONE', publication_revision: editState.current.publication_revision + 1 } }
      : { materials: [] },
  })
  await publish()
  assert.equal(downloads, 0, 'ordinary Update must not download JSON')
  assert.equal(applied, 1)
  assert.equal(cleared, 1)
  assert.match(completed, /Use Export/)
  await publish({ exportAfterSave: true })
  assert.equal(downloads, 1, 'Save and Export must download after publication')
  assert.equal(applied, 2)
  assert.equal(cleared, 2)
  assert.match(completed, /downloaded/)
  assert.match(teacherCorrector, /sessionStorage\.setItem\(draftKey\(\)/)
  assert.match(teacherCorrector, /window\.addEventListener\('popstate'/)
  assert.match(corrector, /mr-cat-corrector-changed/)
  const draftStart = teacherCorrector.indexOf('function draftKey(')
  const draftEnd = teacherCorrector.indexOf('\nfunction closeModal(', draftStart)
  assert.ok(draftStart >= 0 && draftEnd > draftStart)
  const store = new Map()
  const draftState = {
    teacherId: 'teacher-one', editingMaterialId: 'IL-ONE', editingRevision: 3,
    current: { material_id: 'IL-ONE', publication_revision: 9 }, draftTimer: null,
  }
  const draftContext = {
    state: draftState,
    DRAFT_MAX_AGE: 24 * 60 * 60 * 1000,
    sessionStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
      removeItem: key => store.delete(key),
    },
    window: { MrCatTranscriptCorrector: {
      hasUnpublishedChanges: () => true,
      snapshot: () => ({ payload: [{ timestamp: '00:00-00:02', text: 'Edited' }] }),
    } },
    clearTimeout,
    message: () => {},
  }
  vm.createContext(draftContext)
  vm.runInContext(teacherCorrector.slice(draftStart, draftEnd), draftContext)
  vm.runInContext('saveDraftNow()', draftContext)
  assert.equal(vm.runInContext("readDraft('IL-ONE').revision", draftContext), 3, 'draft keeps the editing base revision')
  assert.equal(vm.runInContext("readDraft('IL-TWO')", draftContext), null, 'another material cannot see this draft')
  vm.runInContext("clearDraft('IL-ONE')", draftContext)
  assert.equal(vm.runInContext("readDraft('IL-ONE')", draftContext), null, 'published drafts are cleared')
  const initStart = teacherCorrector.indexOf('async function init()')
  const initEnd = teacherCorrector.indexOf("\n$('teacher-corrector-material').addEventListener", initStart)
  assert.ok(initStart >= 0 && initEnd > initStart)
  const elements = new Map()
  const element = id => {
    if (!elements.has(id)) elements.set(id, { hidden: false, textContent: '', value: '', replaceChildren() {} })
    return elements.get(id)
  }
  const entryState = { materials: [], authorized: false, teacherId: '', historyHasPrevious: false }
  let listed = false
  let guardInstalled = false
  const initialize = vm.runInNewContext(`(${teacherCorrector.slice(initStart, initEnd)})`, {
    state: entryState,
    $: element,
    document: { querySelector: () => element('main') },
    window: { MrCatAuth: { getSession: async () => ({ mode: 'teacher', profile: { role: 'teacher', student_id: 'teacher-one' } }) } },
    history: { length: 2, state: null },
    location: { search: '' },
    URLSearchParams,
    Option: function Option() {},
    HISTORY_GUARD: 'teacher-listening-corrector-guard',
    installHistoryGuard: () => { guardInstalled = true },
    call: async () => { listed = true; return { materials: [] } },
    message: () => {},
    updateApply: () => {},
  })
  await initialize()
  assert.equal(entryState.teacherId, 'teacher-one', 'teacher entry uses the Login ID returned by getCurrentStudent')
  assert.equal(entryState.authorized, true)
  assert.equal(element('teacher-corrector-access').hidden, true)
  assert.equal(element('main').hidden, false)
  assert.equal(listed, true)
  assert.equal(guardInstalled, true)
  const modeStart = corrector.indexOf('function setPracticeMode(')
  const modeEnd = corrector.indexOf('\nfunction renderEditor(', modeStart)
  assert.ok(modeStart >= 0 && modeEnd > modeStart)
  const policyState = { segments: [
    { id: 'one', text: 'A short sentence', extra: { practiceMode: 'dictation', providedWordPositions: [2] } },
    { id: 'two', text: 'Another sentence', extra: { practiceMode: 'dictation' } },
  ], selectedId: 'one', editSession: null }
  let changes = 0
  let undoRecords = 0
  let policyNotice = ''
  const policyContext = {
    state: policyState,
    selectedSegment: () => policyState.segments.find(segment => segment.id === policyState.selectedId),
    segmentPracticeMode: segment => segment.extra.practiceMode || 'dictation',
    providedWordPositions: segment => segment.extra.providedWordPositions || [],
    dictationWords: text => text.split(/\s+/).map(answer => ({ answer })),
    remember: () => { undoRecords += 1 },
    markChanged: () => { changes += 1 },
    renderSentenceList: () => {},
    renderEditor: () => {},
    renderPracticeControls: () => {},
    renderHistoryButtons: () => {},
    toast: text => { policyNotice = text },
  }
  vm.createContext(policyContext)
  vm.runInContext(corrector.slice(modeStart, modeEnd), policyContext)
  vm.runInContext("setPracticeMode('skip')", policyContext)
  assert.equal(policyState.segments[0].extra.practiceMode, 'skip')
  assert.deepEqual(Array.from(policyState.segments[0].extra.providedWordPositions), [])
  policyState.selectedId = 'two'
  vm.runInContext("setPracticeMode('skip')", policyContext)
  assert.equal(policyState.segments[1].extra.practiceMode, 'dictation', 'last Dictation unit stays available')
  assert.match(policyNotice, /at least one/)
  vm.runInContext('toggleProvidedWord(2)', policyContext)
  assert.deepEqual(Array.from(policyState.segments[1].extra.providedWordPositions), [2])
  vm.runInContext('toggleProvidedWord(2)', policyContext)
  assert.deepEqual(Array.from(policyState.segments[1].extra.providedWordPositions), [])
  assert.equal(changes, 3)
  assert.equal(undoRecords, 3)
  console.log('Teacher Listening corrector tests passed.')
})().catch(error => { console.error(error); process.exitCode = 1 })
