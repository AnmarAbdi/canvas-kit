import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Every package resolves its siblings from source — no build step before tests. */
const alias = {
  '@yearbook2026/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
  '@yearbook2026/client': fileURLToPath(new URL('./packages/client/src/index.ts', import.meta.url)),
  '@yearbook2026/converter': fileURLToPath(new URL('./packages/converter/src/index.ts', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: { include: ['packages/*/test/**/*.test.ts', 'examples/**/*.test.ts'], environment: 'node' },
});
