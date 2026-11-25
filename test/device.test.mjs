import { test } from 'node:test'
import assert from 'node:assert/strict'
import { discoverModels, resolveModel, generateImage } from '../device.js'

// All network I/O is intercepted. Never consult a real device, key file, or profile.
const settings = { baseUrl: 'http://device.test/v1/', apiKey: 'unit-test-key' }
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwLT4JAAKaAYrkCljtAAAAAElFTkSuQmCC'
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCaALwc/9k='
const webp = 'UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAEAAUAmJaACdLoAA5gA/vh8s/9lY/9Kx/6Vj9kj9CjZRL5gAA=='
const json = data => Response.json(data)
const missing = () => new Response(null, { status: 404 })
const generation = '/v1/images/generations'
const catalog = ['/v1/models', '/api/v1/models/', '/api/v1/models/running']
function intercept(t, fn) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input)
    const call = { url, path: url.pathname, ...init }
    calls.push(call)
    // Even the malicious response fixtures cannot cause a credential-bearing request elsewhere.
    assert.equal(url.origin, 'http://device.test')
    assert.equal(init.redirect, 'manual')
    return fn(call)
  })
  return calls
}
function catalogResponse(path, served, installed, running) {
  if (path === catalog[0] && served != null) return json({ object: 'list', data: served })
  if (path === catalog[1] && installed != null) return json({ object: 'list', data: installed })
  if (path === catalog[2] && running != null) return json({ running, pending: [], instances: { running: [] } })
  return missing()
}
const gen = (opts = {}) => generateImage(settings, { prompt: 'a frog on a leaf', model: 'Artist/Canvas-A', ...opts })

test('real Tiiny shapes: downloaded inventory is not the running list, and vision/3D input is not image generation', async t => {
  const v = 'lightx2v/MiniMax-H3-Turbo', i = 'Qwen/Qwen-Image-2.1'
  const installed = [
    { id: v, model_id: v, type: 'Text-to-Video', status: 'running' },
    { id: i, model_id: i, type: 'Text-to-Image', status: 'downloaded' },
    { id: 'vision-chat', type: 'Image-Text-to-Text', input: 'Text,Image', output: 'Text' },
    { id: 'mesh', type: 'Image-to-3D', capabilities: ['Image', '3d'] },
    { id: 'metadata-only', input: 'Image' },
  ]
  const calls = intercept(t, ({ path }) => catalogResponse(path, [{ id: v, object: 'model', type: 'Text-to-Video' }], installed, [v]))
  const result = await discoverModels(settings)
  assert.deepEqual(result.models, [
    { id: v, kind: 'video', loaded: true }, { id: i, kind: 'image', loaded: false },
    { id: 'vision-chat', kind: 'other', loaded: false }, { id: 'mesh', kind: '3d', loaded: false },
    { id: 'metadata-only', kind: 'unknown', loaded: false },
  ])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(calls.map(c => c.path).sort(), [...catalog].sort())
  assert.ok(calls.every(c => c.method === 'GET' && c.headers.authorization === 'Bearer unit-test-key'))
  assert.doesNotMatch(JSON.stringify(result), /unit-test-key/)
  await assert.rejects(resolveModel(settings, 'image', i), /load Qwen\/Qwen-Image-2\.1.*not loaded/i)
})

test('fresh inference spellings supersede matching store and running aliases (including case and namespace changes)', async t => {
  let actual = 'StudioV2/Film-a7'
  const old = 'OldStudio/FILM-A7'
  const calls = intercept(t, ({ path }) => catalogResponse(path, [{ id: actual, output_modalities: ['video'] }],
    [{ id: 'db-row-42', model_id: old, name: 'Film-A7', status: 'downloaded', type: 'Text-to-Video' }], [old]))
  assert.deepEqual((await discoverModels(settings)).models, [{ id: actual, kind: 'video', loaded: true }])
  assert.equal(await resolveModel({ ...settings, model: old }, 'video'), actual)
  actual = 'FILM-a7' // device was re-exported after an earlier job
  assert.equal(await resolveModel(settings, 'video', old), actual)
  assert.equal(await resolveModel(settings, 'video', 'db-row-42'), actual)
  assert.equal(calls.filter(c => c.path === catalog[0]).length, 4, 'no stale catalogue cached across jobs')
})

test('unrelated configured IDs and private aliases are not silently switched to the only active model', async t => {
  intercept(t, ({ path }) => catalogResponse(path, [{ id: 'NewVendor/New-Family', type: 'image_generation', loaded: true }], [], []))
  assert.equal(await resolveModel({ ...settings, imageModel: 'my-private-slot' }, 'image'), 'my-private-slot')
  assert.equal(await resolveModel(settings, 'image', 'OldVendor/Old-2.1'), 'OldVendor/Old-2.1')
  assert.equal(await resolveModel(settings, 'image'), 'NewVendor/New-Family')
  await assert.rejects(resolveModel(settings, 'video', 'NewVendor/New-Family'), /not a video generation model/i)
})

