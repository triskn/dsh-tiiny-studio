/**
 * Host integration tests: the real route handler drives a fake Tiiny device
 * that speaks the documented /3d contract, so pipeline wiring, artifact
 * handling, and error mapping are exercised without hardware or an API key.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

const tempDir = await fs.realpath(os.tmpdir())
const home = await fs.mkdtemp(path.join(tempDir, 'tiiny-3d-test-'))
process.env.TIINY_3D_HOME = home
process.env.TIINY_3D_POLL_MS = '5'
process.env.TIINY_3D_CANCEL_CONFIRM_MS = '60'
process.env.TIINY_3D_CANCEL_RETRY_MS = '40'
process.env.TIINY_3D_READY_POLL_MS = '10'
process.env.TIINY_3D_READY_TIMEOUT_MS = '1000'

const { createThreeWorkbench } = await import('../three/index.js')
const { buildGlb, decodePng, encodePng, parseGlb } = await import('../three/glb.js')

const goodPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwLT4JAAKaAYrkCljtAAAAAElFTkSuQmCC', 'base64')
const STAGE_ARTIFACTS = {
  background: { filename: 'image_no_bg.png', mime: 'image/png', bytes: Buffer.from('89504e470d0a1a0a', 'hex') },
  shape: { filename: 'shape.glb', mime: 'model/gltf-binary', bytes: glb() },
  simplify: { filename: 'simplified.glb', mime: 'model/gltf-binary', bytes: glb() },
  texture: { filename: 'hunyuan3d_material.zip', mime: 'application/zip', bytes: Buffer.from('PK\u0003\u0004test', 'binary') },
  export: { filename: 'painted.glb', mime: 'model/gltf-binary', bytes: glb() },
}

/** A minimal but structurally valid GLB container. */
function glb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0, nodes: [] }))
  const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)
  const jsonChunk = Buffer.concat([json, jsonPad])
  const bin = Buffer.alloc(4)
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(bin.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin])
}


/** A one-triangle GLB with a mid-grey linear albedo and no NORMAL attribute. */
function texturedGlb() {
  const png = encodePng(1, 1, Buffer.from([128, 128, 128]))
  const positions = Buffer.alloc(36)
  ;[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const uvs = Buffer.alloc(24)
  ;[0, 0, 1, 0, 0, 1].forEach((value, index) => uvs.writeFloatLE(value, index * 4))
  const indices = Buffer.alloc(12)
  ;[0, 1, 2].forEach((value, index) => indices.writeUInt32LE(value, index * 4))
  const bin = Buffer.concat([indices, positions, uvs, png])
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, TEXCOORD_0: 2 }, indices: 0, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5125, count: 3, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indices.length },
      { buffer: 0, byteOffset: indices.length, byteLength: positions.length },
      { buffer: 0, byteOffset: indices.length + positions.length, byteLength: uvs.length },
      { buffer: 0, byteOffset: indices.length + positions.length + uvs.length, byteLength: png.length },
    ],
    buffers: [{ byteLength: bin.length }],
  }
  return buildGlb(json, bin)
}

const device = {
  tasks: new Map(),
  submits: [],
  failStages: new Set(),
  // a stage whose first status query fails with a transient 500
  flakyStage: null,
  // a stage that parks on waiting_for_device_reset until a resume arrives
  parkStage: null,
  resumed: new Set(),
  nextId: 1,
  // when set, /3d/health answers with this { status, body } instead of 200
  healthReply: null,
  // shape parameters the fake capabilities advertise
  shapeParams: ['guidance_scale', 'step', 'shade_type'],
  // model store catalog and launch log (the panel's one-click start)
  catalog: [{ model_id: 'Tencent/Hunyuan3d-2.1', display_name: 'Hunyuan3D-2.1', type: 'Image-to-3D', status: 'downloaded' }],
  launched: [], running: [], pending: [], busyCount: 0, instance: 'native-i1', holdLaunch: false, nativeId: 'Tencent/Hunyuan3D-2.1', requestLog: [],
  controls: [],
  holdStage: null,
  cancelDeferred: false,
  failCancel: false,
  failTaskQueries: false,
  capabilitiesFail: false,
  ambiguousSubmit: false,
  missingTaskId: false,
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  const send = (status, body, type = 'application/json') => {
    const payload = type === 'application/json' ? Buffer.from(JSON.stringify(body)) : body
    res.writeHead(status, { 'content-type': type, 'content-length': payload.length })
    res.end(payload)
  }
  device.requestLog.push({ path: url.pathname, method: req.method, instance: req.headers['x-tiiny-model-instance'] })
  if (req.method === 'GET' && url.pathname === '/api/v1/models/running') return send(200, typeof device.runningReply === 'function' ? device.runningReply() : device.runningReply || { running: device.running, pending: device.pending, instances: { running: device.running.map(model_id => ({model_id, active_request_count:device.busyCount})), pending: [] } })
  if (req.method === 'GET' && url.pathname === '/api/v1/models/') {
    return send(200, { object: 'list', data: device.catalog })
  }
  const launchMatch = /^\/api\/v1\/models\/([^/]+)\/launch$/.exec(url.pathname)
  if (req.method === 'POST' && launchMatch) {
    const target = decodeURIComponent(launchMatch[1])
    let raw = ''; for await (const chunk of req) raw += chunk
    if (JSON.parse(raw).model_id !== target) return send(400, {})
    device.launched.push(target)
    if (!device.holdLaunch) device.running = [target]
    return send(200, { message: 'start loading', progress: 0 })
  }
  if (req.method === 'GET' && url.pathname === '/v1/3d/health') {
    if (device.healthReply) return send(device.healthReply.status, device.healthReply.body)
    return send(200, { status: 'ok', service: 'image-to-3d_server', version: '2.0.0' })
  }
  if (req.method === 'GET' && url.pathname === '/v1/3d/models') {
    if (device.modelsReply) return send(device.modelsReply.status, device.modelsReply.body)
    return send(200, { status: 'success', data: { model_id: device.nativeId, model_instance_id: device.instance, state: 'running' } })
  }
  if (req.method === 'GET' && url.pathname === '/v1/3d/version') {
    return send(200, { status: 'success', data: { version: '2.0.0', api_version: '1' } })
  }
  if (req.method === 'GET' && url.pathname === '/v1/3d/capabilities') {
    if (device.capabilitiesFail) return send(503, { error: 'capabilities temporarily unavailable' })
    return send(200, {
      status: 'success',
      data: {
        model: 'hunyuan3d',
        stages: ['background', 'shape', 'simplify', 'texture', 'export'],
        output_precisions: { draft: { octree_resolution: 192 }, standard: {}, high: {} },
        inference_qualities: ['fast', 'balance', 'quality'],
        asset_qualities: ['fast', 'balance', 'quality'],
        inputs: { shape: ['image'], simplify: ['mesh'], texture: ['image', 'mesh'], export: ['material_artifact', 'mesh_glb'] },
        params: {
          shape: device.shapeParams,
          simplify: ['target_faces'],
          export: ['texture_size', 'supersample'],
        },
      },
    })
  }
  if (req.method === 'POST' && url.pathname === '/v1/3d/tasks') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    const text = raw.toString('latin1')
    const stage = /name="stage"\r\n\r\n([a-z]+)/.exec(text)?.[1] || ''
    if (device.failStages.has(stage)) {
      return send(503, { error: 'no_model', message: 'no 3d model loaded' })
    }
    const id = `task-${device.nextId++}`
    device.tasks.set(id, { stage, polls: 0 })
    const paramsRaw = /name="params"\r\n\r\n(\{.*?\})\r\n/.exec(text)?.[1]
    let params = {}
    try {
      params = paramsRaw ? JSON.parse(paramsRaw) : {}
    } catch {
      params = {}
    }
    device.submits.push({ stage, fields: [...text.matchAll(/name="([a-zA-Z_]+)"/g)].map((m) => m[1]), size: raw.length, params })
    // Deliberately create the task before losing its id in the response.
    if (device.ambiguousSubmit) return send(502, { error: 'image-to-3d upstream closed the connection' })
    if (device.missingTaskId) return send(200, { status: 'success', data: {} })
    return send(200, { status: 'success', data: { task_id: id, stage, status: 'queued', status_url: `/v1/tasks/${id}` } })
  }
  const resumeMatch = /^\/v1\/3d\/tasks\/([^/]+)\/(resume|pause|cancel)$/.exec(url.pathname)
  if (req.method === 'POST' && resumeMatch) {
    const [, id, action] = resumeMatch
    device.controls.push({ id, action })
    if (action === 'resume') device.resumed.add(id)
    if (action === 'cancel') {
      if (device.failCancel) return send(500, { error: 'cancel control failed' })
      const task = device.tasks.get(id)
      if (task) {
        task.cancelRequested = true
        if (!device.cancelDeferred) task.cancelStatus = 'cancelled'
      }
      // ACK may already say cancelled even though the worker is still running.
      return send(200, { status: 'success', data: { task_id: id, status: 'cancelled' } })
    }
    return send(200, { status: 'success', data: { task_id: id, status: 'resuming' } })
  }
  const taskMatch = /^\/v1\/3d\/tasks\/([^/]+)$/.exec(url.pathname)
  if (req.method === 'GET' && taskMatch) {
    const task = device.tasks.get(taskMatch[1])
    if (!task) return send(404, { error: 'not_found' })
    task.polls += 1
    if (device.failTaskQueries) return send(500, { error: 'task query failed' })
    const cancelStatus = task.cancelRequested ? (task.statusSequence?.shift() || task.cancelStatus || 'running') : ''
    if ((cancelStatus && cancelStatus !== 'completed') || (!cancelStatus && device.holdStage === task.stage)) {
      return send(200, { status: 'success', data: { task_id: taskMatch[1], stage: task.stage, status: cancelStatus || 'running', progress: 8, updated_at: 100, error: cancelStatus === 'error' ? 'worker failed during cancellation' : '' } })
    }
    if (device.flakyStage === task.stage && task.polls === 1) {
      return send(500, { error: 'internal', message: 'transient status failure' })
    }
    if (device.parkStage === task.stage && !device.resumed.has(taskMatch[1])) {
      return send(200, {
        status: 'success',
        data: {
          task_id: taskMatch[1],
          stage: task.stage,
          status: 'waiting_for_device_reset',
          progress: 12,
          error: 'xh2a backend fail',
          error_code: 'XH2A_BACKEND_ERROR',
          message: 'Shape diffusion step 10/30',
          waiting_for_device_reset: true,
        },
      })
    }
    const artifact = STAGE_ARTIFACTS[task.stage]
    return send(200, {
      status: 'success',
      data: {
        task_id: taskMatch[1],
        stage: task.stage,
        status: 'completed',
        progress: 100,
        result: {
          output: {
            artifacts: [
              {
                artifact_id: `${task.stage}-a1`,
                artifact_type: task.stage,
                filename: artifact.filename,
                mime_type: artifact.mime,
                metadata: {},
              },
            ],
          },
        },
      },
    })
  }
  const artifactMatch = /^\/v1\/3d\/tasks\/([^/]+)\/artifacts\/([^/]+)$/.exec(url.pathname)
  if (req.method === 'GET' && artifactMatch) {
    const stage = artifactMatch[2].replace('-a1', '')
    const artifact = STAGE_ARTIFACTS[stage]
    if (!artifact) return send(404, { error: 'not_found' })
    return send(200, artifact.bytes, artifact.mime)
  }
  send(404, { error: 'not_found', path: url.pathname })
})

