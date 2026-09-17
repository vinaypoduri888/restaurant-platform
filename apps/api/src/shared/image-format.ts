/**
 * Identifies an image from its actual bytes and reads its dimensions.
 *
 * ─── Why this exists rather than trusting the request ───────────────────────
 *
 * A multipart upload carries a filename and a `Content-Type`, and a client
 * chooses both. `evil.php` renamed to `logo.png`, or a PHP script announced as
 * `image/png`, would both pass any check based on what the client claimed. The
 * only trustworthy statement about a file is what its first bytes say.
 *
 * ─── Why no image-processing dependency ────────────────────────────────────
 *
 * `sharp` would do this, but it is a native binary dependency, and the project
 * policy is to add one only when genuinely required. Reading a header is a
 * fixed, well-documented byte layout per format — around a hundred lines, no
 * decoding, and it never allocates based on attacker-controlled numbers. It is
 * also strictly safer: a full decoder is a much larger attack surface than a
 * header reader, and image decoders have a long history of memory bugs.
 *
 * Consequence, stated honestly: nothing here re-encodes, resizes, or strips
 * EXIF. Those need a real decoder and are deferred (see the phase report).
 */

export type ImageFormat = "png" | "jpeg" | "webp";

export interface ImageInfo {
  format: ImageFormat;
  /** Canonical MIME type for the detected format — not the client's claim. */
  mimeType: string;
  /** File extension used to build the storage key. */
  extension: string;
  width: number;
  height: number;
}

const MIME_TYPES: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * SVG is deliberately **not** supported.
 *
 * It is XML, not a raster image: it can carry `<script>`, external references,
 * and entity expansion. Serving an owner-uploaded SVG from the platform's own
 * domain would be stored XSS against every customer who scanned that
 * restaurant's code — the exact attack `FRONTEND_SPEC.md` §6 forbids. Rendering
 * it safely needs sanitisation, or serving from a separate origin; neither is
 * in scope, so the format is refused.
 */
export const SUPPORTED_FORMATS: readonly ImageFormat[] = ["png", "jpeg", "webp"];

/**
 * Reads the format and dimensions, or returns `null` for anything unrecognised.
 *
 * `null` covers both "not an image we support" and "a truncated or corrupt
 * header", which the caller treats identically: the upload is refused. It never
 * throws, so a malformed file cannot turn into a 500.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readJpeg(bytes) ?? readWebp(bytes);
}

function info(format: ImageFormat, width: number, height: number): ImageInfo | null {
  // A zero dimension means the header was misread; refuse rather than store a
  // value the frontend would use to reserve layout space.
  if (width <= 0 || height <= 0) return null;

  return {
    format,
    mimeType: MIME_TYPES[format],
    extension: format === "jpeg" ? "jpg" : format,
    width,
    height,
  };
}

/**
 * PNG: an 8-byte signature, then an IHDR chunk whose first two 32-bit
 * big-endian fields are width and height.
 */
function readPng(bytes: Uint8Array): ImageInfo | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  if (!SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;

  // IHDR must be the first chunk, so the dimensions are always at 16 and 20.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return info("png", view.getUint32(16, false), view.getUint32(20, false));
}

/**
 * JPEG: a stream of marker segments. Dimensions live in whichever "start of
 * frame" (SOF) marker appears, which is not at a fixed offset — so the segments
 * have to be walked.
 */
function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null; // Out of sync: not a JPEG stream.

    const marker = bytes[offset + 1]!;

    // Padding and standalone markers carry no length field.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    const length = view.getUint16(offset + 2, false);
    if (length < 2) return null;

    // SOF0/1/2/3/5/6/7/9/10/11/13/14/15 — every frame type except DHT (0xc4),
    // JPG (0xc8) and DAC (0xcc), which share the 0xc_ range but are not frames.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      // Segment layout: length(2) precision(1) height(2) width(2).
      if (offset + 9 > bytes.length) return null;
      return info("jpeg", view.getUint16(offset + 7, false), view.getUint16(offset + 5, false));
    }

    offset += 2 + length;
  }

  return null;
}

/**
 * WebP: a RIFF container. Three sub-formats store dimensions differently, and
 * all three are in real use, so all three are handled.
 */
function readWebp(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 30) return null;
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WEBP") return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = readAscii(bytes, 12, 4);

  // Lossy: a VP8 bitstream. Dimensions are 14 bits each, after a 3-byte
  // start code, and the top 2 bits of each 16-bit value are a scaling hint.
  if (chunk === "VP8 ") {
    return info("webp", view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }

  // Lossless: 14-bit dimensions packed across bytes, each stored minus one.
  if (chunk === "VP8L") {
    const bits = view.getUint32(21, true);
    return info("webp", (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }

  // Extended (animation, alpha): 24-bit dimensions, each stored minus one.
  if (chunk === "VP8X") {
    if (bytes.length < 30) return null;
    const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
    const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
    return info("webp", width, height);
  }

  return null;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}
