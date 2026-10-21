import { describe, expect, it } from 'vitest';
import type { AbilityScoreSelection } from '../src/ability-scores';
import { projectCharacterSheet } from '../src/character-sheet-model';
import { buildClassConfiguration, setClassSelection, toClassProgressionSelection } from '../src/class-configuration';
import type { CharacterDocument } from '../src/character-model';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from '../src/character-sources';
import type { FoundryItemSummary, FoundrySourceReference } from '../src/foundry-source-catalog';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';
import { getEligibleClassFeatures } from '../src/class-feature-eligibility';
import { draconicSorceryHitPointsPerLevel } from '../src/passive-effects';

const abilityScores: AbilityScoreSelection = {
  method: 'standard-array',
  base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
  manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
};
const sourceRef = (name: string): FoundrySourceReference => ({ sourcePath: `${name}.yml`, pack: 'dnd5e.test', type: 'feat', id: name.toLocaleLowerCase(), name });

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
  it('projects the pinned level-three 2024 Thief climbing speed and keeps subclass selections reference-only', async () => {
    const index = createPinnedSourceIndex();
    const rogue = await index.getClassSummary('2024', 'packs/_source/classes24/rogue/rogue.yml');
    const pinnedSpecies = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/elf-high.yml');
    const config = buildClassConfiguration(rogue, { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' }, 3);
    const subclassChoice = config.selections.find((choice) => choice.kind === 'subclass');
    if (subclassChoice?.kind !== 'subclass') throw new Error('Pinned Rogue subclass choice was unavailable');
    const thief = subclassChoice.options.find((option) => option.name === 'Thief');
    if (thief === undefined) throw new Error('Pinned Thief subclass was unavailable');
    const selected = setClassSelection(config, { ...subclassChoice, selected: thief });
    const progression = toClassProgressionSelection(selected);
    const thiefSelection = progression.selections.find((selection) => selection.kind === 'subclass');
    expect(progression.subclass).not.toHaveProperty('raw');
    expect(thiefSelection?.kind === 'subclass' ? thiefSelection.selected : undefined).not.toHaveProperty('raw');

    const rogueDocument = structuredClone(document);
    rogueDocument.origin = { sourcePath: pinnedSpecies.source.sourcePath, identifier: pinnedSpecies.source.identifier ?? 'elf', id: pinnedSpecies.source.id };
    rogueDocument.classProgressions = [progression];
    const sheet = projectCharacterSheet(rogueDocument, { species: pinnedSpecies, class: rogue, warnings: [] });

    expect(sheet.header.speed).toEqual({ kind: 'available', value: '30' });
    expect(sheet.header.speedDetails).toEqual({ kind: 'available', value: 'Walking: 30; Climb: 30' });
    expect(sheet.warnings.filter((warning) => warning.includes('movement.climb'))).toEqual([]);
    expect(sheet.features?.groups.flatMap((group) => group.entries).some((entry) => entry.name === 'Second-Story Work')).toBe(true);
  }, 15000);

  it('keeps pinned conditional Ranger Roving movement in feature text without reporting unsupported movement keys', async () => {
    const index = createPinnedSourceIndex();
    const ranger = await index.getClassSummary('2024', 'packs/_source/classes24/ranger/ranger.yml');
    const pinnedSpecies = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/elf-high.yml');
    const rangerDocument = structuredClone(document);
    rangerDocument.origin = { sourcePath: pinnedSpecies.source.sourcePath, identifier: pinnedSpecies.source.identifier ?? 'elf', id: pinnedSpecies.source.id };
    rangerDocument.classProgressions = [{ class: { sourcePath: ranger.source.sourcePath, identifier: ranger.source.identifier ?? 'ranger', id: ranger.source.id }, targetLevel: 6, selections: [] }];

    const sheet = projectCharacterSheet(rangerDocument, { species: pinnedSpecies, class: ranger, warnings: [] });
    const roving = sheet.features?.groups.flatMap((group) => group.entries).find((entry) => entry.name === 'Roving');

    expect(sheet.header.speed).toEqual({ kind: 'available', value: '30' });
    expect(sheet.warnings.filter((warning) => warning.includes('movement.'))).toEqual([]);
    expect(roving?.description).toMatchObject({ kind: 'available', value: expect.stringContaining('Climb Speed') });
    expect(roving?.description.kind === 'available' ? roving.description.value : '').toContain('Heavy armor');
  }, 15000);

  it('projects pinned level-gated Feral Senses as 30-foot blindsight', async () => {
    const ranger = await createPinnedSourceIndex().getClassSummary('2024', 'packs/_source/classes24/ranger/ranger.yml');
    const feralSource = { sourcePath: 'packs/_source/classes24/ranger/class-features/feral-senses.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbrgrFeralSense', name: 'Feral Senses' };
    const feral = { ...ranger, features: [...(ranger.features ?? []), { advancementId: 'feral-senses', level: 18, source: feralSource, activeEffects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.senses.blindsight', type: 'upgrade', value: 30 }] } }] }] };
    const rangerDocument = structuredClone(document);
    rangerDocument.classProgressions = [{ class: { sourcePath: ranger.source.sourcePath, identifier: 'ranger', id: ranger.source.id }, targetLevel: 18, selections: [] }];
    const sheet = projectCharacterSheet(rangerDocument, { species, class: feral, warnings: [] });
    expect(sheet.senses.find(({ label }) => label === 'Blindsight')?.value).toEqual({ kind: 'available', value: '30 ft.' });
    expect(sheet.warnings.filter((warning) => warning.includes('senses.blindsight'))).toEqual([]);
  }, 15000);

  it('reads the finalized Draconic Resilience maximum and preserves an explicit maximum override', () => {
    const draconicSource = { sourcePath: 'packs/_source/classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbscrDraconicRe', name: 'Draconic Resilience' };
    const sorcerer: ClassSourceSummary = { ...fighter, source: { ...fighter.source, sourcePath: 'packs/_source/classes24/sorcerer/sorcerer.yml', identifier: 'sorcerer', name: 'Sorcerer' }, features: [{ advancementId: 'draconic-resilience', level: 3, source: draconicSource, activeEffects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.hp.bonuses.overall', type: 'add', value: '@classes.sorcerer.levels' }] } }, { disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.ac.calc', type: 'override', value: 'unarmoredBard' }] } }] }] };
    const sorcererDocument = structuredClone(document);
    sorcererDocument.classProgressions = [{ class: { sourcePath: sorcerer.source.sourcePath, identifier: 'sorcerer', id: sorcerer.source.id }, targetLevel: 3, selections: [] }];
    sorcererDocument.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], hitPoints: { current: 30, maximum: 33 } };
    const sheet = projectCharacterSheet(sorcererDocument, { species, class: sorcerer, background: soldier, warnings: [] });
    expect(sheet.header.hitPoints).toEqual({ kind: 'available', value: { current: 30, maximum: 33, temporary: 0 } });
    expect(sheet.header.armorClass).toEqual({ kind: 'available', value: 11 });
    sorcererDocument.mutable.hitPoints!.maximumOverride = 35;
    expect(projectCharacterSheet(sorcererDocument, { species, class: sorcerer, background: soldier, warnings: [] }).header.hitPoints).toEqual({ kind: 'available', value: { current: 30, maximum: 35, temporary: 0 } });
  });

  it('grants the pinned Draconic HP modifier only after selecting Draconic Sorcery at an eligible level', async () => {
    const index = createPinnedSourceIndex();
    const sorcerer = await index.getClassSummary('2024', 'packs/_source/classes24/sorcerer/sorcerer.yml');
    const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
    const config = buildClassConfiguration(sorcerer, snapshot, 3);
    const choice = config.selections.find((selection) => selection.kind === 'subclass');
    if (choice?.kind !== 'subclass') throw new Error('Pinned Sorcerer subclass choice was unavailable');
    const draconic = choice.options.find((option) => option.name === 'Draconic Sorcery');
    if (draconic === undefined) throw new Error('Pinned Draconic Sorcery option was unavailable');
    const selected = (option: typeof draconic) => toClassProgressionSelection(setClassSelection(config, { ...choice, selected: option }));
    const draconicDocument = structuredClone(document);
    draconicDocument.classProgressions = [selected(draconic)];
    const otherDocument = structuredClone(draconicDocument);
    const otherSelection = otherDocument.classProgressions![0]!.selections.find((selection) => selection.kind === 'subclass');
    if (otherSelection?.kind === 'subclass') otherSelection.selected = { sourcePath: 'packs/_source/classes24/sorcerer/wild-magic.yml', pack: 'dnd5e.classes24', type: 'subclass', id: 'wild-magic', name: 'Wild Magic' };
    const noSubclassDocument = structuredClone(document);
    noSubclassDocument.classProgressions = [{ ...selected(draconic), selections: selected(draconic).selections.filter((selection) => selection.kind !== 'subclass') }];
    const sources = [{ source: sorcerer.source, effects: [] }, ...getEligibleClassFeatures(draconicDocument, sorcerer).map((feature) => ({ source: feature.source, effects: feature.activeEffects ?? [] }))];
    expect(draconicSorceryHitPointsPerLevel(sources, '2024')).toBe(1);
    expect(draconicSorceryHitPointsPerLevel(getEligibleClassFeatures(otherDocument, sorcerer).map((feature) => ({ source: feature.source, effects: feature.activeEffects ?? [] })), '2024')).toBe(0);
    expect(draconicSorceryHitPointsPerLevel(getEligibleClassFeatures(noSubclassDocument, sorcerer).map((feature) => ({ source: feature.source, effects: feature.activeEffects ?? [] })), '2024')).toBe(0);
  }, 15000);

  it('projects pinned Nature’s Ward poison immunity as a condition defense', () => {
    const wardSource = { sourcePath: 'packs/_source/classes24/druid/subclass-features/circle-of-land/natures-ward.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbdrdNaturesWar', name: "Nature's Ward" };
    const druid: ClassSourceSummary = { ...fighter, source: { ...fighter.source, sourcePath: 'packs/_source/classes24/druid/druid.yml', identifier: 'druid', name: 'Druid' }, features: [{ advancementId: 'natures-ward', level: 10, source: wardSource, activeEffects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.traits.ci.value', type: 'add', value: 'poison' }] } }] }] };
    const druidDocument = structuredClone(document);
    druidDocument.classProgressions = [{ class: { sourcePath: druid.source.sourcePath, identifier: 'druid', id: druid.source.id }, targetLevel: 10, selections: [] }];
    const sheet = projectCharacterSheet(druidDocument, { species, class: druid, warnings: [] });
    expect(sheet.defenses?.immunities).toEqual([{ condition: 'Poisoned', source: "Nature's Ward" }]);
    expect(sheet.warnings.filter((warning) => warning.includes('traits.ci.value'))).toEqual([]);
  });

  it('projects pinned Criminal Alert as full Initiative proficiency and removes it with the grant', async () => {
    const pinnedBackground = await createPinnedSourceIndex().getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/criminal.yml');
    const criminalDocument = structuredClone(document);
    criminalDocument.background = { sourcePath: pinnedBackground.source.sourcePath, identifier: 'criminal', id: pinnedBackground.source.id };
    const withAlert = projectCharacterSheet(criminalDocument, { species, class: fighter, background: pinnedBackground, warnings: [] });
    const withoutAlert = projectCharacterSheet(criminalDocument, { species, class: fighter, background: { ...pinnedBackground, grantedFeats: [], grantedFeat: undefined }, warnings: [] });
    expect(withAlert.header.initiative).toEqual({ kind: 'available', value: 4 });
    expect(withoutAlert.header.initiative).toEqual({ kind: 'available', value: 2 });
  });

  it('uses passive weapon proficiency when projecting equipped weapon attacks', () => {
    const flailSource: FoundrySourceReference = { sourcePath: 'flail.yml', pack: 'dnd5e.equipment24', type: 'weapon', id: 'flail', name: 'Flail' };
    const flail: FoundryItemSummary = { ...flailSource, ruleset: '2024', itemType: 'weapon', category: 'martialM', magic: false, equippable: true, properties: [], damage: { number: 1, denomination: 8, types: ['bludgeoning'] }, activities: [{ id: 'attack', type: 'attack', activation: { type: 'action' }, attack: { type: 'melee', classification: 'weapon' }, consumption: [] }] };
    const armed = structuredClone(document);
    armed.mutable = { preparedSpells: [], inventory: { items: [{ entryId: 'flail', source: flailSource, quantity: 1, equipped: false, provenance: [] }], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [{ entryId: 'flail', equipped: true, attuned: false }], resources: [] };
    const classWithPassiveTraining = { ...fighter, features: [{ advancementId: 'grant', level: 1, source: sourceRef('Martial training'), activeEffects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.traits.weaponProf.value', type: 'add', value: 'mar' }] } }] }] };
    const sheet = projectCharacterSheet(armed, { species, class: classWithPassiveTraining, background: soldier, inventoryItems: new Map([['flail', { kind: 'available', value: flail }]]), warnings: [] });
    expect(sheet.actions?.groups.find(({ key }) => key === 'attacks')?.entries.find(({ name }) => name === 'Flail')?.attackBonus).toEqual({ kind: 'available', value: 5 });
  });

  it('keeps the higher numeric species sense when a passive upgrade is lower', () => {
    const summary = { ...species, features: [{ source: sourceRef('Sight'), level: 1, automatic: true, activeEffects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.senses.darkvision', type: 'upgrade', value: 30 }] } }] }] };
    const sheet = projectCharacterSheet(document, { species: summary, class: fighter, background: soldier, warnings: [] });
    expect(sheet.senses.find(({ label }) => label === 'Darkvision')?.value).toEqual({ kind: 'available', value: '60 ft.' });
  });

  it('uses the full source label for selected language proficiencies', () => {
    const sheet = projectCharacterSheet(document, {
      species,
      class: fighter,
      background: { ...soldier, languages: ['languages:exotic:cant', 'languages:exotic:primordial:aquan'] },
      warnings: [],
    });

    expect(sheet.training.find(({ label }) => label === 'Languages')?.values).toEqual({
      kind: 'available', value: ['Common', 'Primordial (Aquan)', "Thieves' Cant"],
    });
  });

  it('projects eligible Alert and direct feature additions onto initiative, training, and skill checks', () => {
    const effect = (key: string, type: string, value: unknown) => ({ disabled: false, transfer: true, system: { changes: [{ key, type, value }] } });
    const sheet = projectCharacterSheet(document, {
      class: { ...fighter, features: [{ advancementId: 'level-one', level: 1, source: { sourcePath: 'class-feature.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'cleric-order', name: 'Divine Order' }, activeEffects: [
        effect('system.traits.armorProf.value', 'add', 'hvy'),
        effect('system.traits.weaponProf.value', 'add', 'mar'),
        effect('system.skills.arc.bonuses.check', 'add', '(max(1,@abilities.wis.mod))'),
        effect('system.scale.cleric.cantrips-known.value', 'add', 1),
      ] }], advancements: [{ id: 'cleric-order', type: 'ItemGrant', level: 1, title: 'Divine Order', hint: '', dependencies: [], raw: {} }] },
      species: { ...species, features: [{ source: { sourcePath: 'keen-sight.yml', pack: 'dnd5e.origins24', type: 'feat', id: 'keen-sight', name: 'Keen sight' }, level: 1, automatic: true, activeEffects: [effect('system.attributes.senses.darkvision', 'upgrade', 120)] }] },
      background: { ...soldier, grantedFeats: [{ source: { sourcePath: 'alert.yml', pack: 'dnd5e.origin-feats', type: 'feat', id: 'alert', name: 'Alert' }, advancements: [], activeEffects: [effect('flags.dnd5e.initiativeAlert', 'add', true)] }] },
      warnings: [],
    });
    expect(sheet.header.initiative).toEqual({ kind: 'available', value: 4 });
    expect(sheet.training.find(({ label }) => label === 'Armor')?.values).toEqual({ kind: 'available', value: ['Heavy armor', 'Light armor', 'Medium armor'] });
    expect(sheet.training.find(({ label }) => label === 'Weapons')?.values).toEqual({ kind: 'available', value: ['Martial weapons', 'Simple weapons'] });
    expect(sheet.skills.find(({ key }) => key === 'arc')?.modifier).toEqual({ kind: 'available', value: 2 });
    expect(sheet.senses.find(({ label }) => label === 'Darkvision')?.value).toEqual({ kind: 'available', value: '120 ft.' });
    expect(sheet.spells?.cantripCapacityBonus).toBe(1);
    const withoutAlert = projectCharacterSheet(document, { species, class: fighter, background: soldier, warnings: [] });
    expect(withoutAlert.header.initiative).toEqual({ kind: 'available', value: 2 });
  });

  it('projects pinned all-save proficiency, half proficiency on untrained skills, and systematic advantage', () => {
    const effect = (key: string, type: string, value: unknown): Record<string, unknown>[] => [{ disabled: false, transfer: true, system: { changes: [{ key, type, value }] } }];
    const feature = (path: string, pack: string, id: string, name: string, level: number, effects: Record<string, unknown>[]) => ({
      advancementId: `synthetic-${id}`, source: { sourcePath: `packs/_source/${path}`, pack, type: 'feat', id, name }, level, activeEffects: effects,
    });
    const phase3Fighter = {
      ...fighter,
      features: [
        feature('classes24/monk/class-features/disciplined-survivor.yml', 'dnd5e.classes24', 'phbmnkDiscipline', 'Disciplined Survivor', 14, effect('flags.dnd5e.diamondSoul', 'override', true)),
        feature('classes24/bard/class-features/jack-of-all-trades.yml', 'dnd5e.classes24', 'phbbrdJackOfAllT', 'Jack of All Trades', 2, effect('flags.dnd5e.jackOfAllTrades', 'override', true)),
        feature('classes24/barbarian/class-features/feral-instinct.yml', 'dnd5e.classes24', 'phbbrbFeralInsti', 'Feral Instinct', 7, effect('system.attributes.init.roll.mode', 'add', 1)),
        feature('classes24/fighter/subclass-features/champion/remarkable-athlete.yml', 'dnd5e.classes24', 'phbftrRemarkable', 'Remarkable Athlete', 3, effect('flags.dnd5e.remarkableAthlete', 'override', true)),
      ],
    };
    const levelFourteen = structuredClone(document);
    levelFourteen.classProgressions![0]!.targetLevel = 14;
    const sheet = projectCharacterSheet(levelFourteen, { species, class: phase3Fighter, background: soldier, warnings: [] });

    expect(sheet.savingThrows.every((save) => save.proficient.kind === 'available' && save.proficient.value)).toBe(true);
    expect(sheet.savingThrows.find(({ ability }) => ability === 'wis')?.modifier).toEqual({ kind: 'available', value: 5 });
    expect(sheet.skills.find(({ key }) => key === 'arc')?.modifier).toEqual({ kind: 'available', value: 3 });
    expect(sheet.skills.find(({ key }) => key === 'ath')?.modifier).toEqual({ kind: 'available', value: 8 });
    expect(sheet.skills.find(({ key }) => key === 'ath')?.annotations).toEqual([{ marker: 'A', source: 'Remarkable Athlete' }]);
    expect(sheet.header.initiative).toEqual({ kind: 'available', value: 4 });
    expect(sheet.header.initiativeAnnotations).toEqual([{ marker: 'A', source: 'Feral Instinct, Remarkable Athlete' }]);
    expect(sheet.warnings).toEqual([]);

    const jackOnly = projectCharacterSheet(levelFourteen, { species, class: { ...phase3Fighter, features: phase3Fighter.features.filter((entry) => entry.source.id === 'phbbrdJackOfAllT') }, background: soldier, warnings: [] });
    expect(jackOnly.header.initiative).toEqual({ kind: 'available', value: 4 });

    const alertBackground = { ...soldier, grantedFeats: [{ source: sourceRef('Alert'), advancements: [], activeEffects: effect('flags.dnd5e.initiativeAlert', 'add', true) }] };
    const jackWithAlert = projectCharacterSheet(levelFourteen, { species, class: { ...phase3Fighter, features: phase3Fighter.features.filter((entry) => entry.source.id === 'phbbrdJackOfAllT') }, background: alertBackground, warnings: [] });
    expect(jackWithAlert.header.initiative).toEqual({ kind: 'available', value: 7 });
  });

  it('deduplicates weapon proficiency labels represented by different selectors', () => {
    const sheet = projectCharacterSheet(document, {
      species,
      class: { ...fighter, proficiencies: { ...fighter.proficiencies!, weapons: ['weapon:mar:rapier', 'weapon:rapier'] } },
      background: soldier,
      warnings: [],
    });

    expect(sheet.training.find(({ label }) => label === 'Weapons')?.values).toEqual({ kind: 'available', value: ['Rapier'] });
  });

  it('uses the authoritative weapon name for equivalent hand-crossbow selectors', () => {
    const sheet = projectCharacterSheet(document, {
      species,
      class: { ...fighter, proficiencies: { ...fighter.proficiencies!, weapons: ['weapon:mar:handcrossbow', 'weapon:handcrossbow'] } },
      background: soldier,
      weaponLabels: new Map([['weapon:mar:handcrossbow', 'Hand Crossbow'], ['weapon:handcrossbow', 'Hand Crossbow']]),
      warnings: [],
    });
    expect(sheet.training.find(({ label }) => label === 'Weapons')?.values).toEqual({ kind: 'available', value: ['Hand Crossbow'] });
  });

  it('projects creature type as an identity fact rather than a defense', () => {
    const sheet = projectCharacterSheet(document, {
      species: { ...species, creatureType: { value: 'humanoid' } },
      class: fighter,
      background: soldier,
      warnings: [],
    });

    expect(sheet.identity.creatureType).toEqual({ kind: 'available', value: 'Humanoid' });
    expect(sheet.defenses).toEqual({ resistances: [], immunities: [] });
  });

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

  it('names the source-backed thieves tool proficiency on the completed sheet', () => {
    const sheet = projectCharacterSheet(document, {
      species,
      class: { ...fighter, proficiencies: { ...fighter.proficiencies!, tools: ['tool:thief'] } },
      background: soldier,
      warnings: [],
    });

    expect(sheet.training.find(({ label }) => label === 'Tools')?.values).toEqual({ kind: 'available', value: ['Gaming set', "Thieves' tools"] });
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

    expect(mastered.actions?.groups.find(({ key }) => key === 'attacks')?.entries[0]).toMatchObject({ description: 'A light blade.', weaponMastery: 'Nick' });
    expect(mastered.actions?.weaponReferences).toContainEqual({ name: 'Nick' });
    expect(unmastered.actions?.groups.find(({ key }) => key === 'attacks')?.entries[0]?.description).toBe('A light blade.');
    expect(unmastered.actions?.groups.find(({ key }) => key === 'attacks')?.entries[0]?.weaponMastery).toBeUndefined();
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
    finalized.mutable.hitPoints = { current: 12, maximum: 10, maximumOverride: 15, temporary: 0 };
    expect(projectCharacterSheet(finalized, { species, class: fighter, background: soldier, warnings: [] }).header.hitPoints).toEqual({ kind: 'available', value: { current: 12, maximum: 15, temporary: 0 } });
  });
  it('does not add Dwarven Toughness to finalized maximum HP a second time', () => {
    const dwarf = { ...species, features: [{ source: sourceRef('Dwarven Toughness'), level: 1, automatic: true, activeEffects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.hp.bonuses.level', type: 'add', value: 1 }] } }], hitPointModifiers: [{ perLevel: 1, source: sourceRef('Dwarven Toughness') }] }] };
    const finalized = structuredClone(document);
    finalized.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], hitPoints: { current: 11, maximum: 11, temporary: 0 } };
    expect(projectCharacterSheet(finalized, { species: dwarf, class: fighter, background: soldier, warnings: [] }).header.hitPoints).toEqual({ kind: 'available', value: { current: 11, maximum: 11, temporary: 0 } });
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

  it('uses the selected character level for proficiency-based sheet values', () => {
    const levelFive = {
      ...document,
      classProgressions: [{ ...document.classProgressions![0]!, targetLevel: 5 }],
    };
    const sheet = projectCharacterSheet(levelFive, { species, class: fighter, background: soldier, warnings: [] });

    expect(sheet.header.proficiencyBonus).toEqual({ kind: 'available', value: 3 });
    expect(sheet.savingThrows.find(({ ability }) => ability === 'str')?.modifier).toEqual({ kind: 'available', value: 6 });
    expect(sheet.skills.find(({ key }) => key === 'ath')?.modifier).toEqual({ kind: 'available', value: 6 });
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
      features: [
        { source: sourceRef('Gnomish Cunning'), level: 1, automatic: true, rollAnnotations: [{ target: 'saving-throw', ability: 'int', mode: 'advantage', source: sourceRef('Gnomish Cunning') }] },
        { source: sourceRef('Test condition'), level: 1, automatic: true, rollAnnotations: [{ target: 'saving-throw', ability: 'int', mode: 'disadvantage', source: sourceRef('Test condition') }] },
        { source: sourceRef('Dwarven Resilience'), level: 1, automatic: true, savingThrowNotes: [{ text: 'Advantage on saving throws to avoid or end the Poisoned condition.', source: sourceRef('Dwarven Resilience') }] },
        { source: sourceRef('Future insight'), level: 5, automatic: true, rollAnnotations: [{ target: 'saving-throw', ability: 'wis', mode: 'advantage', source: sourceRef('Future insight') }] },
        { source: sourceRef('Unselected insight'), level: 1, selection: { key: 'species:insight', value: 'unselected' }, rollAnnotations: [{ target: 'saving-throw', ability: 'cha', mode: 'advantage', source: sourceRef('Unselected insight') }] },
      ],
    };
    const configuredDocument = {
      ...document,
      speciesConfiguration: {
        origin: document.origin!, foundry: document.foundry, grants: [], spellChoices: [], diagnostics: [],
        choices: [{ key: 'species:resistance', level: 0, label: 'Resistance', count: 1, source: { id: 'resistance', type: 'Trait' }, options: [], selected: ['dr:acid'], raw: {} }],
      },
    };

    const sheet = projectCharacterSheet(configuredDocument, { species: speciesWithFacts, class: fighter, background: soldier, warnings: [] });

    expect(sheet.identity.creatureType).toEqual({ kind: 'available', value: 'Humanoid' });
    expect(sheet.defenses).toEqual({ resistances: [
      { damageType: 'poison', source: 'Dwarven Resilience' },
      { damageType: 'acid', source: 'Draconic Ancestry' },
    ], immunities: [] });
    expect(sheet.savingThrows.find(({ ability }) => ability === 'int')?.annotations).toEqual([
      { marker: 'A', source: 'Gnomish Cunning' },
      { marker: 'D', source: 'Test condition' },
    ]);
    expect(sheet.savingThrows.find(({ ability }) => ability === 'wis')?.annotations).toEqual([]);
    expect(sheet.savingThrows.find(({ ability }) => ability === 'cha')?.annotations).toEqual([]);
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
