import type { CharacterOriginReference, CharacterFoundryReference } from './character-model';
import type { SourceSnapshot } from './source-tree';
import type { SpeciesSourceSummary } from './character-sources';
import { isRecord, stringValues } from './foundry-utils';
import { languageSelectorOptions, type FoundrySourceReference } from './foundry-source-catalog';
import { setSpellChoice, setSpellcastingAbility, validateSpellChoices, type PersistedSpellChoiceSelection, type SpellChoice, type SpellChoiceOption, type SpellChoiceSelection } from './spell-configuration';

export interface SpeciesRecordReference {
  id: string;
  type: string;
  name?: string;
}

export interface SpeciesGrant {
  key: string;
  level: number;
  label: string;
  source: SpeciesRecordReference;
  raw: Record<string, unknown>;
}

export interface SpeciesChoiceOption {
  value: string;
  label: string;
  source: SpeciesRecordReference;
  description?: string;
  damageTypes?: string[];
}

export interface SpeciesChoice {
  key: string;
  level: number;
  label: string;
  count: number;
  source: SpeciesRecordReference;
  options: SpeciesChoiceOption[];
  selected: string[];
  requiresChoice?: { key: string; value: string };
  raw: Record<string, unknown>;
}
export interface SpeciesSpellGrant {
  advancementId: string;
  level: number;
  spells: FoundrySourceReference[];
  abilityOptions: string[];
  preparation?: string;
  uses?: { max?: string | number; per?: string; requireSlot?: boolean };
  raw: Record<string, unknown>;
}

export interface SpeciesConfiguration {
  origin: CharacterOriginReference;
  foundry: CharacterFoundryReference;
  grants: SpeciesGrant[];
  choices: SpeciesChoice[];
  spellChoices: SpellChoice[];
  spellGrants?: SpeciesSpellGrant[];
  spellcastingAbility?: { advancementIds: string[]; options: string[]; selected?: string };
  diagnostics: string[];
  size?: SpeciesSizeConfiguration;
}

export interface SpeciesSizeConfiguration {
  advancementId: string;
  level: number;
  options: string[];
  selected?: string;
}

export interface SpeciesConfigurationSelection {
  origin: CharacterOriginReference;
  foundry: CharacterFoundryReference;
  grants: Array<{ key: string; source: SpeciesRecordReference }>;
  choices: Array<{ key: string; source: SpeciesRecordReference; selected: string[] }>;
  spellChoices?: SpeciesSpellChoiceSelection[];
  spellcastingAbility?: { advancementIds: string[]; selected: string };
  size?: { advancementId: string; selected: string };
}

export type SpeciesSpellChoiceSelection = PersistedSpellChoiceSelection;

export interface SpeciesConfigurationSource {
  origin: CharacterOriginReference;
  summary: SpeciesSourceSummary;
  snapshot?: SourceSnapshot;
  grants: SpeciesGrant[];
  choices: SpeciesChoice[];
  spellChoices?: SpellChoice[];
}

export function createSpeciesConfiguration(origin: CharacterOriginReference, snapshot: SourceSnapshot): SpeciesConfiguration {
  return {
    origin: { ...origin },
    foundry: { systemVersion: snapshot.systemVersion, sourceBranch: snapshot.branch, sourceCommit: snapshot.commit },
    grants: [],
    choices: [],
    spellChoices: [],
    diagnostics: [],
  };
}

