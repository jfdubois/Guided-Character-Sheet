import type { Ability, AbilityScoreResults } from './ability-scores';
import type { CharacterDocument } from './character-model';
import type { ClassProgressionSelection } from './class-configuration';
import { getLevelOneDerivedSpellChoices } from './class-configuration';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from './character-sources';
import type { FoundrySourceReference, FoundrySpellSummary } from './foundry-source-catalog';
import { projectClassLevelProgression } from './class-level-progression';
import type { SheetValue } from './character-sheet-model';
import { isRecord } from './foundry-utils';
import { buildGrantedFeatConfiguration, restoreGrantedFeatConfiguration, validateGrantedFeatConfiguration, type GrantedFeatChoiceConfiguration } from './granted-feat-configuration';
import type { MutableSpellOwnership } from './mutable-character-state';
import type { PassiveEffectContribution } from './passive-effects';

export interface SpellSheetRow {
  name: string;
  level: number;
  source: SheetValue<FoundrySpellSummary>;
  prepared: SheetValue<boolean>;
  ownership: string[];
  grantMaximum?: number;
  grantRecoveryPeriod?: string;
  grantPreparation?: string;
  grantRequireSlot?: boolean;
  preparationBlockedReason?: string;
}

export interface SpellSheetLevel {
  level: number;
  spells: SpellSheetRow[];
  slots: { maximum: number; expended: SheetValue<number> };
}

export interface SpellSheetUnresolvedSpell {
  name: string;
  source: SheetValue<FoundrySpellSummary>;
  reason: string;
  ownership?: string[];
}

export interface SpellSheetFreeUse {
  key: string;
  name: string;
  maximum: number;
  current: SheetValue<number>;
  recoveryPeriod?: string;
}

export interface SpellSheetProjection {
  kind: 'available' | 'empty';
  reason?: string;
  castingAbility: SheetValue<string>;
  spellModifier: SheetValue<number>;
  spellAttack: SheetValue<number>;
  saveDc: SheetValue<number>;
  cantrips: SpellSheetRow[];
  levels: SpellSheetLevel[];
  unresolvedSpells: SpellSheetUnresolvedSpell[];
  freeUses: SpellSheetFreeUse[];
  preparedCount?: number;
  preparedCapacity?: number;
  highestCastableSpellLevel?: number;
  cantripCapacity?: number;
  cantripCapacityBonus?: number;
  warnings: string[];
}

export interface SpellSheetProjectionInput {
  class?: ClassSourceSummary;
  species?: SpeciesSourceSummary;
  background?: BackgroundSourceSummary;
  progression?: ClassProgressionSelection;
  abilityResults?: AbilityScoreResults;
  proficiencyBonus?: SheetValue<number>;
  spellSummaries: ReadonlyMap<string, FoundrySpellSummary>;
  grantedSpells?: FoundrySourceReference[];
  passiveEffects?: PassiveEffectContribution[];
}

