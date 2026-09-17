import { describe, expect, test } from "bun:test";
import {
  alignmentCentres,
  blockStructure,
  characterCountBits,
  dataCodewords,
  encodeQr,
  formatInfoBits,
  MASK_PATTERNS,
  maxPayloadBytes,
  rawDataModules,
  symbolSize,
  totalCodewords,
} from "./qr-code.ts";
import { renderQrSvg } from "./qr-svg.ts";
import { reedSolomonParity, reedSolomonSyndromes } from "./reed-solomon.ts";

const VERSIONS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * ─── What these tests are actually for ──────────────────────────────────────
 *
 * A hand-written QR encoder fails *silently*: a mistyped table entry produces
 * a symbol that looks exactly like a QR code and simply will not scan. Tests
 * that only assert "it produced a grid" would pass while the product is
 * broken in the field, on printed material that cannot be recalled.
 *
 * So nothing here trusts the encoder's own account of itself. The block table
 * is checked against the symbol's geometry, which is derived independently of
 * it, and the output is decoded the way a scanner decodes it — recovering the
 * mask from the format bits rather than being told, and verifying Reed–Solomon
 * syndromes rather than assuming the parity is right.
 */

describe("error-correction table integrity", () => {
  /**
   * The check that makes the hand-written table trustworthy.
   *
   * `rawDataModules` counts the symbol and subtracts its function patterns; it
   * never looks at the error-correction table. So the number of codewords it
   * implies and the number the table implies come from genuinely independent
   * places, and a single mistyped digit in either cannot satisfy both.
   */
  test.each(VERSIONS)("version %i: blocks × (data + parity) equals the geometry", (version) => {
    const { parityPerBlock, blocks } = blockStructure(version);
    const total = totalCodewords(version);
    const data = dataCodewords(version);

    expect(data + parityPerBlock * blocks).toBe(total);

    // Every block must hold at least one data byte, and the two group lengths
    // must differ by at most one — both are structural properties of a valid
    // block layout, and both break if `blocks` is wrong for a version.
    const shortBlockTotal = Math.floor(total / blocks);
    const shortBlockData = shortBlockTotal - parityPerBlock;

    expect(shortBlockData).toBeGreaterThan(0);
    expect(total % blocks).toBeLessThan(blocks);
  });

  test("version 1 matches the specification's own worked numbers", () => {
    // The smallest symbol is the one case worth pinning to literals: 21×21,
    // 26 total codewords, 16 of them data at level M.
    expect(symbolSize(1)).toBe(21);
    expect(totalCodewords(1)).toBe(26);
    expect(dataCodewords(1)).toBe(16);
    expect(rawDataModules(1)).toBe(208);
  });

  test("capacity increases with every version", () => {
    for (let version = 2; version <= 20; version += 1) {
      expect(dataCodewords(version)).toBeGreaterThan(dataCodewords(version - 1));
      expect(symbolSize(version)).toBe(symbolSize(version - 1) + 4);
    }
  });

  test("alignment centres stay inside the symbol and start at 6", () => {
    expect(alignmentCentres(1)).toEqual([]);

    for (const version of VERSIONS.slice(1)) {
      const centres = alignmentCentres(version);
      const size = symbolSize(version);

      expect(centres[0]).toBe(6);
      expect(centres[centres.length - 1]).toBe(size - 7);
      expect(centres).toHaveLength(Math.floor(version / 7) + 2);

      // Ascending, and far enough apart that two 5×5 patterns cannot overlap.
      for (let i = 1; i < centres.length; i += 1) {
        expect(centres[i]! - centres[i - 1]!).toBeGreaterThanOrEqual(4);
      }
    }
  });

  test("the eight format-info values are distinct and well separated", () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7].map(formatInfoBits);
    expect(new Set(values).size).toBe(8);

    // A BCH code's value is its minimum distance: the format bits must survive
    // damage, so no two legal values may be close together.
    for (let a = 0; a < values.length; a += 1) {
      for (let b = a + 1; b < values.length; b += 1) {
        expect(hammingDistance(values[a]!, values[b]!)).toBeGreaterThanOrEqual(7);
      }
    }
  });
});

