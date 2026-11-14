// RICE_1 decompression for FITS tile-compressed images (port of cfitsio's fits_rdecomp for
// 32-bit pixels). SPHEREx stores its FLAGS extension this way, one tile per image row.
// Uses plain Number arithmetic so bit buffers never overflow JavaScript's 32-bit operators.

const FS_BITS = 5
const FS_MAX = 25
const BITS = 32

const bitLength = (v: number) => (v === 0 ? 0 : Math.floor(Math.log2(v)) + 1)

export function riceDecompress32(c: Uint8Array, n: number, blockSize = 32): Int32Array {
  const out = new Int32Array(n)
  let p = 0
  let last = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) | 0
  p = 4
  let b = c[p++]
  let nbits = 8
  const pow = (k: number) => 2 ** k

  const unmap = (diff: number) => (diff % 2 === 0 ? diff / 2 : -(diff + 1) / 2)

  for (let i = 0; i < n; i += blockSize) {
    const imax = Math.min(i + blockSize, n)
    nbits -= FS_BITS
    while (nbits < 0) {
      b = b * 256 + c[p++]
      nbits += 8
    }
    const fs = Math.floor(b / pow(nbits)) - 1
    b %= pow(nbits)

    if (fs < 0) {
      // Low entropy: every difference is zero.
      for (let k = i; k < imax; k++) out[k] = last
    } else if (fs === FS_MAX) {
      // High entropy: raw BITS-bit differences.
      for (let k = i; k < imax; k++) {
        let need = BITS - nbits
        let diff = b * pow(need)
        for (need -= 8; need >= 0; need -= 8) diff += c[p++] * pow(need)
        if (nbits > 0) {
          const byte = c[p++]
          diff += Math.floor(byte / pow(-need))
          b = byte % pow(nbits)
        } else b = 0
        last = (unmap(diff) + last) | 0
        out[k] = last
      }
    } else {
      for (let k = i; k < imax; k++) {
        while (b === 0) {
          nbits += 8
          b = c[p++]
        }
        const nzero = nbits - bitLength(b)
        nbits -= nzero + 1
        b -= pow(nbits) // clear the terminating 1 bit
        nbits -= fs
        while (nbits < 0) {
          b = b * 256 + c[p++]
          nbits += 8
        }
        const diff = nzero * pow(fs) + Math.floor(b / pow(nbits))
        b %= pow(nbits)
        last = (unmap(diff) + last) | 0
        out[k] = last
      }
    }
  }
  return out
}
