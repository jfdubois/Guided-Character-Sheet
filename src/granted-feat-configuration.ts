import type { GrantedFeatAdvancementSummary, GrantedFeatSourceSummary } from './character-sources';
import type { FoundrySourceReference } from './foundry-source-catalog';
import { setSpellChoice, setSpellcastingAbility, validateSpellChoices, type PersistedSpellChoiceSelection, type SpellChoice, type SpellChoiceOption, type SpellChoiceSelection } from './spell-configuration';

export interface GrantedFeatSelection { feat: FoundrySourceReference; spellChoices: PersistedSpellChoiceSelection[]; }
export type GrantedFeatConfiguration = { kind: 'none' } | { kind: 'unsupported'; feat?: FoundrySourceReference; reason: string } | GrantedFeatChoiceConfiguration;
export interface GrantedFeatChoiceConfiguration { kind: 'choice'; feat: FoundrySourceReference; spellChoices: SpellChoice[]; diagnostics: string[]; }

export function buildGrantedFeatConfiguration(source: GrantedFeatSourceSummary | undefined): GrantedFeatConfiguration {
  if (source === undefined || source.advancements.length === 0) return { kind: 'none' };
  const advancements = source.advancements;
  if (advancements.some((entry) => entry.type !== 'ItemChoice')) return unsupported(source, 'Required granted feat advancement is not a structured ItemChoice');
  const spells = advancements.filter(isSpellAdvancement);
  if (spells.length !== advancements.length) return unsupported(source, 'Required granted feat advancement is not a structured spell choice');
  const first = spells[0]!;
  if (first.spellLevel === undefined || first.spellLists === undefined || first.abilityOptions === undefined || first.spellLists.length === 0 || first.abilityOptions.length === 0) return unsupported(source, 'Granted feat spell choice is missing structured restrictions');
  const lists = normalize(first.spellLists);
  const abilities = normalize(first.abilityOptions);
  const choices: SpellChoice[] = [{ key: featKey(source.source, `spell-list:${lists.join('|')}`), advancementId: 'spell-list', label: 'Spell list', count: 1, level: 0, spellLists: lists, selected: [], abilityOptions: [], options: lists.map((list) => ({ value: list, source: { ...source.source, id: list, type: 'spell-list', name: list }, label: list })), raw: { type: 'spell-list', configuration: { type: 'spell-list' } } }];
  for (const advancement of spells) {
    if (advancement.spellLevel === undefined || advancement.spellLists === undefined || advancement.abilityOptions === undefined || advancement.spellLists.length === 0 || advancement.abilityOptions.length === 0) return unsupported(source, `Granted feat advancement ${advancement.id} is missing structured restrictions`);
    if (normalize(advancement.spellLists).join('|') !== lists.join('|') || normalize(advancement.abilityOptions).join('|') !== abilities.join('|')) return unsupported(source, 'Granted feat spell choices do not share normalized restrictions');
    const count = choiceCount(advancement);
    if (count === undefined) return unsupported(source, `Granted feat advancement ${advancement.id} is missing a choice count`);
    const spellDependencies = advancement.dependencies.filter((dependency) => dependency.source !== undefined && dependency.source !== null && dependency.source.type.toLowerCase() === 'spell');
    if (spellDependencies.some((dependency) => dependency.source === undefined || dependency.source === null || !hasRequiredSpellMetadata(dependency.source))) return unsupported(source, `Granted feat advancement ${advancement.id} has spell options without required level/list metadata`);
    const options = spellDependencies.flatMap((dependency): SpellChoiceOption[] => dependency.source === undefined || dependency.source === null ? [] : [{ value: referenceValue(dependency.source), source: { ...dependency.source }, label: dependency.source.name, ...(dependency.description === undefined ? {} : { description: dependency.description }) }]);
    if (options.length === 0) return unsupported(source, `Granted feat advancement ${advancement.id} has no authoritative spell options`);
    choices.push({ key: featKey(source.source, advancement.id), advancementId: advancement.id, label: advancement.title || advancement.type, count, level: advancement.spellLevel, spellLists: lists, selected: [], abilityOptions: abilities, parent: { key: choices[0]!.key, values: [] }, options, raw: advancement.raw });
  }
  return { kind: 'choice', feat: { ...source.source }, spellChoices: choices, diagnostics: [] };
}

export function getAvailableGrantedFeatSpellChoices(configuration: GrantedFeatChoiceConfiguration): SpellChoice[] {
  const list = configuration.spellChoices[0];
  const selected = list?.selected.length === 1 && typeof list.selected[0] === 'string' ? list.selected[0] : undefined;
  if (selected === undefined) return list === undefined ? [] : [clone(list)];
  return configuration.spellChoices.map((choice, index) => index === 0 ? clone(choice) : { ...clone(choice), spellLists: [selected], options: choice.options.filter((option) => optionSourceLists(option.source).includes(selected)) });
}

