import { problem } from './assets.js'

/** One Studio queues no hidden requests. The lease belongs to a job, not a tab or HTTP exchange. */
export function createActivityGate() {
  let current = null, closed = false
  const labels = { image: 'generating an image', video: 'generating a video', '3d': 'building a 3D model', '3d-load': 'loading a 3D model', '3d-library': 'updating the 3D library' }
  return {
    acquire(kind) {
      if (closed) throw problem(503, 'inactive', 'Tiiny Studio is restarting.')
      if (!Object.hasOwn(labels, kind)) throw new TypeError('Unknown Studio activity.')
      if (current) throw problem(409, current.kind === '3d-library' ? 'studio_library_busy' : 'device_busy', `Studio is ${labels[current.kind]}. Wait for this operation to finish before starting another.`)
      const lease = current = { kind, since: Date.now() }
      // Stale or duplicate finalizers must not unlock a later operation.
      return () => { if (current === lease) current = null }
    },
    snapshot: () => current ? { busy: true, ...current } : { busy: false },
    close() { closed = true },
  }
}
