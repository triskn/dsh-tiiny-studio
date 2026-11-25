/**
 * Smoke tests for the Host half.
 *
 * The plugin needs no dependencies, so these run with plain `node --test`.
 * Every test points TIINY_VIDEO_HOME at a temp directory: the suite must never
 * touch a real ~/.tiiny-video (it would hold a real API key).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

let dataDir
let outputDir
let route, mediaTool
const credentials = new Map()

before(async () => {
  const tempDir = await fs.realpath(os.tmpdir())
  dataDir = await fs.mkdtemp(path.join(tempDir, 'tiiny-video-test-'))
  // Read by the module at import time, so it has to be set before the import.
  process.env.TIINY_VIDEO_HOME = dataDir
  process.env.TIINY_3D_HOME = path.join(dataDir, 'native-3d')
  // Keep /jobs away from whatever the developer really rendered.
  outputDir = await fs.mkdtemp(path.join(tempDir, 'tiiny-video-out-'))
  process.env.TIINY_OUTPUT_DIR = outputDir
  // The mocked clip contains fixture bytes and never needs system media tools.
  process.env.TIINY_FFMPEG = path.join(dataDir, 'no-ffmpeg')
  process.env.TIINY_FFPROBE = path.join(dataDir, 'no-ffprobe')
  delete process.env.TIINY_API_KEY
  delete process.env.TIINY_BASE_URL

  const { apply } = await import('../index.js')
  const registered = []
  apply({
    effect: (fn) => fn(),
    credentials: {
      readRecord: async key => credentials.get(key),
      modifyRecord: async (key, change) => { const next = await change(credentials.get(key)); credentials.set(key, next); return next },
    },
    tools: { register: (value) => { mediaTool = value; return () => {} } },
    webServer: { register: (value) => registered.push(value) },
  })
  assert.deepEqual(registered.map(r => r.path).sort(), ['/tiiny-video', '/tiiny-video/3d'])
  route = registered.find(r => r.path === '/tiiny-video')
})

after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(outputDir, { recursive: true, force: true })
})

function request({ method = 'GET', pathname = '/', body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url: `/tiiny-video${pathname}`,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, headers = {}) {
      this.statusCode = code
      Object.assign(this.headers, headers)
    },
    end(chunk) {
      if (chunk) this.body += chunk.toString()
    },
  }
  return { req, res }
}

async function call(options) {
  const { req, res } = request(options)
  await route.handler(req, res)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }
}

function removeVideo(id) {
  return call({ method: 'POST', pathname: '/delete-video', body: { id } })
}

test('GET /settings returns defaults without the API key', async () => {
  const { status, json } = await call({ pathname: '/settings' })
  assert.equal(status, 200)
  assert.equal(json.hasApiKey, false)
  assert.equal(json.apiKey, undefined)
  assert.equal(json.supportsLastFrame, true)
  assert.equal(json.size, '832x480')
  assert.deepEqual(json.sizes, ['832x480', '480x832', '1344x768', '768x1344'])
})

test('POST /settings persists the key but never echoes it', async () => {
  const { status, json } = await call({
    method: 'POST',
    pathname: '/settings',
    body: { apiKey: 'test-key', baseUrl: 'http://device.test:8000/v1', model: 'lightx2v/MiniMax-H3-Turbo' },
  })
  assert.equal(status, 200)
  assert.equal(json.hasApiKey, true)
  assert.equal(json.apiKey, undefined)
  assert.equal(json.baseUrl, 'http://device.test:8000/v1')

  const onDisk = JSON.parse(await fs.readFile(path.join(dataDir, 'settings.json'), 'utf8'))
  assert.equal(onDisk.apiKey, undefined, 'new keys belong to the Harness credential store, not settings.json')
  assert.equal([...credentials.values()].at(-1)?.key, 'test-key')

  if (process.platform !== 'win32') {
    const stat = await fs.stat(path.join(dataDir, 'settings.json'))
    assert.equal(stat.mode & 0o077, 0, 'settings file must not be readable by the group or others')
  }

  const reread = await call({ pathname: '/settings' })
  assert.equal(reread.json.hasApiKey, true)
  assert.equal(reread.json.apiKey, undefined)
})

test('POST /generate rejects an empty prompt', async () => {
  const { status, json } = await call({ method: 'POST', pathname: '/generate', body: {} })
  assert.equal(status, 400)
  assert.match(json.error, /prompt/i)
})

test('POST /generate rejects a resolution the device never exported', async () => {
  const { status, json } = await call({
    method: 'POST',
    pathname: '/generate',
    body: { prompt: 'a robot waters a seedling', size: '1920x1080', seconds: 5 },
  })
  assert.equal(status, 400)
  assert.match(json.error, /1920x1080/)
})

test('POST /generate rejects a duration outside the exported window', async () => {
  const { status, json } = await call({
    method: 'POST',
    pathname: '/generate',
    body: { prompt: 'a robot waters a seedling', size: '832x480', seconds: 30 },
  })
  assert.equal(status, 400)
  assert.match(json.error, /832x480/)
  assert.match(json.error, /30/)
})

test('GET /jobs starts empty', async () => {
  const { status, json } = await call({ pathname: '/jobs' })
  assert.equal(status, 200)
  assert.deepEqual(json.jobs, [])
})

test('unknown routes are a 404, not a crash', async () => {
  const { status } = await call({ pathname: '/nope' })
  assert.equal(status, 404)
})

const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='

test('one image goes to the requested frame and the same job survives a temporary status outage', async (t) => {
  const submitted = []
  let statusChecks = 0
  const mockFile = Buffer.from('video test fixture')
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/videos')) {
      submitted.push(options)
      return Response.json({ id: 'device-test-job', status: submitted.length === 1 ? 'in_progress' : 'completed' })
    }
    if (url.endsWith('/videos/device-test-job')) {
      statusChecks++
      if (statusChecks === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      if (statusChecks === 2) return Response.json({ error: { message: 'Temporary service outage' } }, { status: 503 })
      return Response.json({ id: 'device-test-job', status: 'completed' })
    }
    if (url.endsWith('/content')) return new Response(mockFile)
    throw new Error('Unexpected request: ' + url)
  })

  for (const frameMode of ['last', undefined]) {
    const accepted = await call({
      method: 'POST', pathname: '/generate',
      body: { prompt: 'Move a ball', imageDataUrl: reference, frameMode, seconds: 5 },
    })
    assert.equal(accepted.status, 200)
    const { id } = accepted.json
    assert.equal(accepted.json.frameMode, frameMode || 'first')
    // Wait for the Host to finish writing before reading its history file.
    const deadline = Date.now() + 15000
    while ((await call({ pathname: '/activity' })).json.busy) {
      assert.ok(Date.now() < deadline, 'the video job should release its device lease')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const history = JSON.parse(await fs.readFile(path.join(dataDir, 'history.json'), 'utf8'))
    const saved = history.find((entry) => entry.id === id)
    assert.equal(saved?.status, 'completed', saved?.error)
    assert.equal(saved.frameMode, frameMode || 'first')
    assert.deepEqual(await fs.readFile(path.join(outputDir, saved.file)), mockFile)
    assert.equal((await removeVideo(id)).status, 200)
    assert.equal((await call({ pathname: '/job?id=' + id })).status, 404)
    assert.deepEqual((await call({ pathname: '/jobs' })).json.jobs, [])
    await assert.rejects(fs.stat(path.join(outputDir, saved.file)), { code: 'ENOENT' })
  }

  const [tail, first] = submitted
  assert.equal(statusChecks, 3)
  assert.equal(tail.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(tail.body), {
    model: 'lightx2v/MiniMax-H3-Turbo', prompt: 'Move a ball', size: '832x480', seconds: 5, last_frame: reference,
  })
  assert.equal(first.body.get('input_reference').name, 'first-frame.png')
  assert.equal(first.body.get('last_frame'), null)
})

test('tail mode requires an image and cannot request both placements', async () => {
  for (const [body, message] of [
    [{ frameMode: 'last' }, /attach an image/i],
    [{ frameMode: 'both', imageDataUrl: reference }, /either/i],
    [{ frameMode: 'last', imageDataUrl: 'data:image/gif;base64,AAAA' }, /png, jpeg or webp/i],
  ]) {
    const result = await call({ method: 'POST', pathname: '/generate', body: { prompt: 'Test movement', ...body } })
    assert.equal(result.status, 400)
    assert.match(result.json.error, message)
  }
})

test('custom size tables still enforce a seven-second cap', async () => {
  const settingsPath = path.join(dataDir, 'settings.json')
  const original = await fs.readFile(settingsPath, 'utf8')
  try {
    const custom = { ...JSON.parse(original), spec: { '832x480': [5, 7, 8] } }
    await fs.writeFile(settingsPath, JSON.stringify(custom))
    assert.deepEqual((await call({ pathname: '/settings' })).json.spec['832x480'], [5, 7])
    const result = await call({ method: 'POST', pathname: '/generate', body: { prompt: 'Test', seconds: 8 } })
    assert.equal(result.status, 400)
  } finally {
    await fs.writeFile(settingsPath, original)
  }
})

test('delete handles disk-only videos and failed history without touching other files', async () => {
  const saved = path.join(outputDir, 'existing clip.mp4')
  const unrelated = path.join(outputDir, 'notes.txt')
  await fs.writeFile(saved, 'video fixture')
  await fs.writeFile(unrelated, 'keep')
  const history = path.join(dataDir, 'history.json')
  await fs.writeFile(history, JSON.stringify([{ id: 'failed-test', status: 'failed', error: 'test' }]))
  for (const id of ['file:../existing clip.mp4', 'file:..\\existing clip.mp4', 'file:notes.txt']) {
    assert.equal((await removeVideo(id)).status, 400)
  }
  assert.equal((await removeVideo('file:existing clip.mp4')).status, 409, 'a stale name must not delete a different file when folders change')
  const selected = (await call({ pathname: '/jobs' })).json.jobs.find(row => row.file === 'existing clip.mp4')
  assert.equal(selected.exportPath, await fs.realpath(saved))
  assert.equal((await removeVideo(selected.id)).status, 200)
  assert.equal((await removeVideo(selected.id)).status, 200, 'the exact now-missing selection remains idempotent')
  assert.equal((await removeVideo('failed-test')).status, 200)
  await assert.rejects(fs.stat(saved), { code: 'ENOENT' })
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep')
  assert.deepEqual((await call({ pathname: '/jobs' })).json.jobs, [])
})

test('agent reads the same legacy task as the panel, with lossless JSON and no loose optional keys', async () => {
  assert.equal(mediaTool.name, 'tiiny_media')
  const id = 'legacy-tool-record'
  const file = path.join(dataDir, 'history.json')
  const before = await fs.readFile(file)
  try {
    await fs.writeFile(file, JSON.stringify([{ id, prompt: 'Original saved prompt', status: 'failed', error: 'old device response', size: '832x480', seconds: 7 }]))
    const listed = await mediaTool.execute({ action: 'list' })
    assert.deepEqual(listed, JSON.parse(JSON.stringify(listed)))
    assert.deepEqual(listed.jobs.map(j => [j.id, j.canRetry]), [[id, true]])
    const got = await mediaTool.execute({ action: 'get', id })
    assert.deepEqual(got, JSON.parse(JSON.stringify(got)))
    assert.deepEqual(got, (await call({ pathname: '/job?id=' + id })).json)
    assert.ok(got.canRetry)
  } finally { await fs.writeFile(file, before) }
})
