import { Landing } from '@/components/Landing'
import { Viewer } from '@/components/Viewer'
import { findTarget } from '@/lib/targets'
import type { Destination } from '@/components/SearchBox'
import { useSearchParams } from '@/lib/url'

export default function App() {
  const [params, setParams] = useSearchParams()

  const go = (d: Destination) =>
    setParams(
      'target' in d
        ? { target: d.target, ...findTarget(d.target)?.defaults }
        : { ra: d.ra.toFixed(5), dec: d.dec.toFixed(5), name: d.name ?? null },
      true,
    )
  const home = () => setParams({}, true)

  const target = findTarget(params.get('target'))
  const ra = Number(params.get('ra'))
  const dec = Number(params.get('dec'))
  const hasCoords = params.has('ra') && params.has('dec') && Number.isFinite(ra) && Number.isFinite(dec)

  if (!target && !hasCoords) return <Landing onGo={go} />
  return (
    <Viewer
      key={target?.slug ?? `${ra},${dec}`}
      target={target}
      ra={hasCoords ? ra : undefined}
      dec={hasCoords ? dec : undefined}
      name={params.get('name') ?? undefined}
      params={params}
      setParams={setParams}
      onGo={go}
      onHome={home}
    />
  )
}