let route, app, owner = '', mediaWarning = ''
const gate = { snapshot() { return { busy: Boolean(owner), kind: owner } }, acquire(k) { if (owner) throw Object.assign(new Error(owner + ' is busy'), { status: 409, code: 'device_busy' }); owner = k; return () => { owner = '' } } }
const records = new Map()
const credentials = { readRecord: async k => records.get(k), modifyRecord: async (k,f) => records.set(k,await f(records.get(k))) }

class FakeRes extends Writable {
  constructor() {
    super()
    this.chunks = []
    this.headers = {}
    this.statusCode = 200
  }
  writeHead(code, headers) {
    this.statusCode = code
    this.headers = headers || {}
  }
  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }
  _final(callback) {
    this.body = Buffer.concat(this.chunks)
    callback()
  }
}

function invoke({ method = 'GET', url, body, headers }) {
  const res = new FakeRes()
  const finished = new Promise((resolve) => res.on('finish', () => resolve(res)))
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  req.url = url
  req.headers = headers || (method === 'POST' ? { 'content-type':'application/json' } : {})
  route.handler(req, res).catch((error) => {
    res.statusCode = 500
    res.end(String(error))
  })
  return finished
}

const jsonOf = (res) => JSON.parse(res.body.toString('utf8'))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForRun(predicate, timeoutMs = 15000) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < timeoutMs) {
    const res = await invoke({ url: '/tiiny-video/3d/run' })
    const body = jsonOf(res)
    last = body.run
    if (last && predicate(last) && (last.status === 'running' || !owner)) return last
    await delay(20)
  }
  throw new Error(`run did not settle: ${JSON.stringify(last)?.slice(0, 600)}`)
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  process.env.TIINY_MODEL_SERVICE = `http://127.0.0.1:${port}`
  const outputDir = path.join(home, 'out')
  await fs.writeFile(
    path.join(home, 'settings.json'),
    JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'test-key', outputDir, settleDelay: 0 }),
  )
  app = createThreeWorkbench({ gate, credentials,
    async readAsset(id) { if (id !== 'local-asset-01') throw Object.assign(new Error('Missing asset'), {status:409, code:'frame_missing'}); return { bytes:goodPng, mime:'image/png', ext:'png' } },
    async checkMediaForLoad({ verifiedIdle, baseUrl }) { assert.equal(verifiedIdle,true); assert.ok(baseUrl.startsWith('http://127.0.0.1:')); return mediaWarning },
  })
  route = app.route
  assert.equal(route.path, '/tiiny-video/3d'); assert.equal(route.auth, 'required')
})

const desired = 'Tencent/Hunyuan3d-2.1'
const launch = (args = {}) => invoke({ method:'POST', url:'/tiiny-video/3d/launch-model', body:JSON.stringify({ confirm:true, modelId:desired, expectedRunningModels:[], ...args }) })
after(async () => {
  app?.dispose()
  await new Promise((resolve) => server.close(resolve))
  assert.equal(path.dirname(home), tempDir)
  assert.ok(path.basename(home).startsWith('tiiny-3d-test-'))
  await fs.rm(home, { recursive: true, force: true })
})

test('settings endpoint hides the API key', async () => {
  const res = await invoke({ url: '/tiiny-video/3d/settings' })
  const body = jsonOf(res)
  assert.equal(body.hasApiKey, true)
  assert.equal(body.apiKey, undefined)
  assert.equal(body.baseUrl.endsWith('/v1'), true)
})

test('status probe reads the model and normalizes capabilities', async () => {
  const res = await invoke({ url: '/tiiny-video/3d/status' })
  const body = jsonOf(res)
  assert.equal(body.ok, true)
  assert.equal(body.model, 'Tencent/Hunyuan3D-2.1')
  assert.deepEqual(body.enums.output_precision, ['draft', 'standard', 'high'])
  const shape = body.paramGroups.find((group) => group.stage === 'shape')
  assert.ok(shape, 'shape params are reported')
  const step = shape.params.find((param) => param.name === 'step')
  assert.equal(step.type, 'number')
  assert.equal(step.default, 30, 'known name gets a typed default')
  const shade = shape.params.find((param) => param.name === 'shade_type')
  assert.equal(shade.type, 'enum')
  assert.deepEqual(shade.options, ['SMOOTH', 'FLAT'])
  const exportGroup = body.paramGroups.find((group) => group.stage === 'export')
  const supersample = exportGroup.params.find((param) => param.name === 'supersample')
  assert.equal(supersample.type, 'boolean')
})

test('a 503 health probe is reachable, not unreachable, and names the missing model', async () => {
  device.healthReply = { status: 503, body: { error: { message: 'No suitable model is currently running.', type: 'service_unavailable' } } }
  try {
    const res = await invoke({ url: '/tiiny-video/3d/status' })
    const body = jsonOf(res)
    assert.equal(body.reachable, true, 'the device answered, so it is reachable')
    assert.equal(body.ok, false)
    assert.equal(body.problem, 'no-model')
    assert.match(body.error, /no 3D model is running/i)
    assert.equal(body.launchable?.id, 'Tencent/Hunyuan3d-2.1', 'panel may offer a one-click start')
  } finally {
    device.healthReply = null
  }
})

test('generic native 503 and inconclusive native state never claim no model or offer a load', async () => {
  try {
    for (const healthReply of [{ status:503, body:{error:'Service Unavailable'} }, { status:200, body:{status:'loading'} }]) {
      device.healthReply = healthReply
      const result = await app.call('status')
      assert.equal(result.problem, 'service-unavailable'); assert.equal(result.canLaunch, false); assert.equal(result.launchable, null)
      assert.doesNotMatch(result.error, /no 3D model is running/i)
    }
    device.healthReply = null; device.modelsReply = { status:200, body:{models:[]} }
    assert.equal((await app.call('status')).problem, 'no-model')
  } finally { device.healthReply = null; device.modelsReply = null }
})

test('a 404 health probe blames the Base URL, not the network', async () => {
  device.healthReply = { status: 404, body: { error: 'page not found' } }
  try {
    const res = await invoke({ url: '/tiiny-video/3d/status' })
    const body = jsonOf(res)
    assert.equal(body.reachable, true)
    assert.equal(body.problem, 'base-url')
    assert.match(body.error, /Base URL/)
  } finally {
    device.healthReply = null
  }
})

test('a refused connection is still reported as unreachable', async () => {
  const settings = await invoke({ url: '/tiiny-video/3d/settings' })
  const original = jsonOf(settings).baseUrl
  await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/settings',
    body: JSON.stringify({ baseUrl: 'http://127.0.0.1:65534/v1', apiKey:'other-test-key' }),
  })
  try {
    const res = await invoke({ url: '/tiiny-video/3d/status' })
    const body = jsonOf(res)
    assert.equal(body.reachable, false)
    assert.equal(body.problem, 'unreachable')
    assert.ok(body.error.length > 0, 'the transport error is reported')
  } finally {
    await invoke({ method: 'POST', url: '/tiiny-video/3d/settings', body: JSON.stringify({ baseUrl: original, apiKey:'test-key' }) })
  }
})

test('POST /launch-model starts the installed Image-to-3D model', async () => {
  const before = device.launched.length
  const res = await launch()
  assert.equal(res.statusCode, 200)
  assert.equal(jsonOf(res).model, 'Tencent/Hunyuan3d-2.1')
  assert.deepEqual(device.launched.slice(before), ['Tencent/Hunyuan3d-2.1'])
  device.running = []
})

test('POST /launch-model explains itself when nothing is installed', async () => {
  const original = device.catalog
  device.catalog = []
  try {
    const res = await launch()
    assert.equal(res.statusCode, 400)
    assert.match(jsonOf(res).error, /Image-to-3D/)
  } finally {
    device.catalog = original
  }
})

