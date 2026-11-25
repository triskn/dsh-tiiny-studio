/**
 * Tiiny 3D workbench — Host half.
 *
 * Bridges the Harness Web UI to the Image-to-3D service on a Tiiny device
 * ($BASE_URL/3d/*): probes the loaded model, submits each pipeline stage as a
 * multipart task, polls it, downloads artifacts into a per-run workspace, and
 * serves a small control API the Client panel calls.
 *
 * Native pipeline stages:
 *   shape -> simplify (optional) -> texture -> export
 */
import { constants as fsFlags, createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { polishGlb } from './glb.js'
import { spawn } from 'node:child_process'
import { decodeUpload, problem } from '../assets.js'

/** Internal to Studio; registration and cross-workbench ownership belong to the main Host. */
export function createThreeWorkbench({ gate, readAsset, credentials, checkMediaForLoad } = {}) {
if (typeof gate?.acquire !== 'function') throw new Error('3D requires the shared Studio device gate.')
let disposed = false, launchInProgress = false
// Longer than the live startup monitor: late queue registration is not proof a load vanished.
const STALE_LOAD_MS = 5 * 60 * 1000
const LOAD_SAMPLE_GAP_MS = 500
const lifetime = new AbortController()
const prefix = '/tiiny-video/3d'

/**
 * User data lives outside the package: pnpm may replace the package directory
 * on upgrade, so run workspaces and settings must not sit next to this file.
 */
const DATA_DIR = process.env.TIINY_3D_HOME ? path.resolve(process.env.TIINY_3D_HOME) : path.join(os.homedir(), '.tiiny-3d')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const HISTORY_FILE = path.join(DATA_DIR, 'history.json')
const LAUNCH_FILE = path.join(DATA_DIR, 'studio-launch.json')
const EXPORTS_FILE = path.join(DATA_DIR, 'studio-exports.json')
const RUNS_DIR = path.join(DATA_DIR, 'runs')

const DEFAULTS = {
  baseUrl: process.env.TIINY_3D_BASE_URL || 'http://api.tiiny/v1',
  apiKey: process.env.TIINY_API_KEY || '',
  outputDir: path.join(os.homedir(), 'tiiny-3d'),
  settleDelay: 75,
  simplify: false,
  // Repair the device's linear-space albedo and missing normals on export.
  polish: true,
}

/** Pipeline order, device field names, and the share of overall progress. */
const STAGES = [
  { id: 'shape', input: 'image', weight: 45, optional: false },
  { id: 'simplify', input: 'mesh', weight: 10, optional: true },
  { id: 'texture', input: 'image+mesh', weight: 25, optional: false },
  { id: 'export', input: 'material', weight: 20, optional: false },
]
const STAGE_IDS = STAGES.map((stage) => stage.id)

/** Preset values documented for Hunyuan3D-2.1; used when the device stays silent. */
const PRESET_ENUMS = {
  output_precision: ['draft', 'standard', 'high'],
  inference_quality: ['fast', 'balance', 'quality'],
  asset_quality: ['fast', 'balance', 'quality'],
}

const PARAM_STAGES = {
  shape: ['output_precision', 'inference_quality', 'seed'],
  simplify: ['asset_quality', 'target_faces'],
  texture: ['inference_quality'],
  export: ['asset_quality'],
}

/**
 * The panel exposes one quality choice; it expands to these per-stage values.
 * `texture_size` and `supersample` are export-stage parameters the device reports
 * in `/3d/capabilities`; leaving them out made the device bake at 2K without
 * supersampling even at the highest preset.
 */
/**
 * `step` / `guidance_scale` follow the numbers Tencent publishes for 2.1:
 * 50 sampling steps at full quality (fewer steps lose detail) and guidance 5.0.
 * The official Gradio demo ships guidance 7.5, so anyone who prefers the
 * tighter adherence can still override it under "more options".
 */
const QUALITY_PRESETS = {
  fast: { output_precision: 'draft', inference_quality: 'fast', asset_quality: 'fast', texture_size: 1024, supersample: false, step: 25, guidance_scale: 5.0 },
  balance: { output_precision: 'standard', inference_quality: 'balance', asset_quality: 'balance', texture_size: 2048, supersample: true, step: 35, guidance_scale: 5.0 },
  quality: { output_precision: 'high', inference_quality: 'quality', asset_quality: 'quality', texture_size: 4096, supersample: true, step: 50, guidance_scale: 5.0 },
}

/** Simplify is opt-in, so when it runs it should still keep enough detail. */
const SIMPLIFY_TARGET_FACES = 120000

/** Type hints for the parameters this device reports without a schema. */
const KNOWN_PARAMS = {
  step: { type: 'number', min: 1, max: 60, default: 30, description: 'Number of diffusion steps for the shape' },
  guidance_scale: { type: 'number', min: 0, max: 20, step: 0.1, default: 5 },
  paint_step: { type: 'number', min: 1, max: 30, default: 8 },
  texture_size: { type: 'number', min: 512, max: 4096, step: 256, default: 2048 },
  supersample: { type: 'boolean', default: false },
  target_faces: { type: 'number', min: 1000, max: 300000, step: 1000, default: 30000 },
  auto_smooth_angle: { type: 'number', min: 0, max: 180, default: 60 },
  shade_type: { type: 'enum', options: ['SMOOTH', 'FLAT'], default: 'SMOOTH' },
  merge_vertices: { type: 'boolean', default: false },
  simplify: { type: 'boolean', default: true },
  mc_level: { type: 'number', default: 0 },
  depth_tolerance: { type: 'number', step: 0.001, default: 0.002 },
  return_mask: { type: 'boolean', default: false },
  output_name: { type: 'string', default: '' },
}

/** Device polling cadence; the docs use 3 s, tests shorten it. */
const POLL_MS = clampPollInterval(Number(process.env.TIINY_3D_POLL_MS) || 2000)
// A cancel ACK can be overwritten by a still-running worker. Observe repeated
// GET snapshots across a quiet window, never just the control response.
const CANCEL_CONFIRM_MS = Math.max(POLL_MS * 2, Number(process.env.TIINY_3D_CANCEL_CONFIRM_MS) || 10000)
const CANCEL_RETRY_MS = Math.max(POLL_MS, Number(process.env.TIINY_3D_CANCEL_RETRY_MS) || 10000)

function clampPollInterval(value) {
  return Number.isFinite(value) ? Math.min(10000, Math.max(5, value)) : 2000
}

const runs = new Map()

/**
 * Run ids are usually a randomUUID slice, but recovered runs from older builds
 * are named like `recovered-5b84a411`. Accept letters, digits, `_` and `-`;
 * anything else could escape the runs directory.
 */
function runIdOf(value) {
  const id = String(value || '').trim()
  return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : ''
}
let activeRunId = null

// ---------------------------------------------------------------------------
// small utilities

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function readJsonBody(req, limit = 24 * 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw problem(413, 'body_limit', 'The request body exceeds the size limit.')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'), (key, v) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid object key')
      return v
    })
  } catch {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw problem(400, 'invalid_json', 'Send a JSON object with ordinary keys.')
  return value
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function stamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

function sleep(ms, run, allowSkipSettle = false) {
  return new Promise((resolve) => {
    const step = 250
    let waited = 0
    const tick = () => {
      if (disposed) return resolve('cancelled')
      if (run && run.cancelRequested) return resolve('cancelled')
      if (allowSkipSettle && run?.skipSettle) return resolve('skipped')
      waited += step
      if (waited >= ms) return resolve('ok')
      setTimeout(tick, step)
    }
    setTimeout(tick, Math.min(step, ms))
  })
}

/** User-facing file name: keep unicode, drop separators and characters macOS rejects. */
function safeFileName(name, fallback = 'model') {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop() || ''
  const clean = base
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
  return clean || fallback
}

/** Validate a requested basename without changing Unicode or spaces. */
function fileNameOf(value) {
  if (typeof value !== 'string' || !value.trim() || value === '.' || value === '..') return ''
  return /[\/\\\u0000-\u001f\u007f<>:"|?*]/.test(value) ? '' : value
}

function safeName(name, fallback = 'artifact') {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop() || ''
  const clean = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return clean || fallback
}

function normalizedBase(value) {
  let u
  try { u = new URL(value) } catch {}
  if (!u || !['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw problem(400, 'invalid_base', 'Choose an HTTP(S) device Base URL without credentials or query.')
  return u.href.replace(/\/+$/, '')
}
async function jsonFile(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (e) {
    if (e.code === 'ENOENT') return fallback
    throw new Error(`Cannot verify ${path.basename(file)}; retained existing evidence.`)
  }
}
async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' })
  await fs.rename(tmp, file)
}
const recordKey = base => {
  const digest = createHash('sha256').update(DATA_DIR + '\n' + new URL(base).origin).digest('hex')
  return `dsh-tiiny-video/three-${digest}`
}
async function readSettings() {
  const stored = await jsonFile(SETTINGS_FILE, {})
  const baseUrl = normalizedBase(stored.baseUrl || DEFAULTS.baseUrl)
  const secure = credentials ? await credentials.readRecord(recordKey(baseUrl)) : null
  const ambient = new URL(baseUrl).origin === new URL(normalizedBase(DEFAULTS.baseUrl)).origin ? DEFAULTS.apiKey : ''
  return {
    baseUrl, apiKey: secure?.key || stored.apiKey || ambient,
    outputDir: typeof stored.outputDir === 'string' && stored.outputDir.trim() ? stored.outputDir.trim() : DEFAULTS.outputDir,
    settleDelay: Number.isFinite(stored.settleDelay) ? clamp(Math.round(stored.settleDelay), 0, 300) : DEFAULTS.settleDelay,
    simplify: stored.simplify === true, polish: stored.polish !== false,
  }
}
let settingWrite = Promise.resolve()
function writeSettings(patch) {
  const save = settingWrite.then(async () => {
    const current = await readSettings(), saved = await jsonFile(SETTINGS_FILE, {})
    const baseUrl = normalizedBase(patch.baseUrl || current.baseUrl)
    const changed = new URL(baseUrl).origin !== new URL(current.baseUrl).origin
    if (changed && !patch.apiKey) throw problem(400, 'new_origin', 'Enter a new API key for the new device origin. No key was forwarded.')
    const newKey = patch.apiKey || saved.apiKey
    if (newKey) {
      if (newKey.length > 8192 || /[^\x20-\x7e]/.test(newKey)) throw problem(400, 'invalid_key', 'Invalid device key.')
      if (!credentials) throw problem(503, 'credentials_unavailable', 'Harness credential store is unavailable; existing settings were not changed.')
      await credentials.modifyRecord(recordKey(baseUrl), async () => ({ kind: 'api-key', key: newKey }))
    }
    const { apiKey: _secret, ...next } = { ...saved, ...patch, baseUrl }
    await atomicJson(SETTINGS_FILE, next)
    return readSettings()
  })
  settingWrite = save.catch(() => {})
  return save
}

function publicSettings(settings) {
  return {
    baseUrl: settings.baseUrl,
    outputDir: settings.outputDir,
    settleDelay: settings.settleDelay,
    simplify: settings.simplify,
    polish: settings.polish,
    hasApiKey: Boolean(settings.apiKey),
    stages: STAGES,
    presets: PRESET_ENUMS,
    paramStages: PARAM_STAGES,
    platform: process.platform,
  }
}

// ---------------------------------------------------------------------------
// device API

class DeviceError extends Error {
  constructor(message, status, payload) {
    super(message)
    this.status = status
    this.payload = payload
  }
}

const DEVICE_HINTS = {
  400: 'The device rejected the input or parameters. Check parameter names and values at /3d/capabilities.',
  404: 'The path or task_id was not found. Check that the Base URL ends with /v1.',
  409: 'This task belongs to a different model instance.',
  413: 'The request body exceeds 200 MB.',
  422: 'The device does not support this stage or control action.',
  429: 'Another 3D task is running on the device. Wait for it to finish, then try again.',
  502: 'The model service failed or the connection was interrupted. Check whether the task was created before submitting it again.',
  503: 'No 3D model is running on the device. Load an Image-to-3D model in TiinyOS first.',
  504: 'The model service timed out.',
}

function humanize(error) {
  if (!(error instanceof DeviceError)) return describeFetchError(error)
  const hint = DEVICE_HINTS[error.status]
  const detail = String(error.message || '').trim()
  if (!hint) return detail || `HTTP ${error.status}`
  if (!detail || detail === `HTTP ${error.status}`) return hint
  return `${hint} (${detail})`
}

/** fetch aborts arrive as TimeoutError/AbortError with no useful text; name them plainly. */
function describeFetchError(error) {
  const name = error?.name || ''
  const message = String(error?.message || error)
  if (name === 'TimeoutError' || /aborted due to timeout|timed out/i.test(message)) {
    return 'The device did not respond before the request timed out.'
  }
  if (name === 'AbortError') return 'The request was aborted.'
  const cause = error?.cause?.code || error?.cause?.message
  return cause ? `${message} (${cause})` : message
}

class Device {
  constructor(settings) {
    this.root = normalizedBase(settings.baseUrl)
    this.settings = settings
    this.apiKey = settings.apiKey
  }

  headers(extra = {}) {
    const out = { ...extra }
    if (this.apiKey) out.authorization = `Bearer ${this.apiKey}`
    return out
  }

  async request(pathname, init = {}) {
    const { timeoutMs = 120000, ...rest } = init
    return fetch(`${this.root}${pathname}`, {
      ...rest,
      headers: this.headers(rest.headers || {}), redirect: 'error',
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(timeoutMs)]),
    })
  }

  async payload(pathname, init = {}) {
    const response = await this.request(pathname, init)
    const text = await response.text().catch(() => '')
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (response.ok && pathname === '/3d/models') this.observedInstance = cleanId(response.headers.get('x-tiiny-model-instance'))
    if (!response.ok) {
      const detail = body?.message || body?.error?.message || (typeof body?.error === 'string' ? body.error : '') || body?.detail
      const error = new DeviceError(redact(detail || text.slice(0, 300), this.apiKey) || `HTTP ${response.status}`, response.status)
      // A generic gateway outage/503 is not evidence that a load ended.
      const code = body?.error?.code || body?.error_code || body?.code
      error.noModel = response.status === 503 && ([code, detail].some(x => typeof x === 'string' && /^(?:no_(?:(?:running|loaded|suitable)_)?model(?:_instance)?|model_not_loaded|no (?:suitable |3d |image-to-3d )?model (?:is )?(?:currently )?(?:running|loaded)|no running (?:model )?instance(?: (?:found|available)(?: for (?:3d|image-to-3d))?)?)[.!]?$/i.test(x.trim())))
      throw error
    }
    // Task endpoints wrap payloads in {status, data}; unwrap when present.
    return body && typeof body === 'object' && 'data' in body ? body.data : body
  }

  health() {
    return this.payload('/3d/health', { timeoutMs: 8000 })
  }

  models() {
    return this.payload('/3d/models', { timeoutMs: 15000 })
  }

  capabilities() {
    return this.payload('/3d/capabilities', { timeoutMs: 20000 })
  }

  version() {
    return this.payload('/3d/version', { timeoutMs: 10000 })
  }

  async submit(stage, params, files) {
    const form = new FormData()
    form.set('stage', stage)
    form.set('params', JSON.stringify(params || {}))
    for (const [field, file] of Object.entries(files || {})) {
      form.set(field, new Blob([file.bytes], { type: file.mime || 'application/octet-stream' }), file.name)
    }
    const headers = this.taskHeaders()
    try {
      const data = await this.payload('/3d/tasks', { method: 'POST', body: form, timeoutMs: 30 * 60 * 1000, headers })
      const taskId = data?.task_id || data?.taskId || data?.id
      if (!taskId) throw new DeviceError('The device did not return a task_id.', 502, data)
      return taskId
    } catch (error) {
      // The server may have created a task before its response was lost. Never
      // turn an ambiguous POST into a retry, or imply that no device task exists.
      if (!(error instanceof DeviceError) || [500, 502, 504].includes(error.status)) {
        const unknown = new DeviceError(`Upstream unavailable or response incomplete; submission outcome unknown. No automatic retry was made. Verify device task state before submitting again. ${describeFetchError(error)}`, error instanceof DeviceError ? error.status : 0, error?.payload)
        unknown.submissionUnknown = true
        throw unknown
      }
      throw error
    }
  }

  taskHeaders() { return this.modelInstance ? { 'x-tiiny-model-instance': this.modelInstance } : {} }

  task(taskId) {
    return this.payload(`/3d/tasks/${encodeURIComponent(taskId)}`, { timeoutMs: 180000, headers: this.taskHeaders() })
  }

  async control(taskId, action, expectedPin, allowed = () => true) {
    await verifyPin(this, expectedPin)
    if (!allowed() || disposed) throw problem(409, 'task_changed', 'Task ownership changed; no control request was sent.')
    return this.payload(`/3d/tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST', timeoutMs: 30000, headers: this.taskHeaders() })
  }

  async artifact(taskId, artifactId) {
    const response = await this.request(`/3d/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(artifactId)}`, {
      timeoutMs: 15 * 60 * 1000, headers: this.taskHeaders(),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new DeviceError(redact(text, this.apiKey) || `Failed to download the artifact: HTTP ${response.status}`, response.status)
    }
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mime: response.headers.get('content-type') || 'application/octet-stream',
    }
  }
}

// ---------------------------------------------------------------------------
// capabilities

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, entry]) => (entry && typeof entry === 'object' ? { name: key, ...entry } : { name: key, value: entry }))
  }
  return []
}

/** Find a parameter descriptor anywhere in the capabilities payload. */
function findParam(node, name, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return undefined
  if (!Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === name && value && typeof value === 'object') return value
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const hit = findParam(value, name, depth + 1)
      if (hit) return hit
    }
  }
  return undefined
}

function optionsOf(descriptor) {
  if (!descriptor || typeof descriptor !== 'object') return undefined
  const raw = descriptor.enum || descriptor.enums || descriptor.options || descriptor.choices || descriptor.values || descriptor.allowed || descriptor.range
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : undefined
  if (!list) return undefined
  const flat = list
    .map((item) => (item && typeof item === 'object' ? item.value ?? item.id ?? item.name : item))
    .filter((item) => item !== undefined && item !== null && item !== '')
  return flat.length ? flat.map((item) => String(item)) : undefined
}

function normalizeParam(stage, raw, fallbackName) {
  const given = raw && typeof raw === 'object' ? raw : {}
  const name = String(given.name || given.key || given.id || given.param || fallbackName || '')
  if (!name) return null
  // The device reports parameter names without a schema; fill in known types.
  const source = { ...(KNOWN_PARAMS[name] || {}), ...given }
  const options = optionsOf(source)
  const defaultValue = source.default ?? source.defaultValue ?? source.value ?? source.current
  const numericDefault = typeof defaultValue === 'number' ? defaultValue : Number(defaultValue)
  const type = options ? 'enum' : source.type === 'boolean' || typeof defaultValue === 'boolean' ? 'boolean' : Number.isFinite(numericDefault) ? 'number' : 'string'
  return {
    stage,
    name,
    type,
    default: defaultValue === undefined ? (type === 'number' ? null : type === 'boolean' ? null : '') : defaultValue,
    options,
    min: Number.isFinite(source.min ?? source.minimum) ? source.min ?? source.minimum : undefined,
    max: Number.isFinite(source.max ?? source.maximum) ? source.max ?? source.maximum : undefined,
    step: Number.isFinite(source.step) ? source.step : type === 'number' ? 1 : undefined,
    description: String(source.description || source.desc || source.hint || source.help || source.title || ''),
    documented: Boolean(PARAM_STAGES[stage]?.includes(name)),
  }
}

function normalizeCapabilities(raw) {
  const groups = []
  const seen = new Set()
  const push = (stage, params) => {
    if (!params.length) return
    let group = groups.find((item) => item.stage === stage)
    if (!group) {
      group = { stage, params: [] }
      groups.push(group)
    }
    for (const param of params) {
      if (seen.has(`${stage}:${param.name}`)) continue
      group.params.push(param)
      seen.add(`${stage}:${param.name}`)
    }
  }

  // Schema A (this device): { stages: ["shape",...], params: { shape: ["step",...] } }
  const flat = raw?.params || raw?.data?.params
  if (flat && typeof flat === 'object' && !Array.isArray(flat)) {
    for (const [stage, names] of Object.entries(flat)) {
      if (!STAGE_IDS.includes(stage)) continue
      push(stage, asArray(names).map((item) => normalizeParam(stage, typeof item === 'string' ? { name: item } : item)).filter(Boolean))
    }
  }

  // Schema B: [{ stage, parameters: { name: descriptor } }]
  const stages = raw?.stages || raw?.data?.stages || raw?.stage_list || raw?.capabilities?.stages
  for (const entry of asArray(stages)) {
    if (typeof entry !== 'object' || entry === null) continue
    const id = String(entry.stage || entry.id || entry.name || '').replace(/^.*\./, '')
    if (!STAGE_IDS.includes(id)) continue
    const list = entry.parameters || entry.params || entry.options || entry.controls || entry.fields || entry.config
    push(id, asArray(list).map((item) => normalizeParam(id, typeof item === 'string' ? { name: item } : item)).filter(Boolean))
  }
  // Fall back to known stage parameters that the device reports somewhere else.
  for (const [stage, names] of Object.entries(PARAM_STAGES)) {
    for (const name of names) {
      if (seen.has(`${stage}:${name}`)) continue
      const descriptor = findParam(raw, name)
      if (!descriptor) continue
      push(stage, [normalizeParam(stage, { ...descriptor, name }, name)].filter(Boolean))
    }
  }
  return groups
}

function deriveEnums(raw) {
  const list = (value) => {
    const names = asArray(value).map((item) => String(typeof item === 'object' && item !== null ? item.id ?? item.name ?? item.value : item))
    return names.filter(Boolean)
  }
  const precisions = list(raw?.output_precisions || raw?.data?.output_precisions)
  const inference = list(raw?.inference_qualities || raw?.data?.inference_qualities)
  const asset = list(raw?.asset_qualities || raw?.data?.asset_qualities)
  const enums = {
    output_precision: precisions.length ? precisions : PRESET_ENUMS.output_precision,
    inference_quality: inference.length ? inference : PRESET_ENUMS.inference_quality,
    asset_quality: asset.length ? asset : PRESET_ENUMS.asset_quality,
  }
  for (const name of Object.keys(PRESET_ENUMS)) {
    if (enums[name] !== PRESET_ENUMS[name]) continue
    const options = optionsOf(findParam(raw, name))
    if (options && options.length) enums[name] = options
  }
  return enums
}

function cleanId(v) {
  return typeof v === 'string' && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v) ? v.trim() : ''
}
function redact(v, key) { return (key ? String(v || '').replaceAll(key, '[redacted]') : String(v || '')).slice(0, 320) }
function uniqueId(values) {
  const ids = [...new Set(values.map(cleanId).filter(Boolean))]
  if (ids.length > 1) throw problem(409, 'ambiguous_3d', 'Multiple 3D models or instances were reported. Select a single 3D instance in TiinyOS and refresh.')
  return ids[0] || ''
}
async function nativePin(device) {
  const health = await device.health()
  if (!health || /^(unhealthy|offline|failed|error|loading)$/i.test(health.status || health.state || '')) throw problem(409, 'native_not_ready', 'The 3D service is not ready. Check it in TiinyOS.')
  return pinFromReports(device, health, await device.models())
}
function pinFromReports(device, health, body) {
  const list = Array.isArray(body) ? body : (Array.isArray(body?.models) ? body.models : [body])
  const rows = list.filter(r => !/^(?:unloaded|stopped|downloaded|loading|failed)$/i.test(r?.state || r?.status || ''))
  if (!list.length) throw problem(409, 'native_no_model', 'The native 3D model list is empty.')
  if (!rows.length) throw problem(409, 'native_not_ready', 'The 3D service reports no ready instance. Check the model state in TiinyOS.')
  const id = uniqueId(rows.map(r => typeof r === 'string' ? r : r?.model_id || r?.modelId || r?.id || r?.model || r?.name))
  const nativeInstance = r => r?.model_instance_id || r?.model_instance || r?.instance_id || r?.modelInstance || ''
  const instance = uniqueId([device.observedInstance, nativeInstance(health), nativeInstance(body), ...rows.map(nativeInstance)])
  if (!id) throw problem(409, 'native_not_ready', 'Cannot verify which 3D model is running. Check the device in TiinyOS.')
  return { baseUrl: device.root, model: id, modelInstance: instance }
}
function verifyExpected(body, pin) {
  if ((body.expectedModel !== undefined && body.expectedModel !== pin.model) || (body.modelInstance !== undefined && body.modelInstance !== pin.modelInstance)) {
    throw problem(409, 'model_changed', 'The inspected 3D model or native instance changed. Refresh status before submitting.')
  }
}
async function verifyPin(device, expected) {
  if (expected && normalizedBase(expected.baseUrl) !== device.root) throw problem(409, 'device_changed', 'The original device Base URL changed. Restore it or start a new run.')
  const pin = await nativePin(device)
  if (expected && (pin.model !== expected.model || (expected.modelInstance && pin.modelInstance !== expected.modelInstance))) throw problem(409, 'model_changed', 'The running 3D model or its instance changed. Do not reuse this task; restore the original instance or start a new run.')
  if (expected && pin.modelInstance && !expected.modelInstance) expected.modelInstance = pin.modelInstance
  device.modelInstance = pin.modelInstance
  return pin
}
function modelStoreUrl(settings, suffix) {
  return normalizedBase(settings.baseUrl).replace(/\/v1$/, '') + '/api/v1/models/' + suffix
}
async function modelStore(settings, suffix, init = {}) {
  const response = await fetch(modelStoreUrl(settings, suffix), {
    ...init, headers: { accept: 'application/json', authorization: `Bearer ${settings.apiKey}`, ...init.headers },
    redirect: 'error', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(20000)]),
  })
  if (!response.ok) {
    response.body?.cancel().catch(() => {})
    throw new DeviceError(`Model management HTTP ${response.status}. Check TiinyOS.`, response.status)
  }
  return response.json()
}
async function management(settings) {
  const [catalog, state] = await Promise.all([modelStore(settings, ''), modelStore(settings, 'running')])
  const rows = Array.isArray(catalog) ? catalog : catalog?.data
  const r = state?.data || state
  if (!Array.isArray(rows) || !Array.isArray(r?.running) || !Array.isArray(r?.pending)) throw new Error('Unrecognized model management response')
  const idOf = x => cleanId(typeof x === 'string' ? x : x?.model_id || x?.fullname || x?.id)
  const runningModels = r.running.map(idOf), pendingModels = r.pending.map(idOf)
  if (runningModels.includes('') || pendingModels.includes('')) throw new Error('Unidentified model in running list')
  const instances = Array.isArray(r.instances?.running) ? r.instances.running : []
  const pending = Array.isArray(r.instances?.pending) ? r.instances.pending : []
  for (const row of pending) if (!pendingModels.includes(idOf(row))) pendingModels.push(idOf(row) || '(unknown)')
  const busyModels = [...new Set(instances.filter(row => Number(row?.active_request_count) > 0).map(row => idOf(row) || '(unknown)'))]
  const verifiedIdle = Array.isArray(r.instances?.running) && (r.instances.pending === undefined || Array.isArray(r.instances.pending)) && !pendingModels.length &&
    instances.every(row => runningModels.includes(idOf(row)) && row?.active_request_count === 0) && runningModels.every(id => instances.some(row => idOf(row) === id))
  const inventory = rows.map(row => ({ id: idOf(row), type: cleanId(row?.type).toLowerCase().replace(/[ _]/g, '-'), name: cleanId(row?.display_name || row?.name) || idOf(row), status: cleanId(row?.status).toLowerCase() }))
  const candidates = inventory.filter(m => m.type === 'image-to-3d' && m.id).map(({ id, name, status }) => ({ id, name, status }))
  const result = { launchCandidates: candidates, runningModels, pendingModels, busyModels, verifiedIdle, canLaunch: verifiedIdle && candidates.some(m => m.status === 'downloaded'), managementWarning: verifiedIdle ? '' : 'Device is busy or its active request counts are unknown. Wait or use TiinyOS.' }
  // Keep evidence private: do not expose an extra device inventory in the JSON/UI.
  Object.defineProperties(result, { inventory: { value: inventory }, instanceKeys: { value: instances.map(row => [idOf(row), cleanId(row?.instance_id)]).sort() } })
  return result
}
// A store identity is not a native family or an instance handle. Never turn a substring,
// `busy:false`, or another running model into a successful load for the requested ID.
function loadTarget(live, id) {
  const rows = live.inventory, fold = s => s.toLowerCase()
  if (!live.verifiedIdle || !rows || rows.some(r => !r.id || !r.type) || new Set(rows.map(r => fold(r.id))).size !== rows.length) return null
  if (new Set(live.runningModels.map(fold)).size !== live.runningModels.length) return null
  if (live.runningModels.some(r => !rows.some(m => m.id === r))) return null
  const model = rows.find(r => r.id === id && r.type === 'image-to-3d')
  return model && { model, running3d: live.launchCandidates.filter(m => live.runningModels.includes(m.id)) }
}
function targetReady(live, target, pin) {
  const info = loadTarget(live, target)
  if (!info || !['running','loaded','downloaded'].includes(info.model.status) || info.running3d.length !== 1 || info.running3d[0].id !== target || live.instanceKeys.filter(([id]) => id === target).length !== 1) return false
  const native = pin.model.toLowerCase(), actual = target.toLowerCase()
  if (native.includes('/')) return native === actual // a foreign namespace is not an alias
  const short = id => id.toLowerCase().split('/').at(-1)
  if (native === 'hunyuan3d') {
    // This firmware specifically returns `hunyuan3d` for Tencent/Hunyuan3d-2.1.
    // A second installed 3D model/version makes an unversioned family inconclusive.
    return actual === 'tencent/hunyuan3d-2.1' && live.launchCandidates.length === 1
  }
  return native === short(target) && live.launchCandidates.filter(m => short(m.id) === native).length === 1
}
async function nativeLoadSample(settings) {
  const device = new Device(settings)
  const [health, models] = await Promise.allSettled([device.health(), device.models()])
  const modelList = models.status === 'fulfilled' && (Array.isArray(models.value) ? models.value : models.value?.models)
  const emptyModels = Array.isArray(modelList) && modelList.length === 0
  if (health.status === 'rejected' && health.reason?.noModel && ((models.status === 'rejected' && models.reason?.noModel) || emptyModels)) return { absent: true }
  if (health.status !== 'fulfilled' || models.status !== 'fulfilled' || !/^(?:ok|ready|running|healthy|success)$/i.test(health.value?.status || health.value?.state || '')) return null
  return { pin: pinFromReports(device, health.value, models.value) }
}
async function loadSample(settings, marker) {
  const [live, native] = await Promise.all([management(settings), nativeLoadSample(settings)])
  const info = loadTarget(live, marker.modelId)
  if (!info || !native) return null
  if (native.pin && targetReady(live, marker.modelId, native.pin)) return { outcome: 'ready', key: JSON.stringify([live.instanceKeys, native.pin.model, native.pin.modelInstance]) }
  // Non-running is NOT a successful launch. All reported running IDs must be identified
  // in the same inventory; both native endpoints must independently say no model.
  if (native.absent && info.model.status === 'downloaded' && !info.running3d.length && !live.launchCandidates.some(m => ['running','loaded','loading','pending','starting'].includes(m.status))) {
    return { outcome: 'not_running', key: JSON.stringify([live.instanceKeys, live.launchCandidates.map(m => [m.id,m.status]).sort()]) }
  }
  return null
}
async function readLoad() {
  let handle
  try {
    handle = await fs.open(LAUNCH_FILE, 'r')
    const [raw, stat] = await Promise.all([handle.readFile('utf8'), handle.stat()])
    return { marker: JSON.parse(raw), stamp: `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${raw}`, mtime: stat.mtimeMs }
  } catch (e) { if (e.code === 'ENOENT') return null; throw e } finally { await handle?.close() }
}
function recoveryReason(kind, id, message, model) {
  return { code: 'studio_recovery_' + kind, ...(id && { id }), ...(model && { model }),
    message: `${message} Verify in TiinyOS that all tasks and model loads have ended before acknowledging the idle device in 3D settings.` }
}
async function checkSavedLoad(record, reconcile) {
  const m = record.marker, id = runIdOf(m.id), target = cleanId(m.modelId)
  const blocked = recoveryReason('load', id, `The outcome of loading ${target || 'the 3D model'} has not been verified.`, target)
  try {
    const settings = await readSettings()
    if (!id || !target || m.pending !== true || !settings.apiKey || settings.baseUrl !== m.baseUrl) return blocked
    const since = Math.max(record.mtime, m.createdAt === undefined ? 0 : Number.isSafeInteger(m.createdAt) ? m.createdAt : Infinity)
    // A restarted Host cannot tell whether a just-sent 20-second launch POST still lacks a reply.
    if (!Number.isFinite(since) || since <= 0 || Date.now() - since < 30_000) return blocked
    const first = await loadSample(settings, m)
    if (!first || (first.outcome === 'not_running' && Date.now() - since < STALE_LOAD_MS)) return blocked
    await sleep(LOAD_SAMPLE_GAP_MS)
    const next = await loadSample(settings, m)
    if (!next || first.key !== next.key || first.outcome !== next.outcome || disposed || (await readSettings()).baseUrl !== m.baseUrl) return blocked
    if ((await readLoad())?.stamp !== record.stamp) return blocked // another generation of the journal
    if (reconcile) await atomicJson(LAUNCH_FILE, { ...m, pending: false, outcome: next.outcome, verifiedAt: Date.now() })
    return null
  } catch { return blocked }
}
async function probe(settings) {
  const device = new Device(settings)
  const state = { ok: false, reachable: false, authorized: false, problem: '', error: '', baseUrl: device.root, health: null, model: '', modelInstance: '', version: null, capabilities: null, paramGroups: [], enums: deriveEnums(null), at: Date.now(), launchable: null, launchCandidates: [], runningModels: [], pendingModels: [], busyModels: [], canLaunch: false, managementWarning: '' }
  if (!settings.apiKey) return withRecoveryStatus({ ...state, problem: 'no-key', error: 'Set your Tiiny device API key to check model readiness.' })
  const inventory = management(settings).catch(() => ({ managementWarning: 'Cannot verify the device model inventory and activity. Load models manually in TiinyOS.' }))
  try {
    const pin = await nativePin(device)
    state.model = pin.model; state.modelInstance = pin.modelInstance
    state.ok = state.authorized = state.reachable = true
    state.health = { status: 'ready' }
    const [caps, version] = await Promise.all([device.capabilities().catch(() => null), device.version().catch(() => null)])
    state.version = version; state.capabilities = caps; state.paramGroups = normalizeCapabilities(caps); state.enums = deriveEnums(caps)
  } catch (e) {
    state.reachable = Boolean(e.status)
    state.problem = [401, 403].includes(e.status) ? 'bad-key' : e.noModel || e.code === 'native_no_model' ? 'no-model'
      : e.status === 503 || e.code === 'native_not_ready' ? 'service-unavailable'
      : [404, 405].includes(e.status) ? 'base-url' : state.reachable ? 'error' : 'unreachable'
    state.authorized = state.problem === 'no-model'
    state.error = state.problem === 'no-model' ? 'No 3D model is running. Load an Image-to-3D model in TiinyOS.'
      : state.problem === 'service-unavailable' ? 'The 3D service is unavailable or not ready; its model state could not be verified. Check TiinyOS and refresh.'
      : state.problem === 'base-url' ? 'Check the 3D API Base URL (normally /v1).' : humanize(e)
  }
  Object.assign(state, await inventory)
  state.canLaunch = state.canLaunch && state.problem === 'no-model' && !state.launchCandidates.some(m => state.runningModels.includes(m.id) || ['running', 'loaded', 'loading', 'starting', 'pending'].includes(m.status))
  const selectable = state.launchCandidates.filter(c => c.status === 'downloaded')
  state.launchable = state.canLaunch && selectable.length === 1 ? selectable[0] : null
  return withRecoveryStatus(state)
}
async function withRecoveryStatus(state) {
  if (activeRunId || launchInProgress) Object.assign(state, { canLaunch: false, launchable: null })
  else {
    const reason = await checkAdmission({ reconcile: false })
    if (reason) Object.assign(state, { recoveryId: reason.id, recoveryMessage: reason.message, recoveryModel: reason.model,
      recoveryKind: reason.code === 'studio_recovery_task' ? 'task' : reason.code === 'studio_recovery_load' ? 'load' : undefined, canLaunch: false, launchable: null })
  }
  return state
}

// ---------------------------------------------------------------------------
// runs

function newStageRecord() {
  return { status: 'pending', progress: 0, taskId: '', ms: 0, file: '', path: '', bytes: 0, error: '', artifacts: [], cancelPending: false, cancelError: '', submissionUnknown: false }
}

/** Documented parameters; safe to send to any version of the 3D service. */
const ALWAYS_ALLOWED = new Set(['output_precision', 'inference_quality', 'asset_quality', 'seed'])

/** Map stage → advertised parameter names, or null when capabilities are unknown. */
function advertisedParams(capabilities) {
  if (!capabilities) return null
  const advertised = {}
  for (const group of normalizeCapabilities(capabilities)) {
    advertised[group.stage] = new Set(group.params.map((param) => param.name))
  }
  return advertised
}

/**
 * The device answers 400 for a parameter it does not advertise, so the preset
 * extras (step, guidance, texture_size, supersample, target_faces) are dropped
 * whenever the live capabilities do not list them.
 */
function filterParams(params, advertised) {
  const out = {}
  for (const [stage, values] of Object.entries(params)) {
    const names = advertised?.[stage]
    out[stage] = {}
    for (const [key, value] of Object.entries(values)) {
      if (ALWAYS_ALLOWED.has(key) || (names && names.has(key))) out[stage][key] = value
    }
    if (!Object.keys(out[stage]).length) delete out[stage]
  }
  return out
}

/**
 * One user-facing quality choice, expanded into the documented parameters.
 * `extras` carries per-stage overrides from the panel's advanced section.
 */
function buildStageParams(body, advertised) {
  const presetName = Object.hasOwn(QUALITY_PRESETS, body?.preset) ? body.preset : 'fast'
  const preset = QUALITY_PRESETS[presetName]
  const seed = Number.isFinite(body?.seed) ? Math.max(0, Math.round(body.seed)) : 42
  const params = {
    shape: {
      output_precision: preset.output_precision,
      inference_quality: preset.inference_quality,
      seed,
      step: preset.step,
      guidance_scale: preset.guidance_scale,
    },
    texture: { inference_quality: preset.inference_quality },
    export: { asset_quality: preset.asset_quality, texture_size: preset.texture_size, supersample: preset.supersample },
  }
  if (body?.options?.simplify === true) params.simplify = { asset_quality: preset.asset_quality, target_faces: SIMPLIFY_TARGET_FACES }
  const merge = (source) => {
    if (!source || typeof source !== 'object') return
    for (const stage of STAGE_IDS) {
      const values = source[stage]
      if (!values || typeof values !== 'object') continue
      params[stage] = { ...(params[stage] || {}), ...values }
    }
  }
  merge(body?.extras)
  merge(body?.params)
  return filterParams(params, advertised)
}

function buildPlan(options) {
  return ['shape', options.simplify ? 'simplify' : null, 'texture', 'export'].filter(Boolean)
}

function createRun({ image, options, params }) {
  const id = randomUUID().slice(0, 8)
  const run = {
    id,
    createdAt: Date.now(),
    finishedAt: 0,
    status: 'running',
    phase: 'starting',
    progress: 0,
    cancelRequested: false,
    skipSettle: false,
    paused: false,
    image: { name: image.name, bytes: image.bytes, file: '', mime: image.mime },
    options: { ...options },
    params: { ...params },
    plan: buildPlan(options),
    stages: Object.fromEntries(STAGE_IDS.map((stage) => [stage, newStageRecord()])),
    log: [],
    final: null,
    error: '',
  }
  run.workspace = path.join(RUNS_DIR, id)
  return run
}

function log(run, text, level = 'info') {
  run.log.push({ t: Date.now(), level, text })
  if (run.log.length > 400) run.log.splice(0, run.log.length - 400)
}

function computeProgress(run) {
  const total = STAGES.filter((stage) => run.plan.includes(stage.id)).reduce((sum, stage) => sum + stage.weight, 0) || 1
  let done = 0
  for (const stage of STAGES) {
    if (!run.plan.includes(stage.id)) continue
    const record = run.stages[stage.id]
    const ratio = record.status === 'completed' ? 1 : record.status === 'running' ? clamp(record.progress, 0, 99) / 100 : 0
    done += stage.weight * ratio
  }
  run.progress = Math.round((done / total) * 100)
  return run.progress
}

function unresolvedDeviceTask(run) {
  return Object.values(run.stages || {}).find((stage) => stage.cancelPending)
}

function cancellationState(run) {
  if (Object.values(run.stages || {}).some((stage) => stage.cancelPending)) return 'pending'
  if (run.cancelRequested && run.status === 'running') return 'requested'
  return run.status === 'cancelled' ? 'confirmed' : ''
}

const terminalStates = new Set(['completed', 'cancelled', 'error'])
function requiresRecovery(run, stage) {
  if (run.idleAcknowledged) return false
  // Older builds left phase='submitting' on definitive failed rejections; a terminal,
  // finished legacy run with no unknown/cancel marker is not an active device transfer.
  return stage && (stage.submissionUnknown || stage.cancelPending || (stage.phase === 'submitting' && !stage.taskId && (stage.status === 'running' || run.status === 'running')) ||
    (stage.taskId && !terminalStates.has(stage.deviceStatus) && (stage.status === 'running' || stage.reconcilePending || run.status === 'running')))
}
async function savedRuns() {
  let entries
  try { entries = await fs.readdir(RUNS_DIR, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return []; throw e }
  return entries.filter(e => e.isDirectory() && runIdOf(e.name)).map(e => e.name)
}
// reconcile=true is an admission transaction: the caller already holds the Studio gate.
// Inspection uses reconcile=false, never writes/ACKs any journal, and does not cache its verdict.
async function checkAdmission({ reconcile = true } = {}) {
  // The deployed Studio gate exposes its lease; an accidental unguarded caller only inspects.
  if (gate.snapshot && !gate.snapshot().busy) reconcile = false
  const busy = () => ({ code: 'device_busy', message: 'A 3D pipeline, cancellation, or model load is still in progress. Wait for verified device termination.' })
  if (activeRunId || launchInProgress || disposed) return busy()
  let load
  try { load = await readLoad() } catch { return recoveryReason('load', null, 'Cannot verify the saved 3D model-load journal.') }
  try {
    // In particular, resolving a *load* must never ACK or bypass a separate cancelled/unknown task.
    for (const id of await savedRuns()) {
      const file = path.join(RUNS_DIR, id, 'run.json'), saved = await jsonFile(file, null)
      if (!saved || saved.idleAcknowledged) continue
      let changed = false
      for (const record of Object.values(saved.stages || {})) {
        if (!requiresRecovery(saved, record)) continue
        const why = `Run ${id}: ${record.cancelPending ? 'unconfirmed cancellation' : 'unverified task outcome'}${record.taskId ? ' for ' + record.taskId : ' (no confirmed task ID)'}.`
        const setRecovery = (id, message) => recoveryReason('task', id, message, cleanId(saved.pin?.model))
        if (!reconcile || !record.taskId || !saved.pin?.baseUrl) return setRecovery(id, why)
        const settings = await readSettings()
        if (settings.baseUrl !== saved.pin.baseUrl || !settings.apiKey) return setRecovery(id, why + ' Restore the original device connection first.')
        const device = new Device(settings)
        try {
          await verifyPin(device, saved.pin)
          // Unlike a cancel ACK, a stable terminal status in the original instance is evidence of termination.
          const start = Date.now(); let key = '', count = 0
          do {
            const t = await device.task(record.taskId), current = JSON.stringify([t?.status, t?.updated_at, t?.progress])
            if (!terminalStates.has(t?.status) || (count && current !== key)) return setRecovery(id, why)
            key = current; count++
            if (!record.cancelPending || (count >= 3 && Date.now() - start >= CANCEL_CONFIRM_MS)) {
              Object.assign(record, { status: t.status === 'error' ? 'failed' : t.status, deviceStatus: t.status, phase: t.status, cancelPending: false, submissionUnknown: false, reconcilePending: false })
              changed = true; break
            }
            await sleep(POLL_MS)
          } while (!disposed)
          if (disposed) return setRecovery(id, why)
        } catch { return setRecovery(id, why) }
      }
      if (changed) {
        saved.status = saved.cancelRequested ? 'cancelled' : 'failed'; saved.phase = 'interrupted'; saved.finishedAt = Date.now()
        await atomicJson(file, saved)
      }
    }
    if (activeRunId || launchInProgress || disposed) return busy()
    return load?.marker?.pending ? await checkSavedLoad(load, reconcile) : null
  } catch { return recoveryReason('task', null, 'Cannot verify saved 3D task state. Check the 3D data folder before submitting more work.') }
}
async function checkUnresolved(options) { return (await checkAdmission(options))?.message || '' }
const saveQueue = new Map()
async function saveRun(run) {
  const value = serializeRun(run, true)
  // Snapshot now; callers can change task/ownership fields before an earlier write reaches disk.
  const snapshot = structuredClone(value)
  const pending = (saveQueue.get(run.id) || Promise.resolve()).catch(() => {}).then(() => atomicJson(path.join(run.workspace, 'run.json'), snapshot))
  saveQueue.set(run.id, pending)
  try { await pending } finally { if (saveQueue.get(run.id) === pending) saveQueue.delete(run.id) }
}
function serializeRun(run, withLog = true) {
  return {
    id: run.id, pin: run.pin, imageAssetId: run.imageAssetId || '', idleAcknowledged: run.idleAcknowledged || false,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    status: run.status,
    phase: run.phase,
    progress: run.progress,
    cancelRequested: run.cancelRequested,
    cancelState: cancellationState(run),
    image: { name: run.image.name, bytes: run.image.bytes, file: run.image.file, mime: run.image.mime },
    options: run.options,
    params: run.params,
    plan: run.plan,
    stages: run.stages,
    final: run.final,
    deletedExport: run.deletedExport || undefined,
    error: run.error,
    outputDir: run.outputDir || '',
    log: withLog ? run.log : run.log.slice(-40),
  }
}

async function recordHistory(run) {
  try {
    const entry = {
      id: run.id,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt || Date.now(),
      status: run.status,
      error: run.error,
      image: run.image.name,
      final: run.final ? { ...run.final } : null,
      deletedExport: run.deletedExport || undefined,
      outputDir: run.outputDir,
      options: run.options,
      params: run.params,
      progress: run.progress,
    }
    const history = await readHistory()
    const next = [entry, ...history.filter((item) => item && item.id !== entry.id)].slice(0, 40)
    await atomicJson(HISTORY_FILE, next)
  } catch {
    // Never replace an unreadable old index with a single new run. The project itself is already saved.
    log(run, 'The project was saved, but its history index could not be updated. The previous index was preserved.', 'warn')
  }
}

async function stageFiles(run, stageId) {
  const ws = run.workspace
  const file = async (name, mime) => {
    const target = path.join(ws, name)
    const bytes = await fs.readFile(target)
    return { bytes, name, mime }
  }
  switch (stageId) {
    case 'shape':
      return { image: await file(run.image.file, run.image.mime) }
    case 'simplify':
      return { mesh: await file(run.stages.shape.file, 'model/gltf-binary') }
    case 'texture': {
      const mesh = run.stages.simplify.status === 'completed' ? run.stages.simplify.file : run.stages.shape.file
      return { image: await file(run.image.file, run.image.mime), mesh: await file(mesh, 'model/gltf-binary') }
    }
    case 'export':
      return { material: await file(run.stages.texture.file, 'application/zip') }
    default:
      throw new Error(`Unknown stage: ${stageId}`)
  }
}

function stageParams(run, stageId) {
  const source = run.params[stageId] || {}
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null || value === '') continue
    out[key] = value
  }
  return out
}

/**
 * Poll one stage task.
 *
 * Two device behaviours make a naive loop wrong:
 *  - a status query can block behind inference for minutes, so one timeout must
 *    be retried instead of failing a 30-minute stage;
 *  - `waiting_for_device_reset` usually clears without a reboot, so resume the
 *    task a few times before handing the decision back to the user.
 */
async function pollTask(run, device, stageId, taskId) {
  const record = run.stages[stageId]
  const deadline = Date.now() + 45 * 60 * 1000
  let pollFailures = 0
  let resumeAttempts = 0
  let lastProgress = -1
  let nextCancelAt = 0
  let terminal = null
  // An unconfirmed cancellation must retain ownership even after the normal
  // inference deadline. Query/control failures are not evidence of termination.
  while (Date.now() < deadline || run.cancelRequested) {
    if (disposed) throw new Error('Studio was closed before the device task reached a verified terminal status.')
    if (run.cancelRequested) {
      record.cancelPending = true
      record.resumeRequested = false
      record.phase = 'cancelling'
      run.phase = `${stageId}:cancelling`
      await saveRun(run)
      if (Date.now() >= nextCancelAt && !terminal) {
        nextCancelAt = Date.now() + CANCEL_RETRY_MS
        try {
          await device.control(taskId, 'cancel', run.pin, () => run.cancelRequested)
          record.cancelError = ''
          log(run, `${stageId}: Cancel request acknowledged; waiting for stable terminal task status`, 'warn')
        } catch (error) {
          record.cancelError = humanize(error)
          log(run, `${stageId}: Cancel request failed: ${record.cancelError}. Cancellation is still pending; new submissions remain blocked.`, 'warn')
        }
        await saveRun(run)
      }
    } else if (record.resumeRequested) {
      record.resumeRequested = false
      await device.control(taskId, 'resume', run.pin, () => !run.cancelRequested).catch(() => {})
      log(run, `${stageId}: Resume requested`)
    }

    let snapshot = null
    try {
      snapshot = await device.task(taskId)
      pollFailures = 0
    } catch (error) {
      terminal = null
      // During cancellation even a missing task cannot prove its worker stopped.
      if (!run.cancelRequested && error instanceof DeviceError && (error.status === 404 || error.status === 410)) throw error
      pollFailures += 1
      const detail = describeFetchError(error)
      record.phase = run.cancelRequested ? 'cancelling' : 'poll-retry'
      log(run, `${stageId}: Failed to query task status (attempt ${pollFailures}): ${detail}. Retrying.`, 'warn')
      if (!run.cancelRequested && pollFailures >= 12) throw new Error(`Task status queries failed ${pollFailures} times in a row: ${detail}`)
      await sleep(Math.min(15000, POLL_MS * pollFailures), run.cancelRequested ? undefined : run)
      continue
    }

    const status = String(snapshot?.status || '')
    const progress = Number(snapshot?.progress)
    if (Number.isFinite(progress)) {
      record.progress = clamp(progress, 0, 100)
      if (progress > lastProgress) {
        lastProgress = progress
        resumeAttempts = 0
      }
    }
    record.deviceStatus = status
    record.phase = run.cancelRequested ? 'cancelling' : status
    run.phase = `${stageId}:${record.phase || 'running'}`

    if (run.cancelRequested) {
      record.cancelPending = true
      // Cancel responses and even the first GET may race with the worker. Any
      // live status, changed terminal snapshot or failed GET resets this window.
      const isTerminal = ['cancelled', 'completed', 'error'].includes(status)
      const key = JSON.stringify([status, snapshot?.progress, snapshot?.updated_at])
      if (isTerminal) {
        terminal = terminal?.key === key ? { ...terminal, count: terminal.count + 1 } : { key, since: Date.now(), count: 1 }
        if (terminal.count < 3 || Date.now() - terminal.since < CANCEL_CONFIRM_MS) {
          await saveRun(run)
          await sleep(POLL_MS)
          continue
        }
        record.cancelPending = false
        record.cancelError = ''
        log(run, `${stageId}: Device terminal status ${status} remained stable across ${terminal.count} queries`, 'info')
        await saveRun(run)
      } else {
        if (terminal) log(run, `${stageId}: Task returned to ${status || 'unknown'} after a terminal snapshot; cancellation remains pending`, 'warn')
        terminal = null
        computeProgress(run)
        await saveRun(run)
        await sleep(POLL_MS)
        continue
      }
    }

    if (status === 'completed') {
      record.waiting = false
      record.needsReset = false
      computeProgress(run)
      return snapshot
    }
    if (status === 'cancelled') throw new Error('cancelled')
    if (status === 'error') {
      const detail = snapshot?.error || snapshot?.message || 'The device reported that the task failed.'
      const code = snapshot?.error_code ? ` (${snapshot.error_code})` : ''
      throw new Error(`${detail}${code}`)
    }

    if (status === 'waiting_for_device_reset') {
      const deviceError = [snapshot?.error, snapshot?.message].filter(Boolean).join(' · ')
      record.waiting = true
      record.deviceError = deviceError
      if (resumeAttempts < 3) {
        resumeAttempts += 1
        log(run, `${stageId}: The device reported "${deviceError || 'reset required'}". Automatic resume attempt ${resumeAttempts}.`, 'warn')
        await sleep(resumeAttempts === 1 ? 1500 : 8000, run)
        if (run.cancelRequested) continue
        try {
          await device.control(taskId, 'resume', run.pin, () => !run.cancelRequested)
        } catch (error) {
          log(run, `${stageId}: Resume failed: ${humanize(error)}`, 'warn')
        }
      } else {
        // Stop hammering the device: the user has to reset it, then can resume.
        if (!record.needsReset) {
          record.needsReset = true
          log(run, `${stageId}: Automatic resume did not resolve the issue. Reset the device, then click "Resume task".`, 'error')
        }
      }
      computeProgress(run)
      await sleep(POLL_MS, run)
      continue
    }

    record.waiting = false
    record.needsReset = false
    record.deviceError = ''
    computeProgress(run)
    await sleep(POLL_MS, run)
  }
  throw new Error('The task timed out after 45 minutes.')
}

async function collectArtifacts(run, device, stageId, taskId, snapshot) {
  const record = run.stages[stageId]
  const artifacts = snapshot?.result?.output?.artifacts || []
  const saved = []
  for (const artifact of artifacts) {
    const artifactId = artifact.artifact_id || artifact.id
    if (!artifactId) continue
    let name = safeName(artifact.filename || `${stageId}.bin`)
    if (!fileNameOf(name) || name.startsWith('.') || /^(?:run\.json|source\.)/i.test(name)) name = `${stageId}-${saved.length}.bin`
    const { bytes, mime } = await device.artifact(taskId, artifactId)
    const target = path.join(run.workspace, name)
    await fs.writeFile(target, bytes)
    saved.push({ artifactId, name, bytes: bytes.length, mime: mime || artifact.mime_type || '', type: artifact.artifact_type || stageId })
    log(run, `${stageId}: Downloaded ${name} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`)
  }
  if (!saved.length) throw new Error('The task completed but returned no artifacts.')
  record.artifacts = saved
  return saved
}

function pickArtifact(saved, stageId) {
  const byName = (pattern) => saved.find((item) => pattern.test(item.name))
  if (stageId === 'export') return byName(/painted.*\.glb$/i) || byName(/\.glb$/i) || saved[saved.length - 1]
  if (stageId === 'texture') return byName(/\.zip$/i) || saved[0]
  if (stageId === 'simplify') return byName(/simplified.*\.glb$/i) || byName(/\.glb$/i) || saved[0]
  return byName(/shape.*\.glb$/i) || byName(/\.glb$/i) || saved[0]
}

/**
 * The device bakes its albedo in linear space and ships no normals; see glb.js.
 * A failure here must never lose the run: the untouched artifact stays on disk.
 */
async function polishExport(run, saved) {
  const target = path.join(run.workspace, saved.name)
  try {
    const before = await fs.readFile(target)
    const started = Date.now()
    const result = polishGlb(before)
    const applied = result.changes.filter((line) => !line.includes('skipped'))
    if (result.bytes !== before && applied.length) {
      await fs.writeFile(target, result.bytes)
      saved.bytes = result.bytes.length
      log(run, `export: Applied repairs: ${applied.join('; ')} (${Date.now() - started} ms)`, 'success')
    }
    for (const line of result.changes.filter((item) => item.includes('skipped'))) log(run, `export: ${line}`, 'warn')
  } catch (error) {
    log(run, `export: Repairs failed; keeping the original device file. ${String(error?.message || error)}`, 'warn')
  }
}

async function executeStage(run, device, stageId) {
  const record = run.stages[stageId]
  const started = Date.now()
  record.status = 'running'
  record.progress = 0
  record.error = ''
  record.taskId = ''
  record.cancelPending = false
  record.cancelError = ''
  record.submissionUnknown = false
  record.needsReset = false
  record.waiting = false
  record.deviceError = ''
  run.phase = `${stageId}:submitting`
  computeProgress(run)
  log(run, `${stageId}: Submitting task`)
  try {
    record.phase = 'preparing'
    const files = await stageFiles(run, stageId)
    const params = stageParams(run, stageId)
    if (run.cancelRequested) throw new Error('cancelled')
    await verifyPin(device, run.pin)
    if (run.cancelRequested || disposed) throw new Error('cancelled')
    const submitStarted = Date.now()
    record.phase = 'submitting'
    await saveRun(run) // A crash from this point until the task ID arrives has an unknown outcome.
    const heartbeat = setInterval(() => {
      const waited = Math.round((Date.now() - submitStarted) / 1000)
      if (waited >= 45) log(run, `${stageId}: Waiting for the device to accept the task (${waited} s). Large meshes may need extra time to free memory.`)
    }, 30000)
    let taskId
    try {
      taskId = await device.submit(stageId, params, files)
    } finally {
      clearInterval(heartbeat)
    }
    const submitMs = Date.now() - submitStarted
    if (submitMs > 5000) log(run, `${stageId}: Device accepted the task after ${(submitMs / 1000).toFixed(1)} s`)
    record.taskId = taskId
    await saveRun(run)
    log(run, `${stageId}: task ${taskId}`)
    const snapshot = await pollTask(run, device, stageId, taskId)
    const saved = await collectArtifacts(run, device, stageId, taskId, snapshot)
    const artifact = pickArtifact(saved, stageId)
    if (stageId === 'export' && run.options.polish !== false && /\.glb$/i.test(artifact.name)) await polishExport(run, artifact)
    record.file = artifact.name
    record.path = path.join(run.workspace, artifact.name)
    record.bytes = artifact.bytes
    record.status = 'completed'
    record.progress = 100
    record.ms = Date.now() - started
    computeProgress(run)
    log(run, `${stageId}: Completed in ${(record.ms / 1000).toFixed(1)} s`, 'success')
    await saveRun(run)
    return record
  } catch (error) {
    const message = String(error?.message || error)
    if (error?.submissionUnknown) {
      record.submissionUnknown = true
      record.submissionError = { status: error.status, message, reportedTaskId: error.payload?.task_id || error.payload?.data?.task_id || '' }
      record.phase = 'submission-unknown'
    }
    // If submission was rejected or its outcome is unknown there is no known
    // task to confirm. Keep the unknown flag, not a fictitious cancel success.
    if (!record.taskId) {
      record.cancelPending = false
      if (!error?.submissionUnknown) record.phase = 'rejected'
    } else if (!terminalStates.has(record.deviceStatus)) record.reconcilePending = true
    if (message === 'cancelled') {
      record.status = 'cancelled'
      record.error = 'Cancelled'
      log(run, `${stageId}: Cancelled`, 'warn')
    } else {
      record.status = 'failed'
      record.error = humanize(error)
      log(run, `${stageId}: Failed: ${record.error}`, 'error')
    }
    record.ms = Date.now() - started
    computeProgress(run)
    await saveRun(run)
    throw error
  }
}

async function finishRun(run) {
  if (unresolvedDeviceTask(run)) {
    run.status = 'running'
    run.phase = 'cancelling'
    run.finishedAt = 0
    await saveRun(run)
    return
  }
  run.finishedAt = Date.now()
  // Cancellation is an intention, not proof of a terminal device state. Preserve
  // verified completion or failure when the cancel request arrived too late.
  if (run.status === 'running') run.status = 'completed'
  if (run.status === 'completed') {
    const exportStage = run.stages.export
    if (exportStage.status === 'completed' && exportStage.path) {
      try {
        const dir = run.outputDir || (await readSettings()).outputDir
        await fs.mkdir(dir, { recursive: true })
        const stem = `tiiny3d-${stamp()}-${run.id}`
        let name = `${stem}-painted.glb`, target = path.join(dir, name)
        try { await fs.copyFile(exportStage.path, target, fsFlags.COPYFILE_EXCL) } catch (e) {
          if (e.code !== 'EEXIST') throw e
          name = `${stem}-${randomUUID()}-painted.glb`; target = path.join(dir, name)
          await fs.copyFile(exportStage.path, target, fsFlags.COPYFILE_EXCL)
        }
        const stat = await fs.lstat(target, { bigint: true })
        run.final = { file: name, path: target, bytes: Number(stat.size), owner: fileVersion(stat) }
        run.deletedExport = null
        log(run, `Saved the final model to ${target}`, 'success')
      } catch (error) {
        log(run, `Failed to copy the final model: ${String(error?.message || error)}`, 'warn')
      }
    }
  }
  computeProgress(run)
  run.phase = run.status
  await saveRun(run)
  await recordHistory(run)
}

async function runPipeline(run, device) {
  try {
    for (const stageId of run.plan) {
      if (run.cancelRequested) throw new Error('cancelled')
      if (stageId === 'export' && run.options.settleDelay > 0 && !run.skipSettle) {
        const waitMs = run.options.settleDelay * 1000
        log(run, `Waiting ${run.options.settleDelay} s for the device to free resources before export (you can skip this wait)`)
        run.phase = 'settle'
        const outcome = await sleep(waitMs, run, true)
        if (outcome === 'cancelled') throw new Error('cancelled')
      }
      await executeStage(run, device, stageId)
    }
    run.status = 'completed'
  } catch (error) {
    if (String(error?.message) === 'cancelled') {
      run.status = 'cancelled'
      run.error = 'Cancelled'
    } else {
      run.status = 'failed'
      run.error = humanize(error)
    }
  } finally {
    try {
      await finishRun(run)
    } catch (error) {
      run.status = 'failed'
      run.error = humanize(error)
    }
  }
}

async function prepareImage(run, image, mime) {
  await fs.mkdir(run.workspace, { recursive: true, mode: 0o700 })
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime]
  if (!ext) throw problem(400, 'invalid_image', 'Choose a PNG, JPEG or WebP image.')
  const file = `source.${ext}`
  await fs.writeFile(path.join(run.workspace, file), image.bytes)
  run.image.file = file
  return { ext, mime }
}

// ---------------------------------------------------------------------------
// history + artifacts listing

async function readHistory() {
  const rows = await jsonFile(HISTORY_FILE, [])
  if (!Array.isArray(rows)) throw new Error('The 3D history index is invalid; the original file was preserved.')
  return rows
}

async function writeHistory(entries) {
  await atomicJson(HISTORY_FILE, entries)
}

function isRunRunning(id) {
  return activeRunId === id || runs.get(id)?.status === 'running'
}

// Destructive operations accept only a Studio project ID. Never recursively delete a
// directory or accept a client-supplied file path. Validate every file before unlinking any.
const unsafeFile = message => problem(409, 'unsafe_file', message || 'Studio cannot prove this file belongs to this project. No unverified file was removed.')
const fileVersion = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':')
const folded = file => file.normalize('NFC').toLowerCase()
const inside = (file, dir) => folded(file) === folded(dir) || folded(file).startsWith(folded(dir) + path.sep)
function canonicalSpelling(file) {
  // darwin publishes /var and /tmp as OS aliases; do not grant the same exception to user symlinks.
  return process.platform === 'darwin' ? file.replace(/^\/(var|tmp)(?=\/|$)/, '/private/$1') : file
}
async function localStat(file) {
  try { return await fs.lstat(file, { bigint: true }) } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
async function genuineDir(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || path.resolve(dir) !== dir) throw unsafeFile()
  const stat = await localStat(dir)
  if (!stat) { if (dir !== path.dirname(dir)) await genuineDir(path.dirname(dir)); return false }
  if (!stat.isDirectory() || await fs.realpath(dir) !== canonicalSpelling(dir)) throw unsafeFile('Studio will not change files through a symlink or an unverified directory.')
  return true
}
async function ordinaryFile(file) {
  await genuineDir(path.dirname(file))
  const stat = await localStat(file)
  if (stat && (!stat.isFile() || stat.nlink !== 1n)) throw unsafeFile('Studio will not change a directory, linked file, or shared file.')
  return stat
}
async function unlinkVersion(file, version) {
  const now = await ordinaryFile(file)
  if (!now) return false
  if (fileVersion(now) !== version) throw unsafeFile('A file changed during this operation. Refresh before trying again.')
  await fs.unlink(file); return true
}
async function readProject(id) {
  const dir = path.join(RUNS_DIR, id), journal = path.join(dir, 'run.json')
  if (!await genuineDir(dir)) return { id, dir, journal, saved: null }
  if (!await ordinaryFile(journal)) throw unsafeFile('The project journal is missing. Its workspace was kept.')
  const saved = await jsonFile(journal, null)
  if (!saved || saved.id !== id || !saved.stages || typeof saved.stages !== 'object' || Array.isArray(saved.stages)) throw unsafeFile('The project journal is incomplete or belongs to another project. Its files were kept.')
  return { id, dir, journal, saved }
}
function guardRun(id, record) {
  if (isRunRunning(id) || (record && (!['completed','failed','cancelled'].includes(record.status) || Object.values(record.stages || {}).some(stage => requiresRecovery(record, stage) || (!record.idleAcknowledged && (stage?.status === 'running' || stage?.reconcilePending)))))) {
    throw problem(409, 'run_active', 'An active or unconfirmed 3D task may still need these files. Its project and evidence were kept.')
  }
}
async function workspaceFiles({dir, saved}) {
  if (!saved) return []
  const allowed = new Set(['run.json'])
  const input = saved.image?.file
  if (input && /^source\.(png|jpg|jpeg|webp)$/i.test(input)) allowed.add(input) // private copy only
  for (const stage of Object.values(saved.stages)) {
    for (const name of [stage?.file, ...(stage?.artifacts || []).map(a => a?.name)].filter(Boolean)) {
      if (!fileNameOf(name) || name.startsWith('.') || /^(run\.json|source\.)/i.test(name)) throw unsafeFile()
      allowed.add(name)
    }
  }
  const files = []
  for (const name of await fs.readdir(dir)) {
    if (!allowed.has(name)) throw unsafeFile('This workspace contains an unrecognized file or folder. Studio kept the project rather than deleting it.')
    const file = path.join(dir, name), stat = await ordinaryFile(file)
    if (stat) files.push({ file, version: fileVersion(stat) })
  }
  // Keep original task evidence until all non-journal entries are gone.
  return files.sort((a, b) => Number(a.file.endsWith('/run.json')) - Number(b.file.endsWith('/run.json')))
}
function finalPath(final) {
  if (!final || !fileNameOf(final.file) || !/\.glb$/i.test(final.file) || typeof final.path !== 'string' || !path.isAbsolute(final.path) || path.resolve(final.path) !== final.path || path.basename(final.path) !== final.file) throw unsafeFile()
  return final.path
}
async function digestFile(file, stat) {
  const stream = createReadStream(file, { flags: fsFlags.O_RDONLY | fsFlags.O_NOFOLLOW }), hash = createHash('sha256')
  for await (const chunk of stream) hash.update(chunk)
  const after = await ordinaryFile(file)
  if (!after || fileVersion(after) !== fileVersion(stat)) throw unsafeFile('The export changed while Studio verified it.')
  return hash.digest('hex')
}
async function ownedExport(project, entry) {
  const { saved, dir } = project, final = saved ? saved.final : entry?.final
  if (saved && !saved.final && saved.deletedExport?.file && saved.deletedExport.file === entry?.final?.file) return null // repair an interrupted index update, never unlink again
  if (saved && entry && (saved.final?.path !== entry.final?.path || saved.final?.file !== entry.final?.file)) throw unsafeFile('The history entry and project disagree about the export. Refresh or inspect the files; nothing was guessed.')
  if (!final) return null
  const file = finalPath(final), folder = path.dirname(file)
  if (inside(canonicalSpelling(file), canonicalSpelling(RUNS_DIR))) throw unsafeFile('An external export cannot be a project workspace file.')
  const stat = await ordinaryFile(file)
  if (!stat) return { file, missing: true }
  if (folder !== (saved?.outputDir || entry?.outputDir) || stat.size !== BigInt(Number.isSafeInteger(final.bytes) ? final.bytes : -1)) throw unsafeFile('The recorded output folder or file size does not match. The file was kept.')
  const version = fileVersion(stat)
  if (final.owner) {
    if (version !== final.owner || (entry?.final?.owner && entry.final.owner !== final.owner)) throw unsafeFile('The exported file was replaced or modified outside Studio. The current file was kept.')
  } else {
    // Older journals predate file identity stamps. Match the exact private stage copy instead of trusting a path alone.
    const stage = saved?.stages?.export
    if (stage?.status !== 'completed' || !fileNameOf(stage.file) || !/\.glb$/i.test(stage.file) || (stage.path && stage.path !== path.join(dir, stage.file))) throw unsafeFile('This older project has no verifiable export copy. Delete the project with the exported file kept, or manage the file yourself.')
    const source = path.join(dir, stage.file), origin = await ordinaryFile(source)
    if (!origin || origin.size !== stat.size || await digestFile(source, origin) !== await digestFile(file, stat)) throw unsafeFile('The external file no longer matches this project’s exported GLB. The file was kept.')
  }
  return { file, version }
}
async function checkOtherOwners(project, history, exportFile, checkWorkspace) {
  const {id, dir} = project
  const check = async record => {
    if (!record || record.id === id) return
    const paths = [record.final?.path, record.image?.path, ...Object.values(record.stages || {}).flatMap(s => [s?.path, ...(s?.artifacts || []).map(a => a?.path)])]
    for (const p of paths) {
      if (typeof p !== 'string' || !path.isAbsolute(p)) continue
      const real = await fs.realpath(p).catch(e => { if (e.code === 'ENOENT') return ''; throw e })
      if ([real,canonicalSpelling(path.resolve(p))].some(normalized => (exportFile && folded(normalized) === folded(canonicalSpelling(exportFile))) || (checkWorkspace && inside(normalized, canonicalSpelling(dir))))) throw problem(409, 'file_shared', 'Another project references this file. The shared file was kept.')
    }
  }
  for (const entry of history) await check(entry)
  for (const row of await savedExports()) if (row.project !== id) await check({id:row.id, final:row})
  for (const other of await savedRuns()) if (other !== id) await check((await readProject(other)).saved)
}
async function savedExports() {
  await ordinaryFile(EXPORTS_FILE)
  const rows = await jsonFile(EXPORTS_FILE, [])
  if (!Array.isArray(rows) || rows.some(r => !r || !/^export-[a-f\d-]{36}$/.test(r.id)) || new Set(rows.map(r => r.id)).size !== rows.length) throw unsafeFile('The saved GLB index could not be verified. Its records were kept.')
  return rows
}
async function detachedView(row) {
  const { id, file, path: location, bytes } = row, view = { id, file, path: location, bytes }
  try {
    const stat = await ordinaryFile(finalPath(row))
    const state = !stat ? 'missing' : !row.owner ? 'unverified' : row.owner !== fileVersion(stat) ? 'changed' : 'available'
    return { ...view, state }
  } catch { return { ...view, state: 'unverified' } }
}
async function preserveExport(project, entry, final) {
  if (!final) return null
  const file = finalPath(final), rows = await savedExports()
  const previous = rows.find(r => r.project === project.id && r.path === file)
  if (previous) return previous
  let checked
  try { checked = await ownedExport(project, entry) } catch (e) { if (e.code !== 'unsafe_file') throw e }
  // Unverified legacy files can be found by their recorded path but cannot be downloaded or deleted through the index.
  const row = { id:`export-${randomUUID()}`, project:project.id, file:final.file, path:file, bytes:final.bytes, owner:checked?.version || null }
  await atomicJson(EXPORTS_FILE, [...rows, row]); return row
}
async function removeDetached(body, row, rows, history) {
  if (body.expectedFile !== undefined && body.expectedFile !== row.file) throw problem(409, 'file_changed', 'The selected exported file changed. Refresh and select it again.')
  let removed = false, missing = false
  if (!body.forgetOnly) {
    const view = await detachedView(row)
    if (view.state === 'available') {
      await checkOtherOwners({ id:row.id, dir:'' }, history, finalPath(row), false)
      removed = await unlinkVersion(row.path, row.owner); missing = !removed
    } else if (view.state === 'missing') missing = true
    else throw unsafeFile('Studio cannot verify this original GLB. Its replacement was kept. Use Forget listing to remove only the entry.')
  }
  await atomicJson(EXPORTS_FILE, rows.filter(r => r.id !== row.id))
  return { id:row.id, removed:{workspace:false, final:removed}, missing, forgotten:true }
}
async function removeProjectData(body, projectOnly) {
  const id = runIdOf(body.id)
  if (!id || id !== body.id || Object.keys(body).some(k => !['id', 'expectedFile', projectOnly ? 'removeExport' : 'forgetOnly'].includes(k)) || ('expectedFile' in body && !fileNameOf(body.expectedFile)) || ['removeExport','forgetOnly'].some(k => k in body && typeof body[k] !== 'boolean')) throw problem(400, 'invalid_delete', 'Supply an exact ID, optional expected file name, and only the options for this operation. Do not supply paths.')
  await ordinaryFile(HISTORY_FILE)
  const history = await readHistory(), rows = history.filter(r => r?.id === id)
  if (rows.length > 1) throw unsafeFile('More than one history entry has this project ID. The records were kept.')
  const entry = rows[0], current = runs.get(id)
  guardRun(id, entry); guardRun(id, current)
  const project = await readProject(id), {saved, dir, journal} = project
  if (!entry && !saved) {
    if (!projectOnly) { const detached = await savedExports(), row = detached.find(r => r.id === id); if (row) return removeDetached(body, row, detached, history) }
    throw problem(404, 'missing_run', 'Project or saved export not found.')
  }
  if (body.forgetOnly) throw problem(400, 'invalid_delete', 'Forget listing is only available for detached exports.')
  if (body.expectedFile !== undefined && body.expectedFile !== (saved?.final || entry?.final)?.file) throw problem(409, 'file_changed', 'The selected exported file changed. Refresh and select it again.')
  guardRun(id, saved)
  const files = projectOnly ? await workspaceFiles(project) : []
  const exportInfo = (!projectOnly || body.removeExport === true) ? await ownedExport(project, entry) : null
  const final = saved?.final || entry?.final
  if (projectOnly && !body.removeExport && final?.path && inside(canonicalSpelling(path.resolve(final.path)), canonicalSpelling(dir))) throw unsafeFile('The export is inside this workspace and cannot be kept at its original path. The project was kept.')
  if (files.length || exportInfo?.version) await checkOtherOwners(project, history, exportInfo?.file, projectOnly)
  const removed = { workspace: false, final: false }
  if (exportInfo?.version) removed.final = await unlinkVersion(exportInfo.file, exportInfo.version)
  if (projectOnly) {
    const kept = !body.removeExport && final ? await preserveExport(project, entry, final) : null
    if (saved) {
      for (const {file, version} of files) await unlinkVersion(file, version)
      await genuineDir(dir); await fs.rmdir(dir); removed.workspace = true
    }
    if (entry) await writeHistory(history.filter(row => row.id !== id))
    runs.delete(id)
    return { id, removed, keptExport: kept?.path || null, keptExportId: kept?.id || null, missing: Boolean(exportInfo?.missing) }
  }
  const deletedExport = final ? { file: final.file, at: Date.now() } : saved?.deletedExport || entry?.deletedExport || null
  if (final) {
    if (saved) await atomicJson(journal, { ...saved, final: null, deletedExport })
    if (current) Object.assign(current, { final: null, deletedExport })
    if (entry) { Object.assign(entry, { final: null, deletedExport }); await writeHistory(history) }
  }
  return { id, removed, final: null, deletedExport, missing: !removed.final }
}

// GET exposes absence/unavailability without erasing a historical reference. Stage copies have their own distinct URLs.
async function projectView(record) {
  if (!record?.final) return record
  try {
    const file = finalPath(record.final), stat = await ordinaryFile(file)
    if (stat && (!record.final.owner || record.final.owner === fileVersion(stat))) return record
    return { ...record, final: null, finalUrl: '', unavailableExport: { file: record.final.file, state: stat ? 'changed' : 'missing' } }
  } catch { return { ...record, final: null, finalUrl: '', unavailableExport: { file: record.final.file, state: 'unverified' } } }
}
async function fileEntry(ws, name, type) {
  try {
    const target = path.join(ws, name)
    const stat = await fs.stat(target)
    return { name, type, bytes: stat.size, mtime: stat.mtimeMs }
  } catch {
    return null
  }
}

async function listRunArtifacts(run) {
  const out = []
  for (const stage of STAGES) {
    const record = run.stages[stage.id]
    for (const artifact of record.artifacts || []) {
      out.push({ stage: stage.id, name: artifact.name, bytes: artifact.bytes, mime: artifact.mime, type: artifact.type })
    }
  }
  if (run.final) out.push({ stage: 'final', name: run.final.file, bytes: run.final.bytes, mime: 'model/gltf-binary', type: 'final', path: run.final.path })
  return out
}

function runView(run) {
  return {
    ...serializeRun(run, true),
    artifacts: undefined,
    outputDir: run.outputDir || '',
    stages: Object.fromEntries(
      STAGE_IDS.map((stage) => [
        stage,
        {
          ...run.stages[stage],
          url:
            run.stages[stage].status === 'completed' && run.stages[stage].file
              ? `/tiiny-video/3d/file?run=${encodeURIComponent(run.id)}&name=${encodeURIComponent(run.stages[stage].file)}&scope=stage&rev=${encodeURIComponent(run.stages[stage].taskId || run.finishedAt || run.createdAt)}`
              : '',
        },
      ]),
    ),
    imageUrl: run.image.file ? `/tiiny-video/3d/file?run=${encodeURIComponent(run.id)}&name=${encodeURIComponent(run.image.file)}` : '',
    finalUrl: run.final ? `/tiiny-video/3d/file?run=${encodeURIComponent(run.id)}&name=${encodeURIComponent(run.final.file)}&scope=export&rev=${encodeURIComponent(run.stages.export.taskId || run.finishedAt || run.createdAt)}` : '',
  }
}

// ---------------------------------------------------------------------------
// route

async function serveFile(res, filePath, version) {
    const handle = await fs.open(filePath, fsFlags.O_RDONLY | fsFlags.O_NOFOLLOW)
    const stat = await handle.stat({bigint:true})
    if (fileVersion(stat) !== version || !stat.isFile()) { await handle.close(); throw unsafeFile('The file changed. Refresh before downloading.') }
    const ext = path.extname(filePath).toLowerCase()
    const types = {
      '.glb': 'model/gltf-binary',
      '.gltf': 'model/gltf+json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.zip': 'application/zip',
      '.json': 'application/json',
      '.md': 'text/markdown; charset=utf-8',
    }
    const name = path.basename(filePath)
    const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download'
    const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    res.writeHead(200, {
      'content-type': types[ext] || 'application/octet-stream',
      'content-length': Number(stat.size),
      'cache-control': 'private, no-store',
      'content-disposition': `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`,
    })
    handle.createReadStream().on('error', e => res.destroy?.(e)).pipe(res)
}

async function activeBlock() {
  const reason = await checkAdmission()
  if (reason) throw Object.assign(problem(409, reason.code, reason.message), { model: reason.model })
}
function runWithLease(run, device, execute, release) {
  run.device = device
  void execute().catch(e => { run.error = humanize(e) }).finally(async () => {
    run.closing = true
    await Promise.allSettled([...(run.controls || [])])
    // Ambiguous device outcomes remain journalled for BOTH callers' next submission check.
    if (activeRunId === run.id) activeRunId = null
    delete run.device
    release()
  })
}
async function launchModel(body) {
  if (body.confirm !== true || !cleanId(body.modelId)) throw problem(400, 'confirmation_required', 'Select an exact installed 3D model and explicitly confirm its load.')
  const settings = await readSettings()
  if (!settings.apiKey) throw problem(400, 'no_key', 'Configure a Tiiny API key first.')
  await activeBlock()
  const inventory = await management(settings).catch(() => { throw problem(409, 'management_unavailable', 'Cannot verify installed and running models. Use TiinyOS; no model was changed.') })
  const models = inventory.launchCandidates.filter(m => m.id === body.modelId)
  if (models.length !== 1) throw problem(400, 'invalid_3d', 'Choose the exact ID of a downloaded Image-to-3D model on this device.')
  const [model] = models
  if (inventory.runningModels.includes(model.id)) throw problem(409, 'already_loaded', 'This model is already loaded. Refresh 3D readiness. No launch was sent.')
  if (model.status !== 'downloaded') throw problem(409, 'not_downloaded', `Model status is ${model.status || 'unknown'}. Finish downloading in TiinyOS first.`)
  if (!inventory.verifiedIdle) throw problem(409, 'device_busy', inventory.managementWarning)
  const expected = body.expectedRunningModels
  if ((expected !== undefined && !Array.isArray(expected)) || inventory.runningModels.some(id => !expected?.includes(id))) throw problem(409, 'reconfirm_models', 'Running models have changed or were not confirmed. Refresh status and confirm the displayed models before loading.')
  const mediaReason = await checkMediaForLoad?.({ verifiedIdle: true, baseUrl: settings.baseUrl, origin: new URL(settings.baseUrl).origin, runningModels: inventory.runningModels })
  if (mediaReason) throw problem(409, 'device_busy', mediaReason)
  launchInProgress = true
  const marker = { id: `load-${randomUUID()}`, baseUrl: settings.baseUrl, modelId: model.id, createdAt: Date.now(), pending: true }
  await atomicJson(LAUNCH_FILE, marker)
  try {
    await modelStore(settings, encodeURIComponent(model.id) + '/launch', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model_id: model.id }),
    })
  } catch (e) {
    if (e instanceof DeviceError && [400, 401, 403, 404, 405, 409, 422, 429].includes(e.status)) {
      await atomicJson(LAUNCH_FILE, { ...marker, pending: false }); throw e
    }
    throw problem(502, 'load_unknown', 'The device did not confirm the launch. No second request was made. Check TiinyOS before starting other work.')
  }
  const interval = Number(process.env.TIINY_3D_READY_POLL_MS) || 1500
  const until = Date.now() + Math.max(1000, Number(process.env.TIINY_3D_READY_TIMEOUT_MS) || 90000)
  do {
    if (disposed) break
    try {
      const [live, native] = await Promise.all([management(settings), nativeLoadSample(settings)])
      if (native?.pin && targetReady(live, model.id, native.pin)) {
        await atomicJson(LAUNCH_FILE, { ...marker, pending: false, outcome: 'ready', verifiedAt: Date.now() }); return { model: model.id, name: model.name, modelInstance: native.pin.modelInstance, ready: true }
      }
    } catch { /* The model may not yet have registered its native routes. */ }
    await sleep(Math.max(10, interval))
  } while (Date.now() < until)
  throw problem(409, 'load_unconfirmed', 'The device has not confirmed 3D readiness. Check TiinyOS, then refresh Studio; no launch was retried.')
}
async function acknowledgeIdle(body) {
  if (body.confirm !== true || !runIdOf(body.id)) throw problem(400, 'confirmation_required', 'Verify the device is idle in TiinyOS before confirming.')
  const recovery = await checkAdmission({ reconcile: false })
  if (activeRunId || recovery?.id !== body.id) throw problem(409, 'not_recoverable', 'Only the currently reported unresolved operation can be acknowledged.')
  const settings = await readSettings()
  const activity = settings.apiKey && await management(settings).catch(() => null)
  if (activity && (activity.busyModels.length || activity.pendingModels.length)) throw problem(409, 'device_busy', 'TiinyOS still reports an active request or pending model load.')
  const load = await jsonFile(LAUNCH_FILE, null)
  if (load?.pending && load.id === body.id) await atomicJson(LAUNCH_FILE, { ...load, pending: false, acknowledgedAt: Date.now() })
  else {
    const file = path.join(RUNS_DIR, body.id, 'run.json'), run = await jsonFile(file, null)
    if (!run) throw problem(404, 'missing_run', 'Cannot locate the original 3D task evidence.')
    run.idleAcknowledged = true; if (run.status === 'running') { run.status = 'failed'; run.phase = 'interrupted'; run.finishedAt = Date.now() }
    await atomicJson(file, run); runs.delete(body.id)
  }
  return { acknowledged: true, id: body.id }
}

const route = {
  kind: 'prefix',
  path: prefix,
  auth: 'required',
  async handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname !== prefix && !url.pathname.startsWith(prefix + '/')) return json(res, 404, { error: 'Not found.' })
    const pathname = url.pathname.slice(prefix.length) || '/'
    const method = req.method || 'GET'
    let release
    try {
      if (disposed) throw problem(503, 'disposed', 'Studio has closed.')
      let body
      if (method === 'POST') {
        const contentType = String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
        if (contentType !== 'application/json') throw problem(415, 'invalid_type', 'Send an application/json request.')
        if (['/rename-run', '/delete-export', '/delete-project', '/delete-run', '/delete-failed'].includes(pathname)) release = gate.acquire('3d-library')
        else if (['/generate', '/stage', '/launch-model', '/acknowledge-idle'].includes(pathname)) release = gate.acquire(pathname === '/launch-model' ? '3d-load' : '3d')
        body = await readJsonBody(req, pathname === '/generate' ? 24 * 1024 * 1024 : 64 * 1024)
      }
      if (method === 'GET' && (pathname === '/' || pathname === '/settings')) {
        return json(res, 200, publicSettings(await readSettings()))
      }

      if (method === 'POST' && pathname === '/settings') {
        const patch = {}
        if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) patch.baseUrl = body.baseUrl.trim()
        if (typeof body.outputDir === 'string' && body.outputDir.trim()) patch.outputDir = body.outputDir.trim()
        if (typeof body.apiKey === 'string') patch.apiKey = body.apiKey.trim()
        if (Number.isFinite(body.settleDelay)) patch.settleDelay = body.settleDelay
        if (typeof body.simplify === 'boolean') patch.simplify = body.simplify
        if (typeof body.polish === 'boolean') patch.polish = body.polish
        const settings = await writeSettings(patch)
        return json(res, 200, publicSettings(settings))
      }

      if (method === 'POST' && (pathname === '/launch-model' || pathname === '/acknowledge-idle')) {
        if (pathname === '/acknowledge-idle') return json(res, 200, await acknowledgeIdle(body))
        try { return json(res, 200, await launchModel(body)) } finally { launchInProgress = false }
      }

      if (method === 'GET' && pathname === '/status') {
        const settings = await readSettings()
        return json(res, 200, await probe(settings))
      }

      if (method === 'POST' && pathname === '/rename-run') {
        const id = runIdOf(body.id), raw = typeof body.name === 'string' ? body.name.trim() : ''
        if (!id || id !== body.id || !fileNameOf(raw)) throw problem(400, 'invalid_name', 'Choose a project and a plain file name without path separators.')
        await ordinaryFile(HISTORY_FILE)
        const history = await readHistory(), entry = history.find(item => item?.id === id)
        if (!entry) throw problem(404, 'missing_run', 'Project not found.')
        const project = await readProject(id); guardRun(id, entry); guardRun(id, project.saved)
        const owned = await ownedExport(project, entry)
        if (!owned || owned.missing) throw problem(404, 'missing_export', 'The exported GLB is missing.')
        await checkOtherOwners(project, history, owned.file, false)
        const base = safeFileName(raw.toLowerCase().endsWith('.glb') ? raw : raw + '.glb')
        const target = path.join(path.dirname(owned.file), base)
        if (target !== owned.file) {
          if (await localStat(target)) throw problem(409, 'file_exists', 'A file with that name already exists.')
          const source = await ordinaryFile(owned.file)
          if (!source || fileVersion(source) !== owned.version) throw unsafeFile()
          // Atomic no-replace: never rename over an unrelated file that appeared after the check.
          try { await fs.link(owned.file, target) } catch(e) { if (e.code === 'EEXIST') throw problem(409, 'file_exists', 'A file with that name already exists.'); throw e }
          await fs.unlink(owned.file)
        }
        const stat = await ordinaryFile(target)
        const final = { ...entry.final, file: base, path: target, bytes: Number(stat.size), owner: fileVersion(stat) }
        if (project.saved) await atomicJson(project.journal, { ...project.saved, final })
        if (runs.has(id)) runs.get(id).final = final
        entry.final = final; await writeHistory(history)
        return json(res, 200, { id, final })
      }

      if (method === 'POST' && pathname === '/delete-failed') {
        const picks = body.projects
        if (Object.keys(body).length !== 1 || !Array.isArray(picks) || !picks.length || picks.length > 200 || picks.some(p => !p || typeof p.id !== 'string' || !runIdOf(p.id) || runIdOf(p.id) !== p.id || !['failed','cancelled'].includes(p.status) || !(p.finishedAt === null || Number.isFinite(p.finishedAt))) || new Set(picks.map(p=>p.id)).size !== picks.length) throw problem(400, 'invalid_delete', 'Review the exact failed or cancelled projects first. Bulk cleanup requires their IDs, statuses and finish times and always keeps exports.')
        const history = await readHistory(), removedIds = [], failures = []
        for (const pick of picks) {
          const entry = history.find(row=>row.id === pick.id)
          if (!entry || entry.status !== pick.status || (entry.finishedAt ?? null) !== pick.finishedAt) { failures.push({id:pick.id, code:'project_changed', error:'The reviewed project changed; it was not removed.'}); continue }
          try { await removeProjectData({ id: entry.id }, true); removedIds.push(entry.id) }
          catch (e) { failures.push({ id: entry.id, error: e.message, code: e.code }) }
        }
        return json(res, 200, { removed: removedIds.length, removedIds, failures, keptExports: true })
      }

      if (method === 'POST' && pathname === '/reveal-run') {
        const id = runIdOf(body.id)
        if (!id) return json(res, 400, { error: 'Invalid run ID.' })
        const history = await readHistory()
        const entry = history.find((item) => item.id === id)
        if (!entry?.final?.path) return json(res, 400, { error: 'This run has no final model file.' })
        const exists = await fs.stat(entry.final.path).then(() => true).catch(() => false)
        if (!exists) return json(res, 404, { error: 'The final model file no longer exists.' })
        if (process.platform !== 'darwin') return json(res, 400, { error: 'Reveal in Finder is only available on macOS.' })
        const child = spawn('open', ['-R', entry.final.path], { detached: true, stdio: 'ignore' })
        child.unref()
        return json(res, 200, { path: entry.final.path })
      }

      if (method === 'POST' && ['/delete-export','/delete-project','/delete-run'].includes(pathname)) {
        return json(res, 200, await removeProjectData(body, pathname !== '/delete-export'))
      }

      if (method === 'GET' && pathname === '/history') {
        const history = await readHistory()
        const detached = (await savedExports()).filter(row => !history.some(r => r.id === row.project && r.final?.path === row.path))
        return json(res, 200, { runs: await Promise.all(history.map(projectView)), exports: await Promise.all(detached.map(detachedView)) })
      }

      if (method === 'GET' && pathname === '/run') {
        const id = url.searchParams.get('id') || activeRunId || [...runs.keys()].pop() || (await readHistory())[0]?.id
        const run = id ? runs.get(id) : undefined
        const saved = !run && id && runIdOf(id) === id ? (await readProject(id)).saved : null
        return json(res, 200, { run: await projectView(run ? runView(run) : saved?.image && STAGE_IDS.every(k => saved.stages?.[k]) ? runView({ ...saved, log: saved.log || [] }) : null) })
      }

      if (method === 'POST' && pathname === '/generate') {
        if (activeRunId) return json(res, 409, { error: 'A task is already running. Wait for it to finish or cancel it first.' })
        const settings = await readSettings()
        if (!settings.apiKey) return json(res, 400, { error: 'No Tiiny API key is configured.' })
        if (Boolean(body.imageAssetId) === Boolean(body.imageDataUrl)) throw problem(400, 'invalid_reference', 'Choose exactly one saved Studio image or one uploaded reference.')
        const image = body.imageAssetId ? await readAsset(body.imageAssetId) : decodeUpload(body.imageDataUrl)
        await activeBlock()
        const device = new Device(settings)
        const pin = await verifyPin(device)
        verifyExpected(body, pin)

        const options = {
          simplify: body.options?.simplify === true,
          settleDelay: Number.isFinite(body.options?.settleDelay) ? clamp(Math.round(body.options.settleDelay), 0, 300) : settings.settleDelay,
          quality: Object.hasOwn(QUALITY_PRESETS, body.preset) ? body.preset : 'balance',
          polish: typeof body.options?.polish === 'boolean' ? body.options.polish : settings.polish !== false,
        }
        // Ask the device what it accepts; if it cannot answer, send only the
        // documented parameters instead of risking a 400.
        const capabilities = await device.capabilities().catch(() => null)
        const params = buildStageParams(body, advertisedParams(capabilities))
        // Recheck after asynchronous preparation: two callers may have passed
        // the first check while capabilities was still in flight.
        if (activeRunId) return json(res, 409, { error: 'A task is already running. Wait for it to finish or cancel it first.' })
        const run = createRun({ image: { name: safeName(body.imageName || 'source.png'), bytes: image.bytes.length, mime: image.mime }, options, params })
        run.outputDir = settings.outputDir
        run.pin = pin; run.imageAssetId = body.imageAssetId || ''
        runs.set(run.id, run)
        activeRunId = run.id
        // Keep memory bounded; workspaces and history stay on disk.
        for (const id of runs.keys()) {
          if (runs.size <= 12) break
          if (id === run.id || id === activeRunId) continue
          runs.delete(id)
        }
        log(run, `Starting: ${run.plan.join(' -> ')}`)

        try {
          await prepareImage(run, { name: run.image.name, bytes: image.bytes }, image.mime)
          await saveRun(run)
        } catch (e) { runs.delete(run.id); activeRunId = null; throw e }
        runWithLease(run, device, () => runPipeline(run, device), release); release = null
        return json(res, 200, { run: runView(run) })
      }

      if (method === 'POST' && pathname === '/stage') {
        const stageId = String(body.stage || '')
        if (!STAGE_IDS.includes(stageId)) return json(res, 400, { error: 'Unknown stage.' })
        const run = runs.get(body.runId) || (activeRunId ? runs.get(activeRunId) : undefined)
        if (!run) return json(res, 404, { error: 'No run is available to reuse.' })
        if (activeRunId || run.status === 'running') return json(res, 409, { error: 'A task is already running. Wait for it to finish or cancel it first.' })
        const settings = await readSettings()
        if (!settings.apiKey) return json(res, 400, { error: 'No Tiiny API key is configured.' })
        await activeBlock()
        if (activeRunId || run.status === 'running') return json(res, 409, { error: 'A task is already running. Wait for it to finish or cancel it first.' })
        const device = new Device(settings)
        if (!run.pin) throw problem(409, 'no_pin', 'Cannot verify the original model. Start a new 3D run.')
        verifyExpected(body, await verifyPin(device, run.pin))
        // Reuse upstream inputs, but never present stale downstream artifacts as new output.
        for (const stage of STAGE_IDS.slice(STAGE_IDS.indexOf(stageId))) run.stages[stage] = newStageRecord()
        run.final = null
        run.closing = false
        run.status = 'running'
        run.phase = `${stageId}:submitting`
        run.error = ''
        run.cancelRequested = false
        run.skipSettle = true
        run.finishedAt = 0
        if (!run.plan.includes(stageId)) run.plan = [...new Set([...run.plan, stageId])]
        activeRunId = run.id
        computeProgress(run)
        log(run, `Rerunning stage: ${stageId}`)
        try { await saveRun(run) } catch(e) { activeRunId = null; run.status = 'failed'; throw e }
        runWithLease(run, device, async () => {
          try {
            await executeStage(run, device, stageId)
            run.status = 'completed'
          } catch (error) {
            run.status = String(error?.message) === 'cancelled' ? 'cancelled' : 'failed'
            run.error = run.status === 'cancelled' ? 'Cancelled' : humanize(error)
          } finally {
            await finishRun(run)
          }
        }, release); release = null
        return json(res, 200, { run: runView(run) })
      }

      if (method === 'POST' && pathname === '/cancel') {
        const run = activeRunId ? runs.get(activeRunId) : undefined
        if (!run) return json(res, 404, { error: 'No task is running.' })
        if (run.status !== 'running') return json(res, 409, { error: 'The submission outcome is unknown; no known running task is available to cancel. Verify device task state first.' })
        run.cancelRequested = true
        for (const [stageId, record] of Object.entries(run.stages)) {
          record.resumeRequested = false
          if (record.status === 'running' && record.taskId && !['completed', 'cancelled', 'error'].includes(record.deviceStatus)) {
            record.cancelPending = true
            record.phase = 'cancelling'
            run.phase = `${stageId}:cancelling`
          }
        }
        log(run, 'Cancellation requested; waiting for verified device termination', 'warn')
        await saveRun(run)
        return json(res, 200, { run: runView(run) })
      }

      if (method === 'POST' && pathname === '/skip-settle') {
        const run = activeRunId ? runs.get(activeRunId) : undefined
        if (!run) return json(res, 404, { error: 'No task is running.' })
        run.skipSettle = true
        return json(res, 200, { run: runView(run) })
      }

      if (method === 'POST' && pathname === '/resume') {
        const run = activeRunId ? runs.get(activeRunId) : undefined
        if (!run) return json(res, 404, { error: 'No task is running.' })
        if (run.cancelRequested || run.closing) return json(res, 409, { error: 'Cancellation is pending or the task has finished; it cannot be resumed.' })
        for (const stage of STAGE_IDS) {
          const record = run.stages[stage]
          if (record.status === 'running' && record.taskId) {
            try {
              const device = run.device
              if (!device) throw problem(409, 'no_pin', 'No pinned device is available.')
              const operation = device.control(record.taskId, 'resume', run.pin, () => !run.cancelRequested && !run.closing && record.status === 'running')
              ;(run.controls ||= new Set()).add(operation)
              try { await operation } finally { run.controls.delete(operation) }
              log(run, `${stage}: Resume request sent`)
            } catch (error) {
              return json(res, 502, { error: humanize(error) })
            }
          }
        }
        return json(res, 200, { run: runView(run) })
      }

      if (method === 'GET' && pathname === '/file') {
        const rawName = url.searchParams.get('name') || ''
        if (!rawName) return json(res, 400, { error: 'A file name is required.' })
        const name = fileNameOf(rawName)
        if (!name) return json(res, 400, { error: 'Invalid file name.' })
        const requestedId = url.searchParams.get('id') || url.searchParams.get('run') || ''
        const id = requestedId ? runIdOf(requestedId) : activeRunId || ''
        if (requestedId && !id) return json(res, 400, { error: 'Invalid run ID.' })
        const scope = url.searchParams.get('scope') || ''
        if (!['','export','stage'].includes(scope)) throw problem(400, 'invalid_scope', 'Unknown project file scope.')
        if (id) {
          const run = runs.get(id) || (await readProject(id)).saved
          const entry = !run && (await readHistory()).find(item => item?.id === id)
          const record = run || entry
          if (!record && scope !== 'stage') {
            const row = (await savedExports()).find(r => r.id === id && r.file === name)
            if (row && (await detachedView(row)).state === 'available') return await serveFile(res, row.path, row.owner)
          }
          // An export link must never silently serve a different file from the workspace,
          // including a same-named intermediate after the external file is deleted.
          const external = scope === 'export' || (!scope && [record?.final?.file, record?.deletedExport?.file].includes(name))
          const owned = external ? (await projectView(record))?.final?.file === name && finalPath(record.final)
            : run && (name === run.image?.file || Object.values(run.stages || {}).some(r => r?.file === name || r?.artifacts?.some(a => a?.name === name))) && path.join(RUNS_DIR, id, name)
          if (owned) {
            const stat = await ordinaryFile(owned)
            if (stat) return await serveFile(res, owned, fileVersion(stat))
          }
        }
        return json(res, 404, { error: 'File not found.' })
      }

      if (method === 'GET' && pathname === '/artifacts') {
        const id = url.searchParams.get('run') || activeRunId || ''
        const run = runs.get(id) || (id && runIdOf(id) === id ? (await readProject(id)).saved : null)
        if (!run || !STAGE_IDS.every(k => run.stages?.[k])) return json(res, 404, { error: 'Run record not found.' })
        return json(res, 200, { artifacts: await listRunArtifacts(await projectView(run)) })
      }

      return json(res, 404, { error: 'Not found.' })
    } catch (error) {
      return json(res, Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500, { code: typeof error?.code === 'string' ? error.code : undefined, ...(cleanId(error?.model) && { model: error.model }), error: error instanceof DeviceError ? humanize(error) : error instanceof Error ? error.message : String(error) })
    } finally { release?.() }
  },
}


// Same Host operation as the web route; no local HTTP, credential transfer, file serving,
// model switching, settings, or recovery-authority action through an agent call.
async function call(action, args = {}) {
  const gets = ['status', 'history', 'run', 'artifacts']
  if (![...gets, 'generate', 'stage', 'cancel', 'resume', 'skip-settle', 'rename-run', 'delete-run', 'delete-export', 'delete-project'].includes(action)) throw problem(400, 'unsupported_action', 'This 3D action is unavailable to the agent.')
  const method = gets.includes(action) ? 'GET' : 'POST'
  const query = new URLSearchParams()
  if (action === 'run' && args.id) query.set('id', args.id)
  if (action === 'artifacts' && (args.run || args.id)) query.set('run', args.run || args.id)
  const req = { method, headers: { 'content-type': 'application/json' }, url: `${prefix}/${action}?${query}`, async *[Symbol.asyncIterator]() { if (method === 'POST') yield Buffer.from(JSON.stringify(args)) } }
  let status, data
  await route.handler(req, { writeHead(code) { status = code }, end(text) { data = JSON.parse(text) } })
  if (status >= 400) throw Object.assign(problem(status, data?.code || 'three_error', data?.error || '3D operation failed.'), { model: data?.model })
  return data
}

return { route, call, checkAdmission, checkUnresolved, dispose() { disposed = true; lifetime.abort() } }
}
