import { useState } from 'react'
import { ArrowRight, LoaderCircle, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseCoords } from '@/lib/coords'
import { positionAt, SPHEREX_EPOCH, TARGETS } from '@/lib/targets'
import { cn } from '@/lib/utils'

export type Destination = { target: string } | { ra: number; dec: number; name?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Turns typed text into a place on the sky: coordinates, a demo target, or a SIMBAD name. */
async function resolve(text: string): Promise<Destination> {
  const coords = parseCoords(text)
  if (coords) return coords
  const q = norm(text)
  const known = TARGETS.find((t) => norm(t.name).startsWith(q) || norm(t.slug) === q)
  if (known && q.length >= 3) return { target: known.slug }
  const res = await fetch(`/api/resolve?name=${encodeURIComponent(text)}`)
  const body = await res.json()
  if (!res.ok) throw new Error(body.error ?? 'Could not find that object.')
  const target = TARGETS.find((t) => Math.abs(t.ra2000 - body.ra2000) < 0.01 && Math.abs(t.dec2000 - body.dec2000) < 0.01)
  if (target) return { target: target.slug }
  // Place it where it was during the SPHEREx survey, not where it was in 2000.
  const pos = positionAt({ ...body, slug: '', name: '', kind: '', blurb: '', bestDetector: 3 }, SPHEREX_EPOCH)
  return { ...pos, name: body.name }
}

export function SearchBox({ onGo, size = 'lg' }: { onGo: (d: Destination) => void; size?: 'lg' | 'sm' }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      onGo(await resolve(text))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const lg = size === 'lg'
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 520px)').matches
  return (
    <form onSubmit={submit} className="w-full">
      <div
        className={cn(
          'flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md transition focus-within:border-primary/60 focus-within:bg-white/[0.06] focus-within:shadow-[0_0_40px_-8px] focus-within:shadow-primary/40',
          lg ? 'p-2 pl-5' : 'p-1 pl-3',
        )}
      >
        <Search className={cn('shrink-0 text-muted-foreground', lg ? 'size-5' : 'size-4')} />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={lg ? (narrow ? 'Star name or RA Dec' : 'Star name or coordinates, e.g. 08h55m10.8s −7d14m42s') : 'Name or RA Dec'}
          aria-label="Object name or sky coordinates"
          className={cn(
            'min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70',
            lg ? 'h-12 text-lg' : 'h-8 text-sm',
          )}
        />
        <Button type="submit" size={lg ? 'lg' : 'sm'} disabled={busy} className={cn(lg && 'h-12 rounded-xl px-6 text-base')}>
          {busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
          {lg && 'Look'}
        </Button>
      </div>
      {error && <p className={cn('mt-2 text-sm text-destructive', lg && 'pl-5')}>{error}</p>}
    </form>
  )
}
