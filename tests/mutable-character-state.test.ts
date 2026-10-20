import { describe, expect, it } from 'vitest';
import { createCharacterDocument, parseCharacterDocument, withMutableState } from '../src/character-model';
import { adjustHitPoints, adjustMutableResourceCurrent, createFinalizedMutableCharacterState, type MutableCharacterState } from '../src/mutable-character-state';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
const spell = { sourcePath: 'packs/_source/spells24/1st-level/bless.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'bless', name: 'Bless' };
const item = { sourcePath: 'packs/_source/items/weapon/mace.yml', pack: 'dnd5e.items', type: 'weapon', id: 'mace', name: 'Mace' };
const state: MutableCharacterState = {
  hitPoints: { current: 10, maximum: 10, temporary: 0 },
  inspiration: false,
  spellSlots: [{ level: 1, current: 2, maximum: 2 }],
  spellUses: [{ key: 'spell:packs/_source/classes24/wizard/wizard.yml:arcane-recovery', current: 1, maximum: 1, reset: 'long-rest' }],
  preparedSpells: [spell],
  inventory: { items: [{ entryId: 'mace', source: item, quantity: 1, equipped: false, provenance: [], item: { itemType: 'weapon', category: 'simple', magic: false, weight: { value: 4 }, price: { value: 2.5, denomination: 'gp' } } }], currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } },
  equipmentStatus: [{ entryId: 'mace', equipped: true, attuned: false }],
  resources: [{ key: 'second-wind', current: 1, maximum: 1, reset: 'short-rest' }],
};

