// @ts-check
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  {
    languageOptions: {
      globals: globals.browser,
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
      'no-restricted-imports': [
        'error',
        {
          // The bare package is a `paths` entry: as a gitignore-style pattern it would exclude
          // the whole folder, and the `!contracts` re-include could never apply.
          paths: [
            {
              name: '@prickle/backend',
              message: 'Only the contracts are shared: import from @prickle/backend/contracts.',
            },
          ],
          patterns: [
            {
              group: ['@prickle/backend/*', '!@prickle/backend/contracts'],
              message: 'Only the contracts are shared: import from @prickle/backend/contracts.',
            },
          ],
        },
      ],
    },
  },
  { files: ['*.config.{js,ts}'], rules: { 'no-restricted-syntax': 'off' } },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
);