test('generic advertised IDs require explicit selection when modality is unknown', async t => {
  intercept(t, ({ path }) => catalogResponse(path, [{ id: 'Profile/Slot-A' }], null, null))
  assert.deepEqual((await discoverModels(settings)).models, [{ id: 'Profile/Slot-A', kind: 'unknown', loaded: null }])
  assert.equal(await resolveModel({ ...settings, imageModel: 'slot-a' }, 'image'), 'Profile/Slot-A')
  await assert.rejects(resolveModel(settings, 'image'), /no image generation model/i)
})

test('ambiguous same-basename exports stay distinct; exact namespaces are never guessed by load order', async t => {
  const rows = ['StudioA/film', 'StudioB/Film'].map(id => ({ id, type: 'Image-to-Video', loaded: true }))
  intercept(t, ({ path }) => catalogResponse(path, rows, [], []))
  for (const pref of ['old/film', 'Film', undefined]) {
    await assert.rejects(resolveModel(settings, 'video', pref), /ambiguous video.*StudioA\/film.*StudioB\/Film/i)
  }
  assert.equal(await resolveModel(settings, 'video', 'studioB/film'), 'StudioB/Film')
})

test('automatic resolution uses observed kind + load state, not all IDs with video/image inputs', async t => {
  const rows = [
    { id: 'id-3', task: 'Video-to-Text', loaded: true },
    { id: 'id-1', output: 'Video', loaded: false },
    { id: 'id-2', type: 'Text-to-Video', loaded: true },
    { id: 'id-4', input: 'Video, Image', output_modalities: ['embedding'] },
  ]
  intercept(t, ({ path }) => catalogResponse(path, rows, null, null))
  assert.equal(await resolveModel(settings, 'video'), 'id-2')
  await assert.rejects(resolveModel(settings, 'image'), /no image generation model/i)
  await assert.rejects(resolveModel(settings, 'video', 'id-3'), /not a video generation model/i)
  await assert.rejects(resolveModel(settings, 'video', 'id-1'), /not loaded/i)
})

test('different families sharing a display label do not acquire one another’s serving and load state', async t => {
  const label = 'Studio Render'
  intercept(t, ({ path }) => catalogResponse(path, [{ id: 'studio/Family-B', type: 'Text-to-Video', name: label }],
    [{ model_id: 'old/Family-A', display_name: label, type: 'Text-to-Video', status: 'downloaded' }], ['studio/Family-B']))
  assert.equal((await discoverModels(settings)).models.length, 2)
  await assert.rejects(resolveModel(settings, 'video', 'old/Family-A'), /Load old\/Family-A/)
  await assert.rejects(resolveModel(settings, 'video', label), /ambiguous.*studio\/Family-B.*old\/Family-A/i)
})

test('specific generation capabilities identify new models, but output text and unscoped Image flags do not', async t => {
  intercept(t, ({ path }) => catalogResponse(path, [
    { id: 'slot-7', capabilities: { video_generation: true }, loaded: true },
    { id: 'slot-8', capabilities: ['text-to-image'], loaded: true },
    { id: 'slot-9', capabilities: ['Image'] },
    { id: 'slot-10', type: 'Image', output: 'Text', capabilities: ['Image'] },
    { id: 'firmware/default', type: 'Text-to-Video' },
  ], null, null))
  assert.deepEqual((await discoverModels(settings)).models.map(m => m.kind), ['video', 'image', 'unknown', 'other', 'video'])
  assert.equal(await resolveModel(settings, 'video'), 'slot-7')
  assert.equal(await resolveModel(settings, 'image'), 'slot-8')
  assert.equal(await resolveModel(settings, 'video', 'default'), 'default')
})

test('a fresh served ID can still be used when managed sources report downloaded and no running models', async t => {
  const id = 'Future/Renderer'
  intercept(t, ({ path }) => catalogResponse(path, [{ id, type: 'Text-to-Image' }], [{ model_id: id, status: 'downloaded', type: 'Text-to-Image' }], []))
  assert.deepEqual((await discoverModels(settings)).models, [{ id, kind: 'image', loaded: null }])
  assert.equal(await resolveModel(settings, 'image'), id)
})

test('served bare ID variants, wrapped inventories, and instances.running objects', async t => {
  intercept(t, ({ path }) => path === catalog[0] ? json({ models: ['MINIMAX-H3-TURBO'] })
    : path === catalog[1] ? json({ data: { items: [{ model_id: 's/Canvas', type: 'text_to_image' }] } })
    : json({ instances: { running: [{ model_id: 'S/canvas', id: 'internal-instance-id' }] } }))
  assert.deepEqual((await discoverModels(settings)).models, [
    { id: 'MINIMAX-H3-TURBO', kind: 'video', loaded: null }, { id: 's/Canvas', kind: 'image', loaded: true },
  ])
})