export function buildSpeciesConfiguration(summary: SpeciesSourceSummary, snapshot: SourceSnapshot): SpeciesConfiguration {
  const configuration = createSpeciesConfiguration({ sourcePath: summary.source.sourcePath, identifier: summary.source.identifier ?? '', id: summary.source.id }, snapshot);
  const grants: SpeciesGrant[] = [];
  const grantSources = new Set<string>();
  const choices: SpeciesChoice[] = [];
  const spellAdvancements: SpeciesSourceSummary['advancements'] = [];
  const diagnostics: string[] = [];
  for (const advancement of summary.advancements) {
    const key = `species:${advancement.id}`;
    const rawConfiguration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : {};
    if (advancement.type === 'ItemGrant' && isRecord(rawConfiguration.spell) && advancement.dependencies.some((dependency) => dependency.source?.type === 'spell')) continue;
    if (isSpellChoiceConfiguration(rawConfiguration) && (advancement.nested === true || advancement.requiresChoice !== undefined)) {
      spellAdvancements.push(advancement);
      continue;
    }
    if (isDeferredSpellChoice(rawConfiguration)) {
      continue;
    }
    const grantValues = new Set(stringValues(rawConfiguration.grants).concat(stringValues(rawConfiguration.items).map((value) => value)));
    const isGrant = advancement.type === 'ItemGrant' || grantValues.size > 0;
    if (isGrant) {
      for (const dependency of advancement.dependencies.filter((entry) => grantValues.size === 0 || grantValues.has(entry.uuid) || entry.source !== null)) {
        if (dependency.source) {
          const sourceKey = `${dependency.source.type}:${dependency.source.id}`;
          if (!grantSources.has(sourceKey)) {
            grantSources.add(sourceKey);
            grants.push({ key: `${key}:${dependency.source.id}`, level: advancement.level, label: dependency.source.name, source: toRecordReference(dependency.source), raw: advancement.raw });
          }
        }
        else if (isSelector(dependency.uuid)) grants.push({ key: `${key}:${dependency.uuid}`, level: advancement.level, label: selectorLabel(dependency.uuid), source: selectorReference(dependency.uuid, advancement.raw), raw: advancement.raw });
        else diagnostics.push(unresolvedMessage(summary, advancement, dependency.uuid, 'grant', dependency.reason));
      }
      if (advancement.type === 'ItemGrant' && advancement.dependencies.length === 0) diagnostics.push(unsupportedMessage(summary, advancement));
      if (!hasChoicePool(rawConfiguration)) continue;
    } else if (advancement.automatic) continue;
    if (!hasChoicePool(rawConfiguration) && !isGrant) {
      if (advancement.automatic) continue;
      diagnostics.push(unsupportedMessage(summary, advancement));
      continue;
    }
    const count = choiceCount(advancement.raw);
    const pool = new Set(poolValues(rawConfiguration));
    const options = advancement.dependencies.filter((dependency) => pool.size === 0 || pool.has(dependency.uuid)).flatMap((dependency): SpeciesChoiceOption[] => {
      if (dependency.source) {
        const feature = summary.features?.find((entry) => entry.source.id === dependency.source?.id && entry.source.sourcePath === dependency.source?.sourcePath);
        const label = advancement.raw.title === 'Draconic Ancestry' ? dependency.source.name.replace(/\s+Breath Weapon$/i, '') : dependency.source.name;
        const value = dependency.uuid === 'tool:*' ? `tool:${dependency.source.identifier ?? dependency.source.id}` : dependency.uuid;
        return [{ value, label, source: toRecordReference(dependency.source), ...(feature?.description === undefined ? {} : { description: feature.description }), ...(feature?.damageTypes === undefined ? {} : { damageTypes: feature.damageTypes }) }];
      }
      if (dependency.uuid === 'skills:*') return Object.entries(FOUNDRY_SKILL_LABELS).map(([id, label]) => ({ value: `skills:${id}`, label, source: selectorReference(`skills:${id}`, advancement.raw) }));
      if (dependency.uuid.startsWith('languages:')) return languageSelectorOptions(dependency.uuid).map((option) => ({ value: option.value, label: option.label, source: selectorReference(option.value, advancement.raw) }));
      return isSupportedSelector(dependency.uuid) ? [{ value: dependency.uuid, label: selectorLabel(dependency.uuid), source: selectorReference(dependency.uuid, advancement.raw) }] : [];
    });
    for (const dependency of advancement.dependencies.filter((entry) => !entry.source && !isSupportedSelector(entry.uuid))) diagnostics.push(unresolvedMessage(summary, advancement, dependency.uuid, 'choice', isMalformedSelector(dependency.uuid) ? 'malformed selector' : 'unsupported selector'));
    if (count === undefined || options.length === 0) { diagnostics.push(unsupportedMessage(summary, advancement)); continue; }
    choices.push({ key, level: advancement.level, label: choiceLabel(advancement, pool), count, source: { id: advancement.id, type: advancement.type }, options, selected: [], ...(advancement.requiresChoice === undefined ? {} : { requiresChoice: advancement.requiresChoice }), raw: advancement.raw });
  }
  const spellChoices = projectSpeciesSpellChoices(summary, spellAdvancements, diagnostics);
  const spellGrants: SpeciesSpellGrant[] = (summary.spellGrants ?? []).map((grant) => ({ ...grant, spells: grant.spells.map((spell) => ({ ...spell })), abilityOptions: [...grant.abilityOptions] }));
  const eligibleAbilityGrants = spellGrants.filter((grant) => grant.level <= 1 && grant.abilityOptions.length > 0);
  const abilityOptions = commonAbilityOptions(eligibleAbilityGrants);
  const spellcastingAbility = eligibleAbilityGrants.length === 0 ? undefined : { advancementIds: eligibleAbilityGrants.map((grant) => grant.advancementId), options: abilityOptions, ...(abilityOptions.length === 1 ? { selected: abilityOptions[0] } : {}) };
  const size = summary.size === undefined ? undefined : {
    advancementId: summary.size.advancementId,
    level: summary.size.level,
    options: [...summary.size.sizes],
    ...(summary.size.sizes.length === 1 ? { selected: summary.size.sizes[0] } : {}),
  };
  return { ...configuration, grants, choices, spellChoices, spellGrants, diagnostics, ...(spellcastingAbility === undefined ? {} : { spellcastingAbility }), ...(size === undefined ? {} : { size }) };
}

export function setSpeciesSize(configuration: SpeciesConfiguration, value: string): SpeciesConfiguration {
  if (configuration.size === undefined || configuration.size.options.length < 2) throw new Error('Species size does not require a choice');
  if (!configuration.size.options.includes(value)) throw new Error(`Invalid species size: ${value}`);
  return { ...configuration, size: { ...configuration.size, selected: value } };
}

