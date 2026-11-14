import type { Dataset, FrameMeta } from './analysis.ts'
import { fetchFrame, pool, type FrameRef } from './spherex/cutout.ts'
import { MAX_FRAMES, thinFrames } from './spherex/archive.ts'

const STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/frames`

/** Loads a pre-baked demo target from Supabase Storage. */
export async function loadSeeded(slug: string, signal?: AbortSignal): Promise<Dataset> {
  const [mRes, pRes] = await Promise.all([
    fetch(`${STORAGE}/${slug}/manifest.json`, { signal }),
    fetch(`${STORAGE}/${slug}/pixels.bin`, { signal }),
  ])
  if (!mRes.ok || !pRes.ok) throw new Error('Could not load the cached SPHEREx frames for this target.')
  const manifest = await mRes.json()
  const pixels = new Float32Array(await pRes.arrayBuffer())
  return { ra: manifest.ra, dec: manifest.dec, size: manifest.size, frames: manifest.frames, pixels }
}

export type LiveProgress = { phase: 'search' | 'frames'; done: number; total: number }

/**
 * Searches the archive (via our API, since IRSA has no CORS) and then cuts every frame
 * straight from the public S3 bucket in the browser. Calls `onUpdate` as frames arrive.
 */
export async function loadLive(
  ra: number,
  dec: number,
  size: number,
  onUpdate: (ds: Dataset, progress: LiveProgress) => void,
  signal?: AbortSignal,
): Promise<Dataset> {
  const empty: Dataset = { ra, dec, size, frames: [], pixels: new Float32Array(0) }
  onUpdate(empty, { phase: 'search', done: 0, total: 0 })
  const res = await fetch(`/api/search?ra=${ra}&dec=${dec}`, { signal })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'Archive search failed')
  const refs = thinFrames(body.frames as FrameRef[], MAX_FRAMES)
  if (!refs.length) throw new Error('SPHEREx has not observed this position yet.')

  const n = size * size
  const pixels = new Float32Array(refs.length * n)
  const frames: FrameMeta[] = []
  let lastEmit = 0
  const emit = (done: number) => {
    const ds = { ra, dec, size, frames: [...frames], pixels: pixels.subarray(0, frames.length * n) }
    onUpdate(ds, { phase: 'frames', done, total: refs.length })
    return ds
  }
  await pool(
    refs,
    40,
    (ref) => fetchFrame(ref, ra, dec, size, signal),
    (result, _ref, done) => {
      if (!(result instanceof Error)) {
        pixels.set(result.pixels, frames.length * n)
        const { pixels: _p, size: _s, ...meta } = result
        frames.push(meta)
      }
      if (done === refs.length || performance.now() - lastEmit > 400) {
        lastEmit = performance.now()
        emit(done)
      }
    },
  )
  if (!frames.length) throw new Error('Could not read any SPHEREx frames for this position.')
  return emit(refs.length)
}
