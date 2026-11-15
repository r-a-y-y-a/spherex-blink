import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  MapPin,
  Maximize2,
  X,
  Link2,
  LoaderCircle,
  Pause,
  Play,
  Telescope,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { InfoButton } from '@/components/InfoButton'
import { ScatterChart, type Point } from '@/components/ScatterChart'
import { VISIT_COLORS } from '@/lib/colors'
import { flagNames } from '@/lib/spherex/flags'
import { SearchBox, type Destination } from '@/components/SearchBox'
import {
  aperture,
  centredCrop,
  colormapGradient,
  DETECTOR_BANDS,
  displayRange,
  fillHoles,
  formatDay,
  groupFrames,
  medianStack,
  renderImage,
  smooth,
  subtractBackground,
  visitNamesOf,
  visitsOf,
  WAVE_MAX,
  WAVE_MIN,
  type Colormap,
  type Dataset,
  type Group,
  type Grouping,
} from '@/lib/analysis'
import { pixelToSky, skyTicks, skyToPixel } from '@/lib/axes'
import { motion, parsePins, serializePins, type Pin } from '@/lib/pins'
import { HELP, type HelpTopic } from '@/lib/help'
import { formatDec, formatRa } from '@/lib/coords'
import { loadLive, loadSeeded, type LiveProgress } from '@/lib/data'
import { PIXEL_ARCSEC } from '@/lib/spherex/cutout'
import { DEFAULT_TARGET, TARGETS, mjdToYear, positionAt, type Target } from '@/lib/targets'
import { cn } from '@/lib/utils'

type Props = {
  target?: Target
  ra?: number
  dec?: number
  name?: string
  params: URLSearchParams
  setParams: (next: Record<string, string | null>, push?: boolean) => void
  onGo: (d: Destination) => void
}

const LIVE_SIZE = 64
const FOVS = [
  { px: 32, label: '3′' },
  { px: 64, label: '6.5′' },
  { px: 96, label: '10′' },
]
const GROUPINGS: { id: Grouping; label: string; hint: string }[] = [
  { id: 'all', label: 'All', hint: 'Every exposure in this band stacked into one deep image. Best for faint objects.' },
  { id: 'visit', label: 'Per pass', hint: 'One stack per 6-month survey pass. Best for slow movers.' },
  { id: 'day', label: 'Per day', hint: 'One stack per observing day. Shows changes within a pass.' },
  { id: 'exposure', label: 'Each', hint: 'Single exposures, each at a slightly different wavelength.' },
]

type GaiaStar = { ra: number; dec: number; g: number; pmra: number; pmdec: number }
const WISE_MAX_FIXED = 60
/** CatWISE2020 source; motions in mas/yr, position at `mjd` (the catalogue's mean epoch). */
type WiseSource = { ra: number; dec: number; w1: number | null; w2: number; pmra: number; pmdec: number; mover: boolean; mjd: number }

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

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition',
        on ? 'bg-secondary text-foreground ring-1 ring-primary/50' : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', on ? 'bg-primary' : 'bg-muted-foreground/40')} />
      {label}
    </button>
  )
}

function ExpandButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Enlarge ${label.toLowerCase()} chart`}
      title="Enlarge"
      className="-m-1.5 grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Maximize2 className="size-3.5" />
    </button>
  )
}

function Section({
  title,
  info,
  aside,
  children,
}: {
  title: string
  info?: HelpTopic
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
          {info && <InfoButton topic={info} />}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

const TOOLS = [
  // Each mode wears the colour of what it draws: the orange aperture ring, the white pins.
  {
    id: 'measure',
    label: 'Measure',
    hint: 'Measure: click the image to place the brightness aperture',
    icon: Crosshair,
    active: 'bg-primary text-primary-foreground shadow-[0_0_14px_-2px] shadow-primary/70',
  },
  {
    id: 'pin',
    label: 'Drop a pin',
    hint: 'Pin: click the image to mark a spot on the sky',
    icon: MapPin,
    active: 'bg-white text-black shadow-[0_0_14px_-2px] shadow-white/60',
  },
] as const

/** Icon toggle for what a click on the image does. */
function ToolToggle({ tool, onChange }: { tool: 'measure' | 'pin'; onChange: (t: 'measure' | 'pin') => void }) {
  return (
    <div
      role="group"
      aria-label="Click mode"
      className="flex shrink-0 gap-0.5 rounded-full bg-black/50 p-1 ring-1 ring-white/20"
    >
      {TOOLS.map(({ id, label, hint, icon: Icon, active }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-label={label}
          aria-pressed={tool === id}
          title={hint}
          className={cn(
            'grid size-8 place-items-center rounded-full transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            tool === id ? active : 'text-foreground/70 hover:bg-white/10 hover:text-foreground',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  )
}

/** Above this many frames, separate bars would be thinner than their gaps, so draw one scrubber. */
const MAX_SEGMENTS = 40

/** Frame timeline: one bar per frame when there are few, a continuous scrubber when there are many. */
function Timeline({ groups, current, onSeek }: { groups: Group[]; current: number; onSeek: (k: number) => void }) {
  const n = groups.length
  if (n <= MAX_SEGMENTS)
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1">
        {groups.map((g, k) => (
          <button key={k} onClick={() => onSeek(k)} title={g.label} className="group flex h-7 min-w-0 flex-1 items-center">
            <span
              className={cn('h-1.5 w-full rounded-full transition', k === current ? 'h-2.5' : 'opacity-40 group-hover:opacity-80')}
              style={{ background: VISIT_COLORS[g.visit % VISIT_COLORS.length] }}
            />
          </button>
        ))}
      </div>
    )

  // Runs of consecutive frames from the same survey pass, drawn as one coloured stretch each.
  const runs: { visit: number; start: number; len: number }[] = []
  groups.forEach((g, k) => {
    const last = runs[runs.length - 1]
    if (last && last.visit === g.visit) last.len++
    else runs.push({ visit: g.visit, start: k, len: 1 })
  })
  const seekAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))))
  }
  return (
    <div
      role="slider"
      aria-label="Frame"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={current + 1}
      aria-valuetext={groups[current]?.label}
      title={groups[current]?.label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        seekAt(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && seekAt(e)}
      className="relative flex h-7 min-w-0 flex-1 cursor-pointer touch-none items-center"
    >
      <div className="flex h-1.5 w-full gap-0.5">
        {runs.map((r) => (
          <span
            key={r.start}
            className="h-full rounded-full opacity-50"
            style={{ flexGrow: r.len, flexBasis: 0, background: VISIT_COLORS[r.visit % VISIT_COLORS.length] }}
          />
        ))}
      </div>
      <span
        className="pointer-events-none absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(0,0,0,0.8)]"
        style={{ left: `${((current + 0.5) / n) * 100}%` }}
      />
    </div>
  )
}

/**
 * Difference mode: subtract a reference so only what changed is left. The reference is one chosen
 * stack (A − B) when `refIdx` is set, otherwise the per-pixel median of all stacks.
 */
function diffImages(stacks: Float32Array[], diff: boolean, ds: Dataset | null, refIdx: number): Float32Array[] {
  if (!diff || stacks.length < 2 || !ds) return stacks
  if (refIdx >= 0) {
    const b = stacks[refIdx]
    return stacks.map((s) => s.map((v, p) => v - b[p]))
  }
  const n = ds.size * ds.size
  const ref = new Float32Array(n)
  const buf = new Float32Array(stacks.length)
  for (let p = 0; p < n; p++) {
    stacks.forEach((s, k) => (buf[k] = s[p]))
    const sorted = buf.slice().sort()
    ref[p] = sorted[Math.floor(sorted.length / 2)]
  }
  return stacks.map((s) => s.map((v, p) => v - ref[p]))
}

/**
 * The challenge targets, preloaded so they open instantly. A column on desktop, a scrolling row
 * of chips above the image on narrow screens.
 */
function TargetList({ current, onGo }: { current?: string; onGo: (d: { target: string }) => void }) {
  return (
    <nav aria-label="Challenge targets" className="min-w-0 lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto">
      <h2 className="mb-2 hidden text-xs font-medium tracking-wide text-muted-foreground uppercase lg:block">
        Challenge targets
      </h2>
      <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {TARGETS.map((t) => {
          const active = t.slug === current
          const [lo, hi] = DETECTOR_BANDS[t.bestDetector]
          return (
            <li key={t.slug} className="shrink-0 lg:shrink">
              <button
                onClick={() => !active && onGo({ target: t.slug })}
                aria-current={active ? 'page' : undefined}
                title={t.blurb}
                className={cn(
                  'w-full rounded-xl border px-3 py-2 text-left transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:py-2.5',
                  active
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-white/10 bg-card/60 hover:border-white/25 hover:bg-card',
                )}
              >
                <span className={cn('block text-[11px]', active ? 'text-primary' : 'text-muted-foreground')}>{t.kind}</span>
                <span className="block font-heading text-sm font-semibold whitespace-nowrap">{t.name}</span>
                {/* Blurbs only where there is height for all five cards with them (shown on hover otherwise). */}
                <span className="mt-1 hidden text-xs leading-snug text-muted-foreground [@media(min-width:1024px)_and_(min-height:800px)]:line-clamp-2">
                  {t.blurb}
                </span>
                <span className="tabular mt-1.5 hidden font-mono text-[10px] text-muted-foreground/80 lg:block">
                  Best at {lo.toFixed(1)}–{hi.toFixed(1)} µm
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

const DETECTORS = Object.entries(DETECTOR_BANDS).map(([d, [lo, hi]]) => ({ d: Number(d), lo, hi }))
const near = (a: number, b: number) => Math.abs(a - b) < 0.005

/**
 * From/to detector dropdowns plus an "All" checkbox, kept in step with the range slider. A bound
 * dragged off a detector edge shows as its exact wavelength until a detector is picked again.
 */
function BandPicker({
  range,
  onChange,
  fallback,
}: {
  range: [number, number]
  onChange: (r: [number, number]) => void
  fallback: [number, number]
}) {
  const fromD = DETECTORS.find((x) => near(x.lo, range[0]))?.d
  const toD = DETECTORS.find((x) => near(x.hi, range[1]))?.d
  const all = range[0] <= WAVE_MIN + 0.005 && range[1] >= WAVE_MAX - 0.005
  const pick = (end: 'from' | 'to', d: number) => {
    const x = DETECTOR_BANDS[d]
    if (end === 'from') onChange([x[0], range[1] > x[0] ? range[1] : x[1]])
    else onChange([range[0] < x[1] ? range[0] : x[0], x[1]])
  }
  const select = (end: 'from' | 'to', value: number | undefined, edge: number) => (
    <div className="relative min-w-0">
      <select
        aria-label={end === 'from' ? 'Shortest wavelength' : 'Longest wavelength'}
        value={value ?? 'custom'}
        onChange={(e) => pick(end, Number(e.target.value))}
        className="tabular h-8 w-full min-w-0 appearance-none truncate rounded-md bg-muted pr-7 pl-2.5 font-mono text-xs text-foreground [color-scheme:dark] transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {value === undefined && (
          <option value="custom" disabled hidden>
            {edge.toFixed(2)} µm
          </option>
        )}
        {DETECTORS.map((x) => (
          <option key={x.d} value={x.d}>
            D{x.d} · {(end === 'from' ? x.lo : x.hi).toFixed(2)} µm
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
      {select('from', fromD, range[0])}
      <span className="text-xs text-muted-foreground">to</span>
      {select('to', toD, range[1])}
      <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs font-medium whitespace-nowrap">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => onChange(e.target.checked ? [WAVE_MIN, WAVE_MAX] : fallback)}
          className="size-4 accent-[var(--primary)]"
        />
        All
      </label>
    </div>
  )
}

/** Approximate colour of each wavelength, for the slider track (blue = shorter, red = longer). */
const BAND_GRADIENT =
  'linear-gradient(90deg, #6d8dff 0%, #5fb4ff 12%, #5fe0c0 28%, #c8e65a 45%, #f7c040 62%, #f7863a 80%, #e2483c 100%)'

export function Viewer({ target, ra: raIn, dec: decIn, name, params, setParams, onGo }: Props) {
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
  const smoothOn = params.get('smooth') === '1'
  const gaiaOn = params.get('gaia') === '1'
  const wiseOn = params.get('wise') === '1'
  const [wise, setWise] = useState<WiseSource[] | null>(null)
  const gridOn = params.get('grid') === '1'
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [gaia, setGaia] = useState<GaiaStar[] | null>(null)
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
          if (d) setDs(d)
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
  const visitNames = useMemo(() => (ds ? visitNamesOf(ds.frames, visits) : []), [ds, visits])

  const groups = useMemo(
    () => (ds ? groupFrames(ds, visits, range, grouping, skipFlagged, visitNames) : []),
    [ds, visits, range, grouping, skipFlagged, visitNames],
  )
  const stacks = useMemo(
    () => (ds ? groups.map((g) => fillHoles(subtractBackground(medianStack(ds, g.indices)), ds.size)) : []),
    [ds, groups],
  )

  // Difference reference (B): stored as a date so it survives regrouping and wavelength changes,
  // and matched to the nearest frame now shown.
  const refParam = params.get('ref')
  const refIdx = useMemo(() => {
    if (refParam === null || groups.length < 2) return -1
    const mjd = Number(refParam)
    let best = -1
    groups.forEach((g, k) => {
      if (best < 0 || Math.abs(g.mjd - mjd) < Math.abs(groups[best].mjd - mjd)) best = k
    })
    return best
  }, [refParam, groups])

  const images = useMemo(() => {
    const out = diffImages(stacks, diff, ds, refIdx)
    return smoothOn && ds ? out.map((img) => smooth(img, ds.size)) : out
  }, [stacks, diff, ds, smoothOn, refIdx])

  // Gaia DR3 stars in the field, fetched once per position when the overlay is first shown.
  useEffect(() => {
    if (!gaiaOn || !ds || gaia) return
    const radius = ((ds.size * PIXEL_ARCSEC) / 3600) * 0.72
    fetch(`/api/gaia?ra=${ds.ra}&dec=${ds.dec}&radius=${radius.toFixed(4)}`)
      .then((r) => (r.ok ? r.json() : { stars: [] }))
      .then((b) => setGaia(b.stars))
      .catch(() => setGaia([]))
  }, [gaiaOn, ds, gaia])

  // CatWISE2020 sources (WISE's own catalogue, with WISE-measured motions), fetched once per position.
  useEffect(() => {
    if (!wiseOn || !ds || wise) return
    const radius = ((ds.size * PIXEL_ARCSEC) / 3600) * 0.72
    fetch(`/api/wise?ra=${ds.ra}&dec=${ds.dec}&radius=${radius.toFixed(4)}`)
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((b) => setWise(b.sources))
      .catch(() => setWise([]))
  }, [wiseOn, ds, wise])

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

  // Gaia stars placed at this frame's date (Gaia positions are for 2016.0).
  const gaiaPx = useMemo(() => {
    if (!gaiaOn || !gaia || !ds || !group) return []
    const dt = mjdToYear(group.mjd) - 2016
    const cosd = Math.cos((ds.dec * Math.PI) / 180)
    return gaia
      .map((st) => {
        const ra = st.ra + (st.pmra * dt) / 3.6e6 / cosd
        const dec = st.dec + (st.pmdec * dt) / 3.6e6
        return {
          x: half - ((ra - ds.ra) * cosd * 3600) / PIXEL_ARCSEC,
          y: half + ((dec - ds.dec) * 3600) / PIXEL_ARCSEC,
          g: st.g,
        }
      })
      .filter((p) => p.x > crop.x0 - 0.5 && p.x < crop.x0 + crop.n - 0.5 && p.y > crop.y0 - 0.5 && p.y < crop.y0 + crop.n - 0.5)
  }, [gaiaOn, gaia, ds, group, half, crop])

  // WISE sources placed at this frame's date with their WISE-measured motion.
  const wisePx = useMemo(() => {
    if (!wiseOn || !wise || !ds || !group) return []
    const year = mjdToYear(group.mjd)
    return wise
      .map((w) => {
        const dt = year - mjdToYear(w.mjd)
        const ra = w.ra + (w.pmra * dt) / 3.6e6 / Math.cos((w.dec * Math.PI) / 180)
        const dec = w.dec + (w.pmdec * dt) / 3.6e6
        return { ...skyToPixel(ra, dec, ds.ra, ds.dec, size), w }
      })
      .filter((p) => p.x > crop.x0 - 0.5 && p.x < crop.x0 + crop.n - 0.5 && p.y > crop.y0 - 0.5 && p.y < crop.y0 + crop.n - 0.5)
      // Every mover, plus only the brightest fixed sources, so dense fields stay readable.
      .sort((a, b) => Number(b.w.mover) - Number(a.w.mover) || a.w.w2 - b.w.w2)
      .filter((p, k) => p.w.mover || k < WISE_MAX_FIXED)
  }, [wiseOn, wise, ds, group, size, crop])

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

  const spectrumTitle = apert ? 'Spectrum at the ring' : 'Spectrum at the centre'
  // Each chart is drawn wider (not just scaled up) when expanded, so text stays readable.
  const spectrumChart = (big: boolean) => (
    <ScatterChart
      points={spectrum}
      seriesNames={visitNames}
      xLabel="Wavelength (µm)"
      yLabel="Flux (mJy)"
      xDomain={[WAVE_MIN, WAVE_MAX]}
      band={range}
      height={big ? 480 : 190}
      width={big ? 1040 : 520}
    />
  )
  const lightCurveChart = (big: boolean) => (
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
      height={big ? 480 : 170}
      width={big ? 1040 : 520}
      empty="Not enough frames in this band"
    />
  )
  const [expanded, setExpanded] = useState<'spectrum' | 'light' | null>(null)

  function toPixel(e: React.MouseEvent<HTMLCanvasElement>): [number, number] {
    const r = e.currentTarget.getBoundingClientRect()
    const x = crop.x0 + ((e.clientX - r.left) / r.width) * crop.n - 0.5
    const y = crop.y0 + (1 - (e.clientY - r.top) / r.height) * crop.n - 0.5
    return [x, y]
  }

  const ticks = useMemo(() => (ds ? skyTicks(ds.ra, ds.dec, crop) : { ra: [], dec: [] }), [ds, crop])
  const cmapShown: Colormap | 'diff' = diff ? 'diff' : cmap

  // What is under the pointer (or the aperture, on touch screens): position, pixel value, Gaia star.
  // Pins: fixed sky positions that persist across frames, bands and zoom (and the share link).
  const pinsParam = params.get('pins')
  const pins = useMemo(() => parsePins(pinsParam), [pinsParam])
  const [tool, setTool] = useState<'measure' | 'pin'>('measure')
  const setPins = (next: Pin[]) => setParams({ pins: serializePins(next) })
  const pinPx = useMemo(
    () => (ds ? pins.map((p) => skyToPixel(p.ra, p.dec, ds.ra, ds.dec, size)) : []),
    [pins, ds, size],
  )
  const pinRef = useMemo(() => (pins.length ? pins.reduce((a, b) => (b.mjd < a.mjd ? b : a)) : null), [pins])

  function onImageClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const [x, y] = toPixel(e)
    if (tool === 'measure' || !ds || !group) {
      setApert([x, y])
      return
    }
    const hit = pinPx.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 1.5)
    if (hit >= 0) setPins(pins.filter((_, k) => k !== hit))
    else setPins([...pins, { ...pixelToSky(x, y, ds.ra, ds.dec, size), mjd: group.mjd }].slice(0, 20))
  }

  const probe = hover ?? apert
  const readout = useMemo(() => {
    if (!probe || !ds || !images[current]) return null
    const [x, y] = probe
    const i = Math.round(x), j = Math.round(y)
    if (i < 0 || j < 0 || i >= size || j >= size) return null
    const sky = pixelToSky(x, y, ds.ra, ds.dec, size)
    const star = gaiaPx.find((p) => Math.hypot(p.x - x, p.y - y) < 1.2)
    const wiseHit = wisePx
      .filter((p) => Math.hypot(p.x - x, p.y - y) < 1.5)
      .sort((a, b) => Number(b.w.mover) - Number(a.w.mover))[0]?.w
    return {
      ...sky,
      value: images[current][j * size + i],
      offset: Math.hypot(x - half, y - half) * PIXEL_ARCSEC,
      star,
      wise: wiseHit,
    }
  }, [probe, ds, images, current, size, half, gaiaPx, wisePx])

  // Overlay geometry in % of the displayed crop (north up, so flip y).
  const pct = (x: number, y: number) => ({
    left: `${((x - crop.x0 + 0.5) / crop.n) * 100}%`,
    top: `${(1 - (y - crop.y0 + 0.5) / crop.n) * 100}%`,
  })
  const arcminPx = 60 / PIXEL_ARCSEC
  const fmtVal = (v: number) => {
    const a = Math.abs(v)
    const s = a >= 100 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2)
    return Number(s) === 0 ? s.replace('-', '') : s.replace('-', '−')
  }
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
          <div className="flex items-center gap-2 font-heading font-semibold">
            <span className="grid size-7 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
              <Telescope className="size-4" />
            </span>
            <span className="hidden sm:inline">BLINKx</span>
          </div>
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

      <main
        className={cn(
          'grid flex-1 gap-5 p-5',
          embed ? 'lg:grid-cols-[minmax(0,1fr)_430px]' : 'lg:grid-cols-[13.5rem_minmax(0,1fr)_430px]',
        )}
      >
        {!embed && <TargetList current={target?.slug} onGo={onGo} />}
        {/* Sky */}
        <div className="flex min-w-0 flex-col items-center">
          <div className="grid w-full max-w-[min(100%,calc(100svh-10.875rem))] min-w-[280px] grid-cols-[3.75rem_minmax(0,1fr)] gap-x-1.5">
          {/* Declination labels, horizontal and right-aligned against the image edge. */}
          <div className="relative" aria-hidden>
            {images.length > 0 &&
              ticks.dec.map((t) => (
                <span
                  key={t.label}
                  className="tabular absolute right-0 -translate-y-1/2 font-mono text-[10px] whitespace-nowrap text-muted-foreground"
                  style={{ top: `${(1 - t.pos) * 100}%` }}
                >
                  {t.label}
                </span>
              ))}
          </div>
          <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_0_80px_-20px_rgba(56,98,180,0.5)]">
            {images.length > 0 && (
              <canvas
                ref={canvasRef}
                onClick={onImageClick}
                onMouseMove={(e) => setHover(toPixel(e))}
                onMouseLeave={() => setHover(null)}
                className="pixelated size-full cursor-crosshair"
                aria-label={`SPHEREx image of ${title}, ${group?.label ?? ''}, ${bandLabel}`}
              />
            )}

            {/* RA/Dec ticks on the edges, or full grid lines when the grid is on. */}
            {images.length > 0 && (
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                {ticks.ra.map((t) => (
                  <span
                    key={t.label}
                    className={cn('absolute bottom-0 w-px', gridOn ? 'top-0 bg-white/20' : 'h-2 bg-white/60')}
                    style={{ left: `${t.pos * 100}%` }}
                  />
                ))}
                {ticks.dec.map((t) => (
                  <span
                    key={t.label}
                    className={cn('absolute left-0 h-px', gridOn ? 'right-0 bg-white/20' : 'w-2 bg-white/60')}
                    style={{ top: `${(1 - t.pos) * 100}%` }}
                  />
                ))}
              </div>
            )}

            {/* CatWISE sources: violet diamonds; significant movers get an arrow along their motion. */}
            {images.length > 0 && wisePx.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 size-full overflow-visible"
                viewBox={`0 0 ${crop.n} ${crop.n}`}
                aria-hidden
              >
                {wisePx.map(({ x, y, w }, k) => {
                  const cx = x - crop.x0 + 0.5
                  const cy = crop.n - (y - crop.y0 + 0.5)
                  const r = w.mover ? 1.3 : Math.max(0.55, 1.1 - (w.w2 - 10) * 0.1)
                  const pm = Math.hypot(w.pmra, w.pmdec)
                  // East is left on the image, north is up.
                  const ux = -w.pmra / (pm || 1), uy = -w.pmdec / (pm || 1)
                  return (
                    <g key={k} className={w.mover ? 'text-violet-300' : 'text-violet-300/70'}>
                      <polygon
                        points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={w.mover ? 2 : 1.25}
                        vectorEffect="non-scaling-stroke"
                      />
                      {w.mover && (
                        <>
                          <line
                            x1={cx + ux * (r + 0.4)}
                            y1={cy + uy * (r + 0.4)}
                            x2={cx + ux * (r + 3)}
                            y2={cy + uy * (r + 3)}
                            stroke="currentColor"
                            strokeWidth={2}
                            vectorEffect="non-scaling-stroke"
                            markerEnd="url(#wise-arrow)"
                          />
                        </>
                      )}
                    </g>
                  )
                })}
                <defs>
                  <marker id="wise-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#c4b5fd" />
                  </marker>
                </defs>
              </svg>
            )}

            {/* Mover speed labels: HTML, so they stay a readable size at every zoom. */}
            {images.length > 0 &&
              wisePx
                .filter((p) => p.w.mover)
                .map(({ x, y, w }, k) => (
                  <span
                    key={k}
                    className="tabular pointer-events-none absolute translate-x-2 -translate-y-[130%] rounded bg-black/70 px-1 font-mono text-[11px] leading-4 whitespace-nowrap text-violet-200"
                    style={pct(x, y)}
                  >
                    WISE {(Math.hypot(w.pmra, w.pmdec) / 1000).toFixed(1)}″/yr
                  </span>
                ))}

            {/* Gaia DR3 stars */}
            {images.length > 0 &&
              gaiaPx.map((p, k) => (
                <div
                  key={k}
                  title={`Gaia DR3 star, G = ${p.g.toFixed(1)}`}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/80"
                  style={{ ...pct(p.x, p.y), width: `${Math.max(1.2, 3.2 - (p.g - 12) * 0.25) * (64 / crop.n)}%`, aspectRatio: '1' }}
                />
              ))}

            {/* Pins: a reticle with a gap, so whatever sits under the pin stays visible. */}
            {images.length > 0 &&
              pinPx.map((p, k) =>
                p.x < crop.x0 - 0.5 || p.x > crop.x0 + crop.n - 0.5 || p.y < crop.y0 - 0.5 || p.y > crop.y0 + crop.n - 0.5 ? null : (
                  <div
                    key={k}
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]"
                    style={{ ...pct(p.x, p.y), width: `${(Math.max(2.6, 0.06 * crop.n) / crop.n) * 100}%`, aspectRatio: '1' }}
                  >
                    <span className="absolute top-0 left-1/2 h-[30%] w-0.5 -translate-x-1/2 bg-white" />
                    <span className="absolute bottom-0 left-1/2 h-[30%] w-0.5 -translate-x-1/2 bg-white" />
                    <span className="absolute top-1/2 left-0 h-0.5 w-[30%] -translate-y-1/2 bg-white" />
                    <span className="absolute top-1/2 right-0 h-0.5 w-[30%] -translate-y-1/2 bg-white" />
                    <span className="tabular absolute bottom-full left-full -translate-x-1/3 translate-y-1/3 rounded bg-white px-1 font-mono text-[10px] leading-4 font-semibold text-black">
                      {k + 1}
                    </span>
                  </div>
                ),
              )}

            {/* Predicted catalogue position and measurement aperture */}
            {images.length > 0 && predicted && (
              <div
                className="pointer-events-none absolute size-[7%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-sky-300/70"
                style={pct(predicted[0], predicted[1])}
              />
            )}
            {/* Shown once the user picks a spot, so it never hides the object at the centre. */}
            {images.length > 0 && apert && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                // Ring drawn just outside the 2-pixel-radius photometry aperture.
                style={{ ...pct(apX, apY), width: `${(5 / crop.n) * 100}%`, aspectRatio: '1' }}
              >
                <div className="absolute inset-0 rounded-full border-2 border-primary shadow-[0_0_12px] shadow-primary/60" />
              </div>
            )}

            {/* Labels: one row sharing the width, so they never overlap on a phone. */}
            {images.length > 0 && (
              <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                {group ? (
                  <div className="min-w-0 rounded-lg bg-black/60 px-3 py-1.5 backdrop-blur">
                    <div className="tabular font-heading text-lg font-semibold leading-tight whitespace-nowrap sm:text-2xl sm:leading-none">{group.label}</div>
                    <div className="mt-1 text-xs text-white/70">
                      {grouping === 'all'
                        ? `All ${visitNames.length} survey passes`
                        : grouping === 'visit'
                          ? `Survey pass ${group.visit + 1}`
                          : `Pass ${group.visit + 1}`}{' '}
                      ·{' '}
                      {group.indices.length} exposure{group.indices.length > 1 ? 's' : ''}
                    </div>
                  </div>
                ) : (
                  <span />
                )}
                <div className="shrink-0 rounded-lg bg-black/60 px-2.5 py-1.5 text-right backdrop-blur">
                  <div className="tabular font-mono text-xs sm:text-sm">{bandLabel}</div>
                  <div className="hidden text-[11px] text-white/60 sm:block">{!diff
                      ? 'Infrared'
                      : refIdx < 0
                        ? 'Difference from median'
                        : refIdx === current
                          ? 'Reference frame (B)'
                          : `Minus ${groups[refIdx].label}`}</div>
                  {/* Colour bar: the brightness each colour stands for. */}
                  <div className="mt-1.5 flex items-center justify-end gap-1.5 font-mono text-[10px] text-white/70">
                    <span className="tabular">{fmtVal(limits[0])}</span>
                    <span className="h-1.5 w-10 rounded-full ring-1 ring-white/15 sm:w-12" style={{ background: colormapGradient(cmapShown) }} />
                    <span className="tabular">{fmtVal(limits[1])}</span>
                    <span className="hidden font-sans text-white/50 sm:inline">MJy/sr</span>
                  </div>
                </div>
              </div>
            )}
            {images.length > 0 && (
              <>
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
                    <Button variant="secondary" size="sm" onClick={() => onGo({ target: DEFAULT_TARGET })}>
                      Open Barnard’s Star
                    </Button>
                  </div>
                ) : loading ? (
                  <div className="max-w-sm space-y-4">
                    <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
                    <p className="font-medium">
                      {target
                        ? 'Loading SPHEREx frames…'
                        : progress?.phase === 'frames'
                          ? `Cutting ${progress.total} SPHEREx images from NASA’s cloud archive…`
                          : 'Searching every SPHEREx image of this spot…'}
                    </p>
                    {!target && progress?.phase !== 'frames' && (
                      <p className="text-sm text-muted-foreground">
                        NASA’s archive can take up to a minute for a new position. Repeat visits are instant.
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

          {/* Right ascension labels (east is left, so RA grows leftward). */}
          <div className="relative col-start-2 h-4" aria-hidden>
            {images.length > 0 &&
              ticks.ra.map((t) => (
                <span
                  key={t.label}
                  className="tabular absolute top-0.5 -translate-x-1/2 font-mono text-[10px] whitespace-nowrap text-muted-foreground"
                  style={{ left: `${t.pos * 100}%` }}
                >
                  {t.label}
                </span>
              ))}
          </div>

          {/* Readout of whatever is under the pointer (or the aperture on touch screens). */}
          <div className="col-start-2 mt-2 flex min-h-12 items-center justify-between gap-3 rounded-lg bg-card/60 px-3 py-1.5 text-xs ring-1 ring-white/5 sm:min-h-9">
            <div className="tabular min-w-0 flex-1 font-mono text-muted-foreground">
              {readout ? (
                <>
                  <span className="whitespace-nowrap text-foreground">{formatRa(readout.ra)}</span>{' '}
                  <span className="whitespace-nowrap text-foreground">{formatDec(readout.dec)}</span>
                  {' · '}
                  <span className="whitespace-nowrap">
                    {Number.isFinite(readout.value) ? `${fmtVal(readout.value)} MJy/sr` : 'no data'}
                  </span>
                  {' · '}
                  <span className="whitespace-nowrap">{readout.offset.toFixed(0)}″ from centre</span>
                  {readout.star && (
                    <>
                      {' · '}
                      <span className="whitespace-nowrap text-emerald-300">Gaia star G {readout.star.g.toFixed(1)}</span>
                    </>
                  )}
                  {readout.wise && (
                    <>
                      {' · '}
                      <span className="whitespace-nowrap text-violet-300">
                        WISE W2 {readout.wise.w2.toFixed(1)}
                        {readout.wise.mover &&
                          `, moving ${(Math.hypot(readout.wise.pmra, readout.wise.pmdec) / 1000).toFixed(2)}″/yr`}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="font-sans">
                  {!images.length
                    ? '\u00a0'
                    : tool === 'pin'
                      ? 'Click the image to drop a pin, click a pin to remove it'
                      : 'Point at the image for coordinates, click to measure'}
                </span>
              )}
            </div>
            <ToolToggle tool={tool} onChange={setTool} />
          </div>

          {/* Transport */}
          <div className="col-start-2 mt-3 flex items-center gap-3">
            <Button size="icon" variant="secondary" onClick={() => setFrameIdx((i) => (i - 1 + groups.length) % Math.max(1, groups.length))} aria-label="Previous frame">
              <ChevronLeft />
            </Button>
            <Button size="icon" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'} className="size-10 rounded-full">
              {playing ? <Pause /> : <Play />}
            </Button>
            <Button size="icon" variant="secondary" onClick={() => setFrameIdx((i) => (i + 1) % Math.max(1, groups.length))} aria-label="Next frame">
              <ChevronRight />
            </Button>
            <Timeline
              groups={groups}
              current={current}
              onSeek={(k) => {
                setPlaying(false)
                setFrameIdx(k)
              }}
            />
            <span className="tabular hidden shrink-0 font-mono text-xs text-muted-foreground sm:inline">
              {groups.length ? current + 1 : 0}/{groups.length}
            </span>
            <div className="flex w-28 items-center gap-2">
              <Slider value={[fps]} min={0.5} max={12} step={0.5} onValueChange={([v]) => setFps(v)} aria-label="Playback speed" />
              <span className="tabular w-9 font-mono text-xs text-muted-foreground">{fps}/s</span>
            </div>
          </div>
          </div>
        </div>

        {/* Controls and measurements */}
        <aside className="space-y-6 rounded-2xl border border-white/10 bg-card/80 p-5 backdrop-blur lg:max-h-[calc(100svh-7rem)] lg:overflow-y-auto">
          <Section title="Wavelength" info={HELP.wavelength} aside={<span className="tabular font-mono text-xs text-primary">{bandLabel}</span>}>
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
            <BandPicker
              range={range}
              onChange={([lo, hi]) => setParams({ wmin: lo.toFixed(2), wmax: hi.toFixed(2) })}
              fallback={best}
            />
          </Section>

          <Section title="Frames" info={HELP.frames}>
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

          <div className="grid gap-6 sm:grid-cols-2 sm:gap-4">
            <Section title="Display" info={HELP.display}>
              <Segmented
                value={diff ? 'diff' : 'normal'}
                options={[
                  { id: 'normal', label: 'Image' },
                  { id: 'diff', label: 'Difference' },
                ]}
                onChange={(m) => setParams({ mode: m === 'diff' ? 'diff' : null })}
              />
              <div className="grid grid-cols-3 gap-1">
                <Toggle on={smoothOn} onClick={() => setParams({ smooth: smoothOn ? null : '1' })} label="Smooth" />
                <Toggle on={gaiaOn} onClick={() => setParams({ gaia: gaiaOn ? null : '1' })} label="Gaia" />
                <Toggle on={wiseOn} onClick={() => setParams({ wise: wiseOn ? null : '1' })} label="WISE" />
              </div>
            </Section>
            <Section title="Field of view" info={HELP.field}>
              <Segmented
                value={fovPx}
                options={FOVS.filter((f) => f.px <= size).map((f) => ({ id: f.px, label: f.label }))}
                onChange={(px) => setParams({ fov: px === 64 ? null : String(px) })}
              />
              <Toggle on={gridOn} onClick={() => setParams({ grid: gridOn ? null : '1' })} label="Coordinate grid" />
            </Section>
          </div>
          {diff && groups.length > 1 && (
            <Section title="Subtract" info={HELP.subtract}>
              <Segmented
                value={refIdx < 0 ? 'median' : 'frame'}
                options={[
                  { id: 'median', label: 'Median of all' },
                  { id: 'frame', label: refIdx < 0 ? 'One frame' : groups[refIdx].label },
                ]}
                onChange={(m) =>
                  setParams({ ref: m === 'median' ? null : (refParam ?? group.mjd.toFixed(4)) })
                }
              />
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {refIdx < 0
                    ? 'Each frame minus the typical sky. Anything that changed stands out.'
                    : `Each frame minus ${groups[refIdx].label}. Orange: only in this frame. Blue: only in B.`}
                </span>
                {current !== refIdx && (
                  <button
                    onClick={() => setParams({ ref: group.mjd.toFixed(4) })}
                    className="shrink-0 rounded-md px-2 py-1 font-medium whitespace-nowrap text-foreground ring-1 ring-white/15 transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    Use this frame as B
                  </button>
                )}
              </div>
            </Section>
          )}
          {!diff && (
            <Section title="Colour" info={HELP.colour}>
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
            title={spectrumTitle}
            info={HELP.spectrum}
            aside={
              <div className="flex items-center gap-3">
                {apert && (
                  <button
                    onClick={() => setApert(null)}
                    className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground"
                  >
                    <Crosshair className="size-3.5" /> Reset to centre
                  </button>
                )}
                <ExpandButton label={spectrumTitle} onClick={() => setExpanded('spectrum')} />
              </div>
            }
          >
            {spectrumChart(false)}
          </Section>

          <Section
            title="Brightness over time"
            info={HELP.lightCurve}
            aside={<ExpandButton label="Brightness over time" onClick={() => setExpanded('light')} />}
          >
            {lightCurveChart(false)}
          </Section>

          {pins.length > 0 && (
            <Section
              title="Pins"
              info={HELP.pins}
              aside={
                <button onClick={() => setPins([])} className="text-xs text-muted-foreground hover:text-foreground">
                  Clear all
                </button>
              }
            >
              <ol className="space-y-1.5">
                {pins.map((p, k) => {
                  const m = pinRef && p !== pinRef ? motion(pinRef, p) : null
                  const refNo = pinRef ? pins.indexOf(pinRef) + 1 : 1
                  return (
                    <li key={k} className="flex items-start gap-2.5 rounded-lg bg-muted px-2.5 py-2 text-xs">
                      <span className="tabular mt-px grid size-5 shrink-0 place-items-center rounded bg-white font-mono text-[11px] font-semibold text-black">
                        {k + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-x-2">
                          <span className="font-medium">{formatDay(p.mjd)}</span>
                          <span className="tabular font-mono text-muted-foreground">
                            {formatRa(p.ra)} {formatDec(p.dec)}
                          </span>
                        </div>
                        {m && (
                          <div className="mt-0.5 text-muted-foreground">
                            {m.sep.toFixed(1)}″ {m.direction} of pin {refNo}
                            {m.rate !== null ? (
                              <>
                                {' '}over {m.years.toFixed(2)} yr ={' '}
                                <span className="text-foreground">{m.rate.toFixed(1)}″/yr</span>
                              </>
                            ) : (
                              ', placed on the same date'
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setPins(pins.filter((_, j) => j !== k))}
                        aria-label={`Remove pin ${k + 1}`}
                        className="-m-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  )
                })}
              </ol>
            </Section>
          )}

          {ds && (
            <Section title="About these frames" info={HELP.about}>
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
                  {gaiaOn && ' Green circles: Gaia DR3 stars at this date (bigger = brighter).'}
                  {wiseOn && ' Violet diamonds: CatWISE2020 sources at this date; arrows mark WISE-measured movers.'}
                </p>
              )}
            </Section>
          )}
        </aside>
      </main>

      <Dialog open={expanded !== null} onOpenChange={(open) => !open && setExpanded(null)}>
        <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto p-6 sm:max-w-[min(1120px,calc(100vw-4rem))]">
          <DialogHeader>
            <DialogTitle className="font-heading text-lg">{expanded === 'spectrum' ? spectrumTitle : 'Brightness over time'}</DialogTitle>
            <DialogDescription>
              {title} · {expanded === 'spectrum' ? `${ds?.frames.length ?? 0} exposures, shaded band ${bandLabel}` : `${groups.length} frames, ${bandLabel}`}
            </DialogDescription>
          </DialogHeader>
          {expanded === 'spectrum' ? spectrumChart(true) : expanded === 'light' ? lightCurveChart(true) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
