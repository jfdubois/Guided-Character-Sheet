import { describe, expect, it, vi } from 'vitest';
import { HitPointAdjustmentModal } from '../src/hit-point-adjustment-modal';

interface TestControl {
  value: string;
  text: string;
  focused: boolean;
  handlers: Map<string, () => void>;
  dispatch(event: string): void;
}

function modalRoot(): { root: HTMLElement; controls: TestControl[]; messages: string[] } {
  const controls: TestControl[] = [];
  const messages: string[] = [];
  const createNode = (tag = 'div', options?: { text?: string }): Record<string, unknown> => {
    if (options?.text) messages.push(options.text);
    const handlers = new Map<string, () => void>();
    const node: Record<string, unknown> = {
      value: '', textContent: options?.text ?? '',
      createDiv: (child?: { text?: string }) => createNode('div', child),
      createEl: (childTag: string, child?: { text?: string }) => createNode(childTag, child),
      addEventListener: (event: string, handler: () => void) => handlers.set(event, handler),
      empty: () => { node.textContent = ''; },
      setText: (value: string) => { node.textContent = value; messages.push(value); },
      focus: () => { if (control) control.focused = true; },
    };
    let control: TestControl | undefined;
    if (tag === 'input' || tag === 'button') {
      control = node as unknown as TestControl;
      control.text = options?.text ?? '';
      control.focused = false;
      control.handlers = handlers;
      control.dispatch = (event: string) => handlers.get(event)?.();
      controls.push(control);
    }
    return node;
  };
  return { root: createNode() as unknown as HTMLElement, controls, messages };
}

describe('hit-point adjustment modal', () => {
  it('offers exactly the three operations and rejects invalid input', () => {
    const rendered = modalRoot();
    const onAdjust = vi.fn();
    const modal = new HitPointAdjustmentModal({} as never, { current: 8, maximum: 10, temporary: 2 }, onAdjust);
    Object.assign(modal, { contentEl: rendered.root, titleEl: { setText: vi.fn() }, close: vi.fn() });
    modal.onOpen();
    const input = rendered.controls.find((control) => control.text === '')!;
    const buttons = rendered.controls.filter((control) => control.text !== '');
    expect(buttons.map((button) => button.text)).toEqual(['Heal', 'Damage', 'Temp']);
    input.value = '-1'; buttons[1]!.dispatch('click');
    input.value = '1.5'; buttons[1]!.dispatch('click');
    input.value = ''; buttons[1]!.dispatch('click');
    expect(onAdjust).not.toHaveBeenCalled();
    expect(rendered.messages).toContain('Enter a nonnegative whole number.');
    input.value = '4'; buttons[1]!.dispatch('click');
    expect(onAdjust).toHaveBeenCalledWith('damage', 4);
    expect(modal.close).toHaveBeenCalledOnce();
  });
});
