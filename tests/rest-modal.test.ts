import { describe, expect, it, vi } from 'vitest';
import { RestModal } from '../src/rest-modal';
import type { MutableCharacterState } from '../src/mutable-character-state';

interface Control {
  tag: string;
  text: string;
  ariaLabel: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  handlers: Map<string, () => void>;
  dispatch(event: string): void;
}

function modalRoot(): { root: HTMLElement; controls: Control[]; messages: string[] } {
  const controls: Control[] = []; const messages: string[] = [];
  const createNode = (tag = 'div', options?: { text?: string; value?: string; attr?: Record<string, string> }): Record<string, unknown> => {
    if (options?.text !== undefined) messages.push(options.text);
    const handlers = new Map<string, () => void>();
    const node: Record<string, unknown> = {
      value: options?.value ?? '', checked: false, disabled: false, type: options?.attr?.type ?? '', min: '', step: '',
      createDiv: (child?: { text?: string }) => createNode('div', child),
      createSpan: (child?: { text?: string }) => createNode('span', child),
      createEl: (childTag: string, child?: { text?: string; value?: string; attr?: Record<string, string> }) => createNode(childTag, child),
      addEventListener: (event: string, handler: () => void) => handlers.set(event, handler), empty: vi.fn(),
    };
    if (tag === 'button' || tag === 'select' || tag === 'input') {
      const control = node as unknown as Control;
      control.tag = tag; control.text = options?.text ?? ''; control.ariaLabel = options?.attr?.['aria-label'] ?? ''; control.handlers = handlers;
      control.dispatch = (event) => handlers.get(event)?.(); controls.push(control);
    }
    return node;
  };
  return { root: createNode() as unknown as HTMLElement, controls, messages };
}

function mutable(resourceCurrent = 0): MutableCharacterState {
  return {
    preparedSpells: [], inventory: { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, equipmentStatus: [],
    hitPoints: { current: 5, maximum: 10, temporary: 0 },
    hitDice: [{ classSourcePath: 'classes/fighter.yml', denomination: 'd10', current: 1, maximum: 1 }],
    resources: [{ key: 'second-wind', current: resourceCurrent, maximum: 1, reset: 'short-rest' }],
  };
}

function openModal(state: MutableCharacterState, onConfirm = vi.fn(), compatibilityUpdateCount?: number): { modal: RestModal; controls: Control[]; messages: string[]; onConfirm: typeof onConfirm } {
  const rendered = modalRoot();
  const modal = new RestModal({} as never, state, { allowShortRest: true, constitutionModifier: 2, ...(compatibilityUpdateCount === undefined ? {} : { compatibilityUpdateCount }) }, onConfirm);
  Object.assign(modal, { contentEl: rendered.root, titleEl: { setText: vi.fn() }, close: vi.fn() });
  modal.onOpen();
  return { modal, controls: rendered.controls, messages: rendered.messages, onConfirm };
}

describe('rest modal', () => {
  it('requires an explicit rest selection', () => {
    const { controls, onConfirm } = openModal(mutable());
    const confirm = controls.find((control) => control.text === 'Confirm rest');
    expect(confirm?.disabled).toBe(true);
    confirm?.dispatch('click');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('previews and confirms a resource-only Short Rest', () => {
    const { modal, controls, messages, onConfirm } = openModal(mutable());
    const type = controls.find((control) => control.ariaLabel === 'Rest type')!;
    type.value = 'short'; type.dispatch('change');
    expect(messages).toContain('Restore 1 feature resource.');
    const confirm = controls.find((control) => control.text === 'Confirm rest')!;
    expect(confirm.disabled).toBe(false);
    confirm.dispatch('click');
    expect(onConfirm).toHaveBeenCalledWith({ type: 'short', input: { healing: 0 } });
    expect(modal.close).toHaveBeenCalledOnce();
  });

  it('requires valid healing after selecting a Hit Point Die', () => {
    const { controls, messages, onConfirm } = openModal(mutable(1));
    const type = controls.find((control) => control.ariaLabel === 'Rest type')!;
    type.value = 'short'; type.dispatch('change');
    expect(messages).toContain('Constitution modifier: +2. Supported result: 1–12. Enter the final healing result after rolling at the table.');
    const spend = controls.find((control) => control.ariaLabel === 'Spend one Hit Point Die')!;
    const healing = controls.find((control) => control.ariaLabel === 'Healing result')!;
    const confirm = controls.find((control) => control.text === 'Confirm rest')!;
    expect(confirm.disabled).toBe(true);
    spend.checked = true; spend.dispatch('change');
    expect(confirm.disabled).toBe(true);
    healing.value = '5'; healing.dispatch('input');
    expect(confirm.disabled).toBe(false);
    confirm.dispatch('click');
    expect(onConfirm).toHaveBeenCalledWith({ type: 'short', input: { hitDieClassSourcePath: 'classes/fighter.yml', healing: 5 } });
  });

  it('previews and confirms Long Rest through the same modal', () => {
    const { controls, messages, onConfirm } = openModal(mutable());
    const type = controls.find((control) => control.ariaLabel === 'Rest type')!;
    type.value = 'long'; type.dispatch('change');
    expect(messages).toContain('Restore 5 hit points.');
    controls.find((control) => control.text === 'Confirm rest')?.dispatch('click');
    expect(onConfirm).toHaveBeenCalledWith({ type: 'long' });
  });

  it('allows an explicit rest confirmation when only legacy records need reconciliation', () => {
    const current = mutable(1); current.hitPoints = { current: 10, maximum: 10, temporary: 0 };
    const { controls, messages, onConfirm } = openModal(current, vi.fn(), 3);
    expect(messages).toContain('3 legacy rest records will be reconciled from the current character sources when this rest is confirmed.');
    const type = controls.find((control) => control.ariaLabel === 'Rest type')!;
    type.value = 'short'; type.dispatch('change');
    expect(messages).toContain('No tracked values need recovery; legacy rest records will be updated.');
    const confirm = controls.find((control) => control.text === 'Confirm rest')!;
    expect(confirm.disabled).toBe(false);
    confirm.dispatch('click');
    expect(onConfirm).toHaveBeenCalledWith({ type: 'short', input: { healing: 0 } });
  });
});
