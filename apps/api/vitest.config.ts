import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  // Each test file in its own process — isolates module cache / env (matches fangtu/marginalia).
  test: { pool: 'forks', execArgv: ['--conditions=development'] },
});
