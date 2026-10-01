import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { CharacterStore } from '../src/character-store';
import { withClassProgression, withOrigin, withRuleset, withSpeciesConfiguration } from '../src/character-model';
import { createSpeciesConfiguration, setSpeciesChoice } from '../src/species-configuration';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };

function fakeVault(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const folders = new Set<string>();
  const vault = {
    async createFolder(path: string) { folders.add(path); },
    getFolderByPath(path: string) { return folders.has(path) ? { path } : null; },
    async create(path: string, data: string) { files.set(path, data); return file(path); },
    getFileByPath(path: string) { return files.has(path) ? file(path) : null; },
    async read(target: TFile) { return files.get(target.path) ?? ''; },
    async process(target: TFile, transform: (data: string) => string) { files.set(target.path, transform(files.get(target.path) ?? '')); return files.get(target.path) ?? ''; },
    files, folders,
  };
  return vault;
}

function file(path: string): TFile { return { path } as unknown as TFile; }

describe('character store', () => {
  it('creates the folder and stores the character name under a unique UUID filename', async () => {
    const existingId = '11111111-1111-4111-8111-111111111111';
    const createdId = '22222222-2222-4222-8222-222222222222';
    const secondId = '33333333-3333-4333-8333-333333333333';
    const ids = [existingId, createdId, secondId][Symbol.iterator]();
    const vault = fakeVault({ [`Characters/${existingId}.json`]: '{}' });
    const store = new CharacterStore(vault, 'Characters', () => ids.next().value!);
    const created = await store.create('Ayla / test', snapshot);
    expect(vault.folders).toContain('Characters');
    expect(created.path).toBe(`Characters/${createdId}.json`);
    expect(JSON.parse(await vault.read(created))).toMatchObject({ name: 'Ayla / test' });
    const second = await store.create('Ayla / test', snapshot);
    expect(second.path).toBe(`Characters/${secondId}.json`);
  });

  it('reads and updates through the current file contents', async () => {
    const vault = fakeVault();
    const store = new CharacterStore(vault, 'Characters');
    const created = await store.create('Ayla', snapshot);
    const selected = await store.update(created, (document) => withRuleset(document, '2024'));
    expect(selected.ruleset).toBe('2024');
    const current = await store.update(created, (document) => withOrigin(document, { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }));
    expect(current.origin?.identifier).toBe('elf');
  });

  it('round-trips origin and Foundry provenance without embedding source data', async () => {
    const vault = fakeVault();
    const store = new CharacterStore(vault, 'Characters');
    const created = await store.create('Ayla', snapshot);
    await store.update(created, (document) => withOrigin(withRuleset(document, '2024'), {
      sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id',
    }));

    const reopened = await store.read(created);

    expect(reopened).toMatchObject({
      ruleset: '2024',
      origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' },
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'a'.repeat(40) },
    });
    expect(JSON.parse(await vault.read(created))).not.toHaveProperty('sourceRecord');
  });

  it('rejects invalid files and invalid updates without changing the file', async () => {
    const vault = fakeVault({ 'Characters/bad.json': '{bad' });
    const store = new CharacterStore(vault, 'Characters');
    const bad = file('Characters/bad.json');
    await expect(store.read(bad)).rejects.toThrow('Invalid character JSON');
    const created = await store.create('Ayla', snapshot);
    const before = await vault.read(created);
    await expect(store.update(created, () => ({ invalid: true } as never))).rejects.toThrow('Invalid character document');
    expect(await vault.read(created)).toBe(before);
  });

  it('preserves unknown fields when updating', async () => {
    const vault = fakeVault();
    const store = new CharacterStore(vault, 'Characters');
    const created = await store.create('Ayla', snapshot);
    await vault.process(created, (data) => JSON.stringify({ ...JSON.parse(data), custom: { keep: true } }));
    const result = await store.update(created, (document) => withRuleset(document, '2014'));
    expect(result.custom).toEqual({ keep: true });
  });

  it('round-trips species selections through the store process boundary', async () => {
    const vault = fakeVault();
    const store = new CharacterStore(vault, 'Characters');
    const created = await store.create('Ayla', snapshot);
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), choices: [{ key: 'choice:language', level: 1, label: 'Language', count: 1, source: { id: 'choice-id', type: 'Choice' }, options: [{ value: 'elvish', label: 'Elvish', source: { id: 'elvish-id', type: 'Item' } }], selected: [], raw: {} }] };
    await store.update(created, (document) => withSpeciesConfiguration(withOrigin(withRuleset(document, '2024'), origin), setSpeciesChoice(configuration, 'choice:language', ['elvish'])));
    const reopened = await store.read(created);
    expect(reopened.speciesConfiguration).toMatchObject({ origin, foundry: { systemVersion: snapshot.systemVersion, sourceBranch: snapshot.branch, sourceCommit: snapshot.commit }, choices: [{ key: 'choice:language', selected: ['elvish'], source: { id: 'choice-id', type: 'Choice' } }] });
  });

  it('round-trips exactly one class progression through the store process boundary', async () => {
    const vault = fakeVault();
    const store = new CharacterStore(vault, 'Characters');
    const created = await store.create('Ayla', snapshot);
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    await store.update(created, (document) => withClassProgression(withOrigin(withRuleset(document, '2024'), origin), { class: classRef, targetLevel: 1, selections: [] }));
    const reopened = await store.read(created);
    expect(reopened.classProgressions).toEqual([{ class: classRef, targetLevel: 1, selections: [] }]);
  });
});
