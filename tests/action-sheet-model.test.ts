import { describe, expect, it } from 'vitest';
import { calculateAbilityScores, type AbilityScoreSelection } from '../src/ability-scores';
import type { CharacterDocument } from '../src/character-model';
import { projectActionSheet } from '../src/action-sheet-model';
import type { FoundryItemSummary, FoundrySpellSummary, FoundrySourceReference } from '../src/foundry-source-catalog';

const document: CharacterDocument = {
  format: 1, kind: 'guided-character', name: 'Ayla', ruleset: '2024', step: 'background',
  foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'abc' },
  abilityScores: { method: 'standard-array', base: { str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
  mutable: { preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [], resources: [] },
};
const ref = (id: string, name: string, type = 'equipment'): FoundrySourceReference => ({ sourcePath: `packs/${id}.yml`, pack: 'test', type, id, name });
const weapon = (overrides: Partial<FoundryItemSummary> = {}): FoundryItemSummary => ({ ...ref('flail', 'Flail'), ruleset: '2024', itemType: 'weapon', category: 'martial', magic: false, equippable: true, properties: [], damage: { number: 1, denomination: 8, types: ['bludgeoning'] }, activities: [{ id: 'attack', name: 'Melee attack', type: 'attack', activation: { type: 'action' }, attack: { ability: 'str', classification: 'weapon' }, consumption: [] }], ...overrides });
const scores = calculateAbilityScores(document.abilityScores as AbilityScoreSelection);
const finesseScores = calculateAbilityScores({
  method: 'dice-rolling',
  base: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10 },
  manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
});

