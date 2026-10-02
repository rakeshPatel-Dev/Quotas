import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts: that file sets `root` to the renderer, which
// would make vitest look for tests inside src/renderer instead of test/.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
