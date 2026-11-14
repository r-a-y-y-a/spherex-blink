import express from 'express'
import { createClient } from '@supabase/supabase-js'

const TAP_URL = 'https://irsa.ipac.caltech.edu/TAP/sync'
// Points the browser at the public S3 copy of each file (CORS open, supports Range reads).
const S3_BASE = 'https://nasa-irsa-spherex.s3.us-east-1.amazonaws.com/'

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null

type Frame = { url: string; mjd: number; detector: number; obsid: string }

function parseCoord(v: unknown, min: number, max: number) {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

async function queryTap(ra: number, dec: number): Promise<Frame[]> {
  const query = `SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname
    FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
    WHERE 1 = CONTAINS(POINT('ICRS', ${ra}, ${dec}), p.poly)
    ORDER BY p.time_bounds_lower`
  const body = new URLSearchParams({ QUERY: query, FORMAT: 'csv', LANG: 'ADQL' })
  const res = await fetch(TAP_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`IRSA TAP returned ${res.status}`)
  const lines = (await res.text()).trim().split('\n').slice(1)
  return lines
    .map((line) => line.split(','))
    .filter((cols) => cols.length >= 3 && cols[0].endsWith('.fits'))
    .map(([uri, mjd, band]) => ({
      url: S3_BASE + uri.replace(/^ibe\/data\/spherex\//, ''),
      mjd: Number(mjd),
      detector: Number(band.replace('SPHEREx-D', '')),
      obsid: uri.split('/').pop()!.replace(/^level2_/, '').split('_spx_')[0],
    }))
}

const app = express()

app.get('/api/health', async (_req, res) => {
  let db = 'not configured'
  if (supabase) {
    const { error } = await supabase.from('searches').select('key', { head: true, count: 'exact' })
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
    const frames = await queryTap(ra, dec)
    if (supabase) await supabase.from('searches').upsert({ key, ra, dec, frames })
    res.json({ ra, dec, cached: false, frames })
  } catch (err) {
    res.status(502).json({ error: `SPHEREx archive search failed: ${(err as Error).message}` })
  }
})

export default app
