import { describe, expect, it } from 'vitest';
import { resolvePluginDirectory } from '../src/plugin-path';

describe('plugin path', () => {
  it('uses the canonical config directory even when manifest.dir is present', () => {
    expect(resolvePluginDirectory(
      { id: 'guided-character-sheet', dir: '/workspace/test-vault/.obsidian/plugins/guided-character-sheet' },
      '/workspace/test-vault/.obsidian',
    )).toBe('/workspace/test-vault/.obsidian/plugins/guided-character-sheet');
  });

  it('falls back to the config directory when manifest.dir is absent', () => {
    expect(resolvePluginDirectory(
      { id: 'guided-character-sheet' },
      'config',
    )).toBe('config/plugins/guided-character-sheet');
  });

  it('joins a normalized config directory to the plugin path', () => {
    expect(resolvePluginDirectory({ id: 'guided-character-sheet' }, '.obsidian')).toBe('.obsidian/plugins/guided-character-sheet');
  });
});
