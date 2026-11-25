import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT = '/tiiny-video', NATIVE = ROOT + '/3d'
const MEDIA = 'http://studio-media.invalid', THREE = 'http://studio-mesh.invalid'
const MEDIA_KEY = 'studio-test-key-for-media', THREE_KEY = 'studio-test-key-for-3d'
const IMAGE = 'fixture/alpha', VIDEO = 'fixture/beta', MESH = 'fixture/gamma'
const catalog = [[IMAGE, 'Text-to-Image'], [VIDEO, 'Text-to-Video'], [MESH, 'Image-to-3D']]
const B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwLT4JAAKaAYrkCljtAAAAAElFTkSuQmCC'
const PNG = Buffer.from(B64, 'base64'), upload = 'data:image/png;base64,' + B64
// A GLB 2.0 with one empty scene, not a rendering stub. The merger should serve
// the device artifact with its original bytes when export polishing is disabled.
const jsonChunk = Buffer.from('{"asset":{"version":"2.0"},"scenes":[{}],"scene":0}'.padEnd(52, ' '))
const glb = Buffer.alloc(20 + jsonChunk.length)
for (const [i, n] of [0x46546c67, 2, glb.length, jsonChunk.length, 0x4e4f534a].entries()) glb.writeUInt32LE(n, 4 * i)
jsonChunk.copy(glb, 20)
const artifacts = {
  shape: ['shape.glb', 'model/gltf-binary', glb], texture: ['material.zip', 'application/zip', Buffer.from('PK\x03\x04fixture', 'binary')],
  export: ['painted.glb', 'model/gltf-binary', glb],
}
const runOptions = { settleDelay: 0, polish: false, simplify: false }

function checkPublic(value) {
  const text = JSON.stringify(value)
  for (const privateValue of [MEDIA_KEY, THREE_KEY, B64]) assert.ok(!text.includes(privateValue), 'job views and history must not embed API keys or image bytes')
  return value
}

function hold() {
  let enter, open
  const entered = new Promise(resolve => { enter = resolve })
  const waiting = new Promise(resolve => { open = resolve })
  return { entered, open, pause: () => { enter(); return waiting } }
}

async function until(check, reason, ms = 6500, interval = 20) {
  const deadline = Date.now() + ms
  do {
    const value = await check()
    if (value) return value
    await delay(interval)
  } while (Date.now() < deadline)
  assert.fail('Timed out waiting for ' + reason)
}

