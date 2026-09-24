import {
  MIN_SEGMENT_SECONDS,
  analyzeSegments,
  constrainSegmentRange,
  exportTranscriptPayload,
  formatClock,
  importTranscriptPayload,
  mergeSegment,
  parseClock,
  splitSegment,
} from './transcript-corrector-model.js'

const $ = (selector) => document.querySelector(selector)
const state = {
  audioFile: null,
  jsonFile: null,
  parsedJson: null,
  sourceShape: 'array',
  wrapperExtra: {},
  segments: [],
  selectedId: null,
  wavesurfer: null,
  regions: null,
  regionMap: new Map(),
  duration: null,
  activePlaybackEnd: null,
  audioUrl: null,
  undoStack: [],
  redoStack: [],
  changed: false,
  renderingRegions: false,
  nextId: 1,
  toastTimer: null,
  editSession: null,
}

let waveformModulesPromise = null

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character])
}

function toast(message) {
  const element = $('#corrector-toast')
  element.textContent = message
  element.classList.add('show')
  clearTimeout(state.toastTimer)
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 2600)
}

function setSettingsOpen(open) {
  const drawer = $('#settings-drawer')
  const toggle = $('#settings-toggle-button')
  drawer.hidden = !open
  toggle.setAttribute('aria-expanded', String(open))
  if (open) requestAnimationFrame(() => $('#settings-close-button').focus({ preventScroll: true }))
}

function selectedIndex() {
  return state.segments.findIndex((segment) => segment.id === state.selectedId)
}

function selectedSegment() {
  return state.segments[selectedIndex()] || null
}

function snapshot() {
  return {
    segments: structuredClone(state.segments),
    selectedId: state.selectedId,
  }
}

function remember() {
  state.undoStack.push(snapshot())
  if (state.undoStack.length > 80) state.undoStack.shift()
  state.redoStack = []
  renderHistoryButtons()
}

function restore(historyFrom, historyTo) {
  const previous = historyFrom.pop()
  if (!previous) return
  historyTo.push(snapshot())
  state.editSession = null
  state.segments = previous.segments
  state.selectedId = previous.selectedId
  markChanged()
  renderAll()
}

function undo() { restore(state.undoStack, state.redoStack) }
function redo() { restore(state.redoStack, state.undoStack) }

function renderHistoryButtons() {
  $('#undo-correction-button').disabled = !state.undoStack.length
  $('#redo-correction-button').disabled = !state.redoStack.length
}

function markChanged() {
  state.changed = true
  const status = $('#session-status')
  status.textContent = 'Changes not exported'
  status.classList.add('changed')
}

function markExported() {
  state.changed = false
  const status = $('#session-status')
  status.textContent = 'Exported'
  status.classList.remove('changed')
}

function updateLoadState() {
  $('#audio-file-name').textContent = state.audioFile?.name || 'Choose audio'
  $('#json-file-name').textContent = state.jsonFile?.name || 'Choose transcript JSON'
  $('#audio-picker').classList.toggle('ready', Boolean(state.audioFile))
  $('#json-picker').classList.toggle('ready', Boolean(state.jsonFile))
  $('#open-corrector-button').disabled = !(state.audioFile && state.jsonFile && state.parsedJson)
  $('#load-message').textContent = state.audioFile && state.jsonFile
    ? 'Matching pair ready. Open the waveform corrector.'
    : state.audioFile || state.jsonFile
      ? 'Choose the matching file to continue.'
      : 'Choose both files to begin.'
}

async function readJsonFile(file) {
  const text = await file.text()
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`Unable to read ${file.name}: invalid JSON`)
  }
}

async function acceptJson(file) {
  if (!file) return
  try {
    const payload = await readJsonFile(file)
    importTranscriptPayload(payload)
    state.jsonFile = file
    state.parsedJson = payload
  } catch (error) {
    state.jsonFile = null
    state.parsedJson = null
    toast(error.message)
  }
  updateLoadState()
}

function acceptAudio(file) {
  if (!file) return
  if (!String(file.type || '').startsWith('audio/') && !/\.(mp3|m4a|wav|flac|aac|ogg|mp4)$/i.test(file.name)) {
    toast('Choose an audio file')
    return
  }
  state.audioFile = file
  updateLoadState()
}

