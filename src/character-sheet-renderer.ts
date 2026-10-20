import { CHARACTER_SHEET_SECTIONS, isCharacterSheetSection, type CharacterSheetProjection, type CharacterSheetSection, type SheetValue } from './character-sheet-model';
import type { InventorySheetProjection, InventorySheetRow } from './inventory-sheet-model';
import type { SpellSheetRow } from './spell-sheet-model';
import type { FoundrySourceReference } from './foundry-source-catalog';
import { CURRENCY_DENOMINATIONS } from './currency-transaction';

export interface CharacterSheetCharacterOption { filePath: string; name: string; }

export interface CharacterSheetRenderOptions {
  characters: CharacterSheetCharacterOption[];
  selectedFilePath: string;
  selectedSection: CharacterSheetSection;
  onSelectCharacter(filePath: string): void;
  onEdit(): void;
  onSectionChange(section: CharacterSheetSection): void;
  onToggleEquipment?(entryId: string, equipped: boolean): void;
  onManageCurrency?(): void;
  onManageItems?(): void;
  onToggleSpellSlot?(level: number, spent: boolean): void;
  onToggleSpellUse?(key: string, spent: boolean): void;
  onManageSpells?(): void;
  onToggleSpellPreparation?(source: FoundrySourceReference, prepared: boolean): void;
  onToggleFeatureResource?(key: string, spent: boolean): void;
  onToggleInspiration?(active: boolean): void;
  onAdjustHitPoints?(): void;
  onRest?(): void;
}

export function renderCharacterSheet(root: HTMLElement, sheet: CharacterSheetProjection, options: CharacterSheetRenderOptions): void {
  root.classList.add('guided-character-sheet--open');
  const layout = root.createDiv({ cls: 'guided-character-sheet__sheet-layout' });
  renderHeader(layout, sheet, options);
  const body = layout.createDiv({ cls: 'guided-character-sheet__sheet-body' });
  if (options.selectedSection === 'abilities') renderAbilities(body, sheet);
  else if (options.selectedSection === 'inventory') renderInventory(body, sheet.inventory, sheet.warnings, options.onToggleEquipment, options.onManageCurrency, options.onManageItems);
  else if (options.selectedSection === 'spells') renderSpells(body, sheet.spells, sheet.warnings, options.onToggleSpellSlot, options.onToggleSpellUse, options.onManageSpells, options.onToggleSpellPreparation);
  else if (options.selectedSection === 'features-and-traits') renderFeatures(body, sheet.features, sheet.warnings);
  else if (options.selectedSection === 'actions') renderActions(body, sheet.actions, sheet.warnings, options.onToggleFeatureResource);
  else renderBackground(body, sheet.backgroundDetails, sheet.warnings);
}

function renderHeader(root: HTMLElement, sheet: CharacterSheetProjection, options: CharacterSheetRenderOptions): void {
  const header = root.createDiv({ cls: 'guided-character-sheet__sheet-header' });
  const characterField = header.createDiv({ cls: 'guided-character-sheet__sheet-selector' });
  characterField.createEl('label', { text: 'Character' });
  const characterSelect = characterField.createEl('select', { attr: { 'aria-label': 'Character' } });
  for (const character of options.characters) {
    const option = characterSelect.createEl('option', { value: character.filePath, text: character.name });
    option.selected = character.filePath === options.selectedFilePath;
  }
  characterSelect.value = options.selectedFilePath;
  characterSelect.addEventListener('change', () => { if (characterSelect.value) options.onSelectCharacter(characterSelect.value); });

  const identity = header.createDiv({ cls: 'guided-character-sheet__sheet-identity' });
  const identityText = identity.createDiv();
  identityText.createEl('h2', { text: sheet.identity.name, cls: 'guided-character-sheet__name' });
  identityText.createDiv({ text: identitySummary(sheet), cls: 'guided-character-sheet__sheet-subtitle', attr: { 'aria-label': identityAccessibilityLabel(sheet) } });
  const edit = identity.createEl('button', { text: 'Edit character', attr: { type: 'button', 'aria-label': 'Edit character' } });
  edit.addEventListener('click', options.onEdit);

  const facts = header.createDiv({ cls: 'guided-character-sheet__sheet-facts' });
  renderFact(facts, 'Prof. bonus', sheet.header.proficiencyBonus, formatModifier);
  renderFact(facts, 'Speed', sheet.header.speed, String);
  renderFact(facts, 'Initiative', sheet.header.initiative, formatModifier);
  renderFact(facts, 'Armor class', sheet.header.armorClass, String);
  renderHitPointFact(facts, sheet.header.hitPoints, options.onAdjustHitPoints);
  renderInspirationFact(facts, sheet.header.inspiration, options.onToggleInspiration);

  const actions = header.createDiv({ cls: 'guided-character-sheet__sheet-actions' });
  const restAvailable = options.onRest !== undefined;
  const rest = actions.createEl('button', { text: restAvailable ? 'Rest' : 'Rest unavailable', attr: { type: 'button', 'aria-label': restAvailable ? 'Take a rest' : 'Rest unavailable' } });
  rest.disabled = !restAvailable;
  if (options.onRest !== undefined) rest.addEventListener('click', options.onRest);

  const navigation = header.createDiv({ cls: 'guided-character-sheet__sheet-navigation' });
  navigation.createEl('label', { text: 'Sheet section' });
  const sectionSelect = navigation.createEl('select', { attr: { 'aria-label': 'Sheet section' } });
  for (const section of CHARACTER_SHEET_SECTIONS) {
    const option = sectionSelect.createEl('option', { value: section.value, text: section.label });
    option.selected = section.value === options.selectedSection;
  }
  sectionSelect.value = options.selectedSection;
  sectionSelect.addEventListener('change', () => { if (isCharacterSheetSection(sectionSelect.value)) options.onSectionChange(sectionSelect.value); });
}

