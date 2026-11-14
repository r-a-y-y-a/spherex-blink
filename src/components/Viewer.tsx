import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Link2,
  LoaderCircle,
  Pause,
  Play,
  Telescope,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ScatterChart, type Point } from '@/components/ScatterChart'
import { VISIT_COLORS } from '@/lib/colors'
import { flagNames } from '@/lib/spherex/flags'
import { SearchBox, type Destination } from '@/components/SearchBox'
import {
  aperture,
  centredCrop,
  DETECTOR_BANDS,
  displayRange,
  fillHoles,
  formatDay,
  formatMonth,
  groupFrames,
  medianStack,
  renderImage,
  subtractBackground,
  visitsOf,
  WAVE_MAX,
  WAVE_MIN,
  type Colormap,
  type Dataset,
  type Grouping,
} from '@/lib/analysis'
import { formatDec, formatRa } from '@/lib/coords'
import { loadLive, loadSeeded, type LiveProgress } from '@/lib/data'
import { PIXEL_ARCSEC } from '@/lib/spherex/cutout'
import { mjdToYear, positionAt, type Target } from '@/lib/targets'
import { cn } from '@/lib/utils'

type Props = {
  target?: Target
  ra?: number
  dec?: number
  name?: string
  params: URLSearchParams
  setParams: (next: Record<string, string | null>, push?: boolean) => void
  onGo: (d: Destination) => void
  onHome: () => void
}