describe('action sheet projection', () => {
  it('shows equipped weapon properties and unlocked mastery with one source-backed reference each', () => {
    const entries = ['one', 'two'].map((entryId) => ({ entryId, source: ref(entryId, 'Shortsword'), quantity: 1, equipped: false, provenance: [] }));
    const shortsword = weapon({ name: 'Shortsword', identifier: 'shortsword', subcategory: 'shortsword', properties: ['fin', 'lgt'], mastery: 'vex' });
    const equipped = { ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: entries }, equipmentStatus: entries.map(({ entryId }) => ({ entryId, equipped: true, attuned: false })) } };
    const input = { inventoryItems: new Map(entries.map(({ entryId }) => [entryId, { kind: 'available' as const, value: shortsword }])), proficiencyBonus: { kind: 'available' as const, value: 2 }, weaponTraining: ['weapon:mar'], weaponMasteries: new Set(['shortsword']), weaponPropertyDescriptions: new Map([['fin', 'Choose Strength or Dexterity.'], ['lgt', 'Make an extra attack.']]), weaponMasteryDescriptions: new Map([['vex', 'Gain advantage on the next attack.']]) };
    const result = projectActionSheet(equipped, input);
    expect(result.groups[0].entries[0]).toMatchObject({ weaponProperties: ['Finesse', 'Light'], weaponMastery: 'Vex' });
    expect(result.weaponReferences).toEqual([
      { name: 'Finesse', description: 'Choose Strength or Dexterity.' },
      { name: 'Light', description: 'Make an extra attack.' },
      { name: 'Vex', description: 'Gain advantage on the next attack.' },
    ]);
    expect(projectActionSheet(equipped, { ...input, weaponMasteries: new Set() }).weaponReferences?.map(({ name }) => name)).toEqual(['Finesse', 'Light']);
  });
  it('references weapon properties even when an attack is grouped as limited use', () => {
    const entry = { entryId: 'bonus-weapon', source: ref('bonus-weapon', 'Bonus weapon'), quantity: 1, equipped: false, provenance: [] };
    const item = weapon({ properties: ['lgt'], activities: [{ id: 'bonus-attack', type: 'attack', activation: { type: 'bonus' }, consumption: [], uses: { maximum: 1, recovery: [{ period: 'lr' }] } }] });
    const result = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } }, { inventoryItems: new Map([[entry.entryId, { kind: 'available', value: item }]]), proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [], weaponPropertyDescriptions: new Map([['lgt', 'Extra attack.']]) });
    expect(result.weaponReferences).toEqual([{ name: 'Light', description: 'Extra attack.' }]);
  });
  it('projects an equipped proficient ordinary weapon attack', () => {
    const entry = { entryId: 'flail-entry', source: ref('flail', 'Flail'), quantity: 1, equipped: false, provenance: [] };
    const result = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } }, {
      inventoryItems: new Map([[entry.entryId, { kind: 'available', value: weapon() }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:mar'],
    });
    expect(result.groups.find(({ key }) => key === 'attacks')?.entries[0]).toMatchObject({ name: 'Flail', attackBonus: { kind: 'available', value: 5 }, damage: '1d8+3 bludgeoning' });
  });

  it('adds proficiency for a specifically trained martial weapon without requiring mastery', () => {
    const source = { ...ref('shortsword', 'Shortsword'), identifier: 'shortsword' };
    const entry = { entryId: 'shortsword', source, quantity: 1, equipped: false, provenance: [] };
    const shortsword = weapon({ ...source, category: 'martialM', subcategory: 'shortsword', properties: ['fin', 'lgt'], activities: [{ id: 'attack', type: 'attack', activation: { type: 'action' }, attack: { type: 'melee', classification: 'weapon' }, consumption: [] }] });
    const equipped = { ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: 'shortsword', equipped: true, attuned: false }] } };
    const input = { inventoryItems: new Map([[entry.entryId, { kind: 'available' as const, value: shortsword }]]), abilityResults: finesseScores, proficiencyBonus: { kind: 'available' as const, value: 2 }, weaponTraining: ['weapon:sim', 'weapon:mar:shortsword'] };

    expect(projectActionSheet(equipped, input).groups.find(({ key }) => key === 'attacks')?.entries[0]?.attackBonus).toEqual({ kind: 'available', value: 5 });
    expect(projectActionSheet(equipped, { ...input, weaponTraining: ['weapon:sim'] }).groups.find(({ key }) => key === 'attacks')?.entries[0]?.attackBonus).toEqual({ kind: 'available', value: 3 });
  });

  it('adds the passive Archery contribution only to ranged weapon attacks', () => {
    const entry = { entryId: 'shortbow', source: ref('shortbow', 'Shortbow'), quantity: 1, equipped: false, provenance: [] };
    const shortbow = weapon({ ...ref('shortbow', 'Shortbow'), category: 'simpleR', range: { value: 80, long: 320, units: 'ft' }, activities: [{ id: 'attack', type: 'attack', activation: { type: 'action' }, attack: { type: 'ranged', classification: 'weapon' }, consumption: [] }] });
    const equipped = { ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } };
    const effect = { source: ref('archery', 'Archery', 'feat'), key: 'system.bonuses.rwak.attack', target: 'ranged-weapon-attack-bonus', operation: 'add', value: 2 } as const;
    const result = projectActionSheet(equipped, { inventoryItems: new Map([[entry.entryId, { kind: 'available', value: shortbow }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:sim'], passiveEffects: [effect] });
    expect(result.groups.find(({ key }) => key === 'attacks')?.entries.find(({ name }) => name === 'Shortbow')?.attackBonus).toEqual({ kind: 'available', value: 6 });

    const meleeEntry = { entryId: 'flail', source: ref('flail', 'Flail'), quantity: 1, equipped: false, provenance: [] };
    const melee = weapon({ ...ref('flail', 'Flail'), category: 'martialM' });
    const meleeResult = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [meleeEntry] }, equipmentStatus: [{ entryId: 'flail', equipped: true, attuned: false }] } }, { inventoryItems: new Map([[meleeEntry.entryId, { kind: 'available', value: melee }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:mar'], passiveEffects: [effect] });
    expect(meleeResult.groups.find(({ key }) => key === 'attacks')?.entries.find(({ name }) => name === 'Flail')?.attackBonus).toEqual({ kind: 'available', value: 5 });
  });

  it('projects pinned Foundry weapon defaults, range, magic bonus, and description', () => {
    const source = ref('dagger', 'Dagger +1');
    const entry = { entryId: 'dagger', source, quantity: 1, equipped: false, provenance: [] };
    const dagger = weapon({
      ...source,
      category: 'simpleM',
      properties: ['fin', 'lgt', 'thr'],
      magicalBonus: 1,
      damage: { number: 1, denomination: 4, bonus: '', types: ['piercing'] },
      range: { value: 20, long: 60, units: 'ft' },
      description: 'A balanced magical blade.',
      activities: [{ id: 'attack', type: 'attack', activation: { type: 'action' }, range: { value: '20', units: 'ft' }, attack: { type: 'melee', classification: 'weapon' }, consumption: [] }],
    });
    const result = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } }, {
      inventoryItems: new Map([[entry.entryId, { kind: 'available', value: dagger }]]), abilityResults: finesseScores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:sim'],
    });

    expect(result.groups.find(({ key }) => key === 'attacks')?.entries[0]).toMatchObject({
      name: 'Dagger +1',
      range: '20/60 ft.',
      attackBonus: { kind: 'available', value: 6 },
      damage: '1d4+4 piercing',
      description: 'A balanced magical blade.',
    });
  });

  it('matches weapon mastery against the saved identifier when the Foundry base-item key differs', () => {
    const source = { ...ref('war-pick', 'War Pick'), identifier: 'war-pick' };
    const entry = { entryId: 'war-pick', source, quantity: 1, equipped: false, provenance: [] };
    const warPick = weapon({
      ...source,
      category: 'martialM',
      subcategory: 'warpick',
      mastery: 'sap',
      description: 'A piercing weapon.',
    });
    const result = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } }, {
      inventoryItems: new Map([[entry.entryId, { kind: 'available', value: warPick }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:mar'], weaponMasteries: new Set(['war-pick']),
    });

    expect(result.groups.find(({ key }) => key === 'attacks')?.entries[0]).toMatchObject({ description: 'A piercing weapon.', weaponMastery: 'Sap' });
    expect(result.weaponReferences).toEqual([{ name: 'Sap' }]);
  });

  it('excludes unequipped, duplicate-status, and unattuned required-attunement weapons', () => {
    const items = ['unequipped', 'duplicate', 'attunement'].map((id) => ({ entryId: id, source: ref(id, id), quantity: 1, equipped: false, provenance: [] }));
    const result = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items }, equipmentStatus: [{ entryId: 'unequipped', equipped: false, attuned: false }, { entryId: 'duplicate', equipped: true, attuned: false }, { entryId: 'duplicate', equipped: true, attuned: false }, { entryId: 'attunement', equipped: true, attuned: false }] } }, {
      inventoryItems: new Map(items.map((item) => [item.entryId, { kind: 'available' as const, value: weapon({ ...ref(item.entryId, item.entryId), attunement: item.entryId === 'attunement' ? 'required' : undefined }) }])), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:mar'],
    });
    expect(result.groups.find(({ key }) => key === 'attacks')?.entries).toEqual([]);
    expect(result.warnings.join(' ')).toContain('equipment status');
  });

  it('groups spell and feature activities, adds unarmed strike, and compacts static combat help', () => {
    const spell: FoundrySpellSummary = { ...ref('shield', 'Shield', 'spell'), ruleset: '2024', level: 1, spellLists: [], ritual: false, activities: [{ id: 'cast', name: 'Cast Shield', type: 'utility', activation: { type: 'reaction' }, consumption: [] }] };
    const result = projectActionSheet({ ...document, mutable: { ...document.mutable!, preparedSpells: [spell] } }, { spellRows: [{ name: 'Shield', level: 1, source: { kind: 'available', value: spell }, prepared: { kind: 'available', value: true }, ownership: ['known-spells'] }], featureActivities: [{ sourceName: 'Second Wind', activity: { id: 'recover', name: 'Recover', type: 'utility', activation: { type: 'bonus' }, consumption: [] } }], abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [], includeCombatReference: true });
    expect(result.groups.map(({ key }) => key)).toEqual(['attacks', 'actions', 'bonus-actions', 'reactions', 'other', 'at-will', 'limited-use']);
    expect(result.groups.find(({ key }) => key === 'attacks')?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Unarmed strike', range: '5 ft.', attackBonus: { kind: 'available', value: 5 }, damage: '4 bludgeoning', staticReference: true }),
    ]));
    expect(result.groups.find(({ key }) => key === 'reactions')?.entries[0]?.name).toBe('Cast Shield');
    expect(result.groups.find(({ key }) => key === 'bonus-actions')?.entries[0]?.name).toBe('Recover');
    expect(result.groups.find(({ key }) => key === 'actions')?.entries).toEqual([]);
    expect(result.combatReference).toEqual(['Dash', 'Disengage', 'Dodge', 'Help', 'Hide', 'Ready', 'Search']);
  });

  it('shows cantrips and prepared leveled spells in Actions, but hides unprepared leveled spells', () => {
    const activity = { id: 'cast', type: 'utility' as const, activation: { type: 'action' }, consumption: [] };
    const spell = (id: string, name: string, level: number): FoundrySpellSummary => ({ ...ref(id, name, 'spell'), ruleset: '2024', level, spellLists: [], ritual: false, activities: [activity] });
    const unprepared = spell('unprepared', 'Unprepared spell', 1);
    const unknownPreparation = spell('unknown-preparation', 'Unknown preparation spell', 1);
    const prepared = spell('prepared', 'Prepared spell', 1);
    const alwaysPrepared = spell('always-prepared', 'Always prepared spell', 1);
    alwaysPrepared.preparation = 'always';
    const cantrip = spell('cantrip', 'Cantrip', 0);
    const result = projectActionSheet(document, {
      spellRows: [
        { name: unprepared.name, level: unprepared.level, source: { kind: 'available', value: unprepared }, prepared: { kind: 'available', value: false } },
        { name: unknownPreparation.name, level: unknownPreparation.level, source: { kind: 'available', value: unknownPreparation }, prepared: { kind: 'missing', reason: 'Preparation state is unavailable.' } },
        { name: prepared.name, level: prepared.level, source: { kind: 'available', value: prepared }, prepared: { kind: 'available', value: true } },
        { name: alwaysPrepared.name, level: alwaysPrepared.level, source: { kind: 'available', value: alwaysPrepared }, prepared: { kind: 'available', value: true }, ownership: ['granted'] },
        { name: cantrip.name, level: cantrip.level, source: { kind: 'available', value: cantrip }, prepared: { kind: 'available', value: false } },
      ],
      featureActivities: [{ sourceName: 'Breath Weapon', activity: { id: 'breath', name: 'Breath Weapon', type: 'save', activation: { type: 'action' }, consumption: [] } }],
      proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [],
    });
    const actions = result.groups.flatMap(({ entries }) => entries.map(({ name }) => name));
    expect(actions).toEqual(expect.arrayContaining(['Prepared spell', 'Always prepared spell', 'Cantrip', 'Breath Weapon']));
    expect(actions).not.toContain('Unprepared spell');
    expect(actions).not.toContain('Unknown preparation spell');
  });

  it('groups feature activities by activation and recoverable resources and carries resolved damage', () => {
    const activity = (id: string, type: string, activation?: string) => ({ id, type, consumption: [], ...(activation === undefined ? {} : { activation: { type: activation } }) });
    const result = projectActionSheet(document, { proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [], featureActivities: [
      { sourceName: 'Sneak Attack', activity: { ...activity('sneak', 'save'), uses: { maximum: '1', recovery: [] }, damage: [{ types: ['acid', 'bludgeoning', 'cold', 'fire'] }], resolvedDamage: '1d6' } },
      { sourceName: 'Second Wind', activity: { ...activity('wind', 'utility'), resource: { key: 'feature:second-wind:activity:wind', current: { kind: 'available', value: 1 }, maximum: { kind: 'available', value: 2 }, reset: { kind: 'available', value: 'short rest' } } } },
      { sourceName: 'Strike', activity: activity('attack', 'attack', 'action') },
      { sourceName: 'Action', activity: activity('action', 'utility', 'action') },
      { sourceName: 'Bonus', activity: activity('bonus', 'utility', 'bonus') },
      { sourceName: 'Reaction', activity: activity('reaction', 'utility', 'reaction') },
    ] });

    const sneakAttack = result.groups.find(({ key }) => key === 'at-will')?.entries[0];
    expect(sneakAttack).toMatchObject({ name: 'Sneak Attack', damage: '1d6' });
    expect(sneakAttack?.resource).toBeUndefined();
    expect(sneakAttack?.damage).not.toContain('acid');
    expect(result.groups.find(({ key }) => key === 'limited-use')?.entries).toEqual([expect.objectContaining({ name: 'Second Wind', resource: { current: { kind: 'available', value: 1 }, maximum: { kind: 'available', value: 2 }, reset: { kind: 'available', value: 'short rest' } } })]);
    expect(result.groups.map(({ key, entries }) => [key, entries.map(({ name }) => name)])).toEqual([
      ['attacks', ['Strike']], ['actions', ['Action']], ['bonus-actions', ['Bonus']], ['reactions', ['Reaction']], ['other', []], ['at-will', ['Sneak Attack']], ['limited-use', ['Second Wind']],
    ]);
  });

  it('carries static save and target fields into the action reference', () => {
    const result = projectActionSheet(document, { spellRows: [], featureActivities: [{ sourceName: 'Breath Weapon', activity: { id: 'breath', name: 'Breath Weapon (Cone)', type: 'save', activation: { type: 'action' }, consumption: [], range: { units: 'self' }, target: { template: { type: 'cone', size: '15', units: 'ft' } }, save: { ability: ['dex'], dc: { calculation: 'con' } }, resolvedDamage: '1d10 fire' } }], abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [] });
    expect(result.groups.find(({ key }) => key === 'actions')?.entries[0]).toMatchObject({ damage: '1d10 fire', range: 'Self; 15 ft. cone', saveDc: { kind: 'available', value: 11 }, saveAbility: 'dex', target: { template: { type: 'cone', size: '15', units: 'ft' } }, save: { ability: ['dex'], dc: { calculation: 'con' } } });
  });

  it('ignores blank template dimensions without dropping real line width', () => {
    const result = projectActionSheet(document, { featureActivities: [
      { sourceName: 'Sneak Attack', activity: { id: 'sneak', name: 'Sneak Attack', type: 'damage', consumption: [], range: { units: 'self' }, target: { template: { type: '', size: '', width: '', units: '' }, affects: { type: 'creature' } }, resolvedDamage: '1d6' } },
      { sourceName: 'Breath Weapon', activity: { id: 'line', name: 'Breath Weapon (Line)', type: 'save', consumption: [], range: { units: 'self' }, target: { template: { type: 'line', size: '30', width: '5', units: 'ft' } }, save: { ability: ['dex'], dc: { calculation: 'con' } }, resolvedDamage: '1d10 fire' } },
    ], abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [] });
    const entries = result.groups.flatMap((group) => group.entries);

    expect(entries.find((entry) => entry.name === 'Sneak Attack')?.range).toBe('Self');
    expect(entries.find((entry) => entry.name === 'Breath Weapon (Line)')?.range).toBe('Self; 30 ft. line (5 ft. wide)');
  });

  it('leaves a custom save DC formula explicit instead of evaluating it', () => {
    const result = projectActionSheet(document, { featureActivities: [{ sourceName: 'Custom save', activity: { id: 'save', type: 'save', consumption: [], save: { ability: ['dex'], dc: { calculation: 'con', formula: '10 + @prof' } } } }], abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [] });
    const entry = result.groups.find(({ key }) => key === 'at-will')?.entries[0];

    expect(entry?.saveDc).toEqual({ kind: 'missing', reason: 'Saving throw DC formula is unsupported.' });
    expect(entry?.diagnostics).toContain('Saving throw DC formulas are unsupported.');
  });

  it('uses projected spellcasting facts and leaves utility actions without fact cards', () => {
    const spell: FoundrySpellSummary = { ...ref('burning-hands', 'Burning Hands', 'spell'), ruleset: '2024', level: 1, spellLists: [], ritual: false, range: { value: 15, units: 'ft' }, activities: [
      { id: 'save', name: 'Burning Hands', type: 'save', activation: { type: 'action' }, save: { ability: ['dex'], dc: { calculation: 'spellcasting' } }, damage: [{ number: 3, denomination: 6, types: ['fire'] }], consumption: [] },
      { id: 'attack', name: 'Spell attack', type: 'attack', activation: { type: 'action' }, attack: { type: 'ranged' }, consumption: [] },
      { id: 'utility', name: 'Light', type: 'utility', activation: { type: 'action' }, consumption: [] },
    ] };
    const result = projectActionSheet(document, { spellRows: [{ name: spell.name, level: spell.level, source: { kind: 'available', value: spell }, prepared: { kind: 'available', value: true } }], spellAttackBonus: { kind: 'available', value: 5 }, spellSaveDc: { kind: 'available', value: 13 }, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [] });
    const save = result.groups.find(({ key }) => key === 'actions')?.entries.find(({ name }) => name === 'Burning Hands');
    const attack = result.groups.find(({ key }) => key === 'attacks')?.entries.find(({ name }) => name === 'Spell attack');
    const utility = result.groups.find(({ key }) => key === 'actions')?.entries.find(({ name }) => name === 'Light');
    expect(save).toMatchObject({ factKind: 'save', range: '15 ft.', saveDc: { kind: 'available', value: 13 }, damage: '3d6 fire' });
    expect(attack).toMatchObject({ factKind: 'attack', range: '15 ft.', attackBonus: { kind: 'available', value: 5 } });
    expect(utility?.factKind).toBeUndefined();
  });

  it('keeps unsupported formulas explicit and does not mutate the character document', () => {
    const source = ref('bow', 'Bow');
    const item = weapon({ ...source, category: 'simple', damage: { number: 1, denomination: 8, bonus: '@mod', types: ['piercing'] }, activities: [{ id: 'attack', name: 'Bow attack', type: 'attack', activation: { type: 'action' }, attack: { ability: 'dex', bonus: '@prof' }, consumption: [] }] });
    const input = structuredClone(document);
    input.mutable!.inventory.items = [{ entryId: 'bow', source, quantity: 1, equipped: false, provenance: [] }];
    input.mutable!.equipmentStatus = [{ entryId: 'bow', equipped: true, attuned: false }];
    const before = structuredClone(input);
    const result = projectActionSheet(input, { inventoryItems: new Map([['bow', { kind: 'available', value: item }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:sim'] });
    expect(result.groups.find(({ key }) => key === 'attacks')?.entries[0]).toMatchObject({ attackBonus: { kind: 'missing' }, damage: '1d8 piercing' });
    expect(result.warnings.join(' ')).toContain('formula');
    expect(input).toEqual(before);
  });

  it('groups non-attack weapon activities by activation without deriving an attack or damage', () => {
    const source = ref('utility-weapon', 'Utility weapon');
    const item = weapon({ ...source, activities: [{ id: 'save', name: 'Disarm', type: 'save', activation: { type: 'bonus' }, attack: { ability: 'str' }, consumption: [] }] });
    const entry = { entryId: 'utility-weapon', source, quantity: 1, equipped: false, provenance: [] };
    const result = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } }, { inventoryItems: new Map([[entry.entryId, { kind: 'available', value: item }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:mar'] });
    const action = result.groups.find(({ key }) => key === 'bonus-actions')?.entries[0];
    expect(action).toMatchObject({ name: 'Disarm', attackBonus: { kind: 'missing' } });
    expect(action?.damage).toBeUndefined();
    expect(result.groups.find(({ key }) => key === 'attacks')?.entries).toEqual([]);
  });

  it('keeps damage unavailable for an unknown ability and omits proficiency for an untrained weapon', () => {
    const source = ref('unknown-ability', 'Unknown ability weapon');
    const entry = { entryId: 'unknown-ability', source, quantity: 1, equipped: false, provenance: [] };
    const unknownAbility = weapon({ ...source, activities: [{ id: 'attack', name: 'Unknown attack', type: 'attack', activation: { type: 'action' }, attack: { ability: 'mystery' }, consumption: [] }] });
    const noAbility = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } }, { inventoryItems: new Map([[entry.entryId, { kind: 'available', value: unknownAbility }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: ['weapon:mar'] });
    expect(noAbility.groups.find(({ key }) => key === 'attacks')?.entries[0]).toMatchObject({ attackBonus: { kind: 'missing' } });
    expect(noAbility.groups.find(({ key }) => key === 'attacks')?.entries[0]?.damage).toBeUndefined();

    const noTraining = projectActionSheet({ ...document, mutable: { ...document.mutable!, inventory: { ...document.mutable!.inventory, items: [entry] }, equipmentStatus: [{ entryId: entry.entryId, equipped: true, attuned: false }] } }, { inventoryItems: new Map([[entry.entryId, { kind: 'available', value: weapon({ ...source }) }]]), abilityResults: scores, proficiencyBonus: { kind: 'available', value: 2 }, weaponTraining: [] });
    expect(noTraining.groups.find(({ key }) => key === 'attacks')?.entries[0]).toMatchObject({ attackBonus: { kind: 'available', value: 3 }, damage: '1d8+3 bludgeoning' });
  });
});
