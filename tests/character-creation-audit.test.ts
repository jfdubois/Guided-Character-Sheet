import { collectAbilityBonuses, createDefaultAbilityScores } from '../src/ability-scores';
import { buildBackgroundAbilityConfiguration, createBackgroundAbilitySelection } from '../src/background-ability-configuration';
import { createCharacterDocument, withRuleset } from '../src/character-model';
import type { ClassSourceSummary } from '../src/character-sources';
import { getCharacterCreationSections } from '../src/character-view';
import type { EquipmentPackageNode } from '../src/equipment';
import { canonicalizeLanguageSelector, languageSelectorOptions, languageSelectorKey } from '../src/foundry-source-catalog';
import { flattenSelectedEquipment, mergeInventories } from '../src/inventory';
import { getAvailableGrantedFeatSpellChoices, setGrantedFeatSpellChoice, setGrantedFeatSpellcastingAbility, toGrantedFeatSelection, type GrantedFeatChoiceConfiguration } from '../src/granted-feat-configuration';
import { describe, expect, it } from 'vitest';
import { auditAbilityProjectionConsistency, auditBackgroundCompletionConsistency, auditEligibilityFixtures, auditEquipmentMergeConsistency, auditFeatureProjectionConsistency, auditGrantedFeatSelectionConsistency, auditLanguageOptionConsistency, auditLevelOneSourceCompleteness, auditProfileFixture, auditProjectedClassFeatures, createAuditFinding, dependencyFindings, deterministicGrantedFeatSelection, formatAuditJson, formatAuditMarkdown, projectAbilityConsumerProjection, rawBackgroundDependencyFindings, type AuditProfileFixture, type CharacterCreationAuditResult, type LevelOneSourceCompletenessInventory } from './support/character-creation-audit';

