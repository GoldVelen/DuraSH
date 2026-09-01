import { availableParallelism } from 'node:os'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/** Owner-local assembled expected-output tests that do not use a recorded session as their input. */
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-invariants.ts'],
    include: [
      'apps/cli/tests/**/*.expected.e2e.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    // Downstream CI lowers this through Vitest's native VITEST_MAX_WORKERS override.
    maxWorkers: Math.min(5, availableParallelism()),
  },
})