function projectSpeciesSpellChoices(summary: SpeciesSourceSummary, advancements: SpeciesSourceSummary['advancements'], diagnostics: string[]): SpellChoice[] {
  const result: SpellChoice[] = [];
  const listChoices = new Map<string, SpellChoice>();
  for (const advancement of advancements) {
    const count = choiceCount(advancement.raw);
    if (count === undefined || advancement.spellLevel === undefined || advancement.spellLists === undefined || advancement.spellLists.length === 0 || advancement.abilityOptions === undefined) {
      diagnostics.push(unresolvedMessage(summary, advancement, 'spell:*', 'choice', 'unsupported spell restriction'));
      continue;
    }
    const options = advancement.dependencies.flatMap((dependency): SpellChoiceOption[] => dependency.source?.type === 'spell'
      ? [{ value: `${dependency.source.pack}:${dependency.source.type}:${dependency.source.id}`, source: { ...dependency.source }, label: dependency.source.name, ...(dependency.description === undefined ? {} : { description: dependency.description }) }]
      : []);
    if (options.length === 0) {
      diagnostics.push(unresolvedMessage(summary, advancement, 'spell:*', 'choice', 'empty source-backed spell pool'));
      continue;
    }
    const spellChoice: SpellChoice = {
      key: `species:${advancement.id}`,
      advancementId: advancement.id,
      label: choiceLabel(advancement, new Set()),
      count,
      level: advancement.spellLevel,
      spellLists: [...advancement.spellLists],
      selected: [],
      abilityOptions: [...advancement.abilityOptions],
      options,
      raw: advancement.raw,
    };
    if (advancement.requiresChoice === undefined) {
      result.push(spellChoice);
      continue;
    }
    const parentSource = findParentSource(summary, advancement.requiresChoice);
    if (parentSource === undefined) {
      diagnostics.push(unresolvedMessage(summary, advancement, advancement.requiresChoice.value, 'choice', 'unresolved parent choice'));
      continue;
    }
    const normalizedLists = [...new Set(advancement.spellLists.map((list) => list.trim().toLocaleLowerCase()).filter((list) => list.length > 0))].sort();
    const groupKey = `${advancement.requiresChoice.key}:${advancement.requiresChoice.value}:${parentSource.pack}:${parentSource.type}:${parentSource.id}:spell-list:${normalizedLists.join('|')}`;
    let listChoice = listChoices.get(groupKey);
    if (listChoice === undefined) {
      const spellLists = normalizedLists;
      listChoice = {
        key: groupKey,
        advancementId: advancement.id,
        label: 'Spell list',
        count: 1,
        level: 0,
        spellLists,
        selected: [],
        abilityOptions: [],
        parent: { key: advancement.requiresChoice.key, values: [advancement.requiresChoice.value] },
        options: spellLists.map((list) => ({ value: list, source: { ...parentSource }, label: selectorLabel(list) })),
        raw: { type: 'spell-list', configuration: { type: 'spell-list' } },
      };
      listChoices.set(groupKey, listChoice);
      result.push(listChoice);
    }
    result.push({
      ...spellChoice,
      parent: { key: groupKey, values: [] },
    });
  }
  return result;
}

function findParentSource(summary: SpeciesSourceSummary, parent: { key: string; value: string }): FoundrySourceReference | undefined {
  const advancementId = parent.key.startsWith('species:') ? parent.key.slice('species:'.length) : '';
  return summary.advancements.find((advancement) => advancement.id === advancementId)?.dependencies.find((dependency) => dependency.uuid === parent.value)?.source ?? undefined;
}

export function setSpeciesChoice(configuration: SpeciesConfiguration, key: string, values: string[]): SpeciesConfiguration {
  const choice = configuration.choices.find((entry) => entry.key === key);
  if (choice === undefined) throw new Error(`Unknown species choice: ${key}`);
  if (new Set(values).size !== values.length || values.length > choice.count) throw new Error(`Invalid species choice cardinality: ${key}`);
  if (values.some((value) => !choice.options.some((option) => option.value === value))) throw new Error(`Invalid species choice value: ${key}`);
  let choices = configuration.choices.map((entry) => entry.key === key ? { ...entry, selected: [...values] } : entry);
  choices = choices.map((entry) => !isSpeciesChoiceAvailable(entry, { ...configuration, choices }) ? { ...entry, selected: [] } : entry);
  const selectedOption = choice.options.find((option) => values.includes(option.value));
  if (choice.label === 'Draconic Ancestry' && selectedOption?.damageTypes?.length === 1) {
    const damageType = `dr:${selectedOption.damageTypes[0]}`;
    choices = choices.map((entry) => isDraconicResistanceChoice(entry) && entry.options.some((option) => option.value === damageType) ? { ...entry, selected: [damageType] } : entry);
  }
  return clearUnavailableSpeciesSpellChoices({ ...configuration, choices });
}

