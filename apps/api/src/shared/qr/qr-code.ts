import { reedSolomonParity } from "./reed-solomon.ts";

/**
 * A QR Code encoder, in byte mode at error-correction level M.
 *
 * ─── Why this is written here rather than installed ─────────────────────────
 *
 * QR encoding is a closed, fully specified algorithm (ISO/IEC 18004) with no
 * I/O, no configuration and no security surface, and the payload it carries
 * here is one short URL. The alternative pulls a package plus its dependency
 * tree into an API that has six direct dependencies, to compute something
 * deterministic.
 *
 * The real risk of hand-writing it is not complexity but *silence*: a wrong
 * table produces a code that looks like a QR code and will not scan, and no
 * amount of "it rendered" proves otherwise. Two things guard against that.
 *
 *  1. The block-structure table below is validated against geometry. The number
 *     of codewords a version holds is derivable from the symbol's dimensions
 *     (`rawDataModules`), completely independently of the error-correction
 *     table — so `blocks × (data + parity) === totalCodewords` is an equation
 *     that a single mistyped cell cannot satisfy. `qr.test.ts` asserts it for
 *     every supported version.
 *  2. The tests decode what this produces the way a scanner does: locate the
 *     format information by Hamming distance over all 32 legal values, unmask
 *     with whatever mask that reveals, de-interleave, verify Reed–Solomon
 *     syndromes, and read the payload back. Nothing in that path trusts the
 *     encoder's own view of what it did.
 *
 * ─── Deliberate limits ──────────────────────────────────────────────────────
 *
 * Byte mode only, level M only, versions 1–20. Numeric and alphanumeric modes
 * would encode a URL more densely but a URL is not numeric, and the extra modes
 * are extra tables to get wrong. Level M recovers around 15% of the symbol,
 * which is the usual choice for print. Version 20 holds 669 bytes — a menu URL
 * is around forty — so the ceiling is unreachable in practice, and is checked
 * rather than assumed.
 */

/** Smallest and largest symbol version this encoder emits. */
const MIN_VERSION = 1;
const MAX_VERSION = 20;

/** Byte mode. Four bits, from the mode-indicator table. */
const MODE_BYTE = 0b0100;

/**
 * Error-correction level M, as the two bits that go into the format
 * information. Deliberately not the same numbering as the level's name.
 */
const EC_LEVEL_M_FORMAT_BITS = 0b00;

/**
 * Level-M block structure: parity bytes per block, and how many blocks.
 *
 * Indexed by version. Everything else — how many data bytes each block holds,
 * and how the blocks split into two groups of differing length — is *derived*
 * from these two numbers and the version's total codeword count, rather than
 * tabulated. Deriving it removes three of the five columns a conventional table
 * carries, and with them three chances to transcribe a digit wrongly.
 */
const EC_BLOCKS_M: ReadonlyArray<{ parityPerBlock: number; blocks: number }> = [
  { parityPerBlock: 10, blocks: 1 }, // version 1
  { parityPerBlock: 16, blocks: 1 },
  { parityPerBlock: 26, blocks: 1 },
  { parityPerBlock: 18, blocks: 2 },
  { parityPerBlock: 24, blocks: 2 },
  { parityPerBlock: 16, blocks: 4 },
  { parityPerBlock: 18, blocks: 4 },
  { parityPerBlock: 22, blocks: 4 },
  { parityPerBlock: 22, blocks: 5 },
  { parityPerBlock: 26, blocks: 5 }, // version 10
  { parityPerBlock: 30, blocks: 5 },
  { parityPerBlock: 22, blocks: 8 },
  { parityPerBlock: 22, blocks: 9 },
  { parityPerBlock: 24, blocks: 9 },
  { parityPerBlock: 24, blocks: 10 },
  { parityPerBlock: 28, blocks: 10 },
  { parityPerBlock: 28, blocks: 11 },
  { parityPerBlock: 26, blocks: 13 },
  { parityPerBlock: 26, blocks: 14 },
  { parityPerBlock: 26, blocks: 16 }, // version 20
];

export interface QrMatrix {
  /** Width and height in modules, excluding the quiet zone. */
  readonly size: number;
  /** `true` is a dark module. Indexed `[y][x]`. */
  readonly modules: ReadonlyArray<ReadonlyArray<boolean>>;
  readonly version: number;
  /** Which of the eight mask patterns was applied. */
  readonly mask: number;
}