function speakerHue(speaker) {
  let hash = 0
  for (const character of String(speaker || 'Speaker')) hash = (hash * 31 + character.charCodeAt(0)) % 360
  return 145 + (hash % 110)
}

function analysis() {
  return analyzeSegments(state.segments, state.duration)
}

function issuesFor(segmentId) {
  return analysis().issues.get(segmentId) || []
}

function nextSegmentId() {
  const used = new Set(state.segments.map((segment) => segment.id))
  while (used.has(`segment-new-${state.nextId}`)) state.nextId += 1
  return `segment-new-${state.nextId++}`
}

async function loadWaveformModules() {
  if (!waveformModulesPromise) {
    waveformModulesPromise = Promise.all([
      import('./vendor/wavesurfer.esm.js'),
      import('./vendor/regions.esm.js'),
      import('./vendor/timeline.esm.js'),
    ]).then(([wavesurfer, regions, timeline]) => ({
      WaveSurfer: wavesurfer.default,
      RegionsPlugin: regions.default,
      TimelinePlugin: timeline.default,
    }))
  }
  return waveformModulesPromise
}

async function initializeWaveform() {
  const { WaveSurfer, RegionsPlugin, TimelinePlugin } = await loadWaveformModules()
  state.regions = RegionsPlugin.create()
  const timeline = TimelinePlugin.create({ container: '#corrector-timeline' })
  state.wavesurfer = WaveSurfer.create({
    container: '#corrector-waveform',
    backend: 'WebAudio',
    height: $('#teacher-corrector-bar') ? 84 : 128,
    waveColor: '#afc8c0',
    progressColor: '#176c58',
    cursorColor: '#183e34',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    minPxPerSec: Number($('#corrector-zoom-slider').value),
    autoScroll: true,
    autoCenter: true,
    dragToSeek: true,
    normalize: true,
    plugins: [state.regions, timeline],
  })
  state.wavesurfer.on('ready', (duration) => {
    state.duration = duration
    $('#material-meta').textContent = `${state.segments.length} sentences · ${formatClock(duration)} audio · ${state.audioFile.name}`
    $('#session-status').textContent = 'Ready to correct'
    renderAll()
  })
  state.wavesurfer.on('timeupdate', (seconds) => {
    $('#current-time-output').textContent = formatClock(seconds)
    if (Number.isFinite(state.activePlaybackEnd) && seconds >= state.activePlaybackEnd - .01) {
      const rangeEnd = state.activePlaybackEnd
      state.activePlaybackEnd = null
      state.wavesurfer.pause()
      state.wavesurfer.setTime(rangeEnd)
      $('#play-selection-button').textContent = '▶'
      return
    }
    $('#play-selection-button').textContent = state.wavesurfer.isPlaying() ? '❚❚' : '▶'
  })
  state.wavesurfer.on('pause', () => {
    state.activePlaybackEnd = null
    $('#play-selection-button').textContent = '▶'
  })
  state.wavesurfer.on('finish', () => {
    state.activePlaybackEnd = null
    $('#play-selection-button').textContent = '▶'
  })
  state.wavesurfer.on('error', (error) => toast(error?.message || 'Unable to decode this audio file'))
  state.regions.on('region-clicked', (region, event) => {
    event.stopPropagation()
    selectSegment(region.id, { seek: false, pinListToTop: true })
  })
  state.regions.on('region-double-clicked', (region, event) => {
    event.stopPropagation()
    selectSegment(region.id, { seek: false, pinListToTop: true })
    playRange(region.start, region.end)
  })
  state.regions.on('region-updated', commitRegionUpdate)
  state.audioUrl = URL.createObjectURL(state.audioFile)
  await state.wavesurfer.load(state.audioUrl)
}

function regionColor(segment, selected, hasWarning) {
  if (hasWarning) return selected ? 'rgba(184, 55, 55, .42)' : 'rgba(205, 86, 66, .27)'
  const hue = speakerHue(segment.speaker)
  return selected ? `hsla(${hue}, 48%, 45%, .38)` : `hsla(${hue}, 45%, 63%, .23)`
}

