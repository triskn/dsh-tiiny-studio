import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

// Model IDs deliberately say nothing about modality. The device advertises both
// type and running status; these tests do not assume any real device/model name.
const ORIGIN = 'http://fixture.tiiny.invalid'
const KEY = 'workflow-test-sentinel-not-a-real-key'
const DEVICE_TOKEN = 'workflow-test-other-bearer-token'
const MODEL_A = 'fixture/alpha', MODEL_B = 'fixture/beta', IMAGE_MODEL = 'fixture/gamma'
const CATALOG = [
  { id: MODEL_A, type: 'Text-to-Video' },
  { id: MODEL_B, type: 'Text-to-Video' },
  { id: IMAGE_MODEL, type: 'Text-to-Image' },
]
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwLT4JAAKaAYrkCljtAAAAAElFTkSuQmCC', 'base64')
const REFERENCE = 'data:image/png;base64,' + PNG.toString('base64')
const CLIP = Buffer.from('offline fixture video')
const PREFIX = '/tiiny-video'

function assertPublic(value) {
  const text = JSON.stringify(value)
  assert.ok(!text.includes(KEY) && !text.includes(DEVICE_TOKEN), 'credentials must not appear in responses or job history')
  assert.ok(!text.includes(PNG.toString('base64')), 'store frame handles, not embedded images, in views/history')
}

