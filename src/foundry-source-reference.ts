import type { FoundrySourceReference } from './foundry-source-catalog';

export function isFoundrySourceReference(value: unknown): value is FoundrySourceReference {
  return isRecord(value) && typeof value.sourcePath === 'string' && isSafeSourcePath(value.sourcePath) && typeof value.pack === 'string' && value.pack.trim().length > 0 && typeof value.type === 'string' && value.type.trim().length > 0 && typeof value.id === 'string' && value.id.trim().length > 0 && typeof value.name === 'string' && value.name.trim().length > 0 && (value.identifier === undefined || typeof value.identifier === 'string');
}
export function isSafeSourcePath(path: string): boolean { return path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..') && !path.split('/').includes('') && path.endsWith('.yml'); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
