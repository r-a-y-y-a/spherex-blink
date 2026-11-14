import type { FrameRef } from './cutout.ts'

// IRSA has no CORS headers, so this runs server-side (API route and seed script).
const TAP_URL = 'https://irsa.ipac.caltech.edu/TAP/sync'
// Public S3 mirror of the same files: CORS open and supports Range reads.
const S3_BASE = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/'

/**
 * Keeps at most `max` frames, spread evenly in time within each detector, so spectra keep
 * every band and light curves keep their full time span. Deep-field positions (near the
 * ecliptic poles) have thousands of exposures, far more than a browser needs.
 */
export function thinFrames(refs: FrameRef[], max: number): FrameRef[] {
  if (refs.length <= max) return refs
  const keep: FrameRef[] = []
  for (let d = 1; d <= 6; d++) {
    const det = refs.filter((r) => r.detector === d)
    const quota = Math.round((det.length / refs.length) * max)
    const step = det.length / Math.max(1, quota)
    for (let k = 0; k < quota; k++) keep.push(det[Math.floor(k * step)])
  }
  return keep.sort((a, b) => a.mjd - b.mjd)
}

export const MAX_FRAMES = 600

/**
 * Every SPHEREx spectral image covering (ra, dec), oldest first. Not tied to a release:
 * new quick-release and data-release images appear here as IRSA ingests them.
 */
export async function searchArchive(ra: number, dec: number): Promise<FrameRef[]> {
  const query = `SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname
    FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
    ORDER BY p.time_bounds_lower`
  const body = new URLSearchParams({ QUERY: query, FORMAT: 'csv', LANG: 'ADQL' })
  const res = await fetch(TAP_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`IRSA TAP returned ${res.status}`)
  const text = await res.text()
  if (!text.startsWith('uri,')) throw new Error(`IRSA TAP: ${text.slice(0, 200)}`)
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','))
    .filter((cols) => cols.length >= 3 && cols[0].endsWith('.fits'))
    .map(([uri, mjd, band]) => ({
      url: S3_BASE + uri.replace(/^ibe\/data\/spherex\//, ''),
      mjd: Number(mjd),
      detector: Number(band.replace('SPHEREx-D', '')),
      obsid: uri.split('/').pop()!.replace(/^level2_/, '').split('_spx_')[0],
    }))
}
