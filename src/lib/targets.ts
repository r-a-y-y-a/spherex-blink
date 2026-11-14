// The five test targets named in the challenge. Positions and proper motions from SIMBAD
// (ICRS, epoch J2000, proper motion in mas/yr), so we can place each one where SPHEREx saw it.

export type Target = {
  slug: string
  name: string
  kind: string
  blurb: string
  ra2000: number
  dec2000: number
  pmra: number // mas/yr, includes cos(dec)
  pmdec: number // mas/yr
  /** Detector where the object stands out best (1-6, 0.75-5 um). */
  bestDetector: number
  /** View settings applied when the target is opened from its card. */
  defaults?: Record<string, string>
}

export const TARGETS: Target[] = [
  {
    slug: 'wise-0855',
    name: 'WISE 0855−0714',
    kind: 'Brown dwarf',
    blurb: 'The coldest known brown dwarf. At short wavelengths you only see a star it is passing; at 4.5 µm the light shifts onto the brown dwarf.',
    ra2000: 133.81890825,
    dec2000: -7.247048,
    pmra: -8123.7,
    pmdec: 673.2,
    bestDetector: 6,
    // Faint: one deep smoothed stack, with Gaia showing the background star it is passing.
    defaults: { group: 'all', smooth: '1', gaia: '1', fov: '32' },
  },
  {
    slug: 'barnards-star',
    name: "Barnard's Star",
    kind: 'Red dwarf',
    blurb: 'The fastest-moving star in our sky, crossing the width of the Moon every 180 years.',
    ra2000: 269.4520769586,
    dec2000: 4.6933649666,
    pmra: -801.551,
    pmdec: 10362.394,
    bestDetector: 3,
  },
  {
    slug: 'eps-indi-b',
    name: 'Epsilon Indi B',
    kind: 'Brown dwarf pair',
    blurb: 'Two brown dwarfs orbiting each other and the nearby star Epsilon Indi A, 12 light-years away.',
    ra2000: 331.0441465885,
    dec2000: -56.7828441951,
    pmra: 3981.977,
    pmdec: -2466.832,
    bestDetector: 5,
  },
  {
    slug: 'rw-aur',
    name: 'RW Aurigae',
    kind: 'Variable young star',
    blurb: 'A young star still wrapped in its birth disk, which dims and flares unpredictably.',
    ra2000: 76.9565260346,
    dec2000: 30.4014381739,
    pmra: 7.23,
    pmdec: -20.33,
    bestDetector: 3,
  },
  {
    slug: 'r-dra',
    name: 'R Draconis',
    kind: 'Mira variable',
    blurb: 'A pulsating red giant whose brightness swings over a 246-day cycle.',
    ra2000: 248.16761083295,
    dec2000: 66.75497941722,
    pmra: -20.643,
    pmdec: 6.149,
    bestDetector: 2,
    // On the ecliptic pole, so SPHEREx sees it almost continuously: per-day frames show the pulsation.
    defaults: { group: 'day' },
  },
]

/** Position at a decimal year, applying proper motion linearly (fine over decades). */
export function positionAt(t: Target, year: number): { ra: number; dec: number } {
  const dt = year - 2000
  const dec = t.dec2000 + (t.pmdec * dt) / 3.6e6
  const ra = t.ra2000 + (t.pmra * dt) / 3.6e6 / Math.cos((t.dec2000 * Math.PI) / 180)
  return { ra: ((ra % 360) + 360) % 360, dec }
}

/** Mid-point of the SPHEREx data so far (May 2025 - May 2026). */
export const SPHEREX_EPOCH = 2025.95

export const mjdToYear = (mjd: number) => 2000 + (mjd - 51544.5) / 365.25

export function findTarget(slug: string | null) {
  return TARGETS.find((t) => t.slug === slug)
}
