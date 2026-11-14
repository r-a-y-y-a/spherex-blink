// SPHEREx L2 FLAGS bit planes (from the MSKNnnnn / MSKDnnnn keywords of the FLAGS extension).
export const FLAG_BITS: { bit: number; name: string; description: string }[] = [
  { bit: 0, name: 'TRANSIENT', description: 'Transient detected during readout' },
  { bit: 1, name: 'OVERFLOW', description: 'Saturated: overflow during readout' },
  { bit: 2, name: 'SUR_ERROR', description: 'Error in onboard processing' },
  { bit: 6, name: 'NONFUNC', description: 'Permanently unusable pixel' },
  { bit: 7, name: 'DICHROIC', description: 'Low efficiency due to dichroic' },
  { bit: 9, name: 'MISSING_DATA', description: 'Onboard data lost' },
  { bit: 10, name: 'HOT', description: 'Hot pixel' },
  { bit: 11, name: 'COLD', description: 'Anomalously low signal' },
  { bit: 14, name: 'PHANMISS', description: 'Phantom correction not applied' },
  { bit: 15, name: 'NONLINEAR', description: 'Nonlinearity correction unreliable' },
  { bit: 17, name: 'PERSIST', description: 'Persistent charge from an earlier bright source' },
  { bit: 19, name: 'OUTLIER', description: 'Flagged as an outlier' },
  { bit: 20, name: 'CROSSTALK', description: 'Affected by crosstalk' },
  { bit: 22, name: 'GHOST', description: 'Ghost of a bright source in the exposure' },
  { bit: 23, name: 'GHOST_FPA', description: 'Ghost of a bright source on another detector' },
  { bit: 24, name: 'GHOST_EXT', description: 'Ghost of a bright source outside the field' },
  { bit: 25, name: 'STREAK', description: 'Satellite or asteroid streak' },
  { bit: 26, name: 'BLOOM', description: 'Bloom artifact' },
  { bit: 27, name: 'SNOWBALL', description: 'Cosmic-ray snowball' },
  { bit: 28, name: 'HALO', description: 'Transient halo' },
]

/** Bits that mean "do not trust this pixel" (SOURCE and FULLSAMPLE are informational, so excluded). */
export const CONTAMINATION_MASK = FLAG_BITS.reduce((m, f) => m | (1 << f.bit), 0)

export function flagNames(flags: number): string[] {
  return FLAG_BITS.filter((f) => flags & (1 << f.bit)).map((f) => f.name)
}
