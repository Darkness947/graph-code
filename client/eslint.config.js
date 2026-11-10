import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'dist/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // JSX component usage is not seen by core no-unused-vars (eslint-plugin-react is not used)
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]' }],
    },
  },
  prettier,
];