// Capture exactly what the device received, not just the job's local metadata.
async function videoInput(body) {
  let fields, first = null
  if (body instanceof FormData) {
    fields = Object.fromEntries(body)
    const file = body.get('input_reference')
    if (file) first = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`
  } else {
    fields = JSON.parse(body)
    first = fields.input_reference ?? null
  }
  return { model: fields.model, prompt: fields.prompt, size: fields.size, seconds: Number(fields.seconds), first, last: fields.last_frame ?? null }
}

function mockDevice(t) {
  const device = { running: MODEL_A, videos: [], images: [] }
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input)
    assert.equal(url.origin, ORIGIN, 'all device requests must use the test fixture')
    const route = url.pathname.replace(/\/$/, '')
    const method = init.method || 'GET'
    const running = CATALOG.filter((row) => row.id === device.running)
    if (method === 'GET' && route === '/v1/models') return Response.json({ object: 'list', data: running })
    if (method === 'GET' && route === '/api/v1/models') return Response.json({
      object: 'list', data: CATALOG.map((row) => ({ ...row, model_id: row.id, status: row.id === device.running ? 'running' : 'downloaded' })),
    })
    if (method === 'GET' && route === '/api/v1/models/running') {
      return Response.json({ running: running.map(({ id }) => id), pending: [], instances: [] })
    }
    if (method === 'POST' && route === '/v1/images/generations') {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${KEY}`)
      device.images.push(JSON.parse(init.body))
      return Response.json({ data: [{ b64_json: PNG.toString('base64') }] })
    }
    if (method === 'POST' && route === '/v1/videos') {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${KEY}`)
      const submission = await videoInput(init.body)
      device.videos.push(submission)
      if (device.createVideo) return device.createVideo(submission)
      return Response.json({ id: `remote-${device.videos.length}`, status: 'completed' })
    }
    if (method === 'GET' && /^\/v1\/videos\/[^/]+\/content$/.test(route)) return new Response(CLIP)
    if (method === 'DELETE' && /^\/v1\/videos\/[^/]+$/.test(route)) return new Response(null, { status: 204 })
    throw new Error(`Unexpected device request: ${method} ${route}`)
  })
  return device
}

// Drive the actual registered handler in process. Writable also handles the
// streamed image/video URLs; no listening socket or live DSH session is needed.
async function dispatch(handler, pathname, body) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method: body === undefined ? 'GET' : 'POST', url: PREFIX + pathname,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  })
  const chunks = []
  let status, headers
  const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } })
  res.writeHead = (code, fields) => { status = code; headers = new Headers(fields); return res }
  await handler(req, res)
  await finished(res, { signal: AbortSignal.timeout(5000) })
  return { status, headers, body: Buffer.concat(chunks) }
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tiiny-workflow-'))
  const home = path.join(root, 'home'), output = path.join(root, 'output')
  const env = {
    TIINY_3D_HOME: path.join(root, 'native-3d'), TIINY_VIDEO_HOME: home, TIINY_OUTPUT_DIR: output, TIINY_BASE_URL: `${ORIGIN}/v1`, TIINY_API_KEY: KEY,
    TIINY_MODEL: MODEL_A, TIINY_IMAGE_MODEL: '',
    TIINY_FFMPEG: path.join(root, 'no-ffmpeg'), TIINY_FFPROBE: path.join(root, 'no-ffprobe'),
  }
  const before = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]))
  Object.assign(process.env, env)
  const disposers = []
  async function unload() { for (const dispose of disposers.splice(0).reverse()) await dispose() }
  t.after(async () => {
    try { await unload() } finally {
      for (const [name, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      await fs.rm(root, { recursive: true, force: true }) // exactly this test's mkdtemp directory
    }
  })
  await Promise.all([fs.mkdir(home), fs.mkdir(output)])
  const device = mockDevice(t)
  let handler
  async function reload() {
    await unload()
    // Force new Host module state, keeping only this case's on-disk settings,
    // rendered files, frames and history (not its previous in-memory jobs Map).
    const module = new URL('../index.js', import.meta.url)
    module.searchParams.set('instance', randomUUID())
    const { apply } = await import(module.href)
    const routes = []
    apply({
      effect: (fn) => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
      webServer: { register: (route) => { routes.push(route); return () => {} } },
      credentials: { readRecord: async () => undefined }, tools: { register: () => () => {} },
    })
    handler = routes.find((route) => route.path === PREFIX)?.handler
    assert.equal(typeof handler, 'function')
  }
  await reload()
  const raw = (pathname, body) => dispatch(handler, pathname, body)
  async function request(pathname, body) {
    const res = await raw(pathname, body)
    const json = JSON.parse(res.body.toString())
    assertPublic(json)
    return { status: res.status, json }
  }
  async function ok(pathname, body) {
    const { status, json } = await request(pathname, body)
    assert.equal(status, 200, `${pathname}: ${JSON.stringify(json)}`)
    return json
  }
  const historyFile = path.join(home, 'history.json')
  async function history() {
    let text
    try { text = await fs.readFile(historyFile, 'utf8') } catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const rows = JSON.parse(text)
    assertPublic(rows)
    return rows
  }
  const job = (id) => ok('/job?id=' + encodeURIComponent(id))
  async function terminal(id, expected = 'completed') {
    // The live view can reach terminal status just before its history write.
    // Waiting for the durable row also makes immediate reload/delete reliable.
    const deadline = Date.now() + 6000
    let row
    do {
      row = (await history()).find((item) => item.id === id)
      if (row && ['failed', 'completed', 'cancelled', 'interrupted'].includes(row.status)) break
      await delay(15)
    } while (Date.now() < deadline)
    assert.equal(row?.status, expected, `expected saved ${expected} job ${id}: ${JSON.stringify(row)}`)
    const view = await job(id)
    assert.equal(view.status, expected, view.error)
    return view
  }
  const media = async (url) => {
    assert.ok(typeof url === 'string' && url.startsWith(PREFIX + '/'), 'expect a local media URL')
    const response = await raw(url.slice(PREFIX.length))
    assert.equal(response.status, 200, 'saved media should be readable')
    return response
  }
  return { output, historyFile, device, reload, request, ok, job, history, terminal, media }
}

function assertHandle(value) { assert.ok(typeof value === 'string' && value.length, 'expected a reusable media handle') }

test('retry a failed uploaded-frame video after restart and model correction, without mutating its record', async (t) => {
  const fx = await fixture(t)
  const shape = { prompt: 'Rain falls around a paper boat', size: '480x832', seconds: 7 }
  await fx.ok('/settings', { imageModel: IMAGE_MODEL })
  const settings = await fx.ok('/settings')
  assert.equal(settings.hasApiKey, true)
  assert.equal(settings.apiKey, undefined)
  assert.equal(settings.imageModel, IMAGE_MODEL)
  const { models } = await fx.ok('/models')
  for (const [id, kind, loaded] of [[MODEL_A, 'video', true], [MODEL_B, 'video', false], [IMAGE_MODEL, 'image', false]]) {
    const row = models.find((item) => item.id === id)
    assert.equal(row?.kind, kind, id)
    assert.equal(row.loaded, loaded, id)
  }

  // Simulate the device stopping after discovery; even a badly behaved device
  // echoing its authorization header must not put the key in either history view.
  fx.device.createVideo = () => Response.json({ error: { message: `model stopped; key=${KEY}; Authorization: Bearer ${DEVICE_TOKEN}` } }, { status: 409 })
  const first = await fx.ok('/generate', { ...shape, frameMode: 'last', imageDataUrl: REFERENCE }) // original video API
  const failed = await fx.terminal(first.id, 'failed')
  assert.equal(failed.kind, 'video')
  assert.equal(failed.model, MODEL_A)
  assert.equal(failed.frameMode, 'last')
  assertHandle(failed.frameAssetId)
  assert.equal(failed.canRetry, true)
  const oldRow = (await fx.history()).find((row) => row.id === first.id)

  await fx.reload()
  assert.equal((await fx.job(first.id)).canRetry, true)
  fx.device.running = MODEL_B
  delete fx.device.createVideo
  // Change the defaults as well: retry should use the corrected model but the
  // original prompt, shape and frame, not the new composition defaults.
  await fx.ok('/settings', { model: MODEL_B, size: '1344x768', seconds: 5 })
  const retry = await fx.ok('/retry', { id: first.id })
  assert.notEqual(retry.id, first.id)
  const done = await fx.terminal(retry.id)
  assert.equal(done.kind, 'video')
  assert.equal(done.model, MODEL_B)
  assert.equal(done.frameMode, 'last')
  assertHandle(done.frameAssetId)
  assert.deepEqual((await fx.media(done.url)).body, CLIP)
  assert.deepEqual(fx.device.videos, [MODEL_A, MODEL_B].map((model) => ({ model, ...shape, first: null, last: REFERENCE })))
  assert.deepEqual((await fx.history()).find((row) => row.id === first.id), oldRow)
  const { jobs } = await fx.ok('/jobs')
  assert.equal(jobs.find((row) => row.id === first.id)?.status, 'failed')
  assert.equal(jobs.find((row) => row.id === retry.id)?.status, 'completed')
})

test('legacy text retries; unsaved legacy frames and disk-only clips cannot silently become new jobs', async (t) => {
  const fx = await fixture(t)
  const shape = { prompt: 'A paper crane turns in the breeze', size: '768x1344', seconds: 6 }
  const text = { id: 'older-text', ...shape, status: 'failed', phase: 'failed', error: 'device was offline' }
  const frame = { ...text, id: 'older-frame', frameMode: 'first' }
  await fs.writeFile(fx.historyFile, JSON.stringify([frame, text])) // pre-asset, pre-kind schema
  const name = 'clip without a job.mp4'
  await fs.writeFile(path.join(fx.output, name), CLIP)
  await fx.reload()
  const { jobs } = await fx.ok('/jobs')
  assert.equal(jobs.find((row) => row.id === text.id)?.canRetry, true)
  assert.equal(jobs.find((row) => row.id === frame.id)?.canRetry, false)
  const disk = jobs.find((row) => row.file === name)
  assert.equal(disk?.canRetry, false)
  const unavailable = await fx.request('/retry', { id: frame.id })
  assert.equal(unavailable.status, 409)
  assert.match(unavailable.json.error, /frame|image|图|帧/i)
  assert.match(unavailable.json.error, /attach|upload|pick|choose|select|supply|add|重新|选择|添加|上传/i, 'tell the user how to restore the missing frame')
  for (const id of [disk.id, 'nonexistent-job']) {
    const result = await fx.request('/retry', { id })
    assert.ok(result.status >= 400 && result.status < 500)
  }
  const attempt = await fx.ok('/retry', { id: text.id })
  assert.notEqual(attempt.id, text.id)
  assert.equal((await fx.terminal(attempt.id)).kind, 'video')
  assert.deepEqual(fx.device.videos, [{ model: MODEL_A, ...shape, first: null, last: null }])
  assert.deepEqual(await fs.readFile(path.join(fx.output, name)), CLIP)
})

test('one generated image can start and end different videos; both retry after the image job is deleted', async (t) => {
  const fx = await fixture(t)
  fx.device.running = IMAGE_MODEL
  await fx.ok('/settings', { imageModel: IMAGE_MODEL })
  const prompt = 'Paint a small moon above the lake'
  const image = await fx.terminal((await fx.ok('/generate', { kind: 'image', prompt })).id)
  assert.equal(image.kind, 'image')
  assert.equal(image.model, IMAGE_MODEL)
  assert.equal(image.prompt, prompt)
  assertHandle(image.assetId)
  assert.equal(fx.device.images.length, 1)
  assert.equal(fx.device.images[0].model, IMAGE_MODEL)
  assert.equal(fx.device.images[0].prompt, prompt)
  assert.equal(fx.device.images[0].response_format, 'b64_json')
  const preview = await fx.media(image.url)
  assert.match(preview.headers.get('content-type'), /^image\/png\b/)
  assert.deepEqual(preview.body, PNG)

  await fx.reload()
  assert.equal((await fx.job(image.id)).assetId, image.assetId)
  fx.device.running = MODEL_A
  const shape = { prompt: 'A reflection ripples', size: '832x480', seconds: 5 }
  const attempts = []
  const modes = ['first', 'last']
  for (const frameMode of modes) {
    const started = await fx.ok('/generate', { kind: 'video', ...shape, frameMode, imageAssetId: image.assetId })
    const done = await fx.terminal(started.id)
    assert.equal(done.frameMode, frameMode)
    assertHandle(done.frameAssetId) // may share storage or be a durable independent copy
    attempts.push(done.id)
  }
  await fx.ok('/delete-video', { id: image.id })
  await fx.reload()
  assert.equal((await fx.request('/job?id=' + image.id)).status, 404)
  assert.ok(!(await fx.ok('/jobs')).jobs.some((row) => row.id === image.id))
  for (const id of attempts) {
    assert.equal((await fx.job(id)).canRetry, true)
    const retry = await fx.ok('/retry', { id })
    assert.notEqual(retry.id, id)
    await fx.terminal(retry.id)
  }
  const expected = modes.map((mode) => ({ model: MODEL_A, ...shape, first: mode === 'first' ? REFERENCE : null, last: mode === 'last' ? REFERENCE : null }))
  assert.deepEqual(fx.device.videos, [...expected, ...expected])
  assert.equal(fx.device.images.length, 1, 'reusing a saved image must not regenerate it')

  const invalid = await fx.request('/generate', { ...shape, frameMode: 'first', imageAssetId: randomUUID() })
  assert.ok(invalid.status >= 400 && invalid.status < 500, 'missing references must not silently generate a text-only clip')
  assert.equal(fx.device.videos.length, 4)
})

test('cancel during submission, discard a late result, then retry from the saved inputs', { timeout: 10000 }, async (t) => {
  const fx = await fixture(t)
  const shape = { prompt: 'Leaves drift across the sky', size: '832x480', seconds: 6 }
  let entered, release
  const submitting = new Promise((resolve) => { entered = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  fx.device.createVideo = async () => {
    entered()
    await gate
    return Response.json({ id: 'late-completion', status: 'completed' })
  }
  const started = await fx.ok('/generate', { ...shape, imageDataUrl: REFERENCE })
  try {
    await submitting
    const cancelled = await fx.ok('/cancel', { id: started.id })
    assert.equal(cancelled.status, 'cancelled')
    // The local cancel is durable, but the remote POST is still held at gate.
    // Deleting now used to resurrect the row when its final cleanup saved it.
    assert.equal((await fx.request('/delete-video', { id: started.id })).status, 409)
  } finally {
    delete fx.device.createVideo
    release()
  }
  await fx.terminal(started.id, 'cancelled')
  await fx.reload()
  assert.equal((await fx.job(started.id)).canRetry, true)
  const retry = await fx.ok('/retry', { id: started.id })
  assert.notEqual(retry.id, started.id)
  await fx.terminal(retry.id)
  const original = await fx.job(started.id)
  assert.equal(original.status, 'cancelled')
  assert.ok(!original.url, 'a late device response must not publish an output for the cancelled job')
  const { jobs } = await fx.ok('/jobs')
  assert.deepEqual(jobs.filter((job) => job.url).map((job) => job.id), [retry.id])
  const expected = { ...shape, model: MODEL_A, first: REFERENCE, last: null }
  assert.deepEqual(fx.device.videos, [expected, expected])
  await fx.ok('/delete-video', { id: started.id })
  assert.equal((await fx.request('/job?id=' + started.id)).status, 404)
})