test('POST /launch-model refuses a model that is still downloading', async () => {
  const original = device.catalog
  device.catalog = [{ model_id: 'Tencent/Hunyuan3d-2.1', type: 'Image-to-3D', status: 'downloading' }]
  try {
    const res = await launch()
    assert.equal(res.statusCode, 409)
    assert.match(jsonOf(res).error, /downloading/)
  } finally {
    device.catalog = original
  }
})

test('runs every stage, downloads artifacts, and saves the final GLB', async () => {
  const image = goodPng
  const res = await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/generate',
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
      imageName: 'chair.png',
      preset: 'fast',
      seed: 7,
      options: { simplify: false, settleDelay: 0 },
    }),
  })
  assert.equal(res.statusCode, 200)
  const started = jsonOf(res).run
  assert.deepEqual(started.plan, ['shape', 'texture', 'export'])

  const run = await waitForRun((value) => value.status !== 'running')
  assert.equal(run.status, 'completed')
  assert.equal(run.progress, 100)
  for (const stage of ['shape', 'texture', 'export']) {
    assert.equal(run.stages[stage].status, 'completed', `${stage} completed`)
    assert.ok(run.stages[stage].bytes > 0)
  }
  assert.equal(run.stages.export.file, 'painted.glb')
  assert.ok(run.final?.path?.endsWith('-painted.glb'))
  const stat = await fs.stat(run.final.path)
  assert.equal(stat.size, run.final.bytes)
  assert.equal(run.final.bytes, STAGE_ARTIFACTS.export.bytes.length)

  const stages = device.submits.map((submit) => submit.stage)
  assert.deepEqual(stages.slice(-3), ['shape', 'texture', 'export'])
  const shapeSubmit = [...device.submits].reverse().find((submit) => submit.stage === 'shape')
  assert.deepEqual(shapeSubmit.fields.includes('image'), true)
  assert.deepEqual(shapeSubmit.fields.includes('params'), true)
  assert.equal(shapeSubmit.params.output_precision, 'draft', 'fast preset expands to draft')
  assert.equal(shapeSubmit.params.seed, 7, 'seed reaches the shape stage')
  assert.equal(shapeSubmit.params.step, 25, 'fast preset carries its sampling steps')
  assert.equal(shapeSubmit.params.guidance_scale, 5, 'official guidance reaches the device')
  const textureSubmit = [...device.submits].reverse().find((submit) => submit.stage === 'texture')
  assert.equal(textureSubmit.params.inference_quality, 'fast')

  const artifacts = jsonOf(await invoke({ url: `/tiiny-video/3d/artifacts?run=${run.id}` })).artifacts
  assert.ok(artifacts.some((item) => item.stage === 'final' && item.name.endsWith('-painted.glb')))
})

test('the exported GLB is colour-corrected and given normals before it is saved', async () => {
  const original = STAGE_ARTIFACTS.export.bytes
  STAGE_ARTIFACTS.export.bytes = texturedGlb()
  try {
    const image = goodPng
    const res = await invoke({
      method: 'POST',
      url: '/tiiny-video/3d/generate',
      body: JSON.stringify({
        imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
        imageName: 'duck.png',
        preset: 'quality',
        seed: 3,
        options: { simplify: false, settleDelay: 0, polish: true },
      }),
    })
    assert.equal(res.statusCode, 200)
    const run = await waitForRun((value) => value.status !== 'running')
    assert.equal(run.status, 'completed', run.error)
    const saved = await fs.readFile(run.final.path)
    const { json, bin } = parseGlb(saved)
    const primitive = json.meshes[0].primitives[0]
    assert.equal(typeof primitive.attributes.NORMAL, 'number', 'normals were added')
    const view = json.bufferViews[json.images[0].bufferView]
    const pixel = decodePng(bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)).data[0]
    assert.equal(pixel, 188, 'linear 128 reaches the file as sRGB 188')
    assert.ok(saved.length > STAGE_ARTIFACTS.export.bytes.length, 'the repaired file grew')
  } finally {
    STAGE_ARTIFACTS.export.bytes = original
  }
})

test('polish: false keeps the device file byte for byte', async () => {
  const original = STAGE_ARTIFACTS.export.bytes
  STAGE_ARTIFACTS.export.bytes = texturedGlb()
  try {
    const image = goodPng
    await invoke({
      method: 'POST',
      url: '/tiiny-video/3d/generate',
      body: JSON.stringify({
        imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
        imageName: 'duck2.png',
        preset: 'fast',
        options: { simplify: false, settleDelay: 0, polish: false },
      }),
    })
    const run = await waitForRun((value) => value.status !== 'running')
    assert.equal(run.status, 'completed', run.error)
    const saved = await fs.readFile(run.final.path)
    assert.equal(saved.length, STAGE_ARTIFACTS.export.bytes.length)
  } finally {
    STAGE_ARTIFACTS.export.bytes = original
  }
})

test('preset extras are dropped when the device does not advertise them', async () => {
  const original = device.shapeParams
  device.shapeParams = ['guidance_scale']
  try {
    const image = goodPng
    await invoke({
      method: 'POST',
      url: '/tiiny-video/3d/generate',
      body: JSON.stringify({
        imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
        imageName: 'plain.png',
        preset: 'quality',
        options: { simplify: false, settleDelay: 0, polish: false },
      }),
    })
    const run = await waitForRun((value) => value.status !== 'running')
    assert.equal(run.status, 'completed', run.error)
    const submit = [...device.submits].reverse().find((item) => item.stage === 'shape')
    assert.equal(submit.params.step, undefined, 'step would be a 400 on this device')
    assert.equal(submit.params.guidance_scale, 5, 'advertised extras still go out')
    assert.equal(submit.params.output_precision, 'high', 'documented parameters always go out')
  } finally {
    device.shapeParams = original
  }
})

test('rename moves the exported GLB and updates history', async () => {
  const image = goodPng
  await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/generate',
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
      imageName: 'rename.png',
      preset: 'fast',
      options: { simplify: false, settleDelay: 0, polish: false },
    }),
  })
  const run = await waitForRun((value) => value.status !== 'running')
  assert.equal(run.status, 'completed', run.error)
  const before = run.final.path

  const res = await invoke({ method: 'POST', url: '/tiiny-video/3d/rename-run', body: JSON.stringify({ id: run.id, name: '鸭子模型' }) })
  assert.equal(res.statusCode, 200)
  const renamed = jsonOf(res).final
  assert.equal(renamed.file, '鸭子模型.glb', 'unicode names survive')
  assert.equal(renamed.path.endsWith('鸭子模型.glb'), true)
  await fs.stat(renamed.path)
  const missing = await fs.stat(before).then(() => false).catch(() => true)
  assert.equal(missing, true, 'old file is gone')

  const list = jsonOf(await invoke({ url: '/tiiny-video/3d/history' })).runs
  assert.equal(list.find((item) => item.id === run.id).final.file, '鸭子模型.glb')
  const current = jsonOf(await invoke({ url: `/tiiny-video/3d/run?id=${run.id}` })).run
  assert.equal(current.final.path, renamed.path, 'the in-memory run follows the rename')
  const file = await invoke({ url: `/tiiny-video/3d/file?run=${run.id}&name=${encodeURIComponent(renamed.file)}` })
  assert.equal(file.statusCode, 200, 'Unicode names can be previewed and downloaded')
  assert.match(file.headers['content-disposition'], /filename\*=UTF-8''/)
  assert.match(file.headers['content-disposition'], new RegExp(encodeURIComponent(renamed.file)))
  assert.equal(file.body.length, renamed.bytes)
})

test('explicit combined deletion via legacy alias removes the workspace, GLB and history row', async () => {
  const image = goodPng
  await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/generate',
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
      imageName: 'delete.png',
      preset: 'fast',
      options: { simplify: false, settleDelay: 0, polish: false },
    }),
  })
  const run = await waitForRun((value) => value.status !== 'running')
  assert.equal(run.status, 'completed', run.error)
  const finalPath = run.final.path
  const workspace = path.join(home, 'runs', run.id)
  await fs.stat(workspace)

  const res = await invoke({ method: 'POST', url: '/tiiny-video/3d/delete-run', body: JSON.stringify({ id: run.id, removeExport:true, expectedFile:run.final.file }) })
  assert.equal(res.statusCode, 200, JSON.stringify(jsonOf(res)))
  assert.deepEqual(jsonOf(res).removed, { workspace: true, final: true })
  const finalGone = await fs.stat(finalPath).then(() => false).catch(() => true)
  const workspaceGone = await fs.stat(workspace).then(() => false).catch(() => true)
  assert.equal(finalGone, true)
  assert.equal(workspaceGone, true)
  const list = jsonOf(await invoke({ url: '/tiiny-video/3d/history' })).runs
  assert.equal(list.some((item) => item.id === run.id), false, 'history row removed')
})

