import { useEffect } from 'react'
import { Viewer } from '@/components/Viewer'
import { DEFAULT_TARGET, findTarget } from '@/lib/targets'
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

  const ra = Number(params.get('ra'))
  const dec = Number(params.get('dec'))
  const hasCoords = params.has('ra') && params.has('dec') && Number.isFinite(ra) && Number.isFinite(dec)
  // No target or position in the URL: open the default target, keeping any view options given.
  const target = findTarget(params.get('target')) ?? (hasCoords ? undefined : findTarget(DEFAULT_TARGET))

  // Write the default into the URL so the address bar and share links name what is shown.
  useEffect(() => {
    if (!params.get('target') && !hasCoords) setParams({ target: DEFAULT_TARGET })
  }, [params, hasCoords, setParams])

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
    />
  )
}