function device(t) {
  const d = {
    mediaModel: IMAGE, imageModel: IMAGE, meshModel: MESH, managedReady: true, nativeReady: true,
    noModel: { message: 'No suitable model is currently running.' },
    activeCount: 0, writes: [], tasks: new Map(), calls: [],
    // If an adapter treats an assertion/unknown endpoint as a network outage, the
    // after hook still catches the unexpected request. No fallthrough to real fetch.
    errors: [], release() { for (const gate of [d.videoGate, d.imageGate, d.meshGate]) gate?.open() },
  }
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input), { origin, pathname } = url
    const route = pathname.replace(/\/$/, ''), method = init.method || 'GET'
    d.calls.push({ method, origin, route })
    try {
      const key = origin === MEDIA ? MEDIA_KEY : origin === THREE ? THREE_KEY : null
      assert.ok(key, 'request attempted an unconfigured origin')
      // Credentials for one saved connection may never ride on another's request.
      const auth = new Headers(init.headers).get('authorization')
      if (auth || !route.endsWith('/health')) assert.equal(auth, `Bearer ${key}`)
      const active = origin === MEDIA ? d.mediaModel : d.managedReady ? d.meshModel : (d.nativeOtherModel ?? null)
      const rows = catalog.map(([baseId, type]) => {
        const id = baseId === MESH ? d.meshModel : baseId === IMAGE ? d.imageModel : baseId
        return { id, model_id: id, type, status: id === active ? 'running' : 'downloaded' }
      })
      if (method === 'GET' && route === '/api/v1/models') return Response.json({ object: 'list', data: rows })
      if (method === 'GET' && route === '/api/v1/models/running') {
        return Response.json({ running: active ? [active] : [], pending: [], instances: { running: active ? [{ model_id: active, instance_id: 'native-instance', active_request_count: origin === THREE ? d.activeCount : 0 }] : [] } })
      }
      if (method === 'GET' && route === '/v1/models') return Response.json({ object: 'list', data: rows.filter(x => x.id === active) })
      if (origin === MEDIA && method === 'POST' && route === '/v1/images/generations') {
        d.writes.push({ op: 'image', model: JSON.parse(init.body).model })
        await d.imageGate?.pause()
        return Response.json({ data: [{ b64_json: B64 }] })
      }
      if (origin === MEDIA && method === 'POST' && route === '/v1/videos') {
        d.writes.push({ op: 'video', model: init.body.get('model') })
        await d.videoGate?.pause()
        return Response.json({ id: 'mock-video', status: 'completed' })
      }
      if (origin === MEDIA && method === 'GET' && route === '/v1/videos/mock-video/content') return new Response('offline clip')
      if (origin === THREE && route.startsWith('/v1/3d/') && method === 'GET') {
        const wrap = data => Response.json({ status: 'success', data })
        if (route === '/v1/3d/health') return d.nativeReady ? Response.json({ status: 'ok', service: 'image-to-3d_server' }) : Response.json(d.noModel, { status: 503 })
        if (route === '/v1/3d/models') return d.nativeReady ? wrap({ model_id: d.nativeAlias || d.meshModel, model_instance_id: 'native-instance', state: 'running' }) : Response.json(d.noModel, { status: 503 })
        if (route === '/v1/3d/version') return wrap({ version: '2.0.0' })
        if (route === '/v1/3d/capabilities') return wrap({ stages: ['shape', 'simplify', 'texture', 'export'], inputs: { shape: ['image'], texture: ['mesh', 'image'], export: ['material'] } })
        const match = /^\/v1\/3d\/tasks\/([^/]+)(?:\/artifacts\/([^/]+))?$/.exec(route)
        if (match) {
          const stage = d.tasks.get(match[1])
          assert.ok(stage, 'unknown task ID')
          const [filename, mime_type, bytes] = artifacts[stage]
          if (match[2]) return new Response(bytes, { headers: { 'content-type': mime_type } })
          return wrap({ task_id: match[1], stage, status: d.taskState || 'completed', progress: d.taskState === 'running' ? 25 : 100,
            result: { output: { artifacts: [{ artifact_id: stage, artifact_type: stage, filename, mime_type }] } } })
        }
      }
      if (origin === THREE && route === '/v1/3d/tasks' && method === 'POST') {
        const stage = init.body.get('stage')
        const image = init.body.get('image')
        d.writes.push({ op: stage, image: image ? Buffer.from(await image.arrayBuffer()) : undefined })
        assert.ok(Object.hasOwn(artifacts, stage), 'unexpected 3D stage')
        const id = 'mesh-task-' + (d.tasks.size + 1)
        d.tasks.set(id, stage)
        if (stage === 'shape') await d.meshGate?.pause()
        return Response.json({ status: 'success', data: { task_id: id } })
      }
      if (origin === THREE && method === 'POST' && route === `/api/v1/models/${encodeURIComponent(MESH)}/launch`) {
        const model = JSON.parse(init.body).model_id
        d.writes.push({ op: 'launch', model })
        assert.equal(model, MESH)
        return Response.json({ message: 'start loading', progress: 0 })
      }
      throw new Error(`Unexpected device request: ${method} ${origin}${route}`)
    } catch (error) { d.errors.push(error); throw error }
  })
  return d
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tiiny-studio-'))
  const media = path.join(root, '.tiiny-video'), mesh = path.join(root, '.tiiny-3d')
  const env = {
    TIINY_VIDEO_HOME: media, TIINY_BASE_URL: MEDIA + '/v1', TIINY_OUTPUT_DIR: path.join(root, 'media-output'), TIINY_API_KEY: '',
    TIINY_MODEL: '', TIINY_IMAGE_MODEL: '', TIINY_FFMPEG: path.join(root, 'absent-ffmpeg'), TIINY_FFPROBE: path.join(root, 'absent-ffprobe'),
    TIINY_3D_HOME: mesh, TIINY_3D_BASE_URL: THREE + '/v1', TIINY_3D_POLL_MS: '10',
    TIINY_3D_CANCEL_CONFIRM_MS: '60', TIINY_3D_CANCEL_RETRY_MS: '40', TIINY_MODEL_SERVICE: '',
  }
  const prev = new Map(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  const fake = device(t), disposers = [], creds = new Map(), routes = [], tools = []
  t.after(async () => {
    fake.release()
    try { for (const f of disposers.reverse()) await f() } finally {
      for (const [key, old] of prev) { if (old === undefined) delete process.env[key]; else process.env[key] = old }
      await fs.rm(root, { recursive: true, force: true }) // this test's exact mkdtemp root
    }
    if (fake.errors.length) throw fake.errors[0]
  })
  await Promise.all([fs.mkdir(media), fs.mkdir(mesh)])
  // These fixtures occupy exactly the separate data roots a pre-merge install
  // used. Nothing migrates to the package, real home, or active DSH profile.
  await fs.writeFile(path.join(media, 'history.json'), JSON.stringify([{ id: 'legacy-media', kind: 'video', status: 'failed', prompt: 'Keep my old shot', size: '832x480', seconds: 5 }]))
  await fs.writeFile(path.join(mesh, 'history.json'), JSON.stringify([{ id: '1234abcd', status: 'failed', image: 'original-3d.png', error: 'Old device error', final: null }]))
  await fs.writeFile(path.join(mesh, 'settings.json'), JSON.stringify({ baseUrl: env.TIINY_3D_BASE_URL, outputDir: path.join(root, 'mesh-output'), settleDelay: 0 }))
  const { apply } = await import('../index.js')
  await apply({
    effect(fn) { const off = fn(); if (typeof off === 'function') disposers.push(off) },
    webServer: { register(route) { routes.push(route); return () => {} } },
    tools: { register(tool) { tools.push(tool); return () => {} } },
    credentials: {
      async readRecord(key) { return creds.get(key) },
      async modifyRecord(key, mutate) { const value = await mutate(creds.get(key)); if (value !== undefined) creds.set(key, value); return creds.get(key) },
    },
  })
  const agent = tools.find(x => x.name === 'tiiny_media')
  assert.ok(agent)
  async function http(url, body) {
    const pathname = new URL(url, 'http://local').pathname
    const route = [...routes].sort((a, b) => b.path.length - a.path.length).find(r => pathname === r.path || pathname.startsWith(r.path + '/'))
    assert.ok(route, 'all front-end media links point to a registered route')
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method: body === undefined ? 'GET' : 'POST', url, headers: body === undefined ? {} : { 'content-type': 'application/json' },
    })
    let status, headers
    const chunks = [], res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() } })
    res.writeHead = (code, fields) => { status = code; headers = new Headers(fields); return res }
    await route.handler(req, res)
    await finished(res, { signal: AbortSignal.timeout(5000) })
    const bytes = Buffer.concat(chunks)
    return { status, headers, bytes, value: headers.get('content-type')?.includes('json') ? checkPublic(JSON.parse(bytes)) : undefined }
  }
  async function ok(url, body) {
    const response = await http(url, body)
    assert.equal(response.status, 200, `${url}: ${JSON.stringify(response.value)}`)
    return response.value
  }
  async function tool(action, args) { return checkPublic(await agent.execute({ action, ...args })) }
  await ok(ROOT + '/settings', { apiKey: MEDIA_KEY })
  await ok(NATIVE + '/settings', { apiKey: THREE_KEY })
  assert.ok(creds.size >= 2, 'distinct connections store credentials in separate records')
  for (const home of [media, mesh]) checkPublic(JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8')))
  const activity = () => ok(ROOT + '/activity')
  async function idle() { await until(async () => !(await activity()).busy, 'shared device gate to become idle') }
  async function mediaDone(id, expected = 'completed') {
    const row = await until(async () => {
      const job = await ok(ROOT + '/job?id=' + encodeURIComponent(id))
      return job.status !== 'running' && job
    }, 'media completion')
    assert.equal(row.status, expected, row.error)
    await idle()
    return row
  }
  return { http, ok, tool, mediaDone, activity, idle, media, mesh, fake, agent, routes }
}

