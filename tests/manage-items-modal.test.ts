import { describe, expect, it, vi } from 'vitest';
import { ManageItemsModal } from '../src/manage-items-modal';
import type { FoundryItemSummary } from '../src/foundry-source-catalog';
import type { InventoryEntry } from '../src/inventory';

interface NodeMock {
  value: string;
  textContent: string;
  ariaLabel: string;
  disabled: boolean;
  children: NodeMock[];
  handlers: Map<string, () => void>;
  createEl(tag: string, options?: { text?: string; value?: string; attr?: Record<string, string> }): NodeMock;
  createDiv(options?: { text?: string }): NodeMock;
  createSpan(options?: { text?: string }): NodeMock;
  addEventListener(event: string, handler: () => void): void;
  empty(): void;
  dispatch(event: string): void;
}

function node(options: { text?: string; value?: string; attr?: Record<string, string> } = {}): NodeMock {
  const result: NodeMock = {
    value: options.value ?? '', textContent: options.text ?? '', ariaLabel: options.attr?.['aria-label'] ?? '', disabled: false, children: [], handlers: new Map(),
    createEl(_tag, childOptions = {}) { const child = node(childOptions); result.children.push(child); return child; },
    createDiv(childOptions = {}) { return result.createEl('div', childOptions); },
    createSpan(childOptions = {}) { return result.createEl('span', childOptions); },
    addEventListener(event, handler) { result.handlers.set(event, handler); },
    empty() { result.children.length = 0; result.textContent = ''; },
    dispatch(event) { if (!result.disabled) result.handlers.get(event)?.(); },
  };
  return result;
}

const item = (id: string): FoundryItemSummary => ({ sourcePath: `${id}.yml`, pack: 'equipment24', type: 'equipment', id, name: id, ruleset: '2024', itemType: 'equipment', magic: false, equippable: false, properties: [] });
const existing: InventoryEntry = { entryId: 'starting-rope', source: { sourcePath: 'rope.yml', pack: 'equipment24', type: 'equipment', id: 'rope', name: 'Rope' }, quantity: 2, equipped: false, provenance: [] };
const allNodes = (root: NodeMock): NodeMock[] => [root, ...root.children.flatMap(allNodes)];
const button = (root: NodeMock, label: string): NodeMock => allNodes(root).find((entry) => entry.textContent === label && entry.handlers.has('click'))!;
const action = (root: NodeMock, label: string): NodeMock => allNodes(root).find((entry) => entry.ariaLabel === label && entry.handlers.has('click'))!;

function setup(managed: InventoryEntry[] = []) {
  const root = node();
  const onApply = vi.fn();
  const index = { searchItems: vi.fn().mockResolvedValue([item('torch')]) };
  const modal = new ManageItemsModal({} as never, index as never, '2024', managed, onApply);
  Object.assign(modal, { contentEl: root, titleEl: { setText: vi.fn() }, close: vi.fn() });
  modal.onOpen();
  return { root, onApply, index, modal };
}

