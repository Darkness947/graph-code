import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    // Integration tests make several round trips to the remote Neon test branch; a latency
    // spike or a compute wake-up can push a short test past the 5 s default.
    testTimeout: 30_000,
  },
});
