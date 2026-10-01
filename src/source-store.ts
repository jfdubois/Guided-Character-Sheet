import type { SourceSnapshot, SourceTreeEntry } from './source-tree';
import { rawSourceUrl, SOURCE_PREFIX, validateSourceTreeRequest, type SourceTreeRequest } from './source-tree';
import { compareSources, type ComparisonResult, type SourceManifestEntry } from './source-comparison';
import type { FileSystemAdapter, ListedFiles } from 'obsidian';

export interface SourceManifest {
  owner: string;
  repo: string;
  branch: string;
  prefix: string;
  fetchedAt: string;
  snapshot: SourceSnapshot;
  files: Record<string, SourceManifestEntry>;
}

export interface SourceStoreAdapter {
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  list(path: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
}

export type FetchSourceBytes = (entry: SourceTreeEntry) => Promise<ArrayBuffer>;
export interface SourceDownloadOptions {
  workerLimit?: number;
  onProgress?: (completed: number, total: number) => void;
}

export function createFileSystemAdapter(adapter: FileSystemAdapter): SourceStoreAdapter {
  const base = adapter.getBasePath().replace(/[\\/]$/, '');
  const toRelative = (path: string): string => {
    if (path === base) return '';
    let relative = path.replace(/^[/\\]+/, '');
    const normalizedBase = base.replace(/^[/\\]+/, '');
    while (relative === normalizedBase || relative.startsWith(`${normalizedBase}/`)) {
      relative = relative === normalizedBase ? '' : relative.slice(normalizedBase.length + 1);
    }
    return relative;
  };
  const resolve = (path: string) => {
    const relative = toRelative(path);
    // FileSystemAdapter resolves vault-relative paths against its own base.
    // Passing an absolute path here makes it prepend the vault base twice.
    const resolved = relative;
    return resolved;
  };
  const normalizeChild = (relative: string, child: string): string => {
    const absolutePrefix = `${base}/`;
    const normalizedBase = base.replace(/^[/\\]+/, '');
    const normalizedChild = child.replace(/^[/\\]+/, '');
    if (relative && (child === relative || child.startsWith(`${relative}/`))) return child;
    if (child === base || normalizedChild === normalizedBase || child.startsWith(absolutePrefix) || normalizedChild.startsWith(`${normalizedBase}/`)) {
      return toRelative(child);
    }
    return relative ? `${relative}/${child}` : child;
  };
  const list = async (path: string): Promise<string[]> => {
    const result: string[] = [];
    const visit = async (relative: string): Promise<void> => {
      const listed: ListedFiles = await adapter.list(resolve(relative));
      for (const file of listed.files) result.push(normalizeChild(relative, file));
      for (const folder of listed.folders) await visit(normalizeChild(relative, folder));
    };
    await visit(toRelative(path));
    return result;
  };
  return {
    mkdir: (path) => adapter.mkdir(resolve(path)),
    exists: (path) => adapter.exists(resolve(path)),
    read: (path) => adapter.read(resolve(path)),
    readBinary: (path) => adapter.readBinary(resolve(path)),
    write: (path, data) => adapter.write(resolve(path), data),
    writeBinary: (path, data) => adapter.writeBinary(resolve(path), data),
    remove: (path) => adapter.remove(resolve(path)),
    rmdir: (path) => adapter.rmdir(resolve(path), true),
    list,
  };
}

const manifestName = 'source-sync-manifest.json';
let stageSequence = 0;

export class SourceStore {
  constructor(private readonly adapter: SourceStoreAdapter, private readonly pluginBase: string) {}

  async readSnapshot(request: SourceTreeRequest): Promise<SourceSnapshot> {
    validateSourceTreeRequest(request);
    const path = `${this.pluginBase}/${manifestName}`;
    if (!(await this.adapter.exists(path))) throw new Error('Source snapshot is unavailable. Download the Foundry sources first.');
    const value: unknown = JSON.parse(await this.adapter.read(path));
    return validateManifest(value, request).snapshot;
  }

