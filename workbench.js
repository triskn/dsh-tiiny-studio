import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { decodeUpload, validAssetId, problem } from './assets.js'
import { createStore, publicSettings } from './persistence.js'
import { discoverModels, resolveModel, generateImage } from './device.js'
import { cancelDeviceVideo, renderVideo, videoTerminal, failureMessage, englishDiagnostic, probeShape, safeError } from './video-api.js'
import { createActivityGate } from './activity.js'
import { MEDIA_MIME, mediaKind, regular, inspectExport, listedId, parseFileId, sameOutput } from './media-files.js'

const HISTORY_LIMIT = 50
const isFileItem = id => typeof id === 'string' && id.startsWith('file:')
const pendingOnDevice = j => j.remotePending === true || j.status === 'running' && j.remotePending !== false || j.phase === 'cancelling' && j.remotePending !== false
function stamp(time) { return new Date(time).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-') }
function requiredId(id) {
  if (typeof id !== 'string' || !id.trim() || id.length > 1024) throw problem(400, 'invalid_id', 'A job ID is required')
  return id
}
function snapshot(j) {
  const { id, kind = 'video', prompt = '', size, seconds, frameMode, frameAssetId, model, modelOverride, status, phase, progress, error, errorCode, retryOf, createdAt, finishedAt, file, assetId, bytes, tiinyId, outputDir, deviceBase, remotePending, savedOutputToken, outputDeleted } = j
  return { id, kind, prompt, size, seconds, frameMode, frameAssetId, model, modelOverride, status, phase, progress, error, errorCode, retryOf, createdAt, finishedAt, file, assetId, bytes, tiinyId, outputDir, deviceBase, remotePending, savedOutputToken, outputDeleted }
}

export function createWorkbench(credentials, { gate = createActivityGate(), checkThree = async () => null } = {}) {
  const store = createStore(credentials), { assets } = store
  const live = new Map(), probes = new Map()
  let disposed = false
  const references = rows => new Set(rows.flatMap(r => [r.assetId, r.frameAssetId]).filter(validAssetId))
  async function release(removed, retained) {
    const inUse = references([...retained, ...Array.from(live.values()).filter(r => !removed.some(x => x.id === r.id))])
    for (const id of references(removed)) if (!inUse.has(id)) await assets.drop(id)
  }
  // All history and asset mutations, including admission of the first snapshot, share one lock.
  async function saveLocked(j) {
    const before = await store.history()
    const rows = [snapshot(j), ...before.filter(r => r.id !== j.id)]
    // Explicitly kept library assets and uncertain submissions are not disposable history slots.
    let regularJobs = 0
    const keep = rows.filter(r => isFileItem(r.id) || pendingOnDevice(r) || regularJobs++ < HISTORY_LIMIT)
    await store.writeHistory(keep)
    await release(rows.filter(r => !keep.includes(r)), keep)
  }
  function restored(j) {
    if (!j) return undefined
    if (j.status === 'running' && !live.has(j.id)) return { ...j, status: 'failed', phase: 'interrupted', errorCode: 'interrupted', error: 'Harness stopped while this task was running. Check Tiiny before retrying; no request was resubmitted automatically.' }
    if ((j.status === 'failed' && j.error === 'cancelled') || (j.status === 'cancelled' && j.phase === 'cancelling' && !live.has(j.id))) return { ...j, status: 'cancelled', phase: 'cancelled' }
    return j
  }
  async function findJob(id) { return live.get(id) || (await store.history()).find(j => j.id === id) }
  function deleteGuard(row) {
    if (live.has(row.id) && (row.status === 'running' || row.phase === 'cancelling')) return problem(409, 'device_busy', 'Wait for this job or its cancellation to finish before deleting it.')
    if (pendingOnDevice(row)) return problem(409, 'unresolved_job', 'The device has not confirmed that this job ended. The job and its files are kept as recovery evidence.')
    return null
  }
  async function view(input, currentDir) {
    const job = restored(input), { outputDir, tiinyId, modelOverride, deviceBase, remotePending, savedOutputToken, ...v } = snapshot(job)
    if (isFileItem(input.id) && mediaKind(input.name) === v.kind) v.name = input.name
    const guard = deleteGuard(input)
    v.deletionBlocked = Boolean(guard)
    if (guard) v.deletionBlockReason = guard.message
    v.hasExport = false
    const hasPrompt = Boolean(v.prompt.trim())
    const missing = Boolean(v.frameMode && !(v.frameAssetId && await assets.exists(v.frameAssetId)))
    if (missing) delete v.frameAssetId
    if (v.assetId && !(await assets.exists(v.assetId))) delete v.assetId
    if (v.assetId) v.url = '/tiiny-video/asset/' + encodeURIComponent(v.assetId)
    if (v.file && mediaKind(v.file) === v.kind) {
      const dir = outputDir || currentDir || (await store.settings()).outputDir
      const target = await inspectExport(dir, v.file).catch(() => null) // One unavailable folder must not hide the rest of the library.
      if (target && (!savedOutputToken || savedOutputToken === target.token)) {
        v.hasExport = true; v.outputToken = target.token; v.exportPath = target.file
        v.url ||= '/tiiny-video/file/' + encodeURIComponent(v.file) + '?job=' + encodeURIComponent(v.id)
      } else { v.outputMissing = true }
    }
    v.hasOutput = Boolean(v.hasExport || v.assetId)
    if (v.id.startsWith('file:kept:') && !v.hasOutput) v.canForget = true
    if (v.error) v.error = englishDiagnostic(v.error, v.errorCode, v.model)
    v.canRetry = v.status !== 'running' && v.phase !== 'cancelling' && hasPrompt && !missing
    if (v.phase === 'cancelling') {
      v.retryCode = 'device_busy'; v.retryHint = 'Wait for the cancellation to settle.'
    } else if (!v.canRetry && v.status !== 'running') {
      v.retryHint = missing ? 'This task has no saved reference image. Reuse the prompt, then reattach the frame.' : 'No prompt was saved for this file.'
      v.retryCode = missing ? 'frame_missing' : 'no_prompt'
    }
    // Tool results must already be lossless JSON; HTTP JSON.stringify alone would hide undefined keys.
    return Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined))
  }
  async function diskFiles(dir, known, budget) {
    if (!budget) return []
    let names
    try { names = await fs.readdir(dir, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
    const files = []
    for (const de of names) {
      if (!de.isFile() || !mediaKind(de.name) || known.has(de.name)) continue
      const file = path.join(dir, de.name), st = await regular(file)
      if (st) files.push({ file, name: de.name, st })
    }
    files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    const result = []
    // Probe only untracked clips which will actually appear; never probe a just-downloaded clip twice per poll.
    for (const { file, name, st } of files.slice(0, budget)) {
      const target = await inspectExport(dir, name)
      if (!target) continue
      const kind = mediaKind(name), id = listedId(name, target.token)
      if (kind === 'video' && !probes.has(target.token)) {
        if (probes.size >= 100) probes.delete(probes.keys().next().value)
        probes.set(target.token, probeShape(file))
      }
      result.push({ id, kind, file: name, url: '/tiiny-video/file/' + encodeURIComponent(name) + '?job=' + encodeURIComponent(id), prompt: '', canRetry: false, retryCode: 'no_prompt', hasExport: true, hasOutput: true, outputToken: target.token, exportPath: target.file, deletionBlocked: false,
        status: 'completed', phase: 'completed', progress: 100, bytes: target.stat.size, createdAt: st.mtimeMs, finishedAt: st.mtimeMs, ...await probes.get(target.token) })
    }
    return result
  }
  async function list() {
    const { outputDir } = await store.settings()
    const stored = await store.history(), jobs = [...live.values(), ...stored.filter(j => !live.has(j.id))]
    const known = new Set(jobs.filter(j => !j.outputDir || j.outputDir === outputDir).map(j => j.file))
    const recorded = await Promise.all(jobs.map(j => view(j, outputDir)))
    const files = await diskFiles(outputDir, known, HISTORY_LIMIT)
    return { jobs: [...recorded, ...files].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || (b.createdAt || 0) - (a.createdAt || 0)) }
  }
  async function looseItem(id, outputDir) {
    const { name, token } = parseFileId(id), kind = mediaKind(name)
    if (!kind) return null
    const target = await inspectExport(outputDir, name, { token })
    if (!target) return null
    return { id, kind, file: name, prompt: '', status: 'completed', phase: 'completed', progress: 100, bytes: target.stat.size,
      createdAt: target.stat.mtimeMs, finishedAt: target.stat.mtimeMs, outputDir, savedOutputToken: target.token }
  }
  async function get(id) {
    const j = await findJob(requiredId(id))
    if (j) return view(j)
    if (isFileItem(id)) {
      const { outputDir } = await store.settings(), row = await looseItem(id, outputDir)
      if (row) return view(row, outputDir)
    }
    throw problem(404, 'unknown_job', 'The selected job or output is no longer in the library.')
  }

  async function run(job, s, inputImage) {
    const { signal } = job.controller
    let tmp
    try {
      job.phase = 'resolving_model'
      job.model = await resolveModel(s, job.kind, job.modelOverride, { signal })
      signal.throwIfAborted()
      const stem = `tiiny-${job.kind}-${stamp(job.createdAt)}-${job.id}`
      let generated
      await fs.mkdir(s.outputDir, { recursive: true })
      const checkpoint = () => store.serial(() => saveLocked(job))
      // Before a model-changing operation, a later Host can distinguish 'never submitted'
      // from a lost response, and query the original device (not a newly configured one).
      signal.throwIfAborted()
      job.remotePending = true
      await checkpoint(); signal.throwIfAborted()
      if (job.kind === 'image') {
        job.phase = 'in_progress'
        generated = await generateImage(s, { prompt: job.prompt, model: job.model, signal })
        job.remotePending = false
        signal.throwIfAborted()
        if (!['png', 'jpg', 'webp'].includes(generated.ext)) throw new Error('Unsupported image format returned by Tiiny')
        tmp = path.join(s.outputDir, '.' + stem + '.tmp')
        await fs.writeFile(tmp, generated.bytes, { flag: 'wx', mode: 0o600 })
      } else {
        tmp = path.join(s.outputDir, '.' + stem + '.mp4')
        await renderVideo(s, job, inputImage, tmp, checkpoint)
      }
      const name = stem + '.' + (generated?.ext || 'mp4')
      await store.serial(async () => {
        signal.throwIfAborted()
        // Keep a private copy of the generated reference. Files in the user's output folder can be moved/edited.
        if (generated) job.assetId = await assets.put(generated)
        signal.throwIfAborted()
        const bytes = (await fs.stat(tmp)).size
        await fs.rename(tmp, path.join(s.outputDir, name)); tmp = undefined
        const published = await inspectExport(s.outputDir, name)
        Object.assign(job, { file: name, bytes, savedOutputToken: published?.token, status: 'completed', phase: 'completed', progress: 100, finishedAt: Date.now() })
        await saveLocked(job)
      })
    } catch (e) {
      await store.serial(async () => {
        if (e.submissionRejected === true) job.remotePending = false
        const cancelled = signal.aborted && (!disposed || job.errorCode === 'cancelled')
        if (!cancelled && e.code === 'model_not_running') job.model = e.modelId
        Object.assign(job, { status: cancelled ? 'cancelled' : 'failed', phase: cancelled ? 'cancelled' : disposed ? 'interrupted' : 'failed',
          error: cancelled ? undefined : disposed ? 'Harness stopped; check the device before retrying.' : failureMessage(e, s, job),
          errorCode: cancelled ? 'cancelled' : disposed ? 'interrupted' : typeof e.code === 'string' ? e.code : undefined,
          finishedAt: Date.now(),
        })
        await saveLocked(job)
      })
    } finally { if (tmp) await fs.rm(tmp, { force: true }).catch(() => {}) }
  }

  async function start(body, retryOf) {
    const kind = body.kind ?? 'video', prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!['video', 'image'].includes(kind)) throw problem(400, 'invalid_kind', 'Choose image or video generation')
    if (!prompt || prompt.length > 64000) throw problem(400, 'invalid_prompt', 'A prompt of 1–64000 characters is required')
    if (body.model != null && (typeof body.model !== 'string' || body.model.length > 512 || /[\x00-\x1f]/.test(body.model))) throw problem(400, 'invalid_model', 'Invalid model ID')
    if (body.imageAssetId != null && body.imageDataUrl != null) throw problem(400, 'two_frames', 'Choose one reference image, not both an upload and a saved image')
    if (kind === 'image' && (body.frameMode || body.imageAssetId != null || body.imageDataUrl != null)) throw problem(400, 'unsupported_frame', 'Image generation takes a prompt, not a video frame')
    if (body.frameMode !== undefined && !['first', 'last'].includes(body.frameMode)) throw problem(400, 'invalid_placement', 'Choose either a first frame or a last frame')
    if (body.frameMode === 'last' && body.imageDataUrl == null && body.imageAssetId == null) throw problem(400, 'frame_required', 'Attach an image to use as the last frame')
    const uploaded = body.imageDataUrl != null ? decodeUpload(body.imageDataUrl) : undefined
    const s = await store.settings()
    if (!s.apiKey) throw problem(400, 'missing_key', 'Tiiny API key is not configured. Open Settings to connect your device.')
    const size = kind === 'video' ? body.size ?? s.size : undefined
    const seconds = kind === 'video' ? Number(body.seconds ?? s.seconds) : undefined
    if (kind === 'video' && (typeof size !== 'string' || !Object.hasOwn(s.spec, size))) throw problem(400, 'invalid_shape', `The device does not offer ${size}. Available resolutions: ${Object.keys(s.spec).join(' / ')}.`)
    if (kind === 'video' && !s.spec[size].includes(seconds)) throw problem(400, 'invalid_shape', `${size} supports ${s.spec[size].join(' / ')} seconds, not ${seconds} seconds.`)
    return store.serial(async () => {
      if (disposed) throw problem(503, 'inactive', 'Tiiny Studio is restarting')
      const unlock = gate.acquire(kind)
      let handedOff = false
      try {
        // A pending load receipt is not a running job. Preserve its reason across both UI and tool submissions.
        const blocked = await checkThree()
        if (disposed) throw problem(503, 'inactive', 'Tiiny Studio is restarting')
        if (blocked) {
          const err = problem(409, blocked.code, blocked.message)
          if (blocked.model) err.model = blocked.model
          throw err
        }
        const image = body.imageAssetId != null ? await assets.read(body.imageAssetId) : uploaded
        const frameAssetId = uploaded ? await assets.put(uploaded) : body.imageAssetId || undefined
        const modelOverride = body.model?.trim() || undefined
        const job = { id: randomUUID(), kind, prompt, modelOverride, model: modelOverride || (kind === 'image' ? s.imageModel : s.model), size, seconds,
          frameMode: image ? body.frameMode || 'first' : undefined, frameAssetId, retryOf, deviceBase: s.baseUrl, remotePending: false,
          outputDir: s.outputDir, status: 'running', phase: 'queued', progress: 0, createdAt: Date.now(), controller: new AbortController(),
        }
        // Save inputs BEFORE any remote call: even a failed submission or Host restart has a retryable prompt.
        await saveLocked(job)
        live.set(job.id, job)
        job.stopRemote = () => job.tiinyId && cancelDeviceVideo(s, job.tiinyId).catch(() => false)
        job.task = run(job, s, image).then(() => { live.delete(job.id) }, e => {
          job.status = job.phase = 'failed'; job.error = `Could not save job history: ${safeError(e, s.apiKey)}`
          delete job.stopRemote; delete job.controller
        }).finally(async () => { try { await job.stopTask } finally { unlock() } })
        handedOff = true
        return view(job, s.outputDir)
      } finally { if (!handedOff) unlock() }
    })
  }
  async function retry(id) {
    const j = restored(await findJob(requiredId(id)))
    if (!j) throw problem(id.startsWith('file:') ? 409 : 404, id.startsWith('file:') ? 'no_prompt' : 'unknown_job', id.startsWith('file:') ? 'No prompt was saved for this file' : 'Unknown job')
    if (j.status === 'running') throw problem(409, 'device_busy', 'This task is still running')
    const v = await view(j)
    if (!v.canRetry) throw problem(409, v.retryCode, v.retryHint)
    // The old model value is an observation, not a stale override. Let a repaired connection take effect.
    return start({ kind: v.kind, prompt: v.prompt, size: v.size, seconds: v.seconds, frameMode: v.frameMode, imageAssetId: v.frameAssetId, model: j.modelOverride }, v.id)
  }
  async function cancel(id) {
    requiredId(id)
    const job = await store.serial(async () => {
      const j = live.get(id)
      if (!j || j.status !== 'running') throw problem(409, 'not_running', 'This task is no longer running')
      // Serialised with final publication so a late response cannot overwrite a successful cancel.
      j.controller.abort()
      j.stopTask = j.stopRemote?.()
      Object.assign(j, { status: 'cancelled', phase: 'cancelling', errorCode: 'cancelled', finishedAt: Date.now() })
      await saveLocked(j)
      return j
    })
    await job.stopTask
    return get(id)
  }
  async function remove(request = {}, legacy = false) {
    if (Object.keys(request).some(key => !['id', 'scope', 'deleteOutput', 'outputToken'].includes(key))) throw problem(400, 'invalid_deletion', 'Select a library item by its ID. Paths and unrelated options are not accepted.')
    const { id, scope, deleteOutput, outputToken } = request
    requiredId(id)
    const standalone = isFileItem(id)
    if (!['job', 'output'].includes(scope) || (deleteOutput !== undefined && (scope !== 'job' || typeof deleteOutput !== 'boolean')) || (outputToken !== undefined && !(typeof outputToken === 'string' && /^(?:[a-f0-9]{64})?$/.test(outputToken)))) throw problem(400, 'invalid_deletion', 'Choose Delete output or Delete job. Include the output with a job only by explicitly selecting that option.')
    if (standalone && scope !== 'output') throw problem(400, 'invalid_deletion', 'This item is a standalone output, not a job. Choose Delete output.')
    return store.serial(async () => {
      if (disposed) throw problem(503, 'inactive', 'Tiiny Studio is restarting.')
      const { outputDir } = await store.settings(), history = await store.history()
      const saved = live.get(id) || history.find(r => r.id === id)
      let entry = saved
      if (!entry && standalone) {
        const { name, token } = parseFileId(id)
        if (!mediaKind(name)) throw problem(id.startsWith('file:kept:') ? 404 : 400, 'invalid_file', 'The selected library file is invalid or no longer available.')
        if (!token) throw problem(409, 'stale_output', 'Select this file again from the library to confirm its current location.')
        entry = await looseItem(id, outputDir)
        if (!entry && legacy) return { deleted: true }
      }
      if (!entry) throw problem(404, 'unknown_job', 'This job or output is no longer in the library.')
      const guard = deleteGuard(entry); if (guard) throw guard
      const erase = scope === 'output' || deleteOutput === true
      const others = [...history.filter(r => r.id !== id), ...[...live.values()].filter(r => r.id !== id)]
      const dir = entry.outputDir || outputDir
      let disk = null, shared = false
      if (entry.file) {
        if (mediaKind(entry.file) !== (entry.kind || 'video')) throw problem(400, 'invalid_file', 'The saved output name does not match this item. Nothing was deleted.')
        for (const owner of others) if (await sameOutput(entry, owner, outputDir)) { shared = true; break }
        // If a file was replaced externally, never adopt it for a destructive operation.
        // Job-only deletion can keep the independent private image without claiming an unrelated replacement.
        if (erase && outputToken === '' && saved) {
          // The confirmation showed no export. Forget only our own metadata/private copy, never a replacement file.
          const seen = await inspectExport(dir, entry.file).catch(() => null)
          if (seen && (!entry.savedOutputToken || seen.token === entry.savedOutputToken)) throw problem(409, 'stale_output', 'An export is now available. Refresh the library and confirm which file to delete.')
        } else {
          disk = await inspectExport(dir, entry.file, { token: erase ? entry.savedOutputToken : undefined, destructive: erase })
          if (!erase && disk && entry.savedOutputToken && entry.savedOutputToken !== disk.token) disk = null
        }
      }
      if (erase && disk && shared) throw problem(409, 'shared_output', 'Another library item claims the same export. Keep the output when deleting the duplicate job.')
      if (erase && outputToken !== undefined && outputToken !== (disk?.token || '')) throw problem(409, 'stale_output', 'The output changed since it was selected. Refresh the library and try again.')
      const hasPrivate = validAssetId(entry.assetId) && await assets.exists(entry.assetId)
      const keep = history.filter(row => row.id !== id)
      let remaining
      if (!standalone && scope === 'output') {
        if (!disk && !hasPrivate && !entry.outputDeleted && !entry.file && !entry.assetId) throw problem(409, 'no_output', 'This job has no output to delete. Choose Delete job to remove its record.')
        remaining = { ...snapshot(entry), outputDeleted: true }
        for (const key of ['file', 'bytes', 'assetId', 'savedOutputToken']) delete remaining[key]
        keep.splice(Math.max(0, history.findIndex(r => r.id === id)), 0, remaining)
      } else if (!standalone && !erase && (disk || hasPrivate)) {
        // Retain the output independently of the job. Do not keep any original prompt, inputs or device IDs.
        const assetAlreadyKept = hasPrivate && others.some(r => r.assetId === entry.assetId)
        if ((disk && !shared) || (hasPrivate && !assetAlreadyKept)) {
          const material = { id: 'file:kept:' + randomUUID(), kind: entry.kind || 'video', prompt: '', status: 'completed', phase: 'completed', progress: 100,
            createdAt: entry.finishedAt || entry.createdAt || Date.now(), bytes: entry.bytes || disk?.stat.size,
            ...(mediaKind(entry.file) === (entry.kind || 'video') && { name: entry.file }),
            ...(disk && !shared ? { file: entry.file, outputDir: dir, savedOutputToken: disk.token } : {}), ...(hasPrivate ? { assetId: entry.assetId } : {}) }
          keep.unshift(material)
        }
      }
      // Remove exactly the selected export, never input/upload paths or a directory. All app writers share this lock.
      if (erase && disk) {
        const checked = await inspectExport(dir, entry.file, { token: disk.token, destructive: true })
        if (!checked) throw problem(409, 'stale_output', 'The selected file disappeared. Refresh the library.')
        await fs.unlink(checked.file)
      }
      if (saved) {
        await store.writeHistory(keep)
        live.delete(id)
        await release([entry], keep)
      }
      return legacy ? { deleted: true } : { deleted: true, id, scope, ...(remaining ? { job: await view(remaining, outputDir) } : {}) }
    })
  }
  async function media(name, jobId) {
    const { outputDir } = await store.settings()
    let entry = jobId ? await findJob(requiredId(jobId)) : null
    if (jobId && !entry && isFileItem(jobId)) entry = await looseItem(jobId, outputDir)
    if (!mediaKind(name) || (jobId && (!entry || entry.file !== name || mediaKind(name) !== (entry.kind || 'video')))) throw problem(404, 'invalid_file', 'Media file not found.')
    const target = await inspectExport(entry?.outputDir || outputDir, name, { token: entry?.savedOutputToken })
    if (!target) throw problem(404, 'missing_file', 'This media file is no longer in the output folder.')
    return { file: target.file, bytes: target.stat.size, mime: MEDIA_MIME[path.extname(name)] }
  }
  async function models() {
    const s = await store.settings()
    if (!s.apiKey) throw problem(400, 'missing_key', 'Add the Tiiny API key in Settings, then refresh models')
    try {
      const result = await discoverModels(s)
      return { models: result.models, warning: safeError(result.warning || result.warnings?.join(' · ') || '', s.apiKey) }
    } catch (e) { throw problem(502, 'device_query', safeError(e, s.apiKey)) }
  }
  async function checkMediaForLoad({ verifiedIdle = false, baseUrl: nativeBase } = {}) {
    const history = await store.history()
    const unknown = history.filter(j => j.remotePending === true || (j.status === 'running' && j.remotePending !== false))
    if (!unknown.length) return ''
    const s = await store.settings()
    for (const j of unknown) {
      // The two gateways may be different devices. Never query an old device ID with a new device's key,
      // or trust evidence from a different reverse-proxy mount just because its host matches.
      const original = j.deviceBase
      let terminal = null
      if (j.kind !== 'image' && j.tiinyId && original === s.baseUrl) terminal = await videoTerminal(s, j.tiinyId).catch(() => null)
      if (terminal === true) continue
      if (terminal !== false && verifiedIdle && original === nativeBase) continue
      return `The original device has not confirmed that media job ${j.id} stopped. Check that device in TiinyOS before loading a 3D model.`
    }
    return ''
  }
  return {
    settings: async () => publicSettings(await store.settings()), saveSettings: store.saveSettings, asset: assets.read,
    list, get, start, retry, cancel, remove, media, models, checkMediaForLoad,
    async dispose() {
      disposed = true
      for (const j of live.values()) j.controller?.abort()
      await Promise.allSettled([...live.values()].map(j => j.task))
    },
  }
}
