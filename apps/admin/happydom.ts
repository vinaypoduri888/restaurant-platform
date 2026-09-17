/**
 * Registers a DOM implementation globally so React Testing Library can render.
 *
 * Preloaded via `bunfig.toml` so it runs before any test module is imported —
 * React reads `document` at module scope, so registering inside a test file
 * would already be too late.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