function renderRegions() {
  if (!state.regions || !state.wavesurfer?.getDuration()) return
  state.renderingRegions = true
  state.regions.clearRegions()
  state.regionMap.clear()
  const report = analysis()
  state.segments.forEach((segment, index) => {
    const region = state.regions.addRegion({
      id: segment.id,
      start: segment.start,
      end: segment.end,
      content: String(index + 1),
      drag: false,
      resize: segment.id === state.selectedId,
      minLength: MIN_SEGMENT_SECONDS,
      color: regionColor(segment, segment.id === state.selectedId, report.issues.has(segment.id)),
    })
    region.element.style.zIndex = segment.id === state.selectedId ? '2' : '1'
    state.regionMap.set(segment.id, region)
  })
  state.renderingRegions = false
}

function updateRegionColors() {
  const report = analysis()
  state.regionMap.forEach((region, id) => {
    const segment = state.segments.find((candidate) => candidate.id === id)
    if (segment) {
      region.setOptions({
        color: regionColor(segment, id === state.selectedId, report.issues.has(id)),
        drag: false,
        resize: id === state.selectedId,
      })
      region.element.style.zIndex = id === state.selectedId ? '2' : '1'
    }
  })
}

function commitRegionUpdate(region) {
  if (state.renderingRegions) return
  const index = state.segments.findIndex((segment) => segment.id === region.id)
  const segment = state.segments[index]
  if (!segment) return
  try {
    const constrained = constrainSegmentRange(state.segments, index, region.start, region.end, { duration: state.duration, mode: 'resize' })
    if (Math.abs(constrained.start - segment.start) < .0005 && Math.abs(constrained.end - segment.end) < .0005) {
      region.setOptions({ start: segment.start, end: segment.end })
      return
    }
    remember()
    segment.start = constrained.start
    segment.end = constrained.end
    region.setOptions({ start: segment.start, end: segment.end })
    markChanged()
    renderAll({ regions: false })
  } catch (error) {
    region.setOptions({ start: segment.start, end: segment.end })
    toast(error.message)
  }
}

function renderSentenceList() {
  const query = $('#sentence-search').value.trim().toLowerCase()
  const report = analysis()
  const rows = state.segments.map((segment, index) => ({ segment, index })).filter(({ segment, index }) => {
    if (!query) return true
    return `${index + 1} ${segment.speaker} ${segment.text}`.toLowerCase().includes(query)
  })
  $('#sentence-count').textContent = `${state.segments.length} total`
  $('#sentence-list').innerHTML = rows.length ? rows.map(({ segment, index }) => {
    const warning = report.issues.has(segment.id)
    const sentenceNumber = String(index + 1).padStart(2, '0')
    return `<div class="sentence-row ${segment.id === state.selectedId ? 'active' : ''} ${warning ? 'has-warning' : ''}">
      <button class="sentence-select-button" type="button" data-select-segment-id="${escapeHtml(segment.id)}" aria-label="Select sentence ${index + 1} and show it in the waveform">
        <span class="sentence-number">${sentenceNumber}</span>
        <span class="sentence-copy"><strong>${escapeHtml(segment.speaker || 'Unlabelled speaker')}</strong><p>${escapeHtml(segment.text || 'Empty sentence')}</p><small>${formatClock(segment.start)} – ${formatClock(segment.end)}</small></span>
      </button>
      <button class="sentence-play-button" type="button" data-play-segment-id="${escapeHtml(segment.id)}" aria-label="Play sentence ${index + 1}" title="Play sentence ${index + 1}">▶</button>
    </div>`
  }).join('') : '<div class="issue-chip">No sentences match this search.</div>'
  $('#sentence-list').querySelectorAll('[data-select-segment-id]').forEach((button) => {
    button.addEventListener('click', () => selectSegment(button.dataset.selectSegmentId, { focusWaveform: true }))
  })
  $('#sentence-list').querySelectorAll('[data-play-segment-id]').forEach((button) => {
    button.addEventListener('click', () => playSegmentById(button.dataset.playSegmentId))
  })
}

