import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { withOrigin, withRuleset, withSpeciesConfiguration } from '../src/character-model';
import { CharacterStore } from '../src/character-store';
import { createSourceIndex, createSourceReader, type SourceReaderAdapter } from '../src/character-sources';
import { buildSpeciesConfiguration, setSpeciesChoice, validateSpeciesConfiguration } from '../src/species-configuration';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'b'.repeat(40), systemVersion: '6.0.0' };

describe('character creation smoke flow', () => {
  it('creates a character, configures a required species choice, and reopens it', async () => {
    const files = new Map<string, string>();
    const vault = {
      async createFolder() {},
      async create(path: string, data: string) { files.set(path, data); return { path } as unknown as TFile; },
      getFileByPath(path: string) { return files.has(path) ? { path } as unknown as TFile : null; },
      async read(file: TFile) { return files.get(file.path) ?? ''; },
      async process(file: TFile, transform: (data: string) => string) { const next = transform(files.get(file.path) ?? ''); files.set(file.path, next); return next; },
    };
    const store = new CharacterStore(vault, 'Characters');
    const file = await store.create('Ayla', snapshot);
    await store.update(file, (document) => withRuleset(document, '2014'));
    const raceReader = createSourceReader(sourceAdapter('packs/_source/races/elf.yml', 'Elf', 'elf'), 'sources');
    const races = await raceReader.listOrigins('2014');
    expect(races[0]?.name).toBe('Elf');
    await store.update(file, (document) => withOrigin(document, races[0]));
    const summary = await sourceIndexFor(sourceAdapter(sourcePathFor('2014'), 'Elf', 'elf')).getSpeciesSummary('2014', races[0]!.sourcePath);
    const configuration = buildSpeciesConfiguration(summary, snapshot);
    expect(configuration.grants).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Darkvision', source: expect.objectContaining({ id: 'darkvision', type: 'feat' }) }),
    ]));
    expect(configuration.choices).toHaveLength(1);
    expect(configuration.choices[0]).toMatchObject({ count: 1, selected: [], options: [{ value: 'languages:common' }] });
    const selectedConfiguration = setSpeciesChoice(configuration, configuration.choices[0]!.key, ['languages:common']);
    expect(validateSpeciesConfiguration(selectedConfiguration, { origin: races[0]!, summary, grants: configuration.grants, choices: configuration.choices, snapshot })).toEqual([]);
    await store.update(file, (document) => withSpeciesConfiguration(document, selectedConfiguration));
    const reopened = await store.read(file);
    expect(reopened).toMatchObject({ ruleset: '2014', origin: { identifier: 'elf' }, foundry: { systemVersion: '6.0.0', sourceCommit: 'b'.repeat(40) }, speciesConfiguration: { choices: [{ selected: ['languages:common'] }] } });

    const sourceIndex = createSourceIndex(sourceAdapter(sourcePathFor('2014'), 'Elf', 'elf'), 'sources');
    const summaryBeforeReopen = await sourceIndex.getSpeciesSummary(reopened.ruleset!, reopened.origin!.sourcePath);
    const reopenedAgain = await store.read(file);
    const summaryAfterReopen = await sourceIndex.getSpeciesSummary(reopenedAgain.ruleset!, reopenedAgain.origin!.sourcePath);
    expect(stableSummary(summaryAfterReopen)).toEqual(stableSummary(summaryBeforeReopen));
    expect(reopenedAgain).toMatchObject({
      ruleset: '2014',
      origin: { sourcePath: 'packs/_source/races/elf.yml', identifier: 'elf', id: 'origin-id' },
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'b'.repeat(40) },
      speciesConfiguration: { choices: [{ selected: ['languages:common'] }] },
    });
    const persisted = await store.read(file);
    const persistedJson = JSON.stringify(JSON.parse(files.get(file.path) ?? '{}'));
    expect(persistedJson).toContain(persisted.origin!.sourcePath);
    expect(persistedJson).toContain(persisted.foundry.sourceCommit);
    expect(persistedJson).toContain('darkvision');
    expect(persistedJson).not.toContain('ItemGrant');
    expect(persistedJson).not.toContain('Compendium.dnd5e.feats.Item.darkvision');
    expect(persistedJson).not.toContain('advancement');

  });
});

function sourceAdapter(path: string, name: string, identifier: string): SourceReaderAdapter {
  const sourcePath = 'sources/' + path;
  const rules = path.includes('/origins24/') ? '2024' : '2014';
  const files = {
    [sourcePath]: 'type: race\nname: ' + name + '\nsystem:\n  source: { rules: ' + rules + ' }\n  identifier: ' + identifier + '\n  description: { value: Elven heritage. }\n  advancement:\n    grant:\n      _id: grant-id\n      type: ItemGrant\n      level: 1\n      hint: Darkvision\n      configuration: { uuid: Compendium.dnd5e.feats.Item.darkvision }\n    choice:\n      _id: choice-id\n      type: Trait\n      level: 1\n      hint: Choose a language\n      configuration:\n        choices:\n          - count: 1\n            pool: [languages:common]\n_id: origin-id',
    'sources/packs/_source/feats/darkvision.yml': 'type: feat\nname: Darkvision\nsystem: {}\n_id: darkvision',
  };
  return { async exists() { return true; }, async list() { return Object.keys(files); }, async read(file) { return files[file as keyof typeof files]; } };
}

function sourceIndexFor(adapter: SourceReaderAdapter) {
  return createSourceIndex(adapter, 'sources');
}

function sourcePathFor(ruleset: '2014' | '2024'): string {
  return ruleset === '2014' ? 'packs/_source/races/elf.yml' : 'packs/_source/origins24/species/elf.yml';
}

function stableSummary(summary: Awaited<ReturnType<ReturnType<typeof createSourceIndex>['getSpeciesSummary']>>) {
  return {
    source: summary.source,
    ruleset: summary.ruleset,
    description: summary.description,
    advancements: summary.advancements.map((advancement) => ({
      id: advancement.id,
      type: advancement.type,
      level: advancement.level,
      hint: advancement.hint,
      automatic: advancement.automatic,
      dependencies: advancement.dependencies.map((dependency) => ({ uuid: dependency.uuid, source: dependency.source })),
    })),
  };
}
