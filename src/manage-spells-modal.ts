import { Modal, type App } from 'obsidian';
import type { CharacterRuleset } from './character-model';
import type { FoundrySourceReference, FoundrySpellSummary } from './foundry-source-catalog';
import type { SourceIndex } from './character-sources';
import { normalizeFoundryDescription } from './foundry-description';

const MAX_RESULTS = 50;

export class ManageSpellsModal extends Modal {
  private readonly sourceIndex: SourceIndex;
  private readonly ruleset: CharacterRuleset;
  private readonly spellLists: readonly string[];
  private readonly onApply: (references: FoundrySourceReference[]) => void;
  private readonly managed = new Map<string, FoundrySourceReference>();
  private readonly initiallyManaged = new Map<string, FoundrySourceReference>();
  private readonly removed = new Set<string>();
  private resultsEl: HTMLElement | undefined;
  private managedEl: HTMLElement | undefined;
  private query = '';
  private level: number | undefined;
  private requestVersion = 0;

  constructor(app: App, sourceIndex: SourceIndex, ruleset: CharacterRuleset, spellLists: readonly string[], managed: readonly FoundrySourceReference[], onApply: (references: FoundrySourceReference[]) => void) {
    super(app);
    this.sourceIndex = sourceIndex;
    this.ruleset = ruleset;
    this.spellLists = spellLists;
    this.onApply = onApply;
    for (const reference of managed) {
      const copy = toReference(reference);
      const key = referenceKey(reference);
      this.managed.set(key, copy);
      this.initiallyManaged.set(key, copy);
    }
  }

  onOpen(): void {
    this.titleEl.setText('Manage spells');
    const search = this.contentEl.createEl('input', { type: 'search', placeholder: 'Search spells', attr: { 'aria-label': 'Search spells' } });
    search.addEventListener('input', () => { this.query = search.value; void this.renderResults(); });
    const level = this.contentEl.createEl('select', { cls: 'guided-character-sheet__manage-spells-level', attr: { 'aria-label': 'Spell level' } });
    const levels: Array<[string, string]> = [['', 'All levels'], ['0', 'Cantrips'], ...Array.from({ length: 9 }, (_value, index): [string, string] => [String(index + 1), `${index + 1}${ordinalSuffix(index + 1)} level`])];
    for (const [value, label] of levels) level.createEl('option', { value, text: label });
    level.addEventListener('change', () => { this.level = level.value === '' ? undefined : Number(level.value); void this.renderResults(); });

    this.managedEl = this.contentEl.createDiv({ cls: 'guided-character-sheet__manage-spells-managed' });
    this.resultsEl = this.contentEl.createDiv({ cls: 'guided-character-sheet__manage-spells-results' });
    const footer = this.contentEl.createDiv({ cls: 'guided-character-sheet__manage-spells-actions' });
    const cancel = footer.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    const apply = footer.createEl('button', { text: 'Apply', cls: 'mod-cta', attr: { type: 'button' } });
    apply.addEventListener('click', () => { this.onApply([...this.managed.values()].map(toReference)); this.close(); });
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
    this.managedEl.createEl('h3', { text: 'Currently managed' });
    const entries = new Map(this.initiallyManaged);
    for (const [key, spell] of this.managed) entries.set(key, spell);
    if (entries.size === 0) {
      this.managedEl.createDiv({ text: 'No spells selected.', cls: 'guided-character-sheet__manage-spells-empty' });
      return;
    }
    for (const [key, spell] of entries) {
      const row = this.managedEl.createDiv({ cls: 'guided-character-sheet__manage-spells-row' });
      const label = row.createDiv({ cls: 'guided-character-sheet__manage-spells-label' });
      label.createSpan({ text: spell.name || spell.id });
      const button = row.createEl('button', { text: this.removed.has(key) ? 'Restore' : 'Remove', attr: { type: 'button' } });
      button.addEventListener('click', () => {
        if (this.removed.has(key)) {
          this.removed.delete(key);
          this.managed.set(key, spell);
        } else {
          this.removed.add(key);
          this.managed.delete(key);
        }
        this.renderManaged();
        this.renderResults();
      });
    }
  }

  private async renderResults(): Promise<void> {
    if (this.resultsEl === undefined) return;
    const version = ++this.requestVersion;
    this.resultsEl.empty();
    let results: FoundrySpellSummary[];
    try {
      results = await this.sourceIndex.searchSpells({ ruleset: this.ruleset, query: this.query, ...(this.level === undefined ? {} : { level: this.level }), spellLists: [...this.spellLists] });
    } catch (error) {
      if (version !== this.requestVersion || this.resultsEl === undefined) return;
      this.resultsEl.createDiv({ text: error instanceof Error ? error.message : String(error), cls: 'guided-character-sheet__warning' });
      return;
    }
    if (version !== this.requestVersion || this.resultsEl === undefined) return;
    if (results.length === 0) {
      this.resultsEl.createDiv({ text: 'No matching spells.', cls: 'guided-character-sheet__manage-spells-empty' });
      return;
    }
    for (const spell of results.slice(0, MAX_RESULTS)) {
      const row = this.resultsEl.createDiv({ cls: 'guided-character-sheet__manage-spells-result' });
      const details = row.createDiv({ cls: 'guided-character-sheet__manage-spells-details' });
      details.createSpan({ text: spell.name });
      details.createSpan({ text: spell.level === 0 ? 'Cantrip' : `Level ${spell.level}`, cls: 'guided-character-sheet__manage-spells-meta' });
      if (spell.description !== undefined) details.createDiv({ text: normalizeFoundryDescription(spell.description), cls: 'guided-character-sheet__manage-spells-description' });
      const key = referenceKey(spell);
      const button = row.createEl('button', { text: this.managed.has(key) ? 'Remove' : 'Add', attr: { type: 'button' } });
      button.addEventListener('click', () => {
        if (this.managed.has(key)) {
          this.managed.delete(key);
          if (this.initiallyManaged.has(key)) this.removed.add(key);
        } else {
          this.removed.delete(key);
          this.managed.set(key, toReference(spell));
        }
        this.renderManaged();
        void this.renderResults();
      });
    }
  }
}

export function referenceKey(reference: FoundrySourceReference): string {
  return `${reference.sourcePath}:${reference.pack}:${reference.type}:${reference.id}`;
}

function toReference(reference: FoundrySourceReference): FoundrySourceReference {
  return {
    sourcePath: reference.sourcePath,
    pack: reference.pack,
    type: reference.type,
    id: reference.id,
    name: reference.name,
    ...(reference.identifier === undefined ? {} : { identifier: reference.identifier }),
  };
}

function ordinalSuffix(value: number): string {
  if (value % 100 >= 11 && value % 100 <= 13) return 'th';
  return value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th';
}
