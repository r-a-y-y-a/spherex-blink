import { PIXEL_ARCSEC } from '@/lib/spherex/cutout'
import type { Crop } from '@/lib/analysis'

/**
 * Sky <-> pixel for the north-up cutout grid (tangent plane at the field centre, east left,
 * row 0 = south). Over a 10′ field the small-angle form is accurate to well under a pixel.
 */
export function skyToPixel(ra: number, dec: number, ra0: number, dec0: number, size: number) {
  const half = (size - 1) / 2
  let dra = ra - ra0
  if (dra > 180) dra -= 360
  if (dra < -180) dra += 360
  const cosd = Math.cos((dec0 * Math.PI) / 180)
  return { x: half - (dra * cosd * 3600) / PIXEL_ARCSEC, y: half + ((dec - dec0) * 3600) / PIXEL_ARCSEC }
}

export function pixelToSky(x: number, y: number, ra0: number, dec0: number, size: number) {
  const half = (size - 1) / 2
  const cosd = Math.cos((dec0 * Math.PI) / 180)
  const ra = ra0 - ((x - half) * PIXEL_ARCSEC) / 3600 / cosd
  return { ra: ((ra % 360) + 360) % 360, dec: dec0 + ((y - half) * PIXEL_ARCSEC) / 3600 }
}

export type Tick = { pos: number; label: string }

const RA_STEPS_S = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600]
const DEC_STEPS_AS = [5, 10, 15, 20, 30, 60, 120, 180, 300, 600]
const MAX_TICKS = 4

function pickStep(span: number, steps: number[]) {
  return steps.find((s) => span / s <= MAX_TICKS) ?? steps[steps.length - 1]
}

function fmtRaTick(sec: number) {
  const t = ((Math.round(sec) % 86400) + 86400) % 86400
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`
}

function fmtDecTick(arcsec: number) {
  const a = Math.abs(Math.round(arcsec))
  const d = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), s = a % 60
  return `${arcsec < 0 ? '−' : '+'}${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″`
}

/**
 * Round-number RA and Dec ticks inside the displayed crop. `pos` runs 0-1 across the image:
 * left to right for RA, bottom to top for Dec.
 */
export function skyTicks(ra0: number, dec0: number, crop: Crop): { ra: Tick[]; dec: Tick[] } {
  const half = (crop.size - 1) / 2
  // Pixel centre coordinates of the crop edges.
  const xL = crop.x0 - 0.5, xR = crop.x0 + crop.n - 0.5
  const yB = crop.y0 - 0.5, yT = crop.y0 + crop.n - 0.5
  const spanAs = crop.n * PIXEL_ARCSEC

  const dec: Tick[] = []
  const decLo = dec0 * 3600 + (yB - half) * PIXEL_ARCSEC
  const dStep = pickStep(spanAs, DEC_STEPS_AS)
  for (let v = Math.ceil(decLo / dStep) * dStep; v <= decLo + spanAs; v += dStep) {
    const y = half + (v - dec0 * 3600) / PIXEL_ARCSEC
    const pos = (y - yB) / (yT - yB)
    if (pos > 0.06 && pos < 0.94) dec.push({ pos, label: fmtDecTick(v) })
  }

  const ra: Tick[] = []
  const cosd = Math.cos((dec0 * Math.PI) / 180)
  if (cosd > 0.02) {
    const spanS = spanAs / 15 / cosd
    const rStep = pickStep(spanS, RA_STEPS_S)
    // RA grows to the left (east), so the right edge has the smallest RA.
    const raRightS = (ra0 * 3600) / 15 - ((xR - half) * PIXEL_ARCSEC) / 15 / cosd
    for (let v = Math.ceil(raRightS / rStep) * rStep; v <= raRightS + spanS; v += rStep) {
      const x = half - ((v - (ra0 * 3600) / 15) * 15 * cosd) / PIXEL_ARCSEC
      const pos = (x - xL) / (xR - xL)
      if (pos > 0.13 && pos < 0.87) ra.push({ pos, label: fmtRaTick(v) })
    }
  }
  return { ra, dec }
}