export function setGrantedFeatSpellChoice(configuration: GrantedFeatChoiceConfiguration, key: string, values: SpellChoiceSelection[]): GrantedFeatChoiceConfiguration {
  const available = getAvailableGrantedFeatSpellChoices(configuration);
  if (!available.some((choice) => choice.key === key)) throw new Error(`Spell choice is unavailable: ${key}`);
  const target = available.find((choice) => choice.key === key)!;
  const targetErrors = validateSpellChoices([{ ...target, parent: undefined, selected: values }]).filter((error) => /without an authoritative option|wrong level|outside the allowed spell list/.test(error));
  if (targetErrors.length > 0) throw new Error(targetErrors[0]);
  if (!isListSelector(target)) {
    for (const value of values) {
      if (typeof value === 'string') continue;
      const metadata = spellMetadata(value);
      if (metadata.level !== undefined && metadata.level !== target.level) throw new Error(`Choice "${target.key}" contains a spell from the wrong level`);
      if (metadata.spellLists !== undefined && metadata.spellLists.length > 0 && !metadata.spellLists.some((list) => target.spellLists.includes(list))) throw new Error(`Choice "${target.key}" contains a spell outside the allowed spell list`);
    }
  }
  const changed = setSpellChoice(available.map((choice) => ({ ...choice, parent: undefined })), key, values);
  const changedByKey = new Map(changed.map((choice) => [choice.key, choice]));
  const next = { ...configuration, spellChoices: configuration.spellChoices.map((choice) => changedByKey.has(choice.key) ? { ...clone(choice), selected: cloneSelections(changedByKey.get(choice.key)!.selected), selectedAbility: changedByKey.get(choice.key)!.selectedAbility } : clone(choice)) };
  const selectedList = next.spellChoices[0]?.selected[0];
  if (key === next.spellChoices[0]?.key && typeof selectedList === 'string') return { ...next, spellChoices: next.spellChoices.map((choice, index) => index === 0 ? choice : { ...choice, selected: choice.selected.filter((selection) => { if (typeof selection === 'string') return false; const option = choice.options.find((candidate) => candidate.source.id === selection.id); return option !== undefined && optionSourceLists(option.source).includes(selectedList); }), selectedAbility: choice.selected.length === 0 ? undefined : choice.selectedAbility }) };
  return next;
}

export function setGrantedFeatSpellcastingAbility(configuration: GrantedFeatChoiceConfiguration, ability: string): GrantedFeatChoiceConfiguration {
  const available = getAvailableGrantedFeatSpellChoices(configuration).filter((choice) => choice.key !== configuration.spellChoices[0]?.key);
  if (available.length === 0) return configuration;
  const changed = setSpellcastingAbility(available.map((choice) => ({ ...choice, parent: undefined })), available[0]!.key, ability);
  if (!available.every((choice) => choice.abilityOptions.includes(ability))) throw new Error(`Invalid spellcasting ability: ${ability}`);
  return { ...configuration, spellChoices: configuration.spellChoices.map((choice) => choice.key === configuration.spellChoices[0]?.key ? clone(choice) : { ...clone(choice), selectedAbility: changed.find((entry) => entry.key === choice.key)?.selectedAbility ?? ability }) };
}

export function toGrantedFeatSelection(configuration: GrantedFeatChoiceConfiguration): GrantedFeatSelection { return { feat: { ...configuration.feat }, spellChoices: configuration.spellChoices.map(toPersisted) }; }

export function restoreGrantedFeatConfiguration(configuration: GrantedFeatConfiguration, selection: GrantedFeatSelection | undefined): GrantedFeatConfiguration {
  if (configuration.kind !== 'choice' || selection === undefined) return configuration;
  if (!sameReference(configuration.feat, selection.feat)) return { kind: 'unsupported', feat: { ...selection.feat }, reason: 'Granted feat source is stale' };
  const stale = selection.spellChoices.some((saved) => { const current = configuration.spellChoices.find((choice) => choice.key === saved.key); return current === undefined || current.advancementId !== saved.advancementId || isListSelector(current) !== (saved.kind === 'spell-list'); });
  const diagnostics = stale ? [...configuration.diagnostics, 'A persisted granted feat advancement reference is stale'] : configuration.diagnostics;
  const kindMismatch = selection.spellChoices.some((saved) => { const current = configuration.spellChoices.find((choice) => choice.key === saved.key); return current !== undefined && current.advancementId === saved.advancementId && isListSelector(current) !== (saved.kind === 'spell-list'); });
  if (kindMismatch) diagnostics.push('A persisted granted feat choice kind does not match the current source');
  const restored = { ...configuration, diagnostics, spellChoices: configuration.spellChoices.map((choice) => { const saved = selection.spellChoices.find((entry) => entry.key === choice.key); if (saved === undefined || saved.advancementId !== choice.advancementId || isListSelector(choice) !== (saved.kind === 'spell-list')) return clone(choice); return { ...clone(choice), selected: saved.kind === 'spell-list' ? [...saved.selected] : saved.selected.map((value) => ({ ...value })), ...(saved.kind === 'spell' && saved.selectedAbility !== undefined ? { selectedAbility: saved.selectedAbility } : {}) }; }) };
  return restored;
}

