import type { FoundrySourceReference } from './foundry-source-catalog';

export type SpellListId = string;
export type SpellChoiceSelection = string | FoundrySourceReference;
export type PersistedSpellChoiceSelection =
  | { key: string; advancementId: string; kind: 'spell-list'; selected: string[] }
  | { key: string; advancementId: string; kind: 'spell'; selected: FoundrySourceReference[]; selectedAbility?: string };

export interface SpellChoiceOption {
  value: string;
  source: FoundrySourceReference;
  label: string;
  description?: string;
}

export interface SpellChoiceParent {
  key: string;
  values: string[];
}

export interface SpellChoice {
  key: string;
  advancementId: string;
  label: string;
  count: number;
  level: number;
  spellLists: SpellListId[];
  selected: SpellChoiceSelection[];
  abilityOptions: string[];
  selectedAbility?: string;
  parent?: SpellChoiceParent;
  options: SpellChoiceOption[];
  raw: Record<string, unknown>;
}

export function isSpellChoiceAvailable(choice: SpellChoice, choices: SpellChoice[]): boolean {
  if (choice.parent === undefined) return true;
  const parent = choices.find((candidate) => candidate.key === choice.parent?.key);
  return parent !== undefined && choice.parent.values.every((value) => parent.selected.some((selection) => selectionMatchesValue(selection, value)));
}

export function setSpellChoice(choices: SpellChoice[], key: string, values: SpellChoiceSelection[]): SpellChoice[] {
  const choice = choices.find((candidate) => candidate.key === key);
  if (choice === undefined) throw new Error(`Unknown spell choice: ${key}`);
  if (!isSpellChoiceAvailable(choice, choices)) throw new Error(`Spell choice is unavailable: ${key}`);
  assertSelectionShape(choice, values);

  const changed = choices.map((candidate) => candidate.key === key ? { ...cloneChoice(candidate), selected: cloneSelections(values) } : cloneChoice(candidate));
  return clearInvalidChoices(changed);
}

export function setSpellcastingAbility(choices: SpellChoice[], key: string, ability: string): SpellChoice[] {
  const choice = choices.find((candidate) => candidate.key === key);
  if (choice === undefined) throw new Error(`Unknown spell choice: ${key}`);
  if (!isSpellChoiceAvailable(choice, choices)) throw new Error(`Spell choice is unavailable: ${key}`);
  if (!choice.abilityOptions.includes(ability)) throw new Error(`Invalid spellcasting ability for ${key}: ${ability}`);
  return choices.map((candidate) => candidate.key === key ? { ...cloneChoice(candidate), selectedAbility: ability } : cloneChoice(candidate));
}

export function validateSpellChoices(choices: SpellChoice[]): string[] {
  const errors: string[] = [];
  for (const choice of choices) {
    if (!isSpellChoiceAvailable(choice, choices)) continue;
    if (new Set(choice.selected.map(selectionKey)).size !== choice.selected.length) errors.push(`Choice "${choice.key}" contains duplicate spells`);
    if (choice.selected.length > choice.count) errors.push(`Choice "${choice.key}" exceeds its count of ${choice.count}`);
    else if (choice.selected.length < choice.count) errors.push(`Choice "${choice.key}" requires ${choice.count} spell${choice.count === 1 ? '' : 's'}`);

    for (const selected of choice.selected) {
      const option = authoritativeOption(choice, selected);
      if (option === undefined) errors.push(`Choice "${choice.key}" contains a spell without an authoritative option`);
      if (isListSelectorChoice(choice) && typeof selected !== 'string') errors.push(`Choice "${choice.key}" contains a non-list selector value`);
      if (!isListSelectorChoice(choice) && typeof selected === 'string') errors.push(`Choice "${choice.key}" contains a non-authoritative spell selector value`);
      const metadata = option === undefined ? {} : spellMetadata(option.source);
      if (!isListSelectorChoice(choice) && metadata.level !== undefined && metadata.level !== choice.level) errors.push(`Choice "${choice.key}" contains a spell from the wrong level`);
      if (!isListSelectorChoice(choice) && choice.spellLists.length > 0 && metadata.spellLists !== undefined && !metadata.spellLists.some((list) => choice.spellLists.includes(list))) errors.push(`Choice "${choice.key}" contains a spell outside the allowed spell list`);
    }

    if (choice.abilityOptions.length > 0) {
      if (choice.selectedAbility === undefined) errors.push(`Choice "${choice.key}" requires a spellcasting ability`);
      else if (!choice.abilityOptions.includes(choice.selectedAbility)) errors.push(`Choice "${choice.key}" contains an invalid spellcasting ability`);
    } else if (choice.selectedAbility !== undefined) {
      errors.push(`Choice "${choice.key}" contains an invalid spellcasting ability`);
    }
  }
  return errors;
}

