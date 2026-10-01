import { Modal } from 'obsidian';
import type { App } from 'obsidian';
import type { FoundryItemSummary, ItemSearchFilters } from './foundry-source-catalog';
import type { SourceIndex } from './character-sources';
import type { CharacterRuleset } from './character-model';

export interface ItemSearchModalOptions {
  onSelect: (item: FoundryItemSummary) => void;
  selector?: string;
  itemType?: string;
}

export class ItemSearchModal extends Modal {
  private readonly sourceIndex: SourceIndex;
  private readonly ruleset: CharacterRuleset;
  private readonly onSelect: (item: FoundryItemSummary) => void;
  private readonly selector?: string;
  private readonly itemType?: string;
  private query = '';
  private filters: ItemSearchFilters;
  private results: HTMLElement | undefined;

  constructor(app: App, sourceIndex: SourceIndex, ruleset: CharacterRuleset, options: ItemSearchModalOptions) {
    super(app);
    this.sourceIndex = sourceIndex;
    this.ruleset = ruleset;
    this.onSelect = options.onSelect;
    this.selector = options.selector;
    this.itemType = options.itemType;
    this.filters = { ruleset };
  }

  onOpen(): void {
    this.titleEl.setText('Add an item');
    const input = this.contentEl.createEl('input', { type: 'search', placeholder: 'Search items', attr: { 'aria-label': 'Search items' } });
    input.addEventListener('input', () => { this.query = input.value; void this.renderResults(); });
    const controls = this.contentEl.createDiv({ cls: 'guided-character-sheet__item-search-filters' });
    const type = controls.createEl('select', { attr: { 'aria-label': 'Item type' } });
    for (const [value, label] of [['', 'All item types'], ['weapon', 'Weapons'], ['equipment', 'Equipment'], ['tool', 'Tools'], ['consumable', 'Consumables'], ['container', 'Containers'], ['loot', 'Loot']] as const) type.createEl('option', { value, text: label });
    type.addEventListener('change', () => { this.filters = { ...this.filters, itemType: type.value || undefined }; void this.renderResults(); });
    const rarity = controls.createEl('select', { attr: { 'aria-label': 'Item rarity' } });
    for (const [value, label] of [['', 'All rarities'], ['common', 'Common'], ['uncommon', 'Uncommon'], ['rare', 'Rare'], ['veryRare', 'Very rare'], ['legendary', 'Legendary'], ['artifact', 'Artifact']] as const) rarity.createEl('option', { value, text: label });
    rarity.addEventListener('change', () => { this.filters = { ...this.filters, rarity: rarity.value || undefined }; void this.renderResults(); });
    const magic = controls.createEl('select', { attr: { 'aria-label': 'Magic items' } });
    for (const [value, label] of [['', 'All items'], ['true', 'Magic items'], ['false', 'Non-magic items']] as const) magic.createEl('option', { value, text: label });
    magic.addEventListener('change', () => { this.filters = { ...this.filters, magic: magic.value === '' ? undefined : magic.value === 'true' }; void this.renderResults(); });
    this.results = this.contentEl.createDiv({ cls: 'guided-character-sheet__item-search-results' });
    void this.renderResults();
  }

  onClose(): void { this.contentEl.empty(); }

  private async renderResults(): Promise<void> {
    if (this.results === undefined) return;
    this.results.empty();
    let items: FoundryItemSummary[];
    try {
      items = this.selector === undefined
        ? await this.sourceIndex.searchItems(this.query, { ...this.filters, ...(this.itemType === undefined ? {} : { itemType: this.itemType }) })
        : (await this.sourceIndex.resolveSelector(this.selector, this.ruleset)).filter((item) => matchesQuery(item, this.query));
    } catch (error) { this.results.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' }); return; }
    if (items.length === 0) { this.results.createDiv({ text: 'No matching items.', cls: 'guided-character-sheet__hint' }); return; }
    for (const item of items.slice(0, 50)) {
      const button = this.results.createEl('button', { text: item.name, attr: { type: 'button' } });
      button.addEventListener('click', () => { this.onSelect(item); this.close(); });
    }
  }
}

function matchesQuery(item: FoundryItemSummary, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return true;
  return item.name.toLocaleLowerCase().includes(normalized) || item.identifier?.toLocaleLowerCase().includes(normalized) === true;
}
