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

// Gaia DR3 stars around a position (ESA archive has no CORS, so proxy it). Positions are at
// epoch 2016.0 with proper motions, so the viewer can place each star at each frame's date.
app.get('/api/gaia', async (req, res) => {
  const ra = parseCoord(req.query.ra, 0, 360)
  const dec = parseCoord(req.query.dec, -90, 90)
  const radius = parseCoord(req.query.radius ?? 0.12, 0.001, 0.25)
  if (ra === null || dec === null || radius === null) {
    res.status(400).json({ error: 'ra, dec and radius (deg, max 0.25) are required' })
    return
  }
  const query = `SELECT TOP 400 ra, dec, phot_g_mean_mag AS g, pmra, pmdec
    FROM gaiadr3.gaia_source
    WHERE 1 = CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', ${ra}, ${dec}, ${radius}))
      AND phot_g_mean_mag < 20.5
    ORDER BY phot_g_mean_mag`
  try {
    const r = await fetch('https://gea.esac.esa.int/tap-server/tap/sync', {
      method: 'POST',
      body: new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query }),
      signal: AbortSignal.timeout(30000),
    })
    const text = await r.text()
    if (!r.ok || !text.startsWith('ra,')) throw new Error(`Gaia archive returned ${r.status}`)
    const stars = text
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(',').map((v) => (v === '' ? 0 : Number(v))))
      .map(([sra, sdec, g, pmra, pmdec]) => ({ ra: sra, dec: sdec, g, pmra, pmdec }))
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400')
    res.json({ epoch: 2016.0, stars })
  } catch (err) {
    res.status(502).json({ error: `Gaia lookup failed: ${(err as Error).message}` })
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
