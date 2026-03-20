import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    ignores: ["src/lib/timezone-ecuador.ts"],
    rules: {
      // En este proyecto, toda fecha/hora de negocio debe pasar por timezone-ecuador.ts
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='toLocaleDateString']",
          message:
            "No uses toLocaleDateString() directo. Usa formatEcuadorDate() desde src/lib/timezone-ecuador.ts.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleTimeString']",
          message:
            "No uses toLocaleTimeString() directo. Usa formatEcuadorTime() desde src/lib/timezone-ecuador.ts.",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString']",
          message:
            "No uses toLocaleString() directo. Usa formatEcuadorDateTime() desde src/lib/timezone-ecuador.ts.",
        },
        {
          selector:
            "CallExpression[callee.property.name='slice'][callee.object.type='CallExpression'][callee.object.callee.property.name='toISOString']",
          message:
            "No uses toISOString().slice(...) para fechas de negocio. Usa toEcuadorDateInput() desde src/lib/timezone-ecuador.ts.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated artifacts from Tauri builds:
    "src-tauri/target/**",
  ]),
]);

export default eslintConfig;
