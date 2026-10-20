import { describe, expect, it } from 'vitest';
import { getEquipmentChoiceLabel, getEquipmentOptionContents, normalizeStartingEquipment, projectStartingEquipment, resolveStartingEquipmentItems, type EquipmentSourceResolver } from '../src/equipment';
import { flattenSelectedEquipment } from '../src/inventory';

const resolver: EquipmentSourceResolver = async (uuid) => uuid === 'mace'
  ? { sourcePath: 'packs/_source/equipment24/mace.yml', pack: 'dnd5e.equipment24', type: 'weapon', id: 'mace', name: 'Mace' }
  : null;

describe('starting equipment', () => {
  it.each(['', '0', '1.5', '-1', 'not-a-number'])('rejects invalid detached wealth %j without a synthetic choice branch', async (wealth) => {
    const result = await projectStartingEquipment([{ _id: 'package-a', type: 'AND', group: '', sort: 100 }], wealth);

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toMatchObject({ nodeId: 'package-a', type: 'AND' });
    expect(result.roots.some((root) => root.nodeId === 'synthetic:starting-equipment-choice')).toBe(false);
    expect(result.diagnostics).toContain(`Invalid starting wealth: ${wealth}`);
  });

  it('projects detached wealth as a stable alternate branch without changing package nodes', async () => {
    const result = await projectStartingEquipment([
      { _id: 'package-a', type: 'AND', group: '', sort: 100 },
      { _id: 'item-a', type: 'currency', key: 'gp', count: 8, group: 'package-a', sort: 200 },
    ], '50');

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0]).toMatchObject({ nodeId: 'synthetic:starting-equipment-choice', type: 'OR' });
    expect(result.roots[0].children).toHaveLength(2);
    expect(result.roots[0].children?.[0]).toMatchObject({ nodeId: 'package-a', type: 'AND' });
    expect(result.roots[0].children?.[1]).toMatchObject({
      nodeId: 'synthetic:starting-equipment-wealth', type: 'AND',
      children: [{ nodeId: 'synthetic:starting-equipment-wealth-gp-50', type: 'currency', currency: { denomination: 'gp', amount: 50 } }],
    });
    expect(result).toEqual(await projectStartingEquipment([
      { _id: 'package-a', type: 'AND', group: '', sort: 100 },
      { _id: 'item-a', type: 'currency', key: 'gp', count: 8, group: 'package-a', sort: 200 },
    ], '50'));
  });

  it('selects only synthetic wealth and records its source provenance', async () => {
    const result = await projectStartingEquipment([{ _id: 'package-a', type: 'AND', group: '', sort: 100 }], '50');
    const wealth = result.roots[0].children?.[1];
    const inventory = flattenSelectedEquipment(result.roots, { selected: { [result.roots[0].nodeId]: wealth?.nodeId ?? '' }, semantic: {} }, { sourcePath: 'packs/_source/origins24/backgrounds/acolyte.yml', packageNodeId: result.roots[0].nodeId });
    expect(inventory.items).toEqual([]);
    expect(inventory.currency).toMatchObject({ gp: 50 });
    expect(inventory.currencyProvenance).toEqual([{ sourcePath: 'packs/_source/origins24/backgrounds/acolyte.yml', packageNodeId: 'synthetic:starting-equipment-choice', denomination: 'gp', amount: 50 }]);
  });

  it('rebuilds ordered AND/OR package trees and resolves linked items', async () => {
    const result = await normalizeStartingEquipment([
      { _id: 'choice', type: 'OR', group: '', sort: 100 },
      { _id: 'first', type: 'AND', group: 'choice', sort: 200 },
      { _id: 'mace', type: 'linked', key: 'mace', count: 2, group: 'first', sort: 300 },
      { _id: 'second', type: 'currency', key: 'gp', count: 10, group: 'choice', sort: 400 },
    ], resolver);

    expect(result.roots[0]).toMatchObject({ nodeId: 'choice', type: 'OR' });
    expect(result.roots[0].children?.[0]).toMatchObject({ nodeId: 'first', type: 'AND' });
    expect(result.roots[0].children?.[0].children?.[0]).toMatchObject({ nodeId: 'mace', type: 'linked', quantity: 2, item: { name: 'Mace' } });
    expect(result.roots[0].children?.[1]).toMatchObject({ nodeId: 'second', type: 'currency', currency: { denomination: 'gp', amount: 10 } });
  });

  it('keeps semantic grants and unresolved links visible as diagnostics', async () => {
    const result = await normalizeStartingEquipment([
      { _id: 'weapon', type: 'weapon', key: 'martialM', group: '', sort: 100 },
      { _id: 'missing', type: 'linked', key: 'missing', group: '', sort: 200 },
    ], resolver);
    expect(result.roots).toMatchObject([
      { type: 'weapon', semantic: { category: 'weapon', selector: 'martialM' } },
      { type: 'linked', diagnostics: ['Unresolved equipment source: missing'] },
    ]);
  });

  it('resolves deferred linked item labels before rendering', async () => {
    const summary = await normalizeStartingEquipment([{ _id: 'item', type: 'linked', key: 'mace', group: '', sort: 1 }]);
    const resolved = await resolveStartingEquipmentItems(summary, resolver);
    expect(resolved.roots[0].item).toEqual(expect.objectContaining({ name: 'Mace' }));
  });

  it('labels package selectors by the actual choice category', () => {
    expect(getEquipmentChoiceLabel({ nodeId: 'weapon', type: 'OR', diagnostics: [], children: [{ nodeId: 'a', type: 'linked', diagnostics: [], item: { sourcePath: 'packs/_source/items/a.yml', pack: 'dnd5e.items', type: 'weapon', id: 'a', name: 'Greataxe' } }, { nodeId: 'b', type: 'weapon', key: 'martialM', quantity: 1, diagnostics: [], semantic: { category: 'weapon', selector: 'martialM' } }] })).toBe('Choose a weapon');
  });

  it('summarizes every package option before selection', () => {
    expect(getEquipmentOptionContents({
      nodeId: 'package',
      type: 'AND',
      diagnostics: [],
      children: [
        { nodeId: 'axe', type: 'linked', diagnostics: [], item: { sourcePath: 'packs/_source/items/greataxe.yml', pack: 'dnd5e.items', type: 'weapon', id: 'axe', name: 'Greataxe' } },
        { nodeId: 'weapon', type: 'weapon', key: 'martialM', quantity: 1, diagnostics: [], semantic: { category: 'weapon', selector: 'martialM' } },
      ],
    })).toEqual(['Greataxe', 'Choose a weapon']);
  });

  it('shows both nested Fighter equipment packages instead of an OR token', () => {
    const choice = {
      nodeId: 'fighter-package', type: 'OR', diagnostics: [], children: [
        { nodeId: 'heavy', type: 'AND', diagnostics: [], children: [
          { nodeId: 'mail', type: 'linked', diagnostics: [], item: { sourcePath: 'chain-mail.yml', pack: 'test', type: 'equipment', id: 'mail', name: 'Chain Mail' } },
          { nodeId: 'sword', type: 'linked', diagnostics: [], item: { sourcePath: 'greatsword.yml', pack: 'test', type: 'weapon', id: 'sword', name: 'Greatsword' } },
        ] },
        { nodeId: 'light', type: 'AND', diagnostics: [], children: [
          { nodeId: 'leather', type: 'linked', diagnostics: [], item: { sourcePath: 'studded-leather.yml', pack: 'test', type: 'equipment', id: 'leather', name: 'Studded Leather Armor' } },
          { nodeId: 'bow', type: 'linked', diagnostics: [], item: { sourcePath: 'longbow.yml', pack: 'test', type: 'weapon', id: 'bow', name: 'Longbow' } },
        ] },
      ],
    };
    expect(getEquipmentOptionContents(choice)).toEqual(['Chain Mail, Greatsword or Studded Leather Armor, Longbow']);
  });
});