const LIVE_SIZE = 64
const FOVS = [
  { px: 32, label: '3′' },
  { px: 64, label: '6.5′' },
  { px: 96, label: '10′' },
]
const GROUPINGS: { id: Grouping; label: string; hint: string }[] = [
  { id: 'visit', label: 'Per visit', hint: 'One deep stack per 6-month survey pass. Best for slow movers.' },
  { id: 'day', label: 'Per day', hint: 'One stack per observing day. Shows changes within a pass.' },
  { id: 'exposure', label: 'Every exposure', hint: 'Raw single frames, each at a slightly different wavelength.' },
]

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg bg-muted p-1">
      {options.map((o) => (
        <button
          key={String(o.id)}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded-md px-2 py-1.5 text-xs font-medium transition',
            value === o.id ? 'bg-secondary text-foreground shadow-sm ring-1 ring-white/10' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Approximate colour of each wavelength, for the slider track (blue = shorter, red = longer). */
const BAND_GRADIENT =
  'linear-gradient(90deg, #6d8dff 0%, #5fb4ff 12%, #5fe0c0 28%, #c8e65a 45%, #f7c040 62%, #f7863a 80%, #e2483c 100%)'

export function Viewer({ target, ra: raIn, dec: decIn, name, params, setParams, onGo, onHome }: Props) {
  const [ds, setDs] = useState<Dataset | null>(null)
  const [progress, setProgress] = useState<LiveProgress | null>(null)
  const [error, setError] = useState('')

  const best = DETECTOR_BANDS[target?.bestDetector ?? 3]
  const wMin = Number(params.get('wmin') ?? best[0])
  const wMax = Number(params.get('wmax') ?? best[1])
  const range = useMemo<[number, number]>(() => [wMin, wMax], [wMin, wMax])
  const grouping = (params.get('group') as Grouping) ?? 'visit'
  const diff = params.get('mode') === 'diff'
  const cmap = (params.get('cmap') as Colormap) ?? 'ir'
  const fovPx = Number(params.get('fov') ?? 64)
  const skipFlagged = params.get('flags') === 'skip'
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [fps, setFps] = useState(2)
  const [apert, setApert] = useState<[number, number] | null>(null)
  const [copied, setCopied] = useState(false)

  const centre = target ? positionAt(target, 2025.95) : { ra: raIn!, dec: decIn! }
  const title = target?.name ?? name ?? 'Custom position'

  // Load: cached demo target from Supabase, or live from the archive + S3.
  useEffect(() => {
    const ctrl = new AbortController()
    setDs(null)
    setError('')
    setProgress(null)
    setApert(null)
    const job = target
      ? loadSeeded(target.slug, ctrl.signal).then(setDs)
      : loadLive(centre.ra, centre.dec, LIVE_SIZE, (d, p) => {
          setProgress(p)
          if (d.frames.length) setDs(d)
        }, ctrl.signal).then((d) => {
          setDs(d)
          setProgress(null)
        })
    job.catch((err: Error) => {
      if (err.name !== 'AbortError') setError(err.message)
    })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.slug, raIn, decIn])

  const visits = useMemo(() => (ds ? visitsOf(ds.frames) : []), [ds])
  const visitNames = useMemo(() => {
    if (!ds) return []
    const names: string[] = []
    ds.frames.forEach((f, i) => (names[visits[i]] ??= formatMonth(f.mjd)))
    return names
  }, [ds, visits])

  const groups = useMemo(
    () => (ds ? groupFrames(ds, visits, range, grouping, skipFlagged) : []),
    [ds, visits, range, grouping, skipFlagged],
  )
  const stacks = useMemo(
    () => (ds ? groups.map((g) => fillHoles(subtractBackground(medianStack(ds, g.indices)), ds.size)) : []),
    [ds, groups],
  )

  // Difference mode: subtract the median of all stacks, leaving only what changed.
  const images = useMemo(() => {
    if (!diff || stacks.length < 2 || !ds) return stacks
    const n = ds.size * ds.size
    const ref = new Float32Array(n)
    const buf = new Float32Array(stacks.length)
    for (let p = 0; p < n; p++) {
      stacks.forEach((s, k) => (buf[k] = s[p]))
      const s = buf.slice().sort()
      ref[p] = s[Math.floor(s.length / 2)]
    }
    return stacks.map((s) => s.map((v, p) => v - ref[p]))
  }, [stacks, diff, ds])

  const crop = useMemo(() => centredCrop(ds?.size ?? 64, fovPx), [ds?.size, fovPx])
  const limits = useMemo(() => displayRange(images, crop, diff), [images, crop, diff])
  const current = Math.min(frameIdx, Math.max(0, groups.length - 1))
  const group = groups[current]

  const flaggedCount = useMemo(() => ds?.frames.filter((f) => f.flags).length ?? 0, [ds])
  const groupFlags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of group?.indices ?? [])
      for (const name of flagNames(ds?.frames[i].flags ?? 0)) counts.set(name, (counts.get(name) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [group, ds])

  // Playback
  useEffect(() => {
    if (!playing || groups.length < 2) return
    const id = setInterval(() => setFrameIdx((i) => (i + 1) % groups.length), 1000 / fps)
    return () => clearInterval(id)
  }, [playing, groups.length, fps])
  useEffect(() => setFrameIdx(0), [grouping, range])

  // Keyboard: space = play/pause, arrows = step. Handy when recording.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        setPlaying(false)
        const d = e.key === 'ArrowRight' ? 1 : -1
        setFrameIdx((i) => (i + d + groups.length) % Math.max(1, groups.length))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [groups.length])

  // Draw
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c || !images[current]) return
    c.width = crop.n
    c.height = crop.n
    c.getContext('2d')!.putImageData(renderImage(images[current], crop, limits, diff ? 'diff' : cmap), 0, 0)
  }, [images, current, crop, limits, diff, cmap])

  const size = ds?.size ?? 64
  const half = (size - 1) / 2
  const apX = apert?.[0] ?? half
  const apY = apert?.[1] ?? half

  // Where catalogue proper motion says the target should be at this frame's date.
  const predicted = useMemo(() => {
    if (!target || !group || !ds) return null
    const p = positionAt(target, mjdToYear(group.mjd))
    const dx = -((p.ra - ds.ra) * Math.cos((ds.dec * Math.PI) / 180) * 3600) / PIXEL_ARCSEC
    const dy = ((p.dec - ds.dec) * 3600) / PIXEL_ARCSEC
    return [half + dx, half + dy] as [number, number]
  }, [target, group, ds, half])

  const spectrum: Point[] = useMemo(() => {
    if (!ds) return []
    const n = ds.size * ds.size
    return ds.frames.map((f, i) => {
      const flux = aperture(ds.pixels.subarray(i * n, (i + 1) * n), ds.size, apX, apY)
      const flagged = flagNames(f.flags ?? 0)
      return {
        x: f.wave,
        y: flux,
        series: visits[i],
        hollow: flagged.length > 0,
        tip: `${f.wave.toFixed(3)} µm · ${flux.toFixed(2)} mJy\n${formatDay(f.mjd)} · detector ${f.detector}${
          flagged.length ? `\nFlagged: ${flagged.join(', ')}` : ''
        }`,
      }
    })
  }, [ds, visits, apX, apY])

  const lightCurve: Point[] = useMemo(
    () =>
      groups.map((g, k) => {
        const flux = aperture(stacks[k], size, apX, apY)
        return {
          x: mjdToYear(g.mjd),
          y: flux,
          series: g.visit,
          strong: k === current,
          tip: `${g.label} · ${flux.toFixed(2)} mJy\n${g.indices.length} exposure${g.indices.length > 1 ? 's' : ''} stacked`,
        }
      }),
    [groups, stacks, size, apX, apY, current],
  )

  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const x = crop.x0 + ((e.clientX - r.left) / r.width) * crop.n - 0.5
    const y = crop.y0 + (1 - (e.clientY - r.top) / r.height) * crop.n - 0.5
    setApert([x, y])
  }

  // Overlay geometry in % of the displayed crop (north up, so flip y).
  const pct = (x: number, y: number) => ({
    left: `${((x - crop.x0 + 0.5) / crop.n) * 100}%`,
    top: `${(1 - (y - crop.y0 + 0.5) / crop.n) * 100}%`,
  })
  const arcminPx = 60 / PIXEL_ARCSEC
  const embed = params.get('embed') === '1'

  async function share() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const bandLabel = `${range[0].toFixed(2)}–${range[1].toFixed(2)} µm`
  const loading = !ds || (progress && progress.phase === 'search')

  return (
    <div className="flex min-h-svh flex-col bg-[radial-gradient(ellipse_70%_50%_at_30%_-10%,rgba(56,98,180,0.22),transparent_70%)]">
      {!embed && (
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-white/10 px-5 py-3">
          <button onClick={onHome} className="flex items-center gap-2 font-heading font-semibold">
            <ArrowLeft className="size-4 text-muted-foreground" />
            <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
              <Telescope className="size-4" />
            </span>
            <span className="hidden sm:inline">SPHEREx Blink</span>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-heading text-xl font-semibold">{title}</h1>
            <p className="tabular font-mono text-xs text-muted-foreground">
              RA {formatRa(centre.ra)} · Dec {formatDec(centre.dec)}
              {target && <span className="text-muted-foreground/70"> · position for late 2025</span>}
            </p>
          </div>
          <div className="w-full max-w-xs">
            <SearchBox onGo={onGo} size="sm" />
          </div>
          <Button variant="secondary" size="sm" onClick={share}>
            {copied ? <Check /> : <Link2 />}
            {copied ? 'Copied' : 'Share link'}
          </Button>
        </header>
      )}

      <main className="grid flex-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_430px]">
        {/* Sky */}
        <div className="flex min-w-0 flex-col items-center gap-4">
          <div className="relative aspect-square w-full max-w-[min(100%,calc(100svh-210px))] min-w-[280px] overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_80px_-20px_rgba(56,98,180,0.5)]">
            {images.length > 0 && (
              <canvas
                ref={canvasRef}
                onClick={onCanvasClick}
                className="pixelated size-full cursor-crosshair"
                aria-label={`SPHEREx image of ${title}, ${group?.label ?? ''}, ${bandLabel}`}
              />
            )}

            {/* Predicted catalogue position and measurement aperture */}
            {images.length > 0 && predicted && (
              <div
                className="pointer-events-none absolute size-[7%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-sky-300/70"
                style={pct(predicted[0], predicted[1])}
              />
            )}
            {images.length > 0 && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                // Ring drawn just outside the 2-pixel-radius photometry aperture.
                style={{ ...pct(apX, apY), width: `${(5 / crop.n) * 100}%`, aspectRatio: '1' }}
              >
                <div className="absolute inset-0 rounded-full border-2 border-primary shadow-[0_0_12px] shadow-primary/60" />
              </div>
            )}

            {/* Labels */}
            {group && (
              <div className="pointer-events-none absolute top-3 left-3 space-y-1.5">
                <div className="rounded-lg bg-black/60 px-3 py-1.5 backdrop-blur">
                  <div className="tabular font-heading text-2xl font-semibold leading-none">{group.label}</div>
                  <div className="mt-1 text-xs text-white/70">
                    {grouping === 'visit' ? `Survey pass ${group.visit + 1}` : `Pass ${group.visit + 1}`} ·{' '}
                    {group.indices.length} exposure{group.indices.length > 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            )}
            {images.length > 0 && (
              <>
                <div className="pointer-events-none absolute top-3 right-3 rounded-lg bg-black/60 px-2.5 py-1.5 text-right backdrop-blur">
                  <div className="tabular font-mono text-sm">{bandLabel}</div>
                  <div className="text-[11px] text-white/60">{diff ? 'Difference from median' : 'Infrared'}</div>
                </div>
                {/* Scale bar: sized as a % of the image box, so it tracks the field of view. */}
                <div
                  className="pointer-events-none absolute bottom-8 left-3 h-[3px] rounded-full bg-white/80"
                  style={{ width: `${(arcminPx / crop.n) * 100}%` }}
                />
                <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-white/80">1 arcmin</div>
                <div className="pointer-events-none absolute right-3 bottom-3 grid size-12 place-items-center text-[10px] font-semibold text-white/80">
                  <span className="absolute top-0 left-1/2 -translate-x-1/2">N</span>
                  <span className="absolute top-1/2 left-0 -translate-y-1/2">E</span>
                  <span className="absolute top-3 left-1/2 h-4 w-px -translate-x-1/2 bg-white/70" />
                  <span className="absolute top-1/2 left-3 h-px w-4 -translate-y-1/2 bg-white/70" />
                </div>
              </>
            )}

            {/* Loading / error states */}
            {(loading || error || (ds && images.length === 0)) && (
              <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(56,98,180,0.15),transparent_70%)] p-8 text-center">
                {error ? (
                  <div className="max-w-sm space-y-3">
                    <p className="font-semibold">Couldn’t load this patch of sky</p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                    <Button variant="secondary" size="sm" onClick={onHome}>
                      Back to targets
                    </Button>
                  </div>
                ) : loading ? (
                  <div className="max-w-sm space-y-4">
                    <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
                    <p className="font-medium">
                      {target ? 'Loading SPHEREx frames…' : 'Searching every SPHEREx image of this spot…'}
                    </p>
                    {!target && (
                      <p className="text-sm text-muted-foreground">
                        NASA’s archive takes about a minute for a new position. Repeat visits are instant.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="max-w-sm space-y-2">
                    <p className="font-semibold">No frames in this wavelength range</p>
                    <p className="text-sm text-muted-foreground">Widen the range or pick another detector band.</p>
                  </div>
                )}
              </div>
            )}
            {progress?.phase === 'frames' && progress.done < progress.total && (
              <div className="absolute inset-x-0 bottom-0 bg-black/70 px-4 py-2 text-xs backdrop-blur">
                <div className="mb-1.5 flex justify-between text-white/80">
                  <span>Reading pixels straight from NASA’s cloud archive</span>
                  <span className="tabular font-mono">
                    {progress.done}/{progress.total}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Transport */}
          <div className="flex w-full max-w-[min(100%,calc(100svh-210px))] min-w-[280px] items-center gap-3">
            <Button size="icon" variant="secondary" onClick={() => setFrameIdx((i) => (i - 1 + groups.length) % Math.max(1, groups.length))} aria-label="Previous frame">
              <ChevronLeft />
            </Button>
            <Button size="icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} className="size-10 rounded-full">
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button size="icon" variant="secondary" onClick={() => setFrameIdx((i) => (i + 1) % Math.max(1, groups.length))} aria-label="Next frame">
              <ChevronRight />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {groups.map((g, k) => (
                <button
                  key={k}
                  onClick={() => {
                    setPlaying(false)
                    setFrameIdx(k)
                  }}
                  title={g.label}
                  className="group flex h-7 min-w-0 flex-1 items-center"
                >
                  <span
                    className={cn('h-1.5 w-full rounded-full transition', k === current ? 'h-2.5' : 'opacity-40 group-hover:opacity-80')}
                    style={{ background: VISIT_COLORS[g.visit % VISIT_COLORS.length] }}
                  />
                </button>
              ))}
            </div>
            <div className="flex w-28 items-center gap-2">
              <Slider value={[fps]} min={0.5} max={12} step={0.5} onValueChange={([v]) => setFps(v)} aria-label="Playback speed" />
              <span className="tabular w-9 font-mono text-xs text-muted-foreground">{fps}/s</span>
            </div>
          </div>
        </div>

        {/* Controls and measurements */}
        <aside className="space-y-6 rounded-2xl border border-white/10 bg-card/80 p-5 backdrop-blur lg:max-h-[calc(100svh-90px)] lg:overflow-y-auto">
          <Section title="Wavelength" aside={<span className="tabular font-mono text-xs text-primary">{bandLabel}</span>}>
            <div className="py-1" style={{ '--band-gradient': BAND_GRADIENT } as React.CSSProperties}>
              <Slider
                value={range}
                min={WAVE_MIN}
                max={WAVE_MAX}
                step={0.01}
                minStepsBetweenThumbs={5}
                onValueChange={([a, b]) => setParams({ wmin: a.toFixed(2), wmax: b.toFixed(2) })}
                aria-label="Wavelength range"
                className="band-slider"
              />
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Object.entries(DETECTOR_BANDS).map(([d, [lo, hi]]) => {
                const active = Math.abs(range[0] - lo) < 0.01 && Math.abs(range[1] - hi) < 0.01
                return (
                  <button
                    key={d}
                    onClick={() => setParams({ wmin: lo.toFixed(2), wmax: hi.toFixed(2) })}
                    title={`Detector ${d}: ${lo}–${hi} µm`}
                    className={cn(
                      'rounded-md py-1 text-center text-[11px] transition',
                      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <div className="font-semibold">D{d}</div>
                    <div className="tabular font-mono text-[10px] opacity-80">{((lo + hi) / 2).toFixed(1)}</div>
                  </button>
                )
              })}
              <button
                onClick={() => setParams({ wmin: WAVE_MIN.toFixed(2), wmax: WAVE_MAX.toFixed(2) })}
                className={cn(
                  'rounded-md py-1 text-[11px] font-semibold transition',
                  range[0] <= WAVE_MIN + 0.01 && range[1] >= WAVE_MAX - 0.01
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                All
              </button>
            </div>
          </Section>

          <Section title="Frames">
            <Segmented
              value={grouping}
              options={GROUPINGS}
              onChange={(g) => setParams({ group: g === 'visit' ? null : g })}
            />
            <p className="text-xs text-muted-foreground">{GROUPINGS.find((g) => g.id === grouping)!.hint}</p>
            {flaggedCount > 0 && (
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
                <span>
                  Skip flagged exposures
                  <span className="block text-xs text-muted-foreground">
                    {flaggedCount} of {ds!.frames.length} have pipeline quality flags at the target
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={skipFlagged}
                  onChange={(e) => setParams({ flags: e.target.checked ? 'skip' : null })}
                  className="size-4 accent-[var(--primary)]"
                />
              </label>
            )}
          </Section>

          <div className="grid grid-cols-2 gap-4">
            <Section title="Display">
              <Segmented
                value={diff ? 'diff' : 'normal'}
                options={[
                  { id: 'normal', label: 'Image' },
                  { id: 'diff', label: 'Difference' },
                ]}
                onChange={(m) => setParams({ mode: m === 'diff' ? 'diff' : null })}
              />
            </Section>
            <Section title="Field of view">
              <Segmented
                value={fovPx}
                options={FOVS.filter((f) => f.px <= size).map((f) => ({ id: f.px, label: f.label }))}
                onChange={(px) => setParams({ fov: px === 64 ? null : String(px) })}
              />
            </Section>
          </div>
          {!diff && (
            <Section title="Colour">
              <Segmented
                value={cmap}
                options={[
                  { id: 'ir', label: 'Infrared heat' },
                  { id: 'gray', label: 'Greyscale' },
                ]}
                onChange={(m) => setParams({ cmap: m === 'ir' ? null : m })}
              />
            </Section>
          )}

          <Section
            title="Spectrum at the ring"
            aside={
              <button
                onClick={() => setApert(null)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Crosshair className="size-3.5" /> {apert ? 'Reset to centre' : 'Click the image to move'}
              </button>
            }
          >
            <ScatterChart
              points={spectrum}
              seriesNames={visitNames}
              xLabel="Wavelength (µm)"
              yLabel="Flux (mJy)"
              xDomain={[WAVE_MIN, WAVE_MAX]}
              band={range}
              height={190}
            />
          </Section>

          <Section title="Brightness over time">
            <ScatterChart
              points={lightCurve}
              seriesNames={visitNames}
              xLabel={`Date · ${bandLabel}`}
              yLabel="Flux (mJy)"
              xTicks={([a, b]) => {
                const out: { v: number; label: string }[] = []
                for (let y = Math.ceil(a * 4) / 4; y <= b; y += 0.25) {
                  const m = Math.round((y % 1) * 12)
                  out.push({ v: y, label: `${['Jan', 'Apr', 'Jul', 'Oct'][m / 3]} ${String(Math.floor(y)).slice(2)}` })
                }
                return out
              }}
              height={170}
              empty="Not enough frames in this band"
            />
          </Section>

          {ds && (
            <Section title="About these frames">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Exposures</dt>
                <dd className="tabular text-right font-mono">{ds.frames.length}</dd>
                <dt className="text-muted-foreground">Survey passes</dt>
                <dd className="tabular text-right font-mono">{visitNames.length}</dd>
                <dt className="text-muted-foreground">Span</dt>
                <dd className="tabular text-right font-mono text-xs leading-5">
                  {formatDay(Math.min(...ds.frames.map((f) => f.mjd)))} – {formatDay(Math.max(...ds.frames.map((f) => f.mjd)))}
                </dd>
                <dt className="text-muted-foreground">Pixel</dt>
                <dd className="tabular text-right font-mono">{PIXEL_ARCSEC}″</dd>
              </dl>
              {group && (
                <p className="text-xs text-muted-foreground">
                  Showing {group.indices.length} exposure{group.indices.length > 1 ? 's' : ''}, e.g.{' '}
                  <a
                    className="text-primary underline-offset-2 hover:underline"
                    href={ds.frames[group.indices[0]].url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ds.frames[group.indices[0]].obsid}
                  </a>
                  .{' '}
                  {groupFlags.length > 0 && (
                    <span className="text-foreground/80">
                      Flags at the target in this frame: {groupFlags.map(([n, c]) => `${n} ×${c}`).join(', ')}.{' '}
                    </span>
                  )}
                  Source: NASA/IPAC IRSA, SPHEREx Level 2 spectral images.
                  {predicted && ' Dashed circle: where catalogue motion predicts the target on this date.'}
                </p>
              )}
            </Section>
          )}
        </aside>
      </main>
    </div>
  )
}
