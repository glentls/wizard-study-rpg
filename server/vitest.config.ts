import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { execArgv: ['--disable-warning=ExperimentalWarning'] },
    },
  },
});