test('rename refuses a name that already exists', async () => {
  const image = goodPng
  await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/generate',
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
      imageName: 'dup.png',
      preset: 'fast',
      options: { simplify: false, settleDelay: 0, polish: false },
    }),
  })
  const first = await waitForRun((value) => value.status !== 'running')
  await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/generate',
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${image.toString('base64')}`,
      imageName: 'dup2.png',
      preset: 'fast',
      options: { simplify: false, settleDelay: 0, polish: false },
    }),
  })
  const second = await waitForRun((value) => value.status !== 'running' && value.id !== first.id)
  const res = await invoke({ method: 'POST', url: '/tiiny-video/3d/rename-run', body: JSON.stringify({ id: second.id, name: 'same' }) })
  assert.equal(res.statusCode, 200)
  const clash = await invoke({ method: 'POST', url: '/tiiny-video/3d/rename-run', body: JSON.stringify({ id: first.id, name: 'same' }) })
  assert.equal(clash.statusCode, 409)
})

test('delete-failed drops only the runs that did not complete', async () => {
  const image = goodPng
  device.failStages.add('shape')
  try {
    await invoke({
      method: 'POST',
      url: '/tiiny-video/3d/generate',
      body: JSON.stringify({ imageDataUrl: `data:image/png;base64,${image.toString('base64')}`, imageName: 'bad.png', preset: 'fast', options: { settleDelay: 0 } }),
    })
    const failed = await waitForRun((value) => value.status !== 'running')
    assert.equal(failed.status, 'failed')
  } finally {
    device.failStages.delete('shape')
  }
  const before = jsonOf(await invoke({ url: '/tiiny-video/3d/history' })).runs
  assert.ok(before.some((item) => item.status === 'failed'), 'a failed row exists')

  const noReview = await invoke({ method:'POST',url:'/tiiny-video/3d/delete-failed',body:'{}' }); assert.equal(noReview.statusCode,400)
  const projects=before.filter(r=>['failed','cancelled'].includes(r.status)).map(r=>({id:r.id,status:r.status,finishedAt:r.finishedAt ?? null}))
  const res = await invoke({ method: 'POST', url: '/tiiny-video/3d/delete-failed', body:JSON.stringify({projects}) })
  assert.equal(res.statusCode, 200)
  assert.ok(jsonOf(res).removed >= 1)
  const after = jsonOf(await invoke({ url: '/tiiny-video/3d/history' })).runs
  assert.equal(after.some((item) => item.status === 'failed'), false)
  assert.ok(after.length >= 1, 'completed runs are kept')
})

test('recovered legacy ids can still be deleted', async () => {
  const historyPath = path.join(home, 'history.json')
  const history = JSON.parse(await fs.readFile(historyPath, 'utf8'))
  history.unshift({
    id: 'recovered-5b84a411',
    createdAt: Date.now() - 7200000,
    finishedAt: Date.now() - 7100000,
    status: 'completed',
    error: '',
    image: 'legacy.png',
    final: { file: 'recovered-20261111-152416-painted.glb', path: path.join(home, 'out', 'recovered-20261111-152416-painted.glb'), bytes: 2700000 },
    options: {},
    params: {},
    progress: 100,
  })
  await fs.writeFile(historyPath, JSON.stringify(history, null, 2))

  const res = await invoke({ method: 'POST', url: '/tiiny-video/3d/delete-run', body: JSON.stringify({ id: 'recovered-5b84a411' }) })
  assert.equal(res.statusCode, 200, JSON.stringify(jsonOf(res)))
  const list = jsonOf(await invoke({ url: '/tiiny-video/3d/history' })).runs
  assert.equal(list.some((item) => item.id === 'recovered-5b84a411'), false)
})

test('a path traversal id is rejected', async () => {
  const res = await invoke({ method: 'POST', url: '/tiiny-video/3d/delete-run', body: JSON.stringify({ id: '../etc' }) })
  assert.equal(res.statusCode, 400)
})

test('maps a 503 from the device to an actionable message', async () => {
  device.failStages.add('shape')
  try {
    const res = await invoke({
      method: 'POST',
      url: '/tiiny-video/3d/generate',
      body: JSON.stringify({
        imageDataUrl: `data:image/png;base64,${goodPng.toString('base64')}`,
        imageName: 'x.png',
        preset: 'balance',
        options: { simplify: false, settleDelay: 0 },
      }),
    })
    assert.equal(res.statusCode, 200)
    const run = await waitForRun((value) => value.status !== 'running')
    assert.equal(run.status, 'failed')
    assert.match(run.error, /No 3D model is running on the device/)
    assert.equal(run.stages.shape.status, 'failed')
  } finally {
    device.failStages.delete('shape')
  }
})

test('re-runs a single stage against the previous run', async () => {
  const res = await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/generate',
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${goodPng.toString('base64')}`,
      imageName: 'y.png',
      preset: 'quality',
      options: { simplify: true, settleDelay: 0 },
    }),
  })
  const first = jsonOf(res).run
  assert.deepEqual(first.plan, ['shape', 'simplify', 'texture', 'export'])
  const done = await waitForRun((value) => value.status !== 'running')
  assert.equal(done.status, 'completed')
  assert.equal(done.stages.simplify.status, 'completed')

  const before = device.submits.length
  const rerun = await invoke({
    method: 'POST',
    url: '/tiiny-video/3d/stage',
    body: JSON.stringify({ stage: 'export', runId: done.id }),
  })
  assert.equal(rerun.statusCode, 200)
  const settled = await waitForRun((value) => value.status !== 'running' && value.id === done.id)
  assert.equal(settled.status, 'completed')
  assert.equal(device.submits.length, before + 1)
  assert.equal(device.submits.at(-1).stage, 'export')
  assert.notEqual(settled.stages.export.url, done.stages.export.url, 'a rerun gets a new preview revision')
  assert.match(settled.stages.export.url, /[?&]rev=/)

  const shapeRerun = await invoke({ method: 'POST', url: '/tiiny-video/3d/stage', body: JSON.stringify({ stage: 'shape', runId: done.id }) })
  assert.equal(shapeRerun.statusCode, 200)
  const restarting = jsonOf(shapeRerun).run
  assert.equal(restarting.final, null, 'the old final is invalidated immediately')
  assert.equal(restarting.stages.export.status, 'pending')
  const reshaped = await waitForRun((value) => value.status !== 'running' && value.id === done.id)
  assert.equal(reshaped.status, 'completed')
  assert.equal(reshaped.final, null, 'rerunning shape does not republish the previous export')
  assert.equal(reshaped.stages.texture.url, '')
  assert.equal(reshaped.stages.export.url, '')
})

test('retries a transient status failure instead of failing the stage', async () => {
  device.flakyStage = 'shape'
  try {
    await invoke({
      method: 'POST',
      url: '/tiiny-video/3d/generate',
      body: JSON.stringify({
        imageDataUrl: `data:image/png;base64,${goodPng.toString('base64')}`,
        imageName: 'flaky.png',
        preset: 'fast',
        options: { simplify: false, settleDelay: 0 },
      }),
    })
    const run = await waitForRun((value) => value.status !== 'running')
    assert.equal(run.status, 'completed')
    assert.equal(run.stages.shape.status, 'completed')
    assert.ok(run.log.some((line) => /Failed to query task status/.test(line.text) && line.level === 'warn'), 'logged the retry')
  } finally {
    device.flakyStage = null
  }
})

test('resumes a task parked on waiting_for_device_reset', async () => {
  device.parkStage = 'shape'
  try {
    await invoke({
      method: 'POST',
      url: '/tiiny-video/3d/generate',
      body: JSON.stringify({
        imageDataUrl: `data:image/png;base64,${goodPng.toString('base64')}`,
        imageName: 'parked.png',
        preset: 'fast',
        options: { simplify: false, settleDelay: 0 },
      }),
    })
    const run = await waitForRun((value) => value.status !== 'running', 30000)
    assert.equal(run.status, 'completed')
    assert.equal(run.stages.shape.status, 'completed')
    assert.ok(run.log.some((line) => /xh2a backend fail/.test(line.text)), 'surfaced the device error')
    assert.ok(device.resumed.size > 0, 'asked the device to resume')
  } finally {
    device.parkStage = null
    device.resumed.clear()
  }
})

// Added during the English/layout review; deliberately not executed until the
// user finishes their other device work and asks for verification.
test('skip wait interrupts an active settle delay and running history mutations are refused', async () => {
  await invoke({
    method: 'POST', url: '/tiiny-video/3d/generate',
    body: JSON.stringify({
      imageDataUrl: `data:image/png;base64,${goodPng.toString('base64')}`,
      imageName: 'settle.png', preset: 'fast',
      options: { simplify: false, settleDelay: 10, polish: false },
    }),
  })
  const waiting = await waitForRun((value) => value.phase === 'settle')
  try {
    for (const action of ['rename-run', 'delete-run']) {
      const blocked = await invoke({ method: 'POST', url: `/tiiny-video/3d/${action}`, body: JSON.stringify({ id: waiting.id, name: 'must-not-change' }) })
      assert.equal(blocked.statusCode, 409)
    }
    const skipped = await invoke({ method: 'POST', url: '/tiiny-video/3d/skip-settle' })
    assert.equal(skipped.statusCode, 200)
    const done = await waitForRun((value) => value.id === waiting.id && value.status !== 'running', 3000)
    assert.equal(done.status, 'completed', done.error)
  } finally {
    const current = jsonOf(await invoke({ url: '/tiiny-video/3d/run' })).run
    if (current?.status === 'running') {
      await invoke({ method: 'POST', url: '/tiiny-video/3d/cancel' })
      await waitForRun((value) => value.status !== 'running')
    }
  }
})

test('historical files retain Unicode/spaces and use their recorded output folder', async () => {
  const id = 'historical-file-1234'
  const dir = path.join(home, 'previous-output')
  const file = '鸭子 final model.glb'
  const finalPath = path.join(dir, file)
  await fs.mkdir(dir, { recursive: true })
  const bytes = glb()
  await fs.writeFile(finalPath, bytes)
  const historyPath = path.join(home, 'history.json')
  const history = JSON.parse(await fs.readFile(historyPath, 'utf8'))
  history.unshift({ id, status: 'completed', createdAt: Date.now(), final: { file, path: finalPath, bytes: bytes.length } })
  await fs.writeFile(historyPath, JSON.stringify(history))
  const response = await invoke({ url: `/tiiny-video/3d/file?run=${id}&name=${encodeURIComponent(file)}` })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body, bytes)
  assert.match(response.headers['content-disposition'], /filename\*=UTF-8''/)
  const wrongRun = await invoke({ url: `/tiiny-video/3d/file?run=unknown-1234&name=${encodeURIComponent(file)}` })
  assert.equal(wrongRun.statusCode, 404, 'do not serve another run\'s file by basename')
})

