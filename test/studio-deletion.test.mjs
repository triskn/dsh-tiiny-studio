// Public UI routes and the actual registered agent tool, backed only by disposable
// local records and files. No real device, profile, browser, or model is involved.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { finished } from 'node:stream/promises'

const M = '/tiiny-video', N = M + '/3d', origin = 'http://studio-delete.invalid'
const writeJson = (file, obj) => fs.writeFile(file, JSON.stringify(obj))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwLT4JAAKaAYrkCljtAAAAAElFTkSuQmCC', 'base64')
const hash = createHash('sha256').update(png).digest('hex') + '.png'
const clip = Buffer.from('000000186674797069736f6d0000020069736f6d6d703432', 'hex')
const scene = Buffer.from('{"asset":{"version":"2.0"},"scenes":[{}],"scene":0}'.padEnd(52, ' '))
const glb = Buffer.alloc(20 + scene.length)
for (const [i, n] of [0x46546c67, 2, glb.length, scene.length, 0x4e4f534a].entries()) glb.writeUInt32LE(n, i * 4)
scene.copy(glb, 20)
const picture = 'tiiny-image-test-01.png', movie = 'tiiny-video-test-01.mp4'
const absent = file => assert.rejects(fs.lstat(file), { code: 'ENOENT' })
function defer() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const oldJob = (id, kind, file, extras = {}) => ({ id, kind, file, prompt: '用户自己的提示词 / keep exactly', status: 'completed', phase: 'completed', progress: 100, createdAt: 100, finishedAt: 200, ...extras })