/** Modules across one side of a symbol of this version. */
export function symbolSize(version: number): number {
  return version * 4 + 17;
}

/**
 * How many modules a version has available for data and parity, derived from
 * the symbol's geometry.
 *
 * This is the independent check on `EC_BLOCKS_M`: it counts the whole symbol
 * and subtracts the function patterns, never consulting the error-correction
 * table. The two must agree, and the tests require it.
 */
export function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;

  if (version >= 2) {
    // Alignment patterns: an n×n grid of 5×5 patterns, less the three that
    // would sit on the finder patterns, less their overlap with the timing
    // patterns. The closed form is the specification's.
    const alignmentCount = Math.floor(version / 7) + 2;
    modules -= (25 * alignmentCount - 10) * alignmentCount - 55;

    if (version >= 7) {
      // Version information, 18 bits, recorded twice.
      modules -= 36;
    }
  }

  return modules;
}

/** Total codewords — data plus parity — a version holds. */
export function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

/** Data codewords a version holds at level M. */
export function dataCodewords(version: number): number {
  const { parityPerBlock, blocks } = blockStructure(version);
  return totalCodewords(version) - parityPerBlock * blocks;
}

export function blockStructure(version: number): { parityPerBlock: number; blocks: number } {
  const entry = EC_BLOCKS_M[version - 1];
  if (!entry) {
    throw new Error(`Unsupported QR version ${version}`);
  }
  return entry;
}

/** Centre coordinates of the alignment patterns for a version. */
export function alignmentCentres(version: number): number[] {
  if (version === 1) {
    return [];
  }

  const count = Math.floor(version / 7) + 2;
  const last = version * 4 + 10;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;

  const centres = [6];
  for (let position = last; centres.length < count; position -= step) {
    centres.splice(1, 0, position);
  }

  return centres;
}

/**
 * Encodes text as a QR matrix.
 *
 * The text is encoded as UTF-8 bytes. Scanners read those back as bytes, which
 * is moot here regardless: the payload is a URL made of ASCII.
 */
export function encodeQr(text: string): QrMatrix {
  const data = new TextEncoder().encode(text);
  const version = chooseVersion(data.length);
  const codewords = buildCodewords(data, version);

  return renderMatrix(codewords, version);
}

/** The smallest version whose data capacity fits the payload. */
function chooseVersion(byteLength: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    if (byteLength <= maxPayloadBytes(version)) {
      return version;
    }
  }

  throw new Error(
    `Payload of ${byteLength} bytes exceeds the largest supported QR version (${MAX_VERSION})`,
  );
}

/**
 * Payload bytes that fit in a version, after the mode indicator and the
 * character count.
 */
export function maxPayloadBytes(version: number): number {
  const headerBits = 4 + characterCountBits(version);
  return Math.floor((dataCodewords(version) * 8 - headerBits) / 8);
}

/** The character-count field widens at version 10 in byte mode. */
export function characterCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** Data bytes to interleaved codewords, parity included. */
function buildCodewords(data: Uint8Array, version: number): Uint8Array {
  const bits = new BitBuffer();
  bits.push(MODE_BYTE, 4);
  bits.push(data.length, characterCountBits(version));
  for (const byte of data) {
    bits.push(byte, 8);
  }

  const capacityBits = dataCodewords(version) * 8;

  // Terminator: up to four zero bits, fewer if the symbol is nearly full.
  bits.push(0, Math.min(4, capacityBits - bits.length));
  // Then to a byte boundary.
  bits.push(0, (8 - (bits.length % 8)) % 8);

  // Then the two alternating pad bytes the specification names, until full.
  const padBytes = [0xec, 0x11];
  for (let i = 0; bits.length < capacityBits; i += 1) {
    bits.push(padBytes[i % 2]!, 8);
  }

  return interleave(bits.toBytes(), version);
}

/**
 * Splits data into blocks, appends parity to each, and interleaves them.
 *
 * Interleaving is what makes the error correction useful in practice: a scuff
 * damages a contiguous run of modules, and spreading each block's bytes across
 * the symbol turns one unrecoverable block into a recoverable byte or two in
 * several blocks.
 *
 * Blocks come in two lengths — most versions cannot divide their capacity
 * evenly — with the longer group last. During interleaving the shorter blocks
 * have no byte at the longer blocks' final data position, so that column skips
 * them.
 */