export function getAvailableSpeciesSpellChoices(configuration: SpeciesConfiguration): SpellChoice[] {
  return configuration.spellChoices.flatMap((choice) => {
    if (!isSpeciesSpellChoiceAvailable(choice, configuration)) return [];
    if (isSpellListChoice(choice)) return [cloneSpellChoice(choice)];
    if (choice.parent === undefined) return [cloneSpellChoice(choice)];
    const parent = choice.parent === undefined ? undefined : configuration.spellChoices.find((candidate) => candidate.key === choice.parent?.key);
    const selectedList = parent?.selected.length === 1 && typeof parent.selected[0] === 'string' ? parent.selected[0] : undefined;
    if (parent === undefined || selectedList === undefined || !choice.spellLists.includes(selectedList)) return [];
    return [{
      ...cloneSpellChoice(choice),
      spellLists: [selectedList],
      parent: { key: parent.key, values: [selectedList] },
      options: choice.options.filter((option) => spellOptionLists(option).includes(selectedList)),
    }];
  });
}

export function setSpeciesSpellChoice(configuration: SpeciesConfiguration, key: string, values: SpellChoiceSelection[]): SpeciesConfiguration {
  const available = getAvailableSpeciesSpellChoices(configuration);
  const target = available.find((choice) => choice.key === key);
  if (target === undefined) throw new Error(`Spell choice is unavailable: ${key}`);
  const changingSpellList = isSpellListChoice(target);
  const prepared = available.map((choice) => hasSpeciesParent(choice, configuration) ? { ...choice, parent: undefined } : choice);
  const changed = setSpellChoice(prepared, key, values);
  const changedByKey = new Map(changed.map((choice) => [choice.key, choice]));
  const spellChoices = configuration.spellChoices.map((choice) => {
    const update = changedByKey.get(choice.key);
    if (update === undefined) return cloneSpellChoice(choice);
    const selectedAbility = update.selectedAbility ?? (changingSpellList && choice.selectedAbility !== undefined && choice.abilityOptions.includes(choice.selectedAbility) ? choice.selectedAbility : undefined);
    return { ...cloneSpellChoice(choice), selected: cloneSpellSelections(update.selected), selectedAbility };
  });
  return clearUnavailableSpeciesSpellChoices({ ...configuration, spellChoices });
}

export function setSpeciesSpellcastingAbility(configuration: SpeciesConfiguration, key: string, ability: string): SpeciesConfiguration {
  if (configuration.spellcastingAbility?.options.includes(ability) && (key === 'species-spellcasting-ability' || key === 'species:spellcasting-ability')) return { ...configuration, spellcastingAbility: { ...configuration.spellcastingAbility, selected: ability } };
  const available = getAvailableSpeciesSpellChoices(configuration);
  const target = available.find((choice) => choice.key === key);
  if (target === undefined) throw new Error(`Spell choice is unavailable: ${key}`);
  const prepared = available.map((choice) => hasSpeciesParent(choice, configuration) ? { ...choice, parent: undefined } : choice);
  setSpellcastingAbility(prepared, key, ability);
  const parentKey = target.parent?.key;
  return {
    ...configuration,
    spellChoices: configuration.spellChoices.map((choice) => choice.key === key || parentKey !== undefined && choice.parent?.key === parentKey && choice.abilityOptions.includes(ability)
      ? { ...cloneSpellChoice(choice), selectedAbility: ability }
      : cloneSpellChoice(choice)),
  };
}

export function isSpeciesSpellChoiceAvailable(choice: SpellChoice, configuration: Pick<SpeciesConfiguration, 'choices' | 'spellChoices'>, visited = new Set<string>()): boolean {
  if (choice.parent === undefined) return true;
  if (visited.has(choice.key)) return false;
  const nextVisited = new Set(visited).add(choice.key);
  const speciesParent = configuration.choices.find((candidate) => candidate.key === choice.parent?.key);
  if (speciesParent !== undefined) return isSpeciesChoiceAvailable(speciesParent, configuration) && choice.parent.values.every((value) => speciesParent.selected.includes(value));
  const spellParent = configuration.spellChoices.find((candidate) => candidate.key === choice.parent?.key);
  if (spellParent === undefined || !isSpeciesSpellChoiceAvailable(spellParent, configuration, nextVisited)) return false;
  if (isSpellListChoice(spellParent)) {
    return spellParent.selected.length === 1 && typeof spellParent.selected[0] === 'string' && choice.spellLists.includes(spellParent.selected[0]);
  }
  return choice.parent.values.every((value) => spellParent.selected.some((selection) => typeof selection === 'string' ? selection === value : selection.id === value || selection.identifier === value));
}

function clearUnavailableSpeciesSpellChoices(configuration: SpeciesConfiguration): SpeciesConfiguration {
  const spellChoices = configuration.spellChoices.map((choice) => isSpeciesSpellChoiceAvailable(choice, configuration)
    ? cloneSpellChoice(choice)
    : { ...cloneSpellChoice(choice), selected: [], selectedAbility: undefined });
  return { ...configuration, spellChoices };
}

function hasSpeciesParent(choice: SpellChoice, configuration: SpeciesConfiguration): boolean {
  return choice.parent !== undefined && configuration.choices.some((candidate) => candidate.key === choice.parent?.key);
}

function isSpellListChoice(choice: SpellChoice): boolean {
  const rawConfiguration = isRecord(choice.raw.configuration) ? choice.raw.configuration : undefined;
  return choice.raw.type === 'spell-list' || rawConfiguration?.type === 'spell-list';
}

