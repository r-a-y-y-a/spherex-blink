import { PIXEL_ARCSEC } from './spherex/cutout.ts'

export type FrameMeta = {
  url: string
  obsid: string
  mjd: number
  detector: number
  wave: number
  width: number
  /** Contamination flag bits at the target (absent in data cut before flags were added). */
  flags?: number
}

export type Dataset = {
  ra: number
  dec: number
  size: number
  frames: FrameMeta[]
  /** frames.length * size * size, frame after frame, row 0 = south. */
  pixels: Float32Array
}

export const DETECTOR_BANDS: Record<number, [number, number]> = {
  1: [0.75, 1.09],
  2: [1.1, 1.62],
  3: [1.63, 2.41],
  4: [2.42, 3.82],
  5: [3.83, 4.41],
  6: [4.42, 5.0],
}
export const WAVE_MIN = 0.75
export const WAVE_MAX = 5.0

export type Grouping = 'all' | 'visit' | 'day' | 'exposure'

export type Group = { label: string; mjd: number; visit: number; indices: number[] }

/**
 * Survey passes: SPHEREx revisits most of the sky every ~6 months, so split on gaps over 30
 * days. Near the ecliptic poles it observes continuously, so also cap a pass at 120 days.
 */
export function visitsOf(frames: FrameMeta[]): number[] {
  const order = frames.map((_, i) => i).sort((a, b) => frames[a].mjd - frames[b].mjd)
  const visit = new Array<number>(frames.length).fill(0)
  let v = 0
  let start = order.length ? frames[order[0]].mjd : 0
  order.forEach((idx, k) => {
    const mjd = frames[idx].mjd
    if (k > 0 && (mjd - frames[order[k - 1]].mjd > 30 || mjd - start > 120)) {
      v++
      start = mjd
    }
    visit[idx] = v
  })
  return visit
}

/** Each pass named by its mean date. */
export function visitNamesOf(frames: FrameMeta[], visits: number[]): string[] {
  const sum: number[] = [], count: number[] = []
  frames.forEach((f, i) => {
    sum[visits[i]] = (sum[visits[i]] ?? 0) + f.mjd
    count[visits[i]] = (count[visits[i]] ?? 0) + 1
  })
  return sum.map((s, v) => formatMonth(s / count[v]))
}

export function mjdToDate(mjd: number) {
  return new Date((mjd - 40587) * 86400000)
}

const fmtDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
export const formatDay = (mjd: number) => fmtDay.format(mjdToDate(mjd))
export const formatMonth = (mjd: number) => fmtMonth.format(mjdToDate(mjd))

export function groupFrames(
  ds: Dataset,
  visits: number[],
  range: [number, number],
  grouping: Grouping,
  skipFlagged = false,
  visitNames: string[] = [],
): Group[] {
  const inBand = ds.frames
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.wave >= range[0] && f.wave <= range[1] && !(skipFlagged && f.flags))
    .sort((a, b) => a.f.mjd - b.f.mjd)
  const groups = new Map<string, Group>()
  for (const { f, i } of inBand) {
    const key =
      grouping === 'all'
        ? 'all'
        : grouping === 'visit'
          ? `v${visits[i]}`
          : grouping === 'day'
            ? `d${Math.floor(f.mjd)}`
            : f.obsid
    let g = groups.get(key)
    if (!g) {
      g = { label: '', mjd: 0, visit: visits[i], indices: [] }
      groups.set(key, g)
    }
    g.indices.push(i)
  }
  return [...groups.values()].map((g) => {
    const mjd = g.indices.reduce((s, i) => s + ds.frames[i].mjd, 0) / g.indices.length
    const first = Math.min(...g.indices.map((i) => ds.frames[i].mjd))
    const last = Math.max(...g.indices.map((i) => ds.frames[i].mjd))
    const label =
      grouping === 'all'
        ? `${formatMonth(first)} – ${formatMonth(last)}`
        : grouping === 'visit'
          ? (visitNames[g.visit] ?? formatMonth(mjd))
          : formatDay(mjd)
    return { ...g, mjd, label }
  })
}

export function frameView(ds: Dataset, i: number) {
  const n = ds.size * ds.size
  return ds.pixels.subarray(i * n, (i + 1) * n)
}

/** Per-pixel median of several frames: co-adding beats noise and rejects cosmic rays. */
export function medianStack(ds: Dataset, indices: number[]): Float32Array {
  const n = ds.size * ds.size
  const out = new Float32Array(n)
  if (indices.length === 1) {
    out.set(frameView(ds, indices[0]))
    return out
  }
  const buf = new Float32Array(indices.length)
  for (let p = 0; p < n; p++) {
    let m = 0
    for (const i of indices) {
      const v = ds.pixels[i * n + p]
      if (!Number.isNaN(v)) buf[m++] = v
    }
    if (m === 0) {
      out[p] = NaN
      continue
    }
    const s = buf.subarray(0, m).sort()
    out[p] = m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2
  }
  return out
}

/** Subtracts the median sky level so every frame of a blink shares one zero point. */
export function subtractBackground(img: Float32Array): Float32Array {
  const finite = Array.from(img).filter(Number.isFinite).sort((a, b) => a - b)
  const med = finite.length ? finite[Math.floor(finite.length / 2)] : 0
  return img.map((v) => v - med)
}

/**
 * Fills small holes (saturated cores of bright stars, masked pixels) from their neighbours,
 * so bright stars do not render as black dots. Large empty areas (off the detector) stay NaN.
 */