async function fixture(t) {
  const tmp = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(tmp, 'studio-delete-test-'))
  const home = path.join(root, 'media'), native = path.join(root, 'native'), out = path.join(root, 'out'), models = path.join(root, 'mesh-out'), assets = path.join(home, 'assets')
  const env = { TIINY_VIDEO_HOME: home, TIINY_3D_HOME: native, TIINY_OUTPUT_DIR: '', TIINY_API_KEY: '', TIINY_BASE_URL: origin + '/v1', TIINY_3D_BASE_URL: origin + '/v1', TIINY_MODEL_SERVICE: '', TIINY_IMAGE_MODEL: '', TIINY_MODEL: '', TIINY_FFMPEG: path.join(root, 'no-ffmpeg'), TIINY_FFPROBE: path.join(root, 'no-ffprobe') }
  const prev = new Map(Object.keys(env).map(k => [k, process.env[k]])); Object.assign(process.env, env)
  const routes = [], tools = [], disposers = [], creds = new Map(), unexpected = []
  let offlineResponse = null
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const u = new URL(input instanceof Request ? input.url : input)
    try {
      assert.equal(u.origin, origin, 'attempted request outside test origin')
      if (offlineResponse) return await offlineResponse(u, init)
      assert.fail('Deleting local items must not contact a device: ' + u.pathname)
    } catch (e) { unexpected.push(e); throw e }
  })
  t.after(async () => {
    try { for (const off of disposers.reverse()) await off() } finally {
      for (const [k, v] of prev) if (v === undefined) delete process.env[k]; else process.env[k] = v
      const exact = await fs.realpath(root)
      assert.equal(exact, root); assert.equal(path.dirname(exact), tmp); assert.match(path.basename(exact), /^studio-delete-test-[a-zA-Z0-9]+$/)
      await fs.rm(exact, { recursive: true }) // Only our verified mkdtemp, never a path from a fixture/Host response.
    }
    assert.deepEqual(unexpected.map(e => e.message), [], 'no unexpected requests, including any absorbed by the Host')
  })
  await Promise.all([assets, native, out, models].map(dir => fs.mkdir(dir, { recursive: true })))
  await writeJson(path.join(home, 'settings.json'), { baseUrl: origin + '/v1', outputDir: out })
  await writeJson(path.join(native, 'settings.json'), { baseUrl: origin + '/v1', outputDir: models })
  const { apply } = await import('../index.js')
  let tool
  async function reopen() {
    // Start a genuinely new workbench over the same own folders; no cached row or run survives.
    for (const off of disposers.splice(0).reverse()) await off()
    routes.length = 0; tools.length = 0
    apply({ effect(f) { const off = f(); if (typeof off === 'function') disposers.push(off) },
      webServer: { register(r) { routes.push(r); return () => {} } }, tools: { register(x) { tools.push(x); return () => {} } },
      credentials: { readRecord: async k => creds.get(k), modifyRecord: async (k, update) => { const next = await update(creds.get(k)); creds.set(k, next); return next } },
    })
    tool = tools.find(x => x.name === 'tiiny_media'); assert.ok(tool)
  }
  await reopen()
  async function http(url, body) {
    const r = routes.find(r => r.path === (url === N || url.startsWith(N + '/') ? N : M)); assert.equal(r?.auth, 'required')
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method: body === undefined ? 'GET' : 'POST', url, headers: { 'content-type': 'application/json', 'accept-language': 'zh-CN,zh;q=0.9' } })
    let status, headers; const data = []
    const res = new Writable({ write(b, _, cb) { data.push(Buffer.from(b)); cb() } })
    res.writeHead = (code, h) => { status = code; headers = new Headers(h); return res }
    await r.handler(req, res); await finished(res, { signal: AbortSignal.timeout(3000) })
    const bytes = Buffer.concat(data)
    return { status, value: headers.get('content-type')?.includes('json') ? JSON.parse(bytes) : null, bytes, headers }
  }
  async function ok(url, body) { const r = await http(url, body); assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.value)}`); return r.value }
  async function action(name, body = {}) {
    try { return { status: 200, value: await tool.execute({ ...body, action: name }) } }
    catch (e) { return { status: e.status || 500, value: { error: e.message, code: e.code } } }
  }
  const del = (how, body) => how === 'HTTP' ? http(M + '/delete', body) : action('delete', body)
  const threeDel = (how, scope, body) => how === 'HTTP' ? http(N + '/delete-' + scope, body) : action('3d_delete_' + scope, body)
  const get = (id) => ok(M + '/job?id=' + encodeURIComponent(id)), jobs = async () => (await ok(M + '/jobs')).jobs
  const rows = (r) => writeJson(path.join(home, 'history.json'), r)
  return { root, home, native, out, models, assets, http, ok, action, del, threeDel, get, jobs, rows, reopen, get tool() { return tool }, device: fn => { offlineResponse = fn } }
}
const accepted = r => { assert.equal(r.status, 200, JSON.stringify(r.value)); return r.value }
const refused = (r, status, code) => { assert.equal(r.status, status, JSON.stringify(r.value)); if (code) assert.equal(r.value.code, code) }
const fileRow = (rows, name) => rows.find(row => row.file === name && row.id.startsWith('file:'))

for (const via of ['HTTP', 'tool']) {
  test(`${via}: deleting a job keeps its export and reusable image; deleting that asset later is a separate choice`, async t => {
    const f = await fixture(t), filename = path.join(f.out, picture)
    await fs.writeFile(filename, png); await fs.writeFile(path.join(f.assets, hash), png)
    await f.rows([oldJob('picture-job', 'image', picture, { outputDir: f.out, assetId: hash, bytes: png.length })])
    accepted(await f.del(via, { id: 'picture-job', scope: 'job' }))
    refused(await f.http(M + '/job?id=picture-job'), 404)
    assert.deepEqual(await fs.readFile(filename), png)
    const saved = fileRow(await f.jobs(), picture); assert.ok(saved, 'the kept asset remains discoverable')
    assert.equal(saved.kind, 'image'); assert.equal(saved.canRetry, false); assert.equal(saved.assetId, hash)
    assert.deepEqual((await f.http((await f.get(saved.id)).url)).bytes, png)
    accepted(await f.del(via, { id: saved.id, scope: 'output' }))
    await absent(filename); await absent(path.join(f.assets, hash)); assert.ok(!fileRow(await f.jobs(), picture))
  })

  test(`${via}: deleting the image output keeps its recipe and a downstream video's reference until its last owner is gone`, async t => {
    const f = await fixture(t), primary = path.join(f.out, picture), exportVideo = path.join(f.out, movie)
    await fs.writeFile(primary, png); await fs.writeFile(exportVideo, clip); await fs.writeFile(path.join(f.assets, hash), png)
    const image = oldJob('producer', 'image', picture, { outputDir: f.out, assetId: hash, bytes: png.length })
    const downstream = oldJob('downstream', 'video', movie, { frameMode: 'last', frameAssetId: hash, outputDir: f.out, size: '832x480', seconds: 5, bytes: clip.length })
    await f.rows([image, downstream]); const request = { id: image.id, scope: 'output' }
    const result = accepted(await f.del(via, request)); assert.equal(result.job?.id, image.id)
    const kept = await f.get(image.id)
    assert.equal(kept.prompt, image.prompt); assert.equal(kept.canRetry, true); assert.equal(kept.outputDeleted, true); assert.equal(kept.hasOutput, false)
    assert.ok(!kept.url && !kept.file && !kept.assetId); await absent(primary)
    const video = await f.get(downstream.id); assert.equal(video.canRetry, true); assert.equal(video.frameMode, 'last')
    assert.equal(video.frameAssetId, hash); assert.deepEqual((await f.http(M + '/asset/' + hash)).bytes, png)
    assert.deepEqual(await fs.readFile(exportVideo), clip)
    accepted(await f.del(via, { id: video.id, scope: 'job', deleteOutput: true }))
    await absent(exportVideo); await absent(path.join(f.assets, hash))
    assert.equal((await f.get(image.id)).prompt, image.prompt)
  })
}

