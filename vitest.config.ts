import { fileURLToPath, URL } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/obsidian-mock.ts', import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, '**/.worktrees/**', 'tests/pinned-2024-character-creation-audit.test.ts', 'tests/pinned-2024-source-mapping-audit.test.ts'],
  },
});
