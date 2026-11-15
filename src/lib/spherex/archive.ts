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

/** Longest we wait for NASA's archive before giving up with a clear message. */
export const ARCHIVE_TIMEOUT_MS = 180_000

const SIA_URL = 'https://irsa.ipac.caltech.edu/SIA'

const unescapeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Minimal VOTable TABLEDATA reader: one object per <TR>, keyed by FIELD name. */
function parseVoTable(xml: string): Record<string, string>[] {
  const fields = [...xml.matchAll(/<FIELD\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1])
  return [...xml.matchAll(/<TR>([\s\S]*?)<\/TR>/g)].map((tr) => {
    const cells = [...tr[1].matchAll(/<TD\s*\/>|<TD>([\s\S]*?)<\/TD>/g)].map((m) => unescapeXml(m[1] ?? ''))
    return Object.fromEntries(fields.map((f, i) => [f, cells[i] ?? '']))
  })
}

/**
 * Every SPHEREx spectral image covering (ra, dec), oldest first. Uses IRSA's image search (SIA),
 * which answers in seconds, searched by instrument so every release (data and quick releases,
 * including future ones) is included. Falls back to the TAP query if SIA errors.
 */
export async function searchArchive(ra: number, dec: number, signal = AbortSignal.timeout(ARCHIVE_TIMEOUT_MS)) {
  try {
    return await searchSia(ra, dec, signal)
  } catch (err) {
    if (signal.aborted) throw timeoutError()
    console.warn('SIA search failed, falling back to TAP:', (err as Error).message)
    try {
      return await searchTap(ra, dec, signal)
    } catch (err2) {
      throw signal.aborted ? timeoutError() : err2
    }
  }
}

const timeoutError = () =>
  new Error(`NASA's archive did not answer within ${ARCHIVE_TIMEOUT_MS / 60000} minutes. It may be busy; try again shortly, or open one of the demo targets.`)

/** IRSA's proxy intermittently answers 502/503 in under a second; the next try usually works. */
async function fetchRetrying(url: string, signal: AbortSignal, tries = 5): Promise<Response> {
  for (let k = 1; ; k++) {
    const res = await fetch(url, { signal })
    if (res.status < 500 || k >= tries) return res
    await new Promise((r) => setTimeout(r, 500 * 2 ** (k - 1)))
  }
}

async function searchSia(ra: number, dec: number, signal: AbortSignal): Promise<FrameRef[]> {
  // A 1-arcsecond circle: SIA matches images whose footprint overlaps it.
  const url = `${SIA_URL}?INSTRUMENT=SPHEREx&POS=circle+${ra}+${dec}+0.0003&RESPONSEFORMAT=VOTABLE`
  const res = await fetchRetrying(url, signal)
  if (!res.ok) throw new Error(`IRSA SIA returned ${res.status}`)
  const xml = await res.text()
  if (!/QUERY_STATUS" value="OK"/.test(xml)) throw new Error('IRSA SIA query failed')
  return parseVoTable(xml)
    .filter((r) => r.calib_level === '2' && r.dataproduct_subtype === 'science' && /^SPHEREx-D\d$/.test(r.energy_bandpassname))
    .flatMap((r) => {
      const key = /"key":\s*"([^"]+\.fits)"/.exec(r.cloud_access)?.[1]
      if (!key) return []
      return [
        {
          url: S3_BASE + key,
          mjd: Number(r.t_min),
          detector: Number(r.energy_bandpassname.replace('SPHEREx-D', '')),
          obsid: key.split('/').pop()!.replace(/^level2_/, '').split('_spx_')[0],
        },
      ]
    })
    .filter((f, i, all) => Number.isFinite(f.mjd) && all.findIndex((g) => g.url === f.url) === i)
    .sort((a, b) => a.mjd - b.mjd)
}

async function searchTap(ra: number, dec: number, signal: AbortSignal): Promise<FrameRef[]> {
  const query = `SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname
    FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
    ORDER BY p.time_bounds_lower`
  const body = new URLSearchParams({ QUERY: query, FORMAT: 'csv', LANG: 'ADQL' })
  const res = await fetch(TAP_URL, { method: 'POST', body, signal })
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
