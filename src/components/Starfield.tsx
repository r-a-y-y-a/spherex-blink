import { useEffect, useRef } from 'react'

// Slowly twinkling background stars, with one faint "mover" drifting across: the thing
// this tool helps you find.
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let w = 0, h = 0
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const stars = Array.from({ length: 260 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() ** 3 * 1.6 + 0.3,
      p: Math.random() * Math.PI * 2,
      warm: Math.random() < 0.25,
    }))
    const resize = () => {
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        const a = reduce ? 0.7 : 0.45 + 0.4 * Math.sin(t / 1400 + s.p)
        ctx.fillStyle = s.warm ? `rgba(255,190,120,${a})` : `rgba(200,215,255,${a})`
        ctx.beginPath()
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      const m = ((t / 40000) % 1) * 1.2 - 0.1
      const g = ctx.createRadialGradient(m * w, h * (0.28 + m * 0.12), 0, m * w, h * (0.28 + m * 0.12), 10)
      g.addColorStop(0, 'rgba(247,164,64,0.95)')
      g.addColorStop(1, 'rgba(247,164,64,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(m * w, h * (0.28 + m * 0.12), 10, 0, Math.PI * 2)
      ctx.fill()
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
}
