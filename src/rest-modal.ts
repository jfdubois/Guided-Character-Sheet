import { Modal, type App } from 'obsidian';
import { applyLongRest, type LongRestSummary } from './long-rest';
import type { MutableCharacterState } from './mutable-character-state';
import { applyShortRest, type ShortRestInput, type ShortRestSummary } from './short-rest';

export type RestChoice = { type: 'long' } | { type: 'short'; input: ShortRestInput };

export interface RestModalOptions {
  allowShortRest: boolean;
  constitutionModifier?: number;
  compatibilityUpdateCount?: number;
}

export class RestModal extends Modal {
  constructor(
    app: App,
    private readonly state: MutableCharacterState,
    private readonly options: RestModalOptions,
    private readonly onConfirm: (choice: RestChoice) => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText('Take a rest');
    this.contentEl.createDiv({ text: 'Choose a rest type to preview its supported recoveries.', cls: 'guided-character-sheet__hint' });
    const typeField = this.contentEl.createDiv({ cls: 'guided-character-sheet__rest-field' });
    typeField.createEl('label', { text: 'Rest type' });
    const type = typeField.createEl('select', { attr: { 'aria-label': 'Rest type' } });
    type.createEl('option', { value: '', text: 'Choose a rest type' });
    type.createEl('option', { value: 'short', text: 'Short rest', attr: this.options.allowShortRest ? {} : { disabled: 'disabled' } });
    type.createEl('option', { value: 'long', text: 'Long rest' });
    type.value = '';

    if (!this.options.allowShortRest) this.contentEl.createDiv({ text: 'Short Rest automation is currently available only for 2024 characters.', cls: 'guided-character-sheet__hint' });
    if ((this.options.compatibilityUpdateCount ?? 0) > 0) this.contentEl.createDiv({ text: `${this.options.compatibilityUpdateCount} legacy rest record${this.options.compatibilityUpdateCount === 1 ? '' : 's'} will be reconciled from the current character sources when this rest is confirmed.`, cls: 'guided-character-sheet__hint' });
    const preview = this.contentEl.createDiv({ cls: 'guided-character-sheet__rest-preview' });
    const controls = this.contentEl.createDiv({ cls: 'guided-character-sheet__rest-controls' });
    const confirm = controls.createEl('button', { text: 'Confirm rest', cls: 'mod-cta', attr: { type: 'button' } });
    confirm.disabled = true;
    const cancel = controls.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());

