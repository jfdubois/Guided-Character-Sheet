import { describe, expect, it } from 'vitest';
import type { AbilityScoreResults } from '../src/ability-scores';
import type { CharacterDocument } from '../src/character-model';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from '../src/character-sources';
import { buildGrantedFeatConfiguration } from '../src/granted-feat-configuration';
import type { FoundrySpellSummary, FoundrySourceReference } from '../src/foundry-source-catalog';
import { projectSpellSheet } from '../src/spell-sheet-model';

const ref = (id: string, name: string): FoundrySourceReference => ({ sourcePath: `packs/_source/spells/${id}.yml`, pack: 'dnd5e.spells', type: 'spell', id, name });
const spell = (id: string, name: string, level: number): FoundrySpellSummary => ({ ...ref(id, name), ruleset: '2024', level, spellLists: ['wizard'], ritual: false });
const abilityResults = { int: { base: 16, bonuses: [], final: 16, modifier: 3 }, str: { base: 8, bonuses: [], final: 8, modifier: -1 }, dex: { base: 14, bonuses: [], final: 14, modifier: 2 }, con: { base: 12, bonuses: [], final: 12, modifier: 1 }, wis: { base: 10, bonuses: [], final: 10, modifier: 0 }, cha: { base: 10, bonuses: [], final: 10, modifier: 0 } } as unknown as AbilityScoreResults;
const classSource = { source: { sourcePath: 'packs/_source/classes24/wizard.yml', pack: 'dnd5e.classes24', type: 'class', id: 'wizard', name: 'Wizard', identifier: 'wizard' }, ruleset: '2024', hitDie: 'd6', advancements: ['cantrips', 'class-magic', 'first', 'known', 'second', 'ward'].map((id) => ({ id, type: 'ItemChoice', level: 1, title: id, hint: '', dependencies: [], raw: {} })), spellcasting: { ability: 'int', progression: 'full', spellSlots: { '1': 2 } }, spellOptions: [], features: [] } as unknown as ClassSourceSummary;
const speciesSource = { source: { sourcePath: 'packs/_source/origins24/species/elf.yml', pack: 'dnd5e.origins24', type: 'race', id: 'elf', name: 'Elf', identifier: 'elf' }, ruleset: '2024', advancements: [{ id: 'magic', type: 'ItemChoice', level: 1, title: 'Magic', hint: '', automatic: false, dependencies: [], raw: {} }] } as unknown as SpeciesSourceSummary;
const document: CharacterDocument = { format: 1, kind: 'guided-character', name: 'Ayla', ruleset: '2024', step: 'background', foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, classProgressions: [{ class: { sourcePath: classSource.source.sourcePath, identifier: 'wizard', id: 'wizard' }, targetLevel: 1, selections: [] }] };

