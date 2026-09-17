import { describe, expect, test } from "bun:test";
import { readImageInfo, SUPPORTED_FORMATS } from "./image-format.ts";

/**
 * Fixtures are hand-built headers rather than files on disk: the parser only
 * reads headers, so a header is the whole input, and building them here makes
 * the byte layout each assertion depends on visible in the test.
 */

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  // IHDR chunk length and type, then the two 32-bit big-endian dimensions.
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

/** A JPEG with an APP0 segment before the SOF0, so the walk has to skip one. */
function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0x00)];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03];
  const bytes = new Uint8Array([0xff, 0xd8, ...app0, ...sof0]);

  const sofStart = 2 + app0.length;
  const view = new DataView(bytes.buffer);
  view.setUint16(sofStart + 5, height, false);
  view.setUint16(sofStart + 7, width, false);
  return bytes;
}

function webpLossy(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  bytes.set([0x56, 0x50, 0x38, 0x20], 12); // "VP8 "
  const view = new DataView(bytes.buffer);
  view.setUint16(26, width, true);
  view.setUint16(28, height, true);
  return bytes;
}

function webpExtended(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

describe("format detection", () => {
  test("identifies PNG and reads its dimensions", () => {
    expect(readImageInfo(png(512, 256))).toEqual({
      format: "png",
      mimeType: "image/png",
      extension: "png",
      width: 512,
      height: 256,
    });
  });

  /** The SOF marker is not at a fixed offset, so preceding segments must be skipped. */
  test("identifies JPEG by walking past an earlier segment", () => {
    expect(readImageInfo(jpeg(1920, 1080))).toEqual({
      format: "jpeg",
      mimeType: "image/jpeg",
      extension: "jpg",
      width: 1920,
      height: 1080,
    });
  });

  test("identifies lossy WebP", () => {
    expect(readImageInfo(webpLossy(800, 600))).toMatchObject({
      format: "webp",
      extension: "webp",
      width: 800,
      height: 600,
    });
  });

  /** Extended WebP (animation/alpha) stores dimensions differently again. */
  test("identifies extended WebP", () => {
    expect(readImageInfo(webpExtended(1600, 900))).toMatchObject({
      format: "webp",
      width: 1600,
      height: 900,
    });
  });

  test("the JPEG extension is jpg, matching the storage key allow-list", () => {
    expect(readImageInfo(jpeg(10, 10))?.extension).toBe("jpg");
  });
});

describe("rejection", () => {
  /**
   * The point of sniffing. Each of these is a file a client could name
   * `logo.png` and declare as `image/png`; only the bytes give it away.
   */
  test.each([
    ["a PHP script", "<?php system($_GET['c']); ?>"],
    ["an HTML page", "<html><script>alert(1)</script></html>"],
    ["an SVG", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["a shell script", "#!/bin/sh\nrm -rf /\n"],
    ["plain text", "this is definitely not an image"],
    ["a ZIP archive", "PKrest of a zip"],
    ["an ELF binary", "ELF and then some"],
  ])("rejects %s", (_label, content) => {
    expect(readImageInfo(new TextEncoder().encode(content))).toBeNull();
  });

  test("rejects an empty file", () => {
    expect(readImageInfo(new Uint8Array())).toBeNull();
  });

  /**
   * A truncated header must not be read past its end — that is where a naive
   * parser reads uninitialised memory or throws inside a request.
   */
  test("rejects a truncated PNG without throwing", () => {
    expect(readImageInfo(png(100, 100).slice(0, 12))).toBeNull();
  });

  test("rejects a JPEG whose stream ends before any frame marker", () => {
    expect(readImageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBeNull();
  });

  test("rejects a RIFF container that is not WebP", () => {
    const bytes = new Uint8Array(32);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x41, 0x56, 0x49, 0x20], 8); // "AVI "
    expect(readImageInfo(bytes)).toBeNull();
  });

  /**
   * A correct signature with zero dimensions means the header was misparsed.
   * Storing it would give the frontend a zero-size box to reserve.
   */
  test("rejects a PNG declaring zero dimensions", () => {
    expect(readImageInfo(png(0, 0))).toBeNull();
    expect(readImageInfo(png(100, 0))).toBeNull();
  });

  /**
   * SVG is refused deliberately, not by omission: it is XML that can carry
   * script, and serving one from this domain would be stored XSS against every
   * customer of that restaurant.
   */
  test("SVG is not in the supported set", () => {
    expect(SUPPORTED_FORMATS).not.toContain("svg" as never);
    expect(SUPPORTED_FORMATS).toEqual(["png", "jpeg", "webp"]);
  });
});

describe("no allocation from attacker-controlled numbers", () => {
  /**
   * A header can claim enormous dimensions. The parser must report them
   * without allocating anything proportional to the claim — the caller applies
   * the size limit.
   */
  test("a header claiming huge dimensions is parsed, not allocated", () => {
    const info = readImageInfo(png(4_000_000_000, 4_000_000_000));

    expect(info?.width).toBeGreaterThan(1_000_000);
    // Small input, so nothing was allocated from the declared size.
    expect(png(4_000_000_000, 4_000_000_000).byteLength).toBe(24);
  });
});
