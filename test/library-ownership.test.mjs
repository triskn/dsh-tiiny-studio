import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createWorkbench } from '../workbench.js'
import { assetStore } from '../assets.js'

async function owned(t) {
  const parent = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(parent, 'studio-owned-'))
  t.after(async () => {
    const target = await fs.realpath(root)
    assert.equal(target, root); assert.equal(path.dirname(target), parent); assert.match(path.basename(target), /^studio-owned-[a-zA-Z0-9]+$/)
    await fs.rm(target, { recursive: true }) // This fixture's exact temporary root only.
  })
  return root
}

test('forgetting an unavailable standalone listing never removes an externally replaced media file', async t => {
  const root = await owned(t), home = path.join(root, 'store'), out = path.join(root, 'old-output')
  await fs.mkdir(home); await fs.mkdir(out)
  const prev = { home: process.env.TIINY_VIDEO_HOME, out: process.env.TIINY_OUTPUT_DIR }
  process.env.TIINY_VIDEO_HOME = home; process.env.TIINY_OUTPUT_DIR = out
  const app = createWorkbench()
  t.after(async () => {
    await app.dispose()
    for (const [k, v] of [['TIINY_VIDEO_HOME', prev.home], ['TIINY_OUTPUT_DIR', prev.out]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  })
  const name = 'tiiny-video-kept.mp4', target = path.join(out, name)
  await fs.writeFile(target, Buffer.from('original'))
  await fs.writeFile(path.join(home, 'history.json'), JSON.stringify([{ id: 'job', kind: 'video', prompt: 'original', status: 'completed', phase: 'completed', file: name, outputDir: out }]))
  await app.remove({ id: 'job', scope: 'job' })
  const { jobs: [saved] } = await app.list(); assert.ok(saved.hasOutput && saved.outputToken); assert.ok(saved.id.startsWith('file:kept:'))
  await fs.writeFile(target, 'a replaced export that does not belong to the old job')
  assert.equal((await app.get(saved.id)).canForget, true)
  await assert.rejects(app.remove({ id: saved.id, scope: 'output', outputToken: saved.outputToken }), e => e.code === 'stale_output')
  await app.remove({ id: saved.id, scope: 'output', outputToken: '' })
  await assert.rejects(app.get(saved.id), e => e.status === 404)
  assert.equal(await fs.readFile(target, 'utf8'), 'a replaced export that does not belong to the old job')
})

test('private image cleanup never follows a redirected asset folder or deletes a substituted file', async t => {
  const root = await owned(t), data = path.join(root, 'data'), outside = path.join(root, 'outside'), assets = path.join(data, 'assets')
  await fs.mkdir(data); await fs.mkdir(outside)
  const bytes = Buffer.alloc(32, 42), id = createHash('sha256').update(bytes).digest('hex') + '.png'
  const sentinel = path.join(outside, id); await fs.writeFile(sentinel, bytes); await fs.symlink(outside, assets, 'dir')
  const store = assetStore(data); assert.equal(await store.exists(id), false); await store.drop(id)
  assert.deepEqual(await fs.readFile(sentinel), bytes)
  assert.equal((await fs.lstat(assets)).isSymbolicLink(), true); assert.equal(await fs.readlink(assets), outside)
  await fs.unlink(assets) // Remove just the verified, test-owned symlink, not its target.
  await fs.mkdir(assets); const replacement = path.join(assets, id); await fs.writeFile(replacement, 'replacement'); await store.drop(id)
  assert.equal(await fs.readFile(replacement, 'utf8'), 'replacement')
})