test('one Studio preserves both history roots and queries model status without launching anything', async t => {
  const fx = await fixture(t)
  assert.deepEqual(fx.routes.map(({ path, auth }) => [path, auth]).sort(), [[ROOT, 'required'], [NATIVE, 'required']], 'two authenticated routes owned by the Studio')
  const mediaSettings = await fx.ok(ROOT + '/settings'), threeSettings = await fx.ok(NATIVE + '/settings')
  assert.equal(mediaSettings.baseUrl, MEDIA + '/v1')
  assert.equal(threeSettings.baseUrl, THREE + '/v1')
  assert.equal(mediaSettings.hasApiKey && threeSettings.hasApiKey, true)
  for (const [route, saved, other] of [[ROOT, MEDIA, THREE], [NATIVE, THREE, MEDIA]]) {
    // Swapping an origin must not transport that connection's saved API key.
    assert.equal((await fx.http(route + '/settings', { baseUrl: other + '/v1' })).status, 400)
    assert.equal((await fx.ok(route + '/settings')).baseUrl, saved + '/v1')
  }
  const { models } = await fx.tool('models')
  assert.equal(models.find(x => x.id === MESH)?.kind, '3d', '3D takes an image as INPUT, not output')
  assert.equal((await fx.ok(ROOT + '/jobs')).jobs.find(j => j.id === 'legacy-media')?.prompt, 'Keep my old shot')
  assert.ok((await fx.tool('3d_history')).runs.some(x => x.id === '1234abcd'))
  assert.ok((await fx.ok(NATIVE + '/history')).runs.some(x => x.image === 'original-3d.png'))
  assert.equal((await fx.ok(NATIVE + '/status')).model, MESH)
  assert.equal((await fx.tool('3d_status')).model, MESH)
  assert.equal((await fx.activity()).busy, false)
  assert.deepEqual(fx.fake.writes, [], 'opening Studio, settings, model list and either history only reads device state')
  const actions = fx.agent.parameters.properties.action.enum
  for (const name of ['3d_generate', '3d_status', '3d_history', '3d_get', '3d_stage', '3d_cancel']) assert.ok(actions.includes(name))
  for (const name of ['3d_delete_export', '3d_delete_project']) assert.ok(actions.includes(name), 'local deletion is available through explicit named actions')
  assert.ok(!actions.some(action => /launch|load_model|acknowledge/.test(action)), 'model switching and release of an unverified device stay user-only')

  // Even explicit overrides cannot turn a known mesh generator into an image
  // or video generator. In particular, no POST may arrive at a media endpoint.
  for (const kind of ['image', 'video']) {
    const res = await fx.http(ROOT + '/generate', { kind, prompt: 'Create a silver cup', model: MESH })
    if (res.status === 200) await fx.mediaDone(res.value.id, 'failed')
    else assert.ok(res.status >= 400 && res.status < 500)
  }
  assert.deepEqual(fx.fake.writes, [])
})