describe('manage items modal', () => {
  it('displays carried and newly staged items together in character-sheet name order', async () => {
    const zebra: InventoryEntry = { entryId: 'zebra', custom: { name: 'Zebra token' }, quantity: 1, equipped: false, provenance: [] };
    const apple: InventoryEntry = { entryId: 'apple', custom: { name: 'Apple' }, quantity: 1, equipped: false, provenance: [] };
    const { root, index } = setup([zebra, existing, apple]);
    index.searchItems.mockResolvedValue([item('Mace')]);
    const search = root.children[0]!.children[0]!;
    search.value = 'mace';
    search.dispatch('input');
    await Promise.resolve();
    button(root, 'Add').dispatch('click');
    const managed = root.children[1]!;
    expect(managed.children.slice(1).map((row) => row.children[0]?.textContent)).toEqual(['Apple ×1', 'Mace ×1', 'Rope ×2', 'Zebra token ×1']);
  });

  it('searches the character ruleset and stages additions and removals until Apply', async () => {
    const { root, onApply, index } = setup([existing]);
    await Promise.resolve();
    const search = root.children[0]!.children[0]!;
    search.value = 'tor';
    search.dispatch('input');
    await Promise.resolve();
    expect(index.searchItems).toHaveBeenLastCalledWith('tor', { ruleset: '2024' });
    action(root, 'Remove Rope').dispatch('click');
    await Promise.resolve();
    button(root, 'Add').dispatch('click');
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
    button(root, 'Apply').dispatch('click');
    expect(onApply).toHaveBeenCalledWith({ removedEntryIds: ['starting-rope'], added: [{ source: item('torch'), quantity: 1 }], quantityChanges: [] });
  });

  it('restores a removed entry and discards changes on Cancel', async () => {
    const { root, onApply, modal } = setup([existing]);
    await Promise.resolve();
    action(root, 'Increase quantity of Rope').dispatch('click');
    button(root, 'Add').dispatch('click');
    action(root, 'Remove Rope').dispatch('click');
    action(root, 'Restore Rope').dispatch('click');
    button(root, 'Cancel').dispatch('click');
    expect(onApply).not.toHaveBeenCalled();
    expect(modal.close).toHaveBeenCalledOnce();
  });

  it('lets a broad search reach results beyond the first 50', async () => {
    const { root, index } = setup();
    index.searchItems.mockResolvedValue(Array.from({ length: 51 }, (_value, position) => item(`Item ${position + 1}`)));
    const search = root.children[0]!.children[0]!;
    search.value = 'item';
    search.dispatch('input');
    await Promise.resolve();
    expect(allNodes(root).map((entry) => entry.textContent)).not.toContain('Item 51');
    button(root, 'Show more').dispatch('click');
    await Promise.resolve();
    expect(allNodes(root).map((entry) => entry.textContent)).toContain('Item 51');
  });

  it('stages quantity changes for a carried stack without removing it at one', async () => {
    const { root, onApply } = setup([existing]);
    action(root, 'Increase quantity of Rope').dispatch('click');
    action(root, 'Decrease quantity of Rope').dispatch('click');
    action(root, 'Decrease quantity of Rope').dispatch('click');
    expect(allNodes(root).map((entry) => entry.textContent)).toContain('Rope ×1');
    expect(action(root, 'Decrease quantity of Rope').disabled).toBe(true);
    button(root, 'Apply').dispatch('click');
    expect(onApply).toHaveBeenCalledWith({ removedEntryIds: [], added: [], quantityChanges: [{ entryId: 'starting-rope', delta: -1 }] });
  });

  it('stages a new item quantity and can trash the whole entry', async () => {
    const { root, onApply } = setup();
    await Promise.resolve();
    button(root, 'Add').dispatch('click');
    action(root, 'Increase quantity of torch').dispatch('click');
    expect(allNodes(root).map((entry) => entry.textContent)).toContain('torch ×2');
    button(root, 'Apply').dispatch('click');
    expect(onApply).toHaveBeenCalledWith({ removedEntryIds: [], added: [{ source: item('torch'), quantity: 2 }], quantityChanges: [] });

    const removed = setup([existing]);
    action(removed.root, 'Remove Rope').dispatch('click');
    button(removed.root, 'Apply').dispatch('click');
    expect(removed.onApply).toHaveBeenCalledWith({ removedEntryIds: ['starting-rope'], added: [], quantityChanges: [] });
  });

  it('sends one combined change set only when Apply is pressed', async () => {
    const { root, onApply } = setup([existing]);
    await Promise.resolve();
    action(root, 'Increase quantity of Rope').dispatch('click');
    button(root, 'Add').dispatch('click');
    action(root, 'Increase quantity of torch').dispatch('click');
    action(root, 'Decrease quantity of torch').dispatch('click');
    expect(onApply).not.toHaveBeenCalled();
    button(root, 'Apply').dispatch('click');
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith({ removedEntryIds: [], added: [{ source: item('torch'), quantity: 1 }], quantityChanges: [{ entryId: 'starting-rope', delta: 1 }] });
  });
});
