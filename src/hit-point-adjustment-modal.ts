import { Modal, type App } from 'obsidian';
import { effectiveHitPointMaximum, type HitPointAdjustment, type MutableHitPoints } from './mutable-character-state';

export class HitPointAdjustmentModal extends Modal {
  private readonly hitPoints: MutableHitPoints & { temporary: number };
  private readonly onAdjust: (operation: HitPointAdjustment, amount: number) => void;

  constructor(app: App, hitPoints: MutableHitPoints & { temporary: number }, onAdjust: (operation: HitPointAdjustment, amount: number) => void) {
    super(app);
    this.hitPoints = hitPoints;
    this.onAdjust = onAdjust;
  }

  onOpen(): void {
    this.titleEl.setText('Adjust hit points');
    const effectiveMaximum = effectiveHitPointMaximum(this.hitPoints);
    const maximumSummary = this.hitPoints.maximumOverride === undefined ? `maximum: ${this.hitPoints.maximum}` : `effective maximum: ${effectiveMaximum}; calculated maximum: ${this.hitPoints.maximum}`;
    this.contentEl.createDiv({ text: `Current: ${this.hitPoints.current}/${effectiveMaximum}; ${maximumSummary}; temporary: ${this.hitPoints.temporary}.`, cls: 'guided-character-sheet__hit-points-modal-summary' });
    this.contentEl.createEl('label', { text: 'Adjustment amount' });
    const input = this.contentEl.createEl('input', { type: 'number', cls: 'guided-character-sheet__hit-points-modal-input', attr: { min: '0', step: '1', inputmode: 'numeric', 'aria-label': 'Hit-point amount' } });
    input.focus();
    const error = this.contentEl.createDiv({ cls: 'guided-character-sheet__warning' });
    const controls = this.contentEl.createDiv({ cls: 'guided-character-sheet__hit-points-modal-controls' });
    for (const [operation, label] of [['heal', 'Heal'], ['damage', 'Damage'], ['temp', 'Set temp']] as const) {
      const button = controls.createEl('button', { text: label, attr: { type: 'button' } });
      button.addEventListener('click', () => {
        const amount = Number(input.value);
        if (!Number.isInteger(amount) || amount < 0 || !Number.isFinite(amount) || input.value.trim() === '') { error.setText('Enter a nonnegative whole number.'); input.focus(); return; }
        error.empty();
        this.onAdjust(operation, amount);
        this.close();
      });
    }

    const maximumControls = this.contentEl.createDiv({ cls: 'guided-character-sheet__hit-points-modal-maximum' });
    maximumControls.createEl('label', { text: 'Effective maximum' });
    const maximumInput = maximumControls.createEl('input', { type: 'number', value: String(effectiveMaximum), cls: 'guided-character-sheet__hit-points-modal-input', attr: { min: '0', step: '1', inputmode: 'numeric', 'aria-label': 'Effective maximum hit points' } });
    const maximumButtons = maximumControls.createDiv({ cls: 'guided-character-sheet__hit-points-modal-controls' });
    const setMaximum = maximumButtons.createEl('button', { text: 'Set maximum', attr: { type: 'button' } });
    setMaximum.addEventListener('click', () => {
      const amount = Number(maximumInput.value);
      if (!Number.isInteger(amount) || amount < 0 || !Number.isFinite(amount) || maximumInput.value.trim() === '') { error.setText('Enter a nonnegative whole-number maximum.'); maximumInput.focus(); return; }
      error.empty();
      this.onAdjust('maximum', amount);
      this.close();
    });
    const clearMaximum = maximumButtons.createEl('button', { text: 'Clear override', attr: { type: 'button' } });
    clearMaximum.disabled = this.hitPoints.maximumOverride === undefined;
    clearMaximum.addEventListener('click', () => {
      this.onAdjust('clear-maximum', 0);
      this.close();
    });
  }

  onClose(): void { this.contentEl.empty(); }
}