function interleave(data: Uint8Array, version: number): Uint8Array {
  const { parityPerBlock, blocks: blockCount } = blockStructure(version);
  const total = totalCodewords(version);

  const shortBlockTotal = Math.floor(total / blockCount);
  const shortBlockCount = blockCount - (total % blockCount);
  const shortBlockData = shortBlockTotal - parityPerBlock;

  const dataParts: Uint8Array[] = [];
  const parityParts: Uint8Array[] = [];

  let offset = 0;
  for (let i = 0; i < blockCount; i += 1) {
    const length = shortBlockData + (i < shortBlockCount ? 0 : 1);
    const part = data.slice(offset, offset + length);
    offset += length;

    dataParts.push(part);
    parityParts.push(reedSolomonParity(part, parityPerBlock));
  }

  const result = new Uint8Array(total);
  let written = 0;

  // Data bytes, one column at a time across all blocks.
  for (let i = 0; i <= shortBlockData; i += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      // The extra column exists only in the longer blocks.
      if (i === shortBlockData && block < shortBlockCount) {
        continue;
      }
      result[written] = dataParts[block]![i]!;
      written += 1;
    }
  }

  // Then parity, which is the same length in every block.
  for (let i = 0; i < parityPerBlock; i += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      result[written] = parityParts[block]![i]!;
      written += 1;
    }
  }

  return result;
}

/** Accumulates big-endian bit fields. */
class BitBuffer {
  private readonly bits: number[] = [];

  get length(): number {
    return this.bits.length;
  }

  push(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, index) => {
      if (bit) {
        bytes[index >>> 3] = (bytes[index >>> 3]! | (0x80 >>> (index & 7))) as number;
      }
    });
    return bytes;
  }
}

/** Builds the module grid: function patterns, then data, then the best mask. */
function renderMatrix(codewords: Uint8Array, version: number): QrMatrix {
  const size = symbolSize(version);
  const modules = emptyGrid(size);
  // Which modules belong to function patterns, and so must neither carry data
  // nor be masked.
  const reserved = emptyGrid(size);

  drawFunctionPatterns(modules, reserved, version);
  drawCodewords(modules, reserved, codewords);

  const mask = chooseMask(modules, reserved, version);
  applyMask(modules, reserved, mask);
  drawFormatInfo(modules, reserved, mask);

  return { size, modules, version, mask };
}

