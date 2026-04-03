import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        maxForks: 1,
      },
    },
    isolate: false,
  },
  server: {
    watch: {
      ignored: ['**/.venv/**', '**/node_modules/**', '**/dist/**'],
    },
  },
});
