import { normalizePath, TFile, TFolder, type TAbstractFile } from 'obsidian';
import { createCharacterDocument, parseCharacterDocument, type CharacterDocument } from './character-model';
import type { SourceSnapshot } from './source-tree';
import { restoreSpeciesConfiguration, validateSpeciesConfiguration, type SpeciesConfigurationSource } from './species-configuration';

export interface CharacterVault {
  createFolder(path: string): Promise<unknown>;
  getFolderByPath?(path: string): unknown | null;
  create(path: string, data: string): Promise<TFile>;
  getFileByPath(path: string): TFile | null;
  read(file: TFile): Promise<string>;
  process(file: TFile, fn: (data: string) => string): Promise<string>;
}

export class CharacterStore {
  private readonly folder: string;

  constructor(private readonly vault: CharacterVault, folder: string, private readonly createId: () => string = () => globalThis.crypto.randomUUID()) {
    this.folder = validateFolder(folder);
  }

  async create(name: string, snapshot: SourceSnapshot): Promise<TFile> {
    await this.ensureFolder();
    for (;;) {
      const filename = `${this.createId()}.json`;
      const path = normalizePath(`${this.folder}/${filename}`);
      if (this.vault.getFileByPath(path) === null) return this.vault.create(path, serialize(createCharacterDocument(name, snapshot)));
    }
  }

  async read(file: TFile): Promise<CharacterDocument> {
    try { return parseCharacterDocument(JSON.parse(await this.vault.read(file)) as unknown); } catch (error) {
      if (error instanceof Error && error.message === 'Invalid character document') throw error;
      throw new Error(`Invalid character JSON in ${file.path}`);
    }
  }

  async readValidated(file: TFile, source: SpeciesConfigurationSource): Promise<{ document: CharacterDocument; warnings: string[] }> {
    const document = await this.read(file);
    if (document.speciesConfiguration === undefined) return { document, warnings: [] };
    const configuration = restoreSpeciesConfiguration(document.speciesConfiguration, source);
    return { document, warnings: validateSpeciesConfiguration(configuration, { ...source, snapshot: source.snapshot }) };
  }

  async list(): Promise<TFile[]> {
    const folder = this.vault.getFolderByPath?.(this.folder);
    if (!(folder instanceof TFolder)) return [];
    const files: TFile[] = [];
    for (const child of folder.children as TAbstractFile[]) {
      if (child instanceof TFile && child.extension === 'json') {
        try { await this.read(child); files.push(child); } catch { /* hide invalid JSON from the character selector */ }
      }
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  async update(file: TFile, update: (document: CharacterDocument) => CharacterDocument): Promise<CharacterDocument> {
    let updated: CharacterDocument | undefined;
    await this.vault.process(file, (data) => {
      let current: CharacterDocument;
      try { current = parseCharacterDocument(JSON.parse(data) as unknown); } catch { throw new Error(`Invalid character JSON in ${file.path}`); }
      updated = parseCharacterDocument(update(current));
      return serialize(updated);
    });
    if (updated === undefined) throw new Error(`Character update did not complete for ${file.path}`);
    return updated;
  }

  async updateIfUnchanged(file: TFile, expected: CharacterDocument, update: (current: CharacterDocument) => CharacterDocument): Promise<CharacterDocument> {
    let updated: CharacterDocument | undefined;
    await this.vault.process(file, (data) => {
      let current: CharacterDocument;
      try { current = parseCharacterDocument(JSON.parse(data) as unknown); } catch { throw new Error(`Invalid character JSON in ${file.path}`); }
      if (!sameDocument(current, expected)) throw new Error(`Character changed externally in ${file.path}`);
      updated = parseCharacterDocument(update(current));
      return serialize(updated);
    });
    if (updated === undefined) throw new Error(`Character update did not complete for ${file.path}`);
    return updated;
  }

  private async ensureFolder(): Promise<void> {
    if (this.vault.getFolderByPath?.(this.folder) === null || this.vault.getFolderByPath === undefined) await this.vault.createFolder(this.folder);
  }
}

function validateFolder(folder: string): string {
  const normalized = normalizePath(folder.trim());
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.split('/').includes('')) throw new Error('Invalid character folder');
  return normalized;
}

function serialize(document: CharacterDocument): string { return `${JSON.stringify(document, null, 2)}\n`; }
function sameDocument(left: CharacterDocument, right: CharacterDocument): boolean { return JSON.stringify(left) === JSON.stringify(right); }
