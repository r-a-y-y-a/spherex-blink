import { ArrowUpRight, Layers, Orbit, ScanSearch, Telescope } from 'lucide-react'
import { Starfield } from '@/components/Starfield'
import { SearchBox, type Destination } from '@/components/SearchBox'
import { DETECTOR_BANDS } from '@/lib/analysis'
import { TARGETS } from '@/lib/targets'

const STEPS = [
  {
    icon: ScanSearch,
    title: 'Search the archive',
    text: 'Every SPHEREx image that covers your patch of sky, from NASA/IPAC IRSA, including releases added this week.',
  },
  {
    icon: Layers,
    title: 'Cut and align',
    text: 'Only the pixels you need are read from NASA’s cloud copy, then rotated north-up so every frame lines up.',
  },
  {
    icon: Orbit,
    title: 'Blink and measure',
    text: 'Stack by visit and wavelength, play it like a flipbook, subtract to reveal movers, and pull a spectrum.',
  },
]

export function Landing({ onGo }: { onGo: (d: Destination) => void }) {
  return (
    <div className="relative min-h-svh overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(56,98,180,0.35),transparent_70%),radial-gradient(ellipse_60%_40%_at_85%_110%,rgba(247,164,64,0.12),transparent_70%)]" />
      <Starfield />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2.5 font-heading text-lg font-semibold">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/30">
            <Telescope className="size-4.5" />
          </span>
          SPHEREx Blink
        </div>
        <a
          href="https://irsa.ipac.caltech.edu/Missions/spherex.html"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          Data: NASA/IPAC IRSA <ArrowUpRight className="size-3.5" />
        </a>
      </header>

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="mx-auto max-w-3xl pt-16 pb-14 text-center md:pt-24">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-muted-foreground backdrop-blur">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            102 infrared colours · whole sky every 6 months · since May 2025
          </p>
          <h1 className="font-heading text-5xl font-semibold leading-[1.05] md:text-7xl">
            Watch the infrared
            <br />
            <span className="bg-gradient-to-r from-[#7fb2ff] via-[#f7a440] to-[#ff6b4a] bg-clip-text text-transparent">
              sky move.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Type any star or coordinates. We turn every NASA SPHEREx image of that spot into a flipbook, so moving and
            changing objects jump out, just like the trick that found Pluto.
          </p>
          <div className="mx-auto mt-9 max-w-2xl">
            <SearchBox onGo={onGo} />
          </div>
        </section>

        <section className="pb-16">
          <h2 className="mb-4 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Start with the challenge targets
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {TARGETS.map((t) => {
              const [lo, hi] = DETECTOR_BANDS[t.bestDetector]
              return (
                <button
                  key={t.slug}
                  onClick={() => onGo({ target: t.slug })}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/70 p-4 text-left backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="absolute -top-10 -right-10 size-28 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/25" />
                  <span className="text-xs text-primary">{t.kind}</span>
                  <span className="mt-1 font-heading text-lg font-semibold">{t.name}</span>
                  <span className="mt-2 line-clamp-3 flex-1 text-sm text-muted-foreground">{t.blurb}</span>
                  <span className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular font-mono">
                      Best at {lo.toFixed(1)}–{hi.toFixed(1)} µm
                    </span>
                    <ArrowUpRight className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="grid gap-6 border-t border-white/10 py-12 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <div key={title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                <Icon className="size-5" />
              </span>
              <div>
                <h3 className="font-semibold">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">0{i + 1}</span>
                  {title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
