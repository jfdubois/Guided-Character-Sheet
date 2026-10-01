import { describe, expect, it } from 'vitest';
import { renderRepeatedDropdownChoice } from '../src/selection-controls';

describe('repeated dropdown choices', () => {
  it('renders the required count and disables initial sibling selections', () => {
    const selects: TestSelect[] = [];
    renderRepeatedDropdownChoice(createRoot(selects) as unknown as HTMLElement, {
      count: 2,
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
      selected: ['a'],
      ariaLabel: (index) => `Choice ${index + 1}`,
    }, () => undefined);

    expect(selects).toHaveLength(2);
    expect(selects[1].options.find((option) => option.value === 'a')?.disabled).toBe(true);
    expect(selects.map((select) => select.attributes['aria-label'])).toEqual(['Choice 1', 'Choice 2']);
  });

  it('keeps an unavailable saved value visible and disabled', () => {
    const selects: TestSelect[] = [];
    renderRepeatedDropdownChoice(createRoot(selects) as unknown as HTMLElement, {
      count: 1,
      options: [{ value: 'a', label: 'Alpha' }],
      selected: ['missing'],
      unavailableLabel: (value) => `${value} (saved)`,
    }, () => undefined);

    expect(selects[0].options).toContainEqual(expect.objectContaining({ value: 'missing', textContent: 'missing (saved)', selected: true, disabled: true }));
  });

  it('emits values in dropdown order and refreshes disabled options', () => {
    const selects: TestSelect[] = [];
    const emitted: string[][] = [];
    renderRepeatedDropdownChoice(createRoot(selects) as unknown as HTMLElement, {
      count: 2,
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }],
      selected: ['a', 'b'],
    }, (values) => emitted.push(values));

    selects[0].value = 'c';
    selects[0].handlers[0]();

    expect(emitted).toEqual([['c', 'b']]);
    expect(selects[1].options.find((option) => option.value === 'c')?.disabled).toBe(true);
  });
});

interface TestOption { value: string; textContent: string; selected: boolean; disabled: boolean; }
interface TestSelect {
  value: string;
  multiple: boolean;
  options: TestOption[];
  handlers: Array<() => void>;
  attributes: Record<string, string>;
  textContent: string;
  createEl(tag: string, options?: { value?: string; text?: string }): TestOption;
  addEventListener(type: string, handler: () => void): void;
}

function createRoot(selects: TestSelect[]): { createEl(tag: string, options?: { attr?: Record<string, string> }): TestSelect } {
  return {
    createEl: (_tag, rootOptions) => {
      const options: TestOption[] = [];
      let textContent = '';
      const select: TestSelect = {
        value: '',
        multiple: false,
        options,
        handlers: [],
        attributes: { ...(rootOptions?.attr ?? {}) },
        get textContent() { return textContent; },
        set textContent(value: string) { textContent = value; if (value === '') options.splice(0); },
        createEl: (_tag, option = {}) => {
          const created = { value: option.value ?? '', textContent: option.text ?? '', selected: false, disabled: false };
          options.push(created);
          return created;
        },
        addEventListener: (_type, handler) => { select.handlers.push(handler); },
      };
      selects.push(select);
      return select;
    },
  };
}