export function projectSpellSheet(document: CharacterDocument, input: SpellSheetProjectionInput): SpellSheetProjection {
  const warnings: string[] = [];
  const progression = input.progression ?? document.classProgressions?.[0];
  const classProgression = input.class === undefined ? undefined : projectClassLevelProgression(input.class, progression?.targetLevel ?? 1, input.abilityResults === undefined ? {} : { abilityModifiers: { str: input.abilityResults.str.modifier, dex: input.abilityResults.dex.modifier, con: input.abilityResults.con.modifier, int: input.abilityResults.int.modifier, wis: input.abilityResults.wis.modifier, cha: input.abilityResults.cha.modifier } });
  warnings.push(...(classProgression?.diagnostics ?? []));
  const casting = selectedAbility(progression, document, input.class, input.species, input.background, progression?.targetLevel ?? 1);
  const abilityName = casting.conflict === undefined ? casting.value : undefined;
  const ability = abilityKey(abilityName);
  const spellModifier: SheetValue<number> = casting.conflict !== undefined ? missing<number>(casting.conflict) : ability === undefined || input.abilityResults === undefined ? missing<number>('Resolved spellcasting ability is unavailable.') : available<number>(input.abilityResults[ability].modifier);
  const proficiencyBonus = input.proficiencyBonus ?? missing<number>('Proficiency bonus is unavailable.');
  const spellAttack = spellModifier.kind === 'available' && proficiencyBonus.kind === 'available' ? available(spellModifier.value + proficiencyBonus.value) : missing<number>(spellModifier.kind === 'missing' && casting.conflict !== undefined ? casting.conflict : 'Spell attack requires a resolved ability and proficiency bonus.');
  const saveDc: SheetValue<number> = spellAttack.kind === 'available' ? available<number>(spellAttack.value + 8) : missing<number>('Spell save DC requires a resolved ability and proficiency bonus.');
  const selected = collectSelected(document, input);
  const removed = new Set((document.mutable?.spellOverlay?.removed ?? []).map(referenceKey));
  const manageableOwnership = new Set<MutableSpellOwnership>(['cantrips-known', 'known-spells', 'spellbook']);
  const projectedSelected = selected.filter((entry) => !(removed.has(referenceKey(entry.reference)) && manageableOwnership.has(entry.ownership as MutableSpellOwnership)));
  const prepared = new Set((document.mutable?.preparedSpells ?? []).map(referenceKey));
  const rows = new Map<string, SpellSheetRow>();
  const unresolved = new Map<string, SpellSheetUnresolvedSpell>();
  for (const entry of projectedSelected) {
    const key = referenceKey(entry.reference);
    const summary = input.spellSummaries.get(key) ?? input.spellSummaries.get(shortReferenceKey(entry.reference));
    if (summary === undefined && !warnings.includes(`Spell source unavailable: ${entry.reference.name}`)) warnings.push(`Spell source unavailable: ${entry.reference.name}`);
    if (summary === undefined && entry.ownership !== 'cantrips-known') {
      const existing = unresolved.get(key);
      if (existing) { existing.ownership = [...new Set([...(existing.ownership ?? []), entry.ownership])]; }
      else unresolved.set(key, { name: entry.reference.name, source: missing('Spell source is unavailable.'), reason: 'Spell level is unavailable because the source record could not be resolved.', ownership: [entry.ownership] });
      continue;
    }
    const level = summary?.level ?? sourceLevel(entry.reference) ?? 0;
    const existing = rows.get(key);
    if (existing !== undefined) { if (!existing.ownership.includes(entry.ownership)) existing.ownership.push(entry.ownership); if (existing.grantMaximum === undefined && entry.grantMaximum !== undefined) existing.grantMaximum = entry.grantMaximum; if (existing.grantRecoveryPeriod === undefined && entry.grantRecoveryPeriod !== undefined) existing.grantRecoveryPeriod = entry.grantRecoveryPeriod; if (existing.grantPreparation === undefined && entry.grantPreparation !== undefined) existing.grantPreparation = entry.grantPreparation; if (existing.grantRequireSlot === undefined && entry.grantRequireSlot !== undefined) existing.grantRequireSlot = entry.grantRequireSlot; if (entry.grantPreparation === 'always') existing.prepared = available(true); continue; }
    rows.set(key, { name: summary?.name ?? entry.reference.name, level, source: summary === undefined ? missing('Spell source is unavailable.') : available(summary), prepared: available(summary?.preparation === 'always' || entry.grantPreparation === 'always' || prepared.has(key)), ownership: [entry.ownership], ...(entry.grantMaximum === undefined ? {} : { grantMaximum: entry.grantMaximum }), ...(entry.grantRecoveryPeriod === undefined ? {} : { grantRecoveryPeriod: entry.grantRecoveryPeriod }), ...(entry.grantPreparation === undefined ? {} : { grantPreparation: entry.grantPreparation }), ...(entry.grantRequireSlot === undefined ? {} : { grantRequireSlot: entry.grantRequireSlot }) });
  }
  for (const reference of document.mutable?.preparedSpells ?? []) {
    const key = referenceKey(reference);
    if (rows.has(key)) continue;
    if (removed.has(key)) continue;
    const summary = input.spellSummaries.get(key) ?? input.spellSummaries.get(shortReferenceKey(reference));
    if (summary === undefined && !warnings.includes(`Spell source unavailable: ${reference.name}`)) warnings.push(`Spell source unavailable: ${reference.name}`);
    if (summary === undefined) {
      const existing = unresolved.get(key);
      if (existing) { existing.ownership = [...new Set([...(existing.ownership ?? []), 'prepared'])]; }
      else unresolved.set(key, { name: reference.name, source: missing('Prepared spell source is unavailable.'), reason: 'Spell level is unavailable because the prepared spell source could not be resolved.', ownership: ['prepared'] });
      continue;
    }
    rows.set(key, { name: summary.name, level: summary.level, source: available(summary), prepared: available(true), ownership: ['prepared'] });
  }
  const preparedCapacity = classProgression?.spellcasting?.preparedCapacity;
  const highestCastableSpellLevel = classProgression?.spellcasting?.spellSlots?.reduce((highest, slot) => Math.max(highest, slot.level), 0) || undefined;
  const allRows = [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
  const preparedCount = allRows.filter((row) => preparationApplies(row) && row.prepared.kind === 'available' && row.prepared.value && (highestCastableSpellLevel === undefined || row.level <= highestCastableSpellLevel)).length;
  for (const row of allRows) {
    if (!preparationApplies(row)) continue;
    if (highestCastableSpellLevel !== undefined && row.level > highestCastableSpellLevel) row.preparationBlockedReason = 'Spell level is above the highest castable spell level.';
    else if (preparedCapacity !== undefined && row.prepared.kind === 'available' && !row.prepared.value && preparedCount >= preparedCapacity) row.preparationBlockedReason = 'Prepared spell capacity has been reached.';
  }
  const cantrips = allRows.filter((row) => row.level === 0);
  const levels = [...new Set(allRows.map((row) => row.level).filter((level) => level > 0).concat(classProgression?.spellcasting?.spellSlots?.map((slot) => slot.level) ?? [], document.mutable?.spellSlots?.map((slot) => slot.level) ?? []))].sort((a, b) => a - b).map((level): SpellSheetLevel => {
    const persisted = document.mutable?.spellSlots?.find((slot) => slot.level === level);
    const sourceMaximum = classProgression?.spellcasting?.spellSlots?.find((slot) => slot.level === level)?.maximum;
    return { level, spells: allRows.filter((row) => row.level === level), slots: { maximum: persisted?.maximum ?? sourceMaximum ?? 0, expended: persisted === undefined ? missing<number>('Slot expenditure is not persisted.') : available(persisted.maximum - persisted.current) } };
  });
  const freeUses = allRows.flatMap((row): SpellSheetFreeUse[] => {
    if (row.source.kind !== 'available') return [];
    const source = row.source.value;
    const maximum = row.grantMaximum ?? explicitMaximum(source.uses);
    if (maximum === undefined) return [];
    const recoveryPeriod = row.grantRecoveryPeriod ?? source.uses?.recovery?.[0]?.period;
    const persisted = document.mutable?.spellUses?.find((use) => use.key === referenceKey(source));
    return [{ key: referenceKey(source), name: row.name, maximum, current: persisted === undefined ? missing<number>('Free-use expenditure is not persisted.') : available(persisted.current), ...(recoveryPeriod === undefined ? {} : { recoveryPeriod }) }];
  });
  const unresolvedSpells = [...unresolved.values()];
  const hasCaster = classProgression?.spellcasting !== undefined || abilityName !== undefined || allRows.length > 0 || unresolvedSpells.length > 0;
  const cantripCapacityBonus = (input.passiveEffects ?? []).filter((effect) => effect.target === 'cantrip-capacity').reduce((total, effect) => total + effect.value, 0);
  const baseCantripCapacity = classProgression?.spellcasting?.cantripsKnown;
  const cantripCapacity = baseCantripCapacity === undefined ? undefined : baseCantripCapacity + cantripCapacityBonus;
  return { kind: hasCaster ? 'available' : 'empty', ...(hasCaster ? {} : { reason: 'No spellcasting progression is available.' }), castingAbility: abilityName === undefined ? missing(casting.conflict ?? 'Spellcasting ability is unavailable.') : available(abilityName), spellModifier, spellAttack, saveDc, cantrips, levels, unresolvedSpells, freeUses, preparedCount, ...(cantripCapacity === undefined ? (cantripCapacityBonus > 0 ? { cantripCapacityBonus } : {}) : { cantripCapacity }), ...(preparedCapacity === undefined ? {} : { preparedCapacity }), ...(highestCastableSpellLevel === undefined ? {} : { highestCastableSpellLevel }), warnings };
}

function collectSelected(document: CharacterDocument, input: SpellSheetProjectionInput): Array<{ reference: FoundrySourceReference; ownership: string; grantMaximum?: number; grantRecoveryPeriod?: string; grantPreparation?: string; grantRequireSlot?: boolean }> {
  const values: Array<{ reference: FoundrySourceReference; ownership: string; grantMaximum?: number; grantRecoveryPeriod?: string; grantPreparation?: string; grantRequireSlot?: boolean }> = [];
  for (const progression of document.classProgressions ?? []) {
    const allowed = input.class === undefined ? undefined : new Set([...input.class.advancements.filter((entry) => entry.level <= progression.targetLevel).map((entry) => entry.id), ...getLevelOneDerivedSpellChoices(input.class, progression.targetLevel).map((entry) => entry.advancementId)]);
    for (const selection of progression.selections) if (selection.kind === 'spell' && ['cantrips-known', 'known-spells', 'spellbook'].includes(selection.selectionRole) && (allowed === undefined || allowed.has(selection.advancementId))) {
      const grant = explicitGrantDetails(selection.raw);
      for (const reference of selection.selected) values.push({ reference, ownership: selection.selectionRole, ...(grant === undefined ? {} : { grantMaximum: grant.maximum, ...(grant.period === undefined ? {} : { grantRecoveryPeriod: grant.period }) }) });
    }
  }
  const targetLevel = input.progression?.targetLevel ?? document.classProgressions?.[0]?.targetLevel ?? 0;
  for (const choice of document.speciesConfiguration?.spellChoices ?? []) if (choice.kind === 'spell') for (const reference of choice.selected) {
    const advancement = input.species?.advancements.find((candidate) => candidate.id === choice.advancementId);
    if (input.species !== undefined && (advancement === undefined || advancement.level > targetLevel)) continue;
    const grant = explicitGrantDetails(advancement?.raw);
    values.push({ reference, ownership: 'granted', ...(grant === undefined ? {} : { grantMaximum: grant.maximum, ...(grant.period === undefined ? {} : { grantRecoveryPeriod: grant.period }) }) });
  }
  for (const grant of input.species?.spellGrants ?? []) if (grant.level <= targetLevel) for (const reference of grant.spells) {
    const details = explicitGrantDetails(grant.raw, input.proficiencyBonus?.kind === 'available' ? input.proficiencyBonus.value : undefined);
    const configuration = isRecord(grant.raw.configuration) ? grant.raw.configuration : undefined;
    const spell = configuration && isRecord(configuration.spell) ? configuration.spell : undefined;
    const uses = spell && isRecord(spell.uses) ? spell.uses : undefined;
    values.push({ reference, ownership: 'species-granted', ...(details === undefined ? {} : { grantMaximum: details.maximum, ...(details.period === undefined ? {} : { grantRecoveryPeriod: details.period }) }), ...(spell !== undefined && typeof spell.preparation === 'string' ? { grantPreparation: spell.preparation } : {}), ...(uses !== undefined && typeof uses.requireSlot === 'boolean' ? { grantRequireSlot: uses.requireSlot } : {}) });
  }
  const backgroundConfiguration = currentBackgroundConfiguration(document, input.background);
  if (backgroundConfiguration !== undefined) for (const choice of backgroundConfiguration.spellChoices) if (choice.advancementId !== 'spell-list') {
    const advancement = input.background?.grantedFeat?.advancements.find((candidate) => candidate.id === choice.advancementId);
    const grant = explicitGrantDetails(advancement?.raw);
    for (const reference of choice.selected) if (typeof reference !== 'string') values.push({ reference, ownership: 'granted', ...(grant === undefined ? {} : { grantMaximum: grant.maximum, ...(grant.period === undefined ? {} : { grantRecoveryPeriod: grant.period }) }) });
  }
  for (const reference of input.grantedSpells ?? []) values.push({ reference, ownership: 'granted' });
  for (const entry of document.mutable?.spellOverlay?.added ?? []) values.push({ reference: entry.reference, ownership: entry.ownership });
  return values;
}

function preparationApplies(row: SpellSheetRow): boolean {
  if (row.level === 0) return false;
  return row.grantPreparation !== 'always' && (row.source.kind !== 'available' || row.source.value.preparation !== 'always');
}

function currentBackgroundConfiguration(document: CharacterDocument, background: SpellSheetProjectionInput['background']): GrantedFeatChoiceConfiguration | undefined {
  const source = background?.grantedFeat;
  const selection = document.backgroundChoices?.grantedFeat;
  if (source === undefined || selection === undefined) return undefined;
  const built = buildGrantedFeatConfiguration(source);
  const restored = restoreGrantedFeatConfiguration(built, selection);
  if (restored.kind !== 'choice' || validateGrantedFeatConfiguration(restored, { requireComplete: true }).length > 0) return undefined;
  return restored;
}

function explicitGrantDetails(raw: Record<string, unknown> | undefined, proficiencyBonus?: number): { maximum: number; period?: string } | undefined {
  const configuration = raw && isRecord(raw.configuration) ? raw.configuration : undefined;
  const spell = configuration && isRecord(configuration.spell) ? configuration.spell : undefined;
  const uses = spell && isRecord(spell.uses) ? spell.uses : undefined;
  if (!uses || uses.requireSlot !== false) return undefined;
  const maximum = parseMaximum(uses.max, proficiencyBonus);
  return maximum === undefined ? undefined : { maximum, ...(typeof uses.per === 'string' ? { period: uses.per } : {}) };
}

function explicitMaximum(uses: FoundrySpellSummary['uses'] | undefined): number | undefined {
  return parseMaximum(uses?.maximum);
}

function parseMaximum(value: unknown, proficiencyBonus?: number): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? value : undefined;
  if (value === '@prof') return proficiencyBonus;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

function selectedAbility(progression: ClassProgressionSelection | undefined, document: CharacterDocument, classSource: ClassSourceSummary | undefined, species: SpeciesSourceSummary | undefined, background: SpellSheetProjectionInput['background'], targetLevel: number): { value?: string; conflict?: string } {
  const persistedProfiles = (progression?.selections ?? []).flatMap((entry): string[] => entry.kind === 'spell' && entry.selected.length > 0 ? [entry.selectedAbility ?? entry.ability].filter((value): value is string => value !== undefined) : []);
  const speciesProfiles = (document.speciesConfiguration?.spellChoices ?? []).flatMap((choice): string[] => choice.kind === 'spell' && choice.selected.length > 0 && choice.selectedAbility !== undefined ? [choice.selectedAbility] : []);
  const fixedSpeciesProfile = document.speciesConfiguration?.spellcastingAbility?.selected;
  const derivedSpeciesProfile = fixedSpeciesProfile === undefined ? deriveFixedSpeciesAbility(species, targetLevel) : undefined;
  const backgroundConfiguration = currentBackgroundConfiguration(document, background);
  const backgroundProfiles = backgroundConfiguration?.spellChoices.flatMap((choice): string[] => choice.advancementId !== 'spell-list' && choice.selected.length > 0 && choice.selectedAbility !== undefined ? [choice.selectedAbility] : []) ?? [];
  const profiles = [...persistedProfiles, ...speciesProfiles, ...backgroundProfiles, ...(fixedSpeciesProfile === undefined ? (derivedSpeciesProfile === undefined ? [] : [derivedSpeciesProfile]) : [fixedSpeciesProfile])];
  const distinctProfiles = [...new Set(profiles.map((value) => abilityKey(value) ?? value.toLowerCase()))];
  if (distinctProfiles.length > 1) return { conflict: 'Conflicting spellcasting abilities are unavailable.' };
  if (profiles.length > 0) return { value: profiles[0] };
  const sourceAbility = classSource?.spellcasting && typeof classSource.spellcasting.ability === 'string' ? classSource.spellcasting.ability : undefined;
  return { value: sourceAbility ?? (document.classProgressions?.[0]?.selections.find((entry): entry is Extract<typeof entry, { kind: 'spell' }> => entry.kind === 'spell')?.ability) };
}

function deriveFixedSpeciesAbility(species: SpeciesSourceSummary | undefined, targetLevel: number): string | undefined {
  const grants = (species?.spellGrants ?? []).filter((grant) => grant.level <= targetLevel && grant.abilityOptions.length > 0);
  if (grants.length === 0) return undefined;
  const common = grants[0]!.abilityOptions.filter((ability) => grants.every((grant) => grant.abilityOptions.includes(ability)));
  return common.length === 1 ? common[0] : undefined;
}

function abilityKey(value: string | undefined): Ability | undefined {
  const normalized = value?.toLowerCase();
  return ({ strength: 'str', str: 'str', dexterity: 'dex', dex: 'dex', constitution: 'con', con: 'con', intelligence: 'int', int: 'int', wisdom: 'wis', wis: 'wis', charisma: 'cha', cha: 'cha' } as Record<string, Ability | undefined>)[normalized ?? ''];
}
function referenceKey(value: FoundrySourceReference): string { return `${value.sourcePath}:${value.pack}:${value.type}:${value.id}`; }
function shortReferenceKey(value: FoundrySourceReference): string { return `${value.pack}:${value.type}:${value.id}`; }
function sourceLevel(value: FoundrySourceReference): number | undefined { const candidate = (value as FoundrySourceReference & { level?: unknown }).level; return typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0 ? candidate : undefined; }
function available<T>(value: T): SheetValue<T> { return { kind: 'available', value }; }
function missing<T>(reason: string): SheetValue<T> { return { kind: 'missing', reason }; }
