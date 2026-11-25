import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorkbench } from '../workbench.js'
import { createActivityGate } from '../activity.js'

// Local cancellation is not a guarantee that an expensive remote generation has stopped.
// Test what a fresh Studio Host permits *before* it can send a 3D launch request.
test('a stale media attempt must be verified on the right device before a model load', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-media-load-'))
  const baseUrl = 'http://unit-media.invalid/old/v1'
  const vars = { TIINY_VIDEO_HOME: home, TIINY_BASE_URL: baseUrl, TIINY_API_KEY: 'unit-only' }
  const previous = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]))
  Object.assign(process.env, vars)
  const app = createWorkbench()
  t.after(async () => {
    await app.dispose()
    for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v
    await fs.rm(home, { recursive: true, force: true }) // Only this test's mkdtemp.
  })
  let remoteStatus = 'in_progress', calls = 0
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).href, baseUrl + '/videos/prior-job')
    assert.ok(!init.method || init.method === 'GET')
    assert.equal(init.headers.authorization, 'Bearer unit-only')
    ++calls
    return Response.json({ status: remoteStatus })
  })
  const history = path.join(home, 'history.json')
  const note = { id: 'old', kind: 'video', deviceBase: baseUrl, remotePending: true, prompt: 'old prompt', status: 'cancelled', tiinyId: 'prior-job' }
  await fs.writeFile(history, JSON.stringify([note]))
  assert.ok(await app.checkMediaForLoad({ verifiedIdle: true, baseUrl }), 'positive video running status overrides idle model counts')
  remoteStatus = 'completed'
  assert.equal(await app.checkMediaForLoad({}), '')
  await fs.writeFile(history, JSON.stringify([{ ...note, kind: 'image', tiinyId: undefined }]))
  assert.ok(await app.checkMediaForLoad({ verifiedIdle: true, baseUrl: 'http://another.invalid/v1' }), 'wrong device is never evidence')
  assert.ok(await app.checkMediaForLoad({ verifiedIdle: false, baseUrl }))
  assert.equal(await app.checkMediaForLoad({ verifiedIdle: true, baseUrl }), '')
  assert.equal(calls, 2)
})

test('a Host closed during device reconciliation never starts a dormant image request', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-admission-close-'))
  const vars = { TIINY_VIDEO_HOME: home, TIINY_BASE_URL: 'http://recovery.invalid/v1', TIINY_API_KEY: 'fixture-only' }
  const previous = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]))
  Object.assign(process.env, vars)
  let entered, finish, calls = 0
  const checking = new Promise(resolve => { entered = resolve })
  const result = new Promise(resolve => { finish = resolve })
  const gate = createActivityGate()
  const app = createWorkbench(null, { gate, checkThree: () => { entered(); return result } })
  t.after(async () => {
    finish(null); await app.dispose()
    for (const [k, v] of Object.entries(previous)) if (v === undefined) delete process.env[k]; else process.env[k] = v
    await fs.rm(home, { recursive: true, force: true }) // The exact test-owned mkdtemp root.
  })
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('An interrupted admission must not reach a device') })
  const request = app.start({ kind: 'image', prompt: 'test cat' })
  await checking
  assert.equal(gate.snapshot().kind, 'image')
  gate.close(); await app.dispose(); finish(null)
  await assert.rejects(request, e => e.status === 503 && e.code === 'inactive')
  assert.deepEqual(gate.snapshot(), { busy: false })
  await assert.rejects(fs.stat(path.join(home, 'history.json')), { code: 'ENOENT' })
  assert.equal(calls, 0)
})

test('only the current owner may release a Studio device operation', () => {
  const gate = createActivityGate(), first = gate.acquire('3d-load')
  assert.throws(() => gate.acquire('image'), e => e.code === 'device_busy')
  first()
  const second = gate.acquire('3d'); first()
  assert.equal(gate.snapshot().kind, '3d'); second()
  assert.deepEqual(gate.snapshot(), { busy: false })
  const editing = gate.acquire('3d-library')
  assert.equal(gate.snapshot().kind, '3d-library')
  assert.throws(() => gate.acquire('image'), e => e.code === 'studio_library_busy' && e.message.includes('updating the 3D library'))
  editing()
  gate.close(); assert.throws(() => gate.acquire('video'), e => e.status === 503)
})
