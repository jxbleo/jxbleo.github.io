const $ = (id) => document.getElementById(id)
const state = { materials: [], selected: '', current: null, editingMaterialId: '', editingRevision: null, busy: false, authorized: false, teacherId: '', draftTimer: null, leaveTarget: null, historyHasPrevious: false }
const DRAFT_MAX_AGE = 24 * 60 * 60 * 1000
const HISTORY_GUARD = 'teacher-listening-corrector-guard'

function draftKey(id = state.editingMaterialId) {
  return `mrcat:teacher-listening-draft:v2:${encodeURIComponent(state.teacherId)}:${encodeURIComponent(id)}`
}

function readDraft(id = state.selected) {
  if (!state.teacherId || !id) return null
  try {
    const stored = JSON.parse(sessionStorage.getItem(draftKey(id)) || 'null')
    if (!stored) return null
    if (stored.version !== 2 || stored.teacherId !== state.teacherId || stored.materialId !== id ||
        !stored.payload || !Number.isFinite(stored.savedAt) || Date.now() - stored.savedAt > DRAFT_MAX_AGE) {
      sessionStorage.removeItem(draftKey(id))
      return null
    }
    return stored
  } catch (_error) { return null }
}

function clearDraft(id = state.editingMaterialId) {
  clearTimeout(state.draftTimer)
  try { if (state.teacherId && id) sessionStorage.removeItem(draftKey(id)) } catch (_error) {}
}

function saveDraftNow() {
  clearTimeout(state.draftTimer)
  if (!state.teacherId || !state.current || state.editingMaterialId !== state.current.material_id ||
      !window.MrCatTranscriptCorrector.hasUnpublishedChanges()) return
  try {
    const payload = window.MrCatTranscriptCorrector.snapshot().payload
    sessionStorage.setItem(draftKey(), JSON.stringify({
      version: 2, teacherId: state.teacherId, materialId: state.editingMaterialId,
      revision: state.editingRevision, savedAt: Date.now(), payload,
    }))
  } catch (_error) {
    message('Automatic backup is unavailable in this tab. Use Export to save your edits.', true)
  }
}

function closeModal(id, focusId) {
  $(id).hidden = true
  document.body.classList.remove('corrector-modal-open')
  document.querySelector('.corrector-main').inert = false
  if (focusId) $(focusId).focus()
}

function openModal(id, focusId) {
  $(id).hidden = false
  document.body.classList.add('corrector-modal-open')
  document.querySelector('.corrector-main').inert = true
  $(focusId).focus()
}

async function offerDraftRestore(audio, material) {
  const draft = readDraft(material.material_id)
  if (!draft) return
  const sameRevision = Number(draft.revision) === Number(material.publication_revision) && !material.has_draft
  $('teacher-corrector-restore-text').textContent = sameRevision
    ? 'An unfinished edit from this browser tab was found. Restore it or discard the backup?'
    : 'The live material changed since this backup. Download the old JSON to review it, or discard the backup.'
  $('teacher-corrector-restore').textContent = sameRevision ? 'Restore edit' : 'Download backup'
  openModal('teacher-corrector-restore-dialog', 'teacher-corrector-restore')
  const choice = await new Promise((resolve) => {
    $('teacher-corrector-restore').onclick = () => resolve('restore')
    $('teacher-corrector-discard').onclick = () => resolve('discard')
  })
  closeModal('teacher-corrector-restore-dialog')
  if (choice === 'discard') { clearDraft(material.material_id); return }
  if (!sameRevision) {
    downloadPayload(draft.payload, `${material.material_id}-previous-unpublished-draft.json`)
    return
  }
  const opened = await window.MrCatTranscriptCorrector.open(audio, draft.payload, `${material.material_id}-restored.json`, { unpublished: true })
  if (opened) {
    state.editingMaterialId = material.material_id
    state.editingRevision = material.publication_revision
    const changed = window.MrCatTranscriptCorrector.hasUnpublishedChanges()
    if (!changed) clearDraft(material.material_id)
    message(changed ? 'Unfinished edit restored. Review it before Update.' : 'The restored copy matches the published transcript.')
  }
}

