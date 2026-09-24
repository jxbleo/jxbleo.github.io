const $ = (id) => document.getElementById(id)
const state = { materials: [], selected: '', current: null, editingMaterialId: '', busy: false }

function message(value, error = false) {
  const target = $('teacher-corrector-state')
  target.textContent = value || ''
  target.classList.toggle('is-error', error)
}

function updateApply() {
  const selected = state.materials.find((item) => item.material_id === state.selected)
  $('teacher-corrector-apply').disabled = state.busy || !selected || selected.has_draft || state.current?.has_draft || state.editingMaterialId !== state.selected || $('corrector-workspace').hidden
  $('teacher-corrector-material').disabled = state.busy
  $('teacher-corrector-load').disabled = state.busy
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
  state.selected = id
  state.current = null
  updateApply()
  if (!id) return
  message('Loading private material…')
  try {
    const result = await call('getListeningMaterial', { material_id: id })
    if (state.selected !== id) return
    state.current = result.material
    message(result.material.has_draft
      ? 'This material has an unpublished draft. Publish or discard that draft in Teacher Listening before applying a correction.'
      : state.editingMaterialId && state.editingMaterialId !== id
        ? 'Replace the open files before applying a correction to this material.'
        : 'Choose matching audio and JSON, or open the live transcript.', result.material.has_draft)
  } catch (error) {
    message(error.message, true)
  }
  updateApply()
}

async function openLive() {
  if (!state.current) { message('Choose a live material first.', true); return }
  const material = state.current
  const rows = rowsFromMaterial(material)
  if (!rows.length) { message('The live material has no transcript units.', true); return }
  state.busy = true
  updateApply()
  message('Loading audio waveform…')
  try {
    const file = await liveAudioFile(material)
    const opened = await window.MrCatTranscriptCorrector.open(file, rows, `${material.material_id}.json`)
    if (opened) message('Live transcript opened. Apply correction updates this material for students.')
  } catch (error) {
    message(error.message, true)
  } finally {
    state.busy = false
    updateApply()
  }
}

async function liveAudioFile(material) {
  const src = material.media?.src || material.source?.audioSrc
  if (!src) throw new Error('The live material has no audio path. Choose the matching audio file from your device.')
  const url = new URL(src, window.location.origin + '/')
  if (url.origin !== window.location.origin) throw new Error('Choose the matching audio file from your device.')
  const response = await fetch(url, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Audio could not be loaded. Choose the matching audio file from your device.')
  const blob = await response.blob()
  return new File([blob], url.pathname.split('/').pop() || 'audio.mp3', { type: blob.type || 'audio/mpeg' })
}

async function openUploadedJson(file) {
  if (!file || !state.current || $('corrector-audio-input').files?.length || state.busy) return
  const material = state.current
  state.busy = true
  updateApply()
  message('Opening uploaded JSON with this material’s audio…')
  try {
    const transcript = JSON.parse(await file.text())
    const audio = await liveAudioFile(material)
    const opened = await window.MrCatTranscriptCorrector.open(audio, transcript, file.name)
    if (opened) message('Uploaded JSON opened with this material’s audio. Review it before applying correction.')
  } catch (error) {
    message(error.message, true)
  } finally {
    state.busy = false
    updateApply()
  }
}

async function apply() {
  if (!state.current || state.busy) return
  let snapshot
  try { snapshot = window.MrCatTranscriptCorrector.snapshot() } catch (error) { message(error.message, true); return }
  const rows = Array.isArray(snapshot.payload) ? snapshot.payload : snapshot.payload?.segments
  if (!Array.isArray(rows) || !rows.length) { message('The corrected transcript is empty.', true); return }
  state.busy = true
  updateApply()
  message('Checking and publishing correction…')
  const expectedRevision = state.current.publication_revision
  try {
    const result = await call('applyListeningCorrection', {
      material_id: state.current.material_id,
      publication_revision: expectedRevision,
      transcript: snapshot.payload,
    })
    state.current = result.material
    window.MrCatTranscriptCorrector.markApplied()
    message('Correction published. Student Listening now uses the revised transcript.')
    const list = await call('listListeningMaterials')
    state.materials = list.materials.filter((item) => item.has_published && item.publication_status === 'published')
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
  } finally {
    state.busy = false
    updateApply()
  }
}

async function init() {
  try {
    const session = await window.MrCatAuth.getSession()
    if (session.mode !== 'teacher' || session.profile?.active === false) throw new Error('Teacher access required')
    const result = await call('listListeningMaterials')
    state.materials = result.materials.filter((item) => item.has_published && item.publication_status === 'published')
    $('teacher-corrector-material').replaceChildren(new Option('Choose material', ''), ...state.materials.map((item) => new Option(`${item.title} · ${item.material_id}${item.has_draft ? ' · draft pending' : ''}`, item.material_id)))
    $('teacher-corrector-bar').hidden = false
    document.querySelector('.corrector-main').hidden = false
    $('teacher-corrector-access').hidden = true
    const wanted = new URLSearchParams(location.search).get('material')
    if (wanted && state.materials.some((item) => item.material_id === wanted)) {
      $('teacher-corrector-material').value = wanted
      await selectMaterial(wanted)
    } else message('Choose a live material, then upload JSON or open its current transcript.')
  } catch (error) {
    $('teacher-corrector-access').textContent = error.message === 'Teacher access required' ? 'Teacher access required. Sign in from the Teacher page.' : `Unable to open Teacher corrector: ${error.message}`
    $('teacher-corrector-signin').hidden = false
  }
}

$('teacher-corrector-material').addEventListener('change', (event) => selectMaterial(event.target.value))
$('teacher-corrector-load').addEventListener('click', openLive)
$('teacher-corrector-apply').addEventListener('click', apply)
$('corrector-json-input').addEventListener('change', (event) => openUploadedJson(event.target.files?.[0]))
new MutationObserver(() => {
  state.editingMaterialId = $('corrector-workspace').hidden ? '' : state.selected
  updateApply()
}).observe($('corrector-workspace'), { attributes: true, attributeFilter: ['hidden'] })
init()