function renderHitPointFact(root: HTMLElement, value: SheetValue<{ current: number; maximum: number; temporary: number }>, onAdjust?: () => void): void {
  const fact = root.createDiv({ cls: 'guided-character-sheet__sheet-fact' });
  fact.createSpan({ text: 'Hit points', cls: 'guided-character-sheet__sheet-fact-label' });
  if (value.kind === 'missing' || onAdjust === undefined) { renderSheetValue(fact, 'Hit points', value, ({ current, maximum }) => `${current}/${maximum}`); return; }
  const button = fact.createEl('button', { cls: 'guided-character-sheet__hit-points-control', attr: { type: 'button', 'aria-label': `Hit points: ${value.value.current} of ${value.value.maximum}; temporary ${value.value.temporary}` } });
  button.createSpan({ text: `${value.value.current}/${value.value.maximum}`, cls: 'guided-character-sheet__hit-points-primary' });
  if (value.value.temporary > 0) button.createSpan({ text: `+${value.value.temporary} temp`, cls: 'guided-character-sheet__hit-points-temporary' });
  button.addEventListener('click', onAdjust);
}

function renderInspirationFact(root: HTMLElement, value: SheetValue<boolean>, onToggle?: (active: boolean) => void): void {
  const fact = root.createDiv({ cls: 'guided-character-sheet__sheet-fact' });
  fact.createSpan({ text: 'Inspiration', cls: 'guided-character-sheet__sheet-fact-label' });
  const available = value.kind === 'available';
  const enabled = available && onToggle !== undefined;
  const reason = !available ? value.reason : 'Inspiration controls are unavailable.';
  const checkbox = fact.createEl('input', {
    cls: 'guided-character-sheet__inspiration-control',
    attr: {
      type: 'checkbox',
      'aria-label': enabled ? 'Inspiration' : `Inspiration: ${reason}`,
    },
  });
  checkbox.checked = available && value.value;
  checkbox.disabled = !enabled;
  if (enabled) checkbox.addEventListener('change', () => onToggle(checkbox.checked));
}

function renderFact<T>(root: HTMLElement, label: string, value: SheetValue<T>, format: (value: T) => string): void {
  const fact = root.createDiv({ cls: 'guided-character-sheet__sheet-fact' });
  fact.createSpan({ text: label, cls: 'guided-character-sheet__sheet-fact-label' });
  renderSheetValue(fact, label, value, format);
}