test('file downloads reject path separators and invalid IDs instead of rewriting them', async () => {
  for (const name of ['../painted.glb', '..\\painted.glb', '.', '..', 'bad\u0000.glb']) {
    const response = await invoke({ url: `/tiiny-video/3d/file?run=historical-file-1234&name=${encodeURIComponent(name)}` })
    assert.equal(response.statusCode, 400, name)
  }
  const response = await invoke({ url: '/tiiny-video/3d/file?run=..%2Fescape&name=painted.glb' })
  assert.equal(response.statusCode, 400)
})

test('failed file removal retains the history row and bulk cleanup reports the failure', async () => {
  const id = 'delete-failure-1234'
  const target = path.join(home, 'out', 'not-a-file.glb')
  await fs.mkdir(target, { recursive: true })
  const historyPath = path.join(home, 'history.json')
  const history = JSON.parse(await fs.readFile(historyPath, 'utf8'))
  history.unshift({ id, status: 'failed', createdAt: Date.now(), final: { file: path.basename(target), path: target, bytes: 0 } })
  await fs.writeFile(historyPath, JSON.stringify(history))
  const response = await invoke({ method: 'POST', url: '/tiiny-video/3d/delete-run', body: JSON.stringify({ id, removeExport:true }) })
  assert.equal(response.statusCode, 409, 'a directory cannot be removed as a final model file')
  assert.equal(jsonOf(response).code,'unsafe_file'); assert.ok((await fs.stat(target)).isDirectory())
  const ws=path.join(home,'runs',id); await fs.mkdir(ws,{recursive:true})
  await fs.writeFile(path.join(ws,'run.json'),JSON.stringify({id,status:'failed',stages:{}})); await fs.writeFile(path.join(ws,'personal.txt'),'keep')
  let rows = jsonOf(await invoke({ url: '/tiiny-video/3d/history' })).runs
  assert.ok(rows.some((entry) => entry.id === id), 'failed cleanup remains visible and retryable')
  const bulk = jsonOf(await invoke({ method: 'POST', url: '/tiiny-video/3d/delete-failed',body:JSON.stringify({projects:[{id,status:'failed',finishedAt:null}]}) }))
  assert.ok(bulk.failures.some((entry) => entry.id === id))
  assert.ok(!bulk.removedIds.includes(id))
  rows = jsonOf(await invoke({ url: '/tiiny-video/3d/history' })).runs
  assert.ok(rows.some((entry) => entry.id === id))
})

const generationBody = (extra = {}) => JSON.stringify({
  imageDataUrl: `data:image/png;base64,${goodPng.toString('base64')}`,
  imageName: 'cancel-fixture.png', preset: 'fast', options: { settleDelay: 0, polish: false }, ...extra,
})
const startGeneration = (extra) => invoke({ method: 'POST', url: '/tiiny-video/3d/generate', body: generationBody(extra) })

async function resetCancellationFixture() {
  device.holdStage = null
  device.parkStage = null
  device.cancelDeferred = false
  device.failCancel = false
  device.failTaskQueries = false
  for (const task of device.tasks.values()) {
    task.cancelStatus = 'cancelled'
    task.statusSequence = []
  }
  const current = jsonOf(await invoke({ url: '/tiiny-video/3d/run' })).run
  if (current?.status === 'running') {
    await invoke({ method: 'POST', url: '/tiiny-video/3d/cancel' })
    await waitForRun((run) => run.status !== 'running')
  }
}

test('cancel ACK and a transient cancelled snapshot do not release ownership before stable termination', async () => {
  device.holdStage = 'shape'
  device.cancelDeferred = true
  try {
    await startGeneration()
    const running = await waitForRun((run) => run.stages.shape.taskId && run.stages.shape.deviceStatus === 'running')
    const task = device.tasks.get(running.stages.shape.taskId)
    const response = jsonOf(await invoke({ method: 'POST', url: '/tiiny-video/3d/cancel' })).run
    assert.equal(response.cancelRequested, true)
    assert.equal(response.cancelState, 'pending')
    await waitForRun(() => task.cancelRequested)
    // The control ACK claimed cancelled, but the worker is still running.
    await delay(90)
    const pending = jsonOf(await invoke({ url: '/tiiny-video/3d/run' })).run
    assert.equal(pending.status, 'running')
    assert.equal(pending.stages.shape.cancelPending, true)
    assert.match(pending.phase, /cancelling/)
    const saved = JSON.parse(await fs.readFile(path.join(home, 'runs', pending.id, 'run.json'), 'utf8'))
    assert.equal(saved.stages.shape.cancelPending, true, 'pending state survives reload')
    const before = device.submits.length
    assert.equal((await startGeneration()).statusCode, 409)
    assert.equal((await invoke({ method: 'POST', url: '/tiiny-video/3d/stage', body: JSON.stringify({ runId: pending.id, stage: 'shape' }) })).statusCode, 409)
    assert.equal((await invoke({ method: 'POST', url: '/tiiny-video/3d/resume' })).statusCode, 409)
    assert.equal(device.submits.length, before)
    task.statusSequence = ['cancelled', 'running']
    await waitForRun((run) => run.log.some((line) => /returned to running after a terminal snapshot/.test(line.text)))
    await delay(90)
    assert.equal(jsonOf(await invoke({ url: '/tiiny-video/3d/run' })).run.status, 'running', 'worker rebound resets confirmation')
    const polls = task.polls
    task.cancelStatus = 'cancelled'
    const done = await waitForRun((run) => run.status !== 'running')
    assert.equal(done.status, 'cancelled')
    assert.equal(done.cancelState, 'confirmed')
    assert.equal(done.stages.shape.cancelPending, false)
    assert.ok(task.polls >= polls + 3)
    assert.equal(device.submits.length, before, 'cancellation never resubmits')
  } finally {
    await resetCancellationFixture()
  }
})

test('failed cancel controls and repeated failed status queries keep cancellation pending, then recover', async () => {
  device.holdStage = 'shape'
  device.failCancel = true
  try {
    await startGeneration()
    const running = await waitForRun((run) => run.stages.shape.deviceStatus === 'running')
    await invoke({ method: 'POST', url: '/tiiny-video/3d/cancel' })
    await waitForRun((run) => /cancel control failed/.test(run.stages.shape.cancelError))
    device.failTaskQueries = true
    const pending = await waitForRun((run) => run.log.some((line) => /attempt 12/.test(line.text)))
    assert.equal(pending.status, 'running', '12 GET failures must not imply cancellation')
    assert.equal(pending.stages.shape.cancelPending, true)
    assert.equal((await startGeneration()).statusCode, 409)
    device.failTaskQueries = false
    device.failCancel = false
    const done = await waitForRun((run) => run.status !== 'running')
    assert.equal(done.id, running.id)
    assert.equal(done.status, 'cancelled')
    assert.equal(done.stages.shape.cancelError, '')
  } finally {
    await resetCancellationFixture()
  }
})

test('cancelling during the automatic-resume delay never sends a later resume', async () => {
  device.parkStage = 'shape'
  try {
    await startGeneration()
    const parked = await waitForRun((run) => run.stages.shape.waiting && run.log.some((line) => /Automatic resume attempt/.test(line.text)))
    const id = parked.stages.shape.taskId
    const before = device.controls.length
    await invoke({ method: 'POST', url: '/tiiny-video/3d/cancel' })
    const done = await waitForRun((run) => run.status !== 'running')
    assert.equal(done.status, 'cancelled')
    assert.equal(device.controls.slice(before).some((control) => control.id === id && control.action === 'resume'), false)
    assert.equal(device.resumed.has(id), false)
  } finally {
    await resetCancellationFixture()
  }
})

for (const terminalStatus of ['completed', 'error']) {
  test(`a late cancel does not overwrite verified ${terminalStatus} with cancelled`, async () => {
    device.holdStage = 'export'
    device.cancelDeferred = true
    try {
      await startGeneration()
      const running = await waitForRun((run) => run.stages.export.deviceStatus === 'running')
      const task = device.tasks.get(running.stages.export.taskId)
      await invoke({ method: 'POST', url: '/tiiny-video/3d/cancel' })
      await waitForRun(() => task.cancelRequested)
      task.cancelStatus = terminalStatus
      const done = await waitForRun((run) => run.status !== 'running')
      assert.equal(done.status, terminalStatus === 'completed' ? 'completed' : 'failed')
      assert.equal(done.cancelRequested, true)
      assert.equal(done.stages.export.cancelPending, false)
    } finally {
      await resetCancellationFixture()
    }
  })
}

test('unavailable capabilities send only documented parameters, never unadvertised extras', async () => {
  device.capabilitiesFail = true
  try {
    await startGeneration({ preset: 'quality', extras: { shape: { unknown_extra: 1 } } })
    const done = await waitForRun((run) => run.status !== 'running')
    assert.equal(done.status, 'completed')
    const shape = [...device.submits].reverse().find((submit) => submit.stage === 'shape')
    assert.deepEqual(shape.params, { output_precision: 'high', inference_quality: 'quality', seed: 42 })
    const exported = device.submits.at(-1)
    assert.deepEqual(exported.params, { asset_quality: 'quality' })
  } finally {
    device.capabilitiesFail = false
  }
})

