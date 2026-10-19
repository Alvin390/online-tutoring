import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint flat config — Phase 13 / 01 D1.
 *
 * ESLint 9 dropped .eslintrc support and the repo had no config at all, so
 * `npm run lint` could not run (it failed before checking a single file). CI
 * now gates on it, so it needs one.
 *
 * Deliberately close to the Vite React template: eslint:recommended plus the
 * React Hooks rules. `no-unused-vars` ignores capitalised names because a
 * component used only in JSX is invisible to core ESLint without the full
 * React plugin; `motion` is exempt for the same reason (`<motion.div>`).
 */
export default [
  { ignores: ['dist/**', 'node_modules/**', 'archive-pre-react-version/**', 'issues/**', 'coverage/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^([A-Z_]|motion$|m$)', argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
