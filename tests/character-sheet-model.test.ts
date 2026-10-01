import { describe, expect, it } from 'vitest';
import type { AbilityScoreSelection } from '../src/ability-scores';
import { projectCharacterSheet } from '../src/character-sheet-model';
import type { CharacterDocument } from '../src/character-model';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from '../src/character-sources';
import type { FoundryItemSummary, FoundrySourceReference } from '../src/foundry-source-catalog';

const abilityScores: AbilityScoreSelection = {
  method: 'standard-array',
  base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
};

const document: CharacterDocument = {
  format: 1,
  kind: 'guided-character',
  name: 'Ayla',
  ruleset: '2024',
  step: 'background',
  foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'abc123' },
  origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' },
  classProgressions: [{
    class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' },
    targetLevel: 1,
    selections: [],
  }],
  background: { sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', identifier: 'soldier', id: 'soldier-id' },
  backgroundChoices: { languages: ['languages:common'] },
  abilityScores,
};

const species: SpeciesSourceSummary = {
  source: { sourcePath: document.origin!.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', identifier: 'elf', name: 'Elf' },
  ruleset: '2024',
  movement: { walk: 30, units: 'ft' },
  senses: { darkvision: 60, units: 'ft' },
  advancements: [],
};

const fighter: ClassSourceSummary = {
  source: { sourcePath: document.classProgressions![0].class.sourcePath, pack: 'dnd5e.classes24', type: 'class', id: 'fighter-id', identifier: 'fighter', name: 'Fighter' },
  ruleset: '2024',
  hitDie: 'd10',
  proficiencies: {
    armor: ['armor:lgt', 'armor:med'],
    weapons: ['weapon:sim'],
    tools: [],
    savingThrows: ['saves:str', 'saves:con'],
    languages: [],
    skills: ['skills:ath'],
    choices: [],
  },
  advancements: [],
};

const soldier: BackgroundSourceSummary = {
  source: { sourcePath: document.background!.sourcePath, pack: 'dnd5e.backgrounds24', type: 'background', id: 'soldier-id', identifier: 'soldier', name: 'Soldier' },
  ruleset: '2024',
  abilityScores: { fixed: { str: 1 } },
  skills: ['skills:prc'],
  languages: ['languages:common'],
  languageChoices: [],
  tools: ['tool:gaming'],
  features: [],
  equipment: [],
};

describe('character sheet projection', () => {
  it('shows concrete tool selections and omits category or wildcard selectors', () => {
    const sheet = projectCharacterSheet(document, {
      species,
      class: { ...fighter, proficiencies: { ...fighter.proficiencies!, tools: ['tools:art:calligrapher', 'tool:gaming:*'] } },
      background: { ...soldier, tools: ['tool:music:lyre', 'tool:artisan:mystery'] },
      toolLabels: new Map([
        ['tool:art:calligrapher', "Calligrapher's supplies"],
        ['tool:music:lyre', 'Lyre'],
      ]),
      warnings: [],
    });
    expect(sheet.training.find(({ label }) => label === 'Tools')).toEqual({ label: 'Tools', values: { kind: 'available', value: ["Calligrapher's supplies", 'Lyre', 'Mystery'] } });
  });

  it('routes only entitled feature activities to Actions while retaining the static combat reference', () => {
    const featureActivity = (id: string, name: string) => ({ id, name, type: 'save', activation: { type: 'action' }, consumption: [] });
    const source = { ...species, features: [
      { source: { sourcePath: 'breath.yml', pack: 'dnd5e.origins24', type: 'feat' as const, id: 'breath', identifier: 'breath-weapon', name: 'Breath Weapon' }, level: 1, automatic: true, description: 'Exhale destructive energy.', activities: [featureActivity('cone', 'Breath Weapon (Cone)')] },
      { source: { sourcePath: 'flight.yml', pack: 'dnd5e.origins24', type: 'feat' as const, id: 'flight', identifier: 'draconic-flight', name: 'Draconic Flight' }, level: 5, automatic: true, description: 'Sprout wings.', activities: [featureActivity('flight', 'Draconic Flight')] },
    ] };
    const levelOne = projectCharacterSheet(document, { species: source, class: fighter, background: soldier, warnings: [] });
    const levelFiveDocument = structuredClone(document);
    levelFiveDocument.classProgressions![0]!.targetLevel = 5;
    const levelFive = projectCharacterSheet(levelFiveDocument, { species: source, class: fighter, background: soldier, warnings: [] });
    const levelOneNames = levelOne.actions?.groups.flatMap((group) => group.entries).map((entry) => entry.name) ?? [];
    const levelFiveNames = levelFive.actions?.groups.flatMap((group) => group.entries).map((entry) => entry.name) ?? [];

    expect(levelOneNames).toContain('Breath Weapon (Cone)');
    expect(levelOneNames).not.toContain('Draconic Flight');
    expect(levelFiveNames).toContain('Draconic Flight');
    expect(levelOneNames.filter((name) => name === 'Unarmed strike')).toHaveLength(1);
  });

  it('shows an equipped weapon mastery only when the character selected mastery for that weapon', () => {
    const daggerSource: FoundrySourceReference = {
      sourcePath: 'packs/_source/equipment24/weapons/simple-melee/dagger.yml',
      pack: 'dnd5e.equipment24',
      type: 'weapon',
      id: 'dagger-plus-one-id',
      identifier: 'dagger-plus-one',
      name: 'Dagger +1',
    };
    const dagger: FoundryItemSummary = {
      ...daggerSource,
      ruleset: '2024',
      itemType: 'weapon',
      category: 'simpleM',
      subcategory: 'dagger',
      magic: false,
      equippable: true,
      properties: ['fin', 'lgt', 'thr'],
      description: 'A light blade.',
      damage: { number: 1, denomination: 4, types: ['piercing'] },
      range: { value: 20, long: 60, units: 'ft' },
      mastery: 'nick',
      activities: [{ id: 'attack', type: 'attack', activation: { type: 'action' }, attack: { type: 'melee', classification: 'weapon' }, consumption: [] }],
    };
    const masteryAdvancement = {
      id: 'weapon-mastery', type: 'Trait', level: 1, title: 'Weapon Mastery', hint: '', dependencies: [],
      raw: { configuration: { mode: 'mastery', choices: [{ count: 3, pool: ['weapon:sim:*', 'weapon:mar:*'] }] } },
    };
    const masteredDocument = structuredClone(document);
    masteredDocument.classProgressions![0]!.selections = [{ advancementId: 'weapon-mastery', kind: 'trait', selected: ['weapon:sim:dagger'] }];
    masteredDocument.mutable = {
      preparedSpells: [],
      inventory: { items: [{ entryId: 'dagger', source: daggerSource, quantity: 1, equipped: false, provenance: [] }], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      equipmentStatus: [{ entryId: 'dagger', equipped: true, attuned: false }],
      resources: [],
    };
    const masterySources = { species, class: { ...fighter, advancements: [masteryAdvancement] }, background: soldier, inventoryItems: new Map([['dagger', { kind: 'available' as const, value: dagger }]]), warnings: [] };

    const mastered = projectCharacterSheet(masteredDocument, masterySources);
    const unmasteredDocument = structuredClone(masteredDocument);
    unmasteredDocument.classProgressions![0]!.selections = [];
    const unmastered = projectCharacterSheet(unmasteredDocument, masterySources);
    const otherMasteryDocument = structuredClone(masteredDocument);
    otherMasteryDocument.classProgressions![0]!.selections = [{ advancementId: 'weapon-mastery', kind: 'trait', selected: ['weapon:sim:mace'] }];
    const otherMastery = projectCharacterSheet(otherMasteryDocument, masterySources);
    const nonTraitMastery = projectCharacterSheet(masteredDocument, {
      ...masterySources,
      class: { ...fighter, advancements: [{ ...masteryAdvancement, type: 'ItemChoice' }] },
    });

    expect(mastered.actions?.groups.find(({ key }) => key === 'attacks')?.entries[0]?.description).toBe('A light blade.\nMastery: Nick');
    expect(unmastered.actions?.groups.find(({ key }) => key === 'attacks')?.entries[0]?.description).toBe('A light blade.');
    expect(otherMastery.actions?.groups.find(({ key }) => key === 'attacks')?.entries[0]?.description).toBe('A light blade.');
    expect(nonTraitMastery.actions?.groups.find(({ key }) => key === 'attacks')?.entries[0]?.description).toBe('A light blade.');
  });

  it('consumes persisted hit points and inspiration while leaving old state missing', () => {
    const incomplete = projectCharacterSheet(document, { species, class: fighter, background: soldier, warnings: [] });
    expect(incomplete.header.hitPoints.kind).toBe('missing');
    expect(incomplete.header.inspiration.kind).toBe('missing');
    const finalized = structuredClone(document);
    finalized.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], hitPoints: { current: 8, maximum: 10, temporary: 0 }, inspiration: false };
    const sheet = projectCharacterSheet(finalized, { species, class: fighter, background: soldier, warnings: [] });
    expect(sheet.header.hitPoints).toEqual({ kind: 'available', value: { current: 8, maximum: 10, temporary: 0 } });
    expect(sheet.header.inspiration).toEqual({ kind: 'available', value: false });
  });
  it('integrates equipped armor and Stealth disadvantage into the sheet', () => {
    const armorSource: FoundrySourceReference = { sourcePath: 'packs/_source/equipment24/armor/medium/scale-mail.yml', pack: 'dnd5e.equipment24', type: 'equipment', id: 'scale-mail', name: 'Scale Mail' };
    const armoredDocument: CharacterDocument = structuredClone(document);
    armoredDocument.mutable = {
      preparedSpells: [],
      inventory: { items: [{ entryId: 'armor', source: armorSource, quantity: 1, equipped: false, provenance: [] }], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
      equipmentStatus: [{ entryId: 'armor', equipped: true, attuned: false }], resources: [],
    };
    const armor: FoundryItemSummary = { ...armorSource, ruleset: '2024', itemType: 'equipment', category: 'medium', magic: false, equippable: true, armor: { value: 14, dex: 2 }, properties: ['stealthDisadvantage'] };

    const sheet = projectCharacterSheet(armoredDocument, { species, class: fighter, background: soldier, inventoryItems: new Map([['armor', { kind: 'available', value: armor }]]), warnings: [] });

    expect(sheet.header.armorClass).toEqual({ kind: 'available', value: 16 });
    expect(sheet.skills.find(({ key }) => key === 'ste')?.disadvantageSources).toEqual(['Scale Mail']);
    expect(sheet.skills.find(({ key }) => key === 'ath')?.disadvantageSources).toEqual([]);
    expect(sheet.inventory.kind).toBe('available');
  });

  it('projects supported level-one sheet values without mutating the document', () => {
    const before = structuredClone(document);

    const sheet = projectCharacterSheet(document, { species, class: fighter, background: soldier, warnings: [] });

    expect(sheet.identity).toMatchObject({
      name: 'Ayla',
      ruleset: '2024',
      species: { kind: 'available', value: 'Elf' },
      className: { kind: 'available', value: 'Fighter' },
      level: { kind: 'available', value: 1 },
      background: { kind: 'available', value: 'Soldier' },
    });
    expect(sheet.header.proficiencyBonus).toEqual({ kind: 'available', value: 2 });
    expect(sheet.header.speed).toEqual({ kind: 'available', value: '30 ft.' });
    expect(sheet.header.initiative).toEqual({ kind: 'available', value: 2 });
    expect(sheet.abilities.find(({ key }) => key === 'str')).toMatchObject({
      score: { kind: 'available', value: 16 },
      modifier: { kind: 'available', value: 3 },
    });
    expect(sheet.savingThrows.find(({ ability }) => ability === 'str')).toMatchObject({
      proficient: { kind: 'available', value: true },
      modifier: { kind: 'available', value: 5 },
    });
    expect(sheet.skills.find(({ key }) => key === 'ath')).toMatchObject({
      proficient: { kind: 'available', value: true },
      modifier: { kind: 'available', value: 5 },
    });
    expect(sheet.skills.find(({ key }) => key === 'prc')).toMatchObject({
      proficient: { kind: 'available', value: true },
      modifier: { kind: 'available', value: 2 },
    });
    expect(sheet.senses).toEqual(expect.arrayContaining([
      { label: 'Passive perception', value: { kind: 'available', value: 12 } },
      { label: 'Passive investigation', value: { kind: 'available', value: 11 } },
      { label: 'Passive insight', value: { kind: 'available', value: 10 } },
    ]));
    expect(sheet.training).toEqual(expect.arrayContaining([
      { label: 'Armor', values: { kind: 'available', value: ['Light armor', 'Medium armor'] } },
      { label: 'Weapons', values: { kind: 'available', value: ['Simple weapons'] } },
      { label: 'Tools', values: { kind: 'available', value: ['Gaming set'] } },
      { label: 'Languages', values: { kind: 'available', value: ['Common'] } },
    ]));
    expect(sheet.spells?.kind).toBe('empty');
    expect(sheet.features?.groups.map(({ category }) => category)).toEqual(['class', 'species', 'background', 'feats']);
    expect(sheet.backgroundDetails?.source).toEqual({ kind: 'available', value: soldier.source });
    expect(sheet.backgroundDetails?.biography.personalityTraits.kind).toBe('missing');
    expect(document).toEqual(before);
  });

  it('applies expertise as double proficiency and keeps stale later-level selections inactive', () => {
    const expertiseAdvancement = { id: 'expertise', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: 2, pool: ['skills:*'] } } };
    const laterAdvancement = { id: 'later-expertise', type: 'Trait', level: 6, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: 2, pool: ['skills:*'] } } };
    const expertiseDocument = { ...document, classProgressions: [{ ...document.classProgressions![0]!, selections: [{ advancementId: 'expertise', kind: 'expertise' as const, mode: 'expertise' as const, configuredPool: ['skills:*'], selected: ['skills:prc', 'skills:ste'] }, { advancementId: 'later-expertise', kind: 'expertise' as const, mode: 'expertise' as const, configuredPool: ['skills:*'], selected: ['skills:ath', 'skills:ins'] }] }] };
    const sheet = projectCharacterSheet(expertiseDocument, { species, class: { ...fighter, proficiencies: { ...fighter.proficiencies!, skills: ['skills:ath'] }, advancements: [expertiseAdvancement, laterAdvancement] }, background: { ...soldier, skills: ['skills:prc'] }, warnings: [] });
    expect(sheet.skills.find(({ key }) => key === 'prc')).toMatchObject({ proficient: { kind: 'available', value: true }, expertise: { kind: 'available', value: true }, training: { kind: 'available', value: 2 }, modifier: { kind: 'available', value: 4 } });
    expect(sheet.senses.find(({ label }) => label === 'Passive perception')?.value).toEqual({ kind: 'available', value: 14 });
    expect(sheet.skills.find(({ key }) => key === 'ste')).toMatchObject({ expertise: { kind: 'available', value: false }, training: { kind: 'available', value: 0 }, modifier: { kind: 'available', value: 2 } });
    expect(sheet.warnings).toContain('Expertise requires proficiency in Stealth.');
  });

  it('projects species defenses and preserves simultaneous saving throw A/D annotations', () => {
    const sourceRef = (name: string): FoundrySourceReference => ({ sourcePath: `${name.toLowerCase()}.yml`, pack: 'dnd5e.origins24', type: 'feat', id: name, name });
    const speciesWithFacts: SpeciesSourceSummary = {
      ...species,
      creatureTypeProjection: { value: 'humanoid', source: species.source },
      resistances: [
        { damageType: 'poison', source: sourceRef('Dwarven Resilience'), advancementId: 'dwarf-resistance', selected: true },
        { damageType: 'acid', source: sourceRef('Draconic Ancestry'), advancementId: 'dragon-resistance', selected: false },
      ],
      rollAnnotations: [
        { target: 'saving-throw', ability: 'int', mode: 'advantage', source: sourceRef('Gnomish Cunning') },
        { target: 'saving-throw', ability: 'int', mode: 'disadvantage', source: sourceRef('Test condition') },
      ],
      savingThrowNotes: [{ text: 'Advantage on saving throws to avoid or end the Poisoned condition.', source: sourceRef('Dwarven Resilience') }],
    };
    const configuredDocument = {
      ...document,
      speciesConfiguration: {
        origin: document.origin!, foundry: document.foundry, grants: [], spellChoices: [], diagnostics: [],
        choices: [{ key: 'species:resistance', level: 0, label: 'Resistance', count: 1, source: { id: 'resistance', type: 'Trait' }, options: [], selected: ['dr:acid'], raw: {} }],
      },
    };

    const sheet = projectCharacterSheet(configuredDocument, { species: speciesWithFacts, class: fighter, background: soldier, warnings: [] });

    expect(sheet.defenses).toEqual({ creatureType: { kind: 'available', value: 'humanoid' }, resistances: [
      { damageType: 'poison', source: 'Dwarven Resilience' },
      { damageType: 'acid', source: 'Draconic Ancestry' },
    ] });
    expect(sheet.savingThrows.find(({ ability }) => ability === 'int')?.annotations).toEqual([
      { marker: 'A', source: 'Gnomish Cunning' },
      { marker: 'D', source: 'Test condition' },
    ]);
    expect(sheet.savingThrowNotes).toEqual([{ text: 'Advantage on saving throws to avoid or end the Poisoned condition.', source: 'Dwarven Resilience' }]);
  });

  it('projects the resolved species size onto completed sheet identity', () => {
    const sizedSpecies = { ...species, source: { ...species.source, name: 'Human' }, size: { advancementId: 'human-size', level: 0, sizes: ['sm', 'med'] } };
    const sizedDocument = { ...document, origin: { ...document.origin!, identifier: 'human', sourcePath: 'packs/_source/origins24/species/human.yml', id: 'human-id' }, speciesConfiguration: { origin: { ...document.origin!, identifier: 'human', sourcePath: 'packs/_source/origins24/species/human.yml', id: 'human-id' }, foundry: document.foundry, grants: [], choices: [], size: { advancementId: 'human-size', selected: 'sm' } } };
    expect(projectCharacterSheet(sizedDocument, { species: sizedSpecies, class: fighter, background: soldier, warnings: [] }).identity.size).toEqual({ kind: 'available', value: 'Small' });
  });

  it('keeps derived values missing when ability scores or source summaries are absent', () => {
    const characterWithoutAbilityScores = { ...document };
    delete characterWithoutAbilityScores.abilityScores;

    const sheet = projectCharacterSheet(characterWithoutAbilityScores, { warnings: ['Species source unavailable.'] });

    expect(sheet.abilities.every(({ score, modifier }) => score.kind === 'missing' && modifier.kind === 'missing')).toBe(true);
    expect(sheet.header.initiative.kind).toBe('missing');
    expect(sheet.header.hitPoints.kind).toBe('missing');
    expect(sheet.header.armorClass.kind).toBe('missing');
    expect(sheet.header.inspiration.kind).toBe('missing');
    expect(sheet.senses.filter(({ label }) => label.startsWith('Passive ')).every(({ value }) => value.kind === 'missing')).toBe(true);
    expect(sheet.warnings).toContain('Species source unavailable.');
  });

  it('normalizes known proficiency selectors and preserves unknown ones as diagnostics', () => {
    const sheet = projectCharacterSheet(document, {
      species,
      class: {
        ...fighter,
        proficiencies: {
          ...fighter.proficiencies!,
          savingThrows: ['saves:str', 'saves:unknown'],
          skills: ['skills:ath', 'skills:mystery'],
        },
      },
      background: soldier,
      warnings: [],
    });

    expect(sheet.savingThrows.find(({ ability }) => ability === 'str')?.proficient).toEqual({ kind: 'available', value: true });
    expect(sheet.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('saves:unknown'),
      expect.stringContaining('skills:mystery'),
    ]));
    expect(JSON.stringify(sheet)).not.toContain('NaN');
  });

  it('does not infer 2024 background ability assignments from aggregate final scores', () => {
    const sheet = projectCharacterSheet(document, {
      species,
      class: fighter,
      background: { ...soldier, abilityScores: { points: 3, locked: ['str', 'dex', 'con'] } },
      warnings: [],
    });

    expect(sheet.backgroundDetails?.abilityImprovements).toEqual({ kind: 'missing', reason: 'No saved background ability-score allocation.' });
    expect(sheet.backgroundDetails?.warnings).not.toContain('Saved background ability-score assignments are unavailable.');
  });

  it('applies a valid saved background allocation to character-sheet ability totals', () => {
    const configuredDocument = { ...document, backgroundChoices: { ...document.backgroundChoices, abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } } };
    const configuredBackground = { ...soldier, abilityScores: { points: 3, cap: 2, advancementId: 'asi', locked: ['str', 'dex', 'con'] } };
    const sheet = projectCharacterSheet(configuredDocument, { species, class: fighter, background: configuredBackground, warnings: [] });
    expect(sheet.abilities.find(({ key }) => key === 'int')?.score).toEqual({ kind: 'available', value: 14 });
    expect(sheet.abilities.find(({ key }) => key === 'wis')?.score).toEqual({ kind: 'available', value: 11 });
  });
});
