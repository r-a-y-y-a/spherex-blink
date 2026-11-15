import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { searchArchive } from '../src/lib/spherex/archive.ts'
import { fetchFrame, pool, type Frame, type FrameRef } from '../src/lib/spherex/cutout.ts'

const S3_PREFIX = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/'
const MAX_BATCH = 60

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
        auth: { persistSession: false },
      })
    : null

function parseCoord(v: unknown, min: number, max: number) {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

const app = express()

app.get('/api/health', async (_req, res) => {
  let db = 'not configured'
  if (supabase) {
    // Not `head: true`: a HEAD request hides "table missing" errors.
    const { error } = await supabase.from('searches').select('key').limit(1)
    db = error ? `error: ${error.message}` : 'ok'
  }
  res.json({ ok: true, db })
})

app.get('/api/search', async (req, res) => {
  const ra = parseCoord(req.query.ra, 0, 360)
  const dec = parseCoord(req.query.dec, -90, 90)
  if (ra === null || dec === null) {
    res.status(400).json({ error: 'ra must be 0-360 and dec -90 to 90, in degrees' })
    return
  }
  // ~3.6 arcsec cache cell; well under one SPHEREx pixel (6.15").
  const key = `${ra.toFixed(3)},${dec.toFixed(3)}`

  if (supabase) {
    const { data } = await supabase.from('searches').select('frames').eq('key', key).maybeSingle()
    if (data) {
      res.json({ ra, dec, cached: true, frames: data.frames })
      return
    }
  }

  try {
    const frames = await searchArchive(ra, dec)
    if (supabase) await supabase.from('searches').upsert({ key, ra, dec, frames })
    res.json({ ra, dec, cached: false, frames })
  } catch (err) {
    res.status(502).json({ error: `SPHEREx archive search failed: ${(err as Error).message}` })
  }
})

// Cuts a batch of frames next to the data. Browsers get only 6 HTTP/1.1 connections to S3,
// while this function runs in the same AWS region as the bucket with many in flight.
// Response: uint32 meta length, meta JSON, padding to 4 bytes, then float32 pixels (LE).
app.post('/api/cutouts', express.json({ limit: '200kb' }), async (req, res) => {
  const { ra, dec, size, refs } = req.body ?? {}
  const okRefs =
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.length <= MAX_BATCH &&
    refs.every((r: FrameRef) => typeof r?.url === 'string' && r.url.startsWith(S3_PREFIX))
  if (parseCoord(ra, 0, 360) === null || parseCoord(dec, -90, 90) === null || ![32, 64, 96].includes(size) || !okRefs) {
    res.status(400).json({ error: `Send ra, dec, size (32/64/96) and 1-${MAX_BATCH} SPHEREx frame refs.` })
    return
  }
  const results = await pool(refs as FrameRef[], 32, (ref) => fetchFrame(ref, ra, dec, size), undefined, 2)
  const frames = results.filter((r): r is Frame => !(r instanceof Error))
  const meta = JSON.stringify({
    frames: frames.map(({ pixels: _p, size: _s, ...m }) => m),
    failed: results.length - frames.length,
  })
  const metaBytes = Buffer.from(meta)
  const pad = (4 - ((4 + metaBytes.length) % 4)) % 4
  const out = Buffer.alloc(4 + metaBytes.length + pad + frames.length * size * size * 4)
  out.writeUInt32LE(metaBytes.length, 0)
  metaBytes.copy(out, 4)
  let o = 4 + metaBytes.length + pad
  for (const f of frames) {
    Buffer.from(f.pixels.buffer, f.pixels.byteOffset, f.pixels.byteLength).copy(out, o)
    o += f.pixels.byteLength
  }
  res.setHeader('Content-Type', 'application/octet-stream')
  res.send(out)
})

/**
 * Cone search on an IRSA catalogue through Gator, which answers in seconds where TAP can take
 * minutes. Returns one record per row keyed by column name; "null" cells become null.
 */
async function gator(catalog: string, ra: number, dec: number, radiusAs: number, cols: string, constraints = '') {
  const url =
    `https://irsa.ipac.caltech.edu/cgi-bin/Gator/nph-query?catalog=${catalog}&spatial=cone` +
    `&objstr=${ra}+${dec}&radius=${Math.round(radiusAs)}&radunits=arcsec&outfmt=1&selcols=${cols}` +
    (constraints ? `&constraints=${encodeURIComponent(constraints)}` : '')
  let text = ''
  // IRSA's proxy intermittently fails fast with 5xx; the next try usually works.
  for (let k = 0; k < 4; k++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) })
    text = await r.text()
    if (r.ok && text.includes('|')) break
    await new Promise((ok) => setTimeout(ok, 500 * 2 ** k))
  }
  const lines = text.split('\n')
  const header = lines.find((l) => l.startsWith('|'))
  if (!header) throw new Error(`IRSA ${catalog} returned no table`)
  const names = header.split('|').slice(1, -1).map((h) => h.trim())
  return lines
    .filter((l) => l.trim() && !l.startsWith('\\') && !l.startsWith('|'))
    .map((l) => {
      // Selected columns are numeric; Gator's clon/clat strings contain no spaces.
      const v = l.trim().split(/\s+/)
      return Object.fromEntries(names.map((n, i) => [n, v[i] === undefined || v[i] === 'null' ? null : v[i]]))
    })
}