function downloadPayload(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function message(value, error = false) {
  const target = $('teacher-corrector-state')
  target.textContent = value || ''
  target.classList.toggle('is-error', error)
  if ($('corrector-workspace').hidden) $('teacher-corrector-empty').textContent = value || 'Choose a published Listening material to begin.'
}

function updateApply() {
  const selected = state.materials.find((item) => item.material_id === state.selected)
  $('teacher-corrector-apply').disabled = state.busy || !selected || selected.has_draft || state.current?.has_draft || state.editingMaterialId !== state.selected || $('corrector-workspace').hidden || !window.MrCatTranscriptCorrector.hasUnpublishedChanges()
  $('teacher-corrector-material').disabled = state.busy
  for (const id of ['teacher-corrector-load', 'teacher-corrector-import', 'teacher-corrector-audio']) $(id).disabled = state.busy || !state.current
  $('settings-toggle-button').disabled = state.busy || !state.current
  $('export-correction-button').disabled = state.busy || !state.current || state.editingMaterialId !== state.selected || $('corrector-workspace').hidden
  $('teacher-corrector-empty').hidden = !$('corrector-workspace').hidden
  $('load-card').hidden = true
}

async function call(action, payload = {}) {
  const result = await window.MrCatCloud.callAuthenticatedFunction('teacherAdmin', { action, ...payload })
  if (!result || !result.success) throw new Error(result?.message || result?.code || 'Listening request failed')
  return result
}

function rowsFromMaterial(material) {
  return (material.source?.units || []).map((unit) => ({
    unitId: unit.unitId || unit.unit_id,
    speaker: unit.speaker || '',
    text: unit.text || '',
    timestamp: unit.timestamp,
    practiceMode: unit.practiceMode || unit.practice_mode || 'dictation',
    ...(unit.providedWordPositions?.length ? { providedWordPositions: unit.providedWordPositions } : {}),
  }))
}

async function selectMaterial(id) {
  saveDraftNow()
  state.selected = id
  state.current = null
  $('settings-drawer').hidden = true
  $('settings-toggle-button').setAttribute('aria-expanded', 'false')
  updateApply()
  if (!id) { message('Choose a published Listening material to begin.'); return }
  message('Loading private material…')
  try {
    const result = await call('getListeningMaterial', { material_id: id })
    if (state.selected !== id) return
    state.current = result.material
    $('corrector-audio-input').value = ''
    await openLive()
  } catch (error) {
    message(error.message, true)
  }
  updateApply()
}

async function openLive({ skipRestore = false } = {}) {
  if (!state.current || state.busy) return
  saveDraftNow()
  const material = state.current
  const rows = rowsFromMaterial(material)
  if (!rows.length) { message('The live material has no transcript units.', true); return }
  state.busy = true
  updateApply()
  message('Loading audio waveform…')
  try {
    const file = await liveAudioFile(material)
    const opened = await window.MrCatTranscriptCorrector.open(file, rows, `${material.material_id}.json`)
    if (opened) {
      window.MrCatTranscriptCorrector.setPublishedBaseline(rows)
      state.editingMaterialId = material.material_id
      state.editingRevision = material.publication_revision
      message(material.has_draft
        ? 'An unpublished draft exists. Publish or discard it in Teacher Listening before updating.'
        : state.teacherId ? 'Editing the live transcript.' : 'Editing the live transcript. Automatic backup is unavailable; use Export to save a copy.', material.has_draft || !state.teacherId)
      if (!skipRestore) await offerDraftRestore(file, material)
    } else message('The open transcript was kept. Select its material or reload to continue.')
  } catch (error) {
    message(error.message, true)
  } finally {
    $('load-card').hidden = true
    if ($('corrector-workspace').hidden) state.editingMaterialId = ''
    state.busy = false
    updateApply()
  }
}

async function liveAudioFile(material) {
  const localFile = $('corrector-audio-input').files?.[0]
  if (localFile) return localFile
  const src = material.media?.src || material.source?.audioSrc
  if (!src) throw new Error('Audio path is missing. Use local audio to load the matching file.')
  const url = new URL(src, window.location.origin + '/')
  if (url.origin !== window.location.origin) throw new Error('Audio must be same-origin. Use local audio to load the matching file.')
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Audio could not be loaded. Use local audio to load the matching file.')
  const blob = await response.blob()
  return new File([blob], url.pathname.split('/').pop() || 'audio.mp3', { type: blob.type || 'audio/mpeg' })
}

async function openUploadedJson(file) {
  if (!file || !state.current || state.busy) return
  saveDraftNow()
  const material = state.current
  state.busy = true
  updateApply()
  message('Opening uploaded JSON with this material’s audio…')
  try {
    const transcript = JSON.parse(await file.text())
    const audio = await liveAudioFile(material)
    const opened = await window.MrCatTranscriptCorrector.open(audio, transcript, file.name, { unpublished: true })
    if (opened) {
      state.editingMaterialId = material.material_id
      state.editingRevision = material.publication_revision
      message(window.MrCatTranscriptCorrector.hasUnpublishedChanges()
        ? 'Imported JSON opened with this material’s audio. Review it before updating.'
        : 'Imported JSON matches the published transcript.')
      saveDraftNow()
    }
  } catch (error) {
    message(error.message, true)
  } finally {
    $('load-card').hidden = true
    if ($('corrector-workspace').hidden) state.editingMaterialId = ''
    state.busy = false
    updateApply()
  }
}

function showProgress() {
  const dialog = $('teacher-corrector-progress')
  dialog.hidden = false
  dialog.classList.remove('is-success', 'is-error')
  $('teacher-corrector-progress-symbol').textContent = ''
  $('teacher-corrector-progress-title').textContent = 'Updating Listening material'
  $('teacher-corrector-progress-text').textContent = 'Checking and publishing your changes…'
  $('teacher-corrector-progress-close').hidden = true
  document.body.classList.add('corrector-modal-open')
  document.querySelector('.corrector-main').inert = true
  dialog.firstElementChild.focus()
}

function finishProgress(success, detail) {
  const dialog = $('teacher-corrector-progress')
  dialog.classList.add(success ? 'is-success' : 'is-error')
  $('teacher-corrector-progress-symbol').textContent = success ? '✓' : '!'
  $('teacher-corrector-progress-title').textContent = success ? 'Update complete' : 'Update failed'
  $('teacher-corrector-progress-text').textContent = detail
  $('teacher-corrector-progress-close').hidden = false
  $('teacher-corrector-progress-close').focus()
}

function closeProgress() {
  if ($('teacher-corrector-progress-close').hidden) return
  $('teacher-corrector-progress').hidden = true
  document.body.classList.remove('corrector-modal-open')
  document.querySelector('.corrector-main').inert = false
  $('teacher-corrector-apply').focus()
}

function closeExportDialog() {
  $('teacher-corrector-export-dialog').hidden = true
  document.body.classList.remove('corrector-modal-open')
  document.querySelector('.corrector-main').inert = false
  $('export-correction-button').focus()
}

function exportCurrent(draft = false) {
  const id = state.current?.material_id || 'transcript'
  window.MrCatTranscriptCorrector.exportCurrent({ filename: `${id}${draft ? '-unpublished-draft' : '-corrected'}.json` })
}

async function apply({ exportAfterSave = false } = {}) {
  if (!state.current || state.busy || $('teacher-corrector-apply').disabled) return
  showProgress()
  state.busy = true
  updateApply()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  let snapshot
  try { snapshot = window.MrCatTranscriptCorrector.snapshot() } catch (error) {
    message(error.message, true)
    finishProgress(false, error.message)
    state.busy = false
    updateApply()
    return
  }
  const rows = Array.isArray(snapshot.payload) ? snapshot.payload : snapshot.payload?.segments
  if (!Array.isArray(rows) || !rows.length) {
    message('The corrected transcript is empty.', true)
    finishProgress(false, 'The corrected transcript is empty.')
    state.busy = false
    updateApply()
    return
  }
  message('Updating Listening material…')
  const expectedRevision = state.current.publication_revision
  try {
    const result = await call('applyListeningCorrection', {
      material_id: state.current.material_id,
      publication_revision: expectedRevision,
      transcript: snapshot.payload,
    })
    state.current = result.material
    window.MrCatTranscriptCorrector.markApplied()
    clearDraft()
    state.editingRevision = result.material.publication_revision
    let exportMessage = 'Use Export if you want a JSON copy.'
    if (exportAfterSave) {
      try { exportCurrent() ; exportMessage = 'The corrected JSON was downloaded.' }
      catch (_error) { exportMessage = 'The JSON download failed. Use Export to try again.' }
    }
    message('Correction published. Student Listening now uses the revised transcript.')
    finishProgress(true, `The correction is live in the system. ${exportMessage}`)
    try {
      const list = await call('listListeningMaterials')
      state.materials = list.materials.filter((item) => item.has_published && item.publication_status === 'published')
    } catch (_refreshError) {
      // The publication is already confirmed; a list refresh must not report failure.
    }
  } catch (error) {
    try {
      const fresh = await call('getListeningMaterial', { material_id: state.current.material_id })
      state.current = fresh.material
      if (fresh.material.has_draft) {
        message('The correction has an unpublished draft. Review and publish it in Teacher Listening.', true)
      } else if (Number(fresh.material.publication_revision) !== Number(expectedRevision)) {
        state.editingMaterialId = ''
        message('This material changed while you were editing. Reload its live transcript before applying another correction.', true)
      } else message(error.message, true)
    } catch (_refreshError) {
      message(error.message, true)
    }
    finishProgress(false, $('teacher-corrector-state').textContent || error.message)
  } finally {
    state.busy = false
    updateApply()
  }
}

function requestExport() {
  if (state.busy || $('corrector-workspace').hidden) return
  if (window.MrCatTranscriptCorrector.hasUnpublishedChanges()) {
    $('teacher-corrector-save-export').disabled = $('teacher-corrector-apply').disabled
    $('teacher-corrector-export-dialog').hidden = false
    document.body.classList.add('corrector-modal-open')
    document.querySelector('.corrector-main').inert = true
    ;($('teacher-corrector-save-export').disabled ? $('teacher-corrector-draft-export') : $('teacher-corrector-save-export')).focus()
  } else exportCurrent()
}

function closeLeaveDialog() {
  closeModal('teacher-corrector-leave-dialog', 'teacher-corrector-apply')
  state.leaveTarget = null
}

function leaveViaHistory() {
  if (state.historyHasPrevious) history.go(-2)
  else location.assign('teacher.html?view=listening')
}

function requestLeave(target) {
  if (state.busy) return
  saveDraftNow()
  if (!window.MrCatTranscriptCorrector.hasUnpublishedChanges()) {
    if (target === 'history') leaveViaHistory()
    else location.assign(target)
    return
  }
  state.leaveTarget = target
  openModal('teacher-corrector-leave-dialog', 'teacher-corrector-stay')
}

function installHistoryGuard() {
  if (history.state?.[HISTORY_GUARD]) return
  history.pushState({ ...(typeof history.state === 'object' && history.state ? history.state : {}), [HISTORY_GUARD]: true }, '', location.href)
}

window.addEventListener('popstate', () => {
  if (!state.authorized) return
  // Back landed on the editor's base entry. Restore the guard before asking.
  if (!history.state?.[HISTORY_GUARD]) {
    installHistoryGuard()
    requestLeave('history')
  }
})

window.addEventListener('mr-cat-corrector-changed', () => {
  clearTimeout(state.draftTimer)
  if (window.MrCatTranscriptCorrector.hasUnpublishedChanges()) state.draftTimer = setTimeout(saveDraftNow, 250)
  else clearDraft()
  updateApply()
})
window.addEventListener('pagehide', saveDraftNow)
document.querySelector('.teacher-corrector-bar .back-button').addEventListener('click', (event) => {
  event.preventDefault()
  requestLeave(event.currentTarget.href)
})
$('teacher-corrector-stay').addEventListener('click', closeLeaveDialog)
$('teacher-corrector-leave').addEventListener('click', () => {
  const target = state.leaveTarget
  saveDraftNow()
  window.MrCatTranscriptCorrector.confirmLeave()
  closeLeaveDialog()
  if (target === 'history') leaveViaHistory()
  else if (target) location.assign(target)
})

async function init() {
  try {
    const session = await window.MrCatAuth.getSession()
    if (session.mode !== 'teacher' || session.profile?.active === false) throw new Error('Teacher access required')
    state.teacherId = String(session.profile?.student_id || '').trim()
    state.authorized = true
    state.historyHasPrevious = history.length > (history.state?.[HISTORY_GUARD] ? 2 : 1)
    installHistoryGuard()
    const result = await call('listListeningMaterials')
    state.materials = result.materials.filter((item) => item.has_published && item.publication_status === 'published')
    $('teacher-corrector-material').replaceChildren(new Option('Choose material', ''), ...state.materials.map((item) => new Option(`${item.title} · ${item.material_id}${item.has_draft ? ' · draft pending' : ''}`, item.material_id)))
    document.querySelector('.corrector-main').hidden = false
    $('teacher-corrector-access').hidden = true
    const wanted = new URLSearchParams(location.search).get('material')
    if (wanted && state.materials.some((item) => item.material_id === wanted)) {
      $('teacher-corrector-material').value = wanted
      await selectMaterial(wanted)
    } else message(wanted ? 'Material is unavailable. Choose a published Listening material.' : 'Choose a published Listening material to begin.')
    updateApply()
  } catch (error) {
    $('teacher-corrector-access').textContent = error.message === 'Teacher access required' ? 'Teacher access required. Sign in from the Teacher page.' : `Unable to open Teacher corrector: ${error.message}`
    $('teacher-corrector-signin').hidden = false
  }
}

$('teacher-corrector-material').addEventListener('change', (event) => selectMaterial(event.target.value))
$('teacher-corrector-load').addEventListener('click', () => openLive({ skipRestore: true }))
$('teacher-corrector-import').addEventListener('click', () => $('corrector-json-input').click())
$('teacher-corrector-audio').addEventListener('click', () => $('corrector-audio-input').click())
$('corrector-audio-input').addEventListener('change', () => { if (state.current) openLive() })
$('teacher-corrector-apply').addEventListener('click', () => apply())
$('export-correction-button').addEventListener('click', requestExport)
$('teacher-corrector-save-export').addEventListener('click', () => { closeExportDialog(); apply({ exportAfterSave: true }) })
$('teacher-corrector-draft-export').addEventListener('click', () => { closeExportDialog(); exportCurrent(true) })
$('teacher-corrector-export-cancel').addEventListener('click', closeExportDialog)
$('teacher-corrector-progress-close').addEventListener('click', closeProgress)
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (!$('teacher-corrector-export-dialog').hidden) closeExportDialog()
  else if (!$('teacher-corrector-progress').hidden && !$('teacher-corrector-progress-close').hidden) closeProgress()
})
$('corrector-json-input').addEventListener('change', (event) => openUploadedJson(event.target.files?.[0]))
new MutationObserver(updateApply).observe($('corrector-workspace'), { attributes: true, attributeFilter: ['hidden'] })
init()
