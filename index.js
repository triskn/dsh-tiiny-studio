/** Tiiny Studio Host. The package/route keys stay stable for existing installations and data. */
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createWorkbench } from './workbench.js'
import { problem } from './assets.js'
import { createActivityGate } from './activity.js'
import { createThreeWorkbench } from './three/index.js'

function json(res, status, value) {
  const text = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(text)
}
async function readBody(req, limit = 64 * 1024) {
  const type = req.headers['content-type'] || ''
  if ((type || req.headers.origin) && type.split(';')[0].trim().toLowerCase() !== 'application/json') throw problem(415, 'invalid_type', 'Send a JSON request')
  const chunks = []; let len = 0
  for await (const chunk of req) {
    len += chunk.length
    if (len > limit) throw problem(413, 'too_large', 'Request is too large')
    chunks.push(chunk)
  }
  let data
  try { data = len ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {} } catch {}
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw problem(400, 'invalid_json', 'Expected a JSON object')
  return data
}
async function sendFile(req, res, { mime, bytes, file }) {
  const headers = { 'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' }
  let start = 0, end = bytes - 1
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim())
    if (match) {
      start = match[1] ? Number(match[1]) : Math.max(0, bytes - Number(match[2]))
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${bytes}` }); res.end(); return
    }
    headers['content-range'] = `bytes ${start}-${end}/${bytes}`
  }
  res.writeHead(req.headers.range ? 206 : 200, { ...headers, 'content-length': Math.max(0, end - start + 1) })
  if (req.method === 'HEAD' || !bytes) return res.end()
  try { await pipeline(createReadStream(file, { start, end }), res) } catch { res.destroy?.() }
}
function route(app, gate) {
  return { kind: 'prefix', path: '/tiiny-video', auth: 'required', async handler(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      const p = url.pathname.replace(/^\/tiiny-video/, '') || '/', get = req.method === 'GET', post = req.method === 'POST'
      if (get && (p === '/' || p === '/settings')) return json(res, 200, await app.settings())
      if (get && p === '/activity') return json(res, 200, gate.snapshot())
      if (get && p === '/models') return json(res, 200, await app.models())
      if (get && p === '/jobs') return json(res, 200, await app.list())
      if (get && p === '/job') return json(res, 200, await app.get(url.searchParams.get('id')))
      if (post && p === '/settings') return json(res, 200, await app.saveSettings(await readBody(req)))
      if (post && p === '/generate') return json(res, 200, await app.start(await readBody(req, 24 * 1024 * 1024)))
      if (post && p === '/retry') return json(res, 200, await app.retry((await readBody(req)).id))
      if (post && p === '/cancel') return json(res, 200, await app.cancel((await readBody(req)).id))
      if (post && p === '/delete') return json(res, 200, await app.remove(await readBody(req)))
      // Older clients confirmed combined removal. Retain their route, but not their ability to bypass ownership checks.
      if (post && p === '/delete-video') {
        const { id } = await readBody(req)
        return json(res, 200, await app.remove(id?.startsWith?.('file:') ? { id, scope: 'output' } : { id, scope: 'job', deleteOutput: true }, true))
      }
      if ((get || req.method === 'HEAD') && p.startsWith('/asset/')) {
        const asset = await app.asset(decodeURIComponent(p.slice(7)))
        res.writeHead(200, { 'content-type': asset.mime, 'content-length': asset.bytes.length, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff' })
        return res.end(get ? asset.bytes : undefined)
      }
      if ((get || req.method === 'HEAD') && p.startsWith('/file/')) return await sendFile(req, res, await app.media(decodeURIComponent(p.slice(6)), url.searchParams.get('job')))
      return json(res, 404, { error: 'not found' })
    } catch (e) {
      const status = e instanceof URIError ? 400 : Number.isInteger(e.status) && e.status >= 400 && e.status <= 599 ? e.status : 500
      return json(res, status, { error: e.message || 'Tiiny Studio request failed', code: typeof e.code === 'string' ? e.code : undefined,
        ...(['studio_recovery_load', 'studio_recovery_task'].includes(e.code) && typeof e.model === 'string' ? { model: e.model } : {}) })
    }
  } }
}
const threeActions = { '3d_status': 'status', '3d_history': 'history', '3d_get': 'run', '3d_artifacts': 'artifacts', '3d_generate': 'generate', '3d_stage': 'stage', '3d_cancel': 'cancel', '3d_resume': 'resume', '3d_skip_settle': 'skip-settle', '3d_delete_export': 'delete-export', '3d_delete_project': 'delete-project' }
function tool(app, three, gate) {
  return {
    name: 'tiiny_media', deferLoading: true,
    description: 'Tiiny Studio: inspect and create images, videos and 3D models. Only delete a specific item at the user’s request. Choose whether to delete the output or its job/project; deleting the job/project keeps the export unless explicitly included. Deletion is permanent. A saved image assetId can be reused as a video frame or 3D reference. No tool action loads or unloads models.',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['activity', 'models', 'list', 'get', 'generate', 'retry', 'cancel', 'delete', ...Object.keys(threeActions)] },
      id: { type: 'string', description: 'Exact job, standalone output or 3D project ID from the library.' },
      scope: { type: 'string', enum: ['output', 'job'], description: 'Required for media delete: output keeps the job recipe; job keeps the output by default. Standalone files accept output only.' },
      deleteOutput: { type: 'boolean', description: 'For media delete with scope job: set true only to also delete its output.' },
      outputToken: { type: 'string', description: 'For media output deletion, pass the outputToken from get to reject a file replaced since selection; an empty string means no disk export was shown.' },
      expectedFile: { type: 'string', description: 'Expected GLB filename for export/project deletion; rejects a renamed export.' },
      forgetOnly: { type: 'boolean', description: 'For a detached GLB export only: remove its library entry without touching the file.' },
      removeExport: { type: 'boolean', description: 'For 3d_delete_project only: set true to also remove the exported GLB. By default the GLB is kept in its export folder.' },
      preset: { type: 'string', enum: ['fast', 'balance', 'quality'], description: 'Quality for a new 3D run.' },
      stage: { type: 'string', enum: ['shape', 'simplify', 'texture', 'export'], description: 'Stage to rerun with 3d_stage.' },
      seed: { type: 'integer', description: 'Optional seed for 3D generation.' },
      options: { type: 'object', additionalProperties: false, properties: { simplify: { type: 'boolean' }, polish: { type: 'boolean' }, settleDelay: { type: 'integer' } }, description: 'Optional native 3D controls; settleDelay is in seconds.' },
      kind: { type: 'string', enum: ['video', 'image'], description: 'Output for generate; default video.' },
      prompt: { type: 'string', description: 'Required for generate.' },
      size: { type: 'string', description: 'Video resolution, e.g. 832x480.' }, seconds: { type: 'number', description: 'Video duration in seconds.' },
      imageAssetId: { type: 'string', description: 'Saved image ID: optional video frame, required input for 3d_generate.' }, frameMode: { type: 'string', enum: ['first', 'last'] },
    } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      const deletionKeys = { delete: ['id', 'scope', 'deleteOutput', 'outputToken'], '3d_delete_export': ['id', 'expectedFile', 'forgetOnly'], '3d_delete_project': ['id', 'expectedFile', 'removeExport'] }
      if (Object.hasOwn(deletionKeys, args.action) && Object.keys(args).some(k => k !== 'action' && !deletionKeys[args.action].includes(k))) throw problem(400, 'invalid_deletion', 'Supply only the ID and options for this specific deletion. No files were changed.')
      if (Object.hasOwn(threeActions, args.action)) {
        if (args.action === '3d_generate' && !args.imageAssetId) throw new Error('Choose a saved imageAssetId as the 3D reference.')
        if (args.action === '3d_stage' && (!args.id || !args.stage)) throw new Error('Specify a run ID and the stage to rerun.')
        const deletion = { id: args.id, ...(args.expectedFile !== undefined && { expectedFile: args.expectedFile }) }
        const payload = args.action === '3d_delete_export' ? { ...deletion, ...(args.forgetOnly !== undefined && { forgetOnly: args.forgetOnly }) }
          : args.action === '3d_delete_project' ? { ...deletion, ...(args.removeExport !== undefined && { removeExport: args.removeExport }) } : { ...args, runId: args.id }
        const result = await three.call(threeActions[args.action], payload)
        if (args.action === '3d_history') return { total: result.runs.length, runs: result.runs.slice(0, 20).map(({ id, status, image, final }) => ({ id, status, image: image || '', file: final?.file || '' })),
          totalExports: (result.exports || []).length, exports: (result.exports || []).slice(0, 20).map(({ id, file, state, bytes }) => ({ id, file, state, bytes })) }
        if (args.action === '3d_status') {
          const { ok, problem, model, modelInstance, error, canLaunch, runningModels, pendingModels, busyModels, verifiedIdle, launchCandidates, recoveryKind, recoveryModel, recoveryMessage } = result
          return JSON.parse(JSON.stringify({ ok, problem, model, modelInstance, error, canLaunch, runningModels, pendingModels, busyModels, verifiedIdle, launchCandidates, recoveryKind, recoveryModel, recoveryMessage }))
        }
        return result
      }
      switch (args.action) {
        case 'activity': return gate.snapshot()
        case 'models': return app.models()
        case 'list': {
          const { jobs } = await app.list()
          return { total: jobs.length, jobs: jobs.slice(0, 20).map(({ id, kind, status, prompt, canRetry, assetId, file, name, exportPath, hasOutput, deletionBlocked, outputDeleted }) => ({ id, kind, status, promptPreview: prompt.slice(0, 80), canRetry, hasOutput, deletionBlocked, ...(outputDeleted ? { outputDeleted } : {}), ...(file ? { file } : name ? { name } : {}), ...(exportPath ? { exportPath } : {}), ...(assetId ? { assetId } : {}) })) }
        }
        case 'get': return app.get(args.id)
        case 'generate': return app.start(args)
        case 'retry': return app.retry(args.id)
        case 'cancel': return app.cancel(args.id)
        case 'delete': return app.remove({ id: args.id, scope: args.scope, deleteOutput: args.deleteOutput, outputToken: args.outputToken })
        default: throw new Error('Unknown Tiiny media action')
      }
    },
  }
}
export const inject = ['webServer', 'tools', 'credentials']
export function apply(ctx) {
  const gate = createActivityGate()
  const app = createWorkbench(ctx.credentials, { gate, checkThree: () => three.checkAdmission() })
  const three = createThreeWorkbench({ gate, readAsset: app.asset, credentials: ctx.credentials, checkMediaForLoad: app.checkMediaForLoad })
  ctx.effect(() => async () => { gate.close(); await Promise.all([app.dispose(), three.dispose()]) })
  ctx.effect(() => ctx.webServer.register(route(app, gate)))
  ctx.effect(() => ctx.webServer.register(three.route))
  if (ctx.tools) ctx.effect(() => ctx.tools.register(tool(app, three, gate)))
}
