import { test } from 'node:test'
import assert from 'node:assert/strict'
import previewProportionsTools from '../ui/preview-proportions.part.js'

const { referenceFit } = previewProportionsTools()
const size = (width, height) => ({ width, height })

test('the reported 480×832 export offers its square reference as a preview-only alternate', () => {
  const clip = Object.freeze(size(480, 832)), frame = Object.freeze(size(1024, 1024))
  assert.deepEqual(referenceFit(clip, frame), { ratio: 1, label: '1:1', maxWidth: 480 })
})

test('no alternate for matching display shapes, encoders rounding a pixel or missing reference metadata', () => {
  assert.equal(referenceFit(size(480, 832), size(960, 1664)), null)
  assert.equal(referenceFit(size(854, 480), size(1920, 1080)), null)
  for (const missing of [undefined, null, {}, size(0, 900), size(400, 0), size(Infinity, 200), size(32, NaN), size(-1, 1), size('1024', '1024')]) {
    assert.equal(referenceFit(size(480, 832), missing), null)
    assert.equal(referenceFit(missing, size(1024, 1024)), null)
  }
})

test('a correction for a landscape, small or rotated source never requires enlarging either decoded axis', () => {
  for (const [clip, frame, ratio, label] of [[size(832, 480),size(600, 800),3 / 4,'3:4'],[size(160, 90),size(400, 300),4 / 3,'4:3'],[size(120, 320),size(3840, 2160),16 / 9,'16:9']]) {
    const alternate = referenceFit(clip, frame)
    assert.equal(alternate.ratio, ratio); assert.equal(alternate.label, label)
    assert.ok(alternate.maxWidth <= clip.width && alternate.maxWidth / alternate.ratio <= clip.height)
  }
})
