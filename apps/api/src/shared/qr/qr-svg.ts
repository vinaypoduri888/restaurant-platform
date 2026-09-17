import { encodeQr } from "./qr-code.ts";

/**
 * Renders a QR payload as SVG.
 *
 * ─── Why SVG rather than PNG ────────────────────────────────────────────────
 *
 * The output is meant to be printed and stuck on a table, and a QR code is a
 * grid of squares — precisely the thing vector graphics represent exactly and
 * raster graphics only approximate. An SVG prints crisply at a beer-mat or a
 * poster with one file and no resolution decision, whereas a PNG has to pick a
 * pixel size up front and is either too small for print or needlessly large.
 *
 * It also costs nothing to produce: PNG would mean writing a PNG encoder
 * (deflate, CRCs, chunk framing) for a format that is worse for this purpose.
 * Browsers, image editors and print shops all accept SVG.
 *
 * The file is self-contained — no CSS, no fonts, no external references — so it
 * works after download with no network and no session.
 */

/** The four-module light border the specification requires. */
const QUIET_ZONE_MODULES = 4;

export interface QrSvgOptions {
  /**
   * Rendered width and height in pixels, for consumers that want a concrete
   * size. The drawing itself is resolution-independent regardless; this only
   * sets the default presentation size.
   */
  readonly pixelSize?: number;
  /** Accessible name for the image. */
  readonly title?: string;
}

/**
 * The QR code for `text`, as an SVG document.
 *
 * Deterministic: the same text always produces byte-identical output, which is
 * what allows the code to be generated on demand rather than stored.
 */
export function renderQrSvg(text: string, options: QrSvgOptions = {}): string {
  const { size, modules } = encodeQr(text);
  const pixelSize = options.pixelSize ?? 512;

  const extent = size + QUIET_ZONE_MODULES * 2;
  const path = modulePath(modules);

  // The title is the accessible name; `role="img"` plus `aria-labelledby` is
  // what makes a screen reader announce it as one image rather than as a
  // meaningless graphic. Escaped because a restaurant name reaches it.
  const title = options.title ? `<title id="qr-title">${escapeXml(options.title)}</title>` : "";
  const labelledBy = options.title ? ' aria-labelledby="qr-title"' : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"`,
    ` width="${pixelSize}" height="${pixelSize}" role="img"${labelledBy}`,
    // `crispEdges` stops a renderer from anti-aliasing module boundaries into
    // grey, which is what makes a small on-screen preview hard to scan.
    ' shape-rendering="crispEdges">',
    title,
    // An explicit white background, not transparency. A transparent QR code
    // printed on dark paper, or shown in a dark-themed viewer, is unscannable —
    // the quiet zone has to actually be light.
    `<rect width="${extent}" height="${extent}" fill="#ffffff"/>`,
    `<path fill="#000000" d="${path}"/>`,
    "</svg>",
  ].join("");
}

/**
 * One `<path>` for every dark module, rather than thousands of `<rect>`s.
 *
 * Each module becomes a four-command subpath. This keeps the document a few
 * kilobytes instead of tens, which matters because it is embedded in an HTML
 * response and served on every view of the QR page.
 */
function modulePath(modules: ReadonlyArray<ReadonlyArray<boolean>>): string {
  const parts: string[] = [];

  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        parts.push(`M${x + QUIET_ZONE_MODULES} ${y + QUIET_ZONE_MODULES}h1v1h-1z`);
      }
    });
  });

  return parts.join("");
}

/**
 * Escapes text for XML content.
 *
 * The only interpolated value is a restaurant name, which is owner-controlled
 * text. Without this, a name containing `<` would produce a malformed document
 * — and a name containing markup would produce an SVG carrying whatever the
 * owner wrote, which is the SVG-as-script problem the media pipeline refuses
 * SVG uploads over in the first place.
 */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
