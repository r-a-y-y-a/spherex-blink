// Parses sky coordinates typed by a person. Accepts:
//   "133.795 -7.245", "133.795, -7.245"                     decimal degrees
//   "08h55m10.831s -7d14m42.53s", "08:55:10.8 -07:14:42.5", "08 55 10.8 -07 14 42.5"
export function parseCoords(input: string): { ra: number; dec: number } | null {
  const s = input.trim().replace(/[,]/g, ' ').replace(/[°′″'"]/g, ' ')
  const dec2 = s.match(/^([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)$/)
  if (dec2) return check(Number(dec2[1]), Number(dec2[2]))

  const parts = s
    .replace(/[hdms:]/gi, ' ')
    .trim()
    .split(/\s+/)
  if (parts.length !== 6) return null
  const [rh, rm, rs, dd, dm, ds] = parts
  if (![rh, rm, rs, dd, dm, ds].every((p) => /^[+-]?\d+(\.\d+)?$/.test(p))) return null
  const ra = 15 * (Number(rh) + Number(rm) / 60 + Number(rs) / 3600)
  const sign = dd.startsWith('-') ? -1 : 1
  const dec = sign * (Math.abs(Number(dd)) + Number(dm) / 60 + Number(ds) / 3600)
  return check(ra, dec)
}

function check(ra: number, dec: number) {
  return ra >= 0 && ra < 360 && dec >= -90 && dec <= 90 ? { ra, dec } : null
}

export function formatRa(ra: number) {
  const h = ra / 15
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = ((h - hh) * 60 - mm) * 60
  return `${String(hh).padStart(2, '0')}h${String(mm).padStart(2, '0')}m${ss.toFixed(2).padStart(5, '0')}s`
}

export function formatDec(dec: number) {
  const a = Math.abs(dec)
  const d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60
  return `${dec < 0 ? '−' : '+'}${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}′${s.toFixed(1).padStart(4, '0')}″`
}
