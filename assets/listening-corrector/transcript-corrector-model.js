export const MIN_SEGMENT_SECONDS = 0.05

function finiteSeconds(value, label) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`${label} must be a positive time`)
  return seconds
}

export function parseClock(value) {
  const parts = String(value || '').trim().split(':')
  if (parts.length !== 2 && parts.length !== 3) throw new Error(`Invalid time: ${value}`)
  const secondsPart = Number(parts.at(-1))
  const minutesPart = Number(parts.at(-2))
  const hoursPart = parts.length === 3 ? Number(parts[0]) : 0
  if (![secondsPart, minutesPart, hoursPart].every(Number.isFinite) || secondsPart < 0 || secondsPart >= 60 || minutesPart < 0 || (parts.length === 3 && minutesPart >= 60) || hoursPart < 0) {
    throw new Error(`Invalid time: ${value}`)
  }
  return Math.round((hoursPart * 3600 + minutesPart * 60 + secondsPart) * 1000) / 1000
}

export function parseTimestampRange(value) {
  const match = String(value || '').trim().match(/^(.+?)\s*(?:-->|[–—-])\s*(.+)$/)
  if (!match) throw new Error(`Invalid timestamp range: ${value}`)
  const start = parseClock(match[1])
  const end = parseClock(match[2])
  if (end - start < MIN_SEGMENT_SECONDS) throw new Error(`Timestamp must be at least ${MIN_SEGMENT_SECONDS.toFixed(2)} seconds`)
  return { start, end }
}

