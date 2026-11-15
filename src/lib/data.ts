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
  const ds: Dataset = { ra: manifest.ra, dec: manifest.dec, size: manifest.size, frames: manifest.frames, pixels }
  // Its frame list doubles as a head start for panning to the neighbouring patches.
  rememberRefs(ds.ra, ds.dec, ds.frames)
  return ds
}

export type LiveProgress = { phase: 'search' | 'frames'; done: number; total: number }

/** Spreads frames out so the first batches already cover every pass and detector. */
function interleave<T>(items: T[]): T[] {
  const n = items.length
  if (!n) return items
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

async function searchFrames(ra: number, dec: number, signal?: AbortSignal): Promise<FrameRef[]> {
  const res = await fetch(`/api/search?ra=${ra}&dec=${dec}`, { signal })
  // A platform timeout returns an HTML/text page, not JSON, so never assume a JSON body.
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `The archive search failed (HTTP ${res.status}). Try again shortly.`)
  const refs = body.frames as FrameRef[]
  rememberRefs(ra, dec, refs)
  return refs
}

// --- Frame lists from recent searches -----------------------------------------------------------
// A SPHEREx image is about 3.5° across while a view is at most 10′, so the images covering one
// position almost all cover its neighbours too. Reusing a nearby list skips the archive search.

const REUSE_WITHIN_DEG = 0.5
const MAX_REMEMBERED = 30
const remembered: { ra: number; dec: number; refs: FrameRef[] }[] = []

function sepDeg(ra1: number, dec1: number, ra2: number, dec2: number) {
  let dra = Math.abs(ra1 - ra2)
  if (dra > 180) dra = 360 - dra
  return Math.hypot(dra * Math.cos((((dec1 + dec2) / 2) * Math.PI) / 180), dec1 - dec2)
}

function rememberRefs(ra: number, dec: number, refs: FrameRef[]) {
  if (!refs.length) return
  remembered.unshift({ ra, dec, refs: refs.map(({ url, mjd, detector, obsid }) => ({ url, mjd, detector, obsid })) })
  remembered.length = Math.min(remembered.length, MAX_REMEMBERED)
}

/**
 * Where an Explore-mode view started: a seeded target (its manifest lists every frame) or a
 * searched position (its archive search is cached by the API). Its frame list lets a shared
 * Explore link start cutting at once, even when NASA's archive search is slow or down.
 */
export type Origin = { slug: string } | { ra: number; dec: number }

async function originRefs(origin: Origin, signal: AbortSignal) {
  if ('slug' in origin) {
    const res = await fetch(`${STORAGE}/${origin.slug}/manifest.json`, { signal })
    if (!res.ok) return
    const m = await res.json()
    rememberRefs(m.ra, m.dec, m.frames)
  } else {
    await searchFrames(origin.ra, origin.dec, signal)
  }
}

function nearbyRefs(ra: number, dec: number): FrameRef[] | null {
  let best: (typeof remembered)[number] | null = null
  let bestSep = REUSE_WITHIN_DEG
  for (const r of remembered) {
    const s = sepDeg(ra, dec, r.ra, r.dec)
    if (s < bestSep) [best, bestSep] = [r, s]
  }
  return best?.refs ?? null
}

/**
 * Searches the archive, then has the API cut the frames in batches next to the data (the
 * function runs in the same AWS region as NASA's S3 bucket). Calls `onUpdate` as batches land.
 * Near a position searched before, it starts cutting that list straight away while the search
 * for this exact spot runs alongside, then adds any frames only the new search found.
 */
async function fetchLive(
  ra: number,
  dec: number,
  size: number,
  onUpdate: (ds: Dataset | null, progress: LiveProgress) => void,
  signal: AbortSignal,
  origin?: Origin,
): Promise<Dataset> {
  const search = searchFrames(ra, dec, signal)
  search.catch(() => {})
  let reuse = nearbyRefs(ra, dec)
  if (!reuse && origin) {
    onUpdate(null, { phase: 'search', done: 0, total: 0 })
    // Whichever answers first: the start's frame list, or this spot's own search.
    await Promise.race([originRefs(origin, signal).catch(() => {}), search.catch(() => {})])
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    reuse = nearbyRefs(ra, dec)
  }
  onUpdate(null, { phase: reuse ? 'frames' : 'search', done: 0, total: 0 })

  const n = size * size
  let pixels = new Float32Array(0)
  const frames: FrameMeta[] = []
  const tried = new Set<string>()
  let done = 0
  let total = 0
  const snapshot = (): Dataset => ({ ra, dec, size, frames: [...frames], pixels: pixels.subarray(0, frames.length * n) })

  const cut = async (refs: FrameRef[]) => {
    refs.forEach((r) => tried.add(r.url))
    total += refs.length
    const grown = new Float32Array((frames.length + refs.length) * n)
    grown.set(pixels.subarray(0, frames.length * n))
    pixels = grown
    onUpdate(frames.length ? snapshot() : null, { phase: 'frames', done, total })
    const batches = Array.from({ length: Math.ceil(refs.length / BATCH) }, (_, i) => refs.slice(i * BATCH, (i + 1) * BATCH))
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
        onUpdate(frames.length ? snapshot() : null, { phase: 'frames', done, total })
      },
      2,
    )
  }

  if (reuse) await cut(interleave(thinFrames(reuse, MAX_FRAMES)))
  let found: FrameRef[] = []
  try {
    found = await search
  } catch (err) {
    if (!reuse || frames.length === 0 || (err as Error).name === 'AbortError') throw err
  }
  const extra = found.filter((r) => !tried.has(r.url))
  const room = MAX_FRAMES - frames.length
  if (extra.length && room > 0) await cut(interleave(thinFrames(extra, room)))
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')

  if (!frames.length) {
    if (!found.length && !reuse) throw new Error('SPHEREx has not observed this position yet.')
    throw new Error('Could not read any SPHEREx frames for this position.')
  }
  // Batches land out of order; keep frames in time order like a fresh load.
  const order = frames.map((_, i) => i).sort((a, b) => frames[a].mjd - frames[b].mjd)
  const sorted = new Float32Array(frames.length * n)
  order.forEach((i, k) => sorted.set(pixels.subarray(i * n, (i + 1) * n), k * n))
  return { ra, dec, size, frames: order.map((i) => frames[i]), pixels: sorted }
}

