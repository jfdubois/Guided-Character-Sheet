import { describe, expect, it, vi } from 'vitest';
import { CurrencyModal } from '../src/currency-modal';

interface Control {
  text: string;
  ariaLabel: string;
  value: string;
  disabled: boolean;
  handlers: Map<string, () => void>;
  dispatch(event: string): void;
}

function modalRoot(): { root: HTMLElement; controls: Control[]; messages: string[] } {
  const controls: Control[] = [];
  const messages: string[] = [];
  const createNode = (tag = 'div', options?: { text?: string; value?: string; attr?: Record<string, string> }): Record<string, unknown> => {
    if (options?.text !== undefined) messages.push(options.text);
    const handlers = new Map<string, () => void>();
    const node: Record<string, unknown> = {
      value: options?.value ?? '', disabled: false,
      createDiv: (child?: { text?: string }) => createNode('div', child),
      createSpan: (child?: { text?: string }) => createNode('span', child),
      createEl: (childTag: string, child?: { text?: string; value?: string; attr?: Record<string, string> }) => createNode(childTag, child),
      addEventListener: (event: string, handler: () => void) => handlers.set(event, handler),
      empty: vi.fn(), setText: (value: string) => messages.push(value), focus: vi.fn(),
    };
    if (tag === 'button' || tag === 'select' || tag === 'input') {
      const control = node as unknown as Control;
      control.text = options?.text ?? '';
      control.ariaLabel = options?.attr?.['aria-label'] ?? '';
      control.handlers = handlers;
      control.dispatch = (event) => handlers.get(event)?.();
      controls.push(control);
    }
    return node;
  };
  return { root: createNode() as unknown as HTMLElement, controls, messages };
}

function openCurrencyModal() {
  const rendered = modalRoot();
  const onConfirm = vi.fn();
  const modal = new CurrencyModal({} as never, { pp: 1, gp: 2, ep: 0, sp: 0, cp: 0 }, onConfirm);
  Object.assign(modal, { contentEl: rendered.root, titleEl: { setText: vi.fn() }, close: vi.fn() });
  modal.onOpen();
  return { ...rendered, modal, onConfirm };
}

describe('currency modal', () => {
  it('shows all five denominations and previews the payment before confirmation', () => {
    const { controls, messages, onConfirm, modal } = openCurrencyModal();
    expect(messages.filter((message) => /^\d+ (PP|GP|EP|SP|CP)$/.test(message))).toEqual(['1 PP', '2 GP', '0 EP', '0 SP', '0 CP']);
    const amount = controls.find((control) => control.ariaLabel === 'Currency amount')!;
    const denomination = controls.find((control) => control.ariaLabel === 'Currency denomination')!;
    const confirm = controls.find((control) => control.text === 'Apply currency change')!;
    expect(confirm.disabled).toBe(true);
    denomination.value = 'sp'; denomination.dispatch('change');
    amount.value = '5'; amount.dispatch('input');
    expect(messages).toContain('After spending: 1 PP, 1 GP, 0 EP, 5 SP, 0 CP');
    expect(confirm.disabled).toBe(false);
    confirm.dispatch('click');
    expect(onConfirm).toHaveBeenCalledWith('spend', 'sp', 5);
    expect(modal.close).toHaveBeenCalledOnce();
  });

  it('does not submit invalid or unaffordable amounts and supports adding electrum', () => {
    const { controls, messages, onConfirm } = openCurrencyModal();
    const operation = controls.find((control) => control.ariaLabel === 'Currency action')!;
    const denomination = controls.find((control) => control.ariaLabel === 'Currency denomination')!;
    const amount = controls.find((control) => control.ariaLabel === 'Currency amount')!;
    const confirm = controls.find((control) => control.text === 'Apply currency change')!;
    denomination.value = 'pp'; amount.value = '3'; amount.dispatch('input');
    expect(confirm.disabled).toBe(true);
    expect(messages).toContain('Insufficient currency.');
    operation.value = 'add'; operation.dispatch('change');
    denomination.value = 'ep'; denomination.dispatch('change');
    amount.value = '2.5'; amount.dispatch('input');
    expect(confirm.disabled).toBe(true);
    amount.value = '2'; amount.dispatch('input');
    expect(confirm.disabled).toBe(false);
    confirm.dispatch('click');
    expect(onConfirm).toHaveBeenCalledWith('add', 'ep', 2);
  });
});