function renderAbilities(root: HTMLElement, sheet: CharacterSheetProjection): void {
  const abilities = createSection(root, 'Abilities');
  const cards = abilities.createDiv({ cls: 'guided-character-sheet__ability-cards' });
  for (const ability of sheet.abilities) {
    const card = cards.createDiv({ cls: 'guided-character-sheet__ability-card' });
    card.createSpan({ text: ability.key.toUpperCase(), cls: 'guided-character-sheet__ability-card-label' });
    renderSheetValue(card, `${ability.label} score`, ability.score, String);
    renderSheetValue(card, `${ability.label} modifier`, ability.modifier, formatModifier);
  }

  const saves = createSection(root, 'Saving throws');
  for (const save of sheet.savingThrows) {
    const row = saves.createDiv({ cls: 'guided-character-sheet__sheet-row' });
    renderProficiency(row, `${save.label} saving throw`, save.proficient);
    row.createSpan({ text: save.label, cls: 'guided-character-sheet__sheet-row-label' });
    for (const annotation of save.annotations ?? []) {
      const marker = row.createSpan({ text: annotation.marker, cls: annotation.marker === 'A' ? 'guided-character-sheet__advantage' : 'guided-character-sheet__disadvantage' });
      marker.setAttribute('aria-label', `${annotation.marker === 'A' ? 'Advantage' : 'Disadvantage'} on ${save.label} saving throw from ${annotation.source}`);
      marker.setAttribute('title', `${annotation.marker === 'A' ? 'Advantage' : 'Disadvantage'} from ${annotation.source}`);
    }
    renderSheetValue(row, `${save.label} saving throw modifier`, save.modifier, formatModifier);
  }
  for (const note of sheet.savingThrowNotes ?? []) {
    const row = saves.createDiv({ cls: 'guided-character-sheet__sheet-subtitle' });
    row.createSpan({ text: note.text });
    row.createSpan({ text: ` Source: ${note.source}`, cls: 'guided-character-sheet__visually-hidden' });
  }

  const skills = createSection(root, 'Skills');
  for (const skill of sheet.skills) {
    const row = skills.createDiv({ cls: 'guided-character-sheet__sheet-row' });
    renderSkillTraining(row, skill);
    const ability = skill.ability.kind === 'available' ? skill.ability.value.toUpperCase() : '—';
    row.createSpan({ text: ability, cls: 'guided-character-sheet__sheet-row-ability' });
    row.createSpan({ text: skill.label, cls: 'guided-character-sheet__sheet-row-label' });
    if (skill.disadvantageSources.length > 0) {
      const indicator = row.createSpan({ text: 'Disadvantage', cls: 'guided-character-sheet__disadvantage' });
      indicator.createSpan({ text: `${skill.label} disadvantage: ${skill.disadvantageSources.join(', ')}.`, cls: 'guided-character-sheet__visually-hidden' });
    }
    renderSheetValue(row, `${skill.label} modifier`, skill.modifier, formatModifier);
  }

  const senses = createSection(root, 'Senses');
  for (const sense of sheet.senses) {
    const row = senses.createDiv({ cls: 'guided-character-sheet__sheet-row' });
    row.createSpan({ text: sense.label, cls: 'guided-character-sheet__sheet-row-label' });
    renderSheetValue(row, sense.label, sense.value, String);
  }

  const training = createSection(root, 'Proficiencies and training');
  for (const entry of sheet.training) {
    const group = training.createDiv({ cls: 'guided-character-sheet__training-group' });
    group.createEl('h4', { text: entry.label });
    renderSheetValue(group, entry.label, entry.values, (values) => values.length === 0 ? 'None' : values.join(', '));
  }

  if (sheet.defenses !== undefined) {
    const defenses = createSection(root, 'Defenses');
    const resistances = defenses.createDiv({ cls: 'guided-character-sheet__sheet-row' });
    resistances.createSpan({ text: 'Damage resistances', cls: 'guided-character-sheet__sheet-row-label' });
    resistances.createSpan({ text: sheet.defenses.resistances.length === 0 ? 'None' : sheet.defenses.resistances.map((resistance) => resistance.damageType).join(', ') });
    for (const resistance of sheet.defenses.resistances) resistances.createSpan({ text: `${resistance.damageType}: ${resistance.source}`, cls: 'guided-character-sheet__visually-hidden' });
  }

  if (sheet.warnings.length > 0) {
    const warnings = createSection(root, 'Source warnings');
    for (const warning of sheet.warnings) warnings.createDiv({ text: warning, cls: 'guided-character-sheet__warning' });
  }
}

function renderInventory(root: HTMLElement, inventory: InventorySheetProjection, warnings: string[], onToggleEquipment?: (entryId: string, equipped: boolean) => void, onManageCurrency?: () => void, onManageItems?: () => void): void {
  const section = createSection(root, 'Inventory', { label: 'Manage items', onClick: onManageItems });
  if (inventory.kind === 'missing') {
    renderSheetValue(section, 'Inventory', inventory, () => '');
    renderInventoryWarnings(section, warnings);
    return;
  }

  const summary = section.createDiv({ cls: 'guided-character-sheet__inventory-summary' });
  const weight = summary.createDiv();
  weight.createSpan({ text: 'Carried weight' });
  renderSheetValue(weight, 'Carried weight', inventory.totalWeight, ({ value, units }) => `${value} ${units}`);
  const currency = summary.createDiv();
  currency.createSpan({ text: 'Currency' });
  const currencyControls = currency.createDiv({ cls: 'guided-character-sheet__currency-controls' });
  currencyControls.createSpan({ text: formatCurrency(inventory.currency), cls: 'guided-character-sheet__sheet-value' });
  if (onManageCurrency !== undefined) {
    const manage = currencyControls.createEl('button', { text: 'Manage currency', attr: { type: 'button' } });
    manage.addEventListener('click', onManageCurrency);
  }
  const prototype = summary.createDiv({ cls: 'guided-character-sheet__sheet-subtitle' });
  prototype.createSpan({ text: onToggleEquipment === undefined ? 'Read-only prototype' : 'Equipment controls — ' });
  prototype.createSpan({ text: onToggleEquipment === undefined ? ' — Equip and Attune actions are not active yet.' : 'Attune actions are not active yet.' });

  const list = section.createDiv({ cls: 'guided-character-sheet__inventory-list' });
  if (inventory.rows.length === 0) {
    list.createDiv({ text: 'No inventory items', cls: 'guided-character-sheet__coming-soon' });
  } else {
    const rows = [...inventory.rows].sort((left, right) => left.name.localeCompare(right.name) || left.entryId.localeCompare(right.entryId));
    for (const row of rows) renderInventoryRow(list, row, onToggleEquipment);
  }
  renderInventoryWarnings(section, warnings);
}

function renderInventoryWarnings(root: HTMLElement, warnings: string[]): void {
  const unique = [...new Set(warnings)];
  if (unique.length === 0) return;
  const warningList = root.createDiv({ cls: 'guided-character-sheet__inventory-notes' });
  for (const warning of unique) warningList.createDiv({ text: warning, cls: 'guided-character-sheet__warning' });
}

