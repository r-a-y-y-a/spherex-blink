import { deproject, num, parseHeader, TanSipWcs } from './wcs.ts'
import { wavelengthAt } from './wavelength.ts'
import { CONTAMINATION_MASK } from './flags.ts'
import { riceDecompress32 } from './rice.ts'

/** SPHEREx native pixel scale, arcsec. Output grids use it so no detail is invented or lost. */
export const PIXEL_ARCSEC = 6.15

export type FrameRef = { url: string; mjd: number; detector: number; obsid: string }

export type Frame = FrameRef & {
  /** size x size, row 0 = south edge, column 0 = east edge (sky view: north up, east left). */
  pixels: Float32Array
  size: number
  /** Wavelength (um) and bandwidth seen at the target position in this exposure. */
  wave: number
  width: number
  /** OR of contamination flag bits on the detector pixels within 2 px of the target. */
  flags: number
}

const HEADER_GUESS = 57600 // primary + IMAGE headers fit in this for every file seen so far

async function getRange(url: string, start: number, endExclusive: number, signal?: AbortSignal) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${endExclusive - 1}` }, signal })
  if (res.status !== 206 && res.status !== 200) throw new Error(`S3 returned ${res.status} for ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function readHeaders(url: string, signal?: AbortSignal) {
  let bytes = await getRange(url, 0, HEADER_GUESS, signal)
  for (let attempt = 0; attempt < 3; attempt++) {
    const primary = parseHeader(bytes, 0)
    const image = primary && parseHeader(bytes, primary.end)
    if (image) return { header: image.header, dataStart: image.end }
    bytes = await getRange(url, 0, bytes.length * 2, signal)
  }
  throw new Error(`Could not find the IMAGE header in ${url}`)
}

/**
 * Cuts a size x size, north-up patch centred on (ra, dec) out of one SPHEREx L2 file,
 * using two HTTP Range reads: the headers, then only the image rows that cover the patch.
 */
export async function fetchFrame(
  ref: FrameRef,
  ra: number,
  dec: number,
  size: number,
  signal?: AbortSignal,
): Promise<Frame> {
  const { header, dataStart } = await readHeaders(ref.url, signal)
  const nx = num(header, 'NAXIS1')
  const ny = num(header, 'NAXIS2')
  const wcs = new TanSipWcs(header)

  // Source pixel for every output pixel. Output: east to the left, north up, native scale.
  const step = PIXEL_ARCSEC / 3600
  const half = (size - 1) / 2
  const src = new Float64Array(size * size * 2)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const [r, d] = deproject((half - i) * step, (j - half) * step, ra, dec)
      const [x, y] = wcs.worldToPixel(r, d)
      const k = (j * size + i) * 2
      src[k] = x
      src[k + 1] = y
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }

  const y0 = Math.max(0, Math.floor(minY) - 1)
  const y1 = Math.min(ny - 1, Math.ceil(maxY) + 1)
  if (y1 < y0 || maxX < 0 || minX > nx - 1) throw new Error(`Target is off the detector in ${ref.obsid}`)

  // IMAGE is big-endian float32, row-major; one contiguous read covers rows y0..y1.
  const rowBytes = nx * 4
  const [tx, ty] = wcs.worldToPixel(ra, dec)
  const [raw, flags] = await Promise.all([
    getRange(ref.url, dataStart + y0 * rowBytes, dataStart + (y1 + 1) * rowBytes, signal),
    readTargetFlags(ref.url, dataStart + nx * ny * 4, tx, ty, signal).catch(() => 0),
  ])
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const at = (x: number, y: number) =>
    x < 0 || x >= nx || y < y0 || y > y1 ? NaN : view.getFloat32(((y - y0) * nx + x) * 4, false)

  const pixels = new Float32Array(size * size)
  for (let p = 0; p < size * size; p++) {
    const x = src[p * 2], y = src[p * 2 + 1]
    const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy
    const a = at(fx, fy), b = at(fx + 1, fy), c = at(fx, fy + 1), d = at(fx + 1, fy + 1)
    pixels[p] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
  }

  const { wave, width } = wavelengthAt(ref.detector, tx, ty)
  return { ...ref, mjd: num(header, 'MJD-AVG', ref.mjd), pixels, size, wave, width, flags }
}

/**
 * Reads the FLAGS extension and ORs the contamination bits on the pixels within 2 px of the
 * target. FLAGS follows IMAGE (2040 x 2040 x 4 bytes is a whole number of FITS blocks, so it
 * starts right after the image data) and is RICE-compressed, one tile per row: a table of
 * (byte count, heap offset) descriptors, then a heap holding the compressed rows.
 */
async function readTargetFlags(url: string, hduStart: number, tx: number, ty: number, signal?: AbortSignal) {
  const head = await getRange(url, hduStart, hduStart + 2880 * 8, signal)
  const parsed = parseHeader(head, 0)
  const h = parsed?.header
  if (!parsed || !h || h.get('EXTNAME') !== 'FLAGS' || h.get('ZCMPTYPE') !== 'RICE_1' || num(h, 'ZTILE2', 0) !== 1) return 0
  const rowLen = num(h, 'ZNAXIS1')
  const nRows = num(h, 'ZNAXIS2')
  const block = num(h, 'ZVAL1', 32)
  const tableStart = hduStart + parsed.end
  const heapStart = tableStart + num(h, 'THEAP', num(h, 'NAXIS1') * num(h, 'NAXIS2'))

  const fy0 = Math.max(0, Math.floor(ty - 2)), fy1 = Math.min(nRows - 1, Math.ceil(ty + 2))
  const fx0 = Math.max(0, Math.floor(tx - 2)), fx1 = Math.min(rowLen - 1, Math.ceil(tx + 2))
  if (fy1 < fy0 || fx1 < fx0) return 0

  const desc = await getRange(url, tableStart + fy0 * 8, tableStart + (fy1 + 1) * 8, signal)
  const dv = new DataView(desc.buffer, desc.byteOffset, desc.byteLength)
  const tiles = Array.from({ length: fy1 - fy0 + 1 }, (_, k) => ({ len: dv.getInt32(k * 8, false), off: dv.getInt32(k * 8 + 4, false) }))
  const lo = Math.min(...tiles.map((t) => t.off))
  const hi = Math.max(...tiles.map((t) => t.off + t.len))
  const heap = await getRange(url, heapStart + lo, heapStart + hi, signal)

  let flags = 0
  tiles.forEach((t, k) => {
    const y = fy0 + k
    const row = riceDecompress32(heap.subarray(t.off - lo, t.off - lo + t.len), rowLen, block)
    for (let x = fx0; x <= fx1; x++) if (Math.hypot(x - tx, y - ty) <= 2) flags |= row[x]
  })
  return flags & CONTAMINATION_MASK
}

/** Runs `fn` over `items` with at most `limit` in flight, retrying each up to `retries` times. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  onResult?: (result: R | Error, item: T, done: number) => void,
  retries = 3,
): Promise<(R | Error)[]> {
  const results: (R | Error)[] = new Array(items.length)
  let next = 0, done = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      let result: R | Error = new Error('not run')
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          result = await fn(items[idx])
          break
        } catch (err) {
          result = err as Error
          if ((err as Error).name === 'AbortError') break
          await new Promise((r) => setTimeout(r, 300 * 2 ** attempt))
        }
      }
      results[idx] = result
      onResult?.(result, items[idx], ++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
