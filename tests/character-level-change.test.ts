import { describe, expect, it } from 'vitest';
import { applyCharacterLevelDraft } from '../src/character-level-change';
import type { CharacterDocument } from '../src/character-model';
import { projectCharacterSheet, type CharacterSheetSources } from '../src/character-sheet-model';
import { CharacterStore } from '../src/character-store';
import type { TFile } from 'obsidian';
import { setClassHitPointGain } from '../src/class-hit-points';

const classPath = 'packs/_source/classes24/fighter/fighter.yml';
const saved: CharacterDocument = {
  format: 1, kind: 'guided-character', name: 'Ayla', ruleset: '2024', step: 'background',
  foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'a'.repeat(40) },
  origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' },
  classProgressions: [{ class: { sourcePath: classPath, identifier: 'fighter', id: 'fighter' }, targetLevel: 1, selections: [] }],
  classHitPoints: [{ classSourcePath: classPath, level: 1, value: 'max' }],
  background: { sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', identifier: 'soldier', id: 'soldier' },
  abilityScores: { method: 'standard-array', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: { str: 0, dex: 0, con: 1, int: 0, wis: 0, cha: 0 } },
  mutable: { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [{ key: 'legacy:none', current: 0, maximum: 1, reset: 'none' }], hitPoints: { current: 7, maximum: 12, temporary: 4, maximumOverride: 15 }, inspiration: true, spellSlots: [], spellUses: [] },
};

