import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'coverage/', 'grammars/'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
  prettier,
];
