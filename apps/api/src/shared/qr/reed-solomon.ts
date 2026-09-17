/**
 * Reed–Solomon error correction over GF(256), as QR codes specify it.
 *
 * This is the part of QR generation that makes a code survive a coffee ring or
 * a scuffed table. It is pure arithmetic: no I/O, no configuration, and the
 * same input always produces the same parity bytes.
 *
 * The field is GF(2^8) with the primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
 * (0x11D) and generator 2 — the values ISO/IEC 18004 fixes for QR. Nothing here
 * is a choice we get to make.
 */

/**
 * Exponent and logarithm tables for the field.
 *
 * Multiplication in GF(256) is addition of logarithms, so these turn an
 * otherwise bit-twiddling loop into two lookups and an add. The exponent table
 * is doubled in length so `LOG[a] + LOG[b]` (which can reach 508) needs no
 * modulo — the wrap is baked into the table.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    // x *= 2 in the field: shift, and fold back in the primitive polynomial
    // whenever the result leaves 8 bits.
    x <<= 1;
    if (x & 0x100) {
      x ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i += 1) {
    EXP[i] = EXP[i - 255]!;
  }
}

/** Field multiplication. Zero has no logarithm, so it is handled separately. */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) {
    return 0;
  }
  return EXP[LOG[a]! + LOG[b]!]!;
}

/** `2^i` in the field — the evaluation points Reed–Solomon is built on. */
export function gfExp(i: number): number {
  return EXP[i % 255]!;
}

/**
 * The generator polynomial for `degree` parity bytes: ∏ (x - 2^i).
 *
 * Computed rather than tabulated. A table of 30-odd polynomials is a table of
 * 30-odd chances to make a transcription error that only shows up as a code
 * that will not scan, and the computation is a few microseconds.
 */
function generatorPolynomial(degree: number): Uint8Array {
  // Coefficients, highest power first. Starts as the polynomial `1`.
  let poly = new Uint8Array([1]);

  for (let i = 0; i < degree; i += 1) {
    // Multiply by (x - 2^i). Subtraction is XOR here, so the sign is moot.
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = (next[j]! ^ poly[j]!) as number;
      next[j + 1] = (next[j + 1]! ^ gfMul(poly[j]!, EXP[i]!)) as number;
    }
    poly = next;
  }

  return poly;
}

/**
 * The parity bytes for one block of data.
 *
 * Polynomial long division of the message by the generator, returning the
 * remainder. Because the generator is monic, each step's quotient coefficient
 * is simply the current leading byte.
 */
export function reedSolomonParity(data: Uint8Array, parityLength: number): Uint8Array {
  if (parityLength <= 0) {
    throw new Error("parityLength must be positive");
  }

  const generator = generatorPolynomial(parityLength);
  const working = new Uint8Array(data.length + parityLength);
  working.set(data);

  for (let i = 0; i < data.length; i += 1) {
    const coefficient = working[i]!;
    if (coefficient === 0) {
      continue;
    }
    for (let j = 0; j < generator.length; j += 1) {
      working[i + j] = (working[i + j]! ^ gfMul(generator[j]!, coefficient)) as number;
    }
  }

  return working.slice(data.length);
}

/**
 * The Reed–Solomon syndromes of a codeword: its value at 2^0 … 2^(n-1).
 *
 * A valid codeword evaluates to zero at every one of those points — that is the
 * defining property, and the first thing any decoder computes. Exposed because
 * it is how the tests verify that the parity bytes above are genuine RS parity
 * rather than plausible-looking noise: all-zero syndromes for an untouched
 * codeword, non-zero the moment a byte is corrupted.
 */
export function reedSolomonSyndromes(codeword: Uint8Array, parityLength: number): Uint8Array {
  const syndromes = new Uint8Array(parityLength);

  for (let i = 0; i < parityLength; i += 1) {
    // Horner's method, evaluating the codeword polynomial at 2^i.
    let value = 0;
    for (const byte of codeword) {
      value = gfMul(value, gfExp(i)) ^ byte;
    }
    syndromes[i] = value;
  }

  return syndromes;
}
