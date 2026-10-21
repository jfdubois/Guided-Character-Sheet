import { Modal, type App } from 'obsidian';

export class CharacterResetModal extends Modal {
  constructor(app: App, title: string, message: string, confirmText: string, onConfirm: () => void, onCancel: () => void = () => undefined) {
    super(app);
    this.title = title;
    this.message = message;
    this.confirmText = confirmText;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  private readonly title: string;
  private readonly message: string;
  private readonly confirmText: string;
  private readonly onConfirm: () => void;
  private readonly onCancel: () => void;
  private settled = false;

  onOpen(): void {
    this.titleEl.textContent = this.title;
    this.contentEl.empty();
    this.contentEl.createDiv({ text: this.message });
    const actions = this.contentEl.createDiv({ cls: 'guided-character-sheet__reset-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.cancel());
    const confirm = actions.createEl('button', { text: this.confirmText, cls: 'mod-warning', attr: { type: 'button' } });
    confirm.addEventListener('click', () => this.confirm());
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.cancel();
  }

  private confirm(): void {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.onConfirm();
  }

  private cancel(): void {
    if (this.settled) return;
    this.settled = true;
    this.close();
    this.onCancel();
  }
}
