import { Modal, setIcon, type App } from 'obsidian';
import type { CharacterRuleset } from './character-model';
import type { SourceIndex } from './character-sources';
import type { FoundryItemSummary } from './foundry-source-catalog';
import { normalizeFoundryDescription } from './foundry-description';
import { isFoundryInventoryEntry, type InventoryEntry, type InventoryItemChanges } from './inventory';

const MAX_RESULTS = 50;

export class ManageItemsModal extends Modal {
  private readonly initial: readonly InventoryEntry[];
  private readonly added = new Map<string, { source: FoundryItemSummary; quantity: number }>();
  private readonly removed = new Set<string>();
  private readonly quantityDeltas = new Map<string, number>();
  private resultsEl: HTMLElement | undefined;
  private managedEl: HTMLElement | undefined;
  private query = '';
  private itemType: string | undefined;
  private visibleCount = MAX_RESULTS;
  private requestVersion = 0;

  constructor(
    app: App,
    private readonly sourceIndex: SourceIndex,
    private readonly ruleset: CharacterRuleset,
    managed: readonly InventoryEntry[],
    private readonly onApply: (changes: InventoryItemChanges) => void,
  ) {
    super(app);
    this.initial = managed.map((entry) => structuredClone(entry));
  }

  onOpen(): void {
    this.titleEl.setText('Manage items');
    const searchControls = this.contentEl.createDiv({ cls: 'guided-character-sheet__manage-search' });
    const search = searchControls.createEl('input', { type: 'search', placeholder: 'Search items', attr: { 'aria-label': 'Search items' } });
    search.addEventListener('input', () => { this.query = search.value; this.visibleCount = MAX_RESULTS; void this.renderResults(); });
    const type = searchControls.createEl('select', { attr: { 'aria-label': 'Item type' } });
    for (const [value, label] of [['', 'All item types'], ['weapon', 'Weapons'], ['equipment', 'Equipment'], ['tool', 'Tools'], ['consumable', 'Consumables'], ['container', 'Containers'], ['loot', 'Loot']] as const) type.createEl('option', { value, text: label });
    type.addEventListener('change', () => { this.itemType = type.value || undefined; this.visibleCount = MAX_RESULTS; void this.renderResults(); });

    this.managedEl = this.contentEl.createDiv({ cls: 'guided-character-sheet__manage-spells-managed' });
    this.resultsEl = this.contentEl.createDiv({ cls: 'guided-character-sheet__manage-spells-results' });
    const footer = this.contentEl.createDiv({ cls: 'guided-character-sheet__manage-spells-actions' });
    footer.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).addEventListener('click', () => this.close());
    footer.createEl('button', { text: 'Apply', cls: 'mod-cta', attr: { type: 'button' } }).addEventListener('click', () => {
      this.onApply({
        removedEntryIds: [...this.removed],
        added: [...this.added.values()].map(({ source, quantity }) => ({ source, quantity })),
        quantityChanges: [...this.quantityDeltas].filter(([entryId, delta]) => delta !== 0 && !this.removed.has(entryId)).map(([entryId, delta]) => ({ entryId, delta })),
      });
      this.close();
    });
    this.renderManaged();
    void this.renderResults();
  }

  onClose(): void {
    this.requestVersion += 1;
    this.contentEl.empty();
    this.resultsEl = undefined;
    this.managedEl = undefined;
  }

  private renderManaged(): void {
    if (this.managedEl === undefined) return;
    this.managedEl.empty();
    this.managedEl.createEl('h3', { text: 'Currently carried' });
    if (this.initial.length === 0 && this.added.size === 0) {
      this.managedEl.createDiv({ text: 'No items selected.', cls: 'guided-character-sheet__manage-spells-empty' });
      return;
    }
    const rows = [
      ...this.initial.map((entry) => ({ kind: 'initial' as const, entry, name: isFoundryInventoryEntry(entry) ? entry.source.name : entry.custom.name, entryId: entry.entryId })),
      ...[...this.added].map(([key, added]) => ({ kind: 'added' as const, key, added, name: added.source.name, entryId: `source:${added.source.pack}:${added.source.id}` })),
    ].sort((left, right) => left.name.localeCompare(right.name) || left.entryId.localeCompare(right.entryId));
    for (const current of rows) {
      if (current.kind === 'added') {
        const { key, added } = current;
        const { source, quantity } = added;
        const row = this.managedEl.createDiv({ cls: 'guided-character-sheet__manage-spells-row' });
        row.createSpan({ text: `${source.name} ×${quantity}`, cls: 'guided-character-sheet__manage-spells-label' });
        const controls = row.createDiv({ cls: 'guided-character-sheet__manage-items-quantity-controls' });
        iconButton(controls, 'plus', `Increase quantity of ${source.name}`, () => {
          this.added.set(key, { source, quantity: quantity + 1 });
          this.renderManaged();
        });
        const decrease = iconButton(controls, 'minus', `Decrease quantity of ${source.name}`, () => {
          this.added.set(key, { source, quantity: quantity - 1 });
          this.renderManaged();
        });
        decrease.disabled = quantity <= 1;
        iconButton(controls, 'trash-2', `Remove ${source.name}`, () => {
          this.added.delete(key);
          this.renderManaged();
          void this.renderResults();
        });
        continue;
      }
      const entry = current.entry;
      const name = isFoundryInventoryEntry(entry) ? entry.source.name : entry.custom.name;
      const quantity = entry.quantity + (this.quantityDeltas.get(entry.entryId) ?? 0);
      const removed = this.removed.has(entry.entryId);
      const row = this.managedEl.createDiv({ cls: 'guided-character-sheet__manage-spells-row' });
      row.createSpan({ text: `${name} ×${quantity}`, cls: 'guided-character-sheet__manage-spells-label' });
      const controls = row.createDiv({ cls: 'guided-character-sheet__manage-items-quantity-controls' });
      const increase = iconButton(controls, 'plus', `Increase quantity of ${name}`, () => {
        this.quantityDeltas.set(entry.entryId, (this.quantityDeltas.get(entry.entryId) ?? 0) + 1);
        this.renderManaged();
      });
      increase.disabled = removed;
      const decrease = iconButton(controls, 'minus', `Decrease quantity of ${name}`, () => {
        this.quantityDeltas.set(entry.entryId, (this.quantityDeltas.get(entry.entryId) ?? 0) - 1);
        this.renderManaged();
      });
      decrease.disabled = removed || quantity <= 1;
      iconButton(controls, removed ? 'undo-2' : 'trash-2', `${removed ? 'Restore' : 'Remove'} ${name}`, () => {
        if (removed) this.removed.delete(entry.entryId);
        else this.removed.add(entry.entryId);
        this.renderManaged();
        void this.renderResults();
      });
    }
  }

  private async renderResults(): Promise<void> {
    if (this.resultsEl === undefined) return;
    const version = ++this.requestVersion;
    this.resultsEl.empty();
    let results: FoundryItemSummary[];
    try {
      results = await this.sourceIndex.searchItems(this.query, { ruleset: this.ruleset, ...(this.itemType === undefined ? {} : { itemType: this.itemType }) });
    } catch (error) {
      if (version !== this.requestVersion || this.resultsEl === undefined) return;
      this.resultsEl.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' });
      return;
    }
    if (version !== this.requestVersion || this.resultsEl === undefined) return;
    if (results.length === 0) {
      this.resultsEl.createDiv({ text: 'No matching items.', cls: 'guided-character-sheet__manage-spells-empty' });
      return;
    }
    for (const item of results.slice(0, this.visibleCount)) {
      const key = itemKey(item);
      const existing = this.initial.find((entry) => isFoundryInventoryEntry(entry) && entry.containerEntryId === undefined && itemKey(entry.source) === key);
      const row = this.resultsEl.createDiv({ cls: 'guided-character-sheet__manage-spells-result' });
      const details = row.createDiv({ cls: 'guided-character-sheet__manage-spells-details' });
      details.createSpan({ text: item.name });
      details.createSpan({ text: item.itemType, cls: 'guided-character-sheet__manage-spells-meta' });
      if (item.description !== undefined) details.createDiv({ text: normalizeFoundryDescription(item.description), cls: 'guided-character-sheet__manage-spells-description' });
      const selected = this.added.has(key) || existing !== undefined && !this.removed.has(existing.entryId);
      const add = row.createEl('button', { text: selected ? 'In inventory' : 'Add', attr: { type: 'button' } });
      add.disabled = selected;
      add.addEventListener('click', () => {
        if (existing !== undefined) this.removed.delete(existing.entryId);
        else this.added.set(key, { source: item, quantity: 1 });
        this.renderManaged();
        void this.renderResults();
      });
    }
    if (results.length > this.visibleCount) {
      this.resultsEl.createEl('button', { text: 'Show more', attr: { type: 'button' } }).addEventListener('click', () => {
        this.visibleCount += MAX_RESULTS;
        void this.renderResults();
      });
    }
  }
}

function itemKey(item: { pack: string; id: string }): string { return `${item.pack}:${item.id}`; }

function iconButton(root: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const button = root.createEl('button', { cls: 'guided-character-sheet__manage-items-icon-button', attr: { type: 'button', 'aria-label': label, title: label } });
  setIcon(button, icon);
  button.addEventListener('click', onClick);
  return button;
}
