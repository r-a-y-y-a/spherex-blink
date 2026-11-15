import { useMemo, useRef, useState } from 'react'
import { VISIT_COLORS } from '@/lib/colors'

export type Point = { x: number; y: number; series: number; tip: string; strong?: boolean; hollow?: boolean }

type Props = {
  points: Point[]
  seriesNames: string[]
  xLabel: string
  yLabel: string
  xDomain?: [number, number]
  xTicks?: (domain: [number, number]) => { v: number; label: string }[]
  band?: [number, number]
  height?: number
  /** Drawing width in SVG units; the chart scales to its box, so a wider chart keeps text the same size. */
  width?: number
  empty?: string
}

const M = { top: 10, right: 12, bottom: 34, left: 52 }

function niceTicks(lo: number, hi: number, n = 4) {
  const span = hi - lo || 1
  const step = 10 ** Math.floor(Math.log10(span / n))
  const err = span / n / step
  const s = step * (err >= 7 ? 10 : err >= 3 ? 5 : err >= 1.5 ? 2 : 1)
  const out: number[] = []
  for (let v = Math.ceil(lo / s) * s; v <= hi + 1e-9; v += s) out.push(Number(v.toPrecision(10)))
  return out
}

export function ScatterChart({ points, seriesNames, xLabel, yLabel, xDomain, xTicks, band, height = 200, width = 520, empty }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const H = height
  const W = width

  const { xd, yd, sx, sy } = useMemo(() => {
    const finite = points.filter((p) => Number.isFinite(p.y))
    const xs = finite.map((p) => p.x)
    // Without a fixed domain, pad 4% each side so the first and last points are not on the edges.
    const span = Math.max(...xs) - Math.min(...xs)
    const raw = xDomain ?? [Math.min(...xs) - span * 0.04, Math.max(...xs) + span * 0.04]
    const xd: [number, number] = raw[0] === raw[1] ? [raw[0] - 1, raw[1] + 1] : [raw[0], raw[1]]
    // Robust y range: ignore the wildest 2% (cosmic rays, edge pixels) on each side.
    const ys = finite.map((p) => p.y).sort((a, b) => a - b)
    // Too few points to call any of them an outlier: use the full range.
    const trim = ys.length >= 30 ? 0.02 : 0
    const q = (f: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.floor(f * (ys.length - 1))))] ?? 0
    let lo = Math.min(0, q(trim)), hi = q(1 - trim)
    if (hi <= lo) hi = lo + 1
    const pad = (hi - lo) * 0.12
    lo -= pad
    hi += pad
    const sx = (v: number) => M.left + ((v - xd[0]) / (xd[1] - xd[0])) * (W - M.left - M.right)
    const sy = (v: number) => M.top + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - M.top - M.bottom)
    return { xd, yd: [lo, hi] as [number, number], sx, sy }
  }, [points, xDomain, H, W])

  if (!points.some((p) => Number.isFinite(p.y)))
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-white/10 text-sm text-muted-foreground" style={{ height }}>
        {empty ?? 'No measurements here'}
      </div>
    )

  const xt = xTicks ? xTicks(xd) : niceTicks(xd[0], xd[1], Math.max(5, Math.round(W / 110))).map((v) => ({ v, label: String(v) }))
  const yt = niceTicks(yd[0], yd[1], 4)
  const used = [...new Set(points.map((p) => p.series))].sort()

  function onMove(e: React.PointerEvent) {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    let best = -1, bd = 24 ** 2
    points.forEach((p, i) => {
      if (!Number.isFinite(p.y)) return
      const d = (sx(p.x) - mx) ** 2 + (sy(p.y) - my) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    })
    setHover(best >= 0 ? best : null)
  }

  const hp = hover !== null ? points[hover] : null
  return (
    <div>
      {used.length >= 2 && (
        <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {used.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full" style={{ background: VISIT_COLORS[s % VISIT_COLORS.length] }} />
              {seriesNames[s]}
            </span>
          ))}
        </div>
      )}
      <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`${yLabel} against ${xLabel}`}
      >
        {band && (
          <rect
            x={sx(Math.max(band[0], xd[0]))}
            y={M.top}
            width={Math.max(0, sx(Math.min(band[1], xd[1])) - sx(Math.max(band[0], xd[0])))}
            height={H - M.top - M.bottom}
            fill="rgba(247,164,64,0.08)"
          />
        )}
        {yt.map((v) => (
          <g key={v}>
            <line x1={M.left} x2={W - M.right} y1={sy(v)} y2={sy(v)} stroke="rgba(148,163,194,0.12)" />
            <text x={M.left - 8} y={sy(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular">
              {Math.abs(v) >= 1000 ? `${v / 1000}k` : v}
            </text>
          </g>
        ))}
        {yd[0] < 0 && yd[1] > 0 && (
          <line x1={M.left} x2={W - M.right} y1={sy(0)} y2={sy(0)} stroke="rgba(148,163,194,0.35)" />
        )}
        {xt.map(({ v, label }) => (
          <text key={v} x={sx(v)} y={H - M.bottom + 16} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular">
            {label}
          </text>
        ))}
        <text x={(M.left + W - M.right) / 2} y={H - 3} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          {xLabel}
        </text>
        <text transform={`translate(12 ${(M.top + H - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          {yLabel}
        </text>
        {points.map((p, i) =>
          Number.isFinite(p.y) ? (
            <circle
              key={i}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={p.strong ? 5 : 3.5}
              fill={p.hollow ? 'none' : VISIT_COLORS[p.series % VISIT_COLORS.length]}
              fillOpacity={p.strong ? 1 : 0.75}
              stroke={p.hollow ? VISIT_COLORS[p.series % VISIT_COLORS.length] : '#0d1117'}
              strokeWidth={p.strong ? 2 : p.hollow ? 1.25 : 1}
            />
          ) : null,
        )}
        {hp && (
          <circle cx={sx(hp.x)} cy={sy(hp.y)} r={7} fill="none" stroke="#e8ecf4" strokeWidth={1.5} />
        )}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-popover px-2.5 py-1.5 text-xs whitespace-pre shadow-xl"
          style={{
            left: `${(sx(hp.x) / W) * 100}%`,
            top: `${(sy(hp.y) / H) * 100}%`,
            transform: `translate(${sx(hp.x) > W * 0.6 ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
          }}
        >
          {hp.tip}
        </div>
      )}
      </div>
    </div>
  )
}