test('the Chinese-locale catalog and old job diagnostics use English without translating or rewriting user data', async t => {
  const load = async lang => JSON.parse(await fs.readFile(new URL(`../locale/${lang}.json`, import.meta.url), 'utf8'))
  const [en, zh] = await Promise.all([load('en'), load('zh')]); assert.equal(en.meta.title, 'Tiiny Studio'); assert.deepEqual(zh.meta, en.meta)
  const f = await fixture(t), model = '模型/原样', original = oldJob('legacy-diagnostic', 'video', '', { status: 'failed', model, errorCode: 'model_not_running', error: '设备报告该模型未就绪。' })
  await f.rows([original]); const view = await f.get(original.id)
  assert.equal(view.model, model); assert.equal(view.prompt, original.prompt); assert.match(view.error, /model|device/i)
  assert.doesNotMatch(view.error.replaceAll(model, ''), /\p{Script=Han}/u)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.home, 'history.json'), 'utf8')), [original], 'translation is a view, not an edit to the user’s record')
})

test('the tool schema advertises the independent media and 3D deletion choices', async t => {
  const f = await fixture(t), p = f.tool.parameters.properties
  for (const name of ['delete', '3d_delete_export', '3d_delete_project']) assert.ok(p.action.enum.includes(name), name)
  assert.deepEqual([...p.scope.enum].sort(), ['job', 'output']); assert.equal(p.deleteOutput.type, 'boolean'); assert.equal(p.removeExport.type, 'boolean')
})

test('a private image remains a discoverable reusable asset after its job is removed even if the exported picture is missing', async t => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.assets, hash), png)
  await f.rows([oldJob('private-only', 'image', picture, { outputDir: f.out, assetId: hash, bytes: png.length })])
  accepted(await f.del('tool', { id: 'private-only', scope: 'job' }))
  const kept = (await f.jobs()).find(r => r.id.startsWith('file:') && r.assetId === hash)
  assert.ok(kept); assert.equal(kept.name || kept.file, picture, 'keep the filename as a label, not a delete path'); assert.ok(!kept.exportPath, 'no export path for a missing file'); assert.equal(kept.canRetry, false); assert.deepEqual((await f.http(kept.url)).bytes, png)
  accepted(await f.del('HTTP', { id: kept.id, scope: 'output' })); await absent(path.join(f.assets, hash))
})