function renderEditor() {
  const segment = selectedSegment()
  const index = selectedIndex()
  if (!segment) return
  $('#editor-heading').textContent = `Sentence ${index + 1}`
  $('#speaker-editor').value = segment.speaker
  $('#text-editor').value = segment.text
  $('#start-time-editor').value = formatClock(segment.start)
  $('#end-time-editor').value = formatClock(segment.end)
  $('#previous-sentence-button').disabled = index <= 0
  $('#next-sentence-button').disabled = index >= state.segments.length - 1
  $('#merge-previous-correction-button').disabled = index <= 0
  $('#merge-next-correction-button').disabled = index >= state.segments.length - 1
  $('#delete-sentence-button').disabled = state.segments.length <= 1
  renderSelectedIssues()
  renderWaveLabels()
}

function renderSelectedIssues() {
  const segment = selectedSegment()
  if (!segment) return
  const currentIssues = issuesFor(segment.id)
  $('#selected-issues').innerHTML = currentIssues.length
    ? currentIssues.map((issue) => `<div class="issue-chip ${issue.type === 'empty' || issue.type === 'range' || issue.type === 'duration' ? 'error' : ''}">${escapeHtml(issue.message)}</div>`).join('')
    : '<div class="issue-chip good">This sentence has a valid, non-overlapping range.</div>'
}

function renderQa() {
  const report = analysis()
  $('#qa-heading').textContent = report.warningCount ? `${report.warningCount} warnings` : 'No warnings'
  $('#qa-summary').innerHTML = `
    <div class="qa-stat"><span>Sentences</span><strong>${state.segments.length}</strong></div>
    <div class="qa-stat ${report.overlapCount ? 'warning' : ''}"><span>Overlaps</span><strong>${report.overlapCount}</strong></div>
    <div class="qa-stat ${report.emptyCount ? 'warning' : ''}"><span>Empty text</span><strong>${report.emptyCount}</strong></div>
    <div class="qa-stat ${report.rangeCount ? 'warning' : ''}"><span>Invalid times</span><strong>${report.rangeCount}</strong></div>`
  $('#export-correction-button').textContent = report.warningCount
    ? `Export with ${report.warningCount} warning${report.warningCount === 1 ? '' : 's'}`
    : 'Export corrected JSON'
}

function renderWaveLabels() {
  const segment = selectedSegment()
  if (!segment) return
  const index = selectedIndex()
  $('#selected-wave-label').textContent = `Sentence ${index + 1} · ${segment.speaker || 'Unlabelled speaker'}`
  $('#selected-wave-time').textContent = `${formatClock(segment.start)} – ${formatClock(segment.end)}`
}

function renderAll(options = {}) {
  if (options.regions !== false) renderRegions()
  renderSentenceList()
  renderEditor()
  renderQa()
  renderHistoryButtons()
  updateRegionColors()
}

function selectSegment(id, options = {}) {
  if (!state.segments.some((segment) => segment.id === id)) return
  state.selectedId = id
  if (options.pinListToTop) $('#sentence-search').value = ''
  renderSentenceList()
  renderEditor()
  updateRegionColors()
  const segment = selectedSegment()
  if (options.seek !== false && state.wavesurfer) {
    state.wavesurfer.setTime(segment.start)
    state.wavesurfer.setScrollTime?.((segment.start + segment.end) / 2)
  }
  if (options.focusWaveform) {
    requestAnimationFrame(() => $('.waveform-card')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    }))
  }
  requestAnimationFrame(() => {
    const list = $('#sentence-list')
    const activeRow = list?.querySelector('.sentence-row.active')
    if (!list || !activeRow) return
    if (options.pinListToTop) {
      const top = activeRow.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
      list.scrollTo({
        top,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      })
    } else {
      activeRow.scrollIntoView({ block: 'nearest' })
    }
  })
}

function navigateSentence(direction) {
  const next = state.segments[selectedIndex() + direction]
  if (next) selectSegment(next.id)
}

function resumeCorrectorAudio() {
  const wavesurfer = state.wavesurfer
  if (!wavesurfer) return Promise.resolve()
  const player = (typeof wavesurfer.getMediaElement === 'function' && wavesurfer.getMediaElement()) || wavesurfer.media || null
  const context = player && player.audioContext
  if (context && context.state !== 'running' && typeof context.resume === 'function') {
    return context.resume().catch(() => {})
  }
  return Promise.resolve()
}