function spellOptionLists(option: SpellChoiceOption): string[] {
  return isRecord(option.source) ? stringValues(option.source.spellLists) : [];
}

function cloneSpellSelections(values: SpellChoiceSelection[]): SpellChoiceSelection[] {
  return values.map((value) => typeof value === 'string' ? value : { ...value });
}

function cloneSpellChoice(choice: SpellChoice): SpellChoice {
  return {
    ...choice,
    spellLists: [...choice.spellLists],
    selected: cloneSpellSelections(choice.selected),
    abilityOptions: [...choice.abilityOptions],
    ...(choice.parent === undefined ? {} : { parent: { ...choice.parent, values: [...choice.parent.values] } }),
    options: choice.options.map((option) => ({ ...option, source: { ...option.source } })),
  };
}

export function isSpeciesChoiceAvailable(choice: SpeciesChoice, configuration: Pick<SpeciesConfiguration, 'choices'>): boolean {
  if (choice.requiresChoice === undefined) return true;
  const parent = configuration.choices.find((entry) => entry.key === choice.requiresChoice?.key);
  return parent?.selected.includes(choice.requiresChoice.value) ?? false;
}

export function isDraconicResistanceChoice(choice: SpeciesChoice): boolean {
  const label = choice.label.toLowerCase();
  return label.includes('resistance') && label.includes('draconic ancestry');
}

export function toSpeciesConfigurationSelection(configuration: SpeciesConfiguration): SpeciesConfigurationSelection {
  return {
    origin: { ...configuration.origin },
    foundry: { ...configuration.foundry },
    grants: configuration.grants.map((grant) => ({ key: grant.key, source: { ...grant.source } })),
    choices: configuration.choices.map((choice) => ({ key: choice.key, source: { ...choice.source }, selected: [...choice.selected] })),
    ...(configuration.size === undefined || configuration.size.options.length < 2 || configuration.size.selected === undefined ? {} : { size: { advancementId: configuration.size.advancementId, selected: configuration.size.selected } }),
    spellChoices: configuration.spellChoices.map((choice): SpeciesSpellChoiceSelection => {
      if (isSpellListChoice(choice)) {
        if (choice.selected.some((selection) => typeof selection !== 'string')) throw new Error(`Invalid spell list selection: ${choice.key}`);
        return { key: choice.key, advancementId: choice.advancementId, kind: 'spell-list', selected: choice.selected.flatMap((selection) => typeof selection === 'string' ? [selection] : []) };
      }
      if (choice.selected.some((selection) => typeof selection === 'string')) throw new Error(`Invalid spell selection: ${choice.key}`);
      return {
        key: choice.key,
        advancementId: choice.advancementId,
        kind: 'spell',
        selected: choice.selected.flatMap((selection) => typeof selection === 'string' ? [] : [sanitizeSpellReference(selection)]),
        ...(choice.selectedAbility === undefined ? {} : { selectedAbility: choice.selectedAbility }),
      };
    }),
    ...(configuration.spellcastingAbility?.selected === undefined || configuration.spellcastingAbility.advancementIds.length === 0 || configuration.spellcastingAbility.options.length <= 1 ? {} : { spellcastingAbility: { advancementIds: [...configuration.spellcastingAbility.advancementIds], selected: configuration.spellcastingAbility.selected } }),
  };
}

