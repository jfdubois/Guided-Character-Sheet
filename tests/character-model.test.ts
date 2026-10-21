import { describe, expect, it } from 'vitest';
import { createCharacterDocument, parseCharacterDocument, withAbilityScores, withBackground, withBackgroundAbilityScores, withBackgroundGrantedFeat, withBackgroundLanguages, withClassProgression, withName, withOrigin, withRuleset, withSpeciesConfiguration, withStandardArrayDraft, withRolledAbilityDraft, withPointBuyDraft, type CharacterDocument } from '../src/character-model';
import { createDefaultAbilityScores, createPointBuyAbilityScores } from '../src/ability-scores';
import { createInitialMutableCharacterState } from '../src/mutable-character-state';
import { createSpeciesConfiguration, setSpeciesChoice, setSpeciesSize, toSpeciesConfigurationSelection } from '../src/species-configuration';
import type { BackgroundAbilityChoiceConfiguration } from '../src/background-ability-configuration';
import { buildGrantedFeatConfiguration, setGrantedFeatSpellChoice, setGrantedFeatSpellcastingAbility, toGrantedFeatSelection, type GrantedFeatChoiceConfiguration } from '../src/granted-feat-configuration';
import type { GrantedFeatSourceSummary } from '../src/character-sources';
import type { FoundrySourceReference } from '../src/foundry-source-catalog';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
const origin24 = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
const fighter24 = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
const sage24 = { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' };
const soldier24 = { sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', identifier: 'soldier', id: 'soldier-id' };
const choiceConfiguration: BackgroundAbilityChoiceConfiguration = { kind: 'choice', advancementId: 'asi', points: 3, cap: 2, eligibleAbilities: ['int', 'wis', 'cha'], fixed: {} };
const featSource: GrantedFeatSourceSummary = {
  source: { sourcePath: 'packs/_source/feats24/magic-initiate.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'magic-initiate', name: 'Magic Initiate' },
  advancements: [{ id: 'cantrips', type: 'ItemChoice', title: 'Cantrips', hint: '', dependencies: [{ uuid: 'Compendium.dnd5e.spells.Item.guidance', source: { sourcePath: 'packs/_source/spells24/guidance.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'guidance', name: 'Guidance', level: 0, spellLists: ['cleric'] } as FoundrySourceReference }], spellLevel: 0, spellLists: ['cleric'], abilityOptions: ['wis'], raw: { type: 'ItemChoice', configuration: { type: 'spell', choices: 1 } } }],
};
function featConfiguration(): GrantedFeatChoiceConfiguration {
  const built = buildGrantedFeatConfiguration(featSource);
  if (built.kind !== 'choice') throw new Error('Expected feat choice configuration');
  let configured = setGrantedFeatSpellChoice(built, built.spellChoices[0]!.key, ['cleric']);
  configured = setGrantedFeatSpellChoice(configured, configured.spellChoices[1]!.key, [featSource.advancements[0]!.dependencies[0]!.source!]);
  return setGrantedFeatSpellcastingAbility(configured, 'wis');
}

function selected2024Background(background = sage24): CharacterDocument {
  return withBackground(
    withClassProgression(
      withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin24),
      { class: fighter24, targetLevel: 1, selections: [] },
    ),
    background,
  );
}

function finalizedDocument(): CharacterDocument {
  return {
    ...selected2024Background(),
    mutable: createInitialMutableCharacterState({ items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }),
  };
}

describe('character model', () => {
  it('strips embedded upstream records from saved subclass references while parsing', () => {
    const base = selected2024Background();
    const rawSubclass = {
      sourcePath: 'packs/_source/classes24/rogue/thief.yml', pack: 'dnd5e.classes24', type: 'subclass', id: 'thief', name: 'Thief',
      raw: { upstream: 'synthetic regression sentinel' },
    };
    const progression = {
      ...base.classProgressions![0]!,
      subclass: rawSubclass,
      selections: [{ advancementId: 'subclass', kind: 'subclass' as const, selected: rawSubclass, options: [rawSubclass] }],
    };

    const parsed = parseCharacterDocument({ ...base, classProgressions: [progression] });

    expect(parsed.classProgressions?.[0]?.subclass).toEqual({ sourcePath: rawSubclass.sourcePath, pack: rawSubclass.pack, type: rawSubclass.type, id: rawSubclass.id, name: rawSubclass.name });
    expect(parsed.classProgressions?.[0]?.selections[0]).toEqual({
      advancementId: 'subclass', kind: 'subclass',
      selected: { sourcePath: rawSubclass.sourcePath, pack: rawSubclass.pack, type: rawSubclass.type, id: rawSubclass.id, name: rawSubclass.name },
      options: [{ sourcePath: rawSubclass.sourcePath, pack: rawSubclass.pack, type: rawSubclass.type, id: rawSubclass.id, name: rawSubclass.name }],
    });
  });

  it('preserves a legacy higher-level HP maximum without inferring historical gains', () => {
    const legacy = finalizedDocument();
    legacy.classProgressions![0]!.targetLevel = 3;
    legacy.mutable!.hitPoints = { current: 18, maximum: 42, maximumOverride: 45, temporary: 2 };

    const parsed = parseCharacterDocument(JSON.parse(JSON.stringify(legacy)));

    expect(parsed.classHitPoints).toBeUndefined();
    expect(parsed.mutable?.hitPoints).toEqual({ current: 18, maximum: 42, maximumOverride: 45, temporary: 2 });
  });

  it('rejects a persisted class HP ledger that does not contain only the effective class levels', () => {
    const document = { ...finalizedDocument(), classHitPoints: [
      { classSourcePath: fighter24.sourcePath, level: 1, value: 'max' },
      { classSourcePath: fighter24.sourcePath, level: 2, value: 'avg' },
    ] };
    expect(() => parseCharacterDocument(document)).toThrow('Invalid character document');
    expect(() => parseCharacterDocument({ ...document, classProgressions: [{ ...document.classProgressions![0]!, targetLevel: 2 }], classHitPoints: [...document.classHitPoints, { classSourcePath: fighter24.sourcePath, level: 3, value: 4 }] })).toThrow('Invalid character document');
    expect(() => parseCharacterDocument({ ...document, classHitPoints: [{ ...document.classHitPoints[0]!, classSourcePath: 'packs/_source/classes24/wizard/wizard.yml' }] })).toThrow('Invalid character document');
  });

  it('rejects empty or duplicate species spellcasting provenance IDs', () => {
    const base = { ...selected2024Background(), speciesConfiguration: { origin: origin24, foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'a'.repeat(40) }, grants: [], choices: [], spellChoices: [], spellcastingAbility: { advancementIds: ['spell', 'spell'], selected: 'Wisdom' } } };
    expect(() => parseCharacterDocument(base)).toThrow('Invalid character document');
    expect(() => parseCharacterDocument({ ...base, speciesConfiguration: { ...base.speciesConfiguration, spellcastingAbility: { advancementIds: [''], selected: 'Wisdom' } } })).toThrow('Invalid character document');
    expect(() => parseCharacterDocument({ ...base, speciesConfiguration: { ...base.speciesConfiguration, spellcastingAbility: { advancementIds: [], selected: 'Wisdom' } } })).toThrow('Invalid character document');
  });
  it('changes the display name without clearing character selections', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const selected = withOrigin(withRuleset(createCharacterDocument('New character', snapshot), '2024'), origin);

    const renamed = withName(selected, '  Ayla Brightblade  ');

    expect(renamed).toEqual({ ...selected, name: 'Ayla Brightblade' });
    expect(() => withName(selected, '   ')).toThrow('Invalid character name');
  });

  it('preserves every sibling background choice in either update order', () => {
    const featConfig = featConfiguration();
    const featSelection = toGrantedFeatSelection(featConfig);
    const persistedFeatSelection = (parseCharacterDocument({ ...selected2024Background(), backgroundChoices: { grantedFeat: featSelection } }).backgroundChoices!.grantedFeat)!;
    const abilitySelection = { advancementId: 'asi', assignments: { int: 2, wis: 1 } };
    const withFeat = withBackgroundGrantedFeat(selected2024Background(), featSelection, featConfig);
    const withAbility = withBackgroundAbilityScores(withFeat, abilitySelection, choiceConfiguration);
    const withLanguages = withBackgroundLanguages(withAbility, ['languages:standard:elvish', 'languages:standard:dwarvish'], ['languages:standard:elvish', 'languages:standard:dwarvish']);
    expect(withLanguages.backgroundChoices).toEqual({ languages: ['languages:standard:elvish', 'languages:standard:dwarvish'], abilityScores: abilitySelection, grantedFeat: persistedFeatSelection });
    const reverse = withBackgroundGrantedFeat(withBackgroundLanguages(withBackgroundAbilityScores(selected2024Background(), abilitySelection, choiceConfiguration), ['languages:standard:elvish', 'languages:standard:dwarvish'], ['languages:standard:elvish', 'languages:standard:dwarvish']), featSelection, featConfig);
    expect(reverse.backgroundChoices).toEqual(withLanguages.backgroundChoices);
  });

  it('clears granted feat choices when the background changes', () => {
    const configuration = featConfiguration();
    const configured = withBackgroundGrantedFeat(selected2024Background(), toGrantedFeatSelection(configuration), configuration);
    expect(withBackground(configured, soldier24).backgroundChoices).toBeUndefined();
  });

  it('parses a valid partial granted feat choice without inventing missing selections', () => {
    const configuration = featConfiguration();
    const selection = toGrantedFeatSelection(configuration);
    const partial = {
      feat: { ...selection.feat },
      spellChoices: [
        { ...selection.spellChoices[0]!, selected: ['cleric'] },
        { ...selection.spellChoices[1]!, selected: [], selectedAbility: undefined },
      ],
    };
    const parsed = parseCharacterDocument({ ...selected2024Background(), backgroundChoices: { grantedFeat: partial } });
    expect(parsed.backgroundChoices?.grantedFeat).toEqual({
      feat: selection.feat,
      spellChoices: [
        { key: selection.spellChoices[0]!.key, advancementId: selection.spellChoices[0]!.advancementId, kind: 'spell-list', selected: ['cleric'] },
        { key: selection.spellChoices[1]!.key, advancementId: selection.spellChoices[1]!.advancementId, kind: 'spell', selected: [] },
      ],
    });
    expect(parseCharacterDocument(selected2024Background()).backgroundChoices).toBeUndefined();
  });

  it('rejects duplicate persisted granted feat choice keys', () => {
    const configuration = featConfiguration();
    const selection = toGrantedFeatSelection(configuration);
    const duplicate = { ...selection, spellChoices: [selection.spellChoices[0]!, { ...selection.spellChoices[1]!, key: selection.spellChoices[0]!.key }] };
    expect(() => parseCharacterDocument({ ...selected2024Background(), backgroundChoices: { grantedFeat: duplicate } })).toThrow('Invalid character document');
  });

  it('isolates parsed granted feat choices from input mutations', () => {
    const configuration = featConfiguration();
    const selection = toGrantedFeatSelection(configuration);
    const input = { ...selected2024Background(), backgroundChoices: { grantedFeat: selection } };
    const parsed = parseCharacterDocument(input);
    const parsedFeat = parsed.backgroundChoices?.grantedFeat;
    if (parsedFeat === undefined) throw new Error('Expected parsed granted feat');
    parsedFeat.feat.id = 'mutated-parsed-feat';
    parsedFeat.spellChoices[0]!.selected = ['cleric', 'wizard'];
    const parsedSpell = parsedFeat.spellChoices[1]!.selected[0];
    if (typeof parsedSpell !== 'string') parsedSpell.name = 'Mutated parsed spell';
    expect(selection.feat.id).toBe('magic-initiate');
    expect(selection.spellChoices[0]?.selected).toEqual(['cleric']);
    expect(selection.spellChoices[1]?.selected[0]).toMatchObject({ id: 'guidance', name: 'Guidance' });
    const parsedForInputMutation = parseCharacterDocument(input);
    selection.feat.id = 'mutated-feat';
    selection.spellChoices[0]!.selected[0] = 'wizard';
    const spell = selection.spellChoices[1]!.selected[0];
    if (typeof spell !== 'string') spell.name = 'Mutated spell';
    expect(parsedForInputMutation.backgroundChoices?.grantedFeat?.feat.id).toBe('magic-initiate');
    expect(parsedForInputMutation.backgroundChoices?.grantedFeat?.spellChoices[0]?.selected).toEqual(['cleric']);
    expect(parsedForInputMutation.backgroundChoices?.grantedFeat?.spellChoices[1]?.selected[0]).toMatchObject({ id: 'guidance', name: 'Guidance' });
  });

  it.each([
    { grantedFeat: { feat: {}, spellChoices: [] } },
    { grantedFeat: { feat: { sourcePath: 'packs/_source/feats24/magic-initiate.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'magic-initiate', name: 'Magic Initiate' }, spellChoices: [{ key: 'k', advancementId: 'a', kind: 'spell-list', selected: ['cleric', 'cleric'] }] } },
    { grantedFeat: { feat: { sourcePath: 'packs/_source/feats24/magic-initiate.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'magic-initiate', name: 'Magic Initiate' }, spellChoices: [{ key: 'k', advancementId: 'a', kind: 'spell-list', selected: [], extra: true }] } },
  ])('rejects malformed granted feat shapes', (choices) => {
    expect(() => parseCharacterDocument({ ...selected2024Background(), backgroundChoices: choices })).toThrow('Invalid character document');
  });
  it('persists background languages and ability scores without overwriting either choice', () => {
    const withAbility = withBackgroundAbilityScores(selected2024Background(), { advancementId: 'asi', assignments: { int: 2, wis: 1 } }, choiceConfiguration);
    const withLanguages = withBackgroundLanguages(withAbility, ['languages:standard:elvish', 'languages:standard:dwarvish'], ['languages:standard:elvish', 'languages:standard:dwarvish']);
    expect(withLanguages.backgroundChoices).toEqual({
      abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } },
      languages: ['languages:standard:elvish', 'languages:standard:dwarvish'],
    });
    expect(withBackgroundAbilityScores(withLanguages, { advancementId: 'asi', assignments: { int: 1, wis: 1, cha: 1 } }, choiceConfiguration).backgroundChoices?.languages).toEqual(withLanguages.backgroundChoices?.languages);
  });

  it('canonicalizes zero-valued background ability assignments before persistence', () => {
    const configured = withBackgroundAbilityScores(selected2024Background(), { advancementId: 'asi', assignments: { int: 2, wis: 1, cha: 0 } }, choiceConfiguration);
    expect(configured.backgroundChoices?.abilityScores).toEqual({ advancementId: 'asi', assignments: { int: 2, wis: 1 } });
  });

  it('rejects stale allocations and clears saved background choices when the background changes', () => {
    const background = selected2024Background();
    expect(() => withBackgroundAbilityScores(background, { advancementId: 'old', assignments: { int: 2, wis: 1 } }, choiceConfiguration)).toThrow('Background ability advancement does not match the current source.');
    const configured = withBackgroundAbilityScores(background, { advancementId: 'asi', assignments: { int: 2, wis: 1 } }, choiceConfiguration);
    expect(withBackground(configured, soldier24).backgroundChoices).toBeUndefined();
  });

  it('loads a structurally valid allocation but rejects malformed assignment data', () => {
    const background = selected2024Background();
    expect(parseCharacterDocument({ ...background, backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } } }).backgroundChoices?.abilityScores).toEqual({ advancementId: 'asi', assignments: { int: 2, wis: 1 } });
    expect(() => parseCharacterDocument({ ...background, backgroundChoices: { abilityScores: { advancementId: 'asi', assignments: { int: -1 } } } })).toThrow('Invalid character document');
  });

  it('persists optional ability score selections', () => {
    const document = withAbilityScores(createCharacterDocument('Ayla', snapshot), { ...createDefaultAbilityScores(), manual: { str: -1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } });
    expect(parseCharacterDocument(document).abilityScores).toMatchObject({ method: 'standard-array', manual: { str: -1 } });
  });

  it('persists an incomplete Point Buy draft and promotes only an exact 27-point allocation', () => {
    const document = selected2024Background();
    const initial = createPointBuyAbilityScores();
    const incomplete = withPointBuyDraft(document, { ...initial, base: { ...initial.base, str: 15 } });
    expect(parseCharacterDocument(JSON.parse(JSON.stringify(incomplete))).abilityScoreDraft).toMatchObject({ method: 'point-buy', base: { str: 15 } });
    expect(incomplete.abilityScores).toBeUndefined();

    const exact = withPointBuyDraft(incomplete, { ...initial, base: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } });
    expect(exact.abilityScoreDraft).toBeUndefined();
    expect(exact.abilityScores).toMatchObject({ method: 'point-buy', base: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } });
  });

  it('rejects a Point Buy draft that exceeds the 27-point budget', () => {
    const document = selected2024Background();
    const pointBuy = createPointBuyAbilityScores();
    expect(() => withPointBuyDraft(document, { ...pointBuy, base: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 } })).toThrow('Invalid Point Buy draft');
  });

  it('rejects a Standard Array draft that assigns one value to two abilities', () => {
    const document = selected2024Background();
    const duplicate = { method: 'standard-array', base: { str: 15, dex: 15 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } };
    expect(() => parseCharacterDocument({ ...document, abilityScoreDraft: duplicate })).toThrow('Invalid character document');
  });

  it('rejects a Standard Array draft with incomplete manual adjustment data', () => {
    const document = selected2024Background();
    expect(() => parseCharacterDocument({ ...document, abilityScoreDraft: { method: 'standard-array', base: { str: 15 }, manual: { str: 0 } } })).toThrow('Invalid character document');
  });

  it('replaces a pending Standard Array draft with a completed ability selection', () => {
    const document = { ...selected2024Background(), abilityScoreDraft: { method: 'standard-array' as const, base: { str: 15 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } } };
    expect(withAbilityScores(document, createDefaultAbilityScores()).abilityScoreDraft).toBeUndefined();
  });

  it('persists each incomplete Standard Array choice and withholds final ability scores', () => {
    const initial = selected2024Background();
    const first = withStandardArrayDraft(initial, { method: 'standard-array', base: { str: 15 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } });
    const saved = parseCharacterDocument(JSON.parse(JSON.stringify(first)));
    expect(saved.abilityScoreDraft?.base).toEqual({ str: 15 });
    expect(saved.abilityScores).toBeUndefined();
  });

  it('promotes a completed Standard Array draft into validated ability scores', () => {
    const document = selected2024Background();
    const complete = { method: 'standard-array' as const, base: { str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 }, manual: { str: 0, dex: 1, con: 0, int: 0, wis: 0, cha: 0 } };
    const saved = withStandardArrayDraft(document, complete);
    expect(saved.abilityScoreDraft).toBeUndefined();
    expect(saved.abilityScores).toMatchObject({ method: 'standard-array', base: complete.base, manual: complete.manual });
  });

  it('saves incomplete rolled scores without unlocking completed ability scores', () => {
    const initial = selected2024Background();
    const saved = withRolledAbilityDraft(initial, { method: 'dice-rolling', base: { str: 16 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } });
    expect(parseCharacterDocument(JSON.parse(JSON.stringify(saved))).abilityScoreDraft).toMatchObject({ method: 'dice-rolling', base: { str: 16 } });
    expect(saved.abilityScores).toBeUndefined();
  });

  it('promotes six valid rolled scores but retains an out-of-range score as a draft', () => {
    const initial = selected2024Background();
    const draft = { method: 'dice-rolling' as const, base: { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } };
    expect(withRolledAbilityDraft(initial, draft).abilityScores?.base).toEqual(draft.base);
    const invalid = withRolledAbilityDraft(initial, { ...draft, base: { ...draft.base, str: 30 } });
    expect(invalid.abilityScoreDraft?.base.str).toBe(30);
    expect(invalid.abilityScores).toBeUndefined();
  });

  it('clears a partial Standard Array draft when the origin changes', () => {
    const document = withStandardArrayDraft(selected2024Background(), { method: 'standard-array', base: { str: 15 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } });
    const changed = withOrigin(document, { sourcePath: 'packs/_source/origins24/species/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' });
    expect(changed.abilityScoreDraft).toBeUndefined();
  });
  it('persists a ruleset-compatible background after class selection', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const base = withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: classRef, targetLevel: 1, selections: [] });
    const result = withBackground(base, { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' });
    expect(result).toMatchObject({ step: 'background', background: { identifier: 'sage' } });
    expect(parseCharacterDocument(result)).toEqual(result);
    const configured = withBackgroundLanguages(result, ['languages:elvish', 'languages:dwarvish'], ['languages:standard:elvish', 'languages:standard:dwarvish']);
    expect(configured.backgroundChoices).toEqual({ languages: ['languages:elvish', 'languages:dwarvish'] });
    expect(parseCharacterDocument(configured)).toEqual(configured);
  });

  it('requires exactly two background languages', () => {
    const origin = { sourcePath: 'packs/_source/races/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const background = withBackground(withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin), { class: classRef, targetLevel: 1, selections: [] }), { sourcePath: 'packs/_source/backgrounds/acolyte.yml', identifier: 'acolyte', id: 'acolyte-id' });
    expect(() => withBackgroundLanguages(background, ['languages:elvish'], 2)).toThrow('Invalid background language selection');
    expect(() => withBackgroundLanguages(background, ['languages:elvish', 'languages:elvish'], 2)).toThrow('Invalid background language selection');
  });

  it('validates background languages against the authoritative choice count', () => {
    const origin = { sourcePath: 'packs/_source/races/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const background = withBackground(withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin), { class: classRef, targetLevel: 1, selections: [] }), { sourcePath: 'packs/_source/backgrounds/acolyte.yml', identifier: 'acolyte', id: 'acolyte-id' });
    const languages = ['languages:elvish', 'languages:dwarvish', 'languages:gnomish'];

    const configured = withBackgroundLanguages(background, languages, 3);
    expect(configured.backgroundChoices?.languages).toEqual(languages);
    expect(parseCharacterDocument(configured)).toEqual(configured);
    expect(() => withBackgroundLanguages(background, languages.slice(0, 2), 3)).toThrow('Invalid background language selection');
  });
  it('validates background languages against allowed source options', () => {
    const background = selected2024Background();
    const allowed = ['languages:standard:elvish', 'languages:standard:dwarvish'];
    expect(() => withBackgroundLanguages(background, ['languages:elvish'], allowed)).toThrow('Invalid background language selection');
    expect(() => withBackgroundLanguages(background, ['languages:elvish', 'languages:elvish'], allowed)).toThrow('Invalid background language selection');
  });
  it('rejects unavailable, Common-alias, and semantic duplicate background languages', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const background = withBackground(withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: classRef, targetLevel: 1, selections: [] }), { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' });
    const allowed = ['languages:standard:draconic', 'languages:standard:dwarvish'];
    expect(() => withBackgroundLanguages(background, ['languages:standard:elvish', 'languages:standard:dwarvish'], allowed)).toThrow('Invalid background language selection');
    expect(() => withBackgroundLanguages(background, ['languages:common', 'languages:standard:dwarvish'], allowed)).toThrow('Invalid background language selection');
    expect(() => withBackgroundLanguages(background, ['languages:draconic', 'languages:standard:draconic'], allowed)).toThrow('Invalid background language selection');
  });

  it('accepts multi-segment background language identifiers', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const background = withBackground(withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: classRef, targetLevel: 1, selections: [] }), { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' });
    const allowed = ['languages:exotic:primordial:aquan', 'languages:standard:elvish'];
    const configured = withBackgroundLanguages(background, ['languages:primordial:aquan', 'languages:elvish'], allowed);
    expect(configured.backgroundChoices).toEqual({ languages: ['languages:primordial:aquan', 'languages:elvish'] });
    expect(parseCharacterDocument(configured)).toEqual(configured);
  });

  it('accepts categorized background language selectors when the allowed value is categoryless', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const background = withBackground(withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: classRef, targetLevel: 1, selections: [] }), { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' });
    const configured = withBackgroundLanguages(background, ['languages:standard:elvish', 'languages:exotic:primordial:aquan'], ['languages:elvish', 'languages:primordial:aquan']);
    expect(configured.backgroundChoices).toEqual({ languages: ['languages:standard:elvish', 'languages:exotic:primordial:aquan'] });
  });

  it('rejects a categorized language selector whose category differs from the allowed source option', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const background = withBackground(withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: classRef, targetLevel: 1, selections: [] }), { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' });
    const allowed = ['languages:exotic:primordial:aquan', 'languages:standard:elvish'];
    expect(() => withBackgroundLanguages(background, ['languages:standard:primordial:aquan', 'languages:elvish'], allowed)).toThrow('Invalid background language selection');
  });

  it('rejects a background from the wrong ruleset', () => {
    const origin = { sourcePath: 'packs/_source/races/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const base = withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), origin), { class: classRef, targetLevel: 1, selections: [] });
    expect(() => withBackground(base, { sourcePath: 'packs/_source/origins24/backgrounds/sage.yml', identifier: 'sage', id: 'sage-id' })).toThrow('Invalid character background');
  });
  it('creates a new document with ruleset selection pending', () => {
    expect(createCharacterDocument('Ayla', snapshot)).toEqual({
      format: 1,
      kind: 'guided-character',
      name: 'Ayla',
      ruleset: null,
      step: 'ruleset',
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'a'.repeat(40) },
    });
  });

  it('parses a valid selected document and preserves extension fields', () => {
    const value = { ...createCharacterDocument('Ayla', snapshot), ruleset: '2024', step: 'origin', origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, extension: { note: true } };
    expect(parseCharacterDocument(value)).toEqual(value);
  });

  it('persists and round-trips the distinct Rogue expertise selection', () => {
    const document = {
      ...selected2024Background(),
      classProgressions: [{ class: { ...fighter24, identifier: 'rogue', sourcePath: 'packs/_source/classes24/rogue.yml' }, targetLevel: 1, selections: [{ advancementId: 'expertise', kind: 'expertise' as const, mode: 'expertise' as const, configuredPool: ['skills:*'], selected: ['skills:arc', 'skills:ste'] }] }],
    };
    const parsed = parseCharacterDocument(JSON.parse(JSON.stringify(document)));
    expect(parsed.classProgressions?.[0]?.selections).toEqual(document.classProgressions[0].selections);
    expect(parseCharacterDocument(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('accepts and normalizes a pre-selectionRole class spell selection fixture', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', identifier: 'wizard', id: 'wizard-id' };
    const spell = { sourcePath: 'packs/_source/spells24/shield.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'shield', name: 'Shield' } as const;
    const legacy = { ...createCharacterDocument('Ayla', snapshot), ruleset: '2024' as const, step: 'class' as const, origin, classProgressions: [{ class: classRef, targetLevel: 1, selections: [{ advancementId: 'legacy-spells', kind: 'spell' as const, selected: [spell], level: 1, count: 1, spellLists: ['wizard'] }] }] };
    const parsed = parseCharacterDocument(JSON.parse(JSON.stringify(legacy)));
    expect(parsed.classProgressions?.[0].selections[0]).toMatchObject({ selectionRole: 'known-spells', selected: [spell] });
    expect(parseCharacterDocument(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('strips complete Foundry records from persisted equipment references', () => {
    const origin = { sourcePath: 'packs/_source/races/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const value = {
      ...createCharacterDocument('Ayla', snapshot), ruleset: '2014', step: 'class', origin,
      classProgressions: [{ class: classRef, targetLevel: 1, selections: [] }],
      classEquipment: { selected: {}, semantic: { node: { sourcePath: 'packs/_source/items/weapon/mace.yml', pack: 'dnd5e.items', type: 'weapon', id: 'mace', name: 'Mace', raw: { system: { activities: {} } } } } },
      inventory: { items: [{ entryId: 'mace', source: { sourcePath: 'packs/_source/items/weapon/mace.yml', pack: 'dnd5e.items', type: 'weapon', id: 'mace', name: 'Mace', raw: { system: {} } }, quantity: 1, equipped: false, provenance: [{ sourcePath: 'packs/_source/classes/fighter.yml', packageNodeId: 'node' }] }], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } },
    };
    const parsed = parseCharacterDocument(value);
    expect(parsed.classEquipment?.semantic.node).not.toHaveProperty('raw');
    expect(parsed.inventory?.items[0].source).not.toHaveProperty('raw');
  });

  it('retains only the origin reference and Foundry provenance when reopened', () => {
    const value = {
      ...createCharacterDocument('Ayla', snapshot),
      ruleset: '2024',
      step: 'origin',
      origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' },
    };

    const reopened = parseCharacterDocument(JSON.parse(JSON.stringify(value)) as unknown);

    expect(reopened).toMatchObject({
      ruleset: '2024',
      origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' },
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'a'.repeat(40) },
    });
    expect(reopened).not.toHaveProperty('source');
    expect(reopened).not.toHaveProperty('sourceRecord');
    expect(reopened).not.toHaveProperty('advancements');
  });

  it.each([
    { ruleset: '2019', step: 'ruleset' },
    { ruleset: '2014', step: 'selection' },
  ])('rejects invalid workflow values', ({ ruleset, step }) => {
    const value = { ...createCharacterDocument('Ayla', snapshot), ruleset, step };
    expect(() => parseCharacterDocument(value)).toThrow('Invalid character document');
  });

  it('rejects missing or invalid Foundry snapshot fields', () => {
    const value = createCharacterDocument('Ayla', snapshot);
    for (const foundry of [{ ...value.foundry, systemVersion: '' }, { ...value.foundry, sourceBranch: '' }, { ...value.foundry, sourceCommit: 'bad' }]) {
      expect(() => parseCharacterDocument({ ...value, foundry })).toThrow('Invalid character document');
    }
  });

  it('rejects origins from the wrong ruleset or malformed references', () => {
    const selected = withRuleset(createCharacterDocument('Ayla', snapshot), '2014');
    for (const origin of [
      { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' },
      { sourcePath: 'packs/_source/races/elf.yml', identifier: '', id: 'elf-id' },
      { sourcePath: 'packs/_source/races/../secret.yml', identifier: 'elf', id: 'elf-id' },
    ]) {
      expect(() => withOrigin(selected, origin)).toThrow('Invalid character origin');
    }
  });

  it('changes ruleset, clears the origin, and preserves unknown fields', () => {
    const selected = withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2014'), { sourcePath: 'packs/_source/races/elf.yml', identifier: 'elf', id: 'elf-id' });
    const changed = withRuleset({ ...selected, custom: 'kept' } as CharacterDocument & { custom: string }, '2024');
    expect(changed).toMatchObject({ ruleset: '2024', step: 'origin', custom: 'kept' });
    expect(changed).not.toHaveProperty('origin');
  });

  it('clears finalized mutable state when the ruleset is reset', () => {
    const changed = withRuleset(finalizedDocument(), '2014');
    expect(changed).not.toHaveProperty('mutable');
  });

  it('clears finalized mutable state when the origin identity changes and preserves it otherwise', () => {
    const changed = withOrigin(finalizedDocument(), { sourcePath: 'packs/_source/origins24/species/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' });
    const unchanged = withOrigin(finalizedDocument(), origin24);
    expect(changed).not.toHaveProperty('mutable');
    expect(unchanged.mutable).toEqual(finalizedDocument().mutable);
  });

  it('adds a ruleset-compatible origin while preserving unknown fields', () => {
    const selected = withRuleset(createCharacterDocument('Ayla', snapshot), '2024');
    const result = withOrigin({ ...selected, custom: 'kept' } as CharacterDocument & { custom: string }, { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' });
    expect(result).toMatchObject({ step: 'origin', custom: 'kept', origin: { identifier: 'elf' } });
  });

  it('clears species configuration when the selected origin changes', () => {
    const first = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const second = { sourcePath: 'packs/_source/origins24/species/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' };
    const configured = withSpeciesConfiguration(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), first), createSpeciesConfiguration(first, snapshot));
    const changed = withOrigin(configured, second);
    expect(changed).not.toHaveProperty('speciesConfiguration');
    expect(() => withSpeciesConfiguration(changed, createSpeciesConfiguration(second, snapshot))).not.toThrow();
  });

  it('persists only species selections and provenance in the character document', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), choices: [{ key: 'choice:language', level: 1, label: 'Language', count: 1, source: { id: 'choice-id', type: 'Choice' }, options: [{ value: 'elvish', label: 'Elvish', source: { id: 'elvish-id', type: 'Item' } }], selected: [], raw: {} }] };
    const selected = setSpeciesChoice(configuration, 'choice:language', ['elvish']);
    const document = withSpeciesConfiguration(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), selected);
    expect(document.speciesConfiguration).toEqual(toSpeciesConfigurationSelection(selected));
    expect(document.speciesConfiguration).not.toHaveProperty('choices[0].options');
    expect(document.speciesConfiguration).not.toHaveProperty('choices[0].raw');
  });

  it('round-trips a selected species size as advancement identity and value only', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human-id' };
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), size: { advancementId: 'human-size', level: 0, options: ['sm', 'med'] } };
    const selected = setSpeciesSize(configuration, 'med');
    const document = withSpeciesConfiguration(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), selected);
    expect(document.speciesConfiguration?.size).toEqual({ advancementId: 'human-size', selected: 'med' });
    expect(parseCharacterDocument(document).speciesConfiguration?.size).toEqual({ advancementId: 'human-size', selected: 'med' });
  });

  it('rejects malformed persisted species selections', () => {
    const document = { ...createCharacterDocument('Ayla', snapshot), ruleset: '2024', step: 'origin', origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' }, speciesConfiguration: { choices: 'bad' } };
    expect(() => parseCharacterDocument(document)).toThrow('Invalid character document');
  });

  it('validates and sanitizes persisted species spell-choice variants', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human-id' };
    const spell = { sourcePath: 'packs/_source/spells24/cantrips/guidance.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'guidance', name: 'Guidance', identifier: 'guidance', level: 0, spellLists: ['cleric'], raw: { system: {} } };
    const base = {
      ...createCharacterDocument('Ayla', snapshot), ruleset: '2024', step: 'origin', origin,
      speciesConfiguration: {
        origin,
        foundry: { systemVersion: snapshot.systemVersion, sourceBranch: snapshot.branch, sourceCommit: snapshot.commit },
        grants: [], choices: [],
        spellChoices: [
          { key: 'magic:list', advancementId: 'cantrips', kind: 'spell-list', selected: ['cleric'] },
          { key: 'magic:cantrips', advancementId: 'cantrips', kind: 'spell', selected: [spell], selectedAbility: 'Wisdom' },
        ],
      },
    };

    const parsed = parseCharacterDocument(base);
    expect(parsed.speciesConfiguration?.spellChoices?.[1]).toEqual({
      key: 'magic:cantrips', advancementId: 'cantrips', kind: 'spell', selected: [{ sourcePath: spell.sourcePath, pack: spell.pack, type: spell.type, id: spell.id, name: spell.name, identifier: spell.identifier }], selectedAbility: 'Wisdom',
    });
    for (const spellChoices of [
      [{ key: 'magic:list', advancementId: 'cantrips', kind: 'spell-list', selected: ['cleric', 'cleric'] }],
      [{ key: 'magic:cantrips', advancementId: 'cantrips', kind: 'spell', selected: ['cleric'] }],
      [{ key: 'magic:cantrips', advancementId: 'cantrips', kind: 'spell', selected: [{ ...spell, sourcePath: '../unsafe.yml' }] }],
      [{ key: 'magic:cantrips', advancementId: 'cantrips', kind: 'spell', selected: [spell], selectedAbility: 3 }],
    ]) {
      expect(() => parseCharacterDocument({ ...base, speciesConfiguration: { ...base.speciesConfiguration, spellChoices } })).toThrow('Invalid character document');
    }
  });

  it('rejects malformed persisted class selections by variant', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const base = { ...createCharacterDocument('Ayla', snapshot), ruleset: '2024', step: 'class', origin, classProgressions: [{ class: classRef, targetLevel: 1, selections: [] }] };
    const ref = { sourcePath: 'packs/_source/classes24/fighter/fighting.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'feat-id', name: 'Fighting' };
    const selections = [
      { advancementId: '', kind: 'trait', selected: [] },
      { advancementId: 'a', kind: 'trait', selected: 'not-an-array' },
      { advancementId: 'a', kind: 'item', selected: [{ ...ref, sourcePath: 'packs/_source/../unsafe.yml' }] },
      { advancementId: 'a', kind: 'item', selected: [{ ...ref, id: '' }] },
      { advancementId: 'a', kind: 'ability-score', assignments: { str: 2 }, points: 3 },
      { advancementId: 'a', kind: 'ability-score', assignments: [], points: 2 },
      { advancementId: 'a', kind: 'subclass', options: [ref], selected: { ...ref, sourcePath: '/absolute.yml' } },
      { advancementId: 'a', kind: 'subclass', options: 'not-an-array' },
      { advancementId: 'a', kind: 'spell', selected: [{ ...ref, type: '' }] },
      { advancementId: 'a', kind: 'unknown', selected: [] },
    ];
    for (const selection of selections) {
      expect(() => parseCharacterDocument({ ...base, classProgressions: [{ ...base.classProgressions[0], selections: [selection] }] }), JSON.stringify(selection)).toThrow('Invalid character document');
    }
  });

  it('clears species configuration when changing ruleset', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const configured = withSpeciesConfiguration(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), createSpeciesConfiguration(origin, snapshot));
    const changed = withRuleset({ ...configured, custom: 'kept' }, '2014');
    expect(changed).toMatchObject({ custom: 'kept', ruleset: '2014' });
    expect(changed).not.toHaveProperty('origin');
    expect(changed).not.toHaveProperty('speciesConfiguration');
    expect(changed).not.toHaveProperty('classProgressions');
  });

  it('stores one level-one class progression after an origin', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    const result = withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: classRef, targetLevel: 1, selections: [] });
    expect(result).toMatchObject({ step: 'class', classProgressions: [{ class: classRef, targetLevel: 1, selections: [] }] });
  });

  it('preserves later creation selections when updating the same class progression', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const classRef = { sourcePath: 'packs/_source/classes24/paladin/paladin.yml', identifier: 'paladin', id: 'paladin-id' };
    const background = { sourcePath: 'packs/_source/origins24/backgrounds/acolyte.yml', identifier: 'acolyte', id: 'acolyte-id' };
    const base = withBackground(withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: classRef, targetLevel: 1, selections: [] }), background);
    const configured = { ...base, classEquipment: { selected: { choice: 'package' }, semantic: {} }, abilityScores: createDefaultAbilityScores() };
    const updated = withClassProgression(configured, { class: classRef, targetLevel: 1, selections: [{ advancementId: 'weapon-mastery', kind: 'trait', selected: ['weapon:mace:*'] }] });
    expect(updated).toMatchObject({ step: 'background', background, classEquipment: configured.classEquipment, abilityScores: configured.abilityScores });
  });

  it('clears finalized mutable state when changing class identity and preserves it for the same class', () => {
    const sameClass = withClassProgression(finalizedDocument(), { class: fighter24, targetLevel: 1, selections: [] });
    const changedClass = withClassProgression(finalizedDocument(), { class: { ...fighter24, identifier: 'wizard', id: 'wizard-id', sourcePath: 'packs/_source/classes24/wizard/wizard.yml' }, targetLevel: 1, selections: [] });
    expect(sameClass.mutable).toEqual(finalizedDocument().mutable);
    expect(changedClass).not.toHaveProperty('mutable');
  });

  it('clears finalized mutable state when changing background identity and preserves it for the same background', () => {
    const sameBackground = withBackground(finalizedDocument(), sage24);
    const changedBackground = withBackground(finalizedDocument(), soldier24);
    expect(sameBackground.mutable).toEqual(finalizedDocument().mutable);
    expect(changedBackground).not.toHaveProperty('mutable');
  });

  it('clears stale class progressions when origin or ruleset changes', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const selected = withClassProgression(withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin), { class: { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' }, targetLevel: 1, selections: [] });
    expect(withOrigin(selected, { sourcePath: 'packs/_source/origins24/species/dwarf.yml', identifier: 'dwarf', id: 'dwarf-id' })).not.toHaveProperty('classProgressions');
    expect(withRuleset(selected, '2014')).not.toHaveProperty('classProgressions');
  });

  it('rejects invalid class paths, levels, and mismatched subclass sources', () => {
    const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
    const document = withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin);
    const classRef = { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', identifier: 'fighter', id: 'fighter-id' };
    for (const progression of [{ class: { ...classRef, sourcePath: 'packs/_source/classes/nope.yml' }, targetLevel: 1, selections: [] }, { class: classRef, targetLevel: 0, selections: [] }, { class: classRef, targetLevel: 1.5, selections: [] }, { class: classRef, targetLevel: 1, subclass: { sourcePath: 'packs/_source/subclasses/champion.yml', pack: 'dnd5e.subclasses', type: 'feat', id: 'subclass-id', name: 'School' }, selections: [] }]) {
      expect(() => withClassProgression(document, progression)).toThrow('Invalid class progression');
    }
  });
});