function emptyGrid(size: number): boolean[][] {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

function drawFunctionPatterns(modules: boolean[][], reserved: boolean[][], version: number): void {
  const size = symbolSize(version);

  // Timing patterns: alternating modules along row 6 and column 6. They give a
  // scanner a ruler for module width.
  for (let i = 0; i < size; i += 1) {
    setFunction(modules, reserved, 6, i, i % 2 === 0);
    setFunction(modules, reserved, i, 6, i % 2 === 0);
  }

  // Finder patterns with their separators, in three corners. The fourth corner
  // is left clear — its absence is how a scanner works out the rotation.
  drawFinder(modules, reserved, 3, 3);
  drawFinder(modules, reserved, size - 4, 3);
  drawFinder(modules, reserved, 3, size - 4);

  // Alignment patterns at every intersection of the centre coordinates, except
  // the three that would collide with a finder pattern.
  const centres = alignmentCentres(version);
  const first = centres[0];
  const last = centres[centres.length - 1];

  for (const cx of centres) {
    for (const cy of centres) {
      const onFinder =
        (cx === first && cy === first) ||
        (cx === first && cy === last) ||
        (cx === last && cy === first);

      if (!onFinder) {
        drawAlignment(modules, reserved, cx, cy);
      }
    }
  }

  // Reserve the format-information modules; their values are written once a
  // mask has been chosen.
  reserveFormatInfo(reserved, size);

  if (version >= 7) {
    drawVersionInfo(modules, reserved, version);
  }
}

function drawFinder(modules: boolean[][], reserved: boolean[][], cx: number, cy: number): void {
  // A 7×7 pattern of concentric rings plus a one-module light separator, so the
  // footprint examined here is 9×9, clipped at the symbol's edge.
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = cx + dx;
      const y = cy + dy;

      if (x < 0 || x >= modules.length || y < 0 || y >= modules.length) {
        continue;
      }

      // Dark for the 3×3 core and the ring at distance 2; light between them
      // and in the separator, which is what makes the pattern recognisable.
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(modules, reserved, x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(modules: boolean[][], reserved: boolean[][], cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunction(modules, reserved, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/**
 * Reserves the modules the format information will occupy.
 *
 * The two copies are **not** the same length, and getting that wrong is a
 * silent capacity bug rather than a visible one. The first copy runs nine
 * modules along each of row 8 and column 8 next to the top-left finder. The
 * second copy runs only eight: `size-8 … size-1` along row 8, and `size-8 …
 * size-1` down column 8 (the first of which is the always-dark module).
 *
 * Reserving nine on the second copy as well — the obvious symmetry, and what
 * this originally did — steals exactly two modules from the data region, at
 * `(size-9, 8)` and `(8, size-9)`. The symbol still decodes for most payloads,
 * because the encoder and any matching decoder agree about the mistake; it
 * fails only where a version's capacity is filled exactly, and then it drops
 * the final two bits. The geometry assertion in `qr.test.ts` is what caught it.
 */
function reserveFormatInfo(reserved: boolean[][], size: number): void {
  for (let i = 0; i <= 8; i += 1) {
    reserved[8]![i] = true;
    reserved[i]![8] = true;
  }

  for (let i = 0; i < 8; i += 1) {
    reserved[8]![size - 1 - i] = true;
    reserved[size - 1 - i]![8] = true;
  }
}

/**
 * Version information, present from version 7 up.
 *
 * Six data bits with an (18, 6) BCH code appended, written twice so a scanner
 * can still read the version if one copy is damaged.
 */
function drawVersionInfo(modules: boolean[][], reserved: boolean[][], version: number): void {
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }

  const bits = (version << 12) | remainder;
  const size = symbolSize(version);

  for (let i = 0; i < 18; i += 1) {
    const bit = bitAt(bits, i);
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);

    setFunction(modules, reserved, a, b, bit);
    setFunction(modules, reserved, b, a, bit);
  }
}

/**
 * Format information: the error-correction level and the mask, protected by a
 * (15, 5) BCH code and XORed with a fixed pattern so it is never all zeros.
 *
 * Written in two places, for the same redundancy reason as the version bits.
 */
function drawFormatInfo(modules: boolean[][], reserved: boolean[][], mask: number): void {
  const bits = formatInfoBits(mask);
  const size = modules.length;

  // First copy: down the left of the top-left finder, then right along its
  // bottom. Row and column 6 are stepped over — the timing patterns own them.
  for (let i = 0; i <= 5; i += 1) {
    setFunction(modules, reserved, 8, i, bitAt(bits, i));
  }
  setFunction(modules, reserved, 8, 7, bitAt(bits, 6));
  setFunction(modules, reserved, 8, 8, bitAt(bits, 7));
  setFunction(modules, reserved, 7, 8, bitAt(bits, 8));
  for (let i = 9; i < 15; i += 1) {
    setFunction(modules, reserved, 14 - i, 8, bitAt(bits, i));
  }

  // Second copy: along the bottom-left and the top-right.
  for (let i = 0; i < 8; i += 1) {
    setFunction(modules, reserved, size - 1 - i, 8, bitAt(bits, i));
  }
  for (let i = 8; i < 15; i += 1) {
    setFunction(modules, reserved, 8, size - 15 + i, bitAt(bits, i));
  }

  // The dark module: always dark, at a fixed position. A scanner uses it to
  // establish polarity.
  setFunction(modules, reserved, 8, size - 8, true);
}

/**
 * The 15 bits that encode one mask choice at level M.
 *
 * Exported because the tests need the full set of legal values to recover a
 * mask from a matrix the way a scanner does, by nearest match.
 */
export function formatInfoBits(mask: number): number {
  const data = (EC_LEVEL_M_FORMAT_BITS << 3) | mask;

  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }

  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

function bitAt(value: number, index: number): boolean {
  return ((value >>> index) & 1) === 1;
}

function setFunction(
  modules: boolean[][],
  reserved: boolean[][],
  x: number,
  y: number,
  dark: boolean,
): void {
  modules[y]![x] = dark;
  reserved[y]![x] = true;
}

/**
 * Places the codeword bits in the symbol.
 *
 * The path is two modules wide, running up the right edge, down the next pair,
 * and so on, stepping over reserved modules. Column 6 is skipped entirely
 * because the vertical timing pattern occupies it and would otherwise offset
 * every column to its left by one.
 */
function drawCodewords(modules: boolean[][], reserved: boolean[][], codewords: Uint8Array): void {
  const size = modules.length;
  const totalBits = codewords.length * 8;
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern. The loop variable itself is
    // moved to 5 — not a copy of it — so the remaining pairs continue 5, 3, 1.
    // Adjusting a copy instead leaves `right` on 6 and the next iterations land
    // on 4 and 2, which revisits one column pair and skips another. That
    // corrupts the bit order for every symbol.
    if (right === 6) {
      right = 5;
    }

    for (let step = 0; step < size; step += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        // The direction alternates each column pair, which is what makes the
        // path continuous instead of jumping back to the top every time.
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - step : step;

        if (reserved[y]![x] || bitIndex >= totalBits) {
          continue;
        }

        modules[y]![x] = ((codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
      }
    }
  }
}

/** The eight mask patterns. `true` means "invert this module". */
export const MASK_PATTERNS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(modules: boolean[][], reserved: boolean[][], mask: number): void {
  const pattern = MASK_PATTERNS[mask];
  if (!pattern) {
    throw new Error(`Unknown mask ${mask}`);
  }

  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (!reserved[y]![x] && pattern(x, y)) {
        modules[y]![x] = !modules[y]![x];
      }
    }
  }
}

/**
 * Picks the mask that scores lowest on the four penalty rules.
 *
 * Masking exists so the symbol does not contain large blank areas or shapes
 * that look like finder patterns — both of which confuse a scanner. All eight
 * are tried because the specification says to; the winner is recorded in the
 * format information, so a scanner never has to guess which was used.
 */
function chooseMask(modules: boolean[][], reserved: boolean[][], version: number): number {
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row) => [...row]);
    // The format bits are part of the symbol being scored, so they are written
    // before scoring. A throwaway reserved grid keeps the real one untouched.
    applyMask(candidate, reserved, mask);
    drawFormatInfo(
      candidate,
      reserved.map((row) => [...row]),
      mask,
    );

    const penalty = penaltyScore(candidate, version);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
  }

  return bestMask;
}