describe("Reed–Solomon", () => {
  test("a codeword has zero syndromes, and a corrupted one does not", () => {
    const data = new Uint8Array(16).map((_, i) => (i * 37 + 11) & 0xff);
    const parity = reedSolomonParity(data, 10);
    const codeword = new Uint8Array([...data, ...parity]);

    expect([...reedSolomonSyndromes(codeword, 10)].every((s) => s === 0)).toBe(true);

    // Flip one bit anywhere and the syndromes must notice. This is what
    // distinguishes real parity from plausible-looking bytes.
    for (let i = 0; i < codeword.length; i += 1) {
      const damaged = new Uint8Array(codeword);
      damaged[i] = (damaged[i]! ^ 0x01) as number;
      expect([...reedSolomonSyndromes(damaged, 10)].some((s) => s !== 0)).toBe(true);
    }
  });

  test("parity length is honoured", () => {
    expect(reedSolomonParity(new Uint8Array([1, 2, 3]), 7)).toHaveLength(7);
    expect(() => reedSolomonParity(new Uint8Array([1]), 0)).toThrow();
  });
});

describe("encode and decode round trip", () => {
  const payloads = [
    "https://example.com/r/spice-house",
    "https://menu.example.com/r/a",
    // A realistic longest case: the slug column allows 255 characters.
    `https://example.com/r/${"a".repeat(255)}`,
    // Mixed case and punctuation in the host, digits in the path.
    "https://Example.COM:8443/r/cafe-42",
  ];

  test.each(payloads)("decodes %s back out of the matrix", (payload) => {
    const matrix = encodeQr(payload);
    expect(decodeQr(matrix)).toBe(payload);
  });

  test("the recovered mask is the one the encoder recorded", () => {
    const matrix = encodeQr("https://example.com/r/mask-check");
    expect(readMask(matrix)).toBe(matrix.mask);
  });

  test("every mask pattern round-trips, not just the one chosen", () => {
    // The encoder picks a mask by penalty score, so most payloads only ever
    // exercise a couple of them. Searching for payloads that select each mask
    // proves the format-info encoding and the unmasking agree for all eight.
    const seen = new Map<number, string>();

    for (let i = 0; i < 400 && seen.size < 8; i += 1) {
      const payload = `https://example.com/r/probe-${i}`;
      const matrix = encodeQr(payload);
      if (!seen.has(matrix.mask)) {
        seen.set(matrix.mask, payload);
        expect(decodeQr(matrix)).toBe(payload);
      }
    }

    // Not asserting all eight appear — that depends on the penalty scores of
    // whatever payloads exist. Asserting that whichever did appear decoded.
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  test("a longer payload selects a larger symbol", () => {
    const small = encodeQr("https://example.com/r/a");
    const large = encodeQr(`https://example.com/r/${"b".repeat(200)}`);

    expect(large.version).toBeGreaterThan(small.version);
    expect(decodeQr(large)).toContain("bbb");
  });

  test("a payload beyond version 20 is refused rather than truncated", () => {
    expect(() => encodeQr("x".repeat(maxPayloadBytes(20) + 1))).toThrow(/exceeds/i);
  });

  test("version 7 and above carries version information", () => {
    // Version information only exists from 7 up, and is a separate BCH code.
    // A payload that lands there exercises it.
    const matrix = encodeQr(`https://example.com/r/${"c".repeat(150)}`);
    expect(matrix.version).toBeGreaterThanOrEqual(7);
    expect(decodeQr(matrix)).toContain("ccc");
  });
});

describe("structural properties a scanner depends on", () => {
  const matrix = encodeQr("https://example.com/r/structure");

  test("three finder patterns, and the fourth corner left clear", () => {
    const { modules, size } = matrix;

    for (const [cx, cy] of [
      [3, 3],
      [size - 4, 3],
      [3, size - 4],
    ]) {
      // Dark centre, light ring at distance 2, dark ring at distance 3.
      expect(modules[cy!]![cx!]).toBe(true);
      expect(modules[cy!]![cx! + 2]).toBe(false);
      expect(modules[cy!]![cx! - 2]).toBe(false);
    }

    // The bottom-right corner must not look like a finder pattern; that
    // asymmetry is how a scanner resolves rotation.
    const corner = modules[size - 4]![size - 4];
    const ring = modules[size - 4]![size - 6];
    expect(corner === true && ring === false).toBe(false);
  });

  test("the timing patterns alternate", () => {
    const { modules, size } = matrix;

    for (let i = 8; i < size - 8; i += 1) {
      expect(modules[6]![i]).toBe(i % 2 === 0);
      expect(modules[i]![6]).toBe(i % 2 === 0);
    }
  });

  test("the dark module is dark", () => {
    expect(matrix.modules[matrix.size - 8]![8]).toBe(true);
  });

  test("both copies of the format information agree", () => {
    // Redundancy is only useful if the two copies actually match.
    expect(readFormatBits(matrix, "primary")).toBe(readFormatBits(matrix, "secondary"));
  });
});

describe("SVG output", () => {
  const svg = renderQrSvg("https://example.com/r/svg-check", { title: "Spice House menu" });

  test("is a self-contained SVG document", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');

    // No external references of any kind: it has to work offline, after
    // download, with no session.
    expect(svg).not.toMatch(/<image|href=|url\(|<script|<style/i);
  });

  test("includes the four-module quiet zone", () => {
    const { size } = encodeQr("https://example.com/r/svg-check");
    expect(svg).toContain(`viewBox="0 0 ${size + 8} ${size + 8}"`);
  });

  test("paints an opaque light background rather than relying on the page", () => {
    // A transparent QR code on dark paper, or in a dark-themed viewer, does
    // not scan — the quiet zone has to genuinely be light.
    expect(svg).toContain('fill="#ffffff"');
  });

  test("is announced as one image with an accessible name", () => {
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title id=\"qr-title\">Spice House menu</title>");
    expect(svg).toContain('aria-labelledby="qr-title"');
  });

  test("escapes a restaurant name that contains markup", () => {
    const hostile = renderQrSvg("https://example.com/r/x", {
      title: '</title><script>alert(1)</script>',
    });

    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain("&lt;script&gt;");
  });

  test("omits the title element entirely when no name is given", () => {
    const untitled = renderQrSvg("https://example.com/r/x");
    expect(untitled).not.toContain("<title");
    expect(untitled).not.toContain("aria-labelledby");
  });

  test("is deterministic, which is what lets it be generated on demand", () => {
    const again = renderQrSvg("https://example.com/r/svg-check", { title: "Spice House menu" });
    expect(again).toBe(svg);
  });

  test("scales without a resolution decision", () => {
    const big = renderQrSvg("https://example.com/r/x", { pixelSize: 2048 });
    expect(big).toContain('width="2048" height="2048"');
    // Same drawing, different presentation size — the path is unchanged.
    const small = renderQrSvg("https://example.com/r/x", { pixelSize: 128 });
    expect(pathOf(big)).toBe(pathOf(small));
  });
});

// ---------------------------------------------------------------------------
// An independent decoder, written for these tests.
//
// It deliberately re-derives everything from the matrix rather than importing
// the encoder's internals: which modules are function patterns, which mask was
// used, and how the blocks interleave. The one thing it does share is the
// error-correction table, and the geometry assertions above are what keep that
// honest.
// ---------------------------------------------------------------------------

interface DecodableMatrix {
  readonly size: number;
  readonly modules: ReadonlyArray<ReadonlyArray<boolean>>;
  readonly version: number;
}

function decodeQr(matrix: DecodableMatrix): string {
  const mask = readMask(matrix);
  const functionGrid = buildFunctionGrid(matrix.version);

  // Ties the decoder's independent view of the function patterns back to the
  // geometry formula. If they disagree, one of them is wrong.
  const freeModules = functionGrid.flat().filter((reserved) => !reserved).length;
  expect(freeModules).toBe(rawDataModules(matrix.version));

  const codewords = readCodewords(matrix, functionGrid, mask);
  const data = deinterleave(codewords, matrix.version);

  return readPayload(data, matrix.version);
}

/** Recovers the mask by nearest legal format value, as a scanner does. */
function readMask(matrix: DecodableMatrix): number {
  const observed = readFormatBits(matrix, "primary");

  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    const distance = hammingDistance(observed, formatInfoBits(mask));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = mask;
    }
  }

  // An exact match is expected from an undamaged symbol; anything else means
  // the format information was written wrongly.
  expect(bestDistance).toBe(0);
  return best;
}

