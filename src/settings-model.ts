import type { ComparisonResult } from './source-comparison';
import { normalizePath } from 'obsidian';

export interface GuidedCharacterSheetSettings {
  owner: string;
  repo: string;
  branch: string;
  characterFolder: string;
}

export const DEFAULT_SETTINGS: GuidedCharacterSheetSettings = {
  owner: 'foundryvtt',
  repo: 'dnd5e',
  branch: '6.0.x',
  characterFolder: 'Characters',
};

export function validateSettings(value: unknown): GuidedCharacterSheetSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings');
  const settings = value as Partial<GuidedCharacterSheetSettings>;
  if (typeof settings.owner !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(settings.owner) || typeof settings.repo !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(settings.repo) || typeof settings.branch !== 'string' || !settings.branch || /[\\\x00-\x20~^:?*\[]/.test(settings.branch) || settings.branch.includes('..') || settings.branch.includes('//') || settings.branch.startsWith('/') || settings.branch.endsWith('/')) throw new Error('Invalid settings');
  if (typeof settings.characterFolder !== 'string') throw new Error('Invalid settings');
  const characterFolder = normalizePath(settings.characterFolder.trim());
  if (!characterFolder || characterFolder.startsWith('/') || characterFolder.split('/').includes('..') || characterFolder.split('/').includes('')) throw new Error('Invalid settings');
  return { owner: settings.owner, repo: settings.repo, branch: settings.branch, characterFolder };
}

export function formatComparisonNotice(result: ComparisonResult): string {
  return `Comparison results: ${result.unchanged.length} unchanged, ${result.locallyModified.length} locally modified, ${result.onlineChanged.length} online changed, ${result.addedOnline.length} added online, ${result.removedOnline.length} removed online, ${result.notDownloaded.length} not downloaded.`;
}
