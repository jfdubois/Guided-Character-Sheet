import { describe, expect, it } from 'vitest';
import type { CharacterDocument } from '../src/character-model';
import type { FoundryItemSummary, FoundrySourceReference } from '../src/foundry-source-catalog';
import { projectInventorySheet, type ResolvedInventoryItems } from '../src/inventory-sheet-model';

const currency = { cp: 1, sp: 2, ep: 3, gp: 4, pp: 5 };
const source = (id: string, name: string): FoundrySourceReference => ({
  sourcePath: `packs/_source/equipment24/armor/${id}.yml`, pack: 'dnd5e.equipment24', type: 'equipment', id, name,
});
const summary = (reference: FoundrySourceReference, overrides: Partial<FoundryItemSummary> = {}): FoundryItemSummary => ({
  ...reference, ruleset: '2024', itemType: 'equipment', magic: false, equippable: true, properties: [], ...overrides,
});
const baseDocument = (): CharacterDocument => ({
  format: 1, kind: 'guided-character', name: 'Ayla', ruleset: '2024', step: 'background',
  foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'a'.repeat(40) },
  mutable: { preparedSpells: [], inventory: { items: [], currency: { ...currency } }, equipmentStatus: [], resources: [] },
});

describe('inventory sheet projection', () => {
  it.each([
    ['simpleM', 'simple melee'],
    ['simpleR', 'simple ranged'],
    ['martialM', 'martial melee'],
    ['martialR', 'martial ranged'],
  ])('shows the Foundry weapon category %s as %s', (category, label) => {
    const weapon = source('shortbow', 'Shortbow');
    const document = baseDocument();
    document.mutable!.inventory.items = [{ entryId: 'weapon', source: weapon, quantity: 1, equipped: false, provenance: [] }];
    document.mutable!.equipmentStatus = [{ entryId: 'weapon', equipped: false, attuned: false }];
    const resolved: ResolvedInventoryItems = new Map([['weapon', { kind: 'available', value: summary(weapon, { itemType: 'weapon', category }) }]]);

    const result = projectInventorySheet(document, resolved);

    expect(result.kind === 'available' ? result.rows[0]?.detail : undefined).toEqual(['weapon', label]);
  });

  it('sorts one uninterrupted list and renders a minimal custom item without invented actions', () => {
    const chain = source('chain-mail', 'Chain Mail');
    const shield = source('shield', 'Shield');
    const document = baseDocument();
    document.mutable!.inventory.items = [
      { entryId: 'custom:travel-journal', custom: { name: 'Travel journal' }, quantity: 1, equipped: false, provenance: [] },
      { entryId: 'source:shield', source: shield, quantity: 1, equipped: false, provenance: [] },
      { entryId: 'source:chain-mail', source: chain, quantity: 1, equipped: false, provenance: [] },
    ];
    document.mutable!.equipmentStatus = [
      { entryId: 'source:chain-mail', equipped: true, attuned: false },
      { entryId: 'source:shield', equipped: false, attuned: false },
      { entryId: 'custom:travel-journal', equipped: false, attuned: false },
    ];
    const resolved: ResolvedInventoryItems = new Map([
      ['source:chain-mail', { kind: 'available', value: summary(chain, { category: 'heavy', weight: { value: 55, units: 'lb' } }) }],
      ['source:shield', { kind: 'available', value: summary(shield, { category: 'shield', attunement: 'optional', weight: { value: 6, units: 'lb' } }) }],
    ]);

    const result = projectInventorySheet(document, resolved);

    expect(result.kind).toBe('available');
    if (result.kind !== 'available') return;
    expect(result.rows.map((row) => row.name)).toEqual(['Chain Mail', 'Shield', 'Travel journal']);
    expect(result.rows.find((row) => row.name === 'Travel journal')).toMatchObject({ quantity: 1, equipAction: null, attuneAction: null });
    expect(result.rows.find((row) => row.name === 'Chain Mail')?.equipAction).toEqual({ kind: 'available', label: 'Equipped', active: true });
    expect(result.rows.find((row) => row.name === 'Shield')?.attuneAction).toEqual({ kind: 'available', label: 'Attune', active: false });
    expect(result.currency).toEqual(currency);
    expect(result.currency).not.toBe(document.mutable!.inventory.currency);
    expect(result.totalWeight).toEqual({ kind: 'missing', reason: expect.stringContaining('weight') });
  });

  it('orders equal display names by entry ID', () => {
    const document = baseDocument();
    document.mutable!.inventory.items = [
      { entryId: 'custom:z', custom: { name: 'Token' }, quantity: 1, equipped: false, provenance: [] },
      { entryId: 'custom:a', custom: { name: 'Token' }, quantity: 1, equipped: false, provenance: [] },
    ];
    document.mutable!.equipmentStatus = document.mutable!.inventory.items.map(({ entryId }) => ({ entryId, equipped: false, attuned: false }));
    const result = projectInventorySheet(document, new Map());
    expect(result.kind === 'available' ? result.rows.map(({ entryId }) => entryId) : []).toEqual(['custom:a', 'custom:z']);
  });

  it('keeps missing and duplicate equipment status unknown', () => {
    const chain = source('chain-mail', 'Chain Mail');
    const document = baseDocument();
    document.mutable!.inventory.items = [{ entryId: 'source:chain', source: chain, quantity: 1, equipped: true, provenance: [] }];
    const resolved: ResolvedInventoryItems = new Map([['source:chain', { kind: 'available', value: summary(chain) }]]);

    const missing = projectInventorySheet(document, resolved);
    expect(missing.kind === 'available' ? missing.rows[0]?.equipAction : null).toEqual({ kind: 'missing', reason: 'Equipment status is missing.' });

    document.mutable!.equipmentStatus = [
      { entryId: 'source:chain', equipped: true, attuned: false },
      { entryId: 'source:chain', equipped: false, attuned: true },
    ];
    const duplicate = projectInventorySheet(document, resolved);
    expect(duplicate.kind === 'available' ? duplicate.rows[0]?.equipAction : null).toEqual({ kind: 'missing', reason: 'Equipment status is duplicated.' });
    expect(duplicate.kind === 'available' ? duplicate.warnings : []).toEqual([expect.stringContaining('Chain Mail')]);
  });

  it('requires complete compatible weights and does not mutate its input', () => {
    const first = source('first', 'First');
    const second = source('second', 'Second');
    const document = baseDocument();
    document.mutable!.inventory.items = [
      { entryId: 'first', source: first, quantity: 2, equipped: false, provenance: [] },
      { entryId: 'second', source: second, quantity: 3, equipped: false, provenance: [] },
    ];
    document.mutable!.equipmentStatus = document.mutable!.inventory.items.map(({ entryId }) => ({ entryId, equipped: false, attuned: false }));
    const before = structuredClone(document);
    const incompatible: ResolvedInventoryItems = new Map([
      ['first', { kind: 'available', value: summary(first, { weight: { value: 2, units: 'lb' } }) }],
      ['second', { kind: 'available', value: summary(second, { weight: { value: 1, units: 'kg' } }) }],
    ]);
    const result = projectInventorySheet(document, incompatible);
    expect(result.kind === 'available' ? result.totalWeight : null).toEqual({ kind: 'missing', reason: expect.stringContaining('units') });
    expect(document).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('NaN');
  });

  it('calculates a complete stack total when every unit is compatible', () => {
    const rope = source('rope', 'Rope');
    const document = baseDocument();
    document.mutable!.inventory.items = [{ entryId: 'rope', source: rope, quantity: 3, equipped: false, provenance: [] }];
    document.mutable!.equipmentStatus = [{ entryId: 'rope', equipped: false, attuned: false }];
    const result = projectInventorySheet(document, new Map([['rope', { kind: 'available', value: summary(rope, { weight: { value: 2, units: 'lb' } }) }]]));
    expect(result.kind === 'available' ? result.totalWeight : null).toEqual({ kind: 'available', value: { value: 6, units: 'lb' } });
  });

  it('does not fall back to creation-time inventory when mutable inventory is missing', () => {
    const document = baseDocument();
    document.inventory = { items: [{ entryId: 'custom:old', custom: { name: 'Old item' }, quantity: 1, equipped: false, provenance: [] }], currency: { ...currency } };
    delete document.mutable;
    expect(projectInventorySheet(document, new Map())).toEqual({ kind: 'missing', reason: 'Mutable inventory is not available from character finalization.', warnings: [] });
  });

  it('projects an explicit empty mutable inventory without inventing a weight unit', () => {
    const result = projectInventorySheet(baseDocument(), new Map());
    expect(result).toMatchObject({ kind: 'available', rows: [], totalWeight: { kind: 'missing', reason: 'No carried items.' }, currency });
  });

  it('uses unarmored defense when no armor is equipped', () => {
    const result = projectInventorySheet(baseDocument(), new Map(), 2);

    expect(result.kind === 'available' ? result.armor.armorClass : null).toEqual({ kind: 'available', value: 12 });
  });

  it('projects pinned Draconic unarmored AC calculations with their distinct base rules', () => {
    const bard = projectInventorySheet(baseDocument(), new Map(), 2, { calculation: 'unarmoredBard', secondaryModifier: 3 });
    const draconic = projectInventorySheet(baseDocument(), new Map(), 2, { calculation: 'draconic', secondaryModifier: 0, base: 13 });
    expect(bard.kind === 'available' ? bard.armor.armorClass : null).toEqual({ kind: 'available', value: 15 });
    expect(draconic.kind === 'available' ? draconic.armor.armorClass : null).toEqual({ kind: 'available', value: 15 });
  });

  it('projects equipped medium armor, a shield, and Stealth disadvantage', () => {
    const armor = source('scale-mail', 'Scale Mail');
    const shield = source('shield', 'Shield');
    const document = baseDocument();
    document.mutable!.inventory.items = [
      { entryId: 'armor', source: armor, quantity: 1, equipped: false, provenance: [] },
      { entryId: 'shield', source: shield, quantity: 1, equipped: false, provenance: [] },
    ];
    document.mutable!.equipmentStatus = [
      { entryId: 'armor', equipped: true, attuned: false },
      { entryId: 'shield', equipped: true, attuned: false },
    ];
    const resolved: ResolvedInventoryItems = new Map([
      ['armor', { kind: 'available', value: summary(armor, { category: 'medium', armor: { value: 14, dex: 2 }, properties: ['stealthDisadvantage'] }) }],
      ['shield', { kind: 'available', value: summary(shield, { category: 'shield', armor: { value: 2 } }) }],
    ]);

    const result = projectInventorySheet(document, resolved, 3);

    expect(result.kind).toBe('available');
    if (result.kind !== 'available') return;
    expect(result.armor.armorClass).toEqual({ kind: 'available', value: 18 });
    expect(result.armor.stealthDisadvantageSources).toEqual(['Scale Mail']);
  });

  it('clamps Dexterity for heavy armor and supports structured custom armor', () => {
    const chain = source('chain-mail', 'Chain Mail');
    const foundryDocument = baseDocument();
    foundryDocument.mutable!.inventory.items = [{ entryId: 'chain', source: chain, quantity: 1, equipped: false, provenance: [] }];
    foundryDocument.mutable!.equipmentStatus = [{ entryId: 'chain', equipped: true, attuned: false }];
    const foundry = projectInventorySheet(foundryDocument, new Map([
      ['chain', { kind: 'available', value: summary(chain, { category: 'heavy', armor: { value: 16, dex: 0 } }) }],
    ]), 2);
    expect(foundry.kind === 'available' ? foundry.armor.armorClass : null).toEqual({ kind: 'available', value: 16 });

    const customDocument = baseDocument();
    customDocument.mutable!.inventory.items = [{
      entryId: 'custom:moon-mail', quantity: 1, equipped: false, provenance: [],
      custom: { name: 'Moon mail', category: 'medium', equippable: true, armor: { value: 14, dex: 2 }, stealthDisadvantage: true },
    }];
    customDocument.mutable!.equipmentStatus = [{ entryId: 'custom:moon-mail', equipped: true, attuned: false }];
    const custom = projectInventorySheet(customDocument, new Map(), 3);
    expect(custom.kind === 'available' ? custom.armor : null).toEqual({ armorClass: { kind: 'available', value: 16 }, stealthDisadvantageSources: ['Moon mail'] });
  });

  it('does not subtract negative Dexterity from heavy armor with a shield', () => {
    const chain = source('chain-mail', 'Chain Mail');
    const shield = source('shield', 'Shield');
    const document = baseDocument();
    document.mutable!.inventory.items = [
      { entryId: 'chain', source: chain, quantity: 1, equipped: false, provenance: [] },
      { entryId: 'shield', source: shield, quantity: 1, equipped: false, provenance: [] },
    ];
    document.mutable!.equipmentStatus = document.mutable!.inventory.items.map(({ entryId }) => ({ entryId, equipped: true, attuned: false }));
    const result = projectInventorySheet(document, new Map([
      ['chain', { kind: 'available', value: summary(chain, { category: 'heavy', armor: { value: 16, dex: 0 } }) }],
      ['shield', { kind: 'available', value: summary(shield, { category: 'shield', armor: { value: 2 } }) }],
    ]), -1);

    expect(result.kind === 'available' ? result.armor.armorClass : null).toEqual({ kind: 'available', value: 18 });
  });

  it('preserves confirmed Stealth disadvantage when an unrelated item source is unresolved in either order', () => {
    const scale = source('scale-mail', 'Scale Mail');
    const rope = source('rope', 'Rope');
    for (const items of [[scale, rope], [rope, scale]]) {
      const document = baseDocument();
      document.mutable!.inventory.items = items.map((item) => ({ entryId: item.id, source: item, quantity: 1, equipped: false, provenance: [] }));
      document.mutable!.equipmentStatus = [
        { entryId: 'scale-mail', equipped: true, attuned: false },
        { entryId: 'rope', equipped: false, attuned: false },
      ];
      const result = projectInventorySheet(document, new Map([
        ['scale-mail', { kind: 'available', value: summary(scale, { category: 'medium', armor: { value: 14, dex: 2 }, properties: ['stealthDisadvantage'] }) }],
        ['rope', { kind: 'missing', reason: 'Inventory source unavailable for Rope.' }],
      ]), 1);

      expect(result.kind === 'available' ? result.armor : null).toEqual({
        armorClass: { kind: 'missing', reason: 'Item source details are unavailable for Rope.' },
        stealthDisadvantageSources: ['Scale Mail'],
      });
    }
  });

  it('preserves confirmed Stealth disadvantage around missing and duplicate armor status in either order', () => {
    const scale = source('scale-mail', 'Scale Mail');
    const chain = source('chain-mail', 'Chain Mail');
    for (const statusKind of ['missing', 'duplicated'] as const) {
      for (const items of [[scale, chain], [chain, scale]]) {
        const document = baseDocument();
        document.mutable!.inventory.items = items.map((item) => ({ entryId: item.id, source: item, quantity: 1, equipped: false, provenance: [] }));
        document.mutable!.equipmentStatus = [
          { entryId: 'scale-mail', equipped: true, attuned: false },
          ...(statusKind === 'duplicated' ? [
            { entryId: 'chain-mail', equipped: true, attuned: false },
            { entryId: 'chain-mail', equipped: false, attuned: false },
          ] : []),
        ];
        const resolved: ResolvedInventoryItems = new Map([
          ['scale-mail', { kind: 'available', value: summary(scale, { category: 'medium', armor: { value: 14, dex: 2 }, properties: ['stealthDisadvantage'] }) }],
          ['chain-mail', { kind: 'available', value: summary(chain, { category: 'heavy', armor: { value: 16, dex: 0 } }) }],
        ]);
        const result = projectInventorySheet(document, resolved, 1);

        expect(result.kind === 'available' ? result.armor : null).toEqual({
          armorClass: { kind: 'missing', reason: `Equipment status is ${statusKind} for Chain Mail.` },
          stealthDisadvantageSources: ['Scale Mail'],
        });
      }
    }
  });

  it('refuses armor class when equipped armor or shield candidates conflict', () => {
    const armorA = source('armor-a', 'Armor A');
    const armorB = source('armor-b', 'Armor B');
    const document = baseDocument();
    document.mutable!.inventory.items = [armorA, armorB].map((item, index) => ({ entryId: `armor-${index}`, source: item, quantity: 1, equipped: false, provenance: [] }));
    document.mutable!.equipmentStatus = document.mutable!.inventory.items.map(({ entryId }) => ({ entryId, equipped: true, attuned: false }));
    const resolved: ResolvedInventoryItems = new Map([
      ['armor-0', { kind: 'available', value: summary(armorA, { category: 'light', armor: { value: 11 } }) }],
      ['armor-1', { kind: 'available', value: summary(armorB, { category: 'heavy', armor: { value: 16, dex: 0 } }) }],
    ]);
    const armorConflict = projectInventorySheet(document, resolved, 2);
    expect(armorConflict.kind === 'available' ? armorConflict.armor.armorClass : null).toEqual({ kind: 'missing', reason: 'Multiple equipped armor items prevent armor class projection.' });

    document.mutable!.inventory.items = [armorA, armorB].map((item, index) => ({ entryId: `shield-${index}`, source: item, quantity: 1, equipped: false, provenance: [] }));
    document.mutable!.equipmentStatus = document.mutable!.inventory.items.map(({ entryId }) => ({ entryId, equipped: true, attuned: false }));
    const shields: ResolvedInventoryItems = new Map([
      ['shield-0', { kind: 'available', value: summary(armorA, { category: 'shield', armor: { value: 2 } }) }],
      ['shield-1', { kind: 'available', value: summary(armorB, { category: 'shield', armor: { value: 2 } }) }],
    ]);
    const shieldConflict = projectInventorySheet(document, shields, 2);
    expect(shieldConflict.kind === 'available' ? shieldConflict.armor.armorClass : null).toEqual({ kind: 'missing', reason: 'Multiple equipped shields prevent armor class projection.' });
  });

  it('keeps armor class missing when an armor candidate has unknown equipment state', () => {
    const armor = source('chain-mail', 'Chain Mail');
    const document = baseDocument();
    document.mutable!.inventory.items = [{ entryId: 'armor', source: armor, quantity: 1, equipped: false, provenance: [] }];
    const result = projectInventorySheet(document, new Map([
      ['armor', { kind: 'available', value: summary(armor, { category: 'heavy', armor: { value: 16, dex: 0 } }) }],
    ]), 2);
    expect(result.kind === 'available' ? result.armor.armorClass : null).toEqual({ kind: 'missing', reason: 'Equipment status is missing for Chain Mail.' });
  });

  it('uses the eligible Unarmored Defense calculation while respecting Monk shield exclusion', () => {
    const barbarian = projectInventorySheet(baseDocument(), new Map(), 2, { calculation: 'unarmoredBarb', secondaryModifier: 1 });
    const monk = projectInventorySheet(baseDocument(), new Map(), 2, { calculation: 'unarmoredMonk', secondaryModifier: 0 });
    expect(barbarian.kind === 'available' ? barbarian.armor.armorClass : null).toEqual({ kind: 'available', value: 13 });
    expect(monk.kind === 'available' ? monk.armor.armorClass : null).toEqual({ kind: 'available', value: 12 });

    const shield = source('shield', 'Shield');
    const withShield = baseDocument();
    withShield.mutable!.inventory.items = [{ entryId: 'shield', source: shield, quantity: 1, equipped: true, provenance: [] }];
    withShield.mutable!.equipmentStatus = [{ entryId: 'shield', equipped: true, attuned: false }];
    const shieldedMonk = projectInventorySheet(withShield, new Map([['shield', { kind: 'available', value: summary(shield, { category: 'shield', armor: { value: 2 } }) }]]), 2, { calculation: 'unarmoredMonk', secondaryModifier: 0 });
    expect(shieldedMonk.kind === 'available' ? shieldedMonk.armor.armorClass : null).toEqual({ kind: 'available', value: 14 });

    const barbarianWithShield = projectInventorySheet(withShield, new Map([['shield', { kind: 'available', value: summary(shield, { category: 'shield', armor: { value: 2 } }) }]]), 2, { calculation: 'unarmoredBarb', secondaryModifier: 1 });
    expect(barbarianWithShield.kind === 'available' ? barbarianWithShield.armor.armorClass : null).toEqual({ kind: 'available', value: 15 });

    const chain = source('chain-mail', 'Chain Mail');
    const armored = baseDocument();
    armored.mutable!.inventory.items = [{ entryId: 'chain', source: chain, quantity: 1, equipped: true, provenance: [] }];
    armored.mutable!.equipmentStatus = [{ entryId: 'chain', equipped: true, attuned: false }];
    const armoredBarbarian = projectInventorySheet(armored, new Map([['chain', { kind: 'available', value: summary(chain, { category: 'heavy', armor: { value: 16, dex: 0 } }) }]]), 2, { calculation: 'unarmoredBarb', secondaryModifier: 1 });
    expect(armoredBarbarian.kind === 'available' ? armoredBarbarian.armor.armorClass : null).toEqual({ kind: 'available', value: 16 });
  });
});
