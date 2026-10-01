import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, formatComparisonNotice, validateSettings } from '../src/settings-model';

describe('settings model', () => {
  it('uses the Foundry repository and 6.0.x branch by default', () => {
    expect(DEFAULT_SETTINGS).toEqual({ owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', characterFolder: 'Characters' });
  });

  it('merges saved settings over defaults', () => {
    const saved = { branch: 'main' };
    expect(Object.assign({}, DEFAULT_SETTINGS, saved)).toEqual({ owner: 'foundryvtt', repo: 'dnd5e', branch: 'main', characterFolder: 'Characters' });
  });

  it('formats comparison counts for a notice', () => {
    const result = {
      unchanged: ['a'], locallyModified: ['b'], onlineChanged: ['c', 'd'],
      addedOnline: ['e'], removedOnline: [], notDownloaded: ['f'],
    };
    expect(formatComparisonNotice(result)).toBe('Comparison results: 1 unchanged, 1 locally modified, 2 online changed, 1 added online, 0 removed online, 1 not downloaded.');
  });

  it('rejects invalid persisted or edited settings', () => {
    expect(validateSettings({ owner: 'ok', repo: 'repo', branch: 'feature/test', characterFolder: 'Characters/PCs' }).characterFolder).toBe('Characters/PCs');
    expect(() => validateSettings({ owner: 'bad/owner', repo: 'repo', branch: 'main', characterFolder: 'Characters' })).toThrow();
    expect(() => validateSettings({ owner: 'ok', repo: 'repo', branch: 'bad..ref', characterFolder: 'Characters' })).toThrow();
    expect(() => validateSettings({ owner: 'ok', repo: 'repo', branch: 'main', characterFolder: '../outside' })).toThrow();
    expect(() => validateSettings({ owner: 'ok', repo: 'repo', branch: 'main', characterFolder: '/absolute' })).toThrow();
  });
});
