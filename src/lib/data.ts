import type { Dataset, FrameMeta } from './analysis.ts'
import { pool, type FrameRef } from './spherex/cutout.ts'
import { MAX_FRAMES, thinFrames } from './spherex/archive.ts'

const STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/frames`
const BATCH = 40
const PARALLEL_BATCHES = 4

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

/** Spreads frames out so the first batches already cover every pass and detector. */
function interleave<T>(items: T[]): T[] {
  const n = items.length
  const stride = [7919, 7907, 7901].find((p) => n % p !== 0)!
  return items.map((_, i) => items[(i * stride) % n])
}

async function fetchBatch(ra: number, dec: number, size: number, refs: FrameRef[], signal?: AbortSignal) {
  const res = await fetch('/api/cutouts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ra, dec, size, refs }),
    signal,
  })
  if (!res.ok) throw new Error(`Cutout service returned ${res.status}`)
  const buf = await res.arrayBuffer()
  const metaLen = new DataView(buf).getUint32(0, true)
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, metaLen)))
  const start = 4 + metaLen + ((4 - ((4 + metaLen) % 4)) % 4)
  return { frames: meta.frames as FrameMeta[], pixels: new Float32Array(buf, start) }
}

/**
 * Searches the archive, then has the API cut the frames in batches next to the data (the
 * function runs in the same AWS region as NASA's S3 bucket). Calls `onUpdate` as batches land.
 */
export async function loadLive(
  ra: number,
  dec: number,
  size: number,
  onUpdate: (ds: Dataset | null, progress: LiveProgress) => void,
  signal?: AbortSignal,
): Promise<Dataset> {
  onUpdate(null, { phase: 'search', done: 0, total: 0 })
  const res = await fetch(`/api/search?ra=${ra}&dec=${dec}`, { signal })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'Archive search failed')
  const refs = interleave(thinFrames(body.frames as FrameRef[], MAX_FRAMES))
  if (!refs.length) throw new Error('SPHEREx has not observed this position yet.')
  onUpdate(null, { phase: 'frames', done: 0, total: refs.length })

  const n = size * size
  const pixels = new Float32Array(refs.length * n)
  const frames: FrameMeta[] = []
  const batches = Array.from({ length: Math.ceil(refs.length / BATCH) }, (_, i) => refs.slice(i * BATCH, (i + 1) * BATCH))
  let done = 0
  const snapshot = (): Dataset => ({ ra, dec, size, frames: [...frames], pixels: pixels.subarray(0, frames.length * n) })

  await pool(
    batches,
    PARALLEL_BATCHES,
    (batch) => fetchBatch(ra, dec, size, batch, signal),
    (result, batch) => {
      done += batch.length
      if (!(result instanceof Error)) {
        pixels.set(result.pixels, frames.length * n)
        frames.push(...result.frames)
      }
      onUpdate(frames.length ? snapshot() : null, { phase: 'frames', done, total: refs.length })
    },
    2,
  )
  if (!frames.length) throw new Error('Could not read any SPHEREx frames for this position.')
  return snapshot()
}
