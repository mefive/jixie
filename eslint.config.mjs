// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'apps/api/prisma/migrations/**',
      'data/**',
      '**/*.db',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Force braces on every control statement — no single-line `if (x) return;` / `for (…) stmt;`.
      // eslint --fix adds the braces; prettier then puts the body on its own line.
      curly: ['error', 'all'],
    },
  },
  // 前端：浏览器 + node 全局（vite.config 用 node）；框架惯用 any（parentStore 等）与 {} setup 参数
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  // 框架 lib 是原样拷入的 vendored 代码，不纠它的 unused / 风格
  {
    files: ['apps/web/src/lib/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  // e2e Playwright 脚本：node 里跑，但 page.evaluate 回调是浏览器代码（document/location 等）
  {
    files: ['apps/web/e2e/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);