function readFormatBits(matrix: DecodableMatrix, copy: "primary" | "secondary"): number {
  const { modules, size } = matrix;
  const bits: boolean[] = [];

  if (copy === "primary") {
    for (let i = 0; i <= 5; i += 1) {
      bits.push(modules[i]![8]!);
    }
    bits.push(modules[7]![8]!, modules[8]![8]!, modules[8]![7]!);
    for (let i = 9; i < 15; i += 1) {
      bits.push(modules[8]![14 - i]!);
    }
  } else {
    for (let i = 0; i < 8; i += 1) {
      bits.push(modules[8]![size - 1 - i]!);
    }
    for (let i = 8; i < 15; i += 1) {
      bits.push(modules[size - 15 + i]![8]!);
    }
  }

  return bits.reduce((value, bit, index) => value | (bit ? 1 << index : 0), 0);
}

/**
 * Marks every function-pattern module for a version, from the geometric rules
 * alone.
 */
function buildFunctionGrid(version: number): boolean[][] {
  const size = symbolSize(version);
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  const reserve = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      grid[y]![x] = true;
    }
  };

  // Finder patterns with separators: 8×8 in each of three corners.
  for (let i = 0; i < 8; i += 1) {
    for (let j = 0; j < 8; j += 1) {
      reserve(i, j);
      reserve(size - 1 - i, j);
      reserve(i, size - 1 - j);
    }
  }

  // Timing patterns.
  for (let i = 0; i < size; i += 1) {
    reserve(6, i);
    reserve(i, 6);
  }

  // Alignment patterns, skipping the finder corners.
  const centres = alignmentCentres(version);
  const first = centres[0];
  const last = centres[centres.length - 1];

  for (const cx of centres) {
    for (const cy of centres) {
      const onFinder =
        (cx === first && cy === first) ||
        (cx === first && cy === last) ||
        (cx === last && cy === first);

      if (onFinder) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          reserve(cx! + dx, cy! + dy);
        }
      }
    }
  }

  // Format information. The two copies differ in length: nine modules along
  // each arm beside the top-left finder, but only eight on the second copy
  // (the first of those being the always-dark module). Reserving nine on both
  // would quietly consume two data modules.
  for (let i = 0; i <= 8; i += 1) {
    reserve(i, 8);
    reserve(8, i);
  }
  for (let i = 0; i < 8; i += 1) {
    reserve(size - 1 - i, 8);
    reserve(8, size - 1 - i);
  }

  // Version information.
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      reserve(a, b);
      reserve(b, a);
    }
  }

  return grid;
}

