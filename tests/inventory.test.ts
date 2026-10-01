import { describe, expect, it } from 'vitest';
import { expandInventoryContainers, flattenSelectedEquipment, isCustomInventoryEntry, isFoundryInventoryEntry, mergeInventories, replaceInventorySource, type CharacterInventory } from '../src/inventory';
import type { EquipmentPackageNode } from '../src/equipment';

const item = (nodeId: string, id: string, quantity = 1): EquipmentPackageNode => ({ nodeId, type: 'linked', item: { sourcePath: `packs/_source/equipment24/${id}.yml`, pack: 'dnd5e.equipment24', type: 'weapon', id, name: id }, quantity, diagnostics: [] });

describe('inventory', () => {
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
