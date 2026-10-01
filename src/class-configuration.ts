import type { ClassAdvancementSummary, ClassSourceSummary, FoundrySourceReference } from './character-sources';
import type { CharacterClassReference, CharacterFoundryReference } from './character-model';
import type { SourceSnapshot } from './source-tree';
import { isRecord } from './foundry-utils';
import type { SpellChoiceOption } from './spell-configuration';
import { getLevelOneClassProgression } from './level-one-progression';

export interface ClassProgressionSelection { class: CharacterClassReference; targetLevel: number; subclass?: FoundrySourceReference; selections: ClassAdvancementSelection[]; }
export type ClassAdvancementSelection =
  | ({ advancementId: string; kind: 'trait'; selected: string[] } & PoolConstraints)
  | ({ advancementId: string; kind: 'expertise'; selected: string[]; mode: 'expertise' } & PoolConstraints)
  | ({ advancementId: string; kind: 'item'; selected: FoundrySourceReference[] } & PoolConstraints)
  | ({ advancementId: string; kind: 'ability-score'; assignments: Record<string, number>; feat?: FoundrySourceReference } & AsiConstraints)
  | { advancementId: string; kind: 'subclass'; selected?: FoundrySourceReference; options: FoundrySourceReference[] }
  | ({ advancementId: string; kind: 'spell'; selectionRole: 'cantrips-known' | 'known-spells' | 'spellbook'; selected: FoundrySourceReference[]; ability?: string; selectedAbility?: string; count?: number; level?: number; spellLists?: string[]; abilityOptions?: string[]; options?: SpellChoiceOption[]; raw?: Record<string, unknown>; requiresChoice?: { key: string; value: string } } & PoolConstraints);
interface PoolConstraints { configuredPool?: string[]; }
interface AsiConstraints { points: number; cap?: number; locked?: string[]; fixed?: Record<string, number>; allowedAbilities?: string[]; recommendation?: Record<string, number>; featOptions?: FoundrySourceReference[]; }
export interface ClassConfiguration { class: CharacterClassReference; foundry: CharacterFoundryReference; targetLevel: number; summary: ClassSourceSummary; advancements: ClassAdvancementSummary[]; selections: ClassAdvancementSelection[]; choices: ClassAdvancementSelection[]; passiveSelections: ClassAdvancementSelection[]; diagnostics: string[]; }
export interface ClassConfigurationSource { class: CharacterClassReference; summary: ClassSourceSummary; configuration: ClassConfiguration; snapshot?: SourceSnapshot; }

