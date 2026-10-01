export interface DropdownChoiceOption {
  value: string;
  label: string;
}

export interface RepeatedDropdownChoice {
  count: number;
  options: DropdownChoiceOption[];
  selected: string[];
  placeholder?: (index: number) => string;
  ariaLabel?: (index: number) => string;
  unavailableLabel?: (value: string) => string;
}

export function renderRepeatedDropdownChoice(
  root: HTMLElement,
  choice: RepeatedDropdownChoice,
  onChange: (values: string[]) => void,
): HTMLSelectElement[] {
  const selected = Array.from({ length: choice.count }, (_, index) => choice.selected[index] ?? '');
  const selects: HTMLSelectElement[] = [];
  const validValues = new Set(choice.options.map((option) => option.value));

  const renderOptions = (): void => {
    for (const [index, select] of selects.entries()) {
      select.textContent = '';
      const placeholder = select.createEl('option', { value: '', text: choice.placeholder?.(index) ?? (choice.count === 1 ? 'Select an option' : `Select option ${index + 1}`) });
      placeholder.disabled = true;
      placeholder.selected = selected[index] === '';
      for (const option of choice.options) {
        const element = select.createEl('option', { value: option.value, text: option.label });
        element.selected = selected[index] === option.value;
        element.disabled = selected.some((value, selectedIndex) => selectedIndex !== index && value === option.value);
      }
      const unavailable = selected[index];
      if (unavailable !== '' && !validValues.has(unavailable)) {
        const element = select.createEl('option', { value: unavailable, text: choice.unavailableLabel?.(unavailable) ?? `${unavailable} (unavailable)` });
        element.selected = true;
        element.disabled = true;
      }
    }
  };

  for (let index = 0; index < choice.count; index += 1) {
    const ariaLabel = choice.ariaLabel?.(index);
    const select = root.createEl('select', ariaLabel === undefined ? undefined : { attr: { 'aria-label': ariaLabel } });
    select.multiple = false;
    selects.push(select);
    select.addEventListener('change', () => {
      selected[index] = select.value;
      onChange(selected.filter((value) => value.length > 0));
      renderOptions();
    });
  }
  renderOptions();
  return selects;
}