/** The four penalty rules from the specification. */
function penaltyScore(modules: boolean[][], version: number): number {
  const size = symbolSize(version);
  let penalty = 0;

  // Rule 1: runs of five or more same-coloured modules in a row or column.
  for (let i = 0; i < size; i += 1) {
    penalty += runPenalty(modules[i]!);
    penalty += runPenalty(modules.map((row) => row[i]!));
  }

  // Rule 2: every 2×2 block of a single colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const value = modules[y]![x];
      if (
        value === modules[y]![x + 1] &&
        value === modules[y + 1]![x] &&
        value === modules[y + 1]![x + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: shapes that resemble a finder pattern.
  for (let i = 0; i < size; i += 1) {
    penalty += finderLikePenalty(modules[i]!);
    penalty += finderLikePenalty(modules.map((row) => row[i]!));
  }

  // Rule 4: deviation from an even balance of dark and light.
  const dark = modules.flat().filter(Boolean).length;
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

function runPenalty(line: readonly boolean[]): number {
  let penalty = 0;
  let runLength = 1;

  for (let i = 1; i < line.length; i += 1) {
    if (line[i] === line[i - 1]) {
      runLength += 1;
      continue;
    }
    if (runLength >= 5) {
      penalty += runLength - 2;
    }
    runLength = 1;
  }

  return runLength >= 5 ? penalty + runLength - 2 : penalty;
}

/**
 * Rule 3: the 1:1:3:1:1 dark/light ratio of a finder pattern, with four light
 * modules to one side, scores 40 wherever it appears among the data.
 */
const FINDER_LIKE = [true, false, true, true, true, false, true];

function finderLikePenalty(line: readonly boolean[]): number {
  let penalty = 0;

  for (let i = 0; i + 7 <= line.length; i += 1) {
    if (!FINDER_LIKE.every((value, offset) => line[i + offset] === value)) {
      continue;
    }

    const before = line.slice(Math.max(0, i - 4), i);
    const after = line.slice(i + 7, i + 11);
    const clearBefore = before.length === 4 && before.every((value) => !value);
    const clearAfter = after.length === 4 && after.every((value) => !value);

    if (clearBefore || clearAfter) {
      penalty += 40;
    }
  }

  return penalty;
}