export function buildClassConfiguration(summary: ClassSourceSummary, snapshot: SourceSnapshot, targetLevel: number): ClassConfiguration {
  if (!Number.isInteger(targetLevel) || targetLevel < 1) throw new Error('Invalid class target level');
  const classRef = { sourcePath: summary.source.sourcePath, identifier: summary.source.identifier ?? '', id: summary.source.id };
  const advancements = summary.advancements.filter((a) => a.level <= targetLevel && (a.classRestriction === undefined || a.classRestriction === 'primary'));
  const selections = [...getLevelOneDerivedSpellChoices(summary), ...advancements.flatMap((advancement) => projectSelection(advancement, targetLevel))];
  return { class: classRef, foundry: foundry(snapshot), targetLevel, summary, advancements, selections, choices: selections.filter((selection) => isInteractive(selection) && isClassSelectionAvailable(selection, selections)), passiveSelections: [], diagnostics: unresolvedDiagnostics(advancements, summary) };
}
export function setClassSelection(configuration: ClassConfiguration, selection: ClassAdvancementSelection): ClassConfiguration {
  validateSelection(selection, configuration);
  const selectionIndex = configuration.selections.findIndex((entry) => entry.advancementId === selection.advancementId);
  const selections = [...configuration.selections];
  if (selectionIndex === -1) selections.push(clone(selection));
  else selections[selectionIndex] = clone(selection);
  const cleaned = selections.map((entry) => entry.kind === 'spell' && entry.requiresChoice !== undefined && !isClassSelectionAvailable(entry, selections) ? { ...entry, selected: [] } : entry);
  return { ...configuration, selections: cleaned, choices: cleaned.filter((entry) => isInteractive(entry) && isClassSelectionAvailable(entry, cleaned)) };
}
export function mergeClassSelection(progression: ClassProgressionSelection, selection: ClassAdvancementSelection): ClassProgressionSelection {
  const selectionIndex = progression.selections.findIndex((entry) => entry.advancementId === selection.advancementId);
  const selections = [...progression.selections];
  if (selectionIndex === -1) selections.push(clone(selection));
  else selections[selectionIndex] = clone(selection);
  return {
    ...progression,
    selections,
  };
}
export function getLevelOneDerivedSpellChoices(summary: ClassSourceSummary): ClassAdvancementSelection[] {
  const spellcasting = getLevelOneClassProgression(summary).spellcasting;
  if (spellcasting === undefined) return [];
  const classSpellLists = spellcasting.spellLists.length > 0 ? spellcasting.spellLists : summary.source.identifier ? [summary.source.identifier.toLocaleLowerCase()] : [];
  if (classSpellLists.length === 0) return [];
  const ability = typeof summary.spellcasting?.ability === 'string' ? summary.spellcasting.ability : undefined;
  const options = (summary.spellOptions ?? []).filter((spell) => spell.type === 'spell').map((source): SpellChoiceOption => ({ value: `${source.pack}:${source.type}:${source.id}`, source, label: source.name, ...(isRecord(source) && typeof source.description === 'string' ? { description: source.description } : {}) }));
  const make = (selectionRole: 'cantrips-known' | 'known-spells' | 'spellbook', count: number, level: number): ClassAdvancementSelection => ({ advancementId: `derived:${summary.source.sourcePath}:${selectionRole}`, kind: 'spell', selectionRole, selected: [], count, level, spellLists: [...classSpellLists], options: options.filter((option) => spellNumber(option.source, 'level') === level && spellStrings(option.source, 'spellLists')?.some((list) => classSpellLists.includes(list.toLocaleLowerCase())) === true), ...(ability === undefined ? {} : { ability }) });
  const result: ClassAdvancementSelection[] = [];
  if (spellcasting.cantripsKnown !== undefined && spellcasting.cantripsKnown > 0) result.push(make('cantrips-known', spellcasting.cantripsKnown, 0));
  if (spellcasting.spellbookSpells !== undefined && spellcasting.spellbookSpells > 0) result.push(make('spellbook', spellcasting.spellbookSpells, 1));
  else if (spellcasting.learnedSpells !== undefined && spellcasting.learnedSpells > 0) result.push(make('known-spells', spellcasting.learnedSpells, 1));
  return result;
}

