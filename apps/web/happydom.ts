/**
 * Registers a DOM implementation globally so React Testing Library can render.
 *
 * Preloaded via `bunfig.toml` so it runs before any test module is imported —
 * React reads `document` at module scope, so registering inside a test file
 * would already be too late.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({
  /*
   * A real document URL, not the default.
   *
   * `next/image` has a development-only block that does `new URL(src)` and, on
   * failure, retries as `new URL(src, window.location.href)`. Without a valid
   * base URL that fallback throws too — and the throw is not caught, so every
   * render of an `<Image>` fails with a bare "Invalid URL" that says nothing
   * about the cause. Diagnosed by reading `get-img-props.js` rather than
   * guessing at image configuration.
   *
   * Setting the origin the app actually runs on fixes it and lets the real
   * component render, which is worth more than mocking `next/image` away.
   */
  url: "http://localhost:3000",
});