test('loose generated images and MP4s are discoverable without a job; untouched unrelated pictures never become delete targets', async t => {
  const f = await fixture(t), named = '夜景.mp4'
  await fs.writeFile(path.join(f.out, picture), png); await fs.writeFile(path.join(f.out, named), clip)
  await fs.writeFile(path.join(f.out, 'family-photo.png'), png)
  const rows = await f.jobs(), image = fileRow(rows, picture), video = fileRow(rows, named)
  assert.equal(image?.kind, 'image'); assert.equal(video?.kind, 'video'); assert.ok(!rows.some(r => r.file === 'family-photo.png'))
  for (const [row, mime, bytes] of [[image, 'image/png', png], [video, 'video/mp4', clip]]) {
    const v = accepted(await f.action('get', { id: row.id })); assert.equal(v.canRetry, false)
    const stream = await f.http(v.url); assert.equal(stream.status, 200); assert.equal(stream.headers.get('content-type'), mime); assert.deepEqual(stream.bytes, bytes)
    const unknown = await f.del('HTTP', { id: row.id, scope: 'job' }); assert.ok(unknown.status >= 400 && unknown.status < 500)
    accepted(await f.del('tool', { id: row.id, scope: 'output' })); await absent(path.join(f.out, row.file))
  }
  assert.deepEqual(await fs.readFile(path.join(f.out, 'family-photo.png')), png)
})

test('deletion acts on the selected saved directory and never a namesake from another output directory', async t => {
  const f = await fixture(t), old = path.join(f.root, 'earlier-out'); await fs.mkdir(old)
  const otherClip = Buffer.concat([clip, Buffer.from('different clip')])
  await fs.writeFile(path.join(old, movie), clip); await fs.writeFile(path.join(f.out, movie), otherClip)
  await f.rows([oldJob('old-export', 'video', movie, { outputDir: old, bytes: clip.length }), oldJob('new-export', 'video', movie, { outputDir: f.out, bytes: otherClip.length })])
  accepted(await f.del('HTTP', { id: 'old-export', scope: 'job', deleteOutput: true }))
  await absent(path.join(old, movie)); assert.deepEqual(await fs.readFile(path.join(f.out, movie)), otherClip)
  assert.equal((await f.get('new-export')).file, movie)
})

test('two retained namesakes can be told apart by their real export locations after a restart; the other copy survives', async t => {
  const f = await fixture(t), old = path.join(f.root, 'previous-out'); await fs.mkdir(old)
  const bytes = Buffer.concat([clip, Buffer.from('current physical file')]), there = path.join(old, movie), here = path.join(f.out, movie)
  await fs.writeFile(there, clip); await fs.writeFile(here, bytes)
  await f.rows([oldJob('old-namesake', 'video', movie, { outputDir: old, bytes: clip.length }), oldJob('new-namesake', 'video', movie, { outputDir: f.out, bytes: bytes.length })])
  accepted(await f.del('tool', { id: 'old-namesake', scope: 'job' })); accepted(await f.del('HTTP', { id: 'new-namesake', scope: 'job' })); await f.reopen()
  const entries = (await f.jobs()).filter(row => row.file === movie && row.id.startsWith('file:'))
  assert.deepEqual(entries.map(r => r.exportPath).sort(), [there, here].sort()); assert.notEqual(entries[0].id, entries[1].id)
  const selected = entries.find(e => e.exportPath === there), details = accepted(await f.action('get', { id: selected.id }))
  assert.equal(details.exportPath, there); assert.deepEqual((await f.http(details.url)).bytes, clip)
  accepted(await f.del('HTTP', { id: selected.id, scope: 'output', outputToken: details.outputToken })) // The display-only path is never submitted.
  await absent(there); assert.deepEqual(await fs.readFile(here), bytes)
  assert.equal(fileRow(await f.jobs(), movie).exportPath, here)
})