test('an explicitly selected Studio image drives the native 3D stages; media, reruns and loads respect one lease', { timeout: 20000 }, async t => {
  const fx = await fixture(t)
  const d = fx.fake
  const generate3d = { imageDataUrl: upload, imageName: 'cup.png', options: runOptions }
  const load = { confirm: true, modelId: MESH, expectedRunningModels: [MESH] }
  async function busy(url, body) {
    const reply = await fx.http(url, body)
    assert.equal(reply.status, 409, `already busy: ${url}: ${JSON.stringify(reply.value)}`)
    assert.equal(reply.value.code, 'device_busy', 'a real current Studio lease is not a saved recovery marker')
  }
  d.imageGate = hold()
  const picture = await fx.ok(ROOT + '/generate', { kind: 'image', prompt: 'A silver cup, no background' })
  try {
    await d.imageGate.entered
    assert.equal((await fx.activity()).kind, 'image')
    await busy(NATIVE + '/generate', generate3d)
    await busy(NATIVE + '/launch-model', load)
    assert.deepEqual(d.writes.map(x => x.op), ['image'])
  } finally { d.imageGate.open() }
  const image = await fx.mediaDone(picture.id)
  assert.ok(image.assetId)

  d.meshGate = hold()
  const accepted = await fx.tool('3d_generate', { imageAssetId: image.assetId, preset: 'fast', options: runOptions })
  const id = accepted.run?.id || accepted.id
  assert.ok(id, '3D tool must return the local run ID')
  const runUrl = NATIVE + '/run?id=' + encodeURIComponent(id)
  const copyGate = hold()
  const copyFile = fs.copyFile
  let copyingFinal = false
  t.mock.method(fs, 'copyFile', async (source, target, flags) => {
    if (path.basename(target).endsWith('-painted.glb')) {
      copyingFinal = true
      await copyGate.pause()
    }
    return copyFile(source, target, flags)
  })
  try {
    await d.meshGate.entered
    assert.equal((await fx.activity()).kind, '3d')
    await busy(ROOT + '/generate', { kind: 'video', prompt: 'Turn the cup' })
    await busy(ROOT + '/retry', { id: image.id })
    await busy(NATIVE + '/launch-model', load)
    assert.equal(d.writes.filter(x => x.op === 'shape').length, 1)
    assert.deepEqual(d.writes.find(x => x.op === 'shape').image, PNG, 'original generated bytes were submitted to shape')
    await fx.ok(ROOT + '/delete-video', { id: image.id }) // 3D already owns its source; texture must still be able to read it
    d.meshGate.open()
    await until(() => copyingFinal, 'final model copy')
    const { run: pending } = await fx.ok(runUrl)
    assert.equal(pending.status, 'running', 'the run is still active while the export is being saved')
    assert.equal(pending.phase, 'finalizing')
    assert.equal(pending.finalizing, true)
    assert.equal(pending.finalUrl, '')
    await busy(NATIVE + '/generate', generate3d)
  } finally {
    d.meshGate.open()
    copyGate.open()
  }
  const result = await until(async () => {
    const { run } = await fx.ok(runUrl)
    return run?.status !== 'running' && run
  }, 'native 3D pipeline')
  assert.equal(result.status, 'completed', result.error)
  assert.equal(result.finalizing, false)
  await fx.idle()
  assert.deepEqual(d.writes.map(x => x.op), ['image', 'shape', 'texture', 'export'])
  assert.deepEqual(d.writes.find(x => x.op === 'texture').image, PNG)
  assert.ok(result.finalUrl?.startsWith(NATIVE + '/'), 'artifact URL resolves in Studio, not the old standalone plugin')
  const final = await fx.http(result.finalUrl)
  assert.equal(final.status, 200)
  assert.equal(final.headers.get('content-type'), 'model/gltf-binary')
  assert.deepEqual(final.bytes, glb)
  const nativeHistory = await fx.tool('3d_history')
  assert.ok(nativeHistory.runs.some(row => row.id === id && row.status === 'completed'))
  checkPublic(JSON.parse(await fs.readFile(path.join(fx.mesh, 'runs', id, 'run.json'), 'utf8')))
  checkPublic(JSON.parse(await fs.readFile(path.join(fx.mesh, 'history.json'), 'utf8')))
  checkPublic(JSON.parse(await fs.readFile(path.join(fx.media, 'history.json'), 'utf8')))

  d.mediaModel = VIDEO
  d.videoGate = hold()
  const video = await fx.ok(ROOT + '/generate', { prompt: 'Rotate the cup on a table' })
  try {
    await d.videoGate.entered
    assert.equal((await fx.activity()).kind, 'video')
    await busy(NATIVE + '/stage', { runId: id, stage: 'shape' })
    await busy(NATIVE + '/generate', generate3d)
    await busy(NATIVE + '/launch-model', load)
  } finally { d.videoGate.open() }
  await fx.mediaDone(video.id)
  assert.deepEqual(d.writes.map(x => x.op), ['image', 'shape', 'texture', 'export', 'video'])
})

