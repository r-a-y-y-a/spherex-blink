// Pre-bakes SPHEREx cutouts for the demo targets into Supabase Storage, so the demo never
// waits on IRSA. Usage: node --env-file=.env.local scripts/seed.ts [slug ...]
import { createClient } from '@supabase/supabase-js'
import { fetchFrame, pool, type Frame } from '../src/lib/spherex/cutout.ts'
import { MAX_FRAMES, searchArchive, thinFrames } from '../src/lib/spherex/archive.ts'
import { positionAt, SPHEREX_EPOCH, TARGETS } from '../src/lib/targets.ts'

const SIZE = 96 // px at 6.15"/px = 9.8 arcmin; the viewer crops smaller fields of view from this
const CONCURRENCY = 40

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
  auth: { persistSession: false },
})

const wanted = process.argv.slice(2)
for (const target of TARGETS.filter((t) => wanted.length === 0 || wanted.includes(t.slug))) {
  const { ra, dec } = positionAt(target, SPHEREX_EPOCH)
  console.log(`\n${target.name}: RA ${ra.toFixed(5)}, Dec ${dec.toFixed(5)}`)

  let t = Date.now()
  const all = await searchArchive(ra, dec)
  const refs = thinFrames(all, MAX_FRAMES)
  console.log(`  archive search: ${all.length} images in ${((Date.now() - t) / 1000).toFixed(0)} s, using ${refs.length}`)
  await supabase
    .from('searches')
    .upsert({ key: `${ra.toFixed(3)},${dec.toFixed(3)}`, ra, dec, frames: all })

  t = Date.now()
  const results = await pool(refs, CONCURRENCY, (ref) => fetchFrame(ref, ra, dec, SIZE), (_r, _i, done) => {
    if (done % 25 === 0) process.stdout.write(`  ${done}/${refs.length}\r`)
  })
  const frames = results.filter((r): r is Frame => !(r instanceof Error))
  const failed = results.filter((r) => r instanceof Error) as Error[]
  console.log(`  cutouts: ${frames.length} ok, ${failed.length} failed in ${((Date.now() - t) / 1000).toFixed(0)} s`)
  for (const e of failed.slice(0, 3)) console.log(`    ${e.message}`)
  if (failed.length > refs.length * 0.02) {
    console.log(`  too many failures, not uploading ${target.slug}; re-run it`)
    process.exitCode = 1
    continue
  }

  // One binary of float32 frames (little-endian, frame after frame) plus a JSON manifest.
  const pixels = new Float32Array(frames.length * SIZE * SIZE)
  frames.forEach((f, i) => pixels.set(f.pixels, i * SIZE * SIZE))
  const manifest = {
    slug: target.slug,
    ra,
    dec,
    size: SIZE,
    pixelArcsec: 6.15,
    createdAt: new Date().toISOString(),
    frames: frames.map(({ pixels: _p, size: _s, ...meta }) => meta),
  }

  const bucket = supabase.storage.from('frames')
  const up1 = await bucket.upload(`${target.slug}/pixels.bin`, Buffer.from(pixels.buffer), {
    contentType: 'application/octet-stream',
    upsert: true,
  })
  const up2 = await bucket.upload(`${target.slug}/manifest.json`, JSON.stringify(manifest), {
    contentType: 'application/json',
    upsert: true,
  })
  if (up1.error || up2.error) throw up1.error ?? up2.error
  console.log(`  uploaded ${(pixels.byteLength / 1e6).toFixed(1)} MB`)
}