function renderInventoryRow(root: HTMLElement, row: InventorySheetRow, onToggleEquipment?: (entryId: string, equipped: boolean) => void): void {
  const item = root.createDiv({ cls: 'guided-character-sheet__inventory-row' });
  const primary = item.createDiv({ cls: 'guided-character-sheet__inventory-primary' });
  primary.createSpan({ text: row.name, cls: 'guided-character-sheet__sheet-row-label' });
  if (row.detail.length > 0) primary.createSpan({ text: row.detail.join(' · '), cls: 'guided-character-sheet__sheet-subtitle' });

  const metrics = item.createDiv({ cls: 'guided-character-sheet__inventory-metrics' });
  metrics.createSpan({ text: `Quantity ${row.quantity}` });
  renderSheetValue(metrics, `${row.name} weight`, row.unitWeight, ({ value, units }) => `${value} ${units}`);

  if (row.notes.length > 0) {
    const notes = item.createDiv({ cls: 'guided-character-sheet__inventory-notes' });
    for (const note of row.notes) notes.createSpan({ text: note });
  }

  const actions = item.createDiv({ cls: 'guided-character-sheet__inventory-actions' });
  const equipAction = row.equipAction;
  const onToggle = onToggleEquipment !== undefined && equipAction?.kind === 'available'
    ? () => onToggleEquipment(row.entryId, !equipAction.active)
    : undefined;
  renderInventoryAction(actions, row.name, equipAction, onToggle);
  renderInventoryAction(actions, row.name, row.attuneAction);
}

function renderInventoryAction(root: HTMLElement, itemName: string, action: InventorySheetRow['equipAction'], onClick?: () => void): void {
  if (action === null) return;
  if (action.kind === 'missing') {
    renderSheetValue(root, `${itemName} action`, action, () => '');
    return;
  }
  const button = root.createEl('button', { text: action.label, attr: { type: 'button', 'aria-label': `${action.label} ${itemName}${onClick === undefined ? '. Read-only prototype' : ''}` } });
  button.disabled = onClick === undefined;
  if (onClick !== undefined) button.addEventListener('click', onClick);
}

function renderSpells(root: HTMLElement, spells: CharacterSheetProjection['spells'], warnings: string[], onToggleSpellSlot?: (level: number, spent: boolean) => void, onToggleSpellUse?: (key: string, spent: boolean) => void, onManageSpells?: () => void, onToggleSpellPreparation?: (source: FoundrySourceReference, prepared: boolean) => void): void {
  const section = createSection(root, 'Spells', { label: 'Manage spells', onClick: onManageSpells });
  if (spells === undefined || spells.kind === 'empty') { renderMissing(section, 'Spells', spells?.reason ?? 'Spellcasting progression is unavailable.'); renderWarnings(section, [...warnings, ...(spells?.warnings ?? [])]); return; }
  const summary = section.createDiv({ cls: 'guided-character-sheet__spell-summary' });
  renderSpellFact(summary, 'Ability', spells.castingAbility, spellAbilityLabel);
  renderSpellFact(summary, 'Modifier', spells.spellModifier, formatModifier);
  renderSpellFact(summary, 'Spell attack', spells.spellAttack, formatModifier);
  renderSpellFact(summary, 'Save DC', spells.saveDc, String);
  const prepHeader = spells.preparedCapacity === undefined ? 'Prep' : `Prep ${spells.preparedCount ?? 0}/${spells.preparedCapacity}`;
  const classCantripCount = spells.cantrips.filter((cantrip) => cantrip.ownership.includes('cantrips-known')).length;
  const cantripCount = spells.cantripCapacity === undefined ? (spells.cantripCapacityBonus ? ` (+${spells.cantripCapacityBonus} capacity)` : '') : ` (${classCantripCount}/${spells.cantripCapacity})`;
  renderSpellRows(section, `Cantrips${cantripCount}`, spells.cantrips, onToggleSpellPreparation, prepHeader);
  for (const level of spells.levels) {
    const levelSection = createSubsection(section, `${ordinal(level.level)}-level spells`, (heading) => {
      const slots = heading.createDiv({ cls: 'guided-character-sheet__spell-slots' });
      slots.createSpan({ text: 'Spell slots', cls: 'guided-character-sheet__visually-hidden' });
      for (let index = 0; index < level.slots.maximum; index += 1) {
        const spent = level.slots.expended.kind === 'available' && index < level.slots.expended.value;
        const label = `Use ${ordinal(level.level)}-level spell slot ${index + 1}`;
        renderUsageCheckbox(slots, label, spent, level.slots.expended, onToggleSpellSlot === undefined ? undefined : (next) => onToggleSpellSlot(level.level, next));
      }
    });
    renderSpellRows(levelSection, 'Spells', level.spells, onToggleSpellPreparation, prepHeader);
  }
  if (spells.freeUses.length > 0) {
    const uses = createSubsection(section, 'Free uses');
    for (const use of spells.freeUses) { const row = uses.createDiv({ cls: 'guided-character-sheet__sheet-row' }); row.createSpan({ text: use.name, cls: 'guided-character-sheet__sheet-row-label' }); row.createSpan({ text: use.current.kind === 'available' ? `${use.current.value} available of ${use.maximum}${use.recoveryPeriod === undefined ? '' : ` per ${recoveryLabel(use.recoveryPeriod)}` }` : `${use.maximum} unavailable${use.recoveryPeriod === undefined ? '' : ` per ${recoveryLabel(use.recoveryPeriod)}` }` }); for (let index = 0; index < use.maximum; index += 1) { const spent = use.current.kind === 'available' && index < use.maximum - use.current.value; const label = `${use.name} use ${index + 1}${use.current.kind === 'missing' ? ': unavailable' : ''}`; renderUsageCheckbox(row, label, spent, use.current, onToggleSpellUse === undefined ? undefined : (next) => onToggleSpellUse(use.key, next)); } }
  }
  if (spells.unresolvedSpells.length > 0) {
    const unresolved = createSubsection(section, 'Unresolved spells');
    for (const spell of spells.unresolvedSpells) {
      const row = unresolved.createDiv({ cls: 'guided-character-sheet__sheet-row' });
      row.createSpan({ text: spell.name, cls: 'guided-character-sheet__sheet-row-label' });
      row.createSpan({ text: spell.reason, cls: 'guided-character-sheet__sheet-subtitle' });
      renderSheetValue(row, `${spell.name} source`, spell.source, (source) => source.sourcePath);
    }
  }
  renderWarnings(section, [...warnings, ...spells.warnings]);
}