export function restoreSpeciesConfiguration(selection: SpeciesConfigurationSelection, source: SpeciesConfigurationSource): SpeciesConfiguration {
  const projected = createSpeciesConfiguration(selection.origin, {
    owner: 'foundryvtt', repo: 'dnd5e', branch: selection.foundry.sourceBranch,
    commit: selection.foundry.sourceCommit, systemVersion: selection.foundry.systemVersion,
  });
  const currentSpellChoices = source.spellChoices ?? [];
  const currentSpellcastingAbility = source.summary.spellGrants === undefined ? undefined : (() => {
    const eligible = source.summary.spellGrants.filter((grant) => grant.level <= 1 && grant.abilityOptions.length > 0);
    const options = commonAbilityOptions(eligible);
    if (eligible.length === 0) return undefined;
    const advancementIds = selection.spellcastingAbility?.advancementIds ?? eligible.map((grant) => grant.advancementId);
    return { advancementIds, options, ...(options.length === 1 ? { selected: options[0] } : {}), ...(selection.spellcastingAbility === undefined ? {} : { selected: selection.spellcastingAbility.selected }) };
  })();
  const restoredSpellChoices = (selection.spellChoices ?? []).map((saved): SpellChoice => {
    const current = currentSpellChoices.find((choice) => choice.key === saved.key);
    const selected: SpellChoiceSelection[] = saved.kind === 'spell-list' ? [...saved.selected] : saved.selected.map((spell) => ({ ...spell }));
    return current === undefined
      ? { key: saved.key, advancementId: saved.advancementId, label: saved.key, count: selected.length, level: 0, spellLists: [], selected, abilityOptions: [], ...(saved.kind === 'spell' && saved.selectedAbility !== undefined ? { selectedAbility: saved.selectedAbility } : {}), options: [], raw: saved.kind === 'spell-list' ? { type: 'spell-list' } : {} }
      : { ...cloneSpellChoice(current), selected, ...(saved.kind === 'spell' && saved.selectedAbility !== undefined ? { selectedAbility: saved.selectedAbility } : {}) };
  }).concat(currentSpellChoices.filter((choice) => !(selection.spellChoices ?? []).some((saved) => saved.key === choice.key)).map((choice) => ({ ...cloneSpellChoice(choice), selected: [], selectedAbility: undefined })));
  return {
    ...projected,
    grants: selection.grants.map((grant) => ({ key: grant.key, level: 0, label: grant.source.name ?? grant.key, source: { ...grant.source }, raw: {} })),
    choices: selection.choices.map((saved) => {
      const current = source.choices.find((choice) => choice.key === saved.key);
      return current === undefined
        ? { key: saved.key, level: 0, label: saved.key, count: saved.selected.length, source: { ...saved.source }, options: [], selected: [...saved.selected], raw: {} }
        : { ...current, source: { ...saved.source }, selected: [...saved.selected] };
    }).concat(source.choices.filter((choice) => !selection.choices.some((saved) => saved.key === choice.key)).map((choice) => ({ ...choice, selected: [] }))),
    spellChoices: restoredSpellChoices,
    spellGrants: (source.summary.spellGrants ?? []).map((grant) => ({ ...grant, spells: grant.spells.map((spell) => ({ ...spell })), abilityOptions: [...grant.abilityOptions] })),
    ...(currentSpellcastingAbility === undefined ? {} : { spellcastingAbility: currentSpellcastingAbility }),
    ...(source.summary.size === undefined ? {} : { size: {
      advancementId: selection.size?.advancementId ?? source.summary.size.advancementId,
      level: source.summary.size.level,
      options: [...source.summary.size.sizes],
      ...(source.summary.size.sizes.length === 1 ? { selected: source.summary.size.sizes[0] } : {}),
      ...(selection.size?.advancementId === source.summary.size.advancementId && source.summary.size.sizes.includes(selection.size.selected) ? { selected: selection.size.selected } : selection.size === undefined ? {} : { selected: selection.size.selected }),
    } }),
  };
}