  async download(request: SourceTreeRequest, entries: SourceTreeEntry[], snapshot: SourceSnapshot, fetchBytes: FetchSourceBytes, options: SourceDownloadOptions = {}): Promise<SourceManifest> {
    validateSourceTreeRequest(request);
    validateSnapshot(snapshot, request);
    const files: Record<string, SourceManifestEntry> = {};
    const downloaded: Array<{ entry: SourceTreeEntry; bytes: ArrayBuffer; localSha256: string }> = [];
    let nextIndex = 0;
    let completed = 0;
    const workerLimit = Math.max(1, Math.floor(options.workerLimit ?? 8));
    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex++;
        if (index >= entries.length) return;
        const entry = entries[index];
        validatePath(entry.path);
        const bytes = await fetchBytes(entry);
        const localSha256 = await sha256(bytes);
        downloaded[index] = { entry, bytes, localSha256 };
        completed += 1;
        options.onProgress?.(completed, entries.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(workerLimit, entries.length) }, () => worker()));
    const staged = downloaded.map(({ entry, bytes, localSha256 }) => {
      files[entry.path] = { remoteSha: entry.sha, localSha256 };
      return { entry, bytes };
    });
    const stageBase = `${this.pluginBase}/.stage-${Date.now()}-${stageSequence++}`;
    const manifestPath = `${this.pluginBase}/${manifestName}`;
    const manifest: SourceManifest = { ...request, fetchedAt: new Date().toISOString(), snapshot, files };
    const snapshots = new Map<string, ArrayBuffer | undefined>();
    const oldManifest = await this.adapter.exists(manifestPath) ? await this.adapter.read(manifestPath) : undefined;
    try {
      for (const { entry, bytes } of staged) {
        const stageTarget = `${stageBase}/sources/${entry.path}`;
        await this.makeParentDirectories(stageTarget);
        await this.adapter.writeBinary(stageTarget, bytes);
      }
      for (const { entry } of staged) {
        const target = `${this.pluginBase}/sources/${entry.path}`;
        snapshots.set(target, await this.adapter.exists(target) ? await this.adapter.readBinary(target) : undefined);
      }
      for (const { entry, bytes } of staged) {
        const target = `${this.pluginBase}/sources/${entry.path}`;
        await this.makeParentDirectories(target);
        await this.adapter.writeBinary(target, bytes);
      }
      await this.adapter.write(manifestPath, JSON.stringify(manifest, null, 2));
    } catch (error) {
      for (const [target, previous] of snapshots) {
        if (previous !== undefined) {
          try { await this.adapter.writeBinary(target, previous); } catch { /* preserve the original publication error */ }
        } else if (await safeExists(this.adapter, target)) {
          try { await this.adapter.remove(target); } catch { /* preserve the original publication error */ }
        }
      }
      if (oldManifest !== undefined) {
        try { await this.adapter.write(manifestPath, oldManifest); } catch { /* preserve the original publication error */ }
      } else if (await safeExists(this.adapter, manifestPath)) {
        try { await this.adapter.remove(manifestPath); } catch { /* preserve the original publication error */ }
      }
      throw error;
    } finally {
      await this.cleanupStage(stageBase, staged);
    }
    return manifest;
  }

  async compare(request: SourceTreeRequest, entries: SourceTreeEntry[]): Promise<ComparisonResult> {
    validateSourceTreeRequest(request);
    const manifestPath = `${this.pluginBase}/${manifestName}`;
    const manifestFiles: Record<string, SourceManifestEntry> = await this.adapter.exists(manifestPath)
      ? validateManifest(JSON.parse(await this.adapter.read(manifestPath)), request).files
      : {};
    const local = new Map<string, string>();
    const sourceRoot = `${this.pluginBase}/sources`;
    const localPaths = await this.adapter.exists(sourceRoot) ? await this.adapter.list(sourceRoot) : [];
    for (const path of localPaths) {
      const relative = path.startsWith(`${sourceRoot}/`) ? path.slice(sourceRoot.length + 1) : '';
      if (relative) local.set(relative, await sha256(await this.adapter.readBinary(path)));
    }
    return compareSources(new Map(entries.map((entry) => [entry.path, entry.sha])), new Map(Object.entries(manifestFiles)), local);
  }

  private async makeParentDirectories(file: string): Promise<void> {
    const parts = file.split('/');
    parts.pop();
    for (let index = 1; index <= parts.length; index++) {
      const path = parts.slice(0, index).join('/');
      if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
    }
  }

  private async cleanupStage(stageBase: string, staged: Array<{ entry: SourceTreeEntry; bytes: ArrayBuffer }>): Promise<void> {
    for (const { entry } of staged) {
      const file = `${stageBase}/sources/${entry.path}`;
      try { await this.adapter.remove(file); } catch { /* cleanup is best effort */ }
    }
    try { await this.adapter.rmdir(stageBase); } catch { /* cleanup is best effort */ }
  }
}