function recoveryLabel(period: string): string { return ({ lr: 'long rest', sr: 'short rest', day: 'day' } as Record<string, string>)[period] ?? period; }

function renderSpellRows(root: HTMLElement, heading: string, rows: SpellSheetRow[], onToggleSpellPreparation?: (source: FoundrySourceReference, prepared: boolean) => void, prepHeader = 'Prep'): void {
  const subsection = createSubsection(root, heading);
  if (rows.length === 0) { subsection.createDiv({ text: 'None', cls: 'guided-character-sheet__empty-state' }); return; }
  const prepColumnApplies = rows.some(spellPreparationApplies);
  if (prepColumnApplies) {
    const columnHeadings = subsection.createDiv({ cls: 'guided-character-sheet__spell-column-headings' });
    columnHeadings.createSpan({ text: prepHeader, cls: 'guided-character-sheet__spell-prep-heading' });
    columnHeadings.createSpan({ text: 'Spell', cls: 'guided-character-sheet__visually-hidden' });
  }
  for (const spell of rows) {
    const row = subsection.createDiv({ cls: 'guided-character-sheet__spell-row' });
    const primary = row.createDiv({ cls: `guided-character-sheet__spell-primary${prepColumnApplies ? '' : ' guided-character-sheet__spell-primary--without-prep'}` });
    if (prepColumnApplies) {
      const prep = primary.createDiv({ cls: 'guided-character-sheet__spell-prep' });
      if (spellPreparationApplies(spell)) renderSpellPreparation(prep, spell, onToggleSpellPreparation);
      else prep.createSpan({ cls: 'guided-character-sheet__spell-prep-spacer', attr: { 'aria-hidden': 'true' } });
    }
    primary.createSpan({ text: spell.name, cls: 'guided-character-sheet__sheet-row-label' });
    const metadata = row.createDiv({ cls: 'guided-character-sheet__spell-details guided-character-sheet__sheet-subtitle' });
    if (spell.ownership.length > 0) metadata.createSpan({ text: spell.ownership.map((value) => humanize(value.replace(/-/g, ' '))).join(', ') });
    if (spell.source.kind === 'available') {
      const details = spellDetails(spell.source.value);
      if (details.length > 0) metadata.createSpan({ text: details.join(' · ') });
      if (spell.source.value.description?.trim()) {
        const disclosure = row.createEl('details', { cls: 'guided-character-sheet__spell-description' });
        disclosure.createEl('summary', { text: 'Description' });
        disclosure.createDiv({ text: spell.source.value.description.trim() });
      }
    } else renderSheetValue(metadata, `${spell.name} source`, spell.source, () => '');
  }
}

function renderSpellPreparation(root: HTMLElement, spell: SpellSheetRow, onToggle?: (source: FoundrySourceReference, prepared: boolean) => void): void {
  const source = spell.source.kind === 'available' ? spell.source.value : undefined;
  const checked = spell.prepared.kind === 'available' && spell.prepared.value;
  const reason = spell.preparationBlockedReason ?? (spell.prepared.kind === 'missing' ? spell.prepared.reason : source === undefined ? 'Spell source is unavailable.' : undefined);
  const enabled = source !== undefined && onToggle !== undefined && (reason === undefined || checked);
  const input = root.createEl('input', { attr: { type: 'checkbox', 'aria-label': enabled ? `${spell.name} prepared` : `${spell.name} prepared: ${reason ?? 'Preparation is unavailable.'}` } });
  input.checked = checked;
  input.disabled = !enabled;
  if (enabled && source !== undefined && onToggle !== undefined) input.addEventListener('change', () => onToggle(source, input.checked));
}

function spellPreparationApplies(spell: SpellSheetRow): boolean {
  if (spell.level === 0) return false;
  if (spell.grantPreparation === 'always') return false;
  return spell.source.kind !== 'available' || spell.source.value.preparation !== 'always';
}