export function validateClassConfiguration(configuration: ClassConfiguration, source: ClassConfigurationSource): string[] {
  const warnings = [...configuration.diagnostics];
  if (source.snapshot && !sameFoundry(configuration.foundry, source.snapshot)) warnings.push('Class source snapshot differs from current source');
  if (configuration.class.id !== source.class.id || configuration.class.sourcePath !== source.class.sourcePath) warnings.push('Class does not match source summary');
  if (!Number.isInteger(configuration.targetLevel) || configuration.targetLevel < 1) warnings.push('Invalid class target level');
  if (configuration.targetLevel !== source.configuration.targetLevel) warnings.push('Class target level differs from source configuration');
  for (const selection of configuration.selections) { try { validateSelection(selection, source.configuration); } catch (error) { warnings.push(error instanceof Error ? error.message : 'Invalid class selection'); } }
  return warnings;
}
export function restoreClassConfiguration(selection: ClassProgressionSelection, source: ClassConfigurationSource): ClassConfiguration {
  const generated = new Map(source.configuration.selections.map((entry) => [entry.advancementId, entry]));
  const saved = new Map(selection.selections.map((entry) => [entry.advancementId, entry]));
  const selections = source.configuration.selections.map((current) => {
    const persisted = saved.get(current.advancementId);
    if (persisted === undefined) return clone(current);
    if (current.kind !== 'spell' || persisted.kind !== 'spell' || !persisted.advancementId.startsWith('derived:')) return clone(persisted);
    return { ...clone(current), ...clone(persisted), options: [...(current.options ?? [])], abilityOptions: [...(current.abilityOptions ?? [])] };
  });
  for (const persisted of selection.selections) if (!generated.has(persisted.advancementId)) selections.push(clone(persisted));
  const restored = { ...source.configuration, class: { ...selection.class }, targetLevel: selection.targetLevel, selections, choices: selections.filter(isInteractive) };
  const activeAdvancementIds = new Set(source.configuration.selections.map((entry) => entry.advancementId));
  return { ...restored, choices: selections.filter((entry) => isInteractive(entry) && activeAdvancementIds.has(entry.advancementId) && isClassSelectionAvailable(entry, selections)), diagnostics: validateClassConfiguration(restored, source) };
}
export function toClassProgressionSelection(configuration: ClassConfiguration): ClassProgressionSelection {
  const subclass = configuration.selections.find((e): e is Extract<ClassAdvancementSelection, { kind: 'subclass' }> => e.kind === 'subclass' && e.selected !== undefined)?.selected;
  return { class: { ...configuration.class }, targetLevel: configuration.targetLevel, ...(subclass ? { subclass: { ...subclass } } : {}), selections: configuration.selections.map(clone) };
}

