// src/** and vite.config.ts are skipped (tsc is the gate for them); the scripts,
// audit and tooling .mjs/.mts files are linted.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist/**',
    'node_modules/**',
    'shared-assets/**',
    // The app's TypeScript: `npm run typecheck` is its gate.
    'src/**',
    'vite.config.ts',
  ]),
  {
    // `.mts`/`.cts` are listed because flat config knows nothing about them by default;
    // a file with no matching block is silently unchecked.
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // `.mjs`/`.cjs`: the implicit base config enables no rules, so name them.
    files: ['**/*.{mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node, sourceType: 'module' },
    rules: {
      // `const { dropMe, ...rest } = obj` builds an object minus a key, on purpose.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // Playwright/CDP drivers: `page.evaluate` callbacks are browser code, so
    // `window`/`document` there are the page's. Both globals sets, for these only.
    files: ['audit/**/*.{mjs,mts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
])