test('a stale file-only selection must not delete a same-named output from newly selected settings', async t => {
  const f = await fixture(t), next = path.join(f.root, 'other-out'); await fs.mkdir(next)
  const other = Buffer.concat([clip, Buffer.from('do not touch')])
  await fs.writeFile(path.join(f.out, movie), clip); await fs.writeFile(path.join(next, movie), other)
  const selected = fileRow(await f.jobs(), movie); assert.ok(selected)
  await f.ok(M + '/settings', { outputDir: next })
  const result = await f.del('HTTP', { id: selected.id, scope: 'output' })
  assert.ok(result.status === 200 || result.status === 404 || result.status === 409, `safe refusal or removal of the original only: ${JSON.stringify(result.value)}`)
  if (result.status !== 200) assert.deepEqual(await fs.readFile(path.join(f.out, movie)), clip)
  assert.deepEqual(await fs.readFile(path.join(next, movie)), other)
})

test('invalid destructive intent, unknown IDs, and double-claimed exports preserve history and data', async t => {
  const f = await fixture(t), filename = path.join(f.out, movie)
  await fs.writeFile(filename, clip); await f.rows(['first', 'second'].map(id => oldJob(id, 'video', movie, { outputDir: f.out, bytes: clip.length })))
  // Scope is explicit on the new endpoint. No bare asset ID or guessed filename can delete a tracked job by accident.
  for (const body of [{ id: 'first' }, { id: 'first', scope: 'unknown' }, { id: 'first', scope: 'job', deleteOutput: 'true' }]) refused(await f.del('HTTP', body), 400)
  for (const how of ['HTTP', 'tool']) {
    refused(await f.del(how, { id: 'unknown-job', scope: 'job' }), 404)
    refused(await f.del(how, { id: hash, scope: 'output' }), 404)
    refused(await f.del(how, { id: 'first', scope: 'output' }), 409, 'shared_output')
    refused(await f.del(how, { id: 'second', scope: 'job', deleteOutput: true }), 409, 'shared_output')
    const alias = await f.del(how, { id: 'file:' + movie, scope: 'output' }); assert.ok(alias.status >= 400 && alias.status < 500, 'no destructive alias around a tracked output')
  }
  assert.equal((await f.jobs()).filter(r => r.id === 'first' || r.id === 'second').length, 2)
  assert.deepEqual(await fs.readFile(filename), clip)
})

test('unresolved media retains its recovery evidence across both interfaces and scopes', async t => {
  const f = await fixture(t), f1 = 'tiiny-video-previous.mp4', f2 = 'tiiny-image-cancelled.png'
  await fs.writeFile(path.join(f.out, f1), clip); await fs.writeFile(path.join(f.out, f2), png)
  const entries = [oldJob('orphan', 'video', f1, { status: 'running', phase: 'in_progress', deviceBase: origin + '/v1', remotePending: true }), oldJob('unverified', 'image', f2, { status: 'cancelled', phase: 'cancelling', deviceBase: origin + '/v1', remotePending: true })]
  await f.rows(entries)
  for (const row of entries) {
    const v = await f.get(row.id); assert.equal(v.deletionBlocked, true); assert.equal(typeof v.deletionBlockReason, 'string')
    for (const via of ['HTTP', 'tool']) for (const scope of ['job', 'output']) {
      const r = await f.del(via, { id: row.id, scope }); assert.equal(r.status, 409, JSON.stringify(r.value)); assert.ok(['unresolved_job', 'device_busy'].includes(r.value.code))
    }
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.home, 'history.json'), 'utf8')), entries)
  assert.deepEqual(await fs.readFile(path.join(f.out, f1)), clip); assert.deepEqual(await fs.readFile(path.join(f.out, f2)), png)
})