function renderSpellFact<T>(root: HTMLElement, label: string, value: SheetValue<T>, format: (value: T) => string): void {
  const fact = root.createDiv({ cls: 'guided-character-sheet__spell-fact' });
  fact.createSpan({ text: label, cls: 'guided-character-sheet__sheet-subtitle' });
  renderSheetValue(fact, label, value, format);
}

function spellAbilityLabel(value: string): string {
  return ({ strength: 'STR', str: 'STR', dexterity: 'DEX', dex: 'DEX', constitution: 'CON', con: 'CON', intelligence: 'INT', int: 'INT', wisdom: 'WIS', wis: 'WIS', charisma: 'CHA', cha: 'CHA' } as Record<string, string | undefined>)[value.toLowerCase()] ?? value.toUpperCase();
}

function spellDetails(source: Extract<SpellSheetRow['source'], { kind: 'available' }>['value']): string[] {
  const details: string[] = [];
  if (source.activation !== undefined) {
    const type = source.activation.type.toLowerCase();
    const label = type === 'bonus' ? 'bonus action' : type === 'reaction' ? 'reaction' : type || 'action';
    details.push(`${source.activation.value ?? 1} ${label}`);
  }
  if (source.range !== undefined) {
    if (source.range.value !== undefined) details.push(`${source.range.value}${source.range.units === undefined ? '' : ` ${source.range.units}`}`);
    else if (source.range.special) details.push(source.range.special);
  }
  for (const property of source.properties ?? []) if (property === 'concentration' || property === 'ritual') details.push(humanize(property));
  return details;
}

function renderFeatures(root: HTMLElement, features: CharacterSheetProjection['features'], warnings: string[]): void {
  const section = createSection(root, 'Features and traits');
  if (features === undefined) { renderMissing(section, 'Features', 'Feature sources are unavailable.'); renderWarnings(section, warnings); return; }
  for (const group of features.groups) {
    const groupRoot = createSubsection(section, group.label);
    if (group.entries.length === 0) { groupRoot.createDiv({ text: 'None', cls: 'guided-character-sheet__empty-state' }); continue; }
    for (const entry of group.entries) {
      const row = groupRoot.createDiv({ cls: 'guided-character-sheet__feature-row' });
      row.createEl('h4', { text: entry.name });
      row.createSpan({ text: entry.origins.join(', '), cls: 'guided-character-sheet__sheet-subtitle' });
      renderSheetValue(row, `${entry.name} description`, entry.description, String);
      for (const diagnostic of entry.diagnostics) row.createDiv({ text: diagnostic, cls: 'guided-character-sheet__warning' });
    }
  }
  renderWarnings(section, [...features.warnings, ...warnings]);
}

