export interface SourceTreeRequest {
  owner: string;
  repo: string;
  branch: string;
  prefix: string;
}

export const SOURCE_PREFIX = 'packs/_source/';

export interface SourceTreeEntry {
  path: string;
  sha: string;
}

export interface SourceSnapshot {
  owner: string;
  repo: string;
  branch: string;
  commit: string;
  systemVersion: string;
}

export type RequestJson = (url: string) => Promise<unknown>;

export async function fetchSourceTree(
  request: SourceTreeRequest,
  requestJson: RequestJson,
): Promise<SourceTreeEntry[]> {
  validateSourceTreeRequest(request);
  const url = `https://api.github.com/repos/${request.owner}/${request.repo}/git/trees/${encodeURIComponent(request.branch)}?recursive=1`;
  const response: unknown = await requestJson(url);
  if (!isRecord(response) || response.truncated !== false || !Array.isArray(response.tree)) {
    throw new Error('Invalid GitHub tree response');
  }

  const entries: SourceTreeEntry[] = [];
  for (const item of response.tree) {
    if (!isRecord(item) || typeof item.path !== 'string' || typeof item.type !== 'string' || typeof item.sha !== 'string' || item.sha.length === 0) {
      throw new Error('Invalid GitHub tree entry');
    }
    if (item.type === 'blob' && !/^[0-9a-f]{40}$/i.test(item.sha)) {
      throw new Error('Invalid GitHub tree entry');
    }
    if (item.path.includes('\\') || item.path.split('/').includes('..')) {
      throw new Error('Unsafe source tree path');
    }
    if (item.type === 'blob' && item.path.startsWith(SOURCE_PREFIX)) {
      entries.push({ path: item.path, sha: item.sha });
    }
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function fetchSourceSnapshot(
  request: SourceTreeRequest,
  requestJson: RequestJson,
  fetchText: (url: string) => Promise<string>,
): Promise<SourceSnapshot> {
  validateSourceTreeRequest(request);
  const treeUrl = `https://api.github.com/repos/${request.owner}/${request.repo}/git/trees/${encodeURIComponent(request.branch)}?recursive=1`;
  const treeResponse: unknown = await requestJson(treeUrl);
  if (!isRecord(treeResponse) || treeResponse.truncated !== false || !isValidGitSha(treeResponse.sha)) {
    throw new Error('Invalid GitHub tree response');
  }
  const systemUrl = `https://raw.githubusercontent.com/${request.owner}/${request.repo}/${encodeURIComponent(request.branch)}/system.json`;
  let systemResponse: unknown;
  try {
    systemResponse = JSON.parse(await fetchText(systemUrl));
  } catch {
    throw new Error('Invalid Foundry system metadata');
  }
  if (!isRecord(systemResponse) || typeof systemResponse.version !== 'string' || systemResponse.version.trim().length === 0) {
    throw new Error('Invalid Foundry system metadata');
  }
  return { owner: request.owner, repo: request.repo, branch: request.branch, commit: treeResponse.sha, systemVersion: systemResponse.version };
}

export function rawSourceUrl(request: SourceTreeRequest, entry: SourceTreeEntry): string {
  validateSourceTreeRequest(request);
  if (typeof entry.sha !== 'string' || entry.sha.length === 0 || !isSafePath(entry.path) || !entry.path.startsWith(SOURCE_PREFIX)) {
    throw new Error('Invalid source tree entry');
  }
  return `https://raw.githubusercontent.com/${request.owner}/${request.repo}/${encodeURIComponent(request.branch)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`;
}

export function validateSourceTreeRequest(request: SourceTreeRequest): void {
  if (request.prefix !== SOURCE_PREFIX || !/^[A-Za-z0-9_.-]+$/.test(request.owner) || !/^[A-Za-z0-9_.-]+$/.test(request.repo) || !isSafeRef(request.branch)) throw new Error('Invalid source tree request');
}
function isSafeRef(value: string): boolean { return !!value && value.length <= 255 && !/[\\\x00-\x20~^:?*\[]/.test(value) && !value.startsWith('/') && !value.endsWith('/') && !value.startsWith('.') && !value.endsWith('.') && !value.includes('..') && !value.includes('//'); }
function isSafePath(path: string): boolean { return !!path && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..') && !path.split('/').includes('') ; }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidGitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}