export function sourceUrl(request: SourceTreeRequest, entry: SourceTreeEntry): string {
  return rawSourceUrl(request, entry);
}

function validatePath(path: string): void {
  if (!path.startsWith(SOURCE_PREFIX) || path.includes('\\') || path.split('/').includes('..') || path.startsWith('/') || path.split('/').includes('')) {
    throw new Error('Unsafe source path');
  }
}

function validateManifest(value: unknown, request: SourceTreeRequest): SourceManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('files' in value) || typeof value.files !== 'object' || value.files === null || Array.isArray(value.files)) throw new Error('Invalid source manifest');
  const manifest = value as Partial<SourceManifest>;
  const metadataKeys = Object.keys(value);
  const requiredMetadata = ['owner', 'repo', 'branch', 'prefix', 'fetchedAt', 'snapshot', 'files'];
  const isDevelopmentLegacyManifest = metadataKeys.length === 8 && metadataKeys.includes('characterFolder') && typeof (value as Record<string, unknown>).characterFolder === 'string';
  if ((!isDevelopmentLegacyManifest && metadataKeys.length !== 7) || !requiredMetadata.every((key) => metadataKeys.includes(key)) || typeof manifest.owner !== 'string' || typeof manifest.repo !== 'string' || typeof manifest.branch !== 'string' || typeof manifest.prefix !== 'string' || typeof manifest.fetchedAt !== 'string' || manifest.owner !== request.owner || manifest.repo !== request.repo || manifest.branch !== request.branch || manifest.prefix !== SOURCE_PREFIX || manifest.prefix !== request.prefix || Number.isNaN(Date.parse(manifest.fetchedAt)) || new Date(manifest.fetchedAt).toISOString() !== manifest.fetchedAt) throw new Error('Invalid source manifest');
  validateSnapshot(manifest.snapshot, request);
  for (const [path, entry] of Object.entries(value.files)) {
    if (!path.startsWith(SOURCE_PREFIX) || !path.split('/').every(Boolean) || path.includes('\\') || path.split('/').includes('..') || !entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid source manifest');
    const { remoteSha, localSha256 } = entry as Partial<SourceManifestEntry>;
    const entryKeys = Object.keys(entry);
    if (entryKeys.length !== 2 || !entryKeys.includes('remoteSha') || !entryKeys.includes('localSha256') || typeof remoteSha !== 'string' || typeof localSha256 !== 'string' || !/^[0-9a-f]{40}$/i.test(remoteSha) || !/^[0-9a-f]{64}$/i.test(localSha256)) throw new Error('Invalid source manifest');
  }
  return value as SourceManifest;
}

function validateSnapshot(snapshot: unknown, request: SourceTreeRequest): asserts snapshot is SourceSnapshot {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid source snapshot');
  const value = snapshot as Partial<SourceSnapshot>;
  if (Object.keys(snapshot).length !== 5 || value.owner !== request.owner || value.repo !== request.repo || value.branch !== request.branch || typeof value.owner !== 'string' || typeof value.repo !== 'string' || typeof value.branch !== 'string' || typeof value.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(value.commit) || typeof value.systemVersion !== 'string' || value.systemVersion.trim().length === 0) throw new Error('Invalid source snapshot');
}

async function safeExists(adapter: SourceStoreAdapter, path: string): Promise<boolean> {
  try { return await adapter.exists(path); } catch { return false; }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
