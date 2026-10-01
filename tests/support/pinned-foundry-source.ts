import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createSourceIndex, type SourceIndex, type SourceReaderAdapter } from '../../src/character-sources';

export const PINNED_FOUNDRY_ROOT = join(process.cwd(), 'external/foundryvtt/dnd5e');

export function createPinnedFoundryAdapter(requiredRoot = PINNED_FOUNDRY_ROOT): SourceReaderAdapter {
  const rootExists = async (): Promise<boolean> => {
    try {
      await fs.access(requiredRoot);
      return true;
    } catch {
      return false;
    }
  };

  return {
    async exists(path) {
      try {
        await fs.access(path);
        return true;
      } catch {
        return false;
      }
    },
    async list(path) {
      if (!(await rootExists())) throw new Error(`Pinned Foundry source is unavailable: ${requiredRoot}`);
      const entries = await fs.readdir(path, { recursive: true, withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name));
    },
    async read(path) {
      return fs.readFile(path, 'utf8');
    },
  };
}

export function createPinnedSourceIndex(): SourceIndex {
  return createSourceIndex(createPinnedFoundryAdapter(), PINNED_FOUNDRY_ROOT);
}