    let choice: RestChoice | undefined;
    const setChoice = (next: RestChoice | undefined, changed: boolean): void => {
      choice = next;
      confirm.disabled = next === undefined || !changed;
    };
    const renderLong = (): void => {
      const { summary } = applyLongRest(this.state);
      this.renderLongSummary(preview, summary);
      setChoice({ type: 'long' }, summary.changed || this.hasCompatibilityUpdate());
    };
    const renderShort = (): void => {
      preview.empty();
      const hitPoints = this.state.hitPoints;
      if (hitPoints === undefined) {
        preview.createDiv({ text: 'Hit-point state is unavailable.', cls: 'guided-character-sheet__warning' });
        setChoice(undefined, false);
        return;
      }
      preview.createDiv({ text: `Hit points: ${hitPoints.current}/${hitPoints.maximumOverride ?? hitPoints.maximum}.`, cls: 'guided-character-sheet__rest-summary' });
      const pool = this.state.hitDice?.[0];
      const spendField = preview.createDiv({ cls: 'guided-character-sheet__rest-check' });
      const spend = spendField.createEl('input', { attr: { type: 'checkbox', 'aria-label': 'Spend one Hit Point Die' } });
      spend.type = 'checkbox';
      spend.disabled = pool === undefined || pool.current < 1;
      spendField.createSpan({ text: pool === undefined ? 'Hit Point Dice unavailable' : `Spend 1${pool.denomination} Hit Point Die (${pool.current}/${pool.maximum} available)` });
      if (this.options.constitutionModifier !== undefined) {
        const dieMaximum = pool === undefined ? undefined : Number(pool.denomination.slice(1));
        const supportedMaximum = dieMaximum === undefined ? undefined : Math.max(1, dieMaximum + this.options.constitutionModifier);
        preview.createDiv({ text: `Constitution modifier: ${formatModifier(this.options.constitutionModifier)}.${supportedMaximum === undefined ? '' : ` Supported result: 1–${supportedMaximum}.`} Enter the final healing result after rolling at the table.`, cls: 'guided-character-sheet__hint' });
      }
      const healingField = preview.createDiv({ cls: 'guided-character-sheet__rest-field' });
      healingField.createEl('label', { text: 'Healing result' });
      const healing = healingField.createEl('input', { attr: { type: 'number', min: '1', step: '1', inputmode: 'numeric', 'aria-label': 'Healing result' } });
      healing.type = 'number';
      healing.min = '1';
      healing.step = '1';
      healing.value = '';
      healing.disabled = true;
      const summary = preview.createDiv({ cls: 'guided-character-sheet__rest-summary' });
      const update = (): void => {
        summary.empty();
        const isSpending = spend.checked;
        healing.disabled = !isSpending;
        const healingValue = isSpending && healing.value.length > 0 ? Number(healing.value) : 0;
        const input: ShortRestInput = { ...(isSpending && pool !== undefined ? { hitDieClassSourcePath: pool.classSourcePath } : {}), healing: healingValue };
        try {
          const result = applyShortRest(this.state, input);
          this.renderShortSummary(summary, result.summary);
          setChoice({ type: 'short', input }, result.summary.changed || this.hasCompatibilityUpdate());
        } catch (error) {
          summary.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' });
          setChoice(undefined, false);
        }
      };
      spend.addEventListener('change', update);
      healing.addEventListener('input', update);
      update();
    };
    type.addEventListener('change', () => {
      preview.empty();
      setChoice(undefined, false);
      if (type.value === 'long') renderLong();
      else if (type.value === 'short' && this.options.allowShortRest) renderShort();
    });
    confirm.addEventListener('click', () => {
      if (choice === undefined || confirm.disabled) return;
      this.onConfirm(choice);
      this.close();
    });
  }

  onClose(): void { this.contentEl.empty(); }

  private renderLongSummary(root: HTMLElement, summary: LongRestSummary): void {
    root.empty();
    root.createDiv({ text: 'A long rest will apply these supported recoveries:', cls: 'guided-character-sheet__hint' });
    const list = root.createEl('ul', { cls: 'guided-character-sheet__rest-summary' });
    addSummaryItem(list, summary.hitPointsRestored, 'hit point');
    addSummaryItem(list, summary.temporaryHitPointsCleared, 'temporary hit point', 'Clear');
    addSummaryItem(list, summary.hitDiceRestored, 'Hit Point Die', 'Restore', 'Hit Point Dice');
    addSummaryItem(list, summary.spellSlotLevelsRestored, 'spell-slot level');
    addSummaryItem(list, summary.spellUsesRestored, 'source-backed spell use');
    addSummaryItem(list, summary.resourcesRestored, 'feature resource');
    if (!summary.changed) list.createEl('li', { text: this.noRecoveryText() });
    this.renderSkipped(root, summary.skippedRecoveryKeys);
    root.createDiv({ text: 'Prepared spells, inspiration, inventory, equipment, and manual maximum-HP overrides will not change.', cls: 'guided-character-sheet__hint' });
  }

  private renderShortSummary(root: HTMLElement, summary: ShortRestSummary): void {
    const list = root.createEl('ul', { cls: 'guided-character-sheet__rest-summary' });
    addSummaryItem(list, summary.hitDiceSpent, 'Hit Point Die', 'Spend', 'Hit Point Dice');
    addSummaryItem(list, summary.hitPointsRestored, 'hit point');
    addSummaryItem(list, summary.spellSlotLevelsRestored, 'Pact Magic slot level');
    addSummaryItem(list, summary.spellUsesRestored, 'source-backed spell use');
    addSummaryItem(list, summary.resourcesRestored, 'feature resource');
    if (!summary.changed) list.createEl('li', { text: this.noRecoveryText() });
    this.renderSkipped(root, summary.skippedRecoveryKeys);
  }

  private renderSkipped(root: HTMLElement, keys: string[]): void {
    if (keys.length > 0) root.createDiv({ text: `${keys.length} unsupported recovery formula${keys.length === 1 ? ' was' : 's were'} left unchanged.`, cls: 'guided-character-sheet__warning' });
  }

  private hasCompatibilityUpdate(): boolean { return (this.options.compatibilityUpdateCount ?? 0) > 0; }
  private noRecoveryText(): string { return this.hasCompatibilityUpdate() ? 'No tracked values need recovery; legacy rest records will be updated.' : 'No tracked values need recovery.'; }
}

function addSummaryItem(root: HTMLElement, count: number, noun: string, verb = 'Restore', plural = `${noun}s`): void {
  if (count > 0) root.createEl('li', { text: `${verb} ${count} ${count === 1 ? noun : plural}.` });
}

function formatModifier(value: number): string { return value >= 0 ? `+${value}` : String(value); }