for (const mode of ['ambiguousSubmit', 'missingTaskId']) {
  test(`${mode}: an unknown submission blocks new work until explicit idle acknowledgement`, async () => {
    const before = device.submits.length
    device[mode] = true
    try {
      await startGeneration()
      const failed = await waitForRun((run) => run.status !== 'running')
      assert.equal(failed.status, 'failed')
      assert.equal(failed.stages.shape.taskId, '')
      assert.equal(failed.stages.shape.submissionUnknown, true)
      assert.equal(failed.stages.shape.submissionError.status, 502)
      assert.match(failed.error, /submission outcome unknown/i)
      assert.match(failed.error, /No automatic retry/)
      await delay(80)
      assert.equal(device.submits.length, before + 1, 'POST is never retried automatically')
      const saved = JSON.parse(await fs.readFile(path.join(home, 'runs', failed.id, 'run.json'), 'utf8'))
      assert.equal(saved.stages.shape.submissionUnknown, true)
    } finally {
      device[mode] = false
    }
    const blocked = await startGeneration()
    assert.equal(blocked.statusCode, 409)
    const recoveryId = jsonOf(await invoke({url:'/tiiny-video/3d/status'})).recoveryId
    assert.ok(recoveryId)
    const ack = await invoke({method:'POST',url:'/tiiny-video/3d/acknowledge-idle',body:JSON.stringify({id:recoveryId,confirm:true})})
    assert.equal(ack.statusCode,200)
    const explicit = await startGeneration()
    assert.equal(explicit.statusCode, 200, 'a user-verified idle device can be used again')
    await waitForRun((run) => run.status !== 'running')
  })
}

test('a saved pending cancellation blocks new work after reload and unlocks only after stable GET confirmation', async () => {
  const id = 'restart-pending-1234'
  const taskId = 'orphan-task-1234'
  const workspace = path.join(home, 'runs', id)
  await fs.mkdir(workspace, { recursive: true })
  const file = path.join(workspace, 'run.json')
  await fs.writeFile(file, JSON.stringify({ id, pin:{baseUrl:`http://127.0.0.1:${server.address().port}/v1`, model:device.nativeId, modelInstance:device.instance}, status: 'running', cancelRequested: true, stages: { shape: { taskId, status: 'running', cancelPending: true } } }))
  const task = { stage: 'shape', polls: 0, cancelRequested: true, cancelStatus: 'running' }
  device.tasks.set(taskId, task)
  const before = device.submits.length
  const blocked = await startGeneration()
  assert.equal(blocked.statusCode, 409)
  assert.match(jsonOf(blocked).error, /unconfirmed cancellation/)
  assert.equal(device.submits.length, before)
  const controls = device.controls.length
  task.cancelStatus = 'cancelled'
  const accepted = await startGeneration()
  assert.equal(accepted.statusCode, 200)
  await waitForRun((run) => run.status !== 'running')
  const saved = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.equal(saved.stages.shape.cancelPending, false)
  assert.equal(saved.status, 'cancelled')
  assert.ok(task.polls >= 4)
  assert.equal(device.controls.length, controls, 'restart reconciliation uses GET only')
})

test('concurrent generate requests submit only one pipeline', async () => {
  const before = device.submits.length
  const responses = await Promise.all([startGeneration(), startGeneration()])
  assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409])
  const done = await waitForRun((run) => run.status !== 'running')
  assert.equal(done.status, 'completed')
  assert.equal(device.submits.length, before + 3)
})


test('legacy key migrates on an explicit save; an origin change cannot reuse that key', async () => {
  let settings = jsonOf(await invoke({url:'/tiiny-video/3d/settings'}))
  const bad = await invoke({method:'POST',url:'/tiiny-video/3d/settings',body:JSON.stringify({baseUrl:'https://different.test/v1'})})
  assert.equal(bad.statusCode,400); assert.equal(jsonOf(bad).code,'new_origin')
  assert.deepEqual(jsonOf(await invoke({url:'/tiiny-video/3d/settings'})).baseUrl,settings.baseUrl)
  const disk = JSON.parse(await fs.readFile(path.join(home,'settings.json'),'utf8'))
  assert.equal(disk.apiKey,undefined)
  assert.ok([...records.values()].some(v=>v.kind==='api-key'&&v.key==='test-key'))
  assert.equal((await invoke({url:'/tiiny-3d/status'})).statusCode,404)
})

test('no launch from reads or generation; exact 3D choice and a current impact preview are required', async () => {
  const prior = device.catalog, before = device.launched.length
  device.catalog = [...prior,{ model_id:'other/mesh',status:'downloaded',type:'Image-to-3D' }, {model_id:'LLM/chat',status:'downloaded',type:'Text-to-Text'}]
  device.running = ['LLM/chat']
  try {
    const status = await app.call('status'); assert.equal(status.launchCandidates.length,2);assert.deepEqual(status.runningModels,['LLM/chat']);assert.equal(status.launchable,null)
    for (const body of [{confirm:false}, {modelId:'LLM/chat'}, {modelId:'tencent/hunyuan3d-2.1'}, {expectedRunningModels:[]}]) assert.ok((await launch(body)).statusCode>=400)
    device.busyCount = 2
    assert.equal((await launch({expectedRunningModels:['LLM/chat']})).statusCode,409)
    assert.deepEqual((await app.call('status')).busyModels,['LLM/chat'])
    device.busyCount = undefined
    assert.equal((await launch({expectedRunningModels:['LLM/chat']})).statusCode,409,'missing activity count is not idle')
    device.busyCount = 0; device.pending = ['another-model']
    assert.equal((await launch({expectedRunningModels:['LLM/chat']})).statusCode,409)
    device.pending = []; mediaWarning = 'Host media work remains unresolved elsewhere.'
    assert.match(jsonOf(await launch({expectedRunningModels:['LLM/chat']})).error,/unresolved elsewhere/)
    assert.equal(device.launched.length,before)
    for(const action of ['launch-model','acknowledge-idle','settings','reveal-run']) await assert.rejects(app.call(action,{}), {code:'unsupported_action'})
  } finally {device.catalog = prior;device.busyCount=0;device.pending=[];device.running=[];mediaWarning=''}
})

test('an explicit launch holds the shared gate after acceptance until native readiness is verified', async () => {
  device.holdLaunch = true; const n=device.launched.length
  const response = launch()
  try {
    for(let i=0;i<100 && device.launched.length===n;i++) await delay(5)
    assert.equal(device.launched.length,n+1);assert.equal(owner,'3d-load');assert.throws(()=>gate.acquire('video'), {code:'device_busy'})
    assert.equal((await startGeneration()).statusCode,409)
    device.running=[desired];device.healthReply={status:503,body:{error:'still starting'}}
    await delay(40);assert.equal(owner,'3d-load')
    device.healthReply=null
    assert.equal((await response).statusCode,200);assert.equal(owner,'')
  }finally{device.holdLaunch=false;device.healthReply=null;device.running=[];await response}
})

test('stale client modelInstance is rejected without posting; successful asset generation pins native instance for every task', async () => {
  const before=device.submits.length
  for (const stale of [{modelInstance:'cached-and-wrong'},{expectedModel:'stale-model'}]) await assert.rejects(app.call('generate',{imageAssetId:'local-asset-01',...stale}),{status:409,code:'model_changed'})
  await assert.rejects(app.call('generate',{imageAssetId:'local-asset-01',imageDataUrl:'bogus'}),{status:400})
  await assert.rejects(app.call('generate',{imageAssetId:'missing'}),{code:'frame_missing'})
  assert.equal(device.submits.length,before)
  const offset=device.requestLog.length
  const accepted=await app.call('generate',{imageAssetId:'local-asset-01',options:{settleDelay:0,polish:false}})
  const done=await waitForRun(r=>r.id===accepted.run.id && r.status!=='running')
  assert.equal(done.status,'completed');assert.equal(done.imageAssetId,'local-asset-01')
  assert.equal(done.pin.modelInstance,device.instance);assert.equal(done.pin.model,device.nativeId)
  assert.deepEqual(await fs.readFile(path.join(home,'runs',done.id,done.image.file)),goodPng)
  assert.ok(device.requestLog.slice(offset).filter(r=>r.path.includes('/3d/tasks')).every(r=>r.instance===device.instance))
  device.instance='replacement-instance'
  try { await assert.rejects(app.call('stage',{runId:done.id,stage:'shape'}),{code:'model_changed'}); assert.equal(device.submits.length,before+3) }finally{device.instance='native-i1'}
})

test('no native instance handle means no instance header; management model IDs are never borrowed for it', async () => {
  device.instance=''; const index=device.requestLog.length
  try { await app.call('generate',{imageAssetId:'local-asset-01',options:{settleDelay:0}});const run=await waitForRun(r=>r.status!=='running');assert.equal(run.status,'completed');assert.equal(run.pin.modelInstance,'');assert.ok(device.requestLog.slice(index).filter(r=>r.path.includes('/3d/tasks')).every(r=>r.instance===undefined)) }finally{device.instance='native-i1'}
})

test('an instance swap between stages stops the pipeline without submitting on the replacement', async () => {
  device.holdStage='shape'; const n=device.submits.length
  try {
    const {run}=await app.call('generate',{imageAssetId:'local-asset-01',options:{settleDelay:0}})
    await waitForRun(r=>r.id===run.id && r.stages.shape.deviceStatus==='running')
    device.instance='other';device.holdStage=null
    const end=await waitForRun(r=>r.id===run.id && r.status!=='running');assert.equal(end.status,'failed');assert.match(end.error,/instance changed/);assert.equal(device.submits.length,n+1)
  }finally{device.instance='native-i1';device.holdStage=null}
})


test('browser mutations require a JSON object even on body-free controls; prototype keys never reach task parameters', async () => {
  const before = device.requestLog.length
  for (const pathname of ['/cancel','/delete-failed','/settings','/launch-model']) {
    const res = await invoke({method:'POST',url:'/tiiny-video/3d'+pathname,headers:{origin:'https://elsewhere.invalid','content-type':'text/plain'},body:'{}'})
    assert.equal(res.statusCode,415)
  }
  for(const invalid of ['null','[]','1','{"options":{"constructor":{"prototype":{"unexpected":true}}}}','{"__proto__":{}}']) {
    const res = await invoke({method:'POST',url:'/tiiny-video/3d/generate',body:invalid})
    assert.equal(res.statusCode,400);assert.equal(jsonOf(res).code,'invalid_json')
  }
  assert.equal(device.requestLog.length,before)
})

