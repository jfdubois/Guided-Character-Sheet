import { describe, expect, it, vi } from 'vitest';
import { ManageSpellsModal } from '../src/manage-spells-modal';
import type { FoundrySpellSummary, FoundrySourceReference } from '../src/foundry-source-catalog';

interface NodeMock {
  value: string;
  textContent: string;
  children: NodeMock[];
  handlers: Map<string, () => void>;
  createEl(tag: string, options?: { text?: string; value?: string }): NodeMock;
  createDiv(options?: { text?: string }): NodeMock;
  createSpan(options?: { text?: string }): NodeMock;
  addEventListener(event: string, handler: () => void): void;
  empty(): void;
  dispatch(event: string): void;
}

function node(tag = 'div', options: { text?: string; value?: string } = {}): NodeMock {
  const result: NodeMock = {
    value: options.value ?? '', textContent: options.text ?? '', children: [], handlers: new Map<string, () => void>(),
    createEl(childTag: string, childOptions: { text?: string; value?: string } = {}): NodeMock { const child = node(childTag, childOptions); result.children.push(child); return child; },
    createDiv(childOptions: { text?: string } = {}): NodeMock { return result.createEl('div', childOptions); },
    createSpan(childOptions: { text?: string } = {}): NodeMock { return result.createEl('span', childOptions); },
    addEventListener(event: string, handler: () => void) { result.handlers.set(event, handler); },
    empty() { result.children.length = 0; result.textContent = ''; },
    dispatch(event: string) { result.handlers.get(event)?.(); },
  } satisfies NodeMock;
  return result;
}

const reference = (id: string, name: string): FoundrySourceReference => ({ sourcePath: `spells/${id}.yml`, pack: 'test.spells', type: 'spell', id, name });
const spell = (id: string, name: string, level: number): FoundrySpellSummary => ({ ...reference(id, name), ruleset: '2024', level, spellLists: ['wizard'], ritual: false, description: '<p>A description.</p>' });

function setup(index: { searchSpells: ReturnType<typeof vi.fn> }, managed: FoundrySourceReference[] = []) {
  const root = node();
  const onApply = vi.fn();
  const modal = new ManageSpellsModal({} as never, index as never, '2024', ['wizard'], managed, onApply);
  Object.assign(modal, { contentEl: root, titleEl: { setText: vi.fn() }, close: vi.fn() });
  modal.onOpen();
  return { root, modal, onApply };
}

function allNodes(root: NodeMock): NodeMock[] {
  return [root, ...root.children.flatMap(allNodes)];
}

describe('manage spells modal', () => {
  it('displays managed spells and search results alphabetically', async () => {
    const index = { searchSpells: vi.fn().mockResolvedValue([spell('zeta', 'Zeta spell', 1), spell('alpha', 'Alpha spell', 1)]) };
    const { root } = setup(index, [reference('zeta', 'Zeta spell'), reference('alpha', 'Alpha spell')]);
    await Promise.resolve();
    const names = (rows: NodeMock[]) => rows.map((row) => row.children[0]!.children[0]!.textContent);
    expect(names(root.children[1]!.children.slice(1))).toEqual(['Alpha spell', 'Zeta spell']);
    expect(names(root.children[2]!.children)).toEqual(['Alpha spell', 'Zeta spell']);
  });

  it('passes query, level, and authoritative spell lists to searches', async () => {
    const index = { searchSpells: vi.fn().mockResolvedValue([spell('bolt', 'Arcane Bolt', 1)]) };
    const { root } = setup(index);
    await Promise.resolve();
    const controls = root.children[0]!;
    const search = controls.children[0]!; const level = controls.children[1]!;
    search.value = 'arcane'; search.dispatch('input');
    level.value = '3'; level.dispatch('change');
    await Promise.resolve();
    expect(index.searchSpells).toHaveBeenLastCalledWith({ ruleset: '2024', query: 'arcane', level: 3, spellLists: ['wizard'] });
  });

  it('stages add/remove and preserves stale refs until Apply', async () => {
    const existing = reference('old', 'Old spell');
    const added = spell('bolt', 'Arcane Bolt', 1);
    const index = { searchSpells: vi.fn().mockResolvedValue([added]) };
    const { root, onApply, modal } = setup(index, [existing]);
    await Promise.resolve(); await Promise.resolve();
    const buttons = () => allNodes(root).filter((child) => child.handlers.has('click'));
    const resultButton = buttons().find((button) => button.textContent === 'Add')!;
    resultButton.dispatch('click');
    await Promise.resolve();
    expect(onApply).not.toHaveBeenCalled();
    const applyWithAdded = buttons().find((button) => button.textContent === 'Apply')!;
    applyWithAdded.dispatch('click');
    expect(onApply).toHaveBeenCalledWith([existing, reference('bolt', 'Arcane Bolt')]);
    expect(onApply.mock.calls[0]![0][1]).not.toHaveProperty('description');
    expect(onApply.mock.calls[0]![0][1]).not.toHaveProperty('level');

    const second = setup(index, [existing]);
    await Promise.resolve(); await Promise.resolve();
    const secondButtons = () => allNodes(second.root).filter((child) => child.handlers.has('click'));
    secondButtons().find((button) => button.textContent === 'Add')!.dispatch('click');
    await Promise.resolve();
    const removeAdded = secondButtons().filter((button) => button.textContent === 'Remove').at(-1)!;
    removeAdded.dispatch('click');
    const apply = secondButtons().find((button) => button.textContent === 'Apply')!;
    apply.dispatch('click');
    expect(second.onApply).toHaveBeenCalledWith([existing]);
    expect(second.modal.close).toHaveBeenCalledOnce();
    expect(modal.close).toHaveBeenCalledOnce();
  });

  it('does not let an older asynchronous search overwrite newer results', async () => {
    let resolveFirst!: (value: FoundrySpellSummary[]) => void;
    const index = { searchSpells: vi.fn().mockImplementation(({ query }: { query?: string }) => query === '' ? new Promise<FoundrySpellSummary[]>((resolve) => { resolveFirst = resolve; }) : Promise.resolve([spell('new', 'New spell', 2)])) };
    const { root } = setup(index);
    const search = root.children[0]!.children[0]!;
    search.value = 'new'; search.dispatch('input');
    await Promise.resolve();
    resolveFirst([spell('old', 'Old result', 1)]);
    await Promise.resolve();
    expect(allNodes(root).map((current) => current.textContent)).toContain('New spell');
    expect(allNodes(root).map((current) => current.textContent)).not.toContain('Old result');
  });
});
