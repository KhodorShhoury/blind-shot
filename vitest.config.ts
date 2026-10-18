import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared/src') } },
  test: { include: ['shared/tests/**/*.test.ts', 'server/tests/**/*.test.ts'], testTimeout: 20000 },
});