function playRange(start, end) {
  if (!state.wavesurfer) return
  if (state.wavesurfer.isPlaying()) state.wavesurfer.pause()
  const rangeStart = Math.max(0, start)
  const rangeEnd = Math.min(state.duration || end, end)
  if (rangeEnd <= rangeStart) return
  state.activePlaybackEnd = rangeEnd
  // Safari leaves the Web Audio context suspended when it is created after an
  // await (the waveform modules load asynchronously) and wavesurfer never
  // resumes it, so playback looks active but stays silent. Resume the context
  // inside this user gesture before scheduling the range.
  resumeCorrectorAudio().then(() => {
    if (!state.wavesurfer) return
    state.wavesurfer.play(rangeStart, rangeEnd).catch(() => {
      state.activePlaybackEnd = null
      toast('Audio playback could not start')
    })
  })
}

function playSelected() {
  const segment = selectedSegment()
  if (!segment || !state.wavesurfer) return
  if (state.wavesurfer.isPlaying()) return state.wavesurfer.pause()
  playRange(segment.start, segment.end)
}

function playSegmentById(id) {
  const segment = state.segments.find((candidate) => candidate.id === id)
  if (!segment || !state.wavesurfer) return
  selectSegment(id, { seek: false })
  playRange(segment.start, segment.end)
}

function beginEditSession(field) {
  state.editSession = { field, remembered: false }
}

function editTextField(field, value) {
  const segment = selectedSegment()
  if (!segment) return
  if (!state.editSession || state.editSession.field !== field) beginEditSession(field)
  if (!state.editSession.remembered) {
    remember()
    state.editSession.remembered = true
  }
  segment[field] = value
  markChanged()
  renderSentenceList()
  renderQa()
  renderSelectedIssues()
  if (field === 'speaker') updateRegionColors()
  renderWaveLabels()
}

function finishEditSession() {
  state.editSession = null
  renderEditor()
}

function applyRange(start, end, message) {
  const index = selectedIndex()
  if (index < 0) return
  try {
    const range = constrainSegmentRange(state.segments, index, start, end, { duration: state.duration, mode: 'resize' })
    const segment = state.segments[index]
    if (Math.abs(segment.start - range.start) < .0005 && Math.abs(segment.end - range.end) < .0005) return renderEditor()
    remember()
    segment.start = range.start
    segment.end = range.end
    markChanged()
    renderAll()
    if (message) toast(message)
  } catch (error) {
    renderEditor()
    toast(error.message)
  }
}

function commitTimeField(field) {
  const segment = selectedSegment()
  if (!segment) return
  const input = field === 'start' ? $('#start-time-editor') : $('#end-time-editor')
  try {
    const seconds = parseClock(input.value)
    applyRange(field === 'start' ? seconds : segment.start, field === 'end' ? seconds : segment.end)
  } catch (error) {
    renderEditor()
    toast(error.message)
  }
}

function nudgeBoundary(field, amount) {
  const segment = selectedSegment()
  if (!segment) return
  applyRange(
    field === 'start' ? segment.start + amount : segment.start,
    field === 'end' ? segment.end + amount : segment.end,
    `${field === 'start' ? 'Start' : 'End'} moved ${amount > 0 ? 'forward' : 'back'} 0.05 s`,
  )
}

function setBoundaryFromPlayhead(field) {
  const segment = selectedSegment()
  if (!segment || !state.wavesurfer) return
  const time = state.wavesurfer.getCurrentTime()
  applyRange(field === 'start' ? time : segment.start, field === 'end' ? time : segment.end, `${field === 'start' ? 'Start' : 'End'} set from playhead`)
}

function splitSelected() {
  const index = selectedIndex()
  const textEditor = $('#text-editor')
  try {
    const newId = nextSegmentId()
    remember()
    state.segments = splitSegment(state.segments, index, state.wavesurfer.getCurrentTime(), textEditor.selectionStart, newId)
    state.selectedId = newId
    markChanged()
    renderAll()
    toast('Sentence split. Undo is available.')
  } catch (error) {
    if (state.undoStack.length && JSON.stringify(state.undoStack.at(-1)) === JSON.stringify(snapshot())) state.undoStack.pop()
    renderHistoryButtons()
    toast(error.message)
  }
}