// --- Shared, cached live loads --------------------------------------------------------------------
// The viewer and the neighbour preloader ask for patches through one cache, so a patch being
// preloaded is picked up mid-flight when the user steps onto it, and stepping back is instant.

type Entry = {
  promise: Promise<Dataset>
  ctrl: AbortController
  latest: Dataset | null
  progress: LiveProgress | null
  listeners: Set<(ds: Dataset | null, p: LiveProgress) => void>
  users: number
  done: boolean
  used: number
}

// The current patch, its four neighbours and the one just left.
const MAX_KEPT = 6
const entries = new Map<string, Entry>()

export const patchKey = (ra: number, dec: number, size: number) => `${ra.toFixed(5)},${dec.toFixed(5)},${size}`

function startEntry(ra: number, dec: number, size: number, origin?: Origin): Entry {
  const key = patchKey(ra, dec, size)
  const ctrl = new AbortController()
  const entry: Entry = { promise: null!, ctrl, latest: null, progress: null, listeners: new Set(), users: 0, done: false, used: Date.now() }
  entry.promise = fetchLive(ra, dec, size, (ds, p) => {
    entry.latest = ds
    entry.progress = p
    entry.listeners.forEach((l) => l(ds, p))
  }, ctrl.signal, origin).then(
    (ds) => {
      entry.done = true
      entry.latest = ds
      evict()
      return ds
    },
    (err) => {
      // A failed or cancelled load is forgotten so the next visit tries again.
      if (entries.get(key) === entry) entries.delete(key)
      throw err
    },
  )
  entry.promise.catch(() => {})
  entries.set(key, entry)
  return entry
}

function evict() {
  const finished = [...entries.entries()].filter(([, e]) => e.done && e.users === 0).sort((a, b) => a[1].used - b[1].used)
  while (entries.size > MAX_KEPT && finished.length) entries.delete(finished.shift()![0])
}

/** True when the patch is fully loaded and would show instantly. */
export const isPatchReady = (ra: number, dec: number, size: number) => entries.get(patchKey(ra, dec, size))?.done ?? false

/**
 * Loads a live patch, sharing any load already running or finished for the same spot. Aborting
 * `signal` only stops this caller listening; the load itself keeps going if a preload wants it.
 */
export function loadLive(
  ra: number,
  dec: number,
  size: number,
  onUpdate: (ds: Dataset | null, progress: LiveProgress) => void,
  signal: AbortSignal,
  origin?: Origin,
): Promise<Dataset> {
  const key = patchKey(ra, dec, size)
  const entry = entries.get(key) ?? startEntry(ra, dec, size, origin)
  entry.users++
  entry.used = Date.now()
  if (entry.progress) onUpdate(entry.latest, entry.progress)
  entry.listeners.add(onUpdate)
  return new Promise<Dataset>((resolve, reject) => {
    const release = () => {
      entry.listeners.delete(onUpdate)
      entry.users--
    }
    const onAbort = () => {
      release()
      if (!entry.done && entry.users === 0 && !wanted.has(key)) {
        entry.ctrl.abort()
        entries.delete(key)
      }
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    entry.promise.then(
      (ds) => {
        signal.removeEventListener('abort', onAbort)
        release()
        resolve(ds)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        release()
        reject(err)
      },
    )
  })
}

// --- Neighbour preloading -------------------------------------------------------------------------

const wanted = new Set<string>()
let preloadRun = 0

/**
 * Preloads the given patches in the background, all at once. A new call replaces
 * the previous list: unfinished preloads that are no longer wanted (and nobody is viewing) stop.
 */
export function preloadPatches(list: { ra: number; dec: number; size: number }[], onReady: () => void) {
  const run = ++preloadRun
  wanted.clear()
  list.forEach((p) => wanted.add(patchKey(p.ra, p.dec, p.size)))
  for (const [key, e] of entries)
    if (!e.done && e.users === 0 && !wanted.has(key)) {
      e.ctrl.abort()
      entries.delete(key)
    }
  for (const p of list) {
    const e = entries.get(patchKey(p.ra, p.dec, p.size)) ?? startEntry(p.ra, p.dec, p.size)
    // A neighbour that fails to preload just loads normally if the user steps there.
    e.promise.then(() => run === preloadRun && onReady(), () => {})
  }
}