test('a management transition to B does not complete launch while the native endpoint still reports A', async () => {
  const old = device.nativeId, n = device.launched.length
  device.nativeId='older/family-A'; device.running=[]
  try {
    const result=launch()
    for(let i=0;i<100 && device.launched.length===n;i++)await delay(5)
    await delay(50)
    assert.deepEqual(device.running,[desired]);assert.equal(owner,'3d-load')
    assert.throws(()=>gate.acquire('video'),{code:'device_busy'})
    device.nativeId=old
    const reply=await result;assert.equal(reply.statusCode,200);assert.equal(jsonOf(reply).ready,true);assert.equal(owner,'')
  }finally{device.nativeId=old;device.running=[]}
})

test('terminal pre-Studio runs retaining submitting phase but no unknown/cancel marker do not block recovery', async () => {
  const id='failed-legacy-1234', folder=path.join(home,'runs',id)
  await fs.mkdir(folder,{recursive:true})
  await fs.writeFile(path.join(folder,'run.json'),JSON.stringify({id,status:'failed',finishedAt:1,stages:{shape:{status:'failed',phase:'submitting',taskId:'',submissionUnknown:false}}}))
  assert.equal(await app.checkUnresolved(),'')
})

const markerFile = path.join(home, 'studio-launch.json')
const qwen = 'Qwen/Qwen-Image-2.1'
const imageRow = { model_id: qwen, type: 'Text-to-Image', status: 'running' }
const targetRow = { model_id: desired, type: 'Image-to-3D', status: 'downloaded' }
const noNative = { status: 503, body: { message: 'No suitable model is currently running.' } }
const oldDate = new Date(Date.now() - 24 * 3600 * 1000)
function base3d() { return `http://127.0.0.1:${server.address().port}/v1` }
async function saveMarker(fields = {}, old = true) {
  const marker = { id: 'load-older-studio-01', pending: true, modelId: desired, baseUrl: base3d(), ...fields }
  const raw = JSON.stringify(marker)
  await fs.writeFile(markerFile, raw)
  if (old) await fs.utimes(markerFile, oldDate, oldDate)
  return raw
}
async function recoveryFixture(t) {
  const previous = JSON.parse(await fs.readFile(markerFile, 'utf8').catch(() => 'null'))
  const keys = ['catalog','running','pending','busyCount','nativeId','instance','healthReply','modelsReply','runningReply']
  const saved = Object.fromEntries(keys.map(k => [k,device[k]]))
  Object.assign(device, { catalog: [targetRow, imageRow], running: [qwen], pending: [], busyCount: 0,
    nativeId: 'hunyuan3d', instance: '', healthReply: noNative, modelsReply: noNative, runningReply: null })
  t.after(async () => { Object.assign(device, saved); await fs.writeFile(markerFile, JSON.stringify(previous || {pending:false})) })
}
async function admit() { const release = gate.acquire('image'); try { return await app.checkAdmission() } finally { release() } }

test('old legacy load with Qwen running, idle instances and two stable explicit no-model reports: GET is read-only and admission archives non-success', async t => {
  await recoveryFixture(t)
  const raw = await saveMarker(), mtime = (await fs.stat(markerFile)).mtimeMs
  const n = device.requestLog.length
  const status = await app.call('status')
  assert.equal(status.recoveryKind,undefined); assert.equal(status.recoveryId,undefined); assert.equal(status.canLaunch,true)
  assert.equal(await fs.readFile(markerFile,'utf8'),raw); assert.equal((await fs.stat(markerFile)).mtimeMs,mtime)
  assert.equal(await app.checkAdmission(),null,'an accidental call without the Studio lease only inspects')
  assert.equal(await fs.readFile(markerFile,'utf8'),raw)
  const after = device.requestLog.length
  assert.equal(await admit(),null)
  for (const path of ['/api/v1/models/','/api/v1/models/running','/v1/3d/health','/v1/3d/models']) assert.equal(device.requestLog.slice(after).filter(r=>r.path===path).length,2)
  const marker = JSON.parse(await fs.readFile(markerFile,'utf8'))
  assert.equal(marker.pending,false); assert.equal(marker.outcome,'not_running');assert.ok(marker.verifiedAt);assert.equal(marker.modelId,desired)
  assert.equal(marker.acknowledgedAt,undefined,'evidence is not user acknowledgement')
  assert.ok(device.requestLog.slice(n).every(r=>r.method==='GET'))
})

test('old pending load: exact known Hunyuan family with the unique installed version and one running 3D instance can be verified', async t => {
  await recoveryFixture(t); await saveMarker()
  Object.assign(device,{running:[desired],healthReply:null,modelsReply:null})
  assert.equal(await admit(),null); const marker=JSON.parse(await fs.readFile(markerFile,'utf8'))
  assert.equal(marker.pending,false);assert.equal(marker.outcome,'ready')
})

test('load is NOT proven by timeout alone, generic 503, auth failure, missing or busy instance counts, partial inventory, malformed status, duplicate targets or changed base path', async t => {
  await recoveryFixture(t)
  const first = { ...device }
  const states = [
    [{}, {}, false], [{}, {baseUrl:base3d().replace('/v1','/another/v1')}], [{},{createdAt:Date.now()}],
    [{runningReply:{running:[qwen],pending:[],instances:{running:[{model_id:qwen}]}}}],
    [{runningReply:{running:[],pending:[]}}], [{runningReply:{running:[qwen],pending:[],instances:{running:[{model_id:qwen,active_request_count:'0'}]}}}],
    [{catalog:[targetRow]}], [{catalog:[targetRow,imageRow,{...targetRow}]}], [{pending:[desired]}], [{busyCount:1}],
    [{healthReply:{status:503,body:{message:'Service unavailable'}}}], [{modelsReply:{status:503,body:{message:'proxy temporarily failed'}}}],
    [{modelsReply:{status:401,body:{error:'no_model'}}}], [{modelsReply:null}],
    [{catalog:[{...targetRow,status:'loading'},imageRow]}],
  ]
  for(const [changes,extra={},old=true] of states){
    Object.assign(device,first,changes);const raw=await saveMarker(extra,old)
    const result=await admit();assert.equal(result?.code,'studio_recovery_load', JSON.stringify([changes,extra,old]));assert.equal(result.model,desired)
    assert.equal(await fs.readFile(markerFile,'utf8'),raw)
  }
  const status=await app.call('status');assert.equal(status.recoveryKind,'load');assert.equal(status.recoveryModel,desired)
  const reject=await startGeneration();assert.equal(reject.statusCode,409);assert.equal(jsonOf(reject).code,'studio_recovery_load');assert.equal(jsonOf(reject).model,desired)
})

test('opaque/native wrong family, wrong namespace/version, or multiple installed models never prove a versionless Hunyuan load', async t => {
  await recoveryFixture(t);const raw=await saveMarker()
  Object.assign(device,{running:[desired],healthReply:null,modelsReply:null})
  for(const nativeId of ['Hunyuan3d-2.0','not-hunyuan3d','different/Hunyuan3d-2.1','hunyuan3d-v2']) {
    device.nativeId=nativeId;assert.equal((await admit())?.code,'studio_recovery_load')
  }
  device.nativeId='hunyuan3d'; device.catalog=[targetRow,imageRow,{...targetRow,model_id:'Tencent/Hunyuan3d-2.0'}]
  assert.equal((await admit())?.code,'studio_recovery_load')
  for (const alternate of ['Tencent/Hunyuan3d-2.0','OtherOrg/Hunyuan3d-2.1']) {
    const data=await saveMarker({modelId:alternate}); device.catalog=[{...targetRow,model_id:alternate}];device.running=[alternate]
    assert.equal((await admit())?.code,'studio_recovery_load');assert.equal(await fs.readFile(markerFile,'utf8'),data)
  }
  assert.ok(raw.length)
})

test('admission uses two consistent samples; observation cannot clear a replaced or newly busy journal', async t => {
  await recoveryFixture(t);const raw=await saveMarker();let n=0
  device.runningReply=()=>({running:[qwen],pending:[],instances:{running:[{model_id:qwen,instance_id:++n===1?'i-a':'i-b',active_request_count:0}]}})
  assert.equal((await admit())?.code,'studio_recovery_load');assert.equal(n,2);assert.equal(await fs.readFile(markerFile,'utf8'),raw)
  device.runningReply=null
  const offset=device.requestLog.length, admission=admit()
  for(let i=0;i<100 && !device.requestLog.slice(offset).some(r=>r.path==='/v1/3d/models');i++)await delay(3)
  const newer=await saveMarker({id:'load-newer-studio-02'},false)
  assert.equal((await admission)?.code,'studio_recovery_load');assert.equal(await fs.readFile(markerFile,'utf8'),newer)
})

test('a load-only recovery does not acknowledge an independent incomplete 3D run or cancellation', async t => {
  await recoveryFixture(t);const raw=await saveMarker();const id='unfinished-recovery-3d'
  const folder=path.join(home,'runs',id);await fs.mkdir(folder,{recursive:true});const record=path.join(folder,'run.json')
  const original=JSON.stringify({id,status:'running',pin:{baseUrl:base3d(),model:'mesh'},stages:{shape:{status:'running',cancelPending:true}}})
  await fs.writeFile(record,original)
  try {
    const status=await app.call('status');assert.equal(status.recoveryKind,'task'); assert.equal(status.recoveryId,id); assert.equal(status.recoveryModel,'mesh')
    const reason=await admit();assert.equal(reason.code,'studio_recovery_task'); assert.equal(reason.id,id)
    assert.equal(await fs.readFile(markerFile,'utf8'),raw);assert.equal(await fs.readFile(record,'utf8'),original)
  } finally { await fs.writeFile(record,JSON.stringify({id,status:'failed',idleAcknowledged:true,stages:{}})) }
})