describe('mutable character state', () => {
  it('applies heal, damage, and temporary hit-point adjustments independently', () => {
    const hp = { current: 8, maximum: 10, temporary: 3 };
    expect(adjustHitPoints(hp, 'heal', 5)).toEqual({ current: 10, maximum: 10, temporary: 3 });
    expect(adjustHitPoints(hp, 'damage', 2)).toEqual({ current: 8, maximum: 10, temporary: 1 });
    expect(adjustHitPoints(hp, 'damage', 5)).toEqual({ current: 6, maximum: 10, temporary: 0 });
    expect(adjustHitPoints(hp, 'temp', 7)).toEqual({ current: 8, maximum: 10, temporary: 7 });
    expect(adjustHitPoints(hp, 'damage', 99)).toEqual({ current: 0, maximum: 10, temporary: 0 });
    expect(adjustHitPoints({ current: 8, maximum: 10 }, 'damage', 2)).toEqual({ current: 6, maximum: 10, temporary: 0 });
    expect(() => adjustHitPoints(hp, 'damage', -1)).toThrow('Invalid hit-point adjustment');
    expect(() => adjustHitPoints(hp, 'heal', 1.5)).toThrow('Invalid hit-point adjustment');
  });
  it('applies and clears an effective maximum override without losing the calculated maximum', () => {
    const overridden = adjustHitPoints({ current: 8, maximum: 10, temporary: 2 }, 'maximum', 15);
    expect(overridden).toEqual({ current: 8, maximum: 10, maximumOverride: 15, temporary: 2 });
    expect(adjustHitPoints(overridden, 'heal', 99)).toEqual({ current: 15, maximum: 10, maximumOverride: 15, temporary: 2 });
    expect(adjustHitPoints({ ...overridden, current: 12 }, 'clear-maximum', 0)).toEqual({ current: 10, maximum: 10, temporary: 2 });
    expect(adjustHitPoints({ ...overridden, current: 12 }, 'maximum', 6)).toEqual({ current: 6, maximum: 10, maximumOverride: 6, temporary: 2 });
    expect(adjustHitPoints(overridden, 'maximum', 0)).toEqual({ current: 0, maximum: 10, maximumOverride: 0, temporary: 2 });
  });
  it('clamps independent usage adjustments to the resource bounds', () => {
    expect(adjustMutableResourceCurrent(2, 2, -1)).toBe(1);
    expect(adjustMutableResourceCurrent(0, 2, -1)).toBe(0);
    expect(adjustMutableResourceCurrent(2, 2, 1)).toBe(2);
    expect(adjustMutableResourceCurrent(1, 2, 1)).toBe(2);
  });
  it('is optional for old character documents', () => expect(parseCharacterDocument(createCharacterDocument('Ayla', snapshot))).not.toHaveProperty('mutable'));
  it('normalizes legacy persisted hit points without temporary HP', () => {
    const legacy = { ...createCharacterDocument('Ayla', snapshot), mutable: { ...state, hitPoints: { current: 7, maximum: 10 } } };
    expect(parseCharacterDocument(legacy).mutable?.hitPoints).toEqual({ current: 7, maximum: 10, temporary: 0 });
  });
  it('round-trips a manual effective maximum without replacing the calculated maximum', () => {
    const overridden = { ...createCharacterDocument('Ayla', snapshot), mutable: { ...state, hitPoints: { current: 12, maximum: 10, maximumOverride: 15, temporary: 2 } } };
    expect(parseCharacterDocument(JSON.parse(JSON.stringify(overridden))).mutable?.hitPoints).toEqual({ current: 12, maximum: 10, maximumOverride: 15, temporary: 2 });
  });
  it('accepts valid partial mutable state and sanitizes references', () => {
    const parsed = parseCharacterDocument({ ...createCharacterDocument('Ayla', snapshot), mutable: { ...state, preparedSpells: [{ ...spell, raw: { system: {} } }] } });
    expect(parsed.mutable?.preparedSpells).toEqual([spell]);
  });
  it('round-trips and sanitizes an optional post-creation spell overlay', () => {
    const overlay = {
      added: [{ reference: { ...spell, raw: { system: {} } }, ownership: 'known-spells' as const }],
      removed: [{ ...spell, id: 'shield', name: 'Shield', raw: { system: {} } }],
    };
    const document = withMutableState(createCharacterDocument('Ayla', snapshot), { ...state, spellOverlay: overlay });
    expect(parseCharacterDocument(JSON.parse(JSON.stringify(document))).mutable?.spellOverlay).toEqual({
      added: [{ reference: spell, ownership: 'known-spells' }],
      removed: [{ ...spell, id: 'shield', name: 'Shield' }],
    });
  });
  it.each([
    ['duplicate added references', { added: [{ reference: spell, ownership: 'known-spells' }, { reference: spell, ownership: 'spellbook' }], removed: [] }],
    ['duplicate removed references', { added: [], removed: [spell, spell] }],
    ['added and removed conflict', { added: [{ reference: spell, ownership: 'known-spells' }], removed: [spell] }],
    ['invalid ownership role', { added: [{ reference: spell, ownership: 'prepared-spells' }], removed: [] }],
    ['invalid added reference', { added: [{ reference: { ...spell, type: 'feat' }, ownership: 'known-spells' }], removed: [] }],
    ['invalid removed reference', { added: [], removed: [{ ...spell, sourcePath: 'packs/_source/spells24/bless.json' }] }],
  ])('rejects %s in a spell overlay', (_label, spellOverlay) => {
    expect(() => parseCharacterDocument({ ...createCharacterDocument('Ayla', snapshot), mutable: { ...state, spellOverlay } })).toThrow('Invalid character document');
  });
  it('accepts optional item metadata and finite fractional currency', () => {
    const parsed = parseCharacterDocument({ ...createCharacterDocument('Ayla', snapshot), mutable: { ...state, inventory: { ...state.inventory, currency: { cp: 0.5, sp: 1, ep: 0, gp: 10, pp: 0 } } } });
    expect(parsed.mutable?.inventory.items[0].item).toEqual(state.inventory.items[0].item);
  });
  it('accepts minimal and structured character-owned custom items unchanged', () => {
    const minimalCustom = { entryId: 'custom:travel-journal', quantity: 1, equipped: false, provenance: [], custom: { name: 'Travel journal' } };
    const customArmor = {
      entryId: 'custom:moon-mail', quantity: 1, equipped: false, provenance: [],
      custom: { name: 'Moon mail', category: 'medium', weight: { value: 20, units: 'lb' }, equippable: true, attunement: 'optional', armor: { value: 14, dex: 2 }, strength: 11, stealthDisadvantage: true },
    };
    const mutable = { ...state, inventory: { ...state.inventory, items: [minimalCustom, customArmor] } };

    expect(parseCharacterDocument({ ...createCharacterDocument('Ayla', snapshot), mutable }).mutable?.inventory.items).toEqual([minimalCustom, customArmor]);
  });
  it.each([
    ['missing custom name', { entryId: 'custom:bad', quantity: 1, equipped: false, provenance: [], custom: {} }],
    ['missing persisted quantity', { entryId: 'custom:bad', equipped: false, provenance: [], custom: { name: 'Bad' } }],
    ['both inventory origins', { entryId: 'custom:bad', source: item, quantity: 1, equipped: false, provenance: [], custom: { name: 'Bad' } }],
    ['no inventory origin', { entryId: 'custom:bad', quantity: 1, equipped: false, provenance: [] }],
    ['negative custom weight', { entryId: 'custom:bad', quantity: 1, equipped: false, provenance: [], custom: { name: 'Bad', weight: { value: -1, units: 'lb' } } }],
    ['incomplete custom price', { entryId: 'custom:bad', quantity: 1, equipped: false, provenance: [], custom: { name: 'Bad', price: { value: 1 } } }],
    ['invalid custom armor cap', { entryId: 'custom:bad', quantity: 1, equipped: false, provenance: [], custom: { name: 'Bad', armor: { value: 12, dex: Number.NaN } } }],
    ['invalid custom attunement', { entryId: 'custom:bad', quantity: 1, equipped: false, provenance: [], custom: { name: 'Bad', attunement: 'always' } }],
  ])('rejects %s', (_label, entry) => {
    const mutable = { ...state, inventory: { ...state.inventory, items: [entry] } };
    expect(() => parseCharacterDocument({ ...createCharacterDocument('Ayla', snapshot), mutable })).toThrow('Invalid character document');
  });
  it('round-trips mutable state without changing creation selections', () => {
    const document = withMutableState({ ...createCharacterDocument('Ayla', snapshot), ruleset: '2024', step: 'origin', origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' } }, state);
    expect(parseCharacterDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(document.origin?.identifier).toBe('elf');
  });
  it('round-trips normalized recovery profiles without sharing mutable arrays', () => {
    const recovery = [{ period: 'long-rest' as const, type: 'recover-all' as const }, { period: 'short-rest' as const, type: 'formula' as const, formula: '1' }];
    const input = { ...state, resources: [{ ...state.resources[0]!, recovery }] };
    const parsed = parseCharacterDocument({ ...createCharacterDocument('Ayla', snapshot), mutable: input }).mutable!;
    expect(parsed.resources[0]?.recovery).toEqual(recovery);
    expect(parsed.resources[0]?.recovery).not.toBe(recovery);
  });
  it('creates authoritative level-one mutable defaults from class progression', () => {
    const finalized = createFinalizedMutableCharacterState(state.inventory, {
      ruleset: '2024', classSourcePath: 'packs/_source/classes24/fighter/fighter.yml',
      classHitDie: 'd10',
      constitutionModifier: 2,
      spellSlots: [{ key: 'spell:1', kind: 'spell', level: 1, maximum: 2, recovery: ['long-rest'] }],
    });
    expect(finalized.hitPoints).toEqual({ current: 12, maximum: 12, temporary: 0 });
    expect(finalized.inspiration).toBe(false);
    expect(finalized.hitDice).toEqual([{ classSourcePath: 'packs/_source/classes24/fighter/fighter.yml', denomination: 'd10', current: 1, maximum: 1 }]);
    expect(finalized.spellSlots).toEqual([{ key: 'spell:1', kind: 'spell', level: 1, current: 2, maximum: 2, recovery: ['long-rest'] }]);
  });

  it('does not add 2024 Hit Point Dice semantics to a 2014 finalization', () => {
    const finalized = createFinalizedMutableCharacterState(state.inventory, { ruleset: '2014', classSourcePath: 'packs/_source/classes/fighter.yml', classHitDie: 'd10', constitutionModifier: 2, spellSlots: [] });
    expect(finalized.hitDice).toBeUndefined();
  });
  it('adds supported permanent HP modifiers before creating mutable state', () => {
    const finalized = createFinalizedMutableCharacterState(state.inventory, {
      classSourcePath: 'packs/_source/classes24/fighter/fighter.yml', classHitDie: 'd10', constitutionModifier: 2,
      characterLevel: 1, permanentHitPointModifiers: [{ perLevel: 1, sourcePath: 'packs/_source/origins24/species/traits/dwarf/dwarven-toughness.yml' }], spellSlots: [],
    });
    expect(finalized.hitPoints).toEqual({ current: 13, maximum: 13, temporary: 0 });
  });
  it('rejects duplicate permanent HP modifier provenance', () => {
    const modifier = { perLevel: 1, sourcePath: 'packs/_source/origins24/species/traits/dwarf/dwarven-toughness.yml' };
    expect(() => createFinalizedMutableCharacterState(state.inventory, {
      classSourcePath: 'packs/_source/classes24/fighter/fighter.yml', classHitDie: 'd10', constitutionModifier: 2,
      characterLevel: 1, permanentHitPointModifiers: [modifier, modifier], spellSlots: [],
    })).toThrow('Duplicate permanent hit-point modifier');
  });
  it('fails finalization when authoritative hit-die data is unavailable', () => {
    expect(() => createFinalizedMutableCharacterState(state.inventory, { classSourcePath: 'packs/_source/classes24/fighter/fighter.yml', classHitDie: 'd?', constitutionModifier: 2, spellSlots: [] })).toThrow('class hit die');
  });
  it('fails finalization when the calculated maximum hit points are not positive', () => {
    expect(() => createFinalizedMutableCharacterState(state.inventory, { classSourcePath: 'packs/_source/classes24/fighter/fighter.yml', classHitDie: 'd6', constitutionModifier: -6, spellSlots: [] })).toThrow('maximum hit points');
  });
  it('rejects invalid spell uses and resources before returning finalized state', () => {
    const options = { classSourcePath: 'packs/_source/classes24/fighter/fighter.yml', classHitDie: 'd10', constitutionModifier: 2, spellSlots: [] };
    expect(() => createFinalizedMutableCharacterState(state.inventory, { ...options, spellUses: [{ key: 'ward', current: -1, maximum: 1, reset: 'long-rest' }] })).toThrow('finalized mutable');
    expect(() => createFinalizedMutableCharacterState(state.inventory, { ...options, resources: [{ key: 'ward', current: 1, maximum: 1, reset: 'short-rest' }, { key: 'ward', current: 1, maximum: 1, reset: 'short-rest' }] })).toThrow('finalized mutable');
  });
  it.each([
    ['invalid spell references', { ...state, preparedSpells: [{ ...spell, type: 'feat' }] }],
    ['negative resources', { ...state, resources: [{ ...state.resources[0], current: -1 }] }],
    ['non-integer resources', { ...state, resources: [{ ...state.resources[0], maximum: 1.5 }] }],
    ['invalid reset values', { ...state, resources: [{ ...state.resources[0], reset: 'daily' }] }],
    ['malformed equipment status', { ...state, equipmentStatus: [{ entryId: '', equipped: true, attuned: false }] }],
    ['malformed source references', { ...state, preparedSpells: [{ ...spell, sourcePath: 'packs/_source/spells24/bless.json' }] }],
    ['whitespace source references', { ...state, preparedSpells: [{ ...spell, pack: ' ', id: ' ', name: ' ' }] }],
    ['zero maximum hit points', { ...state, hitPoints: { current: 0, maximum: 0, temporary: 0 } }],
    ['current hit points above maximum', { ...state, hitPoints: { current: 11, maximum: 10, temporary: 0 } }],
    ['fractional maximum override', { ...state, hitPoints: { current: 0, maximum: 10, maximumOverride: 1.5, temporary: 0 } }],
    ['current hit points above maximum override', { ...state, hitPoints: { current: 11, maximum: 10, maximumOverride: 8, temporary: 0 } }],
    ['duplicate spell slots', { ...state, spellSlots: [{ level: 1, current: 1, maximum: 1 }, { level: 1, current: 1, maximum: 1 }] }],
    ['unsafe Hit Point Die source', { ...state, hitDice: [{ classSourcePath: '../fighter.yml', denomination: 'd10', current: 1, maximum: 1 }] }],
    ['invalid Hit Point Die denomination', { ...state, hitDice: [{ classSourcePath: 'classes/fighter.yml', denomination: 'd20', current: 1, maximum: 1 }] }],
    ['negative spell use', { ...state, spellUses: [{ ...state.spellUses![0], current: -1 }] }],
    ['duplicate spell uses', { ...state, spellUses: [state.spellUses![0]!, state.spellUses![0]!] }],
    ['duplicate resources', { ...state, resources: [state.resources[0]!, state.resources[0]!] }],
    ['invalid inspiration', { ...state, inspiration: 'false' }],
  ])('rejects %s', (_label, mutable) => expect(() => parseCharacterDocument({ ...createCharacterDocument('Ayla', snapshot), mutable })).toThrow('Invalid character document'));
});
