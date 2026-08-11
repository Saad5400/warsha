import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The dev bearer is enabled outside production, so loadEnv() now requires a
    // (non-placeholder) DEV_SHARED_SECRET. Provide one for every test; individual
    // tests still override env.DEV_SHARED_SECRET after loadEnv() as before.
    env: {
      DEV_SHARED_SECRET: 'vitest-dev-secret',
    },
  },
})
