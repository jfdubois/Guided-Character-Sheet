import { describe, expect, it } from 'vitest';
import { SourceStore, createFileSystemAdapter, type SourceStoreAdapter } from '../src/source-store';
import type { SourceTreeRequest } from '../src/source-tree';

const request: SourceTreeRequest = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', prefix: 'packs/_source/' };
const snapshot = { owner: request.owner, repo: request.repo, branch: request.branch, commit: 'c'.repeat(40), systemVersion: '6.0.0' };
const validMetadata = { ...request, fetchedAt: '2026-09-02T12:00:00.000Z', snapshot };

function memoryAdapter(): SourceStoreAdapter & { files: Map<string, string | ArrayBuffer>; writes: string[] } {
  const files = new Map<string, string | ArrayBuffer>();
  const writes: string[] = [];
  return {
    files, writes,
    async mkdir() {},
    async exists(path) { return files.has(path); },
    async read(path) { return files.get(path) as string; },
    async readBinary(path) { return files.get(path) as ArrayBuffer; },
    async write(path, data) { writes.push(path); files.set(path, data); },
    async writeBinary(path, data) { writes.push(path); files.set(path, data); },
    async list(path) { return [...files.keys()].filter((file) => file.startsWith(`${path}/`)); },
    async remove(path) { files.delete(path); },
    async rmdir() {},
  };
}

