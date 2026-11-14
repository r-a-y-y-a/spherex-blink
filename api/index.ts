import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { searchArchive } from '../src/lib/spherex/archive.ts'

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
      res.json({ name: id, kind, ra2000, dec2000, pmra: pmra || 0, pmdec: pmdec || 0 })
      return
    } catch {
      // try the next host
    }
  }
  res.status(502).json({ error: 'The SIMBAD name service is not responding. Try coordinates instead.' })
})

export default app
