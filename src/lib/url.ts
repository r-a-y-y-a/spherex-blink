import { useEffect, useState } from 'react'

// Every view is addressable: ?target=wise-0855 or ?ra=..&dec=..&name=.., plus view options.
/**
 * `push`: false replaces the current history entry, keeping other params; true adds an entry
 * with only `next`; 'keep' adds an entry but keeps the other params (e.g. panning the sky).
 */
export type SetParams = (next: Record<string, string | null>, push?: boolean | 'keep') => void

export function useSearchParams(): [URLSearchParams, SetParams] {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search))
  useEffect(() => {
    const onPop = () => setParams(new URLSearchParams(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const update: SetParams = (next, push = false) => {
    const p = push === true ? new URLSearchParams() : new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') p.delete(k)
      else p.set(k, v)
    }
    const url = `${window.location.pathname}${p.size ? `?${p}` : ''}`
    if (push) window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    setParams(new URLSearchParams(p))
  }
  return [params, update]
}