// These independent fixtures only touch the test's mkdtemp root. They need no device or credentials.
async function nativeFiles(t, file = 'final 鸭子.glb') {
  const root = await fs.mkdtemp(path.join(home,'files-')), id='fixture-file-run', dir=path.join(root,'runs',id)
  const outputDir=path.join(root,'original-outputs'), target=path.join(outputDir,file), bytes=glb()
  const journal=path.join(dir,'run.json'), hist=path.join(root,'history.json')
  await fs.mkdir(dir,{recursive:true});await fs.mkdir(outputDir);await fs.writeFile(target,bytes);await fs.writeFile(path.join(dir,'painted.glb'),bytes)
  await fs.writeFile(path.join(dir,'source.png'),goodPng);const original=path.join(root,'outside-reference.png');await fs.writeFile(original,goodPng)
  const final={file,path:target,bytes:bytes.length}, stages=Object.fromEntries(['shape','simplify','texture','export'].map(s=>[s,{status:'pending',artifacts:[]}]))
  stages.export={status:'completed',file:'painted.glb',path:path.join(dir,'painted.glb'),artifacts:[{name:'painted.glb',bytes:bytes.length}]}
  const record={id,status:'completed',outputDir,final,stages,image:{file:'source.png',name:'自定义参考图.png'},log:[],note:'user note'}
  const entry={id,status:'completed',outputDir,final,image:record.image.name,note:'user note'}
  await fs.writeFile(journal,JSON.stringify(record));await fs.writeFile(hist,JSON.stringify([entry]))
  const open=()=>{ const prev=process.env.TIINY_3D_HOME;process.env.TIINY_3D_HOME=root;let next
    try { next=createThreeWorkbench({gate:{acquire:()=>()=>{}}}) } finally { if(prev===undefined)delete process.env.TIINY_3D_HOME;else process.env.TIINY_3D_HOME=prev }
    t.after(()=>next.dispose());return next }
  const host=open()
  return {root,id,dir,outputDir,target,file,bytes,record,entry,journal,hist,host,open,original}
}

test('file-only deletion preserves private stages, older Unicode metadata and external reference; a same-named workspace GLB never impersonates a deleted export',async t=>{
  const x=await nativeFiles(t,'painted.glb'), oldRoute=route
  const result=await x.host.call('delete-export',{id:x.id,expectedFile:x.file});assert.equal(result.removed.final,true)
  assert.equal(await fs.stat(x.target).catch(()=>null),null);assert.deepEqual(await fs.readFile(x.original),goodPng)
  const reopened=x.open(), {run}=await reopened.call('run',{id:x.id}), {runs}=await reopened.call('history')
  assert.equal(run.final,null);assert.equal(runs[0].final,null);assert.equal(run.image.name,x.record.image.name);assert.deepEqual(run.stages.export.artifacts,x.record.stages.export.artifacts)
  assert.equal(JSON.parse(await fs.readFile(x.journal,'utf8')).note,'user note');assert.equal(runs[0].note,'user note')
  try { route=reopened.route;const link=`/tiiny-video/3d/file?run=${x.id}&name=painted.glb`
    for(const q of ['', '&scope=export']) assert.equal((await invoke({url:link+q})).statusCode,404)
    const workspace=await invoke({url:link+'&scope=stage'});assert.equal(workspace.statusCode,200);assert.deepEqual(workspace.body,x.bytes)
  } finally {route=oldRoute}
  assert.equal((await reopened.call('delete-export',{id:x.id})).missing,true)
})

test('bulk cleanup is bound to the reviewed IDs, outcomes and finish times; later failed jobs remain untouched',async t=>{
  const x=await nativeFiles(t), oldRoute=route, selected={id:'reviewed-fail',status:'failed',finishedAt:11}, changed={id:'retired-fail',status:'cancelled',finishedAt:20}, later={id:'later-failure',status:'failed',finishedAt:30}
  await fs.writeFile(x.hist,JSON.stringify([selected,changed,later]))
  try { route=x.host.route;const call=payload=>invoke({method:'POST',url:'/tiiny-video/3d/delete-failed',body:JSON.stringify(payload)})
    assert.equal((await call({})).statusCode,400)
    const res=jsonOf(await call({projects:[selected,{...changed,finishedAt:19}]}));assert.deepEqual(res.removedIds,[selected.id]);assert.equal(res.failures[0].code,'project_changed')
    assert.deepEqual((await x.host.call('history')).runs.map(r=>r.id),[changed.id,later.id]);assert.deepEqual(await fs.readFile(x.target),x.bytes)
  } finally {route=oldRoute}
})

test('project deletion retains a verifiable standalone export across restart, detects replacement, and can explicitly forget only its listing',async t=>{
  const x=await nativeFiles(t), result=await x.host.call('delete-run',{id:x.id});assert.equal(result.keptExport,x.target)
  assert.deepEqual(result.removed,{workspace:true,final:false});assert.equal(await fs.stat(x.dir).catch(()=>null),null);assert.deepEqual(await fs.readFile(x.target),x.bytes)
  const second=x.open(), snapshot=await second.call('history');assert.deepEqual(snapshot.runs,[]);assert.equal(snapshot.exports.length,1)
  const row=snapshot.exports[0];assert.equal(row.id,result.keptExportId);assert.equal(row.state,'available');assert.equal(row.path,x.target);assert.equal(row.image,undefined)
  await fs.writeFile(x.target,'replacement, not generated by this project');await assert.rejects(second.call('delete-export',{id:row.id,expectedFile:x.file}),{code:'unsafe_file'})
  assert.equal((await second.call('history')).exports[0].state,'changed');await second.call('delete-export',{id:row.id,expectedFile:x.file,forgetOnly:true})
  assert.equal(await fs.readFile(x.target,'utf8'),'replacement, not generated by this project');assert.equal((await second.call('history')).exports.length,0);assert.deepEqual(await fs.readFile(x.original),goodPng)
})

test('local native mutations reject a symlinked output directory, links, inactive foreign references, unknown workspace files and forged paths',async t=>{
  const x=await nativeFiles(t), {host,id,dir,root,target,record,entry,journal,hist}=x
  const extra=path.join(dir,'user-note.txt');await fs.writeFile(extra,'do not touch');await assert.rejects(host.call('delete-project',{id,removeExport:true}),{code:'unsafe_file'});assert.deepEqual(await fs.readFile(target),x.bytes)
  const shared={...entry,id:'owner-two'};await fs.writeFile(hist,JSON.stringify([entry,shared]));await assert.rejects(host.call('delete-export',{id}),{code:'file_shared'})
  const alias=path.join(root,'output-alias');await fs.symlink(x.outputDir,alias,'dir');const aliasFile=path.join(alias,x.file)
  await fs.writeFile(hist,JSON.stringify([entry,{...shared,final:{...entry.final,path:aliasFile}}]));await assert.rejects(host.call('delete-export',{id}),{code:'file_shared'})
  for(const pathToFile of [aliasFile, path.join(root,'different.glb')]) {
    if(pathToFile!==aliasFile) await fs.link(target,pathToFile)
    const fake={...entry.final,path:pathToFile,file:path.basename(pathToFile)}, outputDir=path.dirname(pathToFile)
    await fs.writeFile(journal,JSON.stringify({...record,outputDir,final:fake}));await fs.writeFile(hist,JSON.stringify([{...entry,outputDir,final:fake}]))
    await assert.rejects(host.call('delete-export',{id}),{code:'unsafe_file'});assert.deepEqual(await fs.readFile(pathToFile),x.bytes)
  }
  await assert.rejects(host.call('delete-export',{id,path:x.original}),{status:400});await assert.rejects(host.call('delete-project',{id,removeExport:'true'}),{status:400});await assert.rejects(host.call('delete-project',{id:'../other'}),{status:400})
  assert.deepEqual(await fs.readFile(target),x.bytes);assert.equal(await fs.readFile(extra,'utf8'),'do not touch')
})

test('missing legacy export clears only its reference; stale confirmations, changed legacy bytes and orphan task markers keep existing files',async t=>{
  const x=await nativeFiles(t), id=x.id
  await assert.rejects(x.host.call('delete-project',{id,removeExport:true,expectedFile:'not-this.glb'}),{code:'file_changed'})
  const changed=Buffer.from(x.bytes);changed[changed.length-1]^=1;await fs.writeFile(x.target,changed)
  await assert.rejects(x.host.call('delete-export',{id}),{code:'unsafe_file'});assert.deepEqual(await fs.readFile(x.target),changed)
  const orphan={...x.record,stages:{...x.record.stages,shape:{status:'failed',submissionUnknown:true}}};await fs.writeFile(x.journal,JSON.stringify(orphan))
  for(const action of ['delete-export','delete-project']) await assert.rejects(x.host.call(action,{id}),{code:'run_active'})
  assert.deepEqual(await fs.readFile(x.target),changed);assert.equal(JSON.parse(await fs.readFile(x.journal)).stages.shape.submissionUnknown,true)
  await fs.writeFile(x.journal,JSON.stringify(x.record));assert.equal(path.dirname(x.target),x.outputDir);assert.equal(path.basename(x.target),x.file);await fs.unlink(x.target)
  const missing=await x.host.call('delete-export',{id,expectedFile:x.file});assert.equal(missing.missing,true);assert.equal(missing.removed.final,false);assert.equal((await x.host.call('history')).runs[0].final,null);assert.deepEqual(await fs.readFile(x.original),goodPng)
})