test('simultaneous media and native submissions admit exactly one, without a queued duplicate', { timeout: 10000 }, async t => {
  const fx = await fixture(t)
  const d = fx.fake
  d.imageGate = hold(); d.meshGate = hold()
  let image, mesh
  try {
    ;[image, mesh] = await Promise.all([
      fx.http(ROOT + '/generate', { kind: 'image', prompt: 'A red cup' }),
      fx.http(NATIVE + '/generate', { imageDataUrl: upload, imageName: 'cup.png', options: runOptions }),
    ])
    assert.deepEqual([image.status, mesh.status].sort(), [200, 409])
    const imageWon = image.status === 200
    await (imageWon ? d.imageGate : d.meshGate).entered
    assert.equal((await fx.activity()).kind, imageWon ? 'image' : '3d')
    assert.deepEqual(d.writes.map(x => x.op), [imageWon ? 'image' : 'shape'])
  } finally { d.release() }
  await fx.idle()
  assert.deepEqual(d.writes.map(x => x.op), image.status === 200 ? ['image'] : ['shape', 'texture', 'export'])
})

test('a native launch requires exact selection and confirmation; while loading, neither tool nor UI starts generation', { timeout: 15000 }, async t => {
  const fx = await fixture(t)
  const d = fx.fake
  d.managedReady = d.nativeReady = false
  const before = await fx.ok(NATIVE + '/status')
  assert.ok(before.launchCandidates.some(row => row.id === MESH))
  assert.deepEqual(d.writes, [])
  for (const body of [{ modelId: MESH, expectedRunningModels: [] }, { confirm: true, modelId: IMAGE, expectedRunningModels: [] }]) {
    const response = await fx.http(NATIVE + '/launch-model', body)
    assert.ok(response.status >= 400 && response.status < 500, `invalid or unconfirmed launch: ${response.status}`)
  }
  assert.deepEqual(d.writes, [])
  const launch = fx.http(NATIVE + '/launch-model', { confirm: true, modelId: MESH, expectedRunningModels: before.runningModels })
  try {
    await until(() => d.writes.some(call => call.op === 'launch'), 'one explicit device launch')
    assert.deepEqual(d.writes, [{ op: 'launch', model: MESH }])
    d.managedReady = true // store ack isn't proof the native route is serving the selected model
    assert.equal((await fx.ok(NATIVE + '/status')).ok, false)
    assert.equal((await fx.activity()).kind, '3d-load')
    const conflict = await fx.http(ROOT + '/generate', { kind: 'image', prompt: 'A ceramic cup' })
    assert.equal(conflict.status, 409); assert.equal(conflict.value.code, 'device_busy')
    await assert.rejects(fx.tool('generate', { kind: 'video', prompt: 'Rotate the cup' }), { status: 409, code: 'device_busy' })
    assert.deepEqual(d.writes, [{ op: 'launch', model: MESH }])
  } finally { d.nativeReady = d.managedReady = true }
  const response = await launch
  assert.equal(response.status, 200, JSON.stringify(response.value))
  await until(async () => !(await fx.activity()).busy, 'native and management launch readiness', 9000, 100)
  assert.equal((await fx.tool('3d_status')).model, MESH)
  assert.deepEqual(d.writes, [{ op: 'launch', model: MESH }], 'there is never an implicit launch, unload, or retry')
})

