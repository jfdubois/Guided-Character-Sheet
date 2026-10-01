import { describe, expect, it } from 'vitest';
import { fetchSourceSnapshot, fetchSourceTree, rawSourceUrl } from '../src/source-tree';

describe('GitHub source tree client', () => {
  it('reads the tree commit and Foundry system version as a snapshot', async () => {
    const request = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', prefix: 'packs/_source/' };
    const snapshot = await fetchSourceSnapshot(request, async (url) => url.includes('/git/trees/') ? { truncated: false, sha: 'a'.repeat(40), tree: [] } : {}, async () => JSON.stringify({ version: '6.0.0' }));
    expect(snapshot).toEqual({ owner: request.owner, repo: request.repo, branch: request.branch, commit: 'a'.repeat(40), systemVersion: '6.0.0' });
  });

  it.each([
    { tree: { truncated: false, sha: 'bad', tree: [] }, system: '{"version":"6.0.0"}' },
    { tree: { truncated: false, sha: 'a'.repeat(40), tree: [] }, system: '{"version":""}' },
  ])('rejects incomplete source snapshots', async ({ tree, system }) => {
    await expect(fetchSourceSnapshot({ owner: 'o', repo: 'r', branch: 'main', prefix: 'packs/_source/' }, async () => tree, async () => system)).rejects.toThrow();
  });
  it('returns only source blobs and preserves nested paths', async () => {
    const result = await fetchSourceTree(
      { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', prefix: 'packs/_source/' },
      async () => ({ truncated: false, tree: [
        { path: 'packs/_source/classes/fighter.yml', mode: '100644', type: 'blob', sha: 'a'.repeat(40) },
        { path: 'packs/_source/classes', mode: '040000', type: 'tree', sha: 'b' },
        { path: 'README.md', mode: '100644', type: 'blob', sha: 'c'.repeat(40) },
     ] }),
    );
    expect(result).toEqual([{ path: 'packs/_source/classes/fighter.yml', sha: 'a'.repeat(40) }]);
  });

  it('sorts source blobs by path', async () => {
    const result = await fetchSourceTree(
      { owner: 'o', repo: 'r', branch: 'main', prefix: 'packs/_source/' },
      async () => ({ truncated: false, tree: [
        { path: 'packs/_source/z.yml', type: 'blob', sha: 'b'.repeat(40) },
        { path: 'packs/_source/a.yml', type: 'blob', sha: 'a'.repeat(40) },
      ] }),
    );
    expect(result.map((entry) => entry.path)).toEqual(['packs/_source/a.yml', 'packs/_source/z.yml']);
  });

  it.each([
    { response: { truncated: true, tree: [] }, label: 'truncated responses' },
    { response: { truncated: false, tree: [{ path: 'packs/_source/a', type: 'blob' }] }, label: 'malformed entries' },
    { response: { truncated: false, tree: [{ path: 'packs/_source/../secret', type: 'blob', sha: 'a' }] }, label: 'unsafe paths' },
  ])('rejects $label', async ({ response }) => {
    await expect(fetchSourceTree(
      { owner: 'o', repo: 'r', branch: 'main', prefix: 'packs/_source/' },
      async () => response,
    )).rejects.toThrow();
  });

  it('constructs the encoded GitHub tree URL', async () => {
    let url = '';
    await fetchSourceTree(
      { owner: 'foundryvtt', repo: 'dnd5e', branch: 'feature/test' , prefix: 'packs/_source/' },
      async (requestUrl) => { url = requestUrl; return { truncated: false, tree: [] }; },
    );
    expect(url).toBe('https://api.github.com/repos/foundryvtt/dnd5e/git/trees/feature%2Ftest?recursive=1');
  });

  it('builds the raw URL for a validated entry', () => {
    expect(rawSourceUrl(
      { owner: 'foundryvtt', repo: 'dnd5e', branch: 'feature/test', prefix: 'packs/_source/' },
      { path: 'packs/_source/classes/fighter.yml', sha: 'a' },
    )).toBe('https://raw.githubusercontent.com/foundryvtt/dnd5e/feature%2Ftest/packs/_source/classes/fighter.yml');
  });

  it('rejects a raw entry with a non-string SHA', () => {
    expect(() => rawSourceUrl(
      { owner: 'o', repo: 'r', branch: 'main', prefix: 'packs/_source/' },
      { path: 'packs/_source/a.yml', sha: null as unknown as string },
    )).toThrow('Invalid source tree entry');
  });

  it('rejects a blob with a malformed SHA', async () => {
    await expect(fetchSourceTree(
      { owner: 'o', repo: 'r', branch: 'main', prefix: 'packs/_source/' },
      async () => ({ truncated: false, tree: [{ path: 'packs/_source/a.yml', type: 'blob', sha: 'not-a-git-sha' }] }),
    )).rejects.toThrow('Invalid GitHub tree entry');
  });

  it('rejects unsafe components and non-canonical prefixes', async () => {
    await expect(fetchSourceTree({ owner: 'o/evil', repo: 'r', branch: 'main', prefix: 'packs/_source/' }, async () => ({ truncated: false, tree: [] }))).rejects.toThrow();
    await expect(fetchSourceTree({ owner: 'o', repo: 'r', branch: 'main', prefix: 'other/' }, async () => ({ truncated: false, tree: [] }))).rejects.toThrow();
    expect(() => rawSourceUrl({ owner: 'o', repo: 'r', branch: 'bad..ref', prefix: 'packs/_source/' }, { path: 'packs/_source/a b.yml', sha: 'a' })).toThrow();
  });

  it('encodes each raw source path segment', () => {
    expect(rawSourceUrl({ owner: 'o', repo: 'r', branch: 'feature/test', prefix: 'packs/_source/' }, { path: 'packs/_source/a b.yml', sha: 'a' })).toContain('/packs/_source/a%20b.yml');
  });
});
