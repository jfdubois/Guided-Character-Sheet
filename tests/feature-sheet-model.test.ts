import { describe, expect, it } from 'vitest';
import type { CharacterDocument } from '../src/character-model';
import { projectFeatureSheet, featureResourceKey, type FeatureSheetProjection } from '../src/feature-sheet-model';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from '../src/character-sources';
import type { FoundrySourceReference } from '../src/foundry-source-catalog';

const ref = (sourcePath: string, name: string, type = 'feat'): FoundrySourceReference => ({ sourcePath, pack: 'test', type, id: name.toLowerCase().replaceAll(' ', '-'), name });
const base: CharacterDocument = {
  format: 1, kind: 'guided-character', name: 'Ayla', ruleset: '2024', step: 'background',
  foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'abc123' },
  origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' },
  classProgressions: [{ class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter' }, targetLevel: 2, selections: [] }],
  background: { sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', identifier: 'soldier', id: 'soldier' },
};
const classFeature = (source: FoundrySourceReference, level: number, description?: string) => ({ advancementId: `adv-${level}`, level, source, ...(description === undefined ? {} : { description }), uses: { maximum: 2, recovery: [{ period: 'sr' }] } });
const sources = (): { class: ClassSourceSummary; species: SpeciesSourceSummary; background: BackgroundSourceSummary } => {
  const shared = ref('packs/features/shared.yml', 'Shared feature', 'feat');
  return {
    class: { source: ref('packs/_source/classes24/fighter/fighter.yml', 'Fighter', 'class'), ruleset: '2024', hitDie: 'd10', advancements: [], features: [classFeature(ref('packs/features/second-wind.yml', 'Second Wind', 'feat'), 1, 'Recover quickly.'), classFeature(ref('packs/features/late.yml', 'Late feature', 'feat'), 3), classFeature(shared, 1, 'Class wording.') ] },
    species: { source: ref('packs/_source/origins24/species/elf.yml', 'Elf', 'race'), ruleset: '2024', advancements: [], features: [{ source: shared, level: 1, description: 'Species wording.', advancementId: 'species-1' }] },
    background: { source: ref('packs/_source/origins24/backgrounds/soldier.yml', 'Soldier', 'background'), ruleset: '2024', skills: [], languages: [], languageChoices: [], tools: [], features: [{ advancementId: 'background-1', source: ref('packs/features/feature.yml', 'Military training', 'feat'), description: 'Training.' }], equipment: [], feat: ref('packs/features/tough.yml', 'Tough', 'feat') },
  };
};

describe('feature sheet projection', () => {
  it('uses the granted origin feat source description', () => {
    const data = sources();
    data.background.grantedFeat = { source: data.background.feat!, description: 'Act quickly.', advancements: [] };
    expect(projectFeatureSheet(base, data).groups[3].entries[0]?.description).toEqual({ kind: 'available', value: 'Act quickly.' });
  });
  it('projects every background grant and selected feat description while deduplicating origins', () => {
    const data = sources();
    const alert = ref('packs/feats/alert.yml', 'Alert');
    const tough = data.background.feat!;
    data.background.grantedFeats = [
      { source: alert, description: 'Act first.', advancements: [] },
      { source: tough, description: 'Gain hit points.', advancements: [] },
    ];
    const document = structuredClone(base);
    document.classProgressions![0]!.selections = [{ advancementId: 'feat-choice', kind: 'item', selected: [alert] }];
    data.class.advancements = [{ id: 'feat-choice', type: 'ItemChoice', level: 1, title: 'Choose feat', hint: '', dependencies: [], raw: {} }];
    const result = projectFeatureSheet(document, data);

    expect(result.groups[3].entries.map((entry) => [entry.name, entry.description])).toEqual([
      ['Alert', { kind: 'available', value: 'Act first.' }],
      ['Tough', { kind: 'available', value: 'Gain hit points.' }],
    ]);
    expect(result.groups[3].entries[0]?.origins).toEqual(['Background', 'Class']);
  });

  it('shows selected feats with unavailable source descriptions and excludes choice-pool candidates', () => {
    const data = sources();
    delete data.background.feat;
    data.background.grantedFeats = [];
    const selected = ref('packs/feats/selected.yml', 'Selected feat');
    const pool = ref('packs/feats/pool.yml', 'Pool candidate');
    data.class.advancements = [{ id: 'feat-choice', type: 'ItemChoice', level: 1, title: 'Choose feat', hint: '', dependencies: [{ uuid: 'pool', source: pool }], raw: {} }];
    const document = structuredClone(base);
    document.classProgressions![0]!.selections = [{ advancementId: 'feat-choice', kind: 'item', selected: [selected] }];
    const selectedFeatSummaries = new Map();
    selectedFeatSummaries.set(`${selected.sourcePath}:${selected.pack}:${selected.type}:${selected.id}`, null);

    const result = projectFeatureSheet(document, { ...data, selectedFeatSummaries });

    expect(result.groups[3].entries.map(({ name, description }) => [name, description])).toEqual([
      ['Selected feat', { kind: 'missing', reason: 'Feat source is unavailable.' }],
    ]);
    expect(result.groups[3].entries[0]?.origins).toEqual(['Class']);
    expect(result.groups[3].entries.some(({ name }) => name === 'Pool candidate')).toBe(false);
  });
  it('excludes selected class feat references whose advancement is future or unknown', () => {
    const data = sources();
    delete data.background.feat;
    const eligible = ref('packs/feats/eligible.yml', 'Eligible feat');
    const future = ref('packs/feats/future.yml', 'Future feat');
    const stale = ref('packs/feats/stale.yml', 'Stale feat');
    data.class.advancements = [
      { id: 'level-one-choice', type: 'ItemChoice', level: 1, title: 'Level one', hint: '', dependencies: [], raw: {} },
      { id: 'secondary-choice', type: 'ItemChoice', level: 1, title: 'Secondary class', hint: '', classRestriction: 'secondary', dependencies: [], raw: {} },
      { id: 'level-five-choice', type: 'ItemChoice', level: 5, title: 'Level five', hint: '', dependencies: [], raw: {} },
    ];
    const document = structuredClone(base);
    document.classProgressions![0]!.targetLevel = 1;
    document.classProgressions![0]!.selections = [
      { advancementId: 'level-one-choice', kind: 'item', selected: [eligible] },
      { advancementId: 'secondary-choice', kind: 'item', selected: [ref('packs/feats/secondary.yml', 'Secondary feat')] },
      { advancementId: 'level-five-choice', kind: 'item', selected: [future] },
      { advancementId: 'removed-choice', kind: 'item', selected: [stale] },
    ];
    const selectedFeatSummaries = new Map([[`${eligible.sourcePath}:${eligible.pack}:${eligible.type}:${eligible.id}`, { source: eligible, description: 'Eligible description.', advancements: [] }]]);

    const result = projectFeatureSheet(document, { ...data, selectedFeatSummaries });

    expect(result.groups[3].entries.map((entry) => entry.name)).toEqual(['Eligible feat']);
  });
  it('retains a saved background feat reference when the background source is unavailable', () => {
    const document = structuredClone(base);
    const feat = ref('packs/feats/saved.yml', 'Saved feat');
    document.backgroundChoices = { grantedFeat: { feat, spellChoices: [] } };

    const result = projectFeatureSheet(document, { class: sources().class, species: sources().species });

    expect(result.groups[3].entries).toContainEqual(expect.objectContaining({
      name: 'Saved feat',
      source: { kind: 'available', value: feat },
      description: { kind: 'missing', reason: 'Feat source is unavailable.' },
      origins: ['Background'],
    }));
  });
  it('groups, filters by level, deduplicates references, and combines origins', () => {
    const result = projectFeatureSheet(base, sources());
    expect(result.groups.map((group) => group.category)).toEqual(['class', 'species', 'background', 'feats']);
    expect(result.groups[0].entries.map((entry) => entry.name)).toEqual(['Second Wind', 'Shared feature']);
    expect(result.groups[0].entries.find((entry) => entry.name === 'Late feature')).toBeUndefined();
    expect(result.groups[1].entries).toHaveLength(0);
    expect(result.groups[0].entries.find((entry) => entry.name === 'Shared feature')?.origins).toEqual(['Class', 'Species']);
    expect(result.groups[3].entries[0]?.name).toBe('Tough');
  });

  it('preserves descriptions and activities, and matches only stable resource keys', () => {
    const data = sources();
    data.class.features![0]!.activities = [{ id: 'recover', name: 'Recover', type: 'action', consumption: [], uses: { maximum: 1, recovery: [{ period: 'lr' }] } }];
    const sourcePath = data.class.features![0]!.source.sourcePath;
    const document = structuredClone(base);
    document.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [{ key: featureResourceKey(sourcePath), current: 1, maximum: 2, reset: 'short-rest' }, { key: `feature:${sourcePath}:activity:recover`, current: 0, maximum: 1, reset: 'long-rest' }] };
    const result: FeatureSheetProjection = projectFeatureSheet(document, data);
    const entry = result.groups[0].entries.find((row) => row.name === 'Second Wind')!;
    expect(entry.description).toEqual({ kind: 'available', value: 'Recover quickly.' });
    expect(entry.activities[0]?.name).toBe('Recover');
    expect(entry.activities[0]?.resource).toMatchObject({ key: `feature:${sourcePath}:activity:recover`, current: { kind: 'available', value: 0 }, maximum: { kind: 'available', value: 1 }, reset: { kind: 'available', value: 'long-rest' } });
    expect(entry.resource).toMatchObject({ key: featureResourceKey(sourcePath), current: { kind: 'available', value: 1 }, maximum: { kind: 'available', value: 2 } });
    const legacy = projectFeatureSheet({ ...document, mutable: { ...document.mutable, resources: [{ key: 'Second Wind', current: 1, maximum: 2, reset: 'short-rest' }] } }, data);
    expect(legacy.groups[0].entries.find((row) => row.name === 'Second Wind')?.resource?.current.kind).toBe('missing');
  });

  it('reports absent sources without dropping groups from available sources', () => {
    const result = projectFeatureSheet(base, { class: sources().class });
    expect(result.warnings).toEqual(expect.arrayContaining(['Species feature source is unavailable.', 'Background feature source is unavailable.']));
    expect(result.groups[0].entries.map(({ name }) => name)).toContain('Second Wind');
    expect(result.groups[1].entries).toEqual([]);
    expect(result.groups[2].entries).toEqual([]);
  });

  it('surfaces unsupported stable species effect changes as source warnings', () => {
    const data = sources();
    data.species.features!.push({ source: ref('packs/features/test-effect.yml', 'Test Effect'), level: 1, automatic: true, effectDiagnostics: ['Unsupported stable effect change from Test Effect: system.attributes.ac.bonus.'] });

    expect(projectFeatureSheet(base, data).warnings).toContain(
      'Unsupported stable effect change from Test Effect: system.attributes.ac.bonus.',
    );
  });

  it('only reports effect diagnostics from level-eligible, entitled species features', () => {
    const data = sources();
    data.species.features = [
      { source: ref('packs/features/eligible.yml', 'Eligible effect'), level: 1, automatic: true, effectDiagnostics: ['Eligible diagnostic.'] },
      { source: ref('packs/features/future.yml', 'Future effect'), level: 5, automatic: true, effectDiagnostics: ['Future diagnostic.'] },
      { source: ref('packs/features/unselected.yml', 'Unselected effect'), level: 1, selection: { key: 'species:ancestry', value: 'unselected' }, effectDiagnostics: ['Unselected diagnostic.'] },
    ];

    const result = projectFeatureSheet(base, data);

    expect(result.warnings).toContain('Eligible diagnostic.');
    expect(result.warnings).not.toContain('Future diagnostic.');
    expect(result.warnings).not.toContain('Unselected diagnostic.');
    expect(result.groups[1].entries.map((entry) => entry.name)).toEqual(['Eligible effect']);
  });

  it('does not expose future automatic features when character level is unavailable', () => {
    const data = sources();
    data.species.features = [{ source: ref('packs/features/future.yml', 'Future effect'), level: 5, automatic: true, effectDiagnostics: ['Future diagnostic.'] }];

    const result = projectFeatureSheet({ ...base, classProgressions: [] }, data);

    expect(result.groups[1].entries).toEqual([]);
    expect(result.warnings).not.toContain('Future diagnostic.');
  });

  it('accepts a shared feature when any source grant is entitled without grant-order leakage', () => {
    const data = sources();
    const shared = ref('packs/features/shared-entitlement.yml', 'Shared entitlement');
    data.species.features = [{
      source: shared,
      level: 1,
      automatic: true,
      entitlements: [
        { level: 5, automatic: true, advancementId: 'future' },
        { level: 1, selection: { key: 'species:ancestry', value: 'selected' }, advancementId: 'choice' },
      ],
    }];
    const document = structuredClone(base);
    document.speciesConfiguration = {
      origin: { ...document.origin! }, foundry: { ...document.foundry }, grants: [], spellChoices: [],
      choices: [{ key: 'species:ancestry', source: { id: 'ancestry', type: 'ItemChoice' }, selected: ['selected'] }],
    };

    expect(projectFeatureSheet(document, data).groups[1].entries.map((entry) => entry.name)).toEqual(['Shared entitlement']);
    data.species.features[0]!.entitlements!.reverse();
    expect(projectFeatureSheet(document, data).groups[1].entries.map((entry) => entry.name)).toEqual(['Shared entitlement']);
  });

  it('does not claim source maximum is current when mutable state is absent and does not mutate', () => {
    const document = structuredClone(base);
    const before = structuredClone(document);
    const result = projectFeatureSheet(document, sources());
    const row = result.groups[0].entries[0]!;
    expect(row.resource?.maximum).toEqual({ kind: 'available', value: 2 });
    expect(row.resource?.current).toEqual({ kind: 'missing', reason: 'Current resource value is unavailable.' });
    expect(document).toEqual(before);
  });

  it('displays the persisted numeric maximum instead of a Foundry resource formula', () => {
    const data = sources();
    data.species.features = [{
      advancementId: 'breath',
      level: 1,
      source: ref('packs/features/breath-weapon.yml', 'Breath Weapon'),
      uses: { maximum: '@prof', recovery: [{ period: 'lr' }] },
    }];
    const document = structuredClone(base);
    document.mutable = {
      preparedSpells: [],
      inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      equipmentStatus: [],
      resources: [{ key: featureResourceKey('packs/features/breath-weapon.yml'), current: 2, maximum: 2, reset: 'long-rest' }],
    };

    const entry = projectFeatureSheet(document, data).groups[1].entries[0];

    expect(entry?.resource?.maximum).toEqual({ kind: 'available', value: 2 });
  });

  it('ignores a stale saved activity resource when source recovery is empty', () => {
    const data = sources();
    const sourcePath = 'packs/features/sneak-attack.yml';
    data.class.features = [{ advancementId: 'sneak-attack', level: 1, source: ref(sourcePath, 'Sneak Attack'), activities: [{ id: 'attack', type: 'damage', consumption: [], uses: { maximum: '1', recovery: [] } }] }];
    const document = structuredClone(base);
    document.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [{ key: `feature:${sourcePath}:activity:attack`, current: 1, maximum: 1, reset: 'none' }] };

    const activity = projectFeatureSheet(document, data).groups[0].entries[0]?.activities[0];

    expect(activity?.resource).toBeUndefined();
  });

  it('projects rest-backed features whose maximum is a Foundry scale reference', () => {
    const data = sources();
    data.class.features = [{
      advancementId: 'second-wind',
      level: 1,
      source: ref('packs/features/second-wind.yml', 'Second Wind'),
      uses: { maximum: '@scale.fighter.second-wind', recovery: [{ period: 'sr' }] },
    }];

    const entry = projectFeatureSheet(base, data).groups[0].entries[0];

    expect(entry?.resource?.maximum).toEqual({ kind: 'available', value: '@scale.fighter.second-wind' });
  });

  it('projects resolved damage for an activity using its owning class and progression level', () => {
    const data = sources();
    data.class.source.identifier = 'rogue';
    data.class.scales = [{ advancementId: 'sneak-attack', title: 'Sneak Attack', identifier: 'sneak-attack', level: 1, values: new Map([[1, { type: 'dice', number: 1, faces: 6, modifiers: [] }], [3, { type: 'dice', number: 2, faces: 6, modifiers: [] }]]), diagnostics: [] }];
    data.class.features = [{ advancementId: 'sneak-attack', level: 1, source: ref('packs/features/sneak-attack.yml', 'Sneak Attack'), activities: [{ id: 'attack', type: 'damage', consumption: [], damage: [{ customFormula: '@scale.rogue.sneak-attack', types: ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] }] }] }];
    const document = { ...base, classProgressions: [{ ...base.classProgressions![0]!, class: { ...base.classProgressions![0]!.class, identifier: 'rogue' }, targetLevel: 3 }] };
    const original = structuredClone(data.class.features);

    const activity = projectFeatureSheet(document, data).groups[0].entries[0]?.activities[0];

    expect(activity?.resolvedDamage).toBe('2d6');
    expect(data.class.features).toEqual(original);
  });

  it('projects Dragonborn species scale damage with the selected resistance type', () => {
    const data = sources();
    data.species.source.identifier = 'dragonborn';
    data.species.scales = [{ advancementId: 'breath-scale', title: 'Breath Weapon', identifier: 'breath', level: 0, values: new Map([[0, { type: 'dice', number: 1, faces: 10, modifiers: [] }], [5, { type: 'dice', number: 2, faces: 10, modifiers: [] }]]), diagnostics: [] }];
    data.species.features = [{ advancementId: 'breath', level: 0, automatic: true, source: ref('packs/features/breath-weapon.yml', 'Breath Weapon'), activities: [{ id: 'cone', name: 'Breath Weapon (Cone)', type: 'save', activation: { type: 'action' }, consumption: [], damage: [{ customFormula: '@scale.dragonborn.breath', types: ['acid', 'cold', 'fire', 'lightning', 'poison'] }, { customFormula: '@scale.dragonborn.breath', types: ['radiant'] }] }] }];
    const document = { ...base, origin: { ...base.origin!, identifier: 'dragonborn' }, speciesConfiguration: { origin: { ...base.origin!, identifier: 'dragonborn' }, foundry: base.foundry, grants: [], choices: [{ key: 'species:ancestry', source: { id: 'ancestry', type: 'Trait' }, selected: ['dr:fire'] }], spellChoices: [] } };
    const activity = projectFeatureSheet(document, data).groups[1].entries[0]?.activities[0];
    expect(activity?.resolvedDamage).toBe('1d10 fire, 1d10 radiant');
  });

  it('preserves unsupported feature description lookups without evaluating their expressions', () => {
    const data = sources();
    data.class.features = [{
      advancementId: 'lookups', level: 1, source: ref('packs/features/lookups.yml', 'Lookups'),
      description: 'Valid [[lookup @scale.fighter.second-wind]]; wrong owner [[lookup @scale.rogue.second-wind]]; expression [[lookup @scale.fighter.second-wind + 1]].',
    }];
    data.class.scales = [{ advancementId: 'uses', title: 'Second Wind', identifier: 'second-wind', level: 1, values: new Map([[1, { type: 'number', value: 2 }]]), diagnostics: [] }];

    const entry = projectFeatureSheet(base, data).groups[0].entries[0];

    expect(entry?.description).toEqual({ kind: 'available', value: 'Valid 2; wrong owner [[lookup @scale.rogue.second-wind]]; expression [[lookup @scale.fighter.second-wind + 1]].' });
  });

  it('keeps unsupported custom damage visible as a feature diagnostic', () => {
    const data = sources();
    data.class.source.identifier = 'rogue';
    data.class.features = [{ advancementId: 'sneak-attack', level: 1, source: ref('packs/features/sneak-attack.yml', 'Sneak Attack'), activities: [{ id: 'attack', type: 'damage', consumption: [], damage: [{ customFormula: '@scale.rogue.sneak-attack + @mod', types: ['piercing'] }] }] }];

    const entry = projectFeatureSheet(base, data).groups[0].entries[0];

    expect(entry?.activities[0]?.resolvedDamage).toBeUndefined();
    expect(entry?.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining('@scale.rogue.sneak-attack + @mod')]));
  });

  it('resolves a proficiency-based maximum for an existing character missing persisted resource state', () => {
    const data = sources();
    data.species.features = [{
      advancementId: 'breath',
      level: 1,
      source: ref('packs/features/breath-weapon.yml', 'Breath Weapon'),
      uses: { maximum: '@prof', recovery: [{ period: 'lr' }] },
    }];

    const entry = projectFeatureSheet(base, data).groups[1].entries[0];

    expect(entry?.resource?.maximum).toEqual({ kind: 'available', value: 2 });
    expect(entry?.resource?.current.kind).toBe('missing');

    const levelFive = { ...base, classProgressions: [{ ...base.classProgressions![0]!, targetLevel: 5 }] };
    expect(projectFeatureSheet(levelFive, data).groups[1].entries[0]?.resource?.maximum).toEqual({ kind: 'available', value: 3 });
  });

  it('excludes a level-5 automatic species feature for a level-1 character', () => {
    const data = sources();
    data.species.features = [{ advancementId: 'future', level: 5, automatic: true, source: ref('packs/features/future.yml', 'Future trait') }];
    const document = { ...base, classProgressions: [{ ...base.classProgressions![0]!, targetLevel: 1 }] };

    expect(projectFeatureSheet(document, data).groups[1].entries).toEqual([]);
  });

  it('includes a level-5 automatic species feature for a level-5 character', () => {
    const data = sources();
    data.species.features = [{ advancementId: 'future', level: 5, automatic: true, source: ref('packs/features/future.yml', 'Future trait') }];
    const document = { ...base, classProgressions: [{ ...base.classProgressions![0]!, targetLevel: 5 }] };

    expect(projectFeatureSheet(document, data).groups[1].entries.map((entry) => entry.name)).toEqual(['Future trait']);
  });

  it('sums multiclass target levels for species level eligibility', () => {
    const data = sources();
    data.species.features = [{ advancementId: 'future', level: 5, automatic: true, source: ref('packs/features/future.yml', 'Future trait') }];
    const document = {
      ...base,
      classProgressions: [
        { ...base.classProgressions![0]!, targetLevel: 2 },
        { ...base.classProgressions![0]!, class: { ...base.classProgressions![0]!.class, sourcePath: 'packs/_source/classes24/wizard/wizard.yml' }, targetLevel: 3 },
      ],
    };

    expect(projectFeatureSheet(document, data).groups[1].entries.map((entry) => entry.name)).toEqual(['Future trait']);
  });

  it('includes a selected non-automatic species feature from persisted configuration', () => {
    const data = sources();
    data.species.features = [{ advancementId: 'ancestry', level: 1, source: ref('packs/features/chosen.yml', 'Chosen feature'), selection: { key: 'species:ancestry', value: 'Compendium.dnd5e.races.Item.chosenFeature' } }];
    const document = structuredClone(base);
    document.speciesConfiguration = {
      origin: { ...document.origin! },
      foundry: { ...document.foundry },
      grants: [],
      choices: [{
        key: 'species:ancestry',
        source: { id: 'ancestry', type: 'ItemChoice' },
        selected: ['Compendium.dnd5e.races.Item.chosenFeature'],
      }],
      spellChoices: [],
    };

    expect(projectFeatureSheet(document, data).groups[1].entries.map((entry) => entry.name)).toEqual(['Chosen feature']);
  });

  it('excludes an unselected non-automatic species feature', () => {
    const data = sources();
    data.species.features = [{ advancementId: 'ancestry', level: 1, source: ref('packs/features/unchosen.yml', 'Unchosen feature'), selection: { key: 'species:ancestry', value: 'Compendium.dnd5e.races.Item.unchosenFeature' } }];
    const document = structuredClone(base);
    document.speciesConfiguration = {
      origin: { ...document.origin! },
      foundry: { ...document.foundry },
      grants: [],
      choices: [{ key: 'species:ancestry', source: { id: 'ancestry', type: 'ItemChoice' }, selected: ['Compendium.dnd5e.races.Item.otherFeature'] }],
      spellChoices: [],
    };

    expect(projectFeatureSheet(document, data).groups[1].entries).toEqual([]);
  });

  it('requires an explicit selection even when a conditional species feature is automatic', () => {
    const data = sources();
    data.species.features = [{ advancementId: 'ancestry', level: 1, automatic: true, source: ref('packs/features/conditional.yml', 'Conditional feature'), selection: { key: 'species:ancestry', value: 'Compendium.dnd5e.races.Item.conditionalFeature' } }];
    const document = structuredClone(base);
    document.speciesConfiguration = {
      origin: { ...document.origin! },
      foundry: { ...document.foundry },
      grants: [],
      choices: [{ key: 'species:ancestry', source: { id: 'ancestry', type: 'ItemChoice' }, selected: [] }],
      spellChoices: [],
    };

    expect(projectFeatureSheet(document, data).groups[1].entries).toEqual([]);
  });

  it('retains legacy species eligibility without configuration after level filtering', () => {
    const data = sources();
    data.species.features = [
      { advancementId: 'available', level: 1, source: ref('packs/features/available.yml', 'Available trait') },
      { advancementId: 'future', level: 5, source: ref('packs/features/future.yml', 'Future trait') },
    ];
    const document = { ...base, classProgressions: [{ ...base.classProgressions![0]!, targetLevel: 1 }] };

    expect(projectFeatureSheet(document, data).groups[1].entries.map((entry) => entry.name)).toEqual(['Available trait']);
  });

  it('uses the owning class progression level for class feature eligibility', () => {
    const data = sources();
    data.class.features = [classFeature(ref('packs/features/second-level.yml', 'Second-level feature'), 2)];
    const document = {
      ...base,
      classProgressions: [
        { ...base.classProgressions![0]!, class: { ...base.classProgressions![0]!.class, sourcePath: 'packs/_source/classes24/wizard/wizard.yml' }, targetLevel: 5 },
        { ...base.classProgressions![0]!, targetLevel: 1 },
      ],
    };

    expect(projectFeatureSheet(document, data).groups[0].entries).toEqual([]);
  });
});
