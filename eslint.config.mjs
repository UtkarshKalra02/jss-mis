import { dirname } from "path";
import { fileURLToPath } from "url";

import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 15 ships eslintrc-style configs, not flat-config arrays,
// so they have to be bridged with FlatCompat. (create-next-app emitted the
// Next 16 form, which does not resolve against 15.)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Generated SQL and drizzle metadata — reviewed as SQL, not linted as JS.
      "drizzle/**",
    ],
  },
];

export default eslintConfig;