describe('source store', () => {
  it('accepts an absolute plugin base without duplicating the vault base path', async () => {
    const base = '/workspace/test-vault';
    const calls: string[] = [];
    const filesystem = {
      getBasePath: () => base,
      exists: async (path: string) => { calls.push(path); return false; },
    } as never;

    await expect(createFileSystemAdapter(filesystem).exists(`${base}/.obsidian/plugins/guided-character-sheet/sources`)).resolves.toBe(false);
    expect(calls).toEqual(['.obsidian/plugins/guided-character-sheet/sources']);
  });

  it('downloads to the vault once when the plugin base is already prefixed', async () => {
    const base = '/workspace/test-vault';
    const calls: string[] = [];
    const filesystem = {
      getBasePath: () => base,
      mkdir: async (path: string) => calls.push(`mkdir:${path}`),
      exists: async (path: string) => { calls.push(`exists:${path}`); return false; },
      write: async (path: string) => calls.push(`write:${path}`),
      writeBinary: async (path: string) => calls.push(`writeBinary:${path}`),
      list: async () => [],
      remove: async (path: string) => calls.push(`remove:${path}`),
      rmdir: async (path: string) => calls.push(`rmdir:${path}`),
    } as never;
    const adapter = createFileSystemAdapter(filesystem);
    const pluginBase = `${base}${base}/.obsidian/plugins/guided-character-sheet`;
    await new SourceStore(adapter, pluginBase).download(
      request,
      [{ path: 'packs/_source/test.yml', sha: 'a'.repeat(40) }],
      snapshot,
      async () => new Uint8Array([1]).buffer,
    );
    expect(calls.some((path) => path.includes(`${base}/${base}`))).toBe(false);
    expect(calls).toContain('writeBinary:.obsidian/plugins/guided-character-sheet/sources/packs/_source/test.yml');
    expect(calls.some((path) => path.startsWith('rmdir:.obsidian/plugins/guided-character-sheet/.stage-'))).toBe(true);
  });

  it('normalizes absolute and relative filesystem listings to vault-relative paths', async () => {
    const base = '/workspace/test-vault';
    const listings = new Map<string, { files: string[]; folders: string[] }>([
      ['sources', {
        files: [`${base}/sources/root.yml`],
        folders: ['sources/packs'],
      }],
      ['sources/packs', {
        files: ['_source/absolute.yml'],
        folders: [`${base}/sources/packs/nested`],
      }],
      ['sources/packs/nested', {
        files: [`${base}/sources/packs/nested/relative.yml`],
        folders: [],
      }],
    ]);
    const filesystem = {
      getBasePath: () => base,
      list: async (path: string) => listings.get(path) ?? { files: [], folders: [] },
    } as never;

    await expect(createFileSystemAdapter(filesystem).list('sources')).resolves.toEqual([
      'sources/root.yml',
      'sources/packs/_source/absolute.yml',
      'sources/packs/nested/relative.yml',
    ]);
  });

  it('downloads with bounded parallelism and reports each completed file', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    const entries = Array.from({ length: 5 }, (_, index) => ({ path: `packs/_source/${index}.yml`, sha: String(index) }));
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    await store.download(request, entries, snapshot, async (entry) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, entry.sha === '0' ? 10 : 1));
      active -= 1;
      return new Uint8Array([Number(entry.sha)]).buffer;
    }, { workerLimit: 2, onProgress: (count) => completed.push(count) });
    expect(maximumActive).toBe(2);
    expect(completed).toEqual([1, 2, 3, 4, 5]);
  });

  it('creates nested directories, writes exact bytes, and publishes hashed manifest', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    const bytes = new Uint8Array([1, 2, 255]).buffer;
    const manifest = await store.download(request, [{ path: 'packs/_source/classes/fighter.yml', sha: 'a'.repeat(40) }], snapshot, async () => bytes);
    expect(adapter.files.get('plugins/guided-character-sheet/sources/packs/_source/classes/fighter.yml')).toBe(bytes);
    expect(manifest).toMatchObject({ owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', prefix: 'packs/_source/' });
    expect(manifest.snapshot).toEqual(snapshot);
    expect(manifest.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(adapter.files.get('plugins/guided-character-sheet/source-sync-manifest.json') as string)).toMatchObject({ owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', prefix: 'packs/_source/', snapshot });
    expect(manifest.files['packs/_source/classes/fighter.yml']).toEqual({ remoteSha: 'a'.repeat(40), localSha256: '0526d0e18ea19dfaad9d79166bec1e18d6221ef6b1830385fe9bf67022ed5f96' });
  });

  it('publishes a manifest only after every file has downloaded', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    await expect(store.download(request,
      [{ path: 'packs/_source/a.yml', sha: 'a' }, { path: 'packs/_source/b.yml', sha: 'b' }],
      snapshot,
      async (entry) => entry.sha === 'b' ? Promise.reject(new Error('offline')) : new Uint8Array([1, 2]).buffer,
    )).rejects.toThrow('offline');
    expect(await adapter.exists('plugins/guided-character-sheet/source-sync-manifest.json')).toBe(false);
  });

  it('preserves existing files and manifest when a later download fails', async () => {
    const adapter = memoryAdapter();
    const base = 'plugins/guided-character-sheet';
    const oldBytes = new Uint8Array([9]).buffer;
    adapter.files.set(`${base}/sources/packs/_source/a.yml`, oldBytes);
    adapter.files.set(`${base}/source-sync-manifest.json`, JSON.stringify({ files: {
      'packs/_source/a.yml': { remoteSha: 'a'.repeat(40), localSha256: 'b'.repeat(64) },
    }}));
    const oldManifest = adapter.files.get(`${base}/source-sync-manifest.json`);
    await expect(new SourceStore(adapter, base).download(request, [
      { path: 'packs/_source/a.yml', sha: 'c'.repeat(40) },
      { path: 'packs/_source/b.yml', sha: 'd'.repeat(40) },
    ], snapshot, async (entry) => entry.path.endsWith('b.yml') ? Promise.reject(new Error('offline')) : new Uint8Array([1]).buffer)).rejects.toThrow('offline');
    expect(adapter.files.get(`${base}/sources/packs/_source/a.yml`)).toBe(oldBytes);
    expect(adapter.files.get(`${base}/source-sync-manifest.json`)).toBe(oldManifest);
  });

  it('rolls back live files and manifest when publication fails after a write', async () => {
    const adapter = memoryAdapter();
    const base = 'plugins/guided-character-sheet';
    const oldA = new Uint8Array([9]).buffer;
    const oldManifest = JSON.stringify({ files: { 'packs/_source/a.yml': { remoteSha: 'a'.repeat(40), localSha256: 'b'.repeat(64) } } });
    adapter.files.set(`${base}/sources/packs/_source/a.yml`, oldA);
    adapter.files.set(`${base}/source-sync-manifest.json`, oldManifest);
    const originalWriteBinary = adapter.writeBinary;
    let liveWrites = 0;
    adapter.writeBinary = async (path, data) => {
      if (path.includes(`${base}/sources/`) && !path.includes('.stage-')) {
        liveWrites += 1;
        if (liveWrites === 2) throw new Error('disk full');
      }
      await originalWriteBinary(path, data);
    };
    await expect(new SourceStore(adapter, base).download(request, [
      { path: 'packs/_source/a.yml', sha: 'c'.repeat(40) },
      { path: 'packs/_source/b.yml', sha: 'd'.repeat(40) },
    ], snapshot, async (entry) => entry.path.endsWith('a.yml') ? new Uint8Array([1]).buffer : new Uint8Array([2]).buffer)).rejects.toThrow('disk full');
    expect(adapter.files.get(`${base}/sources/packs/_source/a.yml`)).toEqual(oldA);
    expect(adapter.files.get(`${base}/source-sync-manifest.json`)).toBe(oldManifest);
  });

  it('cleans staging files when a staging write fails', async () => {
    const adapter = memoryAdapter();
    const originalWriteBinary = adapter.writeBinary;
    let stageWrites = 0;
    adapter.writeBinary = async (path, data) => {
      if (path.includes('.stage-')) {
        stageWrites += 1;
        if (stageWrites === 2) throw new Error('stage full');
      }
      await originalWriteBinary(path, data);
    };
    await expect(new SourceStore(adapter, 'plugins/guided-character-sheet').download(request, [
      { path: 'packs/_source/a.yml', sha: 'a' }, { path: 'packs/_source/b.yml', sha: 'b' },
    ], snapshot, async () => new Uint8Array([1]).buffer)).rejects.toThrow('stage full');
    expect([...adapter.files.keys()].some((path) => path.includes('.stage-'))).toBe(false);
  });

  it('removes a newly created manifest when publication fails without an old manifest', async () => {
    const adapter = memoryAdapter();
    const originalWrite = adapter.write;
    adapter.write = async (path, data) => {
      await originalWrite(path, data);
      if (path.endsWith('source-sync-manifest.json')) throw new Error('manifest unavailable');
    };
    await expect(new SourceStore(adapter, 'plugins/guided-character-sheet').download(request, [
      { path: 'packs/_source/a.yml', sha: 'a' },
    ], snapshot, async () => new Uint8Array([1]).buffer)).rejects.toThrow('manifest unavailable');
    expect([...adapter.files.keys()].some((path) => path.endsWith('source-sync-manifest.json') || path.includes('.stage-'))).toBe(false);
    expect(await adapter.exists('plugins/guided-character-sheet/sources/packs/_source/a.yml')).toBe(false);
  });

  it('rethrows the publication error when rollback manifest existence checks fail', async () => {
    const adapter = memoryAdapter();
    const originalExists = adapter.exists;
    let manifestChecks = 0;
    adapter.exists = async (path) => {
      if (path.endsWith('source-sync-manifest.json')) {
        manifestChecks += 1;
        if (manifestChecks > 1) throw new Error('exists unavailable');
      }
      return originalExists(path);
    };
    adapter.write = async (path) => {
      if (path.endsWith('source-sync-manifest.json')) throw new Error('manifest unavailable');
    };
    await expect(new SourceStore(adapter, 'plugins/guided-character-sheet').download(request, [
      { path: 'packs/_source/a.yml', sha: 'a' },
    ], snapshot, async () => new Uint8Array([1]).buffer)).rejects.toThrow('manifest unavailable');
  });

  it('rejects manifests with invalid shape or SHA fields before comparing', async () => {
    const adapter = memoryAdapter();
    adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ files: {
      'packs/_source/a.yml': { remoteSha: 'bad', localSha256: 'bad' },
    }}));
    await expect(new SourceStore(adapter, 'plugins/guided-character-sheet').compare(request, [])).rejects.toThrow('Invalid source manifest');
  });

  it('rejects a manifest files array and malformed entry objects', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    for (const files of [[], { 'packs/_source/a.yml': { remoteSha: 'a'.repeat(40) } }]) {
      adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ files }));
      await expect(store.compare(request, [])).rejects.toThrow('Invalid source manifest');
    }
  });

  it('rejects non-string manifest hashes', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    for (const entry of [
      { remoteSha: 1, localSha256: 'b'.repeat(64) },
      { remoteSha: 'a'.repeat(40), localSha256: 2 },
    ]) {
      adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ files: { 'packs/_source/a.yml': entry } }));
      await expect(store.compare(request, [])).rejects.toThrow('Invalid source manifest');
    }
  });

  it('rejects manifest metadata that is malformed or mismatched', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    const files = { 'packs/_source/a.yml': { remoteSha: 'a'.repeat(40), localSha256: 'b'.repeat(64) } };
    for (const metadata of [
      { ...validMetadata, repo: 'other' },
      { ...validMetadata, prefix: 'other/' },
      { ...validMetadata, fetchedAt: 'not-a-timestamp' },
      { ...validMetadata, owner: 1 },
    ]) {
      adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ ...metadata, files }));
      await expect(store.compare(request, [])).rejects.toThrow('Invalid source manifest');
    }
  });

  it('accepts the development manifest that accidentally included the character folder', async () => {
    const adapter = memoryAdapter();
    adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ ...validMetadata, characterFolder: 'Characters', files: {} }));
    await expect(new SourceStore(adapter, 'plugins/guided-character-sheet').readSnapshot(request)).resolves.toEqual(snapshot);
  });

  it('rejects manifest entries with unexpected fields', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ ...validMetadata, files: {
      'packs/_source/a.yml': { remoteSha: 'a'.repeat(40), localSha256: 'b'.repeat(64), extra: true },
    } }));
    await expect(store.compare(request, [])).rejects.toThrow('Invalid source manifest');
  });

  it('compares without writing', async () => {
    const adapter = memoryAdapter();
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    await store.compare(request, [{ path: 'packs/_source/a.yml', sha: 'remote' }]);
    expect(adapter.writes).toEqual([]);
  });

  it('treats a missing source root as empty during compare', async () => {
    const adapter = memoryAdapter();
    adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ ...validMetadata, files: {
      'packs/_source/a.yml': { remoteSha: 'a'.repeat(40), localSha256: 'b'.repeat(64) },
    } }));
    adapter.list = async (path) => {
      if (path === 'plugins/guided-character-sheet/sources') throw new Error('missing directory');
      return [...adapter.files.keys()].filter((file) => file.startsWith(`${path}/`));
    };
    const store = new SourceStore(adapter, 'plugins/guided-character-sheet');
    adapter.files.set('plugins/guided-character-sheet/source-sync-manifest.json', JSON.stringify({ ...validMetadata, files: {
      'packs/_source/a.yml': { remoteSha: 'a'.repeat(40), localSha256: 'b'.repeat(64) },
    } }));
    const result = await store.compare(request, [{ path: 'packs/_source/a.yml', sha: 'a'.repeat(40) }]);
    expect(result.notDownloaded).toEqual(['packs/_source/a.yml']);
  });
});
