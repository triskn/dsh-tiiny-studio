// A file is selected by a saved Studio record or by its current directory listing, never by a client path.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { problem } from './assets.js'

export const MEDIA_MIME = { '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
export function mediaKind(name) {
  if (typeof name !== 'string' || name.length > 255 || !name || name.startsWith('.') || /[/\\:\x00-\x1f\x7f]/.test(name)) return null
  if (/^tiiny-image-[\w-]+\.(?:png|jpg|webp)$/.test(name)) return 'image'
  // Older releases exported clips under user-chosen names. Other pictures in the folder aren't Studio outputs.
  return name.endsWith('.mp4') ? 'video' : null
}
export async function regular(file) {
  try { const stat = await fs.lstat(file); return stat.isFile() ? stat : null } catch (e) { if (e.code !== 'ENOENT') throw e; return null }
}
export function identity(dir, name, st) {
  return createHash('sha256').update(JSON.stringify([dir, name, st.dev, st.ino, st.birthtimeMs, st.size, st.mtimeMs, st.ctimeMs])).digest('hex')
}
export const listedId = (name, token) => `file:scan:${token}:${name}`
export function parseFileId(id) {
  const match = /^file:scan:([a-f0-9]{64}):(.+)$/.exec(id)
  if (match) return { name: match[2], token: match[1] }
  return { name: id.slice(5) } // Legacy unsuffixed file:<name> IDs are still readable.
}
// A historical job may use an earlier configured destination. Never resurrect or traverse that directory when absent.
export async function inspectExport(dir, name, { token, destructive = false } = {}) {
  if (!mediaKind(name) || !path.isAbsolute(dir) || path.dirname(path.resolve(dir, name)) !== path.resolve(dir)) throw problem(400, 'invalid_file', 'Invalid Studio output filename or folder.')
  try {
    const folder = await fs.lstat(dir)
    if (!folder.isDirectory() && !(folder.isSymbolicLink() && !destructive)) throw problem(409, 'unsafe_output', 'The output folder changed. No file was deleted.')
    const base = await fs.realpath(dir), file = path.join(base, name)
    // macOS has system aliases for /tmp and /var. Do not follow user-created directory links for deletion.
    const spelling = process.platform === 'darwin' ? path.resolve(dir).replace(/^\/(var|tmp)(?=\/|$)/, '/private/$1') : path.resolve(dir)
    if (destructive && base !== spelling) throw problem(409, 'unsafe_output', 'This output is reached through a linked folder. No file was deleted.')
    const stat = await fs.lstat(file)
    if (!stat.isFile() || destructive && stat.nlink !== 1) {
      if (destructive) throw problem(409, 'unsafe_output', 'Only the selected regular output file can be deleted. Links and folders are left untouched.')
      return null
    }
    const actual = identity(base, name, stat)
    if (token && actual !== token) throw problem(409, 'stale_output', 'The selected file or its folder changed. Refresh the library and check the file before deleting it.')
    return { file, base, stat, token: actual }
  } catch (e) { if (e.code !== 'ENOENT') throw e; return null }
}
// Case and Unicode aliases can name the same entry on macOS/Windows. Ambiguity must favor keeping the file.
export async function sameOutput(a, b, fallback) {
  if (!a.file || !b.file) return false
  const key = x => x.normalize('NFC').toLowerCase()
  if (key(a.file) !== key(b.file)) return false
  const left = path.resolve(a.outputDir || fallback), right = path.resolve(b.outputDir || fallback)
  if (key(left) === key(right)) return true
  const dirs = await Promise.all([left, right].map(p => fs.realpath(p).catch(e => { if (e.code === 'ENOENT') return p; throw e })))
  return key(dirs[0]) === key(dirs[1])
}