describe('character creation audit reporting', () => {
  it('reports each missing level-one semantic projection without normalizing it away', () => {
    const inventory: LevelOneSourceCompletenessInventory = {
      sizeChoices: [{ sourcePath: 'human.yml', advancementId: 'size', options: ['sm', 'med'] }],
      fixedSpells: [{ sourcePath: 'elf.yml', advancementId: 'spell', spellKey: 'elf-cantrip', abilityOptions: ['int', 'wis', 'cha'], freeUses: '1', recovery: 'lr', requireSlot: false }],
      scales: [{ sourcePath: 'dragonborn.yml', advancementId: 'breath-scale', identifier: 'breath', levelOneValue: '1d10' }],
      hpEffects: [{ sourcePath: 'dwarf.yml', advancementId: 'toughness', value: 1, key: 'system.attributes.hp.bonuses.level' }],
      advantageAnnotations: [{ sourcePath: 'gnome.yml', advancementId: 'cunning', abilities: ['int', 'wis', 'cha'] }],
      expertise: [{ sourcePath: 'rogue.yml', advancementId: 'expertise', count: 2, pool: ['skills:*'] }],
    };
    const findings = auditLevelOneSourceCompleteness(inventory);
    expect(findings.map(({ invariant }) => invariant)).toEqual([
      'calculation.species-hp-effect', 'choice.class-expertise', 'choice.species-size', 'choice.species-spellcasting-ability',
      'presentation.species-save-advantage',
      'presentation.species-scale', 'presentation.species-spell', 'presentation.species-spell-use',
    ]);
    expect(findings.every(({ severity }) => severity === 'error')).toBe(true);
  });

  it('accepts exact source-backed values in a complete level-one projection', () => {
    const inventory: LevelOneSourceCompletenessInventory = {
      sizeChoices: [{ sourcePath: 'human.yml', advancementId: 'size', options: ['sm', 'med'] }],
      fixedSpells: [{ sourcePath: 'elf.yml', advancementId: 'spell', spellKey: 'elf-cantrip', abilityOptions: ['int', 'wis', 'cha'], freeUses: '1', recovery: 'lr', requireSlot: false }],
      scales: [{ sourcePath: 'dragonborn.yml', advancementId: 'breath-scale', identifier: 'breath', levelOneValue: '1d10' }],
      hpEffects: [{ sourcePath: 'dwarf.yml', advancementId: 'toughness', value: 1, key: 'system.attributes.hp.bonuses.level' }],
      advantageAnnotations: [{ sourcePath: 'gnome.yml', advancementId: 'cunning', abilities: ['int', 'wis', 'cha'] }],
      expertise: [{ sourcePath: 'rogue.yml', advancementId: 'expertise', count: 2, pool: ['skills:*'] }],
    };
    expect(auditLevelOneSourceCompleteness(inventory, {
      sizeChoices: [{ sourcePath: 'human.yml', advancementId: 'size', selected: 'sm' }],
      fixedSpells: [{ sourcePath: 'elf.yml', advancementId: 'spell', spellKey: 'elf-cantrip', freeUses: '1', recovery: 'lr', requireSlot: false }],
      spellcastingAbilities: [{ sourcePath: 'elf.yml', advancementIds: ['spell'], selected: 'int' }],
      scales: [{ sourcePath: 'dragonborn.yml', advancementId: 'breath-scale', value: '1d10' }],
      hpEffects: [{ sourcePath: 'dwarf.yml', advancementId: 'toughness', value: 1, key: 'system.attributes.hp.bonuses.level' }],
      advantageAnnotations: [{ sourcePath: 'gnome.yml', advancementId: 'cunning', abilities: ['int', 'wis', 'cha'] }],
      expertise: [{ sourcePath: 'rogue.yml', advancementId: 'expertise', selected: ['arc', 'ste'] }],
    })).toEqual([]);
  });

  const result: CharacterCreationAuditResult = {
    coverage: { species: 14, classes: 12, backgrounds: 4 },
    findings: [
      createAuditFinding({ invariant: 'eligibility.fixed-class-bonus', category: 'eligibility', stage: 'ability-scores', sourceName: 'Monk', sourcePath: 'monk.yml', nodeId: 'body-and-mind', observed: 'Dexterity +4 at level 1', expected: 'No level-20 bonus', rootCause: 'class-advancement-level' }),
      createAuditFinding({ invariant: 'eligibility.fixed-class-bonus', category: 'eligibility', stage: 'ability-scores', sourceName: 'Barbarian', sourcePath: 'barbarian.yml', nodeId: 'primal-champion', observed: 'Strength +4 at level 1', expected: 'No level-20 bonus', rootCause: 'class-advancement-level' }),
    ],
  };

  it('sorts machine-readable findings deterministically without mutating input', () => {
    const originalOrder = result.findings.map((finding) => finding.sourceName);
    const parsed = JSON.parse(formatAuditJson(result)) as CharacterCreationAuditResult;
    expect(parsed.findings.map((finding) => finding.sourceName)).toEqual(['Barbarian', 'Monk']);
    expect(result.findings.map((finding) => finding.sourceName)).toEqual(originalOrder);
  });

  it('groups Markdown findings and includes coverage counts', () => {
    const markdown = formatAuditMarkdown(result);
    expect(markdown).toContain('14 species, 12 classes, 4 backgrounds');
    expect(markdown).toContain('eligibility.fixed-class-bonus (2)');
    expect(markdown).toContain('`barbarian.yml`');
  });

  it('reports an empty result clearly', () => {
    expect(formatAuditMarkdown({ coverage: { species: 0, classes: 0, backgrounds: 0 }, findings: [] })).toContain('No violations found');
  });

  it('preserves unusual paths and distinct node identifiers', () => {
    const unusual: CharacterCreationAuditResult = {
      coverage: { species: 1, classes: 0, backgrounds: 0 },
      findings: [
        createAuditFinding({ invariant: 'resolution.node', category: 'resolution', stage: 'species', sourceName: 'Odd', sourcePath: 'path with spaces/species.yml', nodeId: 'first', observed: 'Missing', expected: 'Resolved', rootCause: 'node-resolution' }),
        createAuditFinding({ invariant: 'resolution.node', category: 'resolution', stage: 'species', sourceName: 'Odd', sourcePath: 'path with spaces/species.yml', nodeId: 'second', observed: 'Missing', expected: 'Resolved', rootCause: 'node-resolution' }),
      ],
    };
    const markdown = formatAuditMarkdown(unusual);
    expect(markdown).toContain('`path with spaces/species.yml`');
    expect(markdown).toContain('`first`');
    expect(markdown).toContain('`second`');
  });

  it('finds visible future species features and applied future class bonuses', () => {
    const findings = auditEligibilityFixtures({
      targetLevel: 1,
      visibleSpeciesFeatures: [{ name: 'Draconic Flight', sourcePath: 'flight.yml', level: 5, advancementId: 'flight' }],
      classSource: { name: 'Barbarian', sourcePath: 'barbarian.yml' },
      classAdvancements: [{ id: 'champion', type: 'AbilityScoreImprovement', level: 20, raw: { configuration: { fixed: { str: 4, con: 4 } } } }],
    });
    expect(findings.map((finding) => finding.invariant)).toEqual([
      'eligibility.class-fixed-bonus',
      'eligibility.species-feature-level',
    ]);
    expect(findings.map((finding) => finding.nodeId)).toEqual(['champion', 'flight']);
  });

  it('accepts level-one features and zero-valued future fixed maps', () => {
    expect(auditEligibilityFixtures({
      targetLevel: 1,
      visibleSpeciesFeatures: [{ name: 'Breath Weapon', sourcePath: 'breath.yml', level: 1, advancementId: 'breath' }],
      classSource: { name: 'Fighter', sourcePath: 'fighter.yml' },
      classAdvancements: [{ id: 'asi', type: 'AbilityScoreImprovement', level: 4, raw: { configuration: { fixed: { str: 0 } } } }],
    })).toEqual([]);
  });

  it.each([
    ['background ability choice', { abilityScores: { points: 3, cap: 2, locked: ['str', 'dex', 'con'] } }, 'choice.background-ability-allocation'],
    ['nested granted feat choice', { featAdvancements: [{ _id: 'spells', type: 'ItemChoice', configuration: { choices: { 0: { count: 2 } }, type: 'spell' } }] }, 'choice.granted-feat-configuration'],
    ['wealth alternative', { startingEquipment: { roots: [{ nodeId: 'gear', type: 'AND', diagnostics: [], children: [] }], diagnostics: [] }, wealth: '50' }, 'equipment.wealth-alternative'],
    ['raw selector presentation', { userFacingValues: ['languages:standard:common'] }, 'presentation.technical-token'],
  ] satisfies Array<[string, Partial<AuditProfileFixture>, string]>)('reports %s', (_label, values, invariant) => {
    const fixture: AuditProfileFixture = { sourceName: 'Acolyte', sourcePath: 'acolyte.yml', ...values };
    expect(auditProfileFixture(fixture).map((finding) => finding.invariant)).toContain(invariant);
  });

  it('accepts resolved presentation, equipment without alternate wealth, and filtered languages', () => {
    const findings = auditProfileFixture({
      sourceName: 'Resolved',
      sourcePath: 'resolved.yml',
      startingEquipment: { roots: [{ nodeId: 'gear', type: 'AND', diagnostics: [], children: [] }], diagnostics: [] },
      knownLanguages: ['languages:standard:common'],
      languagePools: ['languages:standard:*'],
      availableLanguageValues: ['languages:standard:draconic'],
      userFacingValues: ['Common', "Calligrapher's supplies"],
    });
    expect(findings).toEqual([]);
  });

  it('uses the production background language projection when auditing fixed Common', () => {
    expect(auditProfileFixture({ sourceName: 'Acolyte', sourcePath: 'acolyte.yml', knownLanguages: ['languages:standard:common'], languagePools: ['languages:standard:*'] })).toEqual([]);
  });

  it('uses canonical language identity without presentation labels', () => {
    expect(languageSelectorKey('languages:common')).toBe('common');
    expect(languageSelectorKey('languages:standard:common')).toBe('common');
    expect(languageSelectorKey('languages:standard:draconic')).toBe('draconic');
    expect(languageSelectorKey('languages:exotic:primordial:aquan')).toBe('primordial:aquan');
    expect(languageSelectorKey('languages:primordial:aquan')).toBe('primordial:aquan');
  });

  it('canonicalizes only concrete known language selectors', () => {
    expect(canonicalizeLanguageSelector('languages:elvish')).toBe('languages:standard:elvish');
    expect(canonicalizeLanguageSelector('languages:standard:elvish')).toBe('languages:standard:elvish');
    expect(canonicalizeLanguageSelector('languages:primordial:aquan')).toBe('languages:exotic:primordial:aquan');
    expect(canonicalizeLanguageSelector('languages:exotic:primordial:aquan')).toBe('languages:exotic:primordial:aquan');
    expect(canonicalizeLanguageSelector('languages:standard:primordial:aquan')).toBeNull();
    expect(canonicalizeLanguageSelector('languages:standard:*')).toBeNull();
    expect(canonicalizeLanguageSelector('languages:*')).toBeNull();
    expect(canonicalizeLanguageSelector('languages:unknown')).toBeNull();
    expect(canonicalizeLanguageSelector('items:elvish')).toBeNull();
  });

  it('recognizes a nested currency wealth branch', () => {
    const findings = auditProfileFixture({
      sourceName: 'Package',
      sourcePath: 'package.yml',
      wealth: '50',
      startingEquipment: {
        roots: [{ nodeId: 'choice', type: 'OR', diagnostics: [], children: [
          { nodeId: 'gear', type: 'AND', diagnostics: [], children: [{ nodeId: 'coins', type: 'currency', currency: { denomination: 'gp', amount: 8 }, diagnostics: [] }] },
          { nodeId: 'wealth', type: 'currency', currency: { denomination: 'gp', amount: 50 }, diagnostics: [] },
        ] }],
        diagnostics: [],
      },
    });
    expect(findings.map((finding) => finding.invariant)).not.toContain('equipment.wealth-alternative');
  });

  it('reports normalized equipment diagnostics and duplicate node ownership', () => {
    const duplicate = { nodeId: 'same', type: 'linked', diagnostics: ['Unresolved equipment source: missing'] };
    const findings = auditProfileFixture({
      sourceName: 'Broken package',
      sourcePath: 'broken.yml',
      startingEquipment: {
        roots: [
          { nodeId: 'first', type: 'AND', diagnostics: [], children: [duplicate] },
          { nodeId: 'second', type: 'AND', diagnostics: [], children: [duplicate] },
        ],
        diagnostics: ['Equipment node orphan references missing group parent'],
      },
    });
    expect(findings.map((finding) => finding.invariant)).toEqual([
      'equipment.node-diagnostic',
      'equipment.node-diagnostic',
      'equipment.node-diagnostic',
      'equipment.node-ownership',
    ]);
  });

  it('describes unlocked background abilities as the eligible allocation set', () => {
    const [finding] = auditProfileFixture({
      sourceName: 'Acolyte',
      sourcePath: 'acolyte.yml',
      abilityScores: { points: 3, cap: 2, locked: ['str', 'dex', 'con'] },
    });
    expect(finding?.observed).toContain('int, wis, cha');
  });

  it('accepts a complete source-backed background ability allocation', () => {
    const summary = {
      source: { sourcePath: 'acolyte.yml', pack: 'test', type: 'background' as const, id: 'acolyte', name: 'Acolyte' },
      ruleset: '2024' as const,
      abilityScores: { advancementId: 'asi-acolyte', points: 3, cap: 2, locked: ['str', 'dex', 'con'] },
      skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [],
    };
    const configuration = buildBackgroundAbilityConfiguration(summary);
    if (configuration.kind !== 'choice') throw new Error('Expected ability choice');
    const selection = createBackgroundAbilitySelection(configuration, { int: 2, wis: 1 });
    expect(auditProfileFixture({
      sourceName: 'Acolyte', sourcePath: 'acolyte.yml',
      abilityScores: summary.abilityScores,
      abilitySelection: selection,
    })).toEqual([]);
  });

  it('retains the allocation finding for a stale supplied selection', () => {
    const findings = auditProfileFixture({
      sourceName: 'Acolyte', sourcePath: 'acolyte.yml',
      abilityScores: { advancementId: 'asi-acolyte', points: 3, cap: 2, locked: ['str', 'dex', 'con'] },
      abilitySelection: { advancementId: 'stale', assignments: { int: 2, wis: 1 } },
    });
    expect(findings.find(({ invariant }) => invariant === 'choice.background-ability-allocation')?.observed)
      .toBe('Background ability advancement does not match the current source.');
  });

  it('accepts a complete source-backed granted feat selection', () => {
    const configuration: GrantedFeatChoiceConfiguration = {
      kind: 'choice',
      feat: { sourcePath: 'feat.yml', pack: 'test.feats', type: 'feat', id: 'magic-initiate', name: 'Magic Initiate' },
      diagnostics: [],
      spellChoices: [
        { key: 'list', advancementId: 'spell-list', label: 'Spell list', count: 1, level: 0, spellLists: ['cleric'], selected: [], abilityOptions: [], options: [{ value: 'cleric', source: { sourcePath: 'list.yml', pack: 'test', type: 'spell-list', id: 'cleric', name: 'Cleric' }, label: 'Cleric' }], raw: { type: 'spell-list' } },
        { key: 'spells', advancementId: 'spells', label: 'Spells', count: 2, level: 0, spellLists: ['cleric'], selected: [], abilityOptions: ['wis'], options: [
          { value: 'a', source: { sourcePath: 'a.yml', pack: 'test.spells', type: 'spell', id: 'a', name: 'A', level: 0, spellLists: ['cleric'] } as unknown as import('../src/foundry-source-catalog').FoundrySourceReference, label: 'A' },
          { value: 'b', source: { sourcePath: 'b.yml', pack: 'test.spells', type: 'spell', id: 'b', name: 'B', level: 0, spellLists: ['cleric'] } as unknown as import('../src/foundry-source-catalog').FoundrySourceReference, label: 'B' },
        ], raw: { type: 'spell' } },
      ],
    };
    const withList = setGrantedFeatSpellChoice(configuration, 'list', ['cleric']);
    const spellChoice = getAvailableGrantedFeatSpellChoices(withList).find((choice) => choice.key === 'spells')!;
    const withSpells = setGrantedFeatSpellChoice(withList, 'spells', [spellChoice.options[0]!.source, spellChoice.options[1]!.source]);
    const selection = toGrantedFeatSelection(setGrantedFeatSpellcastingAbility(withSpells, 'wis'));
    expect(auditProfileFixture({ sourceName: 'Acolyte', sourcePath: 'acolyte.yml', grantedFeatConfiguration: configuration, grantedFeatSelection: selection }).filter((finding) => finding.invariant.startsWith('choice.'))).toEqual([]);
  });

  it('keeps unresolved eligible dependencies as errors and future ones as warnings', () => {
    const source = { sourcePath: 'monk.yml', pack: 'test.classes', type: 'class' as const, id: 'monk', name: 'Monk' };
    const unresolved = (level: number, id: string) => ({ id, type: 'Trait', level, title: id, hint: '', dependencies: [{ uuid: `missing:${id}`, source: null, reason: 'unresolved source UUID' }], raw: {} });
    expect(dependencyFindings('class', source, [unresolved(1, 'level-one'), unresolved(10, 'future')], 1).map(({ nodeId, severity }) => [nodeId, severity])).toEqual([['level-one', 'error'], ['future', 'warning']]);
  });

  it('selects distinct first-valid spells across overlapping granted-feat choices', () => {
    const shared = { sourcePath: 'shared.yml', pack: 'test.spells', type: 'spell' as const, id: 'shared', name: 'Shared', level: 0, spellLists: ['cleric'] } as unknown as import('../src/foundry-source-catalog').FoundrySourceReference;
    const second = { sourcePath: 'second.yml', pack: 'test.spells', type: 'spell' as const, id: 'second', name: 'Second', level: 0, spellLists: ['cleric'] } as unknown as import('../src/foundry-source-catalog').FoundrySourceReference;
    const configuration = { kind: 'choice' as const, feat: { sourcePath: 'feat.yml', pack: 'test', type: 'feat' as const, id: 'feat', name: 'Feat' }, diagnostics: [], spellChoices: [
      { key: 'list', advancementId: 'spell-list', label: 'List', count: 1, level: 0, spellLists: ['cleric'], selected: [], abilityOptions: [], options: [{ value: 'cleric', source: { sourcePath: 'list.yml', pack: 'test', type: 'spell-list', id: 'cleric', name: 'Cleric' }, label: 'Cleric' }], raw: { type: 'spell-list' } },
      { key: 'first', advancementId: 'first', label: 'First', count: 1, level: 0, spellLists: ['cleric'], selected: [], abilityOptions: ['wis'], options: [{ value: 'shared', source: shared, label: 'Shared' }], raw: { type: 'spell' } },
      { key: 'second', advancementId: 'second', label: 'Second', count: 1, level: 0, spellLists: ['cleric'], selected: [], abilityOptions: ['wis'], options: [{ value: 'shared', source: shared, label: 'Shared' }, { value: 'second', source: second, label: 'Second' }], raw: { type: 'spell' } },
    ] };
    const selection = deterministicGrantedFeatSelection(configuration);
    expect(selection?.spellChoices.slice(1).flatMap((choice) => choice.kind === 'spell' ? choice.selected.map((spell) => spell.id) : [])).toEqual(['shared', 'second']);
  });

  it('reports stale granted-feat configuration without a source-aware completion false positive', () => {
    const configuration = { kind: 'choice' as const, feat: { sourcePath: 'feat.yml', pack: 'test', type: 'feat' as const, id: 'feat', name: 'Feat' }, diagnostics: [], spellChoices: [{ key: 'list', advancementId: 'spell-list', label: 'List', count: 1, level: 0, spellLists: ['cleric'], selected: [], abilityOptions: [], options: [{ value: 'cleric', source: { sourcePath: 'list.yml', pack: 'test', type: 'spell-list', id: 'cleric', name: 'Cleric' }, label: 'Cleric' }], raw: { type: 'spell-list' } }] };
    const document = { ...withRuleset(createCharacterDocument('Audit', { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: '0'.repeat(40), systemVersion: '6.0.0' }), '2024'), step: 'background' as const, origin: { sourcePath: 'species.yml', identifier: 'species', id: 'species' }, classProgressions: [{ class: { sourcePath: 'class.yml', identifier: 'class', id: 'class' }, targetLevel: 1, selections: [] }], background: { sourcePath: 'background.yml', identifier: 'background', id: 'background' }, abilityScores: createDefaultAbilityScores(), backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } } };
    const findings = auditGrantedFeatSelectionConsistency({ sourceName: 'Acolyte', sourcePath: 'acolyte.yml', document, configuration, selection: { feat: configuration.feat, spellChoices: [{ key: 'stale', advancementId: 'stale', kind: 'spell-list', selected: [] }] } });
    expect(getCharacterCreationSections(document, configuration).find((section) => section.id === 'background')?.status).toBe('active');
    expect(findings.map((finding) => finding.invariant)).toEqual(['choice.granted-feat-configuration']);
  });

  it('applies target-level severity to raw background dependencies', async () => {
    const index = { getByUuid: async () => null } as unknown as import('../src/character-sources').SourceIndex;
    const source = { sourcePath: 'background.yml', pack: 'test', type: 'background' as const, id: 'background', name: 'Background' };
    const raw = { system: { advancement: [{ _id: 'eligible', level: 1, configuration: { grants: ['Compendium.test.missing'] } }, { _id: 'future', level: 10, configuration: { grants: ['Compendium.test.future'] } }] } };
    expect((await rawBackgroundDependencyFindings(index, source, raw, 1)).map(({ nodeId, severity }) => [nodeId, severity])).toEqual([['eligible', 'error'], ['future', 'warning']]);
  });

  it('does not treat a fixed Trait advancement as a granted-feat choice', () => {
    expect(auditProfileFixture({
      sourceName: 'Fixed feat', sourcePath: 'fixed.yml',
      featAdvancements: [{ _id: 'fixed', type: 'Trait', configuration: { grants: ['languages:standard:common'] } }],
    })).toEqual([]);
  });

  it('detects a future class feature in the level-one projection', () => {
    expect(auditProjectedClassFeatures({ sourceName: 'Fighter', sourcePath: 'fighter.yml' }, 1, [
      { name: 'Second Wind', level: 1 }, { name: 'Extra Attack', level: 5 },
    ]).map((finding) => finding.invariant)).toEqual(['eligibility.class-feature-level']);
  });

  it('accepts level-one production values after future fixed class bonuses are excluded', () => {
    const summary: ClassSourceSummary = {
      source: { sourcePath: 'barbarian.yml', pack: 'test', type: 'class', id: 'barbarian', name: 'Barbarian' },
      ruleset: '2024', hitDie: 'd12',
      advancements: [{ id: 'champion', type: 'AbilityScoreImprovement', level: 20, title: 'Primal Champion', hint: '', dependencies: [], raw: { configuration: { fixed: { str: 4, con: 4 } } } }],
    };
    const bonuses = collectAbilityBonuses(undefined, summary, { class: { sourcePath: 'barbarian.yml', identifier: 'barbarian', id: 'barbarian' }, targetLevel: 1, selections: [] }, undefined);
    expect(bonuses.class).toEqual({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });
    expect(auditAbilityProjectionConsistency({ targetLevel: 1, bonuses, sourceName: 'Barbarian', sourcePath: 'barbarian.yml' })).toEqual([]);
  });

  it('passes a saved background allocation through both audit creation and sheet projection', () => {
    const document = withRuleset(createCharacterDocument('Audit', { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: '0'.repeat(40), systemVersion: '6.0.0' }), '2024');
    document.abilityScores = { method: 'standard-array', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } };
    document.classProgressions = [{ class: { sourcePath: 'class.yml', identifier: 'fighter', id: 'fighter' }, targetLevel: 1, selections: [] }];
    const source = { sourcePath: 'background.yml', pack: 'test', type: 'background' as const, id: 'soldier', identifier: 'soldier', name: 'Soldier' };
    const species = { source: { sourcePath: 'species.yml', pack: 'test', type: 'race' as const, id: 'elf', name: 'Elf' }, ruleset: '2024' as const, advancements: [] };
    const classSummary = { source: { sourcePath: 'class.yml', pack: 'test', type: 'class' as const, id: 'fighter', name: 'Fighter' }, ruleset: '2024' as const, hitDie: 'd10', advancements: [] };
    const background = { source, ruleset: '2024' as const, abilityScores: { advancementId: 'asi', points: 3, cap: 2, locked: ['str', 'dex', 'con'] }, skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [] };
    const selection = { advancementId: 'asi', assignments: { int: 2, wis: 1 } };
    document.background = { sourcePath: 'background.yml', identifier: 'soldier', id: 'soldier' };
    document.backgroundChoices = { abilityScores: selection };
    const { creation, sheet } = projectAbilityConsumerProjection(document, species, classSummary, background, selection);
    expect(creation.int.final).toBe(14);
    expect(creation.wis.final).toBe(11);
    expect(sheet.abilities.find(({ key }) => key === 'int')?.score).toEqual({ kind: 'available', value: 14 });
    expect(sheet.abilities.find(({ key }) => key === 'wis')?.score).toEqual({ kind: 'available', value: 11 });
  });

  it('detects a known language left in a later option list', () => {
    const options = languageSelectorOptions('languages:standard:*').map((option) => option.value);
    expect(auditLanguageOptionConsistency({ knownLanguages: ['languages:standard:common'], availableLanguages: options, sourceName: 'Acolyte', sourcePath: 'acolyte.yml' }).map((finding) => finding.invariant)).toContain('selector.known-language-overlap');
  });

  it('accepts merged class and background equipment with distinct provenance and currency', () => {
    const item = { sourcePath: 'item.yml', pack: 'test', type: 'equipment', id: 'rope', name: 'Rope' };
    const roots = (nodeId: string, gp: number): EquipmentPackageNode[] => [{ nodeId: `${nodeId}-and`, type: 'AND', diagnostics: [], children: [
      { nodeId: `${nodeId}-item`, type: 'linked', item, quantity: 1, diagnostics: [] },
      { nodeId: `${nodeId}-gp`, type: 'currency', currency: { denomination: 'gp', amount: gp }, diagnostics: [] },
    ] }];
    const classInventory = flattenSelectedEquipment(roots('class', 10), { selected: {}, semantic: {} }, { sourcePath: 'class.yml', packageNodeId: 'class-and' });
    const backgroundInventory = flattenSelectedEquipment(roots('background', 5), { selected: {}, semantic: {} }, { sourcePath: 'background.yml', packageNodeId: 'background-and' });
    const merged = mergeInventories(classInventory, backgroundInventory);
    expect(auditEquipmentMergeConsistency({ inventory: merged, expectedSourcePaths: ['class.yml', 'background.yml'], expectedCurrency: { gp: 15 }, sourceName: 'Class + background', sourcePath: 'interaction/equipment' })).toEqual([]);
  });

  it('accepts a projected feature list that contains each grant once', () => {
    expect(auditFeatureProjectionConsistency({ featureKeys: ['rage', 'darkvision'], sourceName: 'Projection', sourcePath: 'interaction/features' })).toEqual([]);
    expect(auditFeatureProjectionConsistency({ featureKeys: ['rage', 'rage'], sourceName: 'Projection', sourcePath: 'interaction/features' }).map((finding) => finding.invariant)).toContain('presentation.duplicate-grant');
  });

  it('detects a choice-bearing feat while the production journey marks background complete', () => {
    const document = withRuleset(createCharacterDocument('Audit', { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: '0'.repeat(40), systemVersion: '6.0.0' }), '2024');
    document.origin = { sourcePath: 'species.yml', identifier: 'species', id: 'species' };
    document.classProgressions = [{ class: { sourcePath: 'class.yml', identifier: 'class', id: 'class' }, targetLevel: 1, selections: [] }];
    document.background = { sourcePath: 'acolyte.yml', identifier: 'acolyte', id: 'acolyte' };
    document.backgroundChoices = { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } };
    const backgroundComplete = getCharacterCreationSections(document).find((section) => section.id === 'background')?.status === 'complete';
    expect(auditBackgroundCompletionConsistency({ requiresFeatChoice: true, backgroundComplete, sourceName: 'Acolyte', sourcePath: 'acolyte.yml' }).map((finding) => finding.invariant)).toContain('choice.background-completion');
  });
});