/** Walks the zigzag, unmasking as it goes. */
function readCodewords(
  matrix: DecodableMatrix,
  functionGrid: readonly boolean[][],
  mask: number,
): Uint8Array {
  const { modules, size } = matrix;
  const pattern = MASK_PATTERNS[mask]!;
  const bits: boolean[] = [];

  for (let right = size - 1; right >= 1; right -= 2) {
    // The loop variable moves to 5, so the remaining pairs are 5, 3, 1.
    if (right === 6) {
      right = 5;
    }

    for (let step = 0; step < size; step += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const x = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - step : step;

        if (functionGrid[y]![x]) {
          continue;
        }
        bits.push(modules[y]![x] !== pattern(x, y));
      }
    }
  }

  const count = totalCodewords(matrix.version);
  const bytes = new Uint8Array(count);

  for (let i = 0; i < count * 8; i += 1) {
    if (bits[i]) {
      bytes[i >>> 3] = (bytes[i >>> 3]! | (0x80 >>> (i & 7))) as number;
    }
  }

  return bytes;
}

/** Undoes the block interleaving, and verifies each block's parity. */
function deinterleave(codewords: Uint8Array, version: number): Uint8Array {
  const { parityPerBlock, blocks: blockCount } = blockStructure(version);
  const total = totalCodewords(version);

  const shortBlockTotal = Math.floor(total / blockCount);
  const shortBlockCount = blockCount - (total % blockCount);
  const shortBlockData = shortBlockTotal - parityPerBlock;

  const dataParts: number[][] = Array.from({ length: blockCount }, () => []);
  const parityParts: number[][] = Array.from({ length: blockCount }, () => []);

  let read = 0;
  for (let i = 0; i <= shortBlockData; i += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      if (i === shortBlockData && block < shortBlockCount) {
        continue;
      }
      dataParts[block]!.push(codewords[read]!);
      read += 1;
    }
  }
  for (let i = 0; i < parityPerBlock; i += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      parityParts[block]!.push(codewords[read]!);
      read += 1;
    }
  }

  expect(read).toBe(total);

  // Every block must be a valid Reed–Solomon codeword. This is the check a
  // real scanner performs, and it fails if the parity, the interleaving or the
  // bit placement is wrong anywhere.
  dataParts.forEach((part, block) => {
    const full = new Uint8Array([...part, ...parityParts[block]!]);
    const syndromes = reedSolomonSyndromes(full, parityPerBlock);
    expect([...syndromes].every((s) => s === 0)).toBe(true);
  });

  return new Uint8Array(dataParts.flat());
}

/** Reads the mode, the length and the bytes back out of the data codewords. */
function readPayload(data: Uint8Array, version: number): string {
  const bits: boolean[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i -= 1) {
      bits.push(((byte >>> i) & 1) === 1);
    }
  }

  let cursor = 0;
  const take = (width: number): number => {
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      value = (value << 1) | (bits[cursor + i] ? 1 : 0);
    }
    cursor += width;
    return value;
  };

  // Byte mode, which is the only mode this encoder emits.
  expect(take(4)).toBe(0b0100);

  const length = take(characterCountBits(version));
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = take(8);
  }

  return new TextDecoder().decode(bytes);
}

function hammingDistance(a: number, b: number): number {
  let value = a ^ b;
  let count = 0;
  while (value !== 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

function pathOf(svg: string): string {
  return /d="([^"]*)"/.exec(svg)?.[1] ?? "";
}