function renderActions(root: HTMLElement, actions: CharacterSheetProjection['actions'], warnings: string[], onToggleResource?: (key: string, spent: boolean) => void): void {
  const section = createSection(root, 'Actions');
  if (actions === undefined) { renderMissing(section, 'Actions', 'Action sources are unavailable.'); renderWarnings(section, warnings); return; }
  for (const group of actions.groups) {
    const groupRoot = createSubsection(section, group.label);
    if (group.entries.length === 0) { groupRoot.createDiv({ text: 'None', cls: 'guided-character-sheet__empty-state' }); continue; }
    for (const entry of group.entries) {
      const row = groupRoot.createDiv({ cls: 'guided-character-sheet__action-row' });
      row.createSpan({ text: entry.name, cls: 'guided-character-sheet__sheet-row-label' });
      const recovery = entry.resource?.reset.kind === 'available' ? entry.resource.reset.value : undefined;
      const context = [entry.weaponProperties?.join(', '), entry.weaponMastery === undefined ? undefined : `Mastery: ${entry.weaponMastery}`, entry.source !== entry.name ? entry.source : undefined, entry.activation === undefined ? undefined : humanize(entry.activation), recovery === undefined ? undefined : humanize(recovery.replace(/-/g, ' '))].filter((value): value is string => value !== undefined && value.length > 0);
      if (context.length > 0) row.createSpan({ text: context.join(' · '), cls: 'guided-character-sheet__sheet-subtitle' });
      const factKind = entry.factKind ?? (entry.save !== undefined ? 'save' : entry.attackBonus.kind === 'available' ? 'attack' : entry.damage === undefined ? undefined : 'damage');
      if (factKind !== undefined) {
        const details = row.createDiv({ cls: 'guided-character-sheet__action-details' });
        if (factKind === 'attack') {
          renderActionFact(details, 'Range', entry.range === undefined ? { kind: 'missing', reason: 'Action range is unavailable.' } : { kind: 'available', value: entry.range }, String, `${entry.name} range`);
          renderActionFact(details, 'To hit / DC', entry.attackBonus, formatModifier, `${entry.name} to hit or DC`);
          renderActionFact(details, 'Damage', entry.damage === undefined ? { kind: 'missing', reason: 'Action damage is unavailable.' } : { kind: 'available', value: entry.damage }, String, `${entry.name} damage`);
        } else if (factKind === 'save') {
          if (entry.range !== undefined) renderActionFact(details, 'Range', { kind: 'available', value: entry.range }, String, `${entry.name} range`);
          const saveLabel = entry.saveAbility === undefined ? '' : ` (${spellAbilityLabel(entry.saveAbility)} save)`;
          renderActionFact(details, 'To hit / DC', entry.saveDc ?? { kind: 'missing', reason: 'Saving throw DC is unavailable.' }, (value) => `DC ${value}${entry.saveAbility === undefined ? '' : ` ${spellAbilityLabel(entry.saveAbility)}`}`, `${entry.name} to hit or DC${saveLabel}`);
          if (entry.damage !== undefined) renderActionFact(details, 'Damage', { kind: 'available', value: entry.damage }, String, `${entry.name} damage`);
        } else {
          if (entry.range !== undefined) renderActionFact(details, 'Range', { kind: 'available', value: entry.range }, String, `${entry.name} range`);
          if (entry.damage !== undefined) renderActionFact(details, 'Damage', { kind: 'available', value: entry.damage }, String, `${entry.name} damage`);
        }
      }
      if (entry.description !== undefined) row.createDiv({ text: entry.description, cls: 'guided-character-sheet__action-description' });
      if (entry.resource !== undefined) {
        const resourceDetails = row.createDiv({ cls: 'guided-character-sheet__action-usage' });
        if (entry.resource.current.kind === 'available' && entry.resource.maximum.kind === 'available' && typeof entry.resource.maximum.value === 'number') {
          for (let index = 0; index < entry.resource.maximum.value; index += 1) renderUsageCheckbox(resourceDetails, `${entry.name} use ${index + 1}`, index < entry.resource.maximum.value - entry.resource.current.value, entry.resource.current, onToggleResource === undefined || entry.resourceKey === undefined ? undefined : (spent) => onToggleResource(entry.resourceKey!, spent));
        }
      }
      for (const diagnostic of entry.diagnostics) row.createDiv({ text: diagnostic, cls: 'guided-character-sheet__warning' });
    }
  }
  if (actions.combatReference.length > 0) {
    const reference = createSubsection(section, 'Combat actions');
    reference.createDiv({ text: actions.combatReference.join(', '), cls: 'guided-character-sheet__combat-reference' });
  }
  if (actions.weaponReferences && actions.weaponReferences.length > 0) {
    const reference = createSubsection(section, 'Weapon properties and masteries');
    for (const rule of actions.weaponReferences) {
      const row = reference.createDiv({ cls: 'guided-character-sheet__action-row' });
      row.createSpan({ text: rule.name, cls: 'guided-character-sheet__sheet-row-label' });
      row.createDiv({ text: rule.description ?? 'Source description is unavailable.', cls: 'guided-character-sheet__action-description' });
    }
  }
  renderWarnings(section, [...actions.warnings, ...warnings]);
}

function renderActionFact<T>(root: HTMLElement, label: string, value: SheetValue<T>, format: (value: T) => string, accessibleLabel: string): void {
  const fact = root.createDiv({ cls: 'guided-character-sheet__action-fact' });
  fact.createSpan({ text: label, cls: 'guided-character-sheet__sheet-subtitle' });
  renderSheetValue(fact, accessibleLabel, value, format);
}

function renderBackground(root: HTMLElement, background: CharacterSheetProjection['backgroundDetails'], warnings: string[]): void {
  const section = createSection(root, 'Background');
  if (background === undefined) { renderMissing(section, 'Background', 'Background source is unavailable.'); renderWarnings(section, warnings); return; }
  if (background.source.kind === 'available') section.createEl('h4', { text: background.source.value.name });
  renderBackgroundFact(section, 'Description', background.sourceFacts.description, String);
  const biography = createSubsection(section, 'Biography');
  biography.createDiv({ text: 'Biography is not yet provided or stored.', cls: 'guided-character-sheet__coming-soon' });
  renderWarnings(section, [...background.warnings, ...warnings]);
}

function renderBackgroundFact<T>(root: HTMLElement, label: string, value: SheetValue<T>, format: (value: T) => string): void {
  const row = root.createDiv({ cls: 'guided-character-sheet__background-fact', attr: value.kind === 'missing' ? { title: value.reason } : {} });
  row.createSpan({ text: label, cls: 'guided-character-sheet__sheet-subtitle', attr: { 'aria-hidden': 'true' } });
  renderSheetValue(row, label, value, format);
}

function renderUsageCheckbox(root: HTMLElement, label: string, spent: boolean, unavailable: SheetValue<number>, onToggle?: (spent: boolean) => void): void {
  const input = root.createEl('input', { attr: { type: 'checkbox', 'aria-label': unavailable.kind === 'missing' ? `${label}: ${unavailable.reason}` : label } });
  input.checked = spent;
  input.disabled = unavailable.kind === 'missing' || onToggle === undefined;
  if (onToggle !== undefined && unavailable.kind === 'available') input.addEventListener('change', () => onToggle(input.checked));
}

