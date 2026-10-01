import { Modal, type App } from 'obsidian';
import type { HitPointAdjustment, MutableHitPoints } from './mutable-character-state';

export class HitPointAdjustmentModal extends Modal {
  private readonly hitPoints: Required<MutableHitPoints>;
  private readonly onAdjust: (operation: HitPointAdjustment, amount: number) => void;

  constructor(app: App, hitPoints: Required<MutableHitPoints>, onAdjust: (operation: HitPointAdjustment, amount: number) => void) {
    super(app);
    this.hitPoints = hitPoints;
    this.onAdjust = onAdjust;
  }

  onOpen(): void {
    this.titleEl.setText('Adjust hit points');
    this.contentEl.createDiv({ text: `Current: ${this.hitPoints.current}/${this.hitPoints.maximum}; temporary: ${this.hitPoints.temporary}.`, cls: 'guided-character-sheet__hit-points-modal-summary' });
    const input = this.contentEl.createEl('input', { type: 'number', cls: 'guided-character-sheet__hit-points-modal-input', attr: { min: '0', step: '1', inputmode: 'numeric', 'aria-label': 'Hit-point amount' } });
    input.focus();
    const error = this.contentEl.createDiv({ cls: 'guided-character-sheet__warning' });
    const controls = this.contentEl.createDiv({ cls: 'guided-character-sheet__hit-points-modal-controls' });
    for (const [operation, label] of [['heal', 'Heal'], ['damage', 'Damage'], ['temp', 'Temp']] as const) {
      const button = controls.createEl('button', { text: label, attr: { type: 'button' } });
      button.addEventListener('click', () => {
        const amount = Number(input.value);
        if (!Number.isInteger(amount) || amount < 0 || !Number.isFinite(amount) || input.value.trim() === '') { error.setText('Enter a nonnegative whole number.'); input.focus(); return; }
        error.empty();
        this.onAdjust(operation, amount);
        this.close();
      });
    }
  }

  onClose(): void { this.contentEl.empty(); }
}