describe('spell sheet projection', () => {
  it('adds an eligible cantrip contribution to the authoritative class capacity', () => {
    const classWithCapacity = { ...classSource, spellcasting: { ...classSource.spellcasting, cantripsKnown: 3 } } as ClassSourceSummary;
    const result = projectSpellSheet(document, { class: classWithCapacity, progression: document.classProgressions![0], spellSummaries: new Map(), passiveEffects: [{ source: { sourcePath: 'choice.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'order', name: 'Thaumaturge' }, key: 'system.scale.cleric.cantrips-known.value', target: 'cantrip-capacity', operation: 'add', value: 1 }] });
    expect(result.cantripCapacity).toBe(4);
  });

  it('loads eligible fixed species grants and preserves free-use metadata independently of slots', () => {
    const lineage = spell('lineage', 'Lineage Spell', 0);
    lineage.preparation = 'always';
    const species = { ...speciesSource, spellGrants: [{ advancementId: 'lineage', level: 0, spells: [lineage], abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'], preparation: 'always', uses: { max: '@prof', per: 'lr', requireSlot: false }, raw: { configuration: { spell: { preparation: 'always', uses: { max: '@prof', per: 'lr', requireSlot: false } } } } }] };
    const selected = structuredClone(document);
    selected.speciesConfiguration = { origin: { sourcePath: species.source.sourcePath, identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [], spellcastingAbility: { advancementIds: ['lineage'], selected: 'Wisdom' } };
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, species, progression: selected.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map([[refKey(lineage), lineage]]) });
    expect(result.cantrips).toMatchObject([{ name: 'Lineage Spell', ownership: ['species-granted'], prepared: { kind: 'available', value: true }, grantPreparation: 'always', grantRequireSlot: false }]);
    expect(result.freeUses).toMatchObject([{ name: 'Lineage Spell', maximum: 2, recoveryPeriod: 'lr' }]);
  });

  it('treats source-defined always-prepared spells as prepared without changing mutable state', () => {
    const light = spell('light', 'Light', 0); light.preparation = 'always';
    const preparedLevelOne = spell('shield', 'Shield', 1); preparedLevelOne.preparation = 'prepared';
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [
      { advancementId: 'cantrips', kind: 'spell', selectionRole: 'cantrips-known', selected: [light] },
      { advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [preparedLevelOne] },
    ];
    const before = structuredClone(selected);
    const result = projectSpellSheet(selected, { class: classSource, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(light), light], [refKey(preparedLevelOne), preparedLevelOne]]) });
    expect(result.cantrips).toMatchObject([{ name: 'Light', prepared: { kind: 'available', value: true } }]);
    expect(result.levels[0]!.spells).toMatchObject([{ name: 'Shield', prepared: { kind: 'available', value: false } }]);
    expect(selected).toEqual(before);
  });
  it('derives a single fixed species ability when reopening without persisted choice', () => {
    const selected = structuredClone(document);
    const species = { ...speciesSource, spellGrants: [{ advancementId: 'fixed', level: 1, spells: [], abilityOptions: ['Wisdom'], raw: {} }] };
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, species, progression: selected.classProgressions![0], abilityResults, spellSummaries: new Map() });
    expect(result.castingAbility).toEqual({ kind: 'available', value: 'Wisdom' });
    expect(result.spellModifier).toEqual({ kind: 'available', value: 0 });
  });
  function backgroundFixture(): { background: BackgroundSourceSummary; selected: CharacterDocument; summaries: ReadonlyMap<string, FoundrySpellSummary>; refs: { guidance: FoundrySourceReference; sacred: FoundrySourceReference; bless: FoundrySourceReference } } {
    const guidance = spell('guidance', 'Guidance', 0); const sacred = spell('sacred-flame', 'Sacred Flame', 0); const bless = spell('bless', 'Bless', 1);
    guidance.spellLists = ['cleric']; sacred.spellLists = ['cleric']; bless.spellLists = ['cleric'];
    const feat = { ...ref('magic-initiate', 'Magic Initiate'), type: 'feat' as const, identifier: 'magic-initiate' };
    const background: BackgroundSourceSummary = { source: { sourcePath: 'packs/_source/backgrounds/sage.yml', pack: 'dnd5e.backgrounds', type: 'background', id: 'sage', name: 'Sage', identifier: 'sage' }, ruleset: '2024', skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [], grantedFeat: { source: feat, advancements: [
      { id: 'cantrips', type: 'ItemChoice', title: 'Cantrips', hint: '', dependencies: [{ uuid: guidance.id, source: guidance }, { uuid: sacred.id, source: sacred }], spellLevel: 0, spellLists: ['cleric'], abilityOptions: ['wis'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 2 } } },
      { id: 'spell', type: 'ItemChoice', title: 'Spell', hint: '', dependencies: [{ uuid: bless.id, source: bless }], spellLevel: 1, spellLists: ['cleric'], abilityOptions: ['wis'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 1, spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } },
    ] } };
    const configuration = buildGrantedFeatConfiguration(background.grantedFeat)!;
    if (configuration.kind !== 'choice') throw new Error('expected feat choice');
    const selected = structuredClone(document); selected.background = { ...background.source, identifier: 'sage' }; selected.backgroundChoices = { grantedFeat: { feat, spellChoices: [
      { key: configuration.spellChoices[0]!.key, advancementId: 'spell-list', kind: 'spell-list', selected: ['cleric'] },
      { key: configuration.spellChoices[1]!.key, advancementId: 'cantrips', kind: 'spell', selected: [configuration.spellChoices[1]!.options[0]!.source, configuration.spellChoices[1]!.options[1]!.source], selectedAbility: 'wis' },
      { key: configuration.spellChoices[2]!.key, advancementId: 'spell', kind: 'spell', selected: [configuration.spellChoices[2]!.options[0]!.source], selectedAbility: 'wis' },
    ] } };
    return { background, selected, summaries: new Map([[refKey(guidance), guidance], [refKey(sacred), sacred], [refKey(bless), bless]]), refs: { guidance, sacred, bless } };
  }

  function projectBackgroundFixture(fixture: ReturnType<typeof backgroundFixture>): ReturnType<typeof projectSpellSheet> {
    return projectSpellSheet(fixture.selected, { class: { ...classSource, spellcasting: undefined }, background: fixture.background, progression: fixture.selected.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: fixture.summaries });
  }

  it('reconstructs roles, deduplicates prepared and granted spells, groups levels, and derives casting values', () => {
    const bolt = spell('bolt', 'Arcane Bolt', 1);
    const ward = spell('ward', 'Arcane Ward', 1);
    const cantrip = spell('spark', 'Spark', 0);
    const withSelections: CharacterDocument = structuredClone(document);
    withSelections.classProgressions![0]!.selections = [
      { advancementId: 'cantrips', kind: 'spell', selectionRole: 'cantrips-known', selected: [cantrip] },
      { advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [bolt] },
    ];
    const sourceMap = new Map([[refKey(bolt), bolt], [refKey(ward), ward], [refKey(cantrip), cantrip]]);
    const result = projectSpellSheet(withSelections, { class: classSource, species: speciesSource, progression: withSelections.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: sourceMap, grantedSpells: [ward, bolt] });
    expect(result.levels[0]).toMatchObject({ level: 1, slots: { maximum: 2, expended: { kind: 'missing' } } });
    expect(result.levels[0]!.spells.map((entry) => entry.name)).toEqual(['Arcane Bolt', 'Arcane Ward']);
    expect(result.cantrips[0]!.name).toBe('Spark');
    expect(result.spellAttack).toEqual({ kind: 'available', value: 5 });
    expect(result.saveDc).toEqual({ kind: 'available', value: 13 });
  });
  it('uses persisted slot expenditure and free-use current values', () => {
    const ward = spell('ward-current', 'Arcane Ward', 1);
    ward.uses = { maximum: 1, recovery: [{ period: 'lr' }] };
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [{ advancementId: 'ward', kind: 'spell', selectionRole: 'known-spells', selected: [ward] }];
    selected.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], spellSlots: [{ level: 1, current: 1, maximum: 2 }], spellUses: [{ key: refKey(ward), current: 0, maximum: 1, reset: 'long-rest' }] };
    const result = projectSpellSheet(selected, { class: classSource, progression: selected.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map([[refKey(ward), ward]]) });
    expect(result.levels[0]!.slots.expended).toEqual({ kind: 'available', value: 1 });
    expect(result.freeUses[0]!.current).toEqual({ kind: 'available', value: 0 });
  });

  it('preserves stale non-cantrip references in an unresolved group without inventing level one', () => {
    const stale = ref('stale', 'Missing Spell');
    const before = structuredClone(document);
    const staleDocument = structuredClone(document);
    staleDocument.classProgressions![0]!.selections = [{ advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [stale] }];
    const result = projectSpellSheet(staleDocument, { class: classSource, progression: staleDocument.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map() });
    expect(result.unresolvedSpells).toMatchObject([{ name: 'Missing Spell', source: { kind: 'missing', reason: expect.stringMatching(/source/i) }, reason: expect.stringMatching(/level/i) }]);
    expect(result.levels.flatMap((level) => level.spells)).toEqual([]);
    expect(staleDocument).toEqual({ ...before, classProgressions: [{ ...before.classProgressions![0], selections: [{ advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [stale] }] }] });
  });

  it('deduplicates one stale reference across selected and prepared spell paths', () => {
    const stale = ref('stale', 'Missing Spell');
    const duplicateDocument = structuredClone(document);
    duplicateDocument.classProgressions![0]!.selections = [{ advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [stale] }];
    duplicateDocument.mutable = { preparedSpells: [stale], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] };
    const result = projectSpellSheet(duplicateDocument, { class: classSource, progression: duplicateDocument.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map() });
    expect(result.unresolvedSpells).toHaveLength(1);
    expect(result.warnings.filter((warning) => warning.includes('Missing Spell'))).toHaveLength(1);
  });

  it('derives explicit spell free-use maximums while leaving expenditure unavailable', () => {
    const ward = spell('ward', 'Arcane Ward', 1);
    ward.uses = { maximum: 1, recovery: [{ period: 'sr' }] };
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [{ advancementId: 'ward', kind: 'spell', selectionRole: 'known-spells', selected: [ward] }];
    const result = projectSpellSheet(selected, { class: classSource, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(ward), ward]]) });
    expect(result.levels[0]!.slots.expended).toEqual({ kind: 'missing', reason: expect.stringMatching(/expenditure/i) });
    expect(result.freeUses[0]!.current).toEqual({ kind: 'missing', reason: expect.stringMatching(/use/i) });
    expect(result.freeUses[0]!.maximum).toBe(1);
    expect(result.freeUses[0]!.recoveryPeriod).toBe('sr');
  });

  it('keeps free-use periods attached to each granting advancement', () => {
    const first = spell('first-grant', 'First Grant', 1); const second = spell('second-grant', 'Second Grant', 1);
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [
      { advancementId: 'first', kind: 'spell', selectionRole: 'known-spells', selected: [first], raw: { configuration: { spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } },
      { advancementId: 'second', kind: 'spell', selectionRole: 'known-spells', selected: [second], raw: { configuration: { spell: { uses: { max: 2, per: 'sr', requireSlot: false } } } } },
    ];
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(first), first], [refKey(second), second]]) });
    expect(result.levels.flatMap((level) => level.spells).map((row) => row.name)).toEqual(['First Grant', 'Second Grant']);
    expect(result.levels.flatMap((level) => level.spells).map((row) => ({ name: row.name, grantMaximum: row.grantMaximum, grantRecoveryPeriod: row.grantRecoveryPeriod }))).toEqual([{ name: 'First Grant', grantMaximum: 1, grantRecoveryPeriod: 'lr' }, { name: 'Second Grant', grantMaximum: 2, grantRecoveryPeriod: 'sr' }]);
    expect(result.freeUses.map((use) => ({ name: use.name, maximum: use.maximum, recoveryPeriod: use.recoveryPeriod }))).toEqual([{ name: 'First Grant', maximum: 1, recoveryPeriod: 'lr' }, { name: 'Second Grant', maximum: 2, recoveryPeriod: 'sr' }]);
  });

  it('derives a grant-level decimal-string free-use maximum only when requireSlot is false', () => {
    const granted = spell('magic-initiate', 'Magic Initiate Spell', 1);
    const selected = structuredClone(document);
    selected.speciesConfiguration = { origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'magic', advancementId: 'magic', kind: 'spell', selected: [granted], selectedAbility: 'wisdom' }] };
    const speciesWithGrant = { ...speciesSource, advancements: [{ id: 'magic', type: 'ItemChoice', level: 1, title: 'Magic', hint: '', dependencies: [], raw: { configuration: { spell: { uses: { max: '1', per: 'lr', requireSlot: false } } } } }] } as unknown as SpeciesSourceSummary;
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, progression: selected.classProgressions![0], species: speciesWithGrant, spellSummaries: new Map([[refKey(granted), granted]]) });
    expect(result.freeUses).toMatchObject([{ name: 'Magic Initiate Spell', maximum: 1, recoveryPeriod: 'lr', current: { kind: 'missing' } }]);
  });

  it('projects valid background-granted feat spells and its casting profile', () => {
    const guidance = spell('guidance', 'Guidance', 0);
    const sacredFlame = spell('sacred-flame', 'Sacred Flame', 0);
    const bless = spell('bless', 'Bless', 1);
    guidance.spellLists = ['cleric']; sacredFlame.spellLists = ['cleric']; bless.spellLists = ['cleric'];
    const feat = { ...ref('magic-initiate', 'Magic Initiate'), type: 'feat' as const, identifier: 'magic-initiate' };
    const background: BackgroundSourceSummary = {
      source: { sourcePath: 'packs/_source/backgrounds/sage.yml', pack: 'dnd5e.backgrounds', type: 'background', id: 'sage', name: 'Sage' }, ruleset: '2024', skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [],
      grantedFeat: { source: feat, advancements: [
        { id: 'cantrips', type: 'ItemChoice', title: 'Cantrips', hint: '', dependencies: [{ uuid: 'guidance', source: guidance }], spellLevel: 0, spellLists: ['cleric'], abilityOptions: ['wis'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 2, spell: { uses: { requireSlot: true } } } } },
        { id: 'spell', type: 'ItemChoice', title: 'Spell', hint: '', dependencies: [{ uuid: 'bless', source: bless }], spellLevel: 1, spellLists: ['cleric'], abilityOptions: ['wis'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 1, spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } },
      ] },
    };
    const grantedFeat = background.grantedFeat!;
    grantedFeat.advancements[0]!.dependencies.push({ uuid: 'sacred-flame', source: sacredFlame });
    const configuration = buildGrantedFeatConfiguration(grantedFeat);
    if (configuration.kind !== 'choice') throw new Error('expected choice configuration');
    const cantripGuidance = configuration.spellChoices[1]!.options[0]!.source;
    const cantripSacredFlame = configuration.spellChoices[1]!.options[1]!.source;
    const levelOneBless = configuration.spellChoices[2]!.options[0]!.source;
    const selected = structuredClone(document);
    selected.background = { ...background.source, identifier: 'sage' };
    selected.backgroundChoices = { grantedFeat: { feat, spellChoices: [
      { key: configuration.spellChoices[0]!.key, advancementId: 'spell-list', kind: 'spell-list', selected: ['cleric'] },
      { key: configuration.spellChoices[1]!.key, advancementId: 'cantrips', kind: 'spell', selected: [cantripGuidance, cantripSacredFlame], selectedAbility: 'wis' },
      { key: configuration.spellChoices[2]!.key, advancementId: 'spell', kind: 'spell', selected: [levelOneBless], selectedAbility: 'wis' },
    ] } };
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, background, progression: selected.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map([[refKey(guidance), guidance], [refKey(sacredFlame), sacredFlame], [refKey(bless), bless]]) });
    expect(result.cantrips.map((row) => row.name)).toEqual(['Guidance', 'Sacred Flame']);
    expect(result.levels.find((entry) => entry.level === 1)?.spells.map((row) => row.name)).toEqual(['Bless']);
    expect(result.castingAbility).toEqual({ kind: 'available', value: 'wis' });
    expect(result.freeUses).toContainEqual(expect.objectContaining({ name: 'Bless', maximum: 1 }));
  });

  it('keeps a prepared-only stale reference visible with prepared ownership and an unavailable source', () => {
    const prepared = ref('prepared-only', 'Prepared but Missing');
    const preparedDocument = structuredClone(document);
    preparedDocument.mutable = { preparedSpells: [prepared], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] };
    const result = projectSpellSheet(preparedDocument, { class: classSource, progression: preparedDocument.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map() });
    expect(result.unresolvedSpells[0]).toMatchObject({ name: 'Prepared but Missing', source: { kind: 'missing' }, reason: expect.stringMatching(/level/i) });
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Prepared but Missing/)]));
  });

  it('uses a persisted species spell choice ability for species-granted spells', () => {
    const speciesDocument = structuredClone(document);
    const speciesSpell = spell('species-light', 'Species Light', 1);
    speciesDocument.speciesConfiguration = { origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'magic', advancementId: 'magic', kind: 'spell', selected: [speciesSpell], selectedAbility: 'wisdom' }] };
    const result = projectSpellSheet(speciesDocument, { class: { ...classSource, spellcasting: undefined }, progression: speciesDocument.classProgressions![0], species: speciesSource, abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map([[refKey(speciesSpell), speciesSpell]]) });
    expect(result.kind).toBe('available');
    expect(result.castingAbility).toEqual({ kind: 'available', value: 'wisdom' });
    expect(result.spellAttack).toEqual({ kind: 'available', value: 2 });
  });

  it('projects no background spells for stale feat, advancement, incomplete, or wrong-list selections', () => {
    const cases = [
      (fixture: ReturnType<typeof backgroundFixture>) => { fixture.selected.backgroundChoices!.grantedFeat!.feat.id = 'stale-feat'; },
      (fixture: ReturnType<typeof backgroundFixture>) => { fixture.selected.backgroundChoices!.grantedFeat!.spellChoices[1]!.advancementId = 'stale-advancement'; },
      (fixture: ReturnType<typeof backgroundFixture>) => { fixture.selected.backgroundChoices!.grantedFeat!.spellChoices[2]!.selected = []; },
      (fixture: ReturnType<typeof backgroundFixture>) => { fixture.selected.backgroundChoices!.grantedFeat!.spellChoices[0]!.selected = ['wizard']; },
    ];
    for (const mutate of cases) { const fixture = backgroundFixture(); mutate(fixture); const result = projectBackgroundFixture(fixture); expect(result.cantrips).toEqual([]); expect(result.levels.flatMap((level) => level.spells)).toEqual([]); expect(result.freeUses).toEqual([]); expect(result.castingAbility).toEqual({ kind: 'missing', reason: expect.stringMatching(/unavailable/i) }); }
  });

  it('preserves class-only and species-granted projections when background is absent or invalid', () => {
    const fixture = backgroundFixture();
    const classSpell = fixture.refs.bless;
    const classDocument = structuredClone(document);
    classDocument.classProgressions![0]!.selections = [{ advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [classSpell], selectedAbility: 'intelligence' }];
    const classResult = projectSpellSheet(classDocument, { class: classSource, progression: classDocument.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: fixture.summaries });
    expect(classResult.levels.flatMap((level) => level.spells).map((row) => [row.name, row.ownership])).toEqual([['Bless', ['known-spells']]]);
    expect(classResult.castingAbility).toEqual({ kind: 'available', value: 'intelligence' });
    const speciesDocument = structuredClone(document); speciesDocument.speciesConfiguration = { origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'magic', advancementId: 'magic', kind: 'spell', selected: [fixture.refs.bless], selectedAbility: 'wisdom' }] };
    const speciesResult = projectSpellSheet(speciesDocument, { class: { ...classSource, spellcasting: undefined }, species: speciesSource, progression: speciesDocument.classProgressions![0], abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: fixture.summaries });
    expect(speciesResult.levels.flatMap((level) => level.spells).map((row) => [row.name, row.ownership])).toEqual([['Bless', ['granted']]]);
    expect(speciesResult.castingAbility).toEqual({ kind: 'available', value: 'wisdom' });
    fixture.selected.backgroundChoices!.grantedFeat!.spellChoices[2]!.selected = [];
    const invalidBackground = projectBackgroundFixture(fixture);
    expect(invalidBackground.cantrips).toEqual([]); expect(invalidBackground.levels.flatMap((level) => level.spells)).toEqual([]);
  });

  it('marks conflicting class and species casting abilities unavailable', () => {
    const conflictDocument = structuredClone(document);
    const speciesSpell = spell('species-light', 'Species Light', 1);
    const classSpell = spell('class-light', 'Class Light', 1);
    conflictDocument.classProgressions![0]!.selections = [{ advancementId: 'class-magic', kind: 'spell', selectionRole: 'known-spells', selected: [classSpell], selectedAbility: 'intelligence' }];
    conflictDocument.speciesConfiguration = { origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'magic', advancementId: 'magic', kind: 'spell', selected: [speciesSpell], selectedAbility: 'wisdom' }] };
    const result = projectSpellSheet(conflictDocument, { class: classSource, progression: conflictDocument.classProgressions![0], species: speciesSource, abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map([[refKey(classSpell), classSpell], [refKey(speciesSpell), speciesSpell]]) });
    expect(result.castingAbility).toEqual({ kind: 'missing', reason: expect.stringMatching(/conflict/i) });
    expect(result.spellAttack).toEqual({ kind: 'missing', reason: expect.stringMatching(/spellcasting/i) });
  });

  it('does not let a class-selected ability hide a conflicting species-selected profile', () => {
    const conflictDocument = structuredClone(document);
    const classSpell = spell('class-light', 'Class Light', 1);
    const speciesSpell = spell('species-light', 'Species Light', 1);
    conflictDocument.classProgressions![0]!.selections = [{ advancementId: 'class-magic', kind: 'spell', selectionRole: 'known-spells', selected: [classSpell], selectedAbility: 'intelligence' }];
    conflictDocument.speciesConfiguration = { origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'magic', advancementId: 'magic', kind: 'spell', selected: [speciesSpell], selectedAbility: 'wisdom' }] };
    const result = projectSpellSheet(conflictDocument, { class: classSource, progression: conflictDocument.classProgressions![0], species: speciesSource, abilityResults, proficiencyBonus: { kind: 'available', value: 2 }, spellSummaries: new Map([[refKey(classSpell), classSpell], [refKey(speciesSpell), speciesSpell]]) });
    expect(result.castingAbility).toEqual({ kind: 'missing', reason: expect.stringMatching(/conflict/i) });
    expect(result.spellModifier).toEqual({ kind: 'missing', reason: expect.stringMatching(/conflict/i) });
  });

  it('does not project a persisted class spell choice above the target level', () => {
    const future = spell('future-class', 'Future Class Spell', 1);
    const source = { ...classSource, advancements: [{ id: 'future', type: 'ItemChoice', level: 3, title: 'Future', hint: '', dependencies: [{ uuid: future.id, source: future }], raw: { configuration: { type: 'spell', spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } }] };
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [{ advancementId: 'future', kind: 'spell', selectionRole: 'known-spells', selected: [future] }];
    const result = projectSpellSheet(selected, { class: source, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(future), future]]) });
    expect(result.levels.flatMap((level) => level.spells)).toEqual([]);
    expect(result.freeUses).toEqual([]);
  });

  it('does not project a persisted species spell choice above the target level', () => {
    const future = spell('future-species', 'Future Species Spell', 1);
    const source = { ...speciesSource, advancements: [{ id: 'future', type: 'ItemChoice', level: 3, title: 'Future', hint: '', automatic: false, dependencies: [{ uuid: future.id, source: future }], raw: { configuration: { type: 'spell', spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } }] };
    const selected = structuredClone(document);
    selected.speciesConfiguration = { origin: { sourcePath: speciesSource.source.sourcePath, identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'future', advancementId: 'future', kind: 'spell', selected: [future] }] };
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, species: source, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(future), future]]) });
    expect(result.levels.flatMap((level) => level.spells)).toEqual([]);
    expect(result.freeUses).toEqual([]);
  });

  it('does not project a fixed species grant above the target level', () => {
    const future = spell('future-fixed-species', 'Future Fixed Species Spell', 1);
    const selected = structuredClone(document);
    const source = { ...speciesSource, spellGrants: [{ advancementId: 'future-fixed', level: 3, spells: [future], abilityOptions: ['Wisdom'], raw: { configuration: { spell: { uses: { max: 1, per: 'lr', requireSlot: false } } } } }] };
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, species: source, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(future), future]]) });
    expect(result.levels.flatMap((level) => level.spells)).toEqual([]);
    expect(result.freeUses).toEqual([]);
  });

  it('rejects unknown class and species spell choices from authoritative empty summaries', () => {
    const staleClass = spell('stale-class', 'Stale Class Spell', 1);
    const staleSpecies = spell('stale-species', 'Stale Species Spell', 1);
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [{ advancementId: 'stale-class', kind: 'spell', selectionRole: 'known-spells', selected: [staleClass] }];
    selected.speciesConfiguration = { origin: { sourcePath: speciesSource.source.sourcePath, identifier: 'elf', id: 'elf' }, foundry: { systemVersion: '6', sourceBranch: '6', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [{ key: 'stale-species', advancementId: 'stale-species', kind: 'spell', selected: [staleSpecies] }] };
    const result = projectSpellSheet(selected, { class: { ...classSource, advancements: [] }, species: { ...speciesSource, advancements: [] }, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(staleClass), staleClass], [refKey(staleSpecies), staleSpecies]]) });
    expect(result.levels.flatMap((level) => level.spells)).toEqual([]);
  });

  it('projects spell overlays, preserves independent grants, and removes prepared-only entries', () => {
    const removed = spell('removed', 'Removed', 1);
    const added = spell('added', 'Added', 1);
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [{ advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [removed] }];
    selected.mutable = { preparedSpells: [removed], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], spellOverlay: { added: [{ reference: added, ownership: 'spellbook' }], removed: [removed] } };
    const result = projectSpellSheet(selected, { class: { ...classSource, spellcasting: undefined }, progression: selected.classProgressions![0], grantedSpells: [removed], spellSummaries: new Map([[refKey(removed), removed], [refKey(added), added]]) });
    expect(result.levels.flatMap((level) => level.spells).map((row) => [row.name, row.ownership])).toEqual([['Added', ['spellbook']], ['Removed', ['granted']]]);
  });

  it('preserves unresolved diagnostics for an added overlay spell', () => {
    const added = ref('overlay-missing', 'Overlay Missing');
    const selected = structuredClone(document);
    selected.mutable = { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [], spellOverlay: { added: [{ reference: added, ownership: 'known-spells' }], removed: [] } };
    const result = projectSpellSheet(selected, { class: classSource, progression: selected.classProgressions![0], spellSummaries: new Map() });
    expect(result.unresolvedSpells).toMatchObject([{ name: 'Overlay Missing', ownership: ['known-spells'], source: { kind: 'missing' } }]);
    expect(result.warnings).toContain('Spell source unavailable: Overlay Missing');
  });

  it('projects preparation capacity and blocks above-level and capacity-exhausted rows', () => {
    const first = spell('first-prepared', 'First Prepared', 1);
    const second = spell('second-prepared', 'Second Prepared', 1);
    const future = spell('future-prepared', 'Future Prepared', 2);
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [{ advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [first, second, future] }];
    selected.mutable = { preparedSpells: [first], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] };
    const source = { ...classSource, spellcasting: { ability: 'int', progression: 'full', preparedSpells: 1, spellSlots: { '1': 2 } } } as unknown as ClassSourceSummary;
    const result = projectSpellSheet(selected, { class: source, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(first), first], [refKey(second), second], [refKey(future), future]]) });
    expect(result.preparedCount).toBe(1);
    expect(result.preparedCapacity).toBe(1);
    expect(result.highestCastableSpellLevel).toBe(1);
    expect(result.levels.flatMap((level) => level.spells)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Second Prepared', preparationBlockedReason: 'Prepared spell capacity has been reached.' }),
      expect.objectContaining({ name: 'Future Prepared', preparationBlockedReason: 'Spell level is above the highest castable spell level.' }),
    ]));
  });

  it('does not count cantrips toward leveled spell preparation capacity', () => {
    const cantrip = spell('ray-of-frost', 'Ray of Frost', 0);
    const leveled = spell('shield', 'Shield', 1);
    const selected = structuredClone(document);
    selected.classProgressions![0]!.selections = [
      { advancementId: 'cantrips', kind: 'spell', selectionRole: 'cantrips-known', selected: [cantrip] },
      { advancementId: 'known', kind: 'spell', selectionRole: 'known-spells', selected: [leveled] },
    ];
    selected.mutable = { preparedSpells: [cantrip], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] };
    const source = { ...classSource, spellcasting: { ability: 'int', progression: 'full', preparedSpells: 1, spellSlots: { '1': 2 } } } as unknown as ClassSourceSummary;
    const result = projectSpellSheet(selected, { class: source, progression: selected.classProgressions![0], spellSummaries: new Map([[refKey(cantrip), cantrip], [refKey(leveled), leveled]]) });

    expect(result.preparedCount).toBe(0);
    expect(result.cantrips[0]?.preparationBlockedReason).toBeUndefined();
    expect(result.levels[0]?.spells[0]?.preparationBlockedReason).toBeUndefined();
  });
});

function refKey(value: FoundrySourceReference): string { return `${value.sourcePath}:${value.pack}:${value.type}:${value.id}`; }