test('catalogue outages, redirects, malformed lists do not block a configured candidate or leak upstream bodies', async t => {
  const calls = intercept(t, ({ path }) => {
    if (path === catalog[0]) return Response.redirect('https://wrong.test/v1/models', 307)
    if (path === catalog[1]) throw new Error('upstream echoed unit-test-key')
    return json({ running: [{}], pending: [] })
  })
  const snapshot = await discoverModels(settings)
  assert.deepEqual(snapshot.models, [])
  assert.equal(snapshot.warnings.length, 3)
  assert.doesNotMatch(snapshot.warning, /unit-test-key|wrong\.test/)
  assert.equal(await resolveModel(settings, 'video', 'Local/Slot-A'), 'Local/Slot-A')
  await assert.rejects(resolveModel(settings, 'image'), /set its exact Model ID/i)
  assert.ok(calls.every(c => c.method === 'GET'))
})

test('good rows survive malformed neighbors; a partial running list cannot prove that a model is unloaded', async t => {
  intercept(t, ({ path }) => catalogResponse(path, [null, { id: 'video-1', type: 'Text-to-Video' }],
    [{ model_id: 'artist-7', type: 'Text-to-Image' }], [null, 'video-1']))
  const snapshot = await discoverModels(settings)
  assert.deepEqual(snapshot.models, [{ id: 'video-1', kind: 'video', loaded: true }, { id: 'artist-7', kind: 'image', loaded: null }])
  assert.equal(snapshot.warnings.length, 2)
})

test('a reverse-proxied Tiiny base keeps all management requests under the same mount and origin', async t => {
  const calls = intercept(t, () => missing())
  await discoverModels({ ...settings, baseUrl: 'http://device.test/device-a/v1' })
  assert.deepEqual(calls.map(c => c.path).sort(), catalog.map(path => '/device-a' + path).sort())
  for (const baseUrl of ['file:///etc', 'https://user:pass@device.test/v1', 'http://device.test/v1?next=elsewhere']) {
    await assert.rejects(discoverModels({ ...settings, baseUrl }), /base url/i)
  }
  assert.equal(calls.length, 3)
})

test('resolved generation performs exactly one documented authenticated POST, returns verified bytes and does not resolve the ID twice', async t => {
  const calls = intercept(t, () => json({ created: 1, data: [{ b64_json: png }] }))
  const result = await gen()
  assert.deepEqual(result, { bytes: Buffer.from(png, 'base64'), mime: 'image/png', ext: 'png' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].path, generation)
  assert.equal(calls[0].headers.authorization, 'Bearer unit-test-key')
  assert.equal(calls[0].headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].body), { model: 'Artist/Canvas-A', prompt: 'a frog on a leaf', size: '1024x1024', response_format: 'b64_json' })
})

test('generation without a resolved image model discovers and submits the exact advertised image ID, never the video setting', async t => {
  const calls = intercept(t, ({ path }) => path === generation ? json({ data: [{ b64_json: png }] })
    : catalogResponse(path, [{ id: 'UP/Model-I', type: 'Text-to-Image' }, { id: 'Model-V', type: 'Text-to-Video' }], [], ['UP/Model-I']))
  await generateImage({ ...settings, imageModel: 'old/Model-i', model: 'Model-V' }, { prompt: 'forest' })
  const posts = calls.filter(c => c.method === 'POST')
  assert.equal(posts.length, 1)
  assert.equal(JSON.parse(posts[0].body).model, 'UP/Model-I')
})

test('binary WebP and data-URI JPEG variants are recognized from their bytes', async t => {
  let mode = 'binary'
  intercept(t, () => mode === 'binary' ? new Response(Buffer.from(webp, 'base64'), { headers: { 'content-type': 'image/webp' } })
    : json({ data: [{ b64_json: null, url: 'data:image/jpeg;base64,' + jpeg }] }))
  assert.deepEqual(await gen(), { bytes: Buffer.from(webp, 'base64'), mime: 'image/webp', ext: 'webp' })
  mode = 'uri'
  assert.deepEqual(await gen(), { bytes: Buffer.from(jpeg, 'base64'), mime: 'image/jpeg', ext: 'jpg' })
})

test('only the same-origin, API-scoped Files content route receives a download GET, with no redirects', async t => {
  let redirect = false
  const calls = intercept(t, ({ path }) => path === generation ? json({ data: [{ url: '/v1/files/file-AB_12/content' }] })
    : redirect ? Response.redirect('https://wrong.test/private', 307) : new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'application/octet-stream' } }))
  assert.equal((await gen()).ext, 'png')
  assert.deepEqual(calls.map(c => c.method + ' ' + c.path), ['POST ' + generation, 'GET /v1/files/file-AB_12/content'])
  assert.equal(calls[1].headers.authorization, 'Bearer unit-test-key')
  redirect = true
  await assert.rejects(gen(), /HTTP 307/)
  assert.equal(calls.length, 4)
})

