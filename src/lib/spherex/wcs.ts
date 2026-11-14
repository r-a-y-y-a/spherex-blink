// Minimal FITS header parsing and TAN-SIP world <-> pixel maths for SPHEREx L2 images.
// Runs in the browser and in Node. Pixel coordinates are 0-based throughout.

export type Header = Map<string, string | number>

const D2R = Math.PI / 180

/** Parses one FITS header starting at `offset`. Returns null if END is not in the buffer yet. */
export function parseHeader(bytes: Uint8Array, offset: number): { header: Header; end: number } | null {
  const header: Header = new Map()
  const decoder = new TextDecoder('ascii')
  for (let i = offset; i + 80 <= bytes.length; i += 80) {
    const card = decoder.decode(bytes.subarray(i, i + 80))
    const key = card.slice(0, 8).trim()
    if (key === 'END') {
      // Headers are padded to whole 2880-byte blocks.
      return { header, end: Math.ceil((i + 80) / 2880) * 2880 }
    }
    if (card.slice(8, 10) !== '= ') continue
    const raw = card.slice(10)
    if (raw.trimStart().startsWith("'")) {
      const m = raw.match(/'((?:[^']|'')*)'/)
      header.set(key, m ? m[1].replace(/''/g, "'").trimEnd() : '')
    } else {
      const v = raw.split('/')[0].trim()
      const n = Number(v.replace(/D/g, 'E'))
      header.set(key, Number.isFinite(n) && v !== '' ? n : v)
    }
  }
  return null
}

export function num(h: Header, key: string, fallback?: number): number {
  const v = h.get(key)
  if (typeof v === 'number') return v
  if (fallback !== undefined) return fallback
  throw new Error(`FITS header is missing ${key}`)
}

type Poly = { order: number; c: Map<string, number> }

function readPoly(h: Header, prefix: string): Poly | null {
  const order = h.get(`${prefix}_ORDER`)
  if (typeof order !== 'number') return null
  const c = new Map<string, number>()
  for (let p = 0; p <= order; p++)
    for (let q = 0; q <= order - p; q++) {
      const v = h.get(`${prefix}_${p}_${q}`)
      if (typeof v === 'number') c.set(`${p}_${q}`, v)
    }
  return { order, c }
}

function evalPoly(poly: Poly | null, u: number, v: number) {
  if (!poly) return 0
  let s = 0
  for (const [k, coef] of poly.c) {
    const [p, q] = k.split('_').map(Number)
    s += coef * u ** p * v ** q
  }
  return s
}

export class TanSipWcs {
  private crpix: [number, number]
  private crval: [number, number]
  private inv: [number, number, number, number]
  private ap: Poly | null
  private bp: Poly | null

  constructor(h: Header) {
    this.crpix = [num(h, 'CRPIX1'), num(h, 'CRPIX2')]
    this.crval = [num(h, 'CRVAL1'), num(h, 'CRVAL2')]
    const c1 = num(h, 'CDELT1', 1)
    const c2 = num(h, 'CDELT2', 1)
    const cd = [
      num(h, 'CD1_1', num(h, 'PC1_1', 1) * c1),
      num(h, 'CD1_2', num(h, 'PC1_2', 0) * c1),
      num(h, 'CD2_1', num(h, 'PC2_1', 0) * c2),
      num(h, 'CD2_2', num(h, 'PC2_2', 1) * c2),
    ]
    const det = cd[0] * cd[3] - cd[1] * cd[2]
    this.inv = [cd[3] / det, -cd[1] / det, -cd[2] / det, cd[0] / det]
    this.ap = readPoly(h, 'AP')
    this.bp = readPoly(h, 'BP')
  }

  /** RA/Dec in degrees -> 0-based pixel (x, y). */
  worldToPixel(ra: number, dec: number): [number, number] {
    const [xi, eta] = project(ra, dec, this.crval[0], this.crval[1])
    const [i0, i1, i2, i3] = this.inv
    const u = i0 * xi + i1 * eta
    const v = i2 * xi + i3 * eta
    const uu = u + evalPoly(this.ap, u, v)
    const vv = v + evalPoly(this.bp, u, v)
    return [uu + this.crpix[0] - 1, vv + this.crpix[1] - 1]
  }
}

/** Gnomonic projection of (ra, dec) about (ra0, dec0); returns standard coordinates in degrees. */
export function project(ra: number, dec: number, ra0: number, dec0: number): [number, number] {
  const a = ra * D2R, d = dec * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0)
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc
  return [xi / D2R, eta / D2R]
}

/** Inverse gnomonic projection: standard coordinates (deg) about (ra0, dec0) -> RA/Dec in degrees. */
export function deproject(xi: number, eta: number, ra0: number, dec0: number): [number, number] {
  const x = xi * D2R, y = eta * D2R, a0 = ra0 * D2R, d0 = dec0 * D2R
  const rho = Math.hypot(x, y)
  if (rho === 0) return [ra0, dec0]
  const c = Math.atan(rho)
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (y * Math.sin(c) * Math.cos(d0)) / rho)
  const ra = a0 + Math.atan2(x * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - y * Math.sin(d0) * Math.sin(c))
  return [((ra / D2R) % 360 + 360) % 360, dec / D2R]
}
