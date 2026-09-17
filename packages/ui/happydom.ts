/**
 * Registers a DOM implementation globally so React Testing Library can render.
 *
 * Preloaded via `bunfig.toml` so it runs before any test file is imported —
 * React reads `document` at module scope, so registering inside a test would
 * already be too late.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
