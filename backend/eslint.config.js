// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const mozaik = {
  group: ['@mozaik-ai/core', '@mozaik-ai/core/*'],
  message: 'Mozaik is imported only in src/runtime/mozaik/. Add a port method instead.',
};
const solana = {
  group: ['@solana/*'],
  message: 'Solana is imported only in src/payments/ and scripts/wallet*.',
};
const notInCore = {
  group: ['hono', 'hono/*', '@hono/*', 'node:*', 'fs', 'path', '@mozaik-ai/*'],
  message: 'src/core/ is pure: zod and other core files only (the frontend imports it).',
};
const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  { ignores: ['node_modules/', 'data/fixtures/', 'runs/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'No enums: a const object + derived union.' },
        { selector: 'ExportDefaultDeclaration', message: 'Named exports only.' },
      ],
      ...restrict(mozaik, solana),
    },
  },
  // Flat config replaces a rule's options rather than merging them, so each area lists its
  // full set of restricted imports.
  { files: ['src/runtime/mozaik/**'], rules: restrict(solana) },
  { files: ['src/payments/**', 'scripts/wallet*'], rules: restrict(mozaik) },
  { files: ['src/core/**'], rules: restrict(mozaik, solana, notInCore) },
  {
    files: ['*.config.{js,ts}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
);