export function validateGrantedFeatConfiguration(configuration: GrantedFeatConfiguration, options: { requireComplete?: boolean } = {}): string[] {
  if (configuration.kind === 'none') return [];
  if (configuration.kind === 'unsupported') return [configuration.reason];
  const errors = [...configuration.diagnostics, ...validateSpellChoices(getAvailableGrantedFeatSpellChoices(configuration).map((choice) => ({ ...choice, parent: undefined })) )];
  for (const choice of configuration.spellChoices) if (choice.advancementId !== 'spell-list' && !configuration.spellChoices.some((entry) => entry.key === choice.key && entry.advancementId === choice.advancementId)) errors.push(`Choice "${choice.key}" has a stale advancement reference`);
  if (options.requireComplete === false) return errors.filter((error) => !/requires \d+ spell|requires a spellcasting ability/.test(error));
  return errors;
}

function isSpellAdvancement(entry: GrantedFeatAdvancementSummary): boolean { return entry.raw.type === 'ItemChoice' && isRecord(entry.raw.configuration) && entry.raw.configuration.type === 'spell'; }
function isListSelector(choice: SpellChoice): boolean { return choice.raw.type === 'spell-list' || (isRecord(choice.raw.configuration) && choice.raw.configuration.type === 'spell-list'); }
function choiceCount(entry: GrantedFeatAdvancementSummary): number | undefined { const c = isRecord(entry.raw.configuration) ? entry.raw.configuration.choices : undefined; if (typeof c === 'number' && Number.isInteger(c) && c > 0) return c; if (Array.isArray(c)) { const first = c[0]; if (isRecord(first) && typeof first.count === 'number' && Number.isInteger(first.count) && first.count > 0) return first.count; } if (isRecord(c) && typeof c.count === 'number' && Number.isInteger(c.count) && c.count > 0) return c.count; if (isRecord(c)) { const first = Object.values(c)[0]; if (isRecord(first) && typeof first.count === 'number' && Number.isInteger(first.count) && first.count > 0) return first.count; } return undefined; }
function featKey(feat: FoundrySourceReference, suffix: string): string { return `feat:${feat.sourcePath}:${feat.pack}:${feat.type}:${feat.id}:${suffix}`; }
function normalize(values: string[]): string[] { return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].sort(); }
function referenceValue(reference: FoundrySourceReference): string { return `${reference.pack}:${reference.type}:${reference.id}`; }
function optionSourceLists(source: FoundrySourceReference): string[] { const value = (source as FoundrySourceReference & { spellLists?: unknown }).spellLists; return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase()) : []; }
function spellMetadata(source: FoundrySourceReference): { level?: number; spellLists?: string[] } { const value = source as FoundrySourceReference & { level?: unknown; spellLists?: unknown }; const level = typeof value.level === 'number' && Number.isInteger(value.level) ? value.level : undefined; const spellLists = Array.isArray(value.spellLists) ? value.spellLists.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase()) : undefined; return { ...(level === undefined ? {} : { level }), ...(spellLists === undefined ? {} : { spellLists }) }; }
function hasRequiredSpellMetadata(source: FoundrySourceReference): boolean { const metadata = spellMetadata(source); return metadata.level !== undefined && metadata.spellLists !== undefined && metadata.spellLists.length > 0; }
function unsupported(source: GrantedFeatSourceSummary, reason: string): GrantedFeatConfiguration { return { kind: 'unsupported', feat: { ...source.source }, reason }; }
function sameReference(a: FoundrySourceReference, b: FoundrySourceReference): boolean { return a.sourcePath === b.sourcePath && a.pack === b.pack && a.type === b.type && a.id === b.id; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function cloneSelections(values: SpellChoiceSelection[]): SpellChoiceSelection[] { return values.map((value) => typeof value === 'string' ? value : { ...value }); }
function clone(choice: SpellChoice): SpellChoice { return { ...choice, spellLists: [...choice.spellLists], selected: cloneSelections(choice.selected), abilityOptions: [...choice.abilityOptions], ...(choice.parent === undefined ? {} : { parent: { ...choice.parent, values: [...choice.parent.values] } }), options: choice.options.map((option) => ({ ...option, source: { ...option.source } })) }; }
function toPersisted(choice: SpellChoice): PersistedSpellChoiceSelection { if (choice.raw.type === 'spell-list' || (isRecord(choice.raw.configuration) && choice.raw.configuration.type === 'spell-list')) return { key: choice.key, advancementId: choice.advancementId, kind: 'spell-list', selected: choice.selected.filter((entry): entry is string => typeof entry === 'string') }; return { key: choice.key, advancementId: choice.advancementId, kind: 'spell', selected: choice.selected.filter((entry): entry is FoundrySourceReference => typeof entry !== 'string').map((entry) => ({ ...entry })), ...(choice.selectedAbility === undefined ? {} : { selectedAbility: choice.selectedAbility }) }; }
