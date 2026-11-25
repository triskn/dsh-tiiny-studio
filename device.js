/**
 * Tiiny device adapter. `/v1/models` advertises inference IDs; the same device's
 * `/api/v1/models/` lists downloads and `/api/v1/models/running` names loaded models.
 * Image generation uses the OpenAI-compatible device API.
 * No model load/unload, file I/O, or automatic POST retries.
 */
const CATALOG_MS = 5000
const IMAGE_MS = 10 * 60 * 1000
const MAX_CATALOG = 2 * 1024 * 1024
const MAX_IMAGE = 16 * 1024 * 1024
const MAX_BASE64 = 4 * Math.ceil(MAX_IMAGE / 3)
const MAX_IMAGE_JSON = MAX_BASE64 + 64 * 1024

function apiBase(settings) {
  let url
  try { url = new URL(settings.baseUrl) } catch {}
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Set the Tiiny API Base URL to an HTTP(S) device address without credentials, query, or fragment.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/'
  return url
}

function headers(settings, extra) {
  return settings.apiKey ? { authorization: `Bearer ${settings.apiKey}`, ...extra } : extra
}

async function withDeadline(signal, ms, fn) {
  const controller = new AbortController()
  const abort = () => controller.abort(new DOMException('Tiiny request cancelled.', 'AbortError'))
  const timer = setTimeout(() => controller.abort(new DOMException('The Tiiny device request timed out.', 'TimeoutError')), ms)
  timer.unref?.()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  try {
    controller.signal.throwIfAborted()
    return await fn(controller.signal)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

// A Content-Length header alone is not a memory limit (chunked or compressed responses).
async function readBounded(response, limit, signal) {
  const tooLarge = () => new Error('The Tiiny response exceeds the size limit.')
  if (Number(response.headers.get('content-length')) > limit) {
    response.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  if (!response.body) throw new Error('Tiiny returned an empty response.')
  const reader = response.body.getReader()
  const cancel = () => { reader.cancel().catch(() => {}) }
  const chunks = []
  let size = 0
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      size += value.byteLength
      if (size > limit || chunks.length >= 65536) throw tooLarge()
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } catch (e) {
    cancel()
    throw e
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

function validId(value) {
  return typeof value === 'string' && value.trim().length <= 512 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : ''
}
const folded = value => value.toLowerCase()
const leaf = value => folded(value.split('/').at(-1))
const token = value => typeof value === 'string' ? folded(value.trim()).replace(/[ _]+/g, '-') : ''

// Use a task's OUTPUT, not an input modality or an occurrence of “image” in a label.
function taskKind(value) {
  const t = token(value)
  if (/^(?:(?:.*-to-)?video|video-generation|generate-video|t2v|i2v)$/.test(t)) return 'video'
  if (/^(?:image|text-to-image|image-generation|generate-image|t2i)$/.test(t)) return 'image'
  if (/^(?:3d|image-to-3d|i2[ -]?3d|3d-generation|mesh-generation)$/.test(t)) return '3d'
  if (/-to-(?:text|3d|audio|speech|music|image)$/.test(t) || /^(?:llm|vlm|chat|asr|tts|text|audio|3d|vision|image-editing|image-classification|text-generation|text-classification|text-embedding|embedding|music-generation)$/.test(t)) return 'other'
  return 'unknown'
}

function declaredKind(row) {
  const tasks = [row.type, row.task, row.pipeline_tag, row.model_type, row.kind, row.modality].map(token)
  for (const t of tasks) {
    if (['image', 'video', 'vision'].includes(t)) continue // Output metadata is more specific than these labels.
    const k = taskKind(t)
    if (k !== 'unknown') return k
  }
  const output = row.output_modalities ?? row.modalities?.output ?? row.output
  const outputs = (Array.isArray(output) ? output : typeof output === 'string' ? output.split(',') : []).map(token)
  const generatedKinds = [...new Set(outputs.map(t => t === 'mesh' ? '3d' : t).filter(t => ['image', 'video', '3d'].includes(t)))]
  if (generatedKinds.length) return generatedKinds.length === 1 ? generatedKinds[0] : 'unknown' // Don't guess an endpoint for mixed outputs.
  if (outputs.some(x => ['text', 'audio', 'speech', 'embedding', 'music'].includes(x))) return 'other'
  // Some gateways advertise named generation capabilities rather than an output. Bare
  // capabilities:['Image'] is NOT such a declaration (also seen on image-to-3D models).
  const c = row.capabilities
  const caps = Array.isArray(c) ? c : c && typeof c === 'object' ? Object.keys(c).filter(k => c[k] === true) : []
  const media = new Set(caps.map(token).filter(t => !['image', 'video', '3d'].includes(t)).map(taskKind).filter(k => ['image', 'video', '3d'].includes(k)))
  if (media.size) return media.size === 1 ? [...media][0] : 'unknown'
  return tasks.map(taskKind).find(k => k !== 'unknown') || 'unknown'
}

// Minimal fallback for firmware that returns bare IDs: real Model Store / SDK examples.
// New models use device-declared task/output metadata, not a hard-coded allowlist.
function knownKind(id) {
  const name = leaf(id)
  if (name === 'minimax-h3-turbo') return 'video'
  if (name === 'hunyuan3d-2.1') return '3d'
  if (name === 'qwen-image-2.1' || name === 'z-image-turbo') return 'image'
  return 'unknown'
}

function loadedOf(row) {
  for (const v of [row.loaded, row.is_loaded, row.running]) if (typeof v === 'boolean') return v
  const state = token(row.status ?? row.state)
  if (['loaded', 'running', 'ready', 'active'].includes(state)) return true
  if (['downloaded', 'unloaded', 'not-loaded', 'stopped', 'inactive', 'loading', 'downloading'].includes(state)) return false
  return null
}

function normalizeRow(row, source) {
  if (typeof row === 'string') row = { id: row }
  if (!row || typeof row !== 'object') return null
  // OpenAI's id is the generation spelling. A store record's id can be a database ID.
  const ids = source === 'served' ? [row.id, row.model_id, row.modelId] : [row.model_id, row.modelId, row.id]
  const id = [...ids, row.fullname, row.model, row.name].map(validId).find(Boolean)
  if (!id) return null
  const keys = new Set([id, ...ids, row.fullname, row.model,
    ...(Array.isArray(row.aliases) ? row.aliases.slice(0, 24) : [])].map(validId).filter(Boolean))
  // A friendly label can help a person choose, but two different families may share it.
  // Only identifiers/declared aliases are evidence that two source records are the same model.
  const names = [row.name, row.display_name].map(validId).filter(Boolean)
  return { id, keys, names, kind: declaredKind(row), loaded: loadedOf(row) }
}

function rowsOf(payload, source) {
  if (payload?.error) throw new Error('invalid catalogue')
  const p = payload?.data ?? payload
  const options = source === 'running'
    ? [p?.running, p?.instances?.running, p]
    : [p, p?.models, p?.items, payload?.models]
  const list = options.find(Array.isArray)
  if (!list || list.length > 2048) throw new Error('invalid catalogue')
  const rows = new Map()
  let complete = true
  for (const value of list) {
    const row = normalizeRow(value, source)
    if (!row) { complete = false; continue }
    if (!rows.has(row.id)) rows.set(row.id, row)
  }
  // Keep positive evidence; never interpret a partial running list as proof that other models are unloaded.
  return { rows: [...rows.values()], complete, warning: complete ? undefined : `${source} model list contains unidentified entries.` }
}

async function getCatalog(settings, url, source, signal) {
  try {
    return await withDeadline(signal, CATALOG_MS, async deadline => {
      const res = await fetch(url.href, { method: 'GET', headers: headers(settings, { accept: 'application/json' }), redirect: 'manual', signal: deadline })
      if (!res.ok) {
        res.body?.cancel().catch(() => {})
        return { warning: `${source} model list: HTTP ${res.status}.` }
      }
      const bytes = await readBounded(res, MAX_CATALOG, deadline)
      return rowsOf(JSON.parse(bytes.toString('utf8')), source)
    })
  } catch (e) {
    if (signal?.aborted) throw e
    return { warning: `${source} model list ${e?.name === 'TimeoutError' ? 'timed out' : 'unavailable or invalid'}.` }
  }
}

function indexAliases(records, key) {
  const index = new Map()
  for (const record of records) for (const alias of record.keys) {
    const value = key(alias)
    if (!value) continue
    if (!index.has(value)) index.set(value, new Set())
    index.get(value).add(record)
  }
  return index
}

// Join sources, not similarly named entries WITHIN a source. A namespace change is
// evidence only if the alias is unique on both sides; keep ambiguous exports separate.
function mergeSource(groups, rows, source) {
  const exact = new Map(groups.map(g => [g.id, g]))
  const matches = new Map(rows.filter(r => exact.has(r.id)).map(r => [r, exact.get(r.id)]))
  const claimed = new Set(matches.values())
  for (const key of [folded, leaf]) {
    const incoming = indexAliases(rows, key)
    const current = indexAliases(groups, key)
    const proposals = new Map()
    for (const row of rows) {
      if (matches.has(row)) continue
      const targets = new Set()
      for (const name of row.keys) {
        const alias = key(name)
        if ((key === leaf && alias === 'default') || incoming.get(alias)?.size !== 1) continue
        for (const g of current.get(alias) || []) targets.add(g)
      }
      if (targets.size !== 1) continue
      const [g] = targets
      if (claimed.has(g) || (row.kind !== 'unknown' && g.kind !== 'unknown' && row.kind !== g.kind)) continue
      // Two different store records can each propose the same inference record via different aliases.
      proposals.set(g, proposals.has(g) ? null : row)
    }
    for (const [g, row] of proposals) if (row) { matches.set(row, g); claimed.add(g) }
  }
  for (const row of rows) {
    let g = matches.get(row)
    if (!g) {
      g = { id: row.id, keys: new Set(), names: new Set(), kind: 'unknown' }
      groups.push(g)
    }
    g[source] = row
    if (g.kind === 'unknown') g.kind = row.kind
    for (const alias of row.keys) g.keys.add(alias)
    for (const name of row.names) g.names.add(name)
  }
}

async function collect(settings, signal) {
  const base = apiBase(settings)
  // Keep the user's reverse-proxy mount, if present. Never reuse their key on a separate managed/lookup host.
  const management = new URL(base)
  management.pathname = management.pathname.replace(/\/v1\/$/, '/') + 'api/v1/models/'
  const [served, installed, running] = await Promise.all([
    getCatalog(settings, new URL('models', base), 'served', signal),
    getCatalog(settings, management, 'installed', signal),
    getCatalog(settings, new URL('running', management), 'running', signal),
  ])
  const groups = []
  for (const [source, result] of [['served', served], ['installed', installed], ['running', running]]) {
    mergeSource(groups, result.rows || [], source)
  }
  for (const g of groups) {
    if (g.kind === 'unknown') g.kind = knownKind(g.id)
    if (g.served?.loaded != null) g.loaded = g.served.loaded
    else if (g.running) g.loaded = true
    // The served list is fresher evidence than an installed 'downloaded' label or an
    // empty management snapshot. Don't block a currently advertised inference ID.
    else if (g.served) g.loaded = g.installed?.loaded === true ? true : null
    else g.loaded = running.complete ? false : (g.installed?.loaded ?? null)
  }
  return { groups, warnings: [served, installed, running].map(r => r.warning).filter(Boolean) }
}

/** Read-only snapshot. `null` means load state was not confirmed, not that the model is absent. */
export async function discoverModels(settings, { signal } = {}) {
  const { groups, warnings } = await collect(settings, signal)
  return { models: groups.map(({ id, kind, loaded }) => ({ id, kind, loaded })), warnings, warning: warnings.join(' ') }
}

function oneModel(matches, kind, requested = '') {
  const possible = matches.filter(g => g.kind === kind || (requested && g.kind === 'unknown'))
  if (!possible.length) throw new Error(`“${requested}” is not a ${kind} generation model. Choose the exact ${kind} model ID from TiinyOS.`)
  if (possible.length > 1) {
    const ids = possible.slice(0, 6).map(g => g.id).join(', ')
    throw new Error(`Ambiguous ${kind} model${requested ? ` “${requested}”` : ''}: ${ids}. Choose an exact model ID in settings.`)
  }
  const [model] = possible
  if (model.loaded === false) throw Object.assign(new Error(`Load ${model.id} in TiinyOS before generating ${kind}; the device reports it is not loaded. Then retry.`), { code: 'model_not_running', modelId: model.id })
  return model.id
}

/** Resolve immediately before submission. Never replace a requested family with another available one. */
export async function resolveModel(settings, kind, preferred, { signal } = {}) {
  if (kind !== 'image' && kind !== 'video') throw new Error('Choose an image or video model.')
  const configured = preferred || (kind === 'image' ? settings.imageModel : settings.model)
  const request = validId(configured)
  if (configured && !request) throw new Error('Invalid Tiiny model ID.')
  const { groups, warnings } = await collect(settings, signal)
  if (request) {
    for (const predicate of [
      g => g.id === request,
      g => g.keys.has(request),
      g => [...g.keys].some(a => folded(a) === folded(request)),
      // 'default' is a literal Tiiny gateway alias, not a request to try vendor/default.
      g => leaf(request) !== 'default' && [...g.keys].some(a => leaf(a) === leaf(request)),
      g => !request.includes('/') && [...g.names].some(n => folded(n) === folded(request)),
    ]) {
      const matches = groups.filter(predicate)
      if (matches.length) return oneModel(matches, kind, request)
    }
    if (knownKind(request) !== 'unknown' && knownKind(request) !== kind) return oneModel([], kind, request)
    // Private aliases need not be enumerated and older firmware may not expose any catalogue.
    // Keep the exact configured string; the device can reject it, but we won't try a different model.
    return request
  }
  const typed = groups.filter(g => g.kind === kind)
  const loaded = typed.filter(g => g.loaded === true)
  const served = typed.filter(g => g.served && g.loaded !== false)
  const unconfirmed = typed.filter(g => g.loaded !== false)
  if (typed.length) return oneModel(loaded.length ? loaded : served.length ? served : unconfirmed.length ? unconfirmed : typed, kind)
  throw new Error(`No ${kind} generation model was identified. Load a ${kind} model in TiinyOS or set its exact Model ID in settings.${warnings.length ? ' ' + warnings.join(' ') : ''}`)
}

// Identify raster containers from bytes (not just a caller-supplied MIME or extension).
// Check framing + dimensions rather than decompressing a device-supplied bitmap in the Host.
const is = (b, at, s) => b.toString('latin1', at, at + s.length) === s
function imageInfo(b) {
  if (b.length >= 45 && is(b, 0, '\x89PNG\r\n\x1a\n') && b.readUInt32BE(8) === 13 && is(b, 12, 'IHDR')) {
    let pixels = false
    for (let p = 33; p + 12 <= b.length;) {
      const n = b.readUInt32BE(p)
      const end = p + 12 + n
      if (end > b.length) break
      if (is(b, p + 4, 'IDAT') && n) pixels = true
      if (is(b, p + 4, 'IEND')) {
        if (pixels && n === 0 && end === b.length) return ['image/png', 'png', b.readUInt32BE(16), b.readUInt32BE(20)]
        break
      }
      p = end
    }
  } else if (b.length >= 12 && b.readUInt16BE(0) === 0xffd8 && b.readUInt16BE(b.length - 2) === 0xffd9) {
    let dims
    for (let p = 2; p + 4 < b.length && b[p] === 0xff;) {
      while (b[p] === 0xff) p++
      const marker = b[p++]
      if (p + 2 > b.length) break
      const n = b.readUInt16BE(p)
      if (n < 2 || p + n > b.length) break
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && n >= 8) {
        dims = [b.readUInt16BE(p + 5), b.readUInt16BE(p + 3)]
      }
      if (marker === 0xda) return dims && n >= 8 && p + n < b.length - 2 ? ['image/jpeg', 'jpg', ...dims] : undefined
      p += n
    }
  } else if (b.length >= 30 && is(b, 0, 'RIFF') && is(b, 8, 'WEBP') && b.readUInt32LE(4) + 8 === b.length) {
    for (let p = 12; p + 8 <= b.length;) {
      const n = b.readUInt32LE(p + 4), data = p + 8, end = data + n
      if (end > b.length) break
      if (is(b, p, 'VP8X')) {
        if (n !== 10 || (b[data] & 2)) break // The reference must be a static frame.
        checkDimensions(b.readUIntLE(data + 4, 3) + 1, b.readUIntLE(data + 7, 3) + 1)
      }
      if (is(b, p, 'VP8 ') && n >= 10 && is(b, data + 3, '\x9d\x01\x2a')) return ['image/webp', 'webp', b.readUInt16LE(data + 6) & 0x3fff, b.readUInt16LE(data + 8) & 0x3fff]
      if (is(b, p, 'VP8L') && n >= 5 && b[data] === 0x2f) {
        const dims = b.readUInt32LE(data + 1)
        return ['image/webp', 'webp', (dims & 0x3fff) + 1, ((dims >>> 14) & 0x3fff) + 1]
      }
      p = end + (n % 2)
    }
  }
}

function checkDimensions(width, height) {
  if (width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024) throw new Error('The generated image dimensions exceed the safety limit.')
}

function verifiedImage(bytes, declared = '') {
  if (bytes.length > MAX_IMAGE) throw new Error('The generated image exceeds the 16 MiB limit.')
  const [mime, ext, width, height] = imageInfo(bytes) || []
  if (!width || !height || !mime || (declared && declared !== 'application/octet-stream' && declared !== mime)) {
    throw new Error('Tiiny did not return a valid PNG, JPEG or WebP image matching its content type.')
  }
  checkDimensions(width, height)
  return { bytes, mime, ext }
}

function fromBase64(text, declared) {
  if (!text.length || text.length > MAX_BASE64) throw new Error('The generated image is empty or exceeds the 16 MiB limit.')
  if (text.length % 4 === 1 || !/^[a-z0-9+/]+={0,2}$/i.test(text) || (text.endsWith('=') && text.length % 4 !== 0)) throw new Error('Tiiny returned invalid image base64.')
  const bytes = Buffer.from(text, 'base64')
  if (bytes.toString('base64') !== text.padEnd(4 * Math.ceil(text.length / 4), '=')) throw new Error('Tiiny returned invalid image base64.')
  return verifiedImage(bytes, declared)
}

function deviceFileUrl(value, base) {
  // OpenAI-style Files content only: no other APIs, arbitrary host paths, signed queries,
  // file://, credentials, or redirects. Construct the GET from a validated file ID.
  let url
  if (typeof value === 'string' && value.length <= 2048 && !/[\\\s\x00-\x1f]/.test(value)) {
    try { url = new URL(value, base) } catch {}
  }
  const prefix = base.pathname + 'files/'
  const match = url?.pathname.startsWith(prefix) && /^([A-Za-z0-9_-]{1,160})\/content$/.exec(url.pathname.slice(prefix.length))
  if (!match || url.origin !== base.origin || url.username || url.password || url.hash || url.search) {
    throw new Error('Tiiny returned an untrusted image URL. Request base64 or a same-origin device file; no URL was fetched.')
  }
  return new URL('files/' + match[1] + '/content', base)
}

function submissionError(status, model) {
  const hint = [404, 503].includes(status) ? ` Check that ${model} is the exact image Model ID and is loaded in TiinyOS.`
    : [401, 403].includes(status) ? ' Check the configured device API key.'
    : status === 429 ? ' The device queue may be full; check it before trying again.'
    : [400, 422].includes(status) ? ' Check the model ID, prompt and 1024x1024 support on the device.'
    : status >= 300 && status < 400 ? ' Redirect refused. Verify the configured Tiiny Base URL.'
    : status >= 500 ? ' The submission outcome is unknown; check the device before trying again.' : ''
  return Object.assign(new Error(`Tiiny image generation returned HTTP ${status}.${hint} No automatic retry was made.`), { submissionRejected: status >= 400 && status < 500 && status !== 408 })
}

const contentType = response => (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
async function imageResult(response, settings, base, signal) {
  const type = contentType(response)
  if (type.startsWith('image/') || type === 'application/octet-stream') return verifiedImage(await readBounded(response, MAX_IMAGE, signal), type)
  if (type && type !== 'application/json' && !type.endsWith('+json')) {
    response.body?.cancel().catch(() => {})
    throw new Error('Tiiny image generation returned neither image bytes nor JSON.')
  }
  const body = await readBounded(response, MAX_IMAGE_JSON, signal)
  let payload
  try { payload = JSON.parse(body.toString('utf8')) } catch { throw new Error('Tiiny returned invalid image JSON.') }
  const item = payload?.data?.[0]
  if (!item || payload.error) throw new Error('Tiiny returned no generated image. Check that the selected image model is running.')
  if (typeof item.b64_json === 'string' && item.b64_json.length) return fromBase64(item.b64_json)
  if (typeof item.url === 'string' && item.url.startsWith('data:')) {
    const prefix = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(item.url)
    if (!prefix) throw new Error('Tiiny returned an invalid image data URL.')
    return fromBase64(item.url.slice(prefix[0].length), prefix[1].toLowerCase())
  }
  if (typeof item.url !== 'string') throw new Error('Tiiny returned no image bytes or device file.')
  const asset = await fetch(deviceFileUrl(item.url, base).href, { method: 'GET', headers: headers(settings, { accept: 'image/png, image/jpeg, image/webp' }), redirect: 'manual', signal })
  if (!asset.ok) {
    asset.body?.cancel().catch(() => {})
    throw new Error(`Tiiny image file download returned HTTP ${asset.status}; redirects are not followed.`)
  }
  return verifiedImage(await readBounded(asset, MAX_IMAGE, signal), contentType(asset))
}

/** `model`, when supplied, is an exact ID already resolved by the caller for this job. */
export async function generateImage(settings, { prompt, model, signal }) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('An image prompt is required.')
  if (Buffer.byteLength(prompt) > 64 * 1024) throw new Error('The image prompt exceeds the size limit.')
  if (!settings.apiKey) throw new Error('The Tiiny API key is not configured.')
  const base = apiBase(settings)
  return withDeadline(signal, IMAGE_MS, async deadline => {
    const id = model == null ? await resolveModel(settings, 'image', undefined, { signal: deadline }) : validId(model)
    if (!id) throw new Error('An exact Tiiny image model ID is required.')
    deadline.throwIfAborted()
    let response
    try {
      // Official Tiiny OpenAI / Images contract. One POST only, even on timeout, 429 or 5xx.
      response = await fetch(new URL('images/generations', base).href, {
        method: 'POST', redirect: 'manual', signal: deadline,
        headers: headers(settings, { 'content-type': 'application/json', accept: 'application/json' }),
        body: JSON.stringify({ model: id, prompt: prompt.trim(), size: '1024x1024', response_format: 'b64_json' }),
      })
    } catch {
      if (deadline.aborted) throw deadline.reason
      throw new Error('The device did not confirm image submission. Check TiinyOS before trying again; no automatic retry was made.')
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => {})
      throw submissionError(response.status, id)
    }
    return imageResult(response, settings, base, deadline)
  })
}
