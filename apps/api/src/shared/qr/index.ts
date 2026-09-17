/**
 * QR code generation.
 *
 * Domain code depends on this module, never on the encoder internals — the
 * same shape as `shared/storage`. `renderQrSvg` is the whole surface.
 */
export { renderQrSvg, type QrSvgOptions } from "./qr-svg.ts";
export { encodeQr, type QrMatrix } from "./qr-code.ts";