// A pre-fix journal has no createdAt; its mtime is the only age evidence. The
// APIs below use distinct native/media connections exactly as in the merged UI.
const HUNYUAN = 'Tencent/Hunyuan3d-2.1', QWEN = 'Qwen/Qwen-Image'
async function seedLoad(fx, { age = 86400000, base = THREE + '/v1' } = {}) {
  const marker = { id: 'load-prior-studio', modelId: HUNYUAN, baseUrl: base, pending: true }
  const filename = path.join(fx.mesh, 'studio-launch.json'), raw = JSON.stringify(marker)
  await fs.writeFile(filename, raw, { flag: 'wx' })
  const then = new Date(Date.now() - age); await fs.utimes(filename, then, then)
  const st = await fs.stat(filename)
  return {
    read: async () => JSON.parse(await fs.readFile(filename, 'utf8')),
    async unchanged() {
      assert.equal(await fs.readFile(filename, 'utf8'), raw, 'no silent acknowledgement')
      const after = await fs.stat(filename)
      assert.deepEqual([after.ino, after.mtimeMs], [st.ino, st.mtimeMs], 'read-only views do not rewrite the journal')
    },
  }
}
function onlyImageResident(fx) {
  Object.assign(fx.fake, { meshModel: HUNYUAN, nativeOtherModel: QWEN, imageModel: QWEN, mediaModel: QWEN, managedReady: false, nativeReady: false })
}
const newImage = { kind: 'image', prompt: 'An indigo cup on the windowsill' }
async function refusesBoth(fx, code, model) {
  const prior = (await fx.ok(ROOT + '/jobs')).jobs.map(row => row.id)
  for (const [action, body] of [['generate', newImage], ['retry', { id: 'legacy-media' }]]) {
    const result = await fx.http(`${ROOT}/${action}`, body)
    assert.equal(result.status, 409); assert.equal(result.value.code, code, JSON.stringify(result.value))
    assert.ok(result.value.error); if (model) assert.equal(result.value.model, model, `HTTP ${action} model`)
    await assert.rejects(fx.tool(action, body), { status: 409, code, ...(model && { model }) })
  }
  assert.deepEqual((await fx.ok(ROOT + '/jobs')).jobs.map(row => row.id), prior, 'a refused submit or retry creates no media job')
  assert.deepEqual(await fx.activity(), { busy: false }, 'recovery is not an active Studio operation')
  assert.deepEqual(fx.fake.writes, [], 'no media submit, model switch, control, or native stage sent')
}