type GaiaStar = { ra: number; dec: number; g: number; pmra: number; pmdec: number }

/** Gaia DR3 stars brighter than `maxG` within `radius` degrees, brightest first (epoch 2016.0). */
async function queryGaia(ra: number, dec: number, radius: number, maxG: number, top: number): Promise<GaiaStar[]> {
  try {
    const rows = await gator('gaia_dr3_source', ra, dec, radius * 3600, 'ra,dec,phot_g_mean_mag,pmra,pmdec', `phot_g_mean_mag<${maxG}`)
    return rows
      .map((r) => ({ ra: Number(r.ra), dec: Number(r.dec), g: Number(r.phot_g_mean_mag), pmra: Number(r.pmra ?? 0), pmdec: Number(r.pmdec ?? 0) }))
      .filter((st) => Number.isFinite(st.g))
      .sort((a, b) => a.g - b.g)
      .slice(0, top)
  } catch {
    return queryGaiaEsa(ra, dec, radius, maxG, top)
  }
}

/** Fallback: ESA's own Gaia archive (slower and sometimes unresponsive). */
async function queryGaiaEsa(ra: number, dec: number, radius: number, maxG: number, top: number): Promise<GaiaStar[]> {
  const query = `SELECT TOP ${top} ra, dec, phot_g_mean_mag AS g, pmra, pmdec
    FROM gaiadr3.gaia_source
    WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${radius}))
      AND phot_g_mean_mag < ${maxG}
    ORDER BY phot_g_mean_mag`
  const r = await fetch('https://gea.esac.esa.int/tap-server/tap/sync', {
    method: 'POST',
    body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query }),
    signal: AbortSignal.timeout(30000),
  })
  const text = await r.text()
  if (!r.ok || !text.startsWith('ra,')) throw new Error(`Gaia archive returned ${r.status}`)
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(',').map((v) => (v === '' ? 0 : Number(v))))
    .map(([sra, sdec, g, pmra, pmdec]) => ({ ra: sra, dec: sdec, g, pmra, pmdec }))
}

// Gaia DR3 stars around a position (the archives have no CORS, so proxy it). Positions are at
// epoch 2016.0 with proper motions, so the viewer can place each star at each frame's date.
app.get('/api/gaia', async (req, res) => {
  const ra = parseCoord(req.query.ra, 0, 360)
  const dec = parseCoord(req.query.dec, -90, 90)
  const radius = parseCoord(req.query.radius ?? 0.12, 0.001, 0.25)
  if (ra === null || dec === null || radius === null) {
    res.status(400).json({ error: 'ra, dec and radius (deg, max 0.25) are required' })
    return
  }
  try {
    const stars = await queryGaia(ra, dec, radius, 20.5, 400)
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400')
    res.json({ epoch: 2016.0, stars })
  } catch (err) {
    res.status(502).json({ error: `Gaia lookup failed: ${(err as Error).message}` })
  }
})

