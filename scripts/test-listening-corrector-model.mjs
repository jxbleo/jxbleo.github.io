#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
const modelSource = fs.readFileSync(new URL('../assets/listening-corrector/transcript-corrector-model.js', import.meta.url), 'utf8')
const {
  importTranscriptPayload, exportTranscriptPayload, splitSegment,
  mergeSegment, analyzeSegments, parseTimestampRange, constrainSegmentRange,
  dictationWords, providedWordPositions, remapProvidedWordPositions, segmentPracticeMode,
} = await import('data:text/javascript;base64,' + Buffer.from(modelSource).toString('base64'))

assert.deepEqual(parseTimestampRange('00:08.599-00:12.280'), { start: 8.599, end: 12.28 })
const input = { materialId: 'IL-TEST', segments: [
  { unitId: 'unit-1', practiceMode: 'dictation', providedWordPositions: [3], text: 'These two words', timestamp: '00:00.000-00:03.000', speaker: 'Host' },
  { unitId: 'unit-2', practiceMode: 'skip', text: 'Goodbye.', timestamp: '00:03.000-00:04.000', speaker: 'Host' },
] }
const imported = importTranscriptPayload(input)
assert.equal(imported.sourceShape, 'wrapped')
assert.equal(analyzeSegments(imported.segments, 4).warningCount, 0)
const split = splitSegment(imported.segments, 0, 1.5, 9, 'unit-new')
assert.deepEqual(split[0].extra.providedWordPositions, [])
assert.deepEqual(split[1].extra.providedWordPositions, [1])
assert.equal(split[1].extra.practiceMode, 'dictation')
assert.equal(split[1].extra.unitId, undefined)
const exported = exportTranscriptPayload(split, imported.sourceShape, imported.wrapperExtra)
assert.equal(exported.materialId, 'IL-TEST')
assert.equal(exported.segments.length, 3)
assert.deepEqual(dictationWords('“Hello,” world!').map(({ answer }) => answer), ['Hello', 'world'])
assert.deepEqual(providedWordPositions(imported.segments[0]), [3])
assert.equal(segmentPracticeMode(imported.segments[1]), 'skip')
assert.deepEqual(remapProvidedWordPositions('These two words', 'These extra two words', [3]), [4])
assert.deepEqual(remapProvidedWordPositions('These two words', 'These two phrases', [3]), [])
const merged = mergeSegment(split, 1, -1)
assert.equal(merged.segments[0].text, 'These two words')
assert.deepEqual(merged.segments[0].extra.providedWordPositions, [3])
assert.throws(() => mergeSegment(imported.segments, 0, 1), /same mode/)
assert.deepEqual(constrainSegmentRange(imported.segments, 0, 0, 3.8, { duration: 4, mode: 'resize' }), { start: 0, end: 3 })
assert.deepEqual(constrainSegmentRange(imported.segments, 1, 2.2, 4, { duration: 4, mode: 'resize' }), { start: 3, end: 4 })
console.log('Hosted Listening corrector model tests passed.')
