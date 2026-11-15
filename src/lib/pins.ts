/** Pins: user marks fixed to a sky position, with the date of the frame they were dropped on. */
export type Pin = { ra: number; dec: number; mjd: number }

/** URL form: `ra,dec,mjd;ra,dec,mjd`. */
export function parsePins(s: string | null): Pin[] {
  if (!s) return []
  return s
    .split(';')
    .map((p) => p.split(',').map(Number))
    .filter((v) => v.length === 3 && v.every(Number.isFinite))
    .map(([ra, dec, mjd]) => ({ ra, dec, mjd }))
    .slice(0, 20)
}

export function serializePins(pins: Pin[]): string | null {
  return pins.length ? pins.map((p) => `${p.ra.toFixed(5)},${p.dec.toFixed(5)},${p.mjd.toFixed(2)}`).join(';') : null
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** Separation and motion of `to` relative to `from`, on the sky. */
export function motion(from: Pin, to: Pin) {
  const cosd = Math.cos((((from.dec + to.dec) / 2) * Math.PI) / 180)
  let dra = to.ra - from.ra
  if (dra > 180) dra -= 360
  if (dra < -180) dra += 360
  const east = dra * cosd * 3600
  const north = (to.dec - from.dec) * 3600
  const sep = Math.hypot(east, north)
  const years = (to.mjd - from.mjd) / 365.25
  // Position angle: degrees east of north, the astronomers' convention.
  const pa = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
  return {
    sep,
    years,
    rate: Math.abs(years) > 1 / 365 ? sep / Math.abs(years) : null,
    pa,
    direction: COMPASS[Math.round(pa / 45) % 8],
  }
}
