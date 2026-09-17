import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      /**
       * Allow deliberately unused parameters when they are named with a
       * leading underscore.
       *
       * Server Actions used with `useActionState` are called as
       * `(previousState, formData)`. An action that ignores both — a delete, a
       * toggle, a reorder whose arguments are all bound — must still declare
       * them to sit in the right positions. Renaming them is not an option;
       * marking them as intentionally unused is exactly what the underscore
       * convention is for.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