export function formatClock(value) {
  let milliseconds = Math.max(0, Math.round(finiteSeconds(value, 'Time') * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  milliseconds -= hours * 3_600_000
  const minutes = Math.floor(milliseconds / 60_000)
  milliseconds -= minutes * 60_000
  const seconds = Math.floor(milliseconds / 1000)
  const millis = milliseconds - seconds * 1000
  const secondText = `${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
  if (hours) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secondText}`
  return `${String(minutes).padStart(2, '0')}:${secondText}`
}

export function formatTimestampRange(start, end) {
  return `${formatClock(start)}-${formatClock(end)}`
}

function segmentId(index) {
  return `segment-${String(index + 1).padStart(4, '0')}`
}

export function importTranscriptPayload(payload) {
  const wrapped = payload && !Array.isArray(payload) && Array.isArray(payload.segments)
  const rows = Array.isArray(payload) ? payload : wrapped ? payload.segments : null
  if (!rows) throw new Error('JSON must be an array or an object containing a segments array')
  if (!rows.length) throw new Error('JSON contains no transcript segments')
  const segments = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Segment ${index + 1} must be an object`)
    const text = String(row.text || '').trim()
    if (!text) throw new Error(`Segment ${index + 1} has no text`)
    let range
    try {
      range = parseTimestampRange(row.timestamp)
    } catch (error) {
      throw new Error(`Segment ${index + 1}: ${error.message}`)
    }
    const { speaker, text: ignoredText, timestamp, ...extra } = row
    return {
      id: segmentId(index),
      speaker: String(speaker || '').trim(),
      text,
      start: range.start,
      end: range.end,
      extra,
    }
  })
  return {
    segments,
    sourceShape: wrapped ? 'wrapped' : 'array',
    wrapperExtra: wrapped ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'segments')) : {},
  }
}

export function exportTranscriptPayload(segments, sourceShape = 'array', wrapperExtra = {}) {
  const rows = segments.map((segment) => ({
    ...(segment.extra || {}),
    speaker: String(segment.speaker || '').trim(),
    text: String(segment.text || '').trim(),
    timestamp: formatTimestampRange(segment.start, segment.end),
  }))
  return sourceShape === 'wrapped' ? { ...wrapperExtra, segments: rows } : rows
}

export function analyzeSegments(segments, duration = null) {
  const issues = new Map()
  const add = (id, type, message) => {
    if (!issues.has(id)) issues.set(id, [])
    issues.get(id).push({ type, message })
  }
  let overlapCount = 0
  let emptyCount = 0
  let rangeCount = 0
  segments.forEach((segment, index) => {
    if (!String(segment.text || '').trim()) {
      emptyCount += 1
      add(segment.id, 'empty', 'Sentence text is empty')
    }
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end - segment.start < MIN_SEGMENT_SECONDS) {
      rangeCount += 1
      add(segment.id, 'range', 'Timestamp range is invalid')
    }
    if (Number.isFinite(duration) && segment.end > duration + 0.01) {
      rangeCount += 1
      add(segment.id, 'duration', 'Sentence ends after the audio')
    }
    const previous = segments[index - 1]
    if (previous && segment.start < previous.end - 0.0005) {
      overlapCount += 1
      const amount = previous.end - segment.start
      add(previous.id, 'overlap', `Overlaps sentence ${index + 1} by ${amount.toFixed(3)} s`)
      add(segment.id, 'overlap', `Overlaps sentence ${index} by ${amount.toFixed(3)} s`)
    }
  })
  return { issues, overlapCount, emptyCount, rangeCount, warningCount: overlapCount + emptyCount + rangeCount }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function constrainSegmentRange(segments, index, requestedStart, requestedEnd, options = {}) {
  const current = segments[index]
  if (!current) throw new Error('Segment was not found')
  const duration = Number.isFinite(options.duration) ? options.duration : Number.POSITIVE_INFINITY
  const mode = options.mode || 'resize'
  const previous = segments[index - 1]
  const next = segments[index + 1]
  const leftBoundary = previous ? (current.start < previous.end ? current.start : previous.end) : 0
  const rightBoundary = next ? (current.end > next.start ? current.end : next.start) : duration
  let start = finiteSeconds(requestedStart, 'Start')
  let end = finiteSeconds(requestedEnd, 'End')

  if (mode === 'move') {
    const length = current.end - current.start
    const maxStart = Math.max(leftBoundary, rightBoundary - length)
    start = clamp(start, leftBoundary, maxStart)
    end = start + length
  } else {
    start = clamp(start, leftBoundary, Math.max(leftBoundary, end - MIN_SEGMENT_SECONDS))
    end = clamp(end, start + MIN_SEGMENT_SECONDS, rightBoundary)
  }
  if (Number.isFinite(duration) && end > duration) {
    if (mode === 'move') start = Math.max(0, duration - (end - start))
    end = duration
  }
  if (end - start < MIN_SEGMENT_SECONDS) throw new Error('Neighbouring sentences leave no room for this edit')
  return { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }
}

export function splitSegment(segments, index, splitTime, textOffset, newId) {
  const current = segments[index]
  if (!current) throw new Error('Choose a sentence first')
  const time = finiteSeconds(splitTime, 'Split time')
  if (time - current.start < MIN_SEGMENT_SECONDS || current.end - time < MIN_SEGMENT_SECONDS) {
    throw new Error('Place the playhead inside the selected sentence')
  }
  const offset = Number(textOffset)
  const before = current.text.slice(0, offset).trim()
  const after = current.text.slice(offset).trim()
  if (!before || !after) throw new Error('Place the text cursor between two words before splitting')
  const leftCount = before.split(/\s+/).filter(Boolean).length
  const positions = current.extra?.providedWordPositions || current.extra?.provided_word_positions
  const positionKey = Array.isArray(current.extra?.providedWordPositions) ? 'providedWordPositions' : 'provided_word_positions'
  const leftExtra = structuredClone(current.extra || {})
  const rightExtra = structuredClone(current.extra || {})
  delete rightExtra.unitId
  delete rightExtra.unit_id
  delete rightExtra.segment_id
  delete rightExtra.slots
  if (Array.isArray(positions)) {
    leftExtra[positionKey] = positions.filter((position) => Number(position) <= leftCount)
    rightExtra[positionKey] = positions.filter((position) => Number(position) > leftCount).map((position) => Number(position) - leftCount)
  }
  const left = { ...structuredClone(current), extra: leftExtra, text: before, end: Math.round(time * 1000) / 1000 }
  const right = {
    id: newId,
    speaker: current.speaker,
    text: after,
    start: Math.round(time * 1000) / 1000,
    end: current.end,
    extra: rightExtra,
  }
  return [...segments.slice(0, index), left, right, ...segments.slice(index + 1)]
}

export function mergeSegment(segments, index, direction) {
  const otherIndex = index + direction
  if (!segments[index] || !segments[otherIndex]) throw new Error('There is no neighbouring sentence to merge')
  const firstIndex = Math.min(index, otherIndex)
  const secondIndex = Math.max(index, otherIndex)
  const first = segments[firstIndex]
  const second = segments[secondIndex]
  const joined = `${String(first.text || '').trim()} ${String(second.text || '').trim()}`.trim()
  const merged = {
    ...structuredClone(first),
    text: joined,
    start: Math.min(first.start, second.start),
    end: Math.max(first.end, second.end),
  }
  return {
    segments: [...segments.slice(0, firstIndex), merged, ...segments.slice(secondIndex + 1)],
    selectedId: merged.id,
  }
}
