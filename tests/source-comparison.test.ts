import { describe, expect, it } from 'vitest';
import { compareSources, type SourceManifestEntry } from '../src/source-comparison';

describe('source comparison', () => {
  it('separates remote changes from local edits', () => {
    const result = compareSources(
      new Map([['packs/_source/a.yml', 'remote-new'], ['packs/_source/b.yml', 'remote-b'], ['packs/_source/c.yml', 'remote-c']]),
      new Map<string, SourceManifestEntry>([
        ['packs/_source/a.yml', { remoteSha: 'remote-old', localSha256: 'hash-a' }],
        ['packs/_source/b.yml', { remoteSha: 'remote-b', localSha256: 'hash-b' }],
        ['packs/_source/c.yml', { remoteSha: 'remote-c', localSha256: 'hash-c' }],
      ]),
      new Map([['packs/_source/a.yml', 'hash-a'], ['packs/_source/b.yml', 'hash-b-edit']]),
    );
    expect(result.onlineChanged).toEqual(['packs/_source/a.yml']);
    expect(result.locallyModified).toEqual(['packs/_source/b.yml']);
    expect(result.notDownloaded).toEqual(['packs/_source/c.yml']);
  });

  it('classifies unchanged, online additions, and manifest removals in sorted order', () => {
    const result = compareSources(
      new Map([['z.yml', 'z'], ['a.yml', 'a'], ['new.yml', 'new']]),
      new Map<string, SourceManifestEntry>([
        ['z.yml', { remoteSha: 'z', localSha256: 'z-local' }],
        ['a.yml', { remoteSha: 'a', localSha256: 'a-local' }],
        ['gone.yml', { remoteSha: 'gone', localSha256: 'gone-local' }],
      ]),
      new Map([['z.yml', 'z-local'], ['a.yml', 'a-local']]),
    );
    expect(result.unchanged).toEqual(['a.yml', 'z.yml']);
    expect(result.addedOnline).toEqual(['new.yml']);
    expect(result.removedOnline).toEqual(['gone.yml']);
  });
});