function assertSelectionShape(choice: SpellChoice, values: SpellChoiceSelection[]): void {
  if (new Set(values.map(selectionKey)).size !== values.length || values.length > choice.count) throw new Error(`Invalid spell choice cardinality: ${choice.key}`);
  if (values.some((value) => typeof value === 'string' && !isListSelectorChoice(choice))) throw new Error(`Invalid spell choice value: ${keyForAuthoritativeOption(choice)}`);
  if (values.some((value) => typeof value !== 'string' && isListSelectorChoice(choice))) throw new Error(`Invalid spell list selector value: ${keyForAuthoritativeOption(choice)}`);
  if (values.some((value) => authoritativeOption(choice, value) === undefined)) throw new Error(`Invalid spell choice value without an authoritative option: ${keyForAuthoritativeOption(choice)}`);
}

function hasValidSelectedOptions(choice: SpellChoice): boolean {
  if (choice.selected.length > choice.count || new Set(choice.selected.map(selectionKey)).size !== choice.selected.length) return false;
  if (choice.selected.some((value) => (typeof value === 'string' && !isListSelectorChoice(choice)) || (typeof value !== 'string' && isListSelectorChoice(choice)) || authoritativeOption(choice, value) === undefined)) return false;
  return choice.selected.every((selection) => {
    const option = authoritativeOption(choice, selection);
    if (option === undefined || isListSelectorChoice(choice)) return true;
    const metadata = spellMetadata(option.source);
    return (metadata.level === undefined || metadata.level === choice.level) && (choice.spellLists.length === 0 || metadata.spellLists === undefined || metadata.spellLists.some((list) => choice.spellLists.includes(list)));
  });
}

function clearInvalidChoices(choices: SpellChoice[]): SpellChoice[] {
  let current = choices;
  while (true) {
    let cleared = false;
    const next = current.map((choice) => {
      if ((isSpellChoiceAvailable(choice, current) && hasValidSelectedOptions(choice)) || (choice.selected.length === 0 && choice.selectedAbility === undefined)) return choice;
      cleared = true;
      return { ...choice, selected: [], selectedAbility: undefined };
    });
    if (!cleared) return current;
    current = next;
  }
}

function selectionValue(selection: SpellChoiceSelection): string {
  return typeof selection === 'string' ? selection : `${selection.pack}:${selection.type}:${selection.id}`;
}

function selectionMatchesValue(selection: SpellChoiceSelection, value: string): boolean {
  return typeof selection === 'string' ? selection === value : selection.id === value || selection.identifier === value || selectionValue(selection) === value;
}

function selectionKey(selection: SpellChoiceSelection): string {
  return typeof selection === 'string' ? `value:${selection}` : `source:${selection.sourcePath}:${selection.pack}:${selection.type}:${selection.id}`;
}

function sameReference(source: FoundrySourceReference, selection: SpellChoiceSelection): boolean {
  return typeof selection !== 'string' && source.sourcePath === selection.sourcePath && source.pack === selection.pack && source.type === selection.type && source.id === selection.id;
}

function authoritativeOption(choice: SpellChoice, selection: SpellChoiceSelection): SpellChoiceOption | undefined {
  if (choice.options.length === 0) return undefined;
  return choice.options.find((option) => option.value === selectionValue(selection) || sameReference(option.source, selection));
}

function isListSelectorChoice(choice: SpellChoice): boolean {
  const rawConfiguration = isRecord(choice.raw.configuration) ? choice.raw.configuration : undefined;
  return choice.raw.type === 'spell-list' || choice.raw.selectorType === 'spell-list' || rawConfiguration?.type === 'spell-list';
}

function keyForAuthoritativeOption(choice: SpellChoice): string {
  return choice.key;
}

interface SpellMetadata {
  level?: number;
  spellLists?: string[];
}

function spellMetadata(selection: SpellChoiceSelection): SpellMetadata {
  if (typeof selection === 'string' || !isRecord(selection)) return {};
  const level = typeof selection.level === 'number' && Number.isInteger(selection.level) ? selection.level : undefined;
  const spellLists = Array.isArray(selection.spellLists) ? selection.spellLists.filter((value): value is string => typeof value === 'string') : undefined;
  return { ...(level === undefined ? {} : { level }), ...(spellLists === undefined ? {} : { spellLists }) };
}

function cloneSelections(values: SpellChoiceSelection[]): SpellChoiceSelection[] {
  return values.map((value) => typeof value === 'string' ? value : { ...value });
}

function cloneChoice(choice: SpellChoice): SpellChoice {
  return {
    ...choice,
    spellLists: [...choice.spellLists],
    selected: cloneSelections(choice.selected),
    abilityOptions: [...choice.abilityOptions],
    ...(choice.parent === undefined ? {} : { parent: { ...choice.parent, values: [...choice.parent.values] } }),
    options: choice.options.map((option) => ({ ...option, source: { ...option.source } })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
