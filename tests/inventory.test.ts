import { describe, expect, it } from 'vitest';
import { applyInventoryItemChanges, expandInventoryContainers, flattenSelectedEquipment, isCustomInventoryEntry, isFoundryInventoryEntry, mergeInventories, replaceInventorySource, type CharacterInventory } from '../src/inventory';
import type { EquipmentPackageNode } from '../src/equipment';

const item = (nodeId: string, id: string, quantity = 1): EquipmentPackageNode => ({ nodeId, type: 'linked', item: { sourcePath: `packs/_source/equipment24/${id}.yml`, pack: 'dnd5e.equipment24', type: 'weapon', id, name: id }, quantity, diagnostics: [] });

describe('inventory', () => {
  it('applies staged item changes while preserving currency and retained entries', () => {
    const existing = { entryId: 'starting-sword', source: { sourcePath: 'sword.yml', pack: 'equipment24', type: 'weapon', id: 'sword', name: 'Sword' }, quantity: 2, equipped: true, provenance: [{ sourcePath: 'class.yml', packageNodeId: 'starting', quantity: 2 }] };
    const custom = { entryId: 'journal', custom: { name: 'Journal' }, quantity: 1, equipped: false, provenance: [] };
    const inventory: CharacterInventory = { items: [existing, custom], currency: { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 }, currencyProvenance: [{ sourcePath: 'background.yml', packageNodeId: 'coins', denomination: 'gp', amount: 12 }] };
    const result = applyInventoryItemChanges(inventory, { removedEntryIds: ['starting-sword'], added: [{ source: { sourcePath: 'shield.yml', pack: 'equipment24', type: 'equipment', id: 'shield', name: 'Shield', ruleset: '2024', itemType: 'equipment', magic: false, equippable: true, properties: [] }, quantity: 1 }], quantityChanges: [] });
    expect(result.items).toEqual([custom, expect.objectContaining({ entryId: 'source:equipment24:shield', quantity: 1, equipped: false, provenance: [], source: expect.objectContaining({ id: 'shield' }) })]);
    expect(result.currency.gp).toBe(12);
    expect(result.currencyProvenance).toEqual(inventory.currencyProvenance);
    expect(inventory.items).toHaveLength(2);
  });

  it('adds a separate carried item when the same source already exists inside a container', () => {
    const source = { sourcePath: 'torch.yml', pack: 'equipment24', type: 'equipment', id: 'torch', name: 'Torch', ruleset: '2024' as const, itemType: 'equipment', magic: false, equippable: false, properties: [] };
    const inventory: CharacterInventory = { items: [{ entryId: 'source:equipment24:torch:container:pack', source, quantity: 2, equipped: false, containerEntryId: 'pack', provenance: [] }], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    const result = applyInventoryItemChanges(inventory, { removedEntryIds: [], added: [{ source, quantity: 1 }], quantityChanges: [] });
    expect(result.items.map((entry) => [entry.entryId, entry.quantity])).toEqual([['source:equipment24:torch:container:pack', 2], ['source:equipment24:torch', 1]]);
  });

  it('adjusts item quantities while preserving the rest of each entry', () => {
    const entry = { entryId: 'arrows', custom: { name: 'Arrows' }, quantity: 40, equipped: false, provenance: [{ sourcePath: 'class.yml', packageNodeId: 'starting', quantity: 40 }] };
    const inventory: CharacterInventory = { items: [entry], currency: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 } };
    const result = applyInventoryItemChanges(inventory, { removedEntryIds: [], added: [], quantityChanges: [{ entryId: 'arrows', delta: -1 }] });
    expect(result.items).toEqual([{ ...entry, quantity: 39 }]);
    expect(result.currency.gp).toBe(3);
    expect(inventory.items[0]?.quantity).toBe(40);
  });

  it('rejects a quantity change that would leave fewer than one item', () => {
    const inventory: CharacterInventory = { items: [{ entryId: 'arrow', custom: { name: 'Arrow' }, quantity: 1, equipped: false, provenance: [] }], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    expect(() => applyInventoryItemChanges(inventory, { removedEntryIds: [], added: [], quantityChanges: [{ entryId: 'arrow', delta: -1 }] })).toThrow('Invalid inventory quantity');
  });

  it('adds the staged quantity of a new source item', () => {
    const source = { sourcePath: 'torch.yml', pack: 'equipment24', type: 'equipment', id: 'torch', name: 'Torch', ruleset: '2024' as const, itemType: 'equipment', magic: false, equippable: false, properties: [] };
    const inventory: CharacterInventory = { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    const result = applyInventoryItemChanges(inventory, { removedEntryIds: [], added: [{ source, quantity: 3 }], quantityChanges: [] });
    expect(result.items).toEqual([expect.objectContaining({ source: expect.objectContaining({ id: 'torch' }), quantity: 3 })]);
  });

  it('preserves custom entries by entry ID when inventories are merged', () => {
    const custom = { entryId: 'custom:travel-journal', quantity: 1, equipped: false, provenance: [], custom: { name: 'Travel journal' } };
    const left: CharacterInventory = { items: [custom], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };
    const right: CharacterInventory = { items: [{ ...custom, quantity: 2 }], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } };

    const merged = mergeInventories(left, right);

    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ entryId: custom.entryId, quantity: 3, custom: { name: 'Travel journal' } });
    expect(isCustomInventoryEntry(merged.items[0])).toBe(true);
  });

  it('flattens only selected package branches and stacks duplicate source items', () => {
    const roots: EquipmentPackageNode[] = [{ nodeId: 'choice', type: 'OR', diagnostics: [], children: [{ nodeId: 'a', type: 'AND', diagnostics: [], children: [item('mace', 'mace', 1)] }, { nodeId: 'b', type: 'AND', diagnostics: [], children: [item('other', 'other', 4)] }] }];
    const inventory = flattenSelectedEquipment(roots, { selected: { choice: 'a' }, semantic: {} }, { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', packageNodeId: 'choice' });
    expect(inventory.items).toHaveLength(1);
    expect(inventory.items[0]).toMatchObject({ source: { id: 'mace' }, quantity: 1 });
  });

  it('includes a sole nested source option without a redundant saved choice', () => {
    const roots: EquipmentPackageNode[] = [{ nodeId: 'package', type: 'OR', diagnostics: [], children: [
      { nodeId: 'equipment', type: 'AND', diagnostics: [], children: [
        item('dagger', 'dagger', 2),
        { nodeId: 'focus', type: 'OR', diagnostics: [], children: [item('staff', 'staff')] },
      ] },
      { nodeId: 'wealth', type: 'currency', currency: { denomination: 'gp', amount: 55 }, diagnostics: [] },
    ] }];

    const inventory = flattenSelectedEquipment(roots, { selected: { package: 'equipment' }, semantic: {} }, { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', packageNodeId: 'wizard' });

    expect(inventory.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ id: 'dagger' }), quantity: 2 }),
      expect.objectContaining({ source: expect.objectContaining({ id: 'staff' }), quantity: 1 }),
    ]));
  });

  it('replaces one source contribution without removing another source contribution', () => {
    const classInventory = flattenSelectedEquipment([
      item('class-robe', 'robe'),
      { nodeId: 'class-gp', type: 'currency', key: 'gp', currency: { denomination: 'gp', amount: 5 }, diagnostics: [] },
    ], { selected: {}, semantic: {} }, { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', packageNodeId: 'wizard' });
    const backgroundInventory = flattenSelectedEquipment([
      item('background-robe', 'robe'),
      { nodeId: 'background-gp', type: 'currency', key: 'gp', currency: { denomination: 'gp', amount: 10 }, diagnostics: [] },
    ], { selected: {}, semantic: {} }, { sourcePath: 'packs/_source/origins24/backgrounds/acolyte.yml', packageNodeId: 'acolyte' });

    const combined = replaceInventorySource(classInventory, 'packs/_source/origins24/backgrounds/acolyte.yml', backgroundInventory);
    const rerendered = replaceInventorySource(combined, 'packs/_source/origins24/backgrounds/acolyte.yml', backgroundInventory);
    const withoutBackground = replaceInventorySource(rerendered, 'packs/_source/origins24/backgrounds/acolyte.yml', { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } });

    expect(combined.items[0]?.quantity).toBe(2);
    expect(combined.currency.gp).toBe(15);
    expect(rerendered.items[0]?.quantity).toBe(2);
    expect(rerendered.currency.gp).toBe(15);
    expect(withoutBackground.items[0]?.quantity).toBe(1);
    expect(withoutBackground.currency.gp).toBe(5);
  });

  it('expands structured container contents while retaining the parent item', async () => {
    const pack = { sourcePath: 'packs/_source/equipment24/adventuring-gear/dungeoneers-pack/_container.yml', pack: 'dnd5e.equipment24', type: 'container', id: 'pack', name: "Dungeoneer's Pack" };
    const inventory = flattenSelectedEquipment([{ nodeId: 'pack', type: 'linked', key: 'pack', quantity: 1, item: pack, diagnostics: [] }], { selected: {}, semantic: {} }, { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', packageNodeId: 'fighter' });
    const child = { sourcePath: 'packs/_source/equipment24/adventuring-gear/rations.yml', pack: 'dnd5e.equipment24', type: 'equipment', id: 'rations', name: 'Rations' };
    const expanded = await expandInventoryContainers(inventory, {
      getByUuid: async () => child,
      getRaw: (sourcePath) => sourcePath === pack.sourcePath ? { type: 'container', system: { description: { value: '10 days of @UUID[Compendium.dnd5e.equipment24.Item.rations]{Rations}.' } } } : undefined,
    });
    expect(expanded.items).toHaveLength(2);
    expect(expanded.items[0] && isFoundryInventoryEntry(expanded.items[0]) ? expanded.items[0].source.name : undefined).toBe("Dungeoneer's Pack");
    expect(expanded.items[1]).toMatchObject({ source: { id: 'rations' }, quantity: 10, containerEntryId: expanded.items[0]?.entryId });
  });
});