function projectSelection(a: ClassAdvancementSummary, targetLevel: number): ClassAdvancementSelection[] { const c = record(a.raw.configuration); const deps = a.dependencies.flatMap((d) => d.source ? [d.source] : []); const pool = configuredPool(c); if (a.type === 'AbilityScoreImprovement') return [{ advancementId: a.id, kind: 'ability-score', assignments: {}, points: number(c.points) ?? 2, cap: number(c.cap), locked: strings(c.locked), fixed: recordNumbers(c.fixed), recommendation: recordNumbers(c.recommendation), featOptions: deps.filter((d) => d.type.includes('feat')) }]; if (a.type === 'Subclass') return [{ advancementId: a.id, kind: 'subclass', options: deps }]; if (a.type === 'ItemChoice' && c.type === 'spell') { const count = choiceCount(c, targetLevel) ?? 1; const options = deps.filter((source) => source.type === 'spell').map((source): SpellChoiceOption => ({ value: `${source.pack}:${source.type}:${source.id}`, source, label: source.name })); return [{ advancementId: a.id, kind: 'spell', selectionRole: a.spellLevel === 0 ? 'cantrips-known' : 'known-spells', selected: [], count, ...(a.spellLevel === undefined ? {} : { level: a.spellLevel }), spellLists: [...(a.spellLists ?? [])], abilityOptions: [...(a.abilityOptions ?? [])], options, raw: a.raw, configuredPool: pool, ...(a.requiresChoice === undefined ? {} : { requiresChoice: a.requiresChoice }), ...(typeof c.ability === 'string' ? { ability: c.ability } : {}) }]; } if (a.type === 'ItemChoice') return [{ advancementId: a.id, kind: 'item', selected: [], configuredPool: pool }]; if (a.type === 'Trait' && pool.length > 0) return [c.mode === 'expertise' ? { advancementId: a.id, kind: 'expertise', mode: 'expertise', selected: [], configuredPool: pool } : { advancementId: a.id, kind: 'trait', selected: [], configuredPool: pool }]; return []; }
function validateSelection(s: ClassAdvancementSelection, config: ClassConfiguration): void { const a = config.advancements.find((e) => e.id === s.advancementId); if (!a) { if (s.kind === 'spell') { const derived = getLevelOneDerivedSpellChoices(config.summary).find((choice) => choice.advancementId === s.advancementId); if (derived?.kind === 'spell') { validateDerivedSpellSelection(s, derived, config.summary); return; } } throw new Error(`Unknown class advancement: ${s.advancementId}`); } if (s.kind === 'spell') { validateSpellSelection(s, a, config.targetLevel); return; } const c = record(a.raw.configuration); const groups = choiceGroups(c); const count = groups.length === 0 ? choiceCount(c) : undefined; const configured = configuredPool(c); const values = s.kind === 'trait' || s.kind === 'expertise' ? s.selected : s.kind === 'item' ? s.selected.map((v) => v.id) : []; if ((c.mode === 'expertise') !== (s.kind === 'expertise')) throw new Error(`Invalid expertise configuration: ${s.advancementId}`); if (new Set(values).size !== values.length) throw new Error(`Duplicate class selection: ${s.advancementId}`); if (count !== undefined && values.length > count) throw new Error(`Invalid class selection cardinality: ${s.advancementId}`); if (groups.length > 0 && groups.some((group) => values.filter((value) => group.pool.some((candidate) => samePoolValue(candidate, value))).length > group.count)) throw new Error(`Invalid class selection cardinality: ${s.advancementId}`); if ((s.kind === 'trait' || s.kind === 'expertise' || s.kind === 'item') && values.some((v) => !configured.some((candidate) => samePoolValue(candidate, v)))) throw new Error(`Invalid class selection value: ${s.advancementId}`); if (s.kind === 'item' && values.some((v) => !a.dependencies.some((d) => d.source?.id === v))) throw new Error(`Unresolved class selection value: ${s.advancementId}`); if (s.kind === 'subclass' && s.selected && !s.options.some((o) => o.id === s.selected!.id)) throw new Error(`Invalid subclass selection: ${s.advancementId}`); if (s.kind === 'ability-score') validateAsi(s); }
function validateDerivedSpellSelection(selection: Extract<ClassAdvancementSelection, { kind: 'spell' }>, generated: Extract<ClassAdvancementSelection, { kind: 'spell' }>, summary: ClassSourceSummary): void { if (selection.selectionRole !== generated.selectionRole || selection.count !== generated.count || selection.level !== generated.level || !sameStrings(selection.spellLists, generated.spellLists)) throw new Error(`Invalid class advancement metadata: ${selection.advancementId}`); const options = summary.spellOptions ?? []; if (new Set(selection.selected.map((value) => `${value.sourcePath}:${value.pack}:${value.type}:${value.id}`)).size !== selection.selected.length || selection.count !== undefined && selection.selected.length > selection.count) throw new Error(`Invalid class selection cardinality: ${selection.advancementId}`); for (const value of selection.selected) { const option = options.find((candidate) => candidate.sourcePath === value.sourcePath && candidate.pack === value.pack && candidate.type === value.type && candidate.id === value.id); if (option === undefined) throw new Error(`Invalid class selection value: ${selection.advancementId}`); if (selection.level !== undefined && spellNumber(option, 'level') !== selection.level) throw new Error(`Invalid class spell level: ${selection.advancementId}`); const requiredLists = (selection.spellLists ?? []).map((list) => list.toLocaleLowerCase()); const sourceLists = (spellStrings(option, 'spellLists') ?? []).map((list) => list.toLocaleLowerCase()); if (requiredLists.length > 0 && !sourceLists.some((list) => requiredLists.includes(list))) throw new Error(`Invalid class spell list: ${selection.advancementId}`); } }
function sameStrings(left: string[] | undefined, right: string[] | undefined): boolean { if (left === undefined || right === undefined || left.length !== right.length) return left === right; return left.every((value, index) => value === right[index]); }
function validateSpellSelection(selection: Extract<ClassAdvancementSelection, { kind: 'spell' }>, advancement: ClassAdvancementSummary, targetLevel: number): void { const options = selection.options ?? advancement.dependencies.flatMap((dependency): SpellChoiceOption[] => dependency.source?.type === 'spell' ? [{ value: `${dependency.source.pack}:${dependency.source.type}:${dependency.source.id}`, source: dependency.source, label: dependency.source.name }] : []); const count = selection.count ?? choiceCount(record(advancement.raw.configuration), targetLevel) ?? 1; const configured = configuredPool(record(advancement.raw.configuration)); const selected = selection.selected; if (new Set(selected.map((value) => `${value.sourcePath}:${value.pack}:${value.type}:${value.id}`)).size !== selected.length || selected.length > count) throw new Error(`Invalid class selection cardinality: ${advancement.id}`); for (const value of selected) { const option = options.find((candidate) => candidate.source.sourcePath === value.sourcePath && candidate.source.pack === value.pack && candidate.source.type === value.type && candidate.source.id === value.id); if (option === undefined || configured.length > 0 && !configured.some((candidate) => samePoolValue(candidate, value.id))) throw new Error(`Invalid class selection value: ${advancement.id}`); const sourceLevel = spellNumber(option?.source, 'level'); const sourceLists = spellStrings(option?.source, 'spellLists'); if (selection.level !== undefined && sourceLevel !== undefined && sourceLevel !== selection.level) throw new Error(`Invalid class spell level: ${advancement.id}`); if ((selection.spellLists ?? advancement.spellLists ?? []).length > 0 && sourceLists !== undefined && !sourceLists.some((list) => (selection.spellLists ?? advancement.spellLists ?? []).includes(list))) throw new Error(`Invalid class spell list: ${advancement.id}`); } const ability = selection.selectedAbility ?? selection.ability; const abilities = selection.abilityOptions ?? advancement.abilityOptions ?? []; if (ability !== undefined && abilities.length > 0 && !abilities.includes(ability)) throw new Error(`Invalid class spellcasting ability: ${advancement.id}`); }
function validateAsi(s: Extract<ClassAdvancementSelection, { kind: 'ability-score' }>): void { const keys = new Set(s.allowedAbilities ?? ['str','dex','con','int','wis','cha']); const locked = new Set(s.locked ?? []); let total = 0; for (const [key, value] of Object.entries(s.assignments)) { if (!keys.has(key)) throw new Error(`Unrecognized ability: ${key}`); if (locked.has(key)) throw new Error(`Locked ability: ${key}`); if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ASI assignment: ${key}`); if (s.cap !== undefined && value > s.cap) throw new Error(`ASI assignment exceeds cap: ${key}`); total += value; } if (total !== s.points) throw new Error(`Invalid ability-score point total: ${s.advancementId}`); if (s.feat && s.featOptions?.length && !s.featOptions.some((f) => f.id === s.feat!.id)) throw new Error(`Invalid ASI feat: ${s.advancementId}`); }
function choiceCount(c: Record<string, unknown>, activeLevel?: number): number | undefined { if (number(c.choices) !== undefined) return number(c.choices); const choices = isRecord(c.choices) ? Object.entries(c.choices).flatMap(([level, value]) => { const entry = record(value); const numericLevel = /^\d+$/.test(level) ? Number(level) : undefined; return numericLevel === undefined || activeLevel === undefined || numericLevel <= activeLevel ? [{ level: numericLevel ?? -1, count: number(entry.count) }] : []; }) : choiceGroupEntries(c.choices).map((entry) => ({ level: -1, count: number(entry.count) })); const selected = choices.filter((entry) => entry.count !== undefined).sort((left, right) => right.level - left.level)[0]; return selected?.count; }
function configuredPool(c: Record<string, unknown>): string[] { const raw = c.pool ?? choiceGroupEntries(c.choices).flatMap((entry) => entry.pool as unknown); return poolValues(raw); }
function choiceGroups(c: Record<string, unknown>): Array<{ count: number; pool: string[] }> { return choiceGroupEntries(c.choices).flatMap((group) => { const count = number(group.count); const pool = poolValues(group.pool); return count !== undefined && pool.length > 0 ? [{ count, pool }] : []; }); }
function choiceGroupEntries(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.map(record) : Object.values(record(value)).map(record); }
function poolValues(value: unknown): string[] { return Array.isArray(value) ? value.flatMap((entry) => typeof entry === 'string' ? [entry] : typeof record(entry).uuid === 'string' ? [record(entry).uuid as string] : []) : []; }
function samePoolValue(left: string, right: string): boolean {
  const normalizedLeft = poolValueId(left);
  const normalizedRight = poolValueId(right);
  if (normalizedLeft.endsWith(':*')) return normalizedRight.startsWith(normalizedLeft.slice(0, -1));
  if (normalizedRight.endsWith(':*')) return normalizedLeft.startsWith(normalizedRight.slice(0, -1));
  return normalizedLeft === normalizedRight;
}
function poolValueId(value: string): string { return value.startsWith('Compendium.') ? value.split('.').at(-1) ?? value : value; }
function spellNumber(source: FoundrySourceReference | undefined, key: string): number | undefined { if (source === undefined || !isRecord(source)) return undefined; return number(source[key]); }
function spellStrings(source: FoundrySourceReference | undefined, key: string): string[] | undefined { if (source === undefined || !isRecord(source) || !Array.isArray(source[key])) return undefined; return source[key].filter((value): value is string => typeof value === 'string'); }
function isClassSelectionAvailable(selection: ClassAdvancementSelection, selections: ClassAdvancementSelection[]): boolean {
  if (selection.kind !== 'spell' || selection.requiresChoice === undefined) return true;
  const parent = selections.find((candidate) => candidate.advancementId === selection.requiresChoice?.key.replace(/^class:/, ''));
  if (parent === undefined) return false;
  const requiredId = selection.requiresChoice.value.split('.').at(-1);
  if (parent.kind === 'item') return parent.selected.some((value) => value.id === requiredId);
  if (parent.kind === 'subclass') return parent.selected?.id === requiredId;
  return false;
}
function isInteractive(s: ClassAdvancementSelection): boolean { return s.kind === 'trait' || s.kind === 'expertise' || s.kind === 'item' || s.kind === 'spell' || s.kind === 'subclass' || s.kind === 'ability-score'; }
function unresolvedDiagnostics(as: ClassAdvancementSummary[], summary: ClassSourceSummary): string[] { return as.flatMap((a) => a.dependencies.filter((d) => !d.source && d.reason !== 'unresolved selector').map((d) => `Unresolved class dependency at ${summary.source.sourcePath}: ${a.id} -> ${d.uuid}`)).concat(as.filter((a) => !['HitPoints', 'Trait', 'ItemGrant', 'ScaleValue', 'ItemChoice', 'Subclass', 'AbilityScoreImprovement'].includes(a.type)).map((a) => `Unsupported class advancement at ${summary.source.sourcePath}: ${a.id} (${a.type})`)); }
function foundry(s: SourceSnapshot): CharacterFoundryReference { return { systemVersion: s.systemVersion, sourceBranch: s.branch, sourceCommit: s.commit }; }
function sameFoundry(f: CharacterFoundryReference, s: SourceSnapshot): boolean { return f.systemVersion === s.systemVersion && f.sourceBranch === s.branch && f.sourceCommit === s.commit; }
function clone<T extends ClassAdvancementSelection>(s: T): T { return structuredClone(s); }
function record(v: unknown): Record<string, unknown> { return isRecord(v) ? v : {}; }
function number(v: unknown): number | undefined { return typeof v === 'number' && Number.isFinite(v) ? v : undefined; }
function strings(v: unknown): string[] | undefined { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined; }
function recordNumbers(v: unknown): Record<string, number> | undefined { const r = record(v); const entries = Object.entries(r).filter((e): e is [string, number] => typeof e[1] === 'number'); return entries.length ? Object.fromEntries(entries) : undefined; }