export function fillHoles(img: Float32Array, size: number): Float32Array {
  const out = img.slice()
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    const src = out.slice()
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        const p = j * size + i
        if (Number.isFinite(src[p])) continue
        let sum = 0, n = 0
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const x = i + di, y = j + dj
            if (x < 0 || y < 0 || x >= size || y >= size) continue
            const v = src[y * size + x]
            if (Number.isFinite(v)) {
              sum = Math.max(sum, v)
              n++
            }
          }
        // Saturated cores are brighter than anything around them: take the brightest neighbour.
        if (n >= 3) {
          out[p] = sum
          changed = true
        }
      }
    if (!changed) break
  }
  return out
}

// One SPHEREx pixel is (6.15")^2 = 8.89e-10 sr, so MJy/sr * pixels -> mJy.
const MJY_PER_PIXEL = ((PIXEL_ARCSEC / 206265) ** 2) * 1e9

/** Aperture flux in mJy at (x, y) with a local-annulus background. Not aperture-corrected. */
export function aperture(img: Float32Array, size: number, x: number, y: number, r = 2) {
  let sum = 0, count = 0
  const bg: number[] = []
  for (let j = Math.floor(y - 8); j <= Math.ceil(y + 8); j++)
    for (let i = Math.floor(x - 8); i <= Math.ceil(x + 8); i++) {
      if (i < 0 || j < 0 || i >= size || j >= size) continue
      const v = img[j * size + i]
      if (!Number.isFinite(v)) continue
      const d = Math.hypot(i - x, j - y)
      if (d <= r) {
        sum += v
        count++
      } else if (d >= 5 && d <= 8) bg.push(v)
    }
  if (count === 0 || bg.length < 8) return NaN
  bg.sort((a, b) => a - b)
  return (sum - count * bg[Math.floor(bg.length / 2)]) * MJY_PER_PIXEL
}

/** Robust display limits from a set of images, so every frame of a blink shares one stretch. */
export function displayRange(images: Float32Array[], crop: Crop, diverging: boolean): [number, number] {
  const vals: number[] = []
  for (const img of images)
    for (let j = crop.y0; j < crop.y0 + crop.n; j += 1)
      for (let i = crop.x0; i < crop.x0 + crop.n; i += 1) {
        const v = img[j * crop.size + i]
        if (Number.isFinite(v)) vals.push(v)
      }
  if (!vals.length) return [0, 1]
  vals.sort((a, b) => a - b)
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
  if (diverging) {
    const m = Math.max(Math.abs(q(0.005)), Math.abs(q(0.995)))
    return [-m, m]
  }
  return [q(0.2), q(0.997)]
}

export type Crop = { size: number; n: number; x0: number; y0: number }

export function centredCrop(size: number, n: number): Crop {
  const m = Math.min(size, n)
  const o = Math.floor((size - m) / 2)
  return { size, n: m, x0: o, y0: o }
}

export type Colormap = 'ir' | 'gray'

function lut(map: Colormap | 'diff'): Uint8ClampedArray {
  const stops: [number, number[]][] =
    map === 'gray'
      ? [[0, [0, 0, 0]], [1, [255, 255, 255]]]
      : map === 'ir'
        ? [[0, [3, 4, 12]], [0.3, [50, 18, 92]], [0.55, [188, 55, 84]], [0.8, [249, 142, 9]], [1, [252, 255, 164]]]
        : [[0, [57, 135, 229]], [0.5, [24, 24, 26]], [1, [217, 89, 38]]]
  const out = new Uint8ClampedArray(256 * 3)
  for (let k = 0; k < 256; k++) {
    const t = k / 255
    let s = 0
    while (s < stops.length - 2 && t > stops[s + 1][0]) s++
    const [t0, c0] = stops[s], [t1, c1] = stops[s + 1]
    const u = (t - t0) / (t1 - t0)
    for (let c = 0; c < 3; c++) out[k * 3 + c] = c0[c] + (c1[c] - c0[c]) * u
  }
  return out
}
const LUTS = { ir: lut('ir'), gray: lut('gray'), diff: lut('diff') }

/** Renders a crop into RGBA with an asinh stretch (diverging + linear for difference images). */
export function renderImage(
  img: Float32Array,
  crop: Crop,
  range: [number, number],
  map: Colormap | 'diff',
): ImageData {
  const { n, x0, y0, size } = crop
  const data = new Uint8ClampedArray(n * n * 4)
  const table = LUTS[map]
  const [lo, hi] = range
  const soft = 0.08
  const norm = Math.asinh(1 / soft)
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const v = img[(y0 + j) * size + (x0 + i)]
      // Canvas row 0 is the top, sky row 0 is south: flip so north is up.
      const o = ((n - 1 - j) * n + i) * 4
      let t: number
      if (!Number.isFinite(v)) t = 0
      else if (map === 'diff') t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
      else t = Math.asinh(Math.min(1, Math.max(0, (v - lo) / (hi - lo))) / soft) / norm
      const k = Math.round(t * 255) * 3
      data[o] = table[k]
      data[o + 1] = table[k + 1]
      data[o + 2] = table[k + 2]
      data[o + 3] = 255
    }
  return new ImageData(data, n, n)
}

/** Gaussian blur (separable, NaN-aware). Brings faint sources above the pixel noise. */
export function smooth(img: Float32Array, size: number, sigma = 0.8): Float32Array {
  const r = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length)
    for (let j = 0; j < size; j++)
      for (let i = 0; i < size; i++) {
        let sum = 0, wsum = 0
        for (let t = -r; t <= r; t++) {
          const x = horizontal ? i + t : i, y = horizontal ? j : j + t
          if (x < 0 || y < 0 || x >= size || y >= size) continue
          const v = src[y * size + x]
          if (!Number.isFinite(v)) continue
          sum += v * k[t + r]
          wsum += k[t + r]
        }
        out[j * size + i] = wsum ? sum / wsum : NaN
      }
    return out
  }
  return pass(pass(img, true), false)
}
