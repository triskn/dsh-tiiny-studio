import { test } from 'node:test'
import assert from 'node:assert/strict'
import historyFeedbackTools from '../ui/history-feedback.part.js'

const { confirmedRemoval, historyIsEmpty } = historyFeedbackTools()
const ready = { ready: true, busy: false, error: '' }

test('deleting the last job leaves only a neutral empty history and an accessibility announcement', () => {
  assert.deepEqual(confirmedRemoval({ id: 'last', hasOutput: false }, { scope: 'job' }), { announcement: 'jobRemoved', retainedId: null })
  assert.deepEqual(confirmedRemoval({ id: 'last', hasOutput: true }, { scope: 'job', deleteOutput: true }), { announcement: 'jobAndOutputRemoved', retainedId: null })
  assert.equal(historyIsEmpty(0, ready, false, null), true)
})

test('the rescan for a kept output never flashes an empty library; a retained job remains the focus target', () => {
  const job = { id: 'image', hasOutput: true }
  assert.deepEqual(confirmedRemoval(job, { scope: 'job', deleteOutput: false }), { announcement: 'jobRemovedKept', retainedId: null })
  assert.equal(historyIsEmpty(0, ready, true, null), false)
  assert.equal(historyIsEmpty(0, { ...ready, busy: true }, false, null), false)
  assert.equal(historyIsEmpty(1, ready, false, null), false)
  assert.deepEqual(confirmedRemoval(job, { scope: 'output' }), { announcement: 'outputRemoved', retainedId: job.id })
})

test('an unread library or an unresolved deletion is not presented as an empty success', () => {
  for (const state of [{ ...ready, ready: false }, { ...ready, error: 'offline' }]) assert.equal(historyIsEmpty(0, state, false, null), false)
  for (const key of ['deleteError', 'deleteUnknown']) assert.equal(historyIsEmpty(0, ready, false, { key }), false)
})

test('standalone removal announcements distinguish a file from an unavailable listing without inventing a job', () => {
  for (const [item, expected] of [[{ id: 'file:example', hasOutput: true }, 'fileRemoved'], [{ id: 'file:saved', assetId: 'ref', hasOutput: true }, 'libraryRemoved'], [{ id: 'file:lost', canForget: true, hasOutput: false }, 'forgotLibrary']]) {
    assert.deepEqual(confirmedRemoval(item, { scope: 'output' }), { announcement: expected, retainedId: null })
  }
})