export function validateSpeciesConfiguration(configuration: SpeciesConfiguration, source: SpeciesConfigurationSource): string[] {
  const warnings: string[] = [];
  if (source.snapshot !== undefined && (configuration.foundry.systemVersion !== source.snapshot.systemVersion || configuration.foundry.sourceBranch !== source.snapshot.branch || configuration.foundry.sourceCommit !== source.snapshot.commit)) warnings.push('Species source snapshot differs from current source');
  if (configuration.origin.id !== source.summary.source.id || configuration.origin.sourcePath !== source.summary.source.sourcePath || configuration.origin.identifier !== source.summary.source.identifier) warnings.push('Species origin does not match source summary');
  if (!isValidOriginReference(configuration.origin)) warnings.push('Invalid species origin reference');
  const sourceSize = source.summary.size;
  if (sourceSize !== undefined) {
    const savedSize = configuration.size;
    if (savedSize === undefined || savedSize.advancementId !== sourceSize.advancementId) warnings.push('Species size advancement is missing or changed');
    else if (savedSize.options.length !== sourceSize.sizes.length || savedSize.options.some((value, index) => value !== sourceSize.sizes[index])) warnings.push('Species size options changed');
    if (sourceSize.sizes.length > 1 && savedSize?.selected === undefined) warnings.push('Species size requires a choice');
    if (savedSize?.selected !== undefined && !sourceSize.sizes.includes(savedSize.selected)) warnings.push('Saved species size is not allowed by the current source');
  }
  for (const grant of source.grants) {
    const configured = configuration.grants.find((entry) => entry.key === grant.key && entry.source.id === grant.source.id && entry.source.type === grant.source.type);
    if (configured === undefined) warnings.push(`Missing species grant: ${grant.key}`);
  }
  for (const grant of configuration.grants) if (!isValidReference(grant.source)) warnings.push(`Invalid species grant reference: ${grant.key}`);
  for (const grant of configuration.grants) if (!source.grants.some((entry) => entry.key === grant.key && entry.source.id === grant.source.id && entry.source.type === grant.source.type)) warnings.push(`Unknown species grant: ${grant.key}`);
  for (const choice of configuration.choices) {
    if (!isSpeciesChoiceAvailable(choice, configuration)) continue;
    if (!isValidReference(choice.source)) warnings.push(`Invalid species choice reference: ${choice.key}`);
    const sourceChoice = source.choices.find((entry) => entry.key === choice.key);
    if (sourceChoice === undefined) {
      warnings.push(`Unknown species choice: ${choice.key}`);
      continue;
    }
    if (choice.source.id !== sourceChoice.source.id || choice.source.type !== sourceChoice.source.type) warnings.push(`Changed species choice reference: ${choice.key}`);
    if (choice.selected.length > sourceChoice.count || new Set(choice.selected).size !== choice.selected.length) warnings.push(`Choice "${choice.key}" has invalid cardinality`);
    else if (choice.selected.some((value) => !sourceChoice.options.some((option) => option.value === value))) warnings.push(`Choice "${choice.key}" contains a disallowed value`);
    else if (choice.selected.length !== sourceChoice.count) warnings.push(`Choice "${choice.key}" requires ${sourceChoice.count} value${sourceChoice.count === 1 ? '' : 's'}`);
  }
  for (const sourceChoice of source.choices) {
    if (!isSpeciesChoiceAvailable(sourceChoice, configuration)) continue;
    const choice = configuration.choices.find((entry) => entry.key === sourceChoice.key);
    if (choice === undefined && sourceChoice.count > 0) warnings.push(`Choice "${sourceChoice.key}" requires ${sourceChoice.count} value${sourceChoice.count === 1 ? '' : 's'}`);
  }
  const sourceSpellChoices = source.spellChoices ?? [];
  const sourceAbilityGrants = (source.summary.spellGrants ?? []).filter((grant) => grant.level <= 1 && grant.abilityOptions.length > 0);
  if (sourceAbilityGrants.length > 0) {
    const options = commonAbilityOptions(sourceAbilityGrants);
    if (configuration.spellcastingAbility === undefined) warnings.push('Missing species spellcasting ability choice');
    else {
      if (configuration.spellcastingAbility.advancementIds.join('|') !== sourceAbilityGrants.map((grant) => grant.advancementId).join('|')) warnings.push('Changed species spellcasting ability provenance');
      if (options.length > 1 && configuration.spellcastingAbility.selected === undefined) warnings.push('Species spellcasting ability is required');
      if (configuration.spellcastingAbility.selected !== undefined && !options.includes(configuration.spellcastingAbility.selected)) warnings.push('Saved species spellcasting ability is not allowed by the current source');
    }
  }
  const availableSpellChoices = getAvailableSpeciesSpellChoices(configuration);
  for (const choice of configuration.spellChoices) {
    const sourceChoice = sourceSpellChoices.find((candidate) => candidate.key === choice.key);
    if (sourceChoice === undefined) {
      warnings.push(`Unknown species spell choice: ${choice.key}`);
      continue;
    }
    if (choice.advancementId !== sourceChoice.advancementId) warnings.push(`Changed species spell choice reference: ${choice.key}`);
    if (!isSpellListChoice(choice)) {
      const selectedList = selectedSpellList(choice, configuration.spellChoices);
      for (const selection of choice.selected) {
        if (typeof selection === 'string') continue;
        const option = sourceChoice.options.find((candidate) => sameSpellReference(candidate.source, selection));
        if (option === undefined || !isRecord(option.source)) continue;
        if (typeof option.source.level === 'number' && option.source.level !== sourceChoice.level) warnings.push(`Choice "${choice.key}" contains a spell from the wrong level`);
        const optionLists = stringValues(option.source.spellLists);
        if (selectedList !== undefined && optionLists.length > 0 && !optionLists.includes(selectedList)) warnings.push(`Choice "${choice.key}" contains a spell outside the selected spell list`);
      }
    }
    const available = availableSpellChoices.find((candidate) => candidate.key === choice.key);
    if (available !== undefined) warnings.push(...validateSpellChoices([{ ...available, parent: undefined }]));
  }
  for (const sourceChoice of sourceSpellChoices) {
    if (!isSpeciesSpellChoiceAvailable(sourceChoice, configuration)) continue;
    if (!configuration.spellChoices.some((choice) => choice.key === sourceChoice.key)) warnings.push(`Missing species spell choice: ${sourceChoice.key}`);
  }
  return warnings;
}

function selectedSpellList(choice: SpellChoice, choices: SpellChoice[]): string | undefined {
  const parent = choice.parent === undefined ? undefined : choices.find((candidate) => candidate.key === choice.parent?.key);
  return parent?.selected.length === 1 && typeof parent.selected[0] === 'string' ? parent.selected[0] : undefined;
}

function sameSpellReference(left: FoundrySourceReference, right: FoundrySourceReference): boolean {
  return left.sourcePath === right.sourcePath && left.pack === right.pack && left.type === right.type && left.id === right.id;
}

function commonAbilityOptions(grants: Array<{ abilityOptions: string[] }>): string[] {
  if (grants.length === 0) return [];
  return [...new Set(grants[0]!.abilityOptions)].filter((ability) => grants.every((grant) => grant.abilityOptions.includes(ability)));
}

function sanitizeSpellReference(source: FoundrySourceReference): FoundrySourceReference {
  return { sourcePath: source.sourcePath, pack: source.pack, type: source.type, id: source.id, name: source.name, ...(source.identifier === undefined ? {} : { identifier: source.identifier }) };
}

function isValidReference(reference: SpeciesRecordReference): boolean { return reference.id.trim().length > 0 && reference.type.trim().length > 0; }
function isValidOriginReference(origin: CharacterOriginReference): boolean { return origin.sourcePath.trim().length > 0 && origin.identifier.trim().length > 0 && origin.id.trim().length > 0; }