test('off-origin, arbitrary same-origin, local, credentialed and non-file image URLs are refused before any GET', async t => {
  let url
  const calls = intercept(t, () => json({ data: [{ url }] }))
  for (url of ['https://external.test/v1/files/abc/content', '//external.test/v1/files/abc/content', 'http://device.test:9000/v1/files/a/content',
    'http://user:pass@device.test/v1/files/abc/content', '/api/v1/models/running', '/v1/files/%2e%2e%2fsecrets/content',
    '/v1/files/abc/content?url=http://external.test', 'file:///tmp/generated.png', 'data:text/html;base64,PHN2Zz4=']) {
    await assert.rejects(gen(), /untrusted image URL|invalid image data URL/i)
  }
  assert.ok(calls.every(c => c.method === 'POST' && c.path === generation))
})

test('non-images, MIME mismatches, truncated images and invalid base64 are rejected', async t => {
  let response
  intercept(t, () => response())
  for (response of [
    () => new Response('<html>error</html>', { headers: { 'content-type': 'image/png' } }),
    () => new Response(Buffer.from(png, 'base64'), { headers: { 'content-type': 'image/jpeg' } }),
    () => json({ data: [{ b64_json: Buffer.from(png, 'base64').subarray(0, 40).toString('base64') }] }),
    () => json({ data: [{ b64_json: 'abcd=!!' }] }), () => json({ data: [{ b64_json: '%%%=' }] }),
    () => json({ data: [{ b64_json: Buffer.from('<svg></svg>').toString('base64') }] }), () => json({ data: [] }),
    () => json({ data: [{ url: 'data:image/png;base64,' + jpeg }] }),
    () => new Response('proxy failure', { headers: { 'content-type': 'text/html' } }),
  ]) await assert.rejects(gen(), /image|JSON/i)
})

test('generation caps declared JSON size, actual streamed image size and output dimensions', async t => {
  let response
  intercept(t, () => response())
  response = () => new Response('small', { headers: { 'content-type': 'application/json', 'content-length': String(30 * 1024 * 1024) } })
  await assert.rejects(gen(), /size limit/i)
  let cancelled = false, count = 0
  const chunk = new Uint8Array(1024 * 1024)
  response = () => new Response(new ReadableStream({ pull(c) { count++; c.enqueue(chunk) }, cancel() { cancelled = true } }), { headers: { 'content-type': 'image/png' } })
  await assert.rejects(gen(), /size limit/i)
  assert.equal(cancelled, true)
  assert.ok(count < 20)
  const oversized = Buffer.from(png, 'base64')
  oversized.writeUInt32BE(100000, 16)
  response = () => json({ data: [{ b64_json: oversized.toString('base64') }] })
  await assert.rejects(gen(), /dimensions.*safety limit/i)
})

test('cancel before submission or while waiting for the response body; no second generation or remote mutation', async t => {
  let started, cancelled = false
  const startedReading = new Promise(r => { started = r })
  const calls = intercept(t, () => new Response(new ReadableStream({ pull() { started() }, cancel() { cancelled = true } }), { headers: { 'content-type': 'application/json' } }))
  await assert.rejects(gen({ signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.equal(calls.length, 0)
  const controller = new AbortController()
  const pending = gen({ signal: controller.signal })
  await startedReading
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true)
  assert.equal(calls.length, 1)
})

test('generation timeout aborts the upstream fetch once; a queue rejection, missing model, redirect or lost POST is never retried', async t => {
  // Exercise the actual timeout path without waiting or relying on Node's experimental MockTimers API.
  let expire
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => {
    assert.ok(ms > 0 && ms <= 10 * 60 * 1000)
    expire = fn
    return { unref() {} }
  })
  let respond = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  const calls = intercept(t, c => respond(c))
  const pending = gen()
  expire()
  await assert.rejects(pending, { name: 'TimeoutError' })
  for (const status of [400, 401, 404, 429, 500, 503, 307]) {
    respond = () => new Response('server echo: unit-test-key', { status })
    await assert.rejects(gen(), e => e.message.includes(`HTTP ${status}`) && e.message.includes('No automatic retry') && !e.message.includes('unit-test-key'))
  }
  respond = () => { throw new Error('upstream header may contain unit-test-key') }
  await assert.rejects(gen(), /did not confirm image submission.*no automatic retry/i)
  assert.equal(calls.length, 9)
  assert.ok(calls.every(c => c.method === 'POST'))
})
