import tables from './wavelength.json' with { type: 'json' }

// Per-detector wavelength lookup (from each file's WCS-WAVE extension; identical for every
// file of a given detector, so it ships with the app). Control points are 1-based FITS pixels.
type Table = { x: number[]; y: number[]; wave: number[][]; width: number[][] }
const TABLES = tables as Record<string, Table>

function bracket(points: number[], p: number): [number, number] {
  let i = 0
  while (i < points.length - 2 && p > points[i + 1]) i++
  const t = (p - points[i]) / (points[i + 1] - points[i])
  return [i, Math.min(1, Math.max(0, t))]
}

function bilinear(grid: number[][], ix: number, tx: number, iy: number, ty: number) {
  const a = grid[iy][ix], b = grid[iy][ix + 1], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

/** Central wavelength and bandwidth (microns) seen by a 0-based full-detector pixel. */
export function wavelengthAt(detector: number, x: number, y: number) {
  const t = TABLES[String(detector)]
  if (!t) throw new Error(`No wavelength table for detector ${detector}`)
  const [ix, tx] = bracket(t.x, x + 1)
  const [iy, ty] = bracket(t.y, y + 1)
  return { wave: bilinear(t.wave, ix, tx, iy, ty), width: bilinear(t.width, ix, tx, iy, ty) }
}