// CatWISE2020 sources around a position, from IRSA's Gator service (TAP is far slower for cone
// searches). CatWISE measures motion from WISE itself, so it marks movers independently of Gaia.
// Kept: sources brighter than W2 = 15, plus every significant mover at any brightness.
const WISE_BRIGHT_W2 = 15
const MOVER_MIN_ASYR = 0.15
const MOVER_MIN_SIGMA = 10
// Saturated stars leave CatWISE artefacts (spikes, ghosts, halo fragments) with spurious motions
// of all sizes and directions, so catalogue motions inside a bright star's halo are not trusted.
const HALO_STAR_MAX_G = 11
const haloRadiusAs = (g: number) => (g < 5 ? 600 : g < 7 ? 420 : g < 9 ? 300 : 120)
const HALO_MAX_AS = 600
const HALO_SELF_AS = 15
// A saturated star also splinters into several fixed CatWISE entries around its own position.
const coreRadiusAs = (g: number) => (g < 5 ? 90 : g < 9 ? 60 : 15)
const GAIA_EPOCH_MJD = 57388 // 2016.0

type WiseSource = { ra: number; dec: number; w1: number | null; w2: number; pmra: number; pmdec: number; mover: boolean; mjd: number }

app.get('/api/wise', async (req, res) => {
  const ra = parseCoord(req.query.ra, 0, 360)
  const dec = parseCoord(req.query.dec, -90, 90)
  const radius = parseCoord(req.query.radius ?? 0.12, 0.001, 0.25)
  if (ra === null || dec === null || radius === null) {
    res.status(400).json({ error: 'ra, dec and radius (deg, max 0.25) are required' })
    return
  }
  try {
    // Bright Gaia stars, to recognise their artefacts; the overlay still works if Gaia is down.
    const brightStars = queryGaia(ra, dec, radius + HALO_MAX_AS / 3600, HALO_STAR_MAX_G, 50).catch(() => [])
    const rows = await gator('catwise_2020', ra, dec, radius * 3600, 'ra,dec,w1mpro,w2mpro,pmra,pmdec,sigpmra,sigpmdec,meanobsmjd')
    const num = (v: string | null) => (v === null ? null : Number(v))
    const all: (WiseSource & { sig: number })[] = []
    for (const r of rows) {
      const [sra, sdec, w1, w2, pmra, pmdec, spra, spdec, mjd] = [
        'ra', 'dec', 'w1mpro', 'w2mpro', 'pmra', 'pmdec', 'sigpmra', 'sigpmdec', 'meanobsmjd',
      ].map((k) => num(r[k]))
      if (sra === null || sdec === null || w2 === null || mjd === null) continue
      const pm = Math.hypot(pmra ?? 0, pmdec ?? 0)
      const sig = Math.hypot(spra ?? Infinity, spdec ?? Infinity)
      const mover = pm > MOVER_MIN_ASYR && pm / sig > MOVER_MIN_SIGMA
      if (w2 >= WISE_BRIGHT_W2 && !mover) continue
      // Only trust a motion that is measured; otherwise treat the source as fixed.
      const useful = pm / sig > 3
      all.push({
        ra: sra,
        dec: sdec,
        w1,
        w2,
        pmra: useful ? (pmra ?? 0) * 1000 : 0,
        pmdec: useful ? (pmdec ?? 0) * 1000 : 0,
        mover,
        mjd,
        sig,
      })
    }
    const bright = await brightStars
    const sepAs = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) =>
      Math.hypot((a.ra - b.ra) * Math.cos((b.dec * Math.PI) / 180), a.dec - b.dec) * 3600
    // In a bright star's halo (but not the star itself), a catalogue motion is most likely an artefact.
    // Compare at each star's own epoch offset: Gaia is 2016.0, CatWISE about 2015.4, close enough.
    const inHalo = (m: WiseSource) =>
      bright.some((st) => {
        const d = sepAs(m, st)
        return d > HALO_SELF_AS && d < haloRadiusAs(st.g)
      })
    const movers = all.filter((s) => s.mover && !inHalo(s)).sort((a, b) => a.sig - b.sig)
    const kept: typeof movers = []
    for (const m of movers) {
      const dup = kept.some((k) => {
        const sep = Math.hypot((m.ra - k.ra) * Math.cos((k.dec * Math.PI) / 180), m.dec - k.dec) * 3600
        const dpm = Math.hypot(m.pmra - k.pmra, m.pmdec - k.pmdec) / 1000
        return sep < 10 || (sep < 120 && dpm < 1.5)
      })
      if (!dup) kept.push(m)
    }
    // Keep only the brightest fixed entry inside each bright star's core (the star itself), placing
    // the star at the source's epoch, since a fast star like Barnard's moves ~100" in ten years.
    const fixed = all.filter((s) => !s.mover && s.w2 < WISE_BRIGHT_W2).sort((a, b) => a.w2 - b.w2)
    const claimed = new Set<number>()
    const fixedKept = fixed.filter((s) => {
      for (const [k, st] of bright.entries()) {
        const dt = (s.mjd - GAIA_EPOCH_MJD) / 365.25
        const at = {
          ra: st.ra + (st.pmra * dt) / 3.6e6 / Math.cos((st.dec * Math.PI) / 180),
          dec: st.dec + (st.pmdec * dt) / 3.6e6,
        }
        if (sepAs(s, at) < coreRadiusAs(st.g)) {
          if (claimed.has(k)) return false
          claimed.add(k)
        }
      }
      return true
    })
    const sources: WiseSource[] = [...fixedKept, ...kept].map(({ sig: _s, ...s }) => s)
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400')
    res.json({ sources })
  } catch (err) {
    res.status(502).json({ error: `WISE lookup failed: ${(err as Error).message}` })
  }
})

