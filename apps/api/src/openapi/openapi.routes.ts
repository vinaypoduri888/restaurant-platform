import { Hono } from "hono";
import type { AppEnv } from "../shared/app-env.ts";
import { buildOpenApiDocument } from "./openapi.document.ts";

// Built once at startup; the schemas it derives from are static.
const document = buildOpenApiDocument();

const DOCS_PAGE = `<!doctype html>
<html>
  <head>
    <title>Restaurant Platform API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

export const docsRoutes = new Hono<AppEnv>()
  .get("/openapi.json", (c) => c.json(document))
  .get("/docs", (c) => c.html(DOCS_PAGE));
