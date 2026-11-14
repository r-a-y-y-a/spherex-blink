import { useEffect, useState } from 'react'

// Every view is addressable: ?target=wise-0855 or ?ra=..&dec=..&name=.., plus view options.
export function useSearchParams(): [URLSearchParams, (next: Record<string, string | null>, push?: boolean) => void] {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search))
  useEffect(() => {
    const onPop = () => setParams(new URLSearchParams(window.location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const update = (next: Record<string, string | null>, push = false) => {
    const p = push ? new URLSearchParams() : new URLSearchParams(window.location.search)
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