const fighter: NonNullable<CharacterSheetSources['class']> = {
  source: { sourcePath: classPath, pack: 'dnd5e.classes24', type: 'class', id: 'fighter', identifier: 'fighter', name: 'Fighter' }, ruleset: '2024', hitDie: 'd10',
  proficiencies: { armor: [], weapons: [], tools: [], savingThrows: [], languages: [], skills: [], choices: [] }, advancements: [],
};
const species: NonNullable<CharacterSheetSources['species']> = { source: { sourcePath: saved.origin!.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf', name: 'Elf' }, ruleset: '2024', advancements: [] };
const background: NonNullable<CharacterSheetSources['background']> = { source: { sourcePath: saved.background!.sourcePath, pack: 'dnd5e.backgrounds24', type: 'background', id: 'soldier', name: 'Soldier' }, ruleset: '2024', skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [] };
const sources: CharacterSheetSources = { class: fighter, species, background, warnings: [] };
const preparedReference = { sourcePath: 'packs/_source/spells24/missing.yml', pack: 'dnd5e.spells', type: 'spell', id: 'missing', name: 'Missing spell' };

describe('character level reconciliation', () => {
  it('adds and removes the level-gated Draconic Resilience HP bonus in mutable maximum reconciliation', () => {
    const sorcererPath = 'packs/_source/classes24/sorcerer/sorcerer.yml';
    const source = { sourcePath: 'packs/_source/classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbscrDraconicRe', name: 'Draconic Resilience' };
    const sorcerer = { ...fighter, source: { ...fighter.source, sourcePath: sorcererPath, identifier: 'sorcerer', id: 'sorcerer', name: 'Sorcerer' }, hitDie: 'd6', features: [{ source, advancementId: 'draconic-resilience', level: 3, activeEffects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.hp.bonuses.overall', type: 'add', value: '@classes.sorcerer.levels' }] } }] }] };
    const before = structuredClone(saved);
    before.classProgressions![0]!.class = { sourcePath: sorcererPath, identifier: 'sorcerer', id: 'sorcerer' };
    before.mutable!.hitPoints = { current: 7, maximum: 8 };
    before.classHitPoints = [{ classSourcePath: sorcererPath, level: 1, value: 'max' }];
    const draft = structuredClone(before);
    draft.classProgressions![0]!.targetLevel = 3;
    draft.classHitPoints!.push({ classSourcePath: sorcererPath, level: 2, value: 'avg' }, { classSourcePath: sorcererPath, level: 3, value: 'avg' });
    const fromSources = { ...sources, class: sorcerer };

    const leveled = applyCharacterLevelDraft(before, draft, fromSources);
    expect(leveled.mutable?.hitPoints).toEqual({ current: 22, maximum: 23, temporary: 0 });

    const lowerDraft = structuredClone(leveled);
    lowerDraft.classProgressions![0]!.targetLevel = 1;
    lowerDraft.classHitPoints = lowerDraft.classHitPoints!.slice(0, 1);
    const lowered = applyCharacterLevelDraft(leveled, lowerDraft, fromSources);
    expect(lowered.mutable?.hitPoints).toEqual({ current: 7, maximum: 8, temporary: 0 });
  });

  it('requires an explicit HP gain for every new level and preserves HP state on Apply', () => {
    const savedWithSpells = structuredClone(saved);
    savedWithSpells.mutable!.preparedSpells = [preparedReference];
    savedWithSpells.mutable!.spellOverlay = { added: [{ reference: preparedReference, ownership: 'known-spells' }], removed: [] };
    const draft = structuredClone(savedWithSpells);
    draft.classProgressions![0]!.targetLevel = 3;
    delete draft.classHitPoints;
    expect(() => applyCharacterLevelDraft(savedWithSpells, draft, sources)).toThrow('Missing class hit-point entry for level 2.');
    draft.classHitPoints = setClassHitPointGain(setClassHitPointGain([{ classSourcePath: classPath, level: 1, value: 'max' }], classPath, 2, 'avg'), classPath, 3, 5);
    const resourceSource: CharacterSheetSources = { ...sources, class: { ...fighter, features: [{ source: { sourcePath: 'feature/action.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'action', name: 'Action surge' }, advancementId: 'level-two', level: 2, uses: { maximum: 1, recovery: [{ period: 'sr' }] }, activities: [] }] } };
    const result = applyCharacterLevelDraft(savedWithSpells, draft, resourceSource);
    expect(result.classHitPoints).toHaveLength(3);
    expect(result.mutable?.hitPoints).toMatchObject({ current: 7, maximum: 27, temporary: 4, maximumOverride: 15 });
    expect(result.mutable?.inspiration).toBe(true);
    expect(result.mutable?.preparedSpells).toEqual([]);
    expect(result.mutable?.spellOverlay?.added).toHaveLength(1);
    expect(result.mutable?.resources.find(({ key }) => key === 'feature:feature/action.yml')).toMatchObject({ current: 1, maximum: 1, reset: 'short-rest' });
  });

  it('preserves spent counters and hit dice when maxima increase, and starts new counters full', () => {
    const spellPath = 'packs/_source/spells24/familiar.yml';
    const spell = { sourcePath: spellPath, pack: 'dnd5e.spells', type: 'spell', id: 'familiar', name: 'Find Familiar' };
    const key = `${spellPath}:dnd5e.spells:spell:familiar`;
    const withResourceAndSpell: CharacterSheetSources = {
      ...sources,
      class: { ...fighter, spellcasting: { progression: 'full', ability: 'int', spellLists: ['wizard'] }, features: [
        { source: { sourcePath: 'feature/uses.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'uses', name: 'Uses' }, advancementId: 'uses', level: 1, uses: { maximum: 3, recovery: [{ period: 'lr' }] }, activities: [] },
        { source: { sourcePath: 'feature/new.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'new', name: 'New' }, advancementId: 'new', level: 3, uses: { maximum: 1, recovery: [{ period: 'lr' }] }, activities: [] },
      ] },
      species: { ...species, spellGrants: [{ advancementId: 'familiar', level: 1, spells: [spell], abilityOptions: [], raw: { configuration: { spell: { uses: { max: 3, requireSlot: false } } } } }] },
      spellSummaries: new Map([[key, { ...spell, ruleset: '2024' as const, level: 1, spellLists: [], ritual: false, uses: { maximum: 3, recovery: [{ period: 'lr' as const }] } }]]),
    };
    const previous = structuredClone(saved);
    previous.classProgressions![0]!.targetLevel = 2;
    previous.classHitPoints = [{ classSourcePath: classPath, level: 1, value: 'max' }, { classSourcePath: classPath, level: 2, value: 'avg' }];
    previous.mutable!.resources = [{ key: 'feature:feature/uses.yml', current: 1, maximum: 2, reset: 'long-rest' }];
    previous.mutable!.spellUses = [{ key, current: 1, maximum: 2, reset: 'long-rest' }];
    previous.mutable!.spellSlots = [{ key: 'spell:1', kind: 'spell', level: 1, current: 1, maximum: 3, recovery: ['long-rest'] }];
    previous.mutable!.hitDice = [{ classSourcePath: classPath, denomination: 'd10', current: 1, maximum: 2 }];
    const draft = structuredClone(previous);
    draft.classProgressions![0]!.targetLevel = 3;
    draft.classHitPoints!.push({ classSourcePath: classPath, level: 3, value: 'avg' });
    const result = applyCharacterLevelDraft(previous, draft, withResourceAndSpell);
    expect(result.mutable?.resources).toEqual([
      { key: 'feature:feature/uses.yml', current: 2, maximum: 3, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] },
      { key: 'feature:feature/new.yml', current: 1, maximum: 1, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] },
    ]);
    expect(result.mutable?.spellUses).toEqual([{ key, current: 2, maximum: 3, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }]);
    expect(result.mutable?.spellSlots).toEqual([
      { key: 'spell:1', kind: 'spell', level: 1, current: 2, maximum: 4, recovery: ['long-rest'] },
      { key: 'spell:2', kind: 'spell', level: 2, current: 2, maximum: 2, recovery: ['long-rest'] },
    ]);
    expect(result.mutable?.hitDice).toEqual([{ classSourcePath: classPath, denomination: 'd10', current: 2, maximum: 3 }]);
    expect(result.mutable?.resources.find(({ key: resourceKey }) => resourceKey === 'feature:feature/new.yml')).toMatchObject({ current: 1, maximum: 1 });
  });

  it('preserves the amount spent when counter maxima decrease', () => {
    const path = 'feature/shrinking.yml';
    const spellPath = 'packs/_source/spells24/familiar.yml';
    const spell = { sourcePath: spellPath, pack: 'dnd5e.spells', type: 'spell', id: 'familiar', name: 'Find Familiar' };
    const spellKey = `${spellPath}:dnd5e.spells:spell:familiar`;
    const withResource: CharacterSheetSources = {
      ...sources,
      class: { ...fighter, spellcasting: { progression: 'full', ability: 'int', spellLists: ['wizard'] }, features: [{ source: { sourcePath: path, pack: 'dnd5e.classfeatures', type: 'feat', id: 'shrinking', name: 'Shrinking' }, advancementId: 'shrinking', level: 1, uses: { maximum: 2, recovery: [{ period: 'lr' }] }, activities: [] }] },
      species: { ...species, spellGrants: [{ advancementId: 'familiar', level: 1, spells: [spell], abilityOptions: [], raw: { configuration: { spell: { uses: { max: 2, requireSlot: false } } } } }] },
      spellSummaries: new Map([[spellKey, { ...spell, ruleset: '2024' as const, level: 1, spellLists: [], ritual: false, uses: { maximum: 2, recovery: [{ period: 'lr' as const }] } }]]),
    };
    const previous = structuredClone(saved);
    previous.classProgressions![0]!.targetLevel = 3;
    previous.classHitPoints = [{ classSourcePath: classPath, level: 1, value: 'max' }, { classSourcePath: classPath, level: 2, value: 'avg' }, { classSourcePath: classPath, level: 3, value: 'avg' }];
    previous.mutable!.resources = [{ key: `feature:${path}`, current: 1, maximum: 3, reset: 'long-rest' }];
    previous.mutable!.spellUses = [{ key: spellKey, current: 1, maximum: 3, reset: 'long-rest' }];
    previous.mutable!.spellSlots = [{ key: 'spell:1', kind: 'spell', level: 1, current: 2, maximum: 4, recovery: ['long-rest'] }];
    previous.mutable!.hitDice = [{ classSourcePath: classPath, denomination: 'd10', current: 1, maximum: 3 }];
    const draft = structuredClone(previous);
    draft.classProgressions![0]!.targetLevel = 1;
    draft.classHitPoints = previous.classHitPoints!.slice(0, 1);
    const result = applyCharacterLevelDraft(previous, draft, withResource);
    expect(result.mutable?.resources).toEqual([{ key: `feature:${path}`, current: 0, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }]);
    expect(result.mutable?.spellUses).toEqual([{ key: spellKey, current: 0, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }]);
    expect(result.mutable?.spellSlots).toEqual([{ key: 'spell:1', kind: 'spell', level: 1, current: 0, maximum: 2, recovery: ['long-rest'] }]);
    expect(result.mutable?.hitDice).toEqual([{ classSourcePath: classPath, denomination: 'd10', current: 0, maximum: 1 }]);
  });

  it('retains spent resources with no recovery on a down-level transaction', () => {
    const previous = structuredClone(saved);
    previous.classProgressions![0]!.targetLevel = 3;
    previous.classHitPoints = [{ classSourcePath: classPath, level: 1, value: 'max' }, { classSourcePath: classPath, level: 2, value: 'avg' }, { classSourcePath: classPath, level: 3, value: 'avg' }];
    const draft = structuredClone(previous);
    draft.classProgressions![0]!.targetLevel = 1;
    draft.classHitPoints = previous.classHitPoints!.slice(0, 1);
    const result = applyCharacterLevelDraft(previous, draft, sources);
    expect(result.classHitPoints).toHaveLength(1);
    expect(result.mutable?.resources.find(({ key }) => key === 'legacy:none')).toBeUndefined();
  });

  it('removes a level-three feature resource and action when lowering to level one', () => {
    const feature = { source: { sourcePath: 'feature/second-wind.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'second-wind', name: 'Second wind' }, advancementId: 'level-three', level: 3, uses: { maximum: 2, recovery: [{ period: 'lr' }] }, activities: [{ id: 'attack', name: 'Feature attack', type: 'attack', attack: { type: 'melee' }, damage: [{ number: 1, denomination: 8, types: ['force'] }], consumption: [] }] };
    const higherSources: CharacterSheetSources = { ...sources, class: { ...fighter, features: [feature] } };
    const higher = structuredClone(saved);
    higher.classProgressions![0]!.targetLevel = 3;
    higher.classHitPoints = [{ classSourcePath: classPath, level: 1, value: 'max' }, { classSourcePath: classPath, level: 2, value: 'avg' }, { classSourcePath: classPath, level: 3, value: 'avg' }];
    higher.mutable!.resources = [{ key: 'feature:feature/second-wind.yml', current: 0, maximum: 2, reset: 'long-rest', recovery: [{ period: 'long-rest', type: 'recover-all' }] }];
    const lower = structuredClone(higher);
    lower.classProgressions![0]!.targetLevel = 1;
    lower.classHitPoints = higher.classHitPoints.slice(0, 1);
    const result = applyCharacterLevelDraft(higher, lower, higherSources);
    expect(result.mutable?.resources).toEqual([]);
    const sheet = projectCharacterSheet(result, higherSources);
    expect(sheet.actions?.groups.flatMap((group) => group.entries).some((entry) => entry.name === 'Feature attack')).toBe(false);
  });

  it('blocks applying when a required source is missing', () => {
    expect(() => applyCharacterLevelDraft(saved, saved, { warnings: [] })).toThrow('Required character source data is unavailable');
  });

  it('seeds only the known level-one maximum while requiring legacy later gains', () => {
    const legacy = structuredClone(saved);
    delete legacy.classHitPoints;
    legacy.classProgressions![0]!.targetLevel = 3;
    const draft = structuredClone(legacy);
    delete draft.classHitPoints;
    expect(() => applyCharacterLevelDraft(legacy, draft, sources)).toThrow('Missing class hit-point entry for level 2.');
  });

  it('rebuilds the mutable sheet for a confirmed ruleset replacement', () => {
    const replacement = structuredClone(saved);
    replacement.ruleset = '2014';
    replacement.origin = { sourcePath: 'packs/_source/races/human.yml', identifier: 'human', id: 'human' };
    const wizardPath = 'packs/_source/classes/wizard/wizard.yml';
    replacement.classProgressions = [{ class: { sourcePath: wizardPath, identifier: 'wizard', id: 'wizard' }, targetLevel: 1, selections: [] }];
    replacement.classHitPoints = [{ classSourcePath: wizardPath, level: 1, value: 'max' }];
    replacement.background = { sourcePath: 'packs/_source/backgrounds/folk-hero.yml', identifier: 'folk-hero', id: 'folk-hero' };
    delete replacement.mutable;
    const resetSources: CharacterSheetSources = {
      warnings: [],
      class: { ...fighter, source: { ...fighter.source, sourcePath: wizardPath, identifier: 'wizard', id: 'wizard', name: 'Wizard' }, ruleset: '2014', hitDie: 'd6' },
      species: { ...species, source: { ...species.source, sourcePath: replacement.origin.sourcePath, identifier: 'human', id: 'human' }, ruleset: '2014' },
      background: { ...background, source: { ...background.source, sourcePath: replacement.background.sourcePath, identifier: 'folk-hero', id: 'folk-hero' }, ruleset: '2014' },
    };
    const result = applyCharacterLevelDraft(saved, replacement, resetSources);
    expect(result.ruleset).toBe('2014');
    expect(result.classHitPoints).toEqual([{ classSourcePath: wizardPath, level: 1, value: 'max' }]);
    expect(result.mutable?.inspiration).toBe(false);
    expect(result.mutable?.resources).toEqual([]);
    expect(result.mutable?.hitPoints?.current).toBe(result.mutable?.hitPoints?.maximum);
  });

  it('rebuilds mutable state for a confirmed class replacement', () => {
    const replacement = structuredClone(saved);
    const wizardPath = 'packs/_source/classes24/wizard/wizard.yml';
    replacement.classProgressions = [{ class: { sourcePath: wizardPath, identifier: 'wizard', id: 'wizard' }, targetLevel: 1, selections: [] }];
    replacement.classHitPoints = [{ classSourcePath: wizardPath, level: 1, value: 'max' }];
    delete replacement.mutable;
    const resetSources: CharacterSheetSources = { ...sources, class: { ...fighter, source: { ...fighter.source, sourcePath: wizardPath, identifier: 'wizard', id: 'wizard', name: 'Wizard' }, hitDie: 'd6' } };
    const result = applyCharacterLevelDraft(saved, replacement, resetSources);
    expect(result.classProgressions?.[0]?.class.sourcePath).toBe(wizardPath);
    expect(result.mutable?.inspiration).toBe(false);
    expect(result.mutable?.resources.some(({ key }) => key.includes(classPath))).toBe(false);
  });

  it('blocks applying a resource whose source maximum or recovery period is unsupported', () => {
    const invalidSource: CharacterSheetSources = { ...sources, class: { ...fighter, features: [{ source: { sourcePath: 'feature/unknown.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'unknown', name: 'Unknown resource' }, advancementId: 'level-one', level: 1, uses: { maximum: '@unsupported', recovery: [{ period: 'custom' }] } }] } };
    expect(() => applyCharacterLevelDraft(saved, saved, invalidSource)).toThrow(/feature\/unknown\.yml.*(maximum|recovery)|maximum.*feature\/unknown\.yml/i);
  });

  it('blocks applying a resource with an unsupported recovery profile type', () => {
    const invalidSource: CharacterSheetSources = {
      ...sources,
      class: { ...fighter, features: [{ source: { sourcePath: 'feature/profile.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'profile', name: 'Profile resource' }, advancementId: 'level-one', level: 1, uses: { maximum: 1, recovery: [{ period: 'lr', type: 'charges' }] } }] },
    };
    expect(() => applyCharacterLevelDraft(saved, saved, invalidSource)).toThrow(/feature\/profile\.yml.*unsupported recovery profile/i);
  });

  it('clamps an existing reset-none resource when its source maximum shrinks', () => {
    const path = 'feature/unchanging.yml';
    const current = structuredClone(saved);
    current.mutable!.resources = [{ key: `feature:${path}`, current: 5, maximum: 5, reset: 'none' }];
    const shrinkingSources: CharacterSheetSources = { ...sources, class: { ...fighter, features: [{ source: { sourcePath: path, pack: 'dnd5e.classfeatures', type: 'feat', id: 'unchanging', name: 'Unchanging' }, advancementId: 'level-one', level: 1, uses: { maximum: 2, recovery: [] } }] } };
    const result = applyCharacterLevelDraft(current, current, shrinkingSources);
    expect(result.mutable?.resources).toEqual([{ key: `feature:${path}`, current: 2, maximum: 2, reset: 'none' }]);
  });

  it('applies the reconciled document through updateIfUnchanged and leaves external edits intact', async () => {
    const files = new Map<string, string>();
    const vault = {
      async createFolder() {}, getFolderByPath() { return null; },
      async create(path: string, data: string) { files.set(path, data); return { path } as TFile; },
      getFileByPath(path: string) { return files.has(path) ? { path } as TFile : null; },
      async read(file: TFile) { return files.get(file.path) ?? ''; },
      async process(file: TFile, transform: (data: string) => string) { const updated = transform(files.get(file.path) ?? ''); files.set(file.path, updated); return updated; },
    };
    const store = new CharacterStore(vault, 'Characters', () => 'character-id');
    const file = await store.create('Ayla', { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' });
    const expected = await store.update(file, () => saved);
    const draft = structuredClone(expected);
    draft.classProgressions![0]!.targetLevel = 2;
    draft.classHitPoints = [{ classSourcePath: classPath, level: 1, value: 'max' }, { classSourcePath: classPath, level: 2, value: 4 }];
    const reconciled = applyCharacterLevelDraft(expected, draft, sources);
    await store.updateIfUnchanged(file, expected, () => reconciled);
    expect(JSON.parse(await vault.read(file)).classHitPoints).toEqual(draft.classHitPoints);
    const appliedExpected = await store.read(file);
    const externallyEdited = { ...appliedExpected, name: 'External edit' };
    await store.update(file, () => externallyEdited);
    const beforeConflict = await vault.read(file);
    await expect(store.updateIfUnchanged(file, appliedExpected, () => reconciled)).rejects.toThrow('changed externally');
    expect(await vault.read(file)).toBe(beforeConflict);
    expect(JSON.parse(await vault.read(file)).name).toBe('External edit');
  });

  it('keeps a spent source-defined reset-none spell use through long-rest recovery', () => {
    const spell = { sourcePath: 'packs/_source/spells24/familiar.yml', pack: 'dnd5e.spells', type: 'spell', id: 'familiar', name: 'Find Familiar' };
    const key = `${spell.sourcePath}:${spell.pack}:${spell.type}:${spell.id}`;
    const sourcesWithSpell: CharacterSheetSources = {
      ...sources,
      species: { ...species, spellGrants: [{ advancementId: 'familiar', level: 1, spells: [spell], abilityOptions: [], raw: { configuration: { spell: { uses: { max: 1, requireSlot: false } } } } }] },
      spellSummaries: new Map([[key, { ...spell, ruleset: '2024', level: 1, spellLists: [], ritual: false, uses: { maximum: 1, recovery: [] } }]]),
    };
    const spent = structuredClone(saved);
    spent.mutable!.spellUses = [{ key, current: 0, maximum: 1, reset: 'none' }];
    const result = applyCharacterLevelDraft(spent, spent, sourcesWithSpell);
    expect(result.mutable?.spellUses).toEqual([{ key, current: 0, maximum: 1, reset: 'none' }]);
  });
});
