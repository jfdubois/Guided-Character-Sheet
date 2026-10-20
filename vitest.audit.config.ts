import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/obsidian-mock.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/pinned-2024-character-creation-audit.test.ts'],
    testTimeout: 120_000,
  },
});
