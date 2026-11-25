// OpenAI-compatible Tiiny Videos transport. A generation POST is never retried here:
// a timeout doesn't prove the device didn't accept it. Only status reads are retried.
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'

export function safeError(error, key) {
  let text = typeof error === 'string' ? error : String(error?.message || 'Device request failed')
  if (key) text = text.replaceAll(key, '[redacted]')
  return text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]').replace(/data:image\/[^;,]+;base64,[a-z0-9+/=]+/gi, '[image]').slice(0, 1200)
}

export async function deviceError(response, payload) {
  const detail = payload?.error?.message || payload?.error || payload?.detail || payload?.message
  return new Error(`HTTP ${response.status}${detail ? ': ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`)
}
function explain(raw, { size, spec, model }) {
  const bucket = /no exported bucket fits a request needing \[audio=(\d+), cond_video=(\d+), target_video=(\d+)\]/i.exec(raw)
  if (bucket) return `The device has no matching video configuration (audio=${bucket[1]}, cond_video=${bucket[2]}, target_video=${bucket[3]}). Available durations at ${size}: ${(spec?.[size] || []).join(' / ')} seconds. Adjust the settings and retry.`
  const shape = /this model was exported for \[([^\]]+)\]/i.exec(raw)
  if (shape) return `This device does not offer ${size}. Choose one of its exported resolutions: ${shape[1]}.`
  if (/not (?:currently )?loaded|model_not_loaded/i.test(raw)) return `The device did not accept the request for ${model || 'this model'}. Refresh the model list in Settings and check the device and model ID before retrying. ${raw}`
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(raw)) return `Cannot connect to Tiiny. Check the network and API address. ${raw}`
  return raw
}
// Old Studio builds saved localized diagnostic text. Translate the display, never rewrite saved jobs or their prompts.
export function englishDiagnostic(text, code, model) {
  if (!text || !/\p{Script=Han}/u.test(text)) return text
  if (code === 'model_not_running') return `The device reports that ${model || 'the selected model'} is not loaded. Load it in TiinyOS, then retry.`
  if (code === 'invalid_shape') return 'This resolution and duration are not available on the device. Choose an offered combination and retry.'
  if (code === 'interrupted') return 'The job was interrupted. Check its status on the device before retrying.'
  const status = /\bHTTP ([1-5][0-9]{2})\b/i.exec(text)?.[1]
  return `The device reported an error${status ? ' (HTTP ' + status + ')' : ''}. Check the device status and saved connection in TiinyOS before retrying.`
}
export function failureMessage(error, settings, job) {
  const raw = englishDiagnostic(safeError(error, settings.apiKey), error?.code, job.model)
  if (error?.code === 'model_not_running') return `No generation request was sent. Load ${safeError(error.modelId, settings.apiKey)} in TiinyOS, then retry.`
  if (job.phase === 'resolving_model') return raw // A discovery failure isn't a rejection by the generation endpoint.
  return explain(raw, { size: job.size, spec: settings.spec, model: job.model })
}

