import { test } from 'node:test'
import assert from 'node:assert/strict'
import videoDraftTools from '../ui/video-draft.part.js'

// These are the same pure draft operations the client embeds. No fake UI, device, or HTTP calls.
const { emptyVideo, withSavedFrame, promptField, videoRequest, draftFromJob } = videoDraftTools()
const image = Object.freeze({ kind: 'image', status: 'completed', assetId: 'kitten.png', file: 'saved-kitten.png', prompt: '一只橘白小猫坐在浅蓝色背景前。' })
for (const position of ['first', 'last']) {
  test(`choosing a ${position} frame in a fresh draft attaches only the picture, never its static prompt`, () => {
    const fresh = Object.freeze({ ...emptyVideo, size: '832x480', seconds: 5 })
    const draft = withSavedFrame(fresh, image, position)
    assert.deepEqual(draft, { ...fresh, prompt: '', reference: { type: 'asset', id: image.assetId, name: image.file }, frameMode: position })
    assert.equal(fresh.reference, null)
    assert.equal(videoRequest(draft, draft.size, draft.seconds), null, 'a placeholder is not submitted as a prompt')
    assert.equal(videoRequest({ ...draft, prompt: ' \n' }, draft.size, draft.seconds), null)
    const typed = '小猫眨眼，镜头缓缓推近。'
    assert.deepEqual(videoRequest({ ...draft, prompt: typed }, draft.size, draft.seconds),
      { kind: 'video', prompt: typed, size: '832x480', seconds: 5, frameMode: position, imageAssetId: image.assetId })
  })
}

test('replacing a frame preserves even deliberately identical or multiline authored video text', () => {
  for (const prompt of [image.prompt, '  Turn left.\nSlowly push in.  ']) {
    const base = Object.freeze({ ...emptyVideo, prompt, size: '480x832', seconds: 6 })
    const first = withSavedFrame(base, image, 'first')
    const last = withSavedFrame(first, { assetId: 'other.png', file: 'second.png', prompt: 'A completely different static scene.' }, 'last')
    assert.equal(first.prompt, prompt); assert.equal(last.prompt, prompt)
    assert.equal(last.size, base.size); assert.equal(last.seconds, base.seconds)
    assert.equal(first.reference.id, image.assetId); assert.equal(last.reference.id, 'other.png')
  }
})

test('field guidance follows the current tab and attached first/last frame, not the last selection notice', () => {
  for (const type of ['asset', 'upload']) {
    const draft = { ...emptyVideo, reference: { type } }
    for (const position of ['first', 'last']) {
      const state = { ...draft, frameMode: position }
      assert.deepEqual(promptField('video', state), { label: 'motionPrompt', placeholder: `${position}MotionExample`, hint: `${position}MotionHint` })
      assert.deepEqual(promptField('image', state), { label: 'imagePrompt', placeholder: 'imagePlaceholder' })
    }
  }
  for (const reference of [null, { type: 'missing' }]) assert.deepEqual(promptField('video', { ...emptyVideo, frameMode: 'last', reference }), { label: 'videoPrompt', placeholder: 'videoPlaceholder' })
})

test('restoring a saved video reuses its exact prompt and frame; a lost reference still blocks submission', () => {
  const record = { kind: 'video', prompt: '  静止两秒，再向右摇镜。', frameAssetId: image.assetId, frameMode: 'last', size: '480x832', seconds: 7 }
  const restored = draftFromJob(record)
  assert.equal(restored.prompt, record.prompt); assert.equal(restored.seconds, 7); assert.equal(restored.size, '480x832')
  assert.equal(restored.reference.id, image.assetId); assert.equal(restored.frameMode, 'last')
  const missing = draftFromJob({ ...record, frameAssetId: undefined })
  assert.equal(missing.prompt, record.prompt); assert.equal(videoRequest(missing, missing.size, missing.seconds), null)
})