function mergeSelected(direction) {
  const index = selectedIndex()
  try {
    remember()
    const result = mergeSegment(state.segments, index, direction)
    state.segments = result.segments
    state.selectedId = result.selectedId
    markChanged()
    renderAll()
    toast('Sentences merged. Undo is available.')
  } catch (error) {
    state.undoStack.pop()
    renderHistoryButtons()
    toast(error.message)
  }
}

function addSentenceAfter() {
  const index = selectedIndex()
  const current = state.segments[index]
  const next = state.segments[index + 1]
  if (!current) return
  const availableEnd = next ? next.start : state.duration
  if (!Number.isFinite(availableEnd) || availableEnd - current.end < MIN_SEGMENT_SECONDS) {
    toast('Create a small gap after this sentence before adding another one')
    return
  }
  remember()
  const segment = {
    id: nextSegmentId(),
    speaker: current.speaker,
    text: '',
    start: current.end,
    end: Math.min(availableEnd, current.end + 1),
    extra: {},
  }
  state.segments.splice(index + 1, 0, segment)
  state.selectedId = segment.id
  markChanged()
  renderAll()
  requestAnimationFrame(() => $('#text-editor').focus())
  toast('Empty sentence added. Enter its text and adjust the range.')
}

function deleteSelected() {
  const index = selectedIndex()
  if (index < 0 || state.segments.length <= 1) return
  remember()
  state.segments.splice(index, 1)
  state.selectedId = state.segments[Math.min(index, state.segments.length - 1)].id
  markChanged()
  renderAll()
  toast('Sentence deleted. Undo is available.')
}