test('idle image device + old downloaded mesh journal: status is read-only; a new image verifies and runs once', { timeout: 12000 }, async t => {
  const fx = await fixture(t); onlyImageResident(fx)
  const journal = await seedLoad(fx)
  for (const inspect of [() => fx.ok(NATIVE + '/status'), () => fx.tool('3d_status')]) {
    const state = await inspect()
    assert.deepEqual(state.runningModels, [QWEN]); assert.deepEqual(state.busyModels, [])
    assert.equal(state.verifiedIdle, true); assert.equal(state.problem, 'no-model')
    assert.equal(state.ok, false, 'Qwen residency is not a successful mesh launch')
    assert.ok(!state.recoveryKind && !state.recoveryMessage, 'a verified stale load no longer calls for manual recovery')
    await journal.unchanged()
  }
  assert.deepEqual(await fx.activity(), { busy: false }); assert.deepEqual(fx.fake.writes, [])
  const since = fx.fake.calls.length
  const job = await fx.ok(ROOT + '/generate', newImage)
  assert.equal((await fx.mediaDone(job.id)).prompt, newImage.prompt)
  const sampled = fx.fake.calls.slice(since), sent = sampled.findIndex(c => c.method === 'POST')
  assert.ok(sent > 0)
  for (const route of ['/api/v1/models/running', '/v1/3d/health', '/v1/3d/models']) {
    assert.ok(sampled.slice(0, sent).filter(c => c.method === 'GET' && c.origin === THREE && c.route === route).length >= 2, `independent ${route} observations before submitting, not cached from a status view`)
  }
  const saved = await journal.read()
  assert.equal(saved.pending, false); assert.equal(saved.outcome, 'not_running')
  assert.equal(saved.acknowledgedAt, undefined); assert.deepEqual(fx.fake.writes, [{ op: 'image', model: QWEN }])
})

for (const [reported, caller] of [[HUNYUAN, 'HTTP'], ['hunyuan3d', 'tool']]) test(`confirmed unique native model (${reported}): ${caller} retry verifies the old launch without switching devices`, { timeout: 9000 }, async t => {
  const fx = await fixture(t)
  Object.assign(fx.fake, { meshModel: HUNYUAN, nativeAlias: reported, mediaModel: VIDEO })
  const journal = await seedLoad(fx)
  const prior = { id: 'legacy-media' }
  const row = caller === 'HTTP' ? await fx.ok(ROOT + '/retry', prior) : await fx.tool('retry', prior)
  const done = await fx.mediaDone(row.id)
  assert.equal(done.retryOf, 'legacy-media'); assert.equal(done.prompt, 'Keep my old shot')
  const saved = await journal.read(); assert.equal(saved.pending, false); assert.equal(saved.outcome, 'ready')
  assert.deepEqual(fx.fake.writes, [{ op: 'video', model: VIDEO }])
})

