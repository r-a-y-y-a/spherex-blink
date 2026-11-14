import { useState } from 'react'
import { Telescope } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Frame = { url: string; mjd: number; detector: number; obsid: string }

const WISE_0855 = { ra: 133.79513, dec: -7.24515 }

export default function App() {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [frames, setFrames] = useState<Frame[]>([])
  const [error, setError] = useState('')

  async function search() {
    setState('loading')
    try {
      const res = await fetch(`/api/search?ra=${WISE_0855.ra}&dec=${WISE_0855.dec}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? res.statusText)
      setFrames(body.frames)
      setState('done')
    } catch (err) {
      setError((err as Error).message)
      setState('error')
    }
  }

  const epochs = new Set(frames.map((f) => Math.floor(f.mjd))).size

  return (
    <main className="dark min-h-svh bg-neutral-950 text-neutral-100 grid place-items-center p-6">
      <div className="max-w-md text-center space-y-6">
        <Telescope className="mx-auto size-12 text-sky-400" />
        <h1 className="text-4xl font-semibold tracking-tight">SPHEREx Blink</h1>
        <p className="text-neutral-400">
          Watch the infrared sky change over time. Deploy check: search the SPHEREx archive for WISE 0855.
        </p>
        <Button size="lg" onClick={search} disabled={state === 'loading'}>
          {state === 'loading' ? 'Searching the archive (about a minute)...' : 'Search WISE 0855'}
        </Button>
        {state === 'done' && (
          <p className="text-emerald-400">
            {frames.length} SPHEREx images across {epochs} observing days
          </p>
        )}
        {state === 'error' && <p className="text-red-400">{error}</p>}
      </div>
    </main>
  )
}