// The main CDS SIMBAD host has been unreliable; the Harvard mirror serves the same database.
const SIMBAD_HOSTS = ['https://simbad.harvard.edu', 'https://simbad.cds.unistra.fr']

app.get('/api/resolve', async (req, res) => {
  const name = String(req.query.name ?? '').trim()
  if (!name || name.length > 100 || /[\n\r]/.test(name)) {
    res.status(400).json({ error: 'Enter an object name, like "Barnard\'s star".' })
    return
  }
  const script = `output console=off script=off\nformat object "%IDLIST(1)|%COO(d;A D;ICRS;J2000;2000)|%PM(A D)|%OTYPE(V)"\nquery id ${name}`
  for (const host of SIMBAD_HOSTS) {
    try {
      const r = await fetch(`${host}/simbad/sim-script?script=${encodeURIComponent(script)}`, {
        signal: AbortSignal.timeout(10000),
      })
      const text = await r.text()
      if (text.includes('::error::')) {
        res.status(404).json({ error: `SIMBAD does not know "${name}".` })
        return
      }
      const line = text.split('\n').find((l) => l.split('|').length === 4)
      if (!line) continue
      const [id, coo, pm, kind] = line.split('|').map((s) => s.trim())
      const [ra2000, dec2000] = coo.split(/\s+/).map(Number)
      const [pmra, pmdec] = pm.split(/\s+/).map((v) => (v === '~' ? 0 : Number(v)))
      if (!Number.isFinite(ra2000) || !Number.isFinite(dec2000)) continue
      res.json({ name: id.replace(/^NAME\s+/, ''), kind, ra2000, dec2000, pmra: pmra || 0, pmdec: pmdec || 0 })
      return
    } catch {
      // try the next host
    }
  }
  res.status(502).json({ error: 'The SIMBAD name service is not responding. Try coordinates instead.' })
})

export default app