for (const [label, configure, markerOpts, genericOutage] of [
  ['generic 503 during a service outage', d => { d.noModel = { message: 'Service Unavailable' } }, undefined, true],
  ['no request counts for the resident image model', d => { d.activeCount = undefined }],
  ['newly requested model not visible yet', () => {}, { age: 0 }],
  ['different original native mount on the same origin', () => {}, { base: THREE + '/other/v1' }],
  ['foreign namespace with the same model basename', d => { d.managedReady = d.nativeReady = true; d.nativeAlias = 'unrelated/Hunyuan3d-2.1' }],
]) test(`an unresolved load is not a busy lease: ${label}`, { timeout: 8000 }, async t => {
  const fx = await fixture(t); onlyImageResident(fx); configure(fx.fake)
  const journal = await seedLoad(fx, markerOpts)
  for (const inspect of [() => fx.ok(NATIVE + '/status'), () => fx.tool('3d_status')]) {
    const state = await inspect()
    assert.equal(state.recoveryKind, 'load'); assert.equal(state.recoveryModel, HUNYUAN)
    if (genericOutage) { assert.notEqual(state.problem, 'no-model', 'an outage is not proof that the model is unloaded'); assert.equal(state.canLaunch, false) }
    assert.ok(state.recoveryMessage); await journal.unchanged()
  }
  await refusesBoth(fx, 'studio_recovery_load', HUNYUAN)
  await journal.unchanged()
})

test('an unreadable journal is still visible to diagnostics but has no valid ID to acknowledge', { timeout: 6000 }, async t => {
  const fx = await fixture(t)
  const filename = path.join(fx.mesh, 'studio-launch.json'), broken = '{"pending":'
  await fs.writeFile(filename, broken, { flag: 'wx' })
  const state = await fx.ok(NATIVE + '/status')
  assert.equal(state.ok, true, 'the native service itself is ready')
  assert.equal(state.recoveryKind, 'load'); assert.ok(!state.recoveryId && state.recoveryMessage)
  assert.equal((await fx.tool('3d_status')).recoveryKind, 'load')
  await refusesBoth(fx, 'studio_recovery_load')
  assert.equal((await fx.http(NATIVE + '/acknowledge-idle', { confirm: true })).status, 400)
  assert.equal(await fs.readFile(filename, 'utf8'), broken, 'an unreadable old journal is not rewritten or auto-acknowledged')
})

for (const cancel of [false, true]) test(`a separately recoverable load cannot clear ${cancel ? 'an unconfirmed native cancellation' : 'a native submit without a task ID'}`, { timeout: 6000 }, async t => {
  const fx = await fixture(t)
  Object.assign(fx.fake, { meshModel: HUNYUAN, taskState: 'running' })
  await seedLoad(fx)
  const id = cancel ? 'orphan-cancel' : 'orphan-submit', taskId = cancel ? 'original-device-task' : ''
  if (cancel) fx.fake.tasks.set(taskId, 'shape')
  const folder = path.join(fx.mesh, 'runs', id); await fs.mkdir(folder, { recursive: true })
  const file = path.join(folder, 'run.json'), raw = JSON.stringify({ id, status: 'running', cancelRequested: cancel,
    pin: { baseUrl: THREE + '/v1', model: HUNYUAN, modelInstance: 'native-instance' },
    stages: { shape: { status: 'running', taskId, cancelPending: cancel, submissionUnknown: !cancel } },
  })
  await fs.writeFile(file, raw, { flag: 'wx' })
  for (const state of [await fx.ok(NATIVE + '/status'), await fx.tool('3d_status')]) {
    assert.equal(state.recoveryKind, 'task'); assert.equal(state.recoveryModel, HUNYUAN)
  }
  await refusesBoth(fx, 'studio_recovery_task', HUNYUAN)
  assert.equal(await fs.readFile(file, 'utf8'), raw, 'no task ID invented, cancel ACK assumed or service control resent')
  if (cancel) assert.ok(fx.fake.calls.some(c => c.origin === THREE && c.method === 'GET' && c.route === '/v1/3d/tasks/' + taskId))
})
