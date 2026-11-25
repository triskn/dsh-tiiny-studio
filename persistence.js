import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { assetStore, problem } from './assets.js'

const oldPackage = path.dirname(fileURLToPath(import.meta.url))
const SIZES = ['832x480', '480x832', '1344x768', '768x1344']
const standard = Object.fromEntries(SIZES.map(size => [size, [5, 6, 7]]))

function selection(settings) {
  const spec = {}
  for (const size of SIZES) {
    const list = Array.isArray(settings.spec?.[size]) ? settings.spec[size] : standard[size]
    const durations = [...new Set(list.map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= 7))].sort((a, b) => a - b)
    if (durations.length) spec[size] = durations
  }
  if (!Object.keys(spec).length) Object.assign(spec, standard)
  const size = Object.hasOwn(spec, settings.size) ? settings.size : Object.keys(spec)[0]
  const target = Number(settings.seconds)
  const seconds = spec[size].reduce((a, b) => Math.abs(a - target) <= Math.abs(b - target) ? a : b, spec[size][0])
  return { spec, size, seconds }
}

export function baseUrl(value) {
  let url
  try { url = new URL(value) } catch {}
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw problem(400, 'invalid_base', 'Use an HTTP(S) Tiiny API base URL, without embedded credentials, query, or fragment')
  }
  return url.href.replace(/\/+$/, '')
}

export function publicSettings(s) {
  const { baseUrl, model, imageModel, size, seconds, outputDir, spec } = s
  return { baseUrl, model, imageModel, size, seconds, outputDir, spec, sizes: Object.keys(spec), hasApiKey: Boolean(s.apiKey), supportsLastFrame: true, supportsImages: true, supportsRetry: true }
}

export function createStore(credentials) {
  const dir = path.resolve(process.env.TIINY_VIDEO_HOME || path.join(os.homedir(), '.tiiny-video'))
  const defaults = {
    baseUrl: process.env.TIINY_BASE_URL || 'http://openai.api.tiiny/v1',
    // Empty = ask the device for an unambiguous model of the right output type.
    model: process.env.TIINY_MODEL || '', imageModel: process.env.TIINY_IMAGE_MODEL || '',
    size: SIZES[0], seconds: 5, outputDir: path.join(os.homedir(), 'tiiny-videos'),
  }
  const settingsFile = path.join(dir, 'settings.json'), historyFile = path.join(dir, 'history.json')
  const recordKey = url => {
    const digest = createHash('sha256').update(dir + '\n' + new URL(baseUrl(url)).origin).digest('hex')
    // DSH credential IDs start with a letter. Preserve existing valid media IDs.
    const id = /^[a-f]/.test(digest) ? digest : `media-${digest}`
    return `dsh-tiiny-video/${id}`
  }
  let migration, pending = Promise.resolve()
  // Reads never silently replace a damaged history with an empty array.
  async function readJson(file, fallback) {
    if (!migration) migration = migrate()
    await migration
    try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch (e) {
      if (e.code === 'ENOENT') return fallback
      throw new Error(`Cannot read ${path.basename(file)}; the original file has not been replaced`, { cause: e })
    }
  }
  async function migrate() {
    if (process.env.TIINY_VIDEO_HOME) return
    for (const file of [settingsFile, historyFile]) {
      const legacy = path.join(oldPackage, path.basename(file))
      try { await fs.access(file); continue } catch (e) { if (e.code !== 'ENOENT') throw e }
      let old
      try { old = await fs.readFile(legacy) } catch (e) { if (e.code === 'ENOENT') continue; throw e }
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
      try { await fs.writeFile(file, old, { flag: 'wx', mode: 0o600 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    }
  }
  async function writeJson(file, data) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const tmp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`)
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      // Concurrent readers can briefly block atomic replacement on Windows.
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(tmp, file)
          break
        } catch (error) {
          if (attempt === 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
          await delay(20 * (2 ** attempt))
        }
      }
    } finally { await fs.rm(tmp, { force: true }).catch(() => {}) }
  }
  function serial(fn) {
    const result = pending.then(fn)
    pending = result.catch(() => {})
    return result
  }
  async function settings() {
    const saved = await readJson(settingsFile, {})
    const s = { ...defaults, ...saved }
    s.baseUrl = baseUrl(s.baseUrl)
    s.outputDir = path.resolve(process.env.TIINY_OUTPUT_DIR || s.outputDir)
    const stored = credentials ? await credentials.readRecord(recordKey(s.baseUrl)) : undefined
    // Read pre-upgrade settings unchanged. Migrate a legacy key on a user-initiated save only.
    const ambient = new URL(s.baseUrl).origin === new URL(baseUrl(defaults.baseUrl)).origin ? process.env.TIINY_API_KEY : ''
    s.apiKey = stored?.key || saved.apiKey || ambient || ''
    return { ...s, ...selection(s) }
  }
  async function saveSettings(body) {
    return serial(async () => {
      const prev = await settings(), saved = await readJson(settingsFile, {})
      const next = { ...saved }
      if (body.baseUrl !== undefined) next.baseUrl = baseUrl(body.baseUrl)
      if (body.outputDir !== undefined) {
        if (typeof body.outputDir !== 'string' || !path.isAbsolute(body.outputDir.trim()) || body.outputDir.includes('\0')) throw problem(400, 'invalid_folder', 'Choose an absolute output folder path')
        next.outputDir = path.resolve(body.outputDir.trim())
      }
      for (const key of ['model', 'imageModel']) if (body[key] !== undefined) {
        if (typeof body[key] !== 'string' || body[key].length > 512 || /[\x00-\x1f]/.test(body[key])) throw problem(400, 'invalid_model', 'Enter a model ID or leave it blank for automatic detection')
        next[key] = body[key].trim()
      }
      if (typeof body.size === 'string' && SIZES.includes(body.size)) next.size = body.size
      if (Number.isInteger(body.seconds)) next.seconds = body.seconds
      const target = next.baseUrl || prev.baseUrl
      const newKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
      if (newKey.length > 8192 || /[^\x20-\x7E]/.test(newKey)) throw problem(400, 'invalid_key', 'Invalid API key format')
      if (new URL(target).origin !== new URL(prev.baseUrl).origin && prev.apiKey && !newKey) throw problem(400, 'new_origin', 'Enter the key for the new device. A saved key is never forwarded to a different origin.')
      const toStore = newKey || saved.apiKey
      if (toStore) {
        if (!credentials) throw problem(503, 'credentials_unavailable', 'The Harness credential store is unavailable. Configure an environment key instead.')
        await credentials.modifyRecord(recordKey(target), async () => ({ kind: 'api-key', key: toStore }))
      }
      delete next.apiKey
      await writeJson(settingsFile, next)
      return publicSettings(await settings())
    })
  }
  return {
    dir, assets: assetStore(dir), settings, saveSettings, serial,
    async history() {
      const rows = await readJson(historyFile, [])
      if (!Array.isArray(rows)) throw new Error('Invalid history.json; the original file has not been replaced')
      return rows.filter(row => row && typeof row.id === 'string')
    },
    writeHistory: rows => writeJson(historyFile, rows),
  }
}