function runBinary(bin, args, timeoutMs, signal, capture = false) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve(null)
    let child
    try { child = spawn(bin, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'ignore'], windowsHide: true }) } catch { return resolve(null) }
    const kill = () => { try { child.kill('SIGKILL') } catch {} }
    const timer = setTimeout(kill, timeoutMs); timer.unref()
    signal?.addEventListener('abort', kill, { once: true })
    let text = ''
    child.stdout?.on('data', chunk => { if (text.length < 65536) text += chunk })
    const finish = value => { clearTimeout(timer); signal?.removeEventListener('abort', kill); resolve(value) }
    child.once('error', () => finish(null))
    child.once('close', code => finish(code === 0 ? text : null))
  })
}
export async function probeShape(file) {
  const text = await runBinary(process.env.TIINY_FFPROBE || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], 5000, null, true)
  try {
    const data = JSON.parse(text), { width, height } = data.streams[0]
    return { size: `${width}x${height}`, seconds: Math.round(Number(data.format.duration)) || undefined }
  } catch { return {} }
}
async function remux(file, signal) {
  const out = file + '.remux.mp4'
  try {
    if (await runBinary(process.env.TIINY_FFMPEG || 'ffmpeg', ['-nostdin', '-y', '-v', 'error', '-i', file, '-c', 'copy', '-movflags', '+faststart', out], 120000, signal) !== null) await fs.rename(out, file)
  } finally { await fs.rm(out, { force: true }).catch(() => {}) }
}
function request(s, pathname, init, timeout, signal) {
  const bounded = AbortSignal.timeout(timeout)
  return fetch(s.baseUrl.replace(/\/+$/, '') + pathname, { ...init, redirect: 'error',
    headers: { ...init.headers, authorization: 'Bearer ' + s.apiKey },
    signal: signal ? AbortSignal.any([signal, bounded]) : bounded,
  })
}
export async function cancelDeviceVideo(settings, id) {
  const res = await request(settings, '/videos/' + encodeURIComponent(id), { method: 'DELETE' }, 5000)
  return res.ok
}
export async function videoTerminal(settings, id) {
  const res = await request(settings, '/videos/' + encodeURIComponent(id), {}, 5000)
  if (!res.ok) { await res.body?.cancel(); return null }
  const state = await res.json()
  if (['completed', 'failed', 'cancelled', 'canceled', 'error'].includes(state?.status)) return true
  return typeof state?.status === 'string' ? false : null
}
export async function renderVideo(settings, job, image, tempPath, checkpoint) {
  const { prompt, model, size, seconds, frameMode, controller } = job, { signal } = controller
  let body, headers
  if (frameMode === 'last') {
    headers = { 'content-type': 'application/json' }
    body = JSON.stringify({ model, prompt, size, seconds, last_frame: `data:${image.mime};base64,${image.bytes.toString('base64')}` })
  } else {
    body = new FormData()
    for (const [key, value] of Object.entries({ model, prompt, size, seconds })) body.set(key, String(value))
    if (image) body.set('input_reference', new Blob([image.bytes], { type: image.mime }), 'first-frame.' + image.ext)
  }
  job.phase = 'submitting'
  const created = await request(settings, '/videos', { method: 'POST', headers, body }, 120000, signal)
  let state = await created.json().catch(() => null)
  if (!created.ok || (state?.error && !state?.id)) {
    if (created.status >= 400 && created.status < 500 && created.status !== 408) job.remotePending = false
    throw await deviceError(created, state)
  }
  if (typeof state?.id !== 'string' || !state.id) throw new Error('Tiiny accepted the request without returning a video job ID; check the device before retrying.')
  job.tiinyId = state.id
  if (['completed', 'failed', 'cancelled', 'canceled', 'error'].includes(state.status)) job.remotePending = false
  await checkpoint()
  const pathname = '/videos/' + encodeURIComponent(state.id)
  const deadline = Date.now() + 45 * 60_000
  while (true) {
    signal.throwIfAborted()
    job.phase = state.status || 'queued'
    job.progress = Math.max(0, Math.min(100, Number(state.progress) || 0))
    if (state.status === 'completed') { job.remotePending = false; break }
    if (['failed', 'cancelled', 'canceled', 'error'].includes(state.status)) { job.remotePending = false; throw new Error(state.error?.message || state.error || `Tiiny: ${state.status}`) }
    if (Date.now() >= deadline) throw new Error('Timed out waiting for this video. Check the device before retrying.')
    await delay(3000, undefined, { signal })
    let response
    try { response = await request(settings, pathname, {}, 30000, signal) } catch (e) {
      signal.throwIfAborted()
      if (!(e instanceof TypeError) && !['TimeoutError', 'AbortError'].includes(e.name)) throw e
    }
    if (!response || response.status >= 500 || [408, 429].includes(response.status)) { await response?.body?.cancel(); continue }
    const snapshot = await response.json().catch(() => null)
    if (!response.ok || (snapshot?.error && !snapshot?.status)) throw await deviceError(response, snapshot)
    if (typeof snapshot?.status === 'string') state = snapshot
  }
  job.phase = 'downloading'
  const content = await request(settings, pathname + '/content', {}, 300000, signal)
  if (!content.ok || !content.body) throw await deviceError(content, await content.json().catch(() => null))
  await pipeline(Readable.fromWeb(content.body), createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }), { signal })
  if (!(await fs.stat(tempPath)).size) throw new Error('Tiiny returned an empty clip')
  await remux(tempPath, signal)
  signal.throwIfAborted()
}