function renderMissing(root: HTMLElement, label: string, reason: string): void { renderSheetValue(root, label, { kind: 'missing', reason }, () => ''); }
function renderWarnings(root: HTMLElement, warnings: string[]): void { for (const warning of [...new Set(warnings)]) root.createDiv({ text: warning, cls: 'guided-character-sheet__warning' }); }
function createSubsection(root: HTMLElement, heading: string, decorateHeading?: (heading: HTMLElement) => void): HTMLElement { const section = root.createDiv({ cls: 'guided-character-sheet__sheet-subsection' }); const headingRow = section.createDiv({ cls: 'guided-character-sheet__subsection-heading' }); headingRow.createEl('h4', { text: heading }); decorateHeading?.(headingRow); return section; }
function ordinal(value: number): string { return value === 1 ? '1st' : value === 2 ? '2nd' : value === 3 ? '3rd' : `${value}th`; }
function humanize(value: string): string { const normalized = value.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`).replace(/^./, (letter) => letter.toUpperCase()); return normalized; }
function formatCurrency(currency: { cp: number; sp: number; ep: number; gp: number; pp: number }): string {
  const values = CURRENCY_DENOMINATIONS.filter((denomination) => currency[denomination] !== 0).map((denomination) => `${currency[denomination]} ${denomination.toUpperCase()}`);
  return values.length === 0 ? 'No currency' : values.join(', ');
}

function createSection(root: HTMLElement, heading: string, action?: { label: string; onClick?: () => void }): HTMLElement {
  const section = root.createEl('section', { cls: 'guided-character-sheet__sheet-section' });
  const headingRow = section.createDiv({ cls: 'guided-character-sheet__section-heading' });
  headingRow.createEl('h3', { text: heading });
  if (action !== undefined) {
    const button = headingRow.createEl('button', { text: action.label, attr: { type: 'button', 'aria-label': action.label } });
    button.disabled = action.onClick === undefined;
    if (action.onClick !== undefined) button.addEventListener('click', action.onClick);
  }
  return section;
}

function renderProficiency(root: HTMLElement, label: string, value: SheetValue<boolean>): void {
  if (value.kind === 'missing') {
    renderSheetValue(root, `${label} proficiency`, value, () => '');
    return;
  }
  root.createSpan({
    text: value.value ? '●' : '○',
    cls: 'guided-character-sheet__proficiency-marker',
    attr: { 'aria-label': `${label}: ${value.value ? 'Proficient' : 'Not proficient'}` },
  });
}

function renderSkillTraining(root: HTMLElement, skill: CharacterSheetProjection['skills'][number]): void {
  if (skill.training?.kind === 'available') {
    const label = skill.training.value === 2 ? 'Expertise' : skill.training.value === 1 ? 'Proficient' : 'Not proficient';
    const marker = skill.training.value === 2 ? '★' : skill.training.value === 1 ? '●' : '○';
    root.createSpan({ text: marker, cls: 'guided-character-sheet__proficiency-marker', attr: { 'aria-label': `${skill.label}: ${label}` } });
    return;
  }
  renderProficiency(root, skill.label, skill.proficient);
}

function renderSheetValue<T>(root: HTMLElement, label: string, value: SheetValue<T>, format: (value: T) => string): void {
  if (value.kind === 'available') {
    const text = format(value.value);
    const valueElement = root.createSpan({ cls: 'guided-character-sheet__sheet-value' });
    valueElement.createSpan({ text: `${label}: ${text}`, cls: 'guided-character-sheet__visually-hidden' });
    valueElement.createSpan({ text, attr: { 'aria-hidden': 'true' } });
    return;
  }
  const valueElement = root.createSpan({ cls: 'guided-character-sheet__sheet-value guided-character-sheet__missing-value' });
  valueElement.createSpan({ text: `${label}: ${value.reason}`, cls: 'guided-character-sheet__visually-hidden' });
  valueElement.createSpan({ text: '—', attr: { 'aria-hidden': 'true' } });
}

function identitySummary(sheet: CharacterSheetProjection): string {
  const species = displayValue(sheet.identity.species);
  const size = sheet.identity.size === undefined ? undefined : displayValue(sheet.identity.size);
  const creatureType = displayValue(sheet.identity.creatureType);
  const className = displayValue(sheet.identity.className);
  const level = sheet.identity.level.kind === 'available' ? `Level ${sheet.identity.level.value}` : 'Level —';
  const background = displayValue(sheet.identity.background);
  return `${species}${size === undefined ? '' : ` (${size})`}${creatureType === '—' ? '' : ` · ${creatureType}`} · ${className} ${level} · ${background}`;
}

function identityAccessibilityLabel(sheet: CharacterSheetProjection): string {
  return `Character details: ${[
    accessibleIdentityValue('Species', sheet.identity.species),
    ...(sheet.identity.size === undefined ? [] : [accessibleIdentityValue('Size', sheet.identity.size)]),
    accessibleIdentityValue('Creature type', sheet.identity.creatureType),
    accessibleIdentityValue('Class', sheet.identity.className),
    accessibleIdentityValue('Level', sheet.identity.level),
    accessibleIdentityValue('Background', sheet.identity.background),
  ].join(' ')}`;
}

function accessibleIdentityValue<T>(label: string, value: SheetValue<T>): string {
  const text = value.kind === 'available' ? String(value.value) : value.reason;
  return `${label}: ${text.replace(/\.+$/, '')}.`;
}

function displayValue(value: SheetValue<string>): string { return value.kind === 'available' ? value.value : '—'; }
function formatModifier(value: number): string { return `${value >= 0 ? '+' : ''}${value}`; }
