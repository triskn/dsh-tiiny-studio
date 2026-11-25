// Private reference media is addressed by content, not by a path supplied by a client.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const MAX_IMAGE_BYTES = 16 * 1024 * 1024
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }
const assetPattern = /^[a-f0-9]{64}\.(png|jpg|webp)$/
export const validAssetId = (id) => typeof id === 'string' && assetPattern.test(id)
export function problem(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function imageType(b) {
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString('ascii', 12, 16) === 'IHDR') return 'png'
  if (b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpg'
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp'
}

export function decodeUpload(value) {
  const invalid = () => problem(400, 'invalid_image', 'Choose a PNG, JPEG or WebP image')
  if (typeof value !== 'string') throw invalid()
  if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw problem(413, 'image_too_large', 'Reference images must be 16 MiB or smaller')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/]+={0,2})$/i.exec(value)
  if (!match) throw invalid()
  const bytes = Buffer.from(match[2], 'base64')
  const ext = imageType(bytes)
  if (!ext || MIME[ext] !== match[1].toLowerCase() || bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) throw invalid()
  if (bytes.length > MAX_IMAGE_BYTES) throw problem(413, 'image_too_large', 'Reference images must be 16 MiB or smaller')
  return { bytes, ext, mime: MIME[ext] }
}

export function assetStore(dataDir) {
  const dir = path.join(dataDir, 'assets')
  function target(id) {
    if (!validAssetId(id)) throw problem(400, 'invalid_asset', 'Invalid reference image ID')
    return path.join(dir, id)
  }
  async function genuineLibrary() {
    const expected = process.platform === 'darwin' ? dir.replace(/^\/(var|tmp)(?=\/|$)/, '/private/$1') : dir
    try { return (await fs.lstat(dir)).isDirectory() && await fs.realpath(dir) === expected }
    catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e }
  }
  async function exists(id) {
    if (!validAssetId(id) || !await genuineLibrary()) return false
    try {
      const stat = await fs.lstat(target(id))
      return stat.isFile() && stat.size > 0 && stat.size <= MAX_IMAGE_BYTES
    } catch (error) { if (error.code !== 'ENOENT') throw error; return false }
  }
  return {
    exists,
    async put({ bytes, mime }) {
      const ext = imageType(bytes)
      if (!ext || MIME[ext] !== mime || bytes.length > MAX_IMAGE_BYTES) throw problem(422, 'invalid_image', 'Invalid or oversized image from Tiiny (PNG/JPEG/WebP, up to 16 MiB)')
      const id = `${createHash('sha256').update(bytes).digest('hex')}.${ext}`
      await fs.mkdir(dir, { recursive: true, mode: 0o700 })
      if (!await genuineLibrary()) throw problem(409, 'unsafe_library', 'The private image library is not a regular Studio folder. No file was written.')
      // Callers serialise media mutations with their history transaction.
      if (!(await exists(id))) await fs.writeFile(target(id), bytes, { flag: 'wx', mode: 0o600 })
      return id
    },
    async read(id) {
      const file = target(id)
      if (!(await exists(id))) throw problem(409, 'frame_missing', 'Reference image is no longer available. Reuse the prompt and attach the image again.')
      const bytes = await fs.readFile(file)
      const ext = imageType(bytes)
      if (!ext || !id.endsWith('.' + ext) || createHash('sha256').update(bytes).digest('hex') !== id.slice(0, 64)) throw problem(409, 'frame_missing', 'Reference image is damaged. Reuse the prompt and attach it again.')
      return { bytes, mime: MIME[ext], ext }
    },
    // A renamed library, linked file or replaced digest is not the asset Studio owns.
    async drop(id) {
      if (!validAssetId(id) || !await exists(id)) return
      const file = target(id), before = await fs.lstat(file)
      if (!before.isFile() || before.nlink !== 1 || createHash('sha256').update(await fs.readFile(file)).digest('hex') !== id.slice(0, 64)) return
      const now = await fs.lstat(file)
      if (now.isFile() && now.nlink === 1 && before.dev === now.dev && before.ino === now.ino && before.size === now.size && before.ctimeMs === now.ctimeMs && await genuineLibrary()) await fs.unlink(file)
    },
  }
}