function toRecordReference(source: { id: string; type: string; name?: string }): SpeciesRecordReference { return { id: source.id, type: source.type, ...(source.name ? { name: source.name } : {}) }; }
function choiceCount(raw: Record<string, unknown>): number | undefined {
  const configuration = raw.configuration;
  if (!isRecord(configuration)) return undefined;
  const choices = configuration.choices;
  const value = Array.isArray(choices) && isRecord(choices[0]) ? choices[0].count : isRecord(choices) ? Object.values(choices).find((entry) => isRecord(entry) && typeof entry.count === 'number') && (Object.values(choices).find((entry) => isRecord(entry) && typeof entry.count === 'number') as Record<string, unknown>).count : choices;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
function hasChoicePool(configuration: Record<string, unknown>): boolean { return Array.isArray(configuration.choices) ? configuration.choices.length > 0 : isRecord(configuration.choices) ? Object.keys(configuration.choices).length > 0 : typeof configuration.choices === 'number' && Array.isArray(configuration.pool); }
function poolValues(configuration: Record<string, unknown>): string[] { const choices = configuration.choices; const groups = Array.isArray(choices) ? choices : isRecord(choices) ? Object.values(choices) : []; const nested = groups.flatMap((group) => isRecord(group) && Array.isArray(group.pool) ? group.pool.filter((value): value is string => typeof value === 'string') : []); return nested.length > 0 ? nested : stringValues(configuration.pool); }
function isSpellChoiceConfiguration(configuration: Record<string, unknown>): boolean { return configuration.type === 'spell'; }
function isDeferredSpellChoice(configuration: Record<string, unknown>): boolean {
  if (!isSpellChoiceConfiguration(configuration) || poolValues(configuration).length > 0 || !isRecord(configuration.restriction)) return false;
  return stringValues(configuration.restriction.list).some((value) => value.startsWith('class:'));
}
function choiceLabel(advancement: { hint?: string; type: string; raw: Record<string, unknown> }, pool: Set<string>): string {
  const title = typeof advancement.raw.title === 'string' ? advancement.raw.title : undefined;
  if (title?.trim().length) return title;
  if (advancement.hint?.trim().length) return advancement.hint;
  const category = [...pool].map((value) => value.split(':', 1)[0]).find((value) => value.length > 0);
  return { skills: 'Skill proficiencies', languages: 'Languages', abilities: 'Ability scores', feats: 'Feats', tool: 'Tool proficiencies', tools: 'Tool proficiencies', weapon: 'Weapon proficiencies', armor: 'Armor proficiencies' }[category ?? ''] ?? advancement.type;
}
function unsupportedMessage(summary: SpeciesSourceSummary, advancement: { id: string; type: string }): string { return `Unsupported species advancement at ${summary.source.sourcePath}: ${advancement.id} (${advancement.type})`; }
function unresolvedMessage(summary: SpeciesSourceSummary, advancement: { id: string; type: string }, uuid: string, kind: string, reason = 'unresolved source dependency'): string { return `Unresolved species ${kind} dependency at ${summary.source.sourcePath}: ${advancement.id} (${advancement.type}) -> ${uuid} (${reason})`; }
function isMalformedSelector(value: string): boolean { return !isSelector(value); }
function isSelector(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_-]*(?::[^:]+)+$/.test(value); }
export const FOUNDRY_SKILL_LABELS: Readonly<Record<string, string>> = {
  acr: 'Acrobatics', ani: 'Animal Handling', arc: 'Arcana', ath: 'Athletics', dec: 'Deception',
  his: 'History', ins: 'Insight', itm: 'Intimidation', inv: 'Investigation', med: 'Medicine',
  nat: 'Nature', prc: 'Perception', prf: 'Performance', per: 'Persuasion', rel: 'Religion',
  slt: 'Sleight of Hand', ste: 'Stealth', sur: 'Survival',
};
export function isSupportedSelector(value: string): boolean { return value === 'skills:*' || value === 'tool:*' || languageSelectorOptions(value).length > 0 || /^(?!.*\*)(abilities|feats|dr|tool):[^:]+(?::[^:]+)*$/.test(value) || /^(weapon|armor|focus):[^:]+(?::[^:]+)*$/.test(value) || /^skills:(?:acr|ani|arc|ath|dec|his|ins|itm|inv|med|nat|prc|per|rel|slt|ste|sur)$/.test(value); }
function selectorReference(value: string, raw: Record<string, unknown>): SpeciesRecordReference { const category = value.split(':')[0]; const configuration = isRecord(raw.configuration) ? raw.configuration : {}; const semanticType = typeof configuration.type === 'string' ? configuration.type : isRecord(configuration.restriction) && typeof configuration.restriction.type === 'string' ? configuration.restriction.type : undefined; const type = semanticType ?? (category === 'skills' ? 'skill' : category === 'languages' ? 'language' : category === 'abilities' ? 'ability' : category === 'dr' ? 'damage-resistance' : category === 'feats' ? 'feat' : category); return { id: value, type }; }
function selectorLabel(value: string): string { const parts = value.split(':'); const category = parts[0]; const id = parts.at(-1); if (category === 'skills' && id !== undefined && FOUNDRY_SKILL_LABELS[id] !== undefined) return FOUNDRY_SKILL_LABELS[id]; return (id ?? value).replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
