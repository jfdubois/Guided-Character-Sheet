import { Modal, type App } from 'obsidian';
import type { InventoryCurrency } from './inventory';
import { applyCurrencyTransaction, CURRENCY_DENOMINATIONS, type CurrencyDenomination, type CurrencyOperation } from './currency-transaction';

const CURRENCY_NAMES: Readonly<Record<CurrencyDenomination, string>> = { pp: 'Platinum', gp: 'Gold', ep: 'Electrum', sp: 'Silver', cp: 'Copper' };
const DENOMINATIONS = CURRENCY_DENOMINATIONS.map((key) => ({ key, name: CURRENCY_NAMES[key] }));

export class CurrencyModal extends Modal {
  constructor(app: App, private readonly currency: InventoryCurrency, private readonly onConfirm: (operation: CurrencyOperation, denomination: CurrencyDenomination, amount: number) => void) { super(app); }

  onOpen(): void {
    this.titleEl.setText('Manage currency');
    this.contentEl.createDiv({ text: 'Current balance', cls: 'guided-character-sheet__currency-heading' });
    const balances = this.contentEl.createDiv({ cls: 'guided-character-sheet__currency-balances' });
    for (const { key, name } of DENOMINATIONS) balances.createDiv({ text: `${this.currency[key]} ${key.toUpperCase()}`, attr: { 'aria-label': `${name}: ${this.currency[key]}` } });

    const actionField = this.contentEl.createDiv({ cls: 'guided-character-sheet__currency-field' });
    actionField.createEl('label', { text: 'Action' });
    const action = actionField.createEl('select', { attr: { 'aria-label': 'Currency action' } });
    action.createEl('option', { value: 'spend', text: 'Spend' });
    action.createEl('option', { value: 'add', text: 'Add' });
    action.value = 'spend';

    const denominationField = this.contentEl.createDiv({ cls: 'guided-character-sheet__currency-field' });
    denominationField.createEl('label', { text: 'Denomination' });
    const denomination = denominationField.createEl('select', { attr: { 'aria-label': 'Currency denomination' } });
    for (const { key, name } of DENOMINATIONS) denomination.createEl('option', { value: key, text: `${name} (${key.toUpperCase()})` });
    denomination.value = 'gp';

    const amountField = this.contentEl.createDiv({ cls: 'guided-character-sheet__currency-field' });
    amountField.createEl('label', { text: 'Amount' });
    const amount = amountField.createEl('input', { attr: { type: 'number', min: '1', step: '1', inputmode: 'numeric', 'aria-label': 'Currency amount' } });
    amount.type = 'number';
    amount.min = '1';
    amount.step = '1';
    const preview = this.contentEl.createDiv({ cls: 'guided-character-sheet__currency-preview', attr: { 'aria-live': 'polite' } });
    const controls = this.contentEl.createDiv({ cls: 'guided-character-sheet__currency-actions' });
    const confirm = controls.createEl('button', { text: 'Apply currency change', cls: 'mod-cta', attr: { type: 'button' } });
    confirm.disabled = true;
    const cancel = controls.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());

    const update = (): void => {
      preview.empty();
      confirm.disabled = true;
      if (amount.value.trim() === '') return;
      const count = Number(amount.value);
      const chosenAction: CurrencyOperation = action.value === 'add' ? 'add' : 'spend';
      const chosenDenomination = denomination.value as CurrencyDenomination;
      try {
        const next = applyCurrencyTransaction(this.currency, chosenAction, chosenDenomination, count);
        const formatted = DENOMINATIONS.map(({ key }) => `${next[key]} ${key.toUpperCase()}`).join(', ');
        preview.createDiv({ text: `After ${chosenAction === 'add' ? 'adding' : 'spending'}: ${formatted}` });
        confirm.disabled = false;
      } catch (error) {
        preview.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' });
      }
    };
    action.addEventListener('change', update);
    denomination.addEventListener('change', update);
    amount.addEventListener('input', update);
    confirm.addEventListener('click', () => {
      if (confirm.disabled) return;
      this.onConfirm(action.value === 'add' ? 'add' : 'spend', denomination.value as CurrencyDenomination, Number(amount.value));
      this.close();
    });
    amount.focus();
  }

  onClose(): void { this.contentEl.empty(); }
}