test('a confirmed token from a tracked file cannot remove newly replaced contents', async t => {
  const f = await fixture(t), file = path.join(f.out, movie), id = 'changed-file'
  await fs.writeFile(file, clip); await f.rows([oldJob(id, 'video', movie, { outputDir: f.out, bytes: clip.length })])
  const selected = await f.get(id); assert.ok(selected.outputToken)
  const replacement = Buffer.concat([clip, Buffer.from('newly edited output')]); await fs.writeFile(file, replacement)
  for (const how of ['HTTP', 'tool']) {
    refused(await f.del(how, { id, scope: 'job', deleteOutput: true, outputToken: selected.outputToken }), 409)
    assert.deepEqual(await fs.readFile(file), replacement); assert.equal((await f.get(id)).id, id)
  }
})

test('a currently rendering local job cannot be deleted through any scope; the generation remains the only device write', { timeout: 7000 }, async t => {
  const f = await fixture(t), model = 'studio/mock-image', gate = defer(), entered = defer()
  let generations = 0, timer
  f.device(async (url, init) => {
    const uri = url.pathname.replace(/\/$/, ''), method = init.method || 'GET'
    const row = { id: model, model_id: model, type: 'Text-to-Image', status: 'running' }
    if (method === 'GET' && ['/v1/models', '/api/v1/models'].includes(uri)) return Response.json({ data: [row] })
    if (method === 'GET' && uri === '/api/v1/models/running') return Response.json({ running: [model], pending: [], instances: { running: [{ model_id: model, active_request_count: 0 }] } })
    if (method === 'POST' && uri === '/v1/images/generations') { generations++; entered.resolve(); await gate.promise; return Response.json({ data: [{ b64_json: png.toString('base64') }] }) }
    assert.fail(`Unexpected ${method} ${uri}`)
  })
  await f.ok(M + '/settings', { apiKey: 'local-only-test-key', imageModel: model })
  const started = await f.ok(M + '/generate', { kind: 'image', prompt: 'Synthetic fixture only' })
  try {
    await Promise.race([entered.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test image never reached mocked device')), 2500) })])
    assert.equal((await f.get(started.id)).deletionBlocked, true)
    for (const via of ['HTTP', 'tool']) for (const scope of ['job', 'output']) refused(await f.del(via, { id: started.id, scope }), 409, 'device_busy')
    assert.equal((await f.get(started.id)).status, 'running'); assert.equal(generations, 1)
  } finally { clearTimeout(timer); gate.resolve() }
})

async function seedProject(f, id = 'mesh-test-0001', { uncertain = false } = {}) {
  const ws = path.join(f.native, 'runs', id), name = '茶杯.glb', exported = path.join(f.models, name)
  await fs.mkdir(ws, { recursive: true }); await fs.writeFile(exported, glb)
  const local = path.join(ws, 'painted.glb'); await fs.writeFile(local, glb); await fs.writeFile(path.join(ws, 'source.png'), png)
  const final = { file: name, path: exported, bytes: glb.length }
  const stages = Object.fromEntries(['shape', 'simplify', 'texture', 'export'].map(k => [k, { status: 'completed', taskId: 'done-' + k, deviceStatus: 'completed', progress: 100, ms: 10, file: '', artifacts: [] }]))
  stages.export = { ...stages.export, file: 'painted.glb', path: local, bytes: glb.length, artifacts: [{ name: 'painted.glb', mime: 'model/gltf-binary', type: 'export', bytes: glb.length }] }
  if (uncertain) Object.assign(stages.shape, { status: 'running', deviceStatus: 'running', cancelPending: true })
  const project = { id, createdAt: 100, finishedAt: 200, status: uncertain ? 'failed' : 'completed', progress: 100, phase: 'completed', outputDir: f.models, image: { file: 'source.png', name: '茶杯.png', mime: 'image/png', bytes: png.length }, stages, options: {}, params: {}, plan: ['shape', 'texture', 'export'], log: [], final }
  await writeJson(path.join(ws, 'run.json'), project)
  await writeJson(path.join(f.native, 'history.json'), [{ id, createdAt: 100, finishedAt: 200, status: project.status, image: '茶杯.png', final }])
  return { id, ws, name, local, exported }
}

for (const via of ['HTTP', 'tool']) test(`${via}: remove only the verified external GLB; the 3D project and its private artifacts survive`, async t => {
  const f = await fixture(t), p = await seedProject(f)
  const before = accepted(await f.action('3d_artifacts', { id: p.id })).artifacts
  assert.ok(before.some(a => a.stage === 'final' && a.name === p.name))
  accepted(await f.threeDel(via, 'export', { id: p.id }))
  await absent(p.exported); assert.deepEqual(await fs.readFile(p.local), glb); assert.deepEqual(await fs.readFile(path.join(p.ws, 'source.png')), png)
  const remaining = (await f.ok(N + '/artifacts?run=' + p.id)).artifacts
  assert.ok(!remaining.some(a => a.stage === 'final')); assert.ok(remaining.some(a => a.stage === 'export' && a.name === 'painted.glb'))
  assert.ok((await f.ok(N + '/history')).runs.some(r => r.id === p.id && !r.final))
})

for (const [via, removeExport] of [['HTTP', undefined], ['tool', true]]) test(`${via}: project removal ${removeExport ? 'also deletes the explicitly selected GLB' : 'keeps the external GLB by default'}`, async t => {
  const f = await fixture(t), p = await seedProject(f)
  accepted(await f.threeDel(via, 'project', { id: p.id, ...(removeExport && { removeExport }) }))
  await absent(p.ws); assert.ok(!(await f.ok(N + '/history')).runs.some(r => r.id === p.id))
  if (removeExport) await absent(p.exported); else assert.deepEqual(await fs.readFile(p.exported), glb)
})

test('detached GLB survives a reopened Studio; HTTP and tool discover and remove it without reviving its old project', async t => {
  const f = await fixture(t), p = await seedProject(f)
  accepted(await f.threeDel('tool', 'project', { id: p.id })); await f.reopen()
  const page = await f.ok(N + '/history'), item = page.exports?.find(e => e.file === p.name)
  assert.ok(item && item.id !== p.id && !page.runs.some(r => r.id === p.id)); assert.equal(item.state, 'available')
  const agent = accepted(await f.action('3d_history')); assert.ok(agent.exports?.some(e => e.id === item.id && e.file === p.name))
  const url = N + '/file?' + new URLSearchParams({ run: item.id, scope: 'export', name: item.file })
  assert.deepEqual((await f.http(url)).bytes, glb)
  for (const how of ['HTTP', 'tool']) {
    const changed = await f.threeDel(how, 'export', { id: item.id, expectedFile: 'old-export-name.glb' })
    assert.ok(changed.status >= 400 && changed.status < 500, 'a supplied stale filename must not remove any bytes')
    assert.deepEqual(await fs.readFile(p.exported), glb)
  }
  accepted(await f.threeDel('tool', 'export', { id: item.id, expectedFile: item.file })); await f.reopen()
  assert.ok(!(await f.ok(N + '/history')).exports.some(e => e.id === item.id)); refused(await f.http(url), 404); await absent(p.exported)
})

test('3D deletion preserves an unconfirmed cancellation and refuses an unknown project', async t => {
  const f = await fixture(t), p = await seedProject(f, 'mesh-unresolved', { uncertain: true }); const bytes = await fs.readFile(path.join(p.ws, 'run.json'))
  for (const via of ['HTTP', 'tool']) for (const scope of ['project', 'export']) {
    refused(await f.threeDel(via, scope, { id: p.id }), 409)
    refused(await f.threeDel(via, scope, { id: 'unrelated-project' }), 404)
  }
  assert.deepEqual(await fs.readFile(path.join(p.ws, 'run.json')), bytes); assert.deepEqual(await fs.readFile(p.exported), glb)
})
