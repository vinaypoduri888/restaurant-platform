import { nextJsConfig } from "@repo/eslint-config/next-js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  {
    /*
     * `next.config.js` is evaluated by Node when the build starts, not shipped
     * to a browser, so `process` is legitimately in scope there. The shared
     * Next config assumes browser globals — correct for everything under
     * `app/` and `components/`, wrong for this one file.
     *
     * Scoped to the single filename rather than relaxed globally: `process`
     * really should be undefined in application code.
     */
    files: ["next.config.js"],
    languageOptions: {
      globals: { process: "readonly" },
    },
  },
];