function exportCorrection() {
  const payload = exportTranscriptPayload(state.segments, state.sourceShape, state.wrapperExtra)
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  const original = state.jsonFile?.name || 'transcript.json'
  link.download = `${original.replace(/\.json$/i, '')}-corrected.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  markExported()
  const warnings = analysis().warningCount
  toast(warnings ? `JSON exported with ${warnings} warning${warnings === 1 ? '' : 's'}` : 'Corrected JSON exported')
}

async function openCorrector() {
  if (!state.audioFile || !state.parsedJson) return
  try {
    const imported = importTranscriptPayload(state.parsedJson)
    state.segments = imported.segments
    state.sourceShape = imported.sourceShape
    state.wrapperExtra = imported.wrapperExtra
    state.selectedId = state.segments[0].id
    state.undoStack = []
    state.redoStack = []
    state.changed = false
    setSettingsOpen(false)
    $('#load-card').hidden = true
    $('#corrector-workspace').hidden = false
    $('#material-name').textContent = state.jsonFile.name
    $('#material-meta').textContent = `${state.segments.length} sentences · Loading waveform…`
    $('#session-status').textContent = 'Decoding audio…'
    await initializeWaveform()
  } catch (error) {
    $('#load-card').hidden = false
    $('#corrector-workspace').hidden = true
    toast(error.message || 'Unable to open the correction workspace')
  }
}

function replaceFiles() {
  if (state.changed && !window.confirm('Replace these files without exporting your latest corrections?')) return false
  state.wavesurfer?.destroy()
  state.wavesurfer = null
  state.regions = null
  state.regionMap.clear()
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl)
  state.audioUrl = null
  state.duration = null
  state.activePlaybackEnd = null
  state.segments = []
  state.selectedId = null
  state.changed = false
  setSettingsOpen(false)
  $('#corrector-workspace').hidden = true
  $('#load-card').hidden = false
  return true
}

$('#corrector-audio-input').addEventListener('change', (event) => acceptAudio(event.target.files[0]))
$('#corrector-json-input').addEventListener('change', (event) => acceptJson(event.target.files[0]))
$('#open-corrector-button').addEventListener('click', openCorrector)
// Unlock the Web Audio context on the first real interaction so Safari (and
// any autoplay-policy browser) does not keep the waveform player silent.
document.addEventListener('pointerdown', resumeCorrectorAudio)
document.addEventListener('keydown', resumeCorrectorAudio)
$('#replace-files-button').addEventListener('click', replaceFiles)
$('#undo-correction-button').addEventListener('click', undo)
$('#redo-correction-button').addEventListener('click', redo)
$('#settings-toggle-button').addEventListener('click', (event) => {
  event.stopPropagation()
  setSettingsOpen($('#settings-drawer').hidden)
})
$('#settings-close-button').addEventListener('click', () => {
  setSettingsOpen(false)
  $('#settings-toggle-button').focus({ preventScroll: true })
})
$('#export-correction-button').addEventListener('click', exportCorrection)
$('#play-selection-button').addEventListener('click', playSelected)
$('#play-start-boundary-button').addEventListener('click', () => {
  const segment = selectedSegment(); if (segment) playRange(segment.start - 1, Math.min(segment.end, segment.start + 1))
})
$('#play-end-boundary-button').addEventListener('click', () => {
  const segment = selectedSegment(); if (segment) playRange(Math.max(segment.start, segment.end - 1), segment.end + 1)
})
$('#corrector-zoom-slider').addEventListener('input', (event) => state.wavesurfer?.zoom(Number(event.target.value)))
$('#sentence-search').addEventListener('input', renderSentenceList)
$('#previous-sentence-button').addEventListener('click', () => navigateSentence(-1))
$('#next-sentence-button').addEventListener('click', () => navigateSentence(1))

for (const [selector, field] of [['#speaker-editor', 'speaker'], ['#text-editor', 'text']]) {
  const input = $(selector)
  input.addEventListener('focus', () => beginEditSession(field))
  input.addEventListener('input', () => editTextField(field, input.value))
  input.addEventListener('blur', finishEditSession)
}

$('#start-time-editor').addEventListener('change', () => commitTimeField('start'))
$('#end-time-editor').addEventListener('change', () => commitTimeField('end'))
document.querySelectorAll('[data-nudge]').forEach((button) => button.addEventListener('click', () => {
  const [field, amount] = button.dataset.nudge.split(':')
  nudgeBoundary(field, Number(amount))
}))
document.querySelectorAll('[data-set-boundary]').forEach((button) => button.addEventListener('click', () => setBoundaryFromPlayhead(button.dataset.setBoundary)))
$('#split-sentence-button').addEventListener('click', splitSelected)
$('#merge-previous-correction-button').addEventListener('click', () => mergeSelected(-1))
$('#merge-next-correction-button').addEventListener('click', () => mergeSelected(1))
$('#add-sentence-button').addEventListener('click', addSentenceAfter)
$('#delete-sentence-button').addEventListener('click', deleteSelected)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#settings-drawer').hidden) {
    event.preventDefault()
    setSettingsOpen(false)
    $('#settings-toggle-button').focus({ preventScroll: true })
    return
  }
  const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo(); else undo()
    return
  }
  if (editing || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.code === 'Space' && state.segments.length) { event.preventDefault(); playSelected() }
  if (event.key === 'ArrowUp' && state.segments.length) { event.preventDefault(); navigateSentence(-1) }
  if (event.key === 'ArrowDown' && state.segments.length) { event.preventDefault(); navigateSentence(1) }
})

document.addEventListener('pointerdown', (event) => {
  const drawer = $('#settings-drawer')
  if (drawer.hidden || drawer.contains(event.target) || $('#settings-toggle-button').contains(event.target)) return
  setSettingsOpen(false)
})

window.addEventListener('beforeunload', (event) => {
  if (!state.changed) return
  event.preventDefault()
  event.returnValue = ''
})

window.addEventListener('unload', () => {
  if (state.audioUrl) URL.revokeObjectURL(state.audioUrl)
})

updateLoadState()

// The Teacher workspace reuses this editor without a second waveform UI.
// Keep the local App's file-only workflow unchanged.
window.MrCatTranscriptCorrector = {
  async open(audioFile, transcript, name = 'transcript.json') {
    if ($('#corrector-workspace').hidden === false && !replaceFiles()) return false
    acceptAudio(audioFile)
    state.jsonFile = new File([JSON.stringify(transcript)], name, { type: 'application/json' })
    state.parsedJson = transcript
    updateLoadState()
    await openCorrector()
    return !$('#corrector-workspace').hidden
  },
  snapshot() {
    if ($('#corrector-workspace').hidden) throw new Error('Open a transcript first')
    return {
      payload: exportTranscriptPayload(state.segments, state.sourceShape, state.wrapperExtra),
      warnings: analysis().warningCount,
      duration: state.duration,
    }
  },
  markApplied() {
    markExported()
    $('#session-status').textContent = 'Correction applied'
  },
}
