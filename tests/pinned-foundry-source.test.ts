import { describe, expect, it } from 'vitest';
import { createPinnedFoundryAdapter, createPinnedSourceIndex, PINNED_FOUNDRY_ROOT } from './support/pinned-foundry-source';
import { projectActionSheet } from '../src/action-sheet-model';
import type { CharacterDocument } from '../src/character-model';
import { projectFeatureSheet } from '../src/feature-sheet-model';
import { calculateAbilityScores } from '../src/ability-scores';

describe('pinned Foundry source adapter', () => {
  it('indexes the pinned 2024 source family', async () => {
    const adapter = createPinnedFoundryAdapter();
    await expect(adapter.exists(PINNED_FOUNDRY_ROOT)).resolves.toBe(true);
    await expect(createPinnedSourceIndex().listSpecies('2024')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Dragonborn' })]),
    );
  });

  it('projects the pinned level-one fixed spell grants for every lineage variant', async () => {
    const index = createPinnedSourceIndex();
    const cases = [
      ['elf-drow', ['phbsplDancingLig'], ['int', 'wis', 'cha'], 1, 3],
      ['elf-high', ['phbsplPrestidigi'], ['int', 'wis', 'cha'], 1, 3],
      ['elf-wood', ['phbsplDruidcraft'], [], 1, 3],
      ['gnome-forest', ['phbsplSpeakwithA', 'phbsplMinorIllus'], ['int', 'wis', 'cha'], 2, 0],
      ['gnome-rock', ['phbsplMending000', 'phbsplPrestidigi'], ['int', 'wis', 'cha'], 1, 0],
      ['tiefling-abyssal', ['phbsplPoisonSpra', 'phbsplThaumaturg'], ['int', 'wis', 'cha'], 2, 5],
      ['tiefling-chthonic', ['phbsplThaumaturg', 'phbsplChillTouch'], ['int', 'wis', 'cha'], 2, 5],
      ['tiefling-infernal', ['phbsplThaumaturg', 'phbsplFireBolt00'], ['int', 'wis', 'cha'], 2, 5],
    ] as const;
    for (const [identifier, levelOneSpellIds, abilityOptions, eligibleGrantCount, maximumLevel] of cases) {
      const summary = await index.getSpeciesSummary('2024', `packs/_source/origins24/species/${identifier}.yml`);
      const grants = summary.spellGrants ?? [];
      expect(grants.length).toBeGreaterThan(0);
      expect(grants.flatMap((grant) => grant.spells.map((spell) => spell.id))).toEqual(expect.arrayContaining([...levelOneSpellIds]));
      const eligible = grants.filter((grant) => grant.level <= 1);
      expect(eligible).toHaveLength(eligibleGrantCount);
      expect(eligible.flatMap((grant) => grant.spells.map((spell) => spell.id))).toEqual(expect.arrayContaining([...levelOneSpellIds]));
      if (identifier === 'gnome-rock') expect(eligible.find((grant) => grant.spells.length === 2)?.spells).toHaveLength(2);
      if (identifier === 'gnome-forest') expect(eligible.find((grant) => grant.spells.some((spell) => spell.id === 'phbsplSpeakwithA'))?.uses).toEqual({ max: '@prof', per: 'lr', requireSlot: false });
      if (identifier.startsWith('tiefling-')) expect(eligible.some((grant) => grant.preparation === '')).toBe(true);
      expect(eligible.find((grant) => grant.abilityOptions.length > 0)?.abilityOptions ?? []).toEqual(abilityOptions.map((ability) => ability === 'int' ? 'Intelligence' : ability === 'wis' ? 'Wisdom' : 'Charisma'));
      expect(grants.some((grant) => grant.level > 1)).toBe(maximumLevel > 1);
    }
  });

  it('preserves always-prepared modes for representative 2024 cantrips', async () => {
    const spells = await createPinnedSourceIndex().searchSpells({ ruleset: '2024', level: 0 });
    const byName = new Map(spells.map((spell) => [spell.name, spell]));
    expect(byName.get('Light')?.preparation).toBe('always');
    expect(byName.get('Dancing Lights')?.preparation).toBe('always');
  });

  it('reports a missing pinned root instead of returning an empty audit', async () => {
    const missingRoot = '/definitely-missing-character-sheet-source';
    const adapter = createPinnedFoundryAdapter(missingRoot);
    await expect(adapter.list(missingRoot)).rejects.toThrow(missingRoot);
  });

  it.each(['2014', '2024'] as const)('projects pinned %s Rogue Sneak Attack as at-will 1d6 damage', async (ruleset) => {
    const index = createPinnedSourceIndex();
    const rogue = (await index.listClasses(ruleset)).find((candidate) => candidate.name.toLowerCase().includes('rogue'));
    if (rogue === undefined) throw new Error(`Pinned ${ruleset} Rogue class was not found`);
    const classSummary = await index.getClassSummary(ruleset, rogue.sourcePath);
    const document: CharacterDocument = {
      format: 1, kind: 'guided-character', name: 'Rogue', ruleset, step: 'background',
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
      classProgressions: [{ class: { sourcePath: rogue.sourcePath, identifier: rogue.identifier ?? '', id: rogue.id }, targetLevel: 1, selections: [] }],
      mutable: { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] },
    };
    const features = projectFeatureSheet(document, { class: classSummary });
    const sneakAttack = features.groups.flatMap((group) => group.entries).find((entry) => entry.name === 'Sneak Attack');
    expect(sneakAttack).toBeDefined();
    if (ruleset === '2024') {
      expect(sneakAttack?.diagnostics).not.toEqual(expect.arrayContaining([expect.stringContaining('denomination must be a number')]));
      expect(sneakAttack?.description).toMatchObject({ kind: 'available', value: expect.stringContaining('Current Sneak Attack Damage: 1d6') });
      expect(sneakAttack?.description.kind === 'available' ? sneakAttack.description.value : '').not.toContain('[[lookup');
    }
    const activity = sneakAttack?.activities.find((candidate) => candidate.name?.includes('Sneak Attack')) ?? sneakAttack?.activities[0];
    expect(activity).toBeDefined();
    const result = projectActionSheet(document, { proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [], featureActivities: [{ sourceName: 'Sneak Attack', activity: activity! }] });
    const action = result.groups.find(({ key }) => key === 'at-will')?.entries[0];
    expect(action).toMatchObject({ name: activity?.name ?? 'Sneak Attack', damage: '1d6' });
    expect(action?.resource).toBeUndefined();
    expect(result.groups.find(({ key }) => key === 'limited-use')?.entries).toEqual([]);
    if (ruleset === '2024') {
      expect(activity?.uses).toEqual({ maximum: '1', recovery: [] });
      expect(activity?.resource).toBeUndefined();
    }
  });

  it('resolves pinned 2024 Rogue Sneak Attack lookups at the selected higher class level', async () => {
    const index = createPinnedSourceIndex();
    const rogue = (await index.listClasses('2024')).find((candidate) => candidate.name.toLowerCase().includes('rogue'));
    if (rogue === undefined) throw new Error('Pinned 2024 Rogue class was not found');
    const classSummary = await index.getClassSummary('2024', rogue.sourcePath);
    const document: CharacterDocument = {
      format: 1, kind: 'guided-character', name: 'Rogue', ruleset: '2024', step: 'background',
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
      classProgressions: [{ class: { sourcePath: rogue.sourcePath, identifier: rogue.identifier ?? '', id: rogue.id }, targetLevel: 5, selections: [] }],
      mutable: { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] },
    };
    const features = projectFeatureSheet(document, { class: classSummary });
    const sneakAttack = features.groups.flatMap((group) => group.entries).find((entry) => entry.name === 'Sneak Attack');

    expect(sneakAttack?.description).toMatchObject({ kind: 'available', value: expect.stringContaining('Current Sneak Attack Damage: 3d6') });
  });

  it('projects the pinned 2024 Dragonborn Breath Weapon into authoritative action metadata', async () => {
    const index = createPinnedSourceIndex();
    const species = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/dragonborn.yml');
    const bard = (await index.listClasses('2024')).find((candidate) => candidate.name === 'Bard');
    if (bard === undefined) throw new Error('Pinned 2024 Bard class was not found');
    const classSummary = await index.getClassSummary('2024', bard.sourcePath);
    const origin = { sourcePath: species.source.sourcePath, identifier: species.source.identifier ?? 'dragonborn', id: species.source.id };
    const document: CharacterDocument = {
      format: 1,
      kind: 'guided-character',
      name: 'Dragonborn Bard',
      ruleset: '2024',
      step: 'background',
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
      origin,
      speciesConfiguration: {
        origin,
        foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
        grants: [],
        choices: [{ key: 'species:ancestry', source: { id: 'ancestry', type: 'Trait' }, selected: ['dr:fire'] }],
        spellChoices: [],
      },
      classProgressions: [{ class: { sourcePath: bard.sourcePath, identifier: bard.identifier ?? 'bard', id: bard.id }, targetLevel: 1, selections: [] }],
      abilityScores: { method: 'standard-array', base: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
      mutable: { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] },
    };
    const breathSource = species.features?.find((feature) => feature.source.name === 'Breath Weapon');
    expect(breathSource).toBeDefined();
    if (breathSource === undefined) throw new Error('Pinned 2024 Dragonborn Breath Weapon was not found');
    document.mutable!.resources = [{ key: `feature:${breathSource.source.sourcePath}`, current: 2, maximum: 2, reset: 'long-rest' }];

    const abilityResults = calculateAbilityScores(document.abilityScores!);
    const features = projectFeatureSheet(document, { class: classSummary, species });
    const breath = features.groups.flatMap((group) => group.entries).find((entry) => entry.name === 'Breath Weapon');
    expect(breath?.activities).toHaveLength(2);
    const actions = projectActionSheet(document, {
      abilityResults,
      proficiencyBonus: { kind: 'available', value: 2 },
      weaponTraining: [],
      featureActivities: breath?.activities.map((activity) => ({ sourceName: breath.name, activity })) ?? [],
    });
    const breathActions = actions.groups.flatMap((group) => group.entries).filter((entry) => entry.name.startsWith('Breath Weapon'));
    expect(breathActions).toHaveLength(2);
    expect(breathActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Breath Weapon (Cone)',
        factKind: 'save',
        range: 'Self; 15 ft. cone',
        saveAbility: 'dex',
        saveDc: { kind: 'available', value: 11 },
        damage: '1d10 fire',
        target: expect.objectContaining({ template: { type: 'cone', size: '15', units: 'ft' } }),
        resourceKey: `feature:${breathSource.source.sourcePath}`,
        resource: { current: { kind: 'available', value: 2 }, maximum: { kind: 'available', value: 2 }, reset: { kind: 'available', value: 'long-rest' } },
      }),
      expect.objectContaining({
        name: 'Breath Weapon (Line)',
        factKind: 'save',
        range: 'Self; 30 ft. line (5 ft. wide)',
        saveAbility: 'dex',
        saveDc: { kind: 'available', value: 11 },
        damage: '1d10 fire',
        target: expect.objectContaining({ template: { type: 'line', size: '30', width: '5', units: 'ft' } }),
        resourceKey: `feature:${breathSource.source.sourcePath}`,
        resource: { current: { kind: 'available', value: 2 }, maximum: { kind: 'available', value: 2 }, reset: { kind: 'available', value: 'long-rest' } },
      }),
    ]));
    expect(actions.groups.find((group) => group.key === 'limited-use')?.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Breath Weapon (Cone)', 'Breath Weapon (Line)']));
  });

  it.each([
    ['Animal Friendship', 'wis'],
    ['Bane', 'cha'],
    ['Charm Person', 'wis'],
  ] as const)('projects pinned 2024 %s spell saves without inventing damage', async (name, saveAbility) => {
    const index = createPinnedSourceIndex();
    const spell = (await index.searchSpells({ ruleset: '2024', query: name })).find((candidate) => candidate.name === name);
    if (spell === undefined) throw new Error(`Pinned 2024 ${name} spell was not found`);
    const result = projectActionSheet(documentForPinnedSpell(), {
      spellRows: [{ name: spell.name, level: spell.level, source: { kind: 'available', value: spell }, prepared: { kind: 'available', value: true } }],
      spellAttackBonus: { kind: 'available', value: 5 },
      spellSaveDc: { kind: 'available', value: 13 },
      proficiencyBonus: { kind: 'available', value: 2 },
      weaponTraining: [],
    });
    const action = result.groups.find(({ key }) => key === 'actions')?.entries.find((entry) => entry.name === name);
    expect(action).toMatchObject({ name, factKind: 'save', range: '30 ft.', saveAbility, saveDc: { kind: 'available', value: 13 } });
    expect(action?.damage).toBeUndefined();
    expect(action?.diagnostics).not.toEqual(expect.arrayContaining([expect.stringContaining('unsupported')]));
  });
});

function documentForPinnedSpell(): CharacterDocument {
  return {
    format: 1,
    kind: 'guided-character',
    name: 'Pinned spell test',
    ruleset: '2024',
    step: 'background',
    foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
    mutable: { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] },
  };
}
