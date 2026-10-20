import type { Ability, AbilityScoreResults } from './ability-scores';
import type { CharacterDocument } from './character-model';
import type { FoundryActivitySummary, FoundryUsesSummary } from './foundry-activity-summary';
import type { FeatureSheetActivity } from './feature-sheet-model';
import type { FoundryItemSummary, FoundrySpellSummary } from './foundry-source-catalog';
import type { ResolvedInventoryItems } from './inventory-sheet-model';
import type { SheetValue } from './character-sheet-model';
import { recoverableResetForUses } from './resource-period';
import { isWeaponTrained } from './weapon-training';
import type { PassiveEffectContribution } from './passive-effects';

export type ActionGroupKey = 'attacks' | 'actions' | 'bonus-actions' | 'reactions' | 'other' | 'at-will' | 'limited-use';
export interface ActionSheetEntry {
  name: string;
  source: string;
  executable: false;
  staticReference?: boolean;
  activation?: string;
  attackBonus: SheetValue<number>;
  saveDc?: SheetValue<number>;
  saveAbility?: string;
  range?: string;
  damage?: string;
  target?: FoundryActivitySummary['target'];
  save?: FoundryActivitySummary['save'];
  description?: string;
  weaponProperties?: string[];
  weaponMastery?: string;
  resource?: { current: SheetValue<number>; maximum: SheetValue<number | string>; reset: SheetValue<string> };
  resourceKey?: string;
  diagnostics: string[];
  factKind?: 'attack' | 'save' | 'damage';
}
export interface ActionSheetGroup { key: ActionGroupKey; label: string; entries: ActionSheetEntry[]; }
export interface ActionSheetProjection { groups: ActionSheetGroup[]; combatReference: string[]; weaponReferences?: Array<{ name: string; description?: string }>; warnings: string[]; }
export interface ActionSheetSpellRow { name: string; level?: number; source: SheetValue<FoundrySpellSummary>; prepared?: SheetValue<boolean>; ownership?: string[]; }
export interface ActionSheetFeatureActivity { sourceName: string; activity: FeatureSheetActivity; }
export interface ActionSheetProjectionInput {
  inventoryItems?: ResolvedInventoryItems;
  spellRows?: ActionSheetSpellRow[];
  featureActivities?: ActionSheetFeatureActivity[];
  abilityResults?: AbilityScoreResults;
  proficiencyBonus: SheetValue<number>;
  weaponTraining: string[];
  weaponMasteries?: ReadonlySet<string>;
  weaponPropertyDescriptions?: ReadonlyMap<string, string>;
  weaponMasteryDescriptions?: ReadonlyMap<string, string>;
  includeCombatReference?: boolean;
  spellAttackBonus?: SheetValue<number>;
  spellSaveDc?: SheetValue<number>;
  passiveEffects?: PassiveEffectContribution[];
}

const GROUPS: ReadonlyArray<{ key: ActionGroupKey; label: string }> = [
  { key: 'attacks', label: 'Attacks' }, { key: 'actions', label: 'Actions' }, { key: 'bonus-actions', label: 'Bonus actions' },
  { key: 'reactions', label: 'Reactions' }, { key: 'other', label: 'Other' }, { key: 'at-will', label: 'At will' }, { key: 'limited-use', label: 'Limited use' },
];
const STATIC_REFERENCES: ReadonlyArray<string> = ['Dash', 'Disengage', 'Dodge', 'Help', 'Hide', 'Ready', 'Search'];
const WEAPON_PROPERTY_NAMES: Readonly<Record<string, string>> = { amm: 'Ammunition', fin: 'Finesse', hvy: 'Heavy', lgt: 'Light', lod: 'Loading', rch: 'Reach', spc: 'Special', thr: 'Thrown', two: 'Two-Handed', ver: 'Versatile', mgc: 'Magical', ret: 'Returning' };

export function projectActionSheet(document: CharacterDocument, input: ActionSheetProjectionInput): ActionSheetProjection {
  const warnings: string[] = [];
  const groups = GROUPS.map((group) => ({ ...group, entries: [] as ActionSheetEntry[] }));
  const add = (key: ActionGroupKey, entry: ActionSheetEntry): void => { groups.find((group) => group.key === key)!.entries.push(entry); };
  for (const entry of document.mutable?.inventory.items ?? []) {
    const resolved = input.inventoryItems?.get(entry.entryId);
    if (resolved?.kind !== 'available') { if (resolved !== undefined) warnings.push(`${entry.entryId}: ${resolved.reason}`); continue; }
    const item = resolved.value;
    if (item.itemType.toLowerCase() !== 'weapon' || item.activities === undefined) continue;
    const statuses = (document.mutable?.equipmentStatus ?? []).filter((status) => status.entryId === entry.entryId);
    if (statuses.length !== 1) { warnings.push(`${item.name}: equipment status is ${statuses.length === 0 ? 'missing' : 'duplicated'}.`); continue; }
    const status = statuses[0]!;
    if (!status.equipped) continue;
    if (item.attunement === 'required' && !status.attuned) { warnings.push(`${item.name}: required attunement is not satisfied.`); continue; }
    for (const activity of item.activities) {
      const group = activityGroup(activity);
      add(group, activity.type.toLowerCase() === 'attack' ? weaponEntry(item, activity, input, warnings) : activityEntry(item.name, item.name, activity, false, input));
    }
  }
  for (const row of input.spellRows ?? []) {
    if (row.source.kind !== 'available' || !spellActionApplies(row)) continue;
    for (const activity of row.source.value.activities ?? []) add(activityGroup(activity), activityEntry(row.name, row.name, activity, false, input, row.source.value));
  }
  for (const feature of input.featureActivities ?? []) add(activityGroup(feature.activity, feature.activity.resource !== undefined, true), activityEntry(feature.sourceName, feature.sourceName, feature.activity, true, input));
  if (input.includeCombatReference) add('attacks', unarmedStrike(input));
  for (const group of groups) group.entries.sort((left, right) => left.name.localeCompare(right.name) || left.source.localeCompare(right.source));
  const references = new Map<string, { name: string; description?: string }>();
  for (const attack of groups.flatMap((group) => group.entries)) {
    for (const name of attack.weaponProperties ?? []) {
      const code = Object.keys(WEAPON_PROPERTY_NAMES).find((key) => WEAPON_PROPERTY_NAMES[key] === name);
      references.set(`property:${name}`, { name, ...(code === undefined || input.weaponPropertyDescriptions?.get(code) === undefined ? {} : { description: input.weaponPropertyDescriptions.get(code) }) });
    }
    if (attack.weaponMastery !== undefined) {
      const name = attack.weaponMastery;
      references.set(`mastery:${name}`, { name, ...(input.weaponMasteryDescriptions?.get(name.toLocaleLowerCase()) === undefined ? {} : { description: input.weaponMasteryDescriptions.get(name.toLocaleLowerCase()) }) });
    }
  }
  return { groups, combatReference: input.includeCombatReference ? [...STATIC_REFERENCES] : [], weaponReferences: [...references.values()].sort((left, right) => left.name.localeCompare(right.name)), warnings };
}

function spellActionApplies(row: ActionSheetSpellRow): boolean {
  const level = row.level ?? (row.source.kind === 'available' ? row.source.value.level : undefined);
  // Cantrips are at-will and therefore do not have a preparation state to
  // enable. Leveled spells require the projected preparation state to be
  // explicitly available and true; missing state must not leak into Actions.
  return level === 0 || (row.prepared?.kind === 'available' && row.prepared.value === true);
}

function weaponEntry(item: FoundryItemSummary, activity: FoundryActivitySummary, input: ActionSheetProjectionInput, warnings: string[]): ActionSheetEntry {
  const diagnostics: string[] = [];
  const attack = activity.attack;
  const ability = weaponAbility(item, activity, input.abilityResults);
  const trained = isWeaponTrained(item, input.weaponTraining);
  const magicalBonus = item.magicalBonus ?? 0;
  let attackBonus: SheetValue<number>;
  if (attack?.bonus !== undefined && attack.bonus.trim().length > 0) { attackBonus = missing('Weapon attack formula is unsupported.'); diagnostics.push('Attack bonus formula is unsupported.'); warnings.push(`${item.name}: formula strings are not evaluated.`); }
  else if (ability === undefined || input.abilityResults === undefined || trained === undefined) attackBonus = missing('Weapon attack modifier requires understood ability and training data.');
  else if (trained && input.proficiencyBonus.kind === 'missing') attackBonus = missing('Weapon attack modifier requires a proficiency bonus.');
  else {
    const proficiency = input.proficiencyBonus.kind === 'available' ? input.proficiencyBonus.value : 0;
    const rangedBonus = attack?.type?.toLowerCase() === 'ranged'
      ? (input.passiveEffects ?? []).filter((effect) => effect.target === 'ranged-weapon-attack-bonus').reduce((total, effect) => total + effect.value, 0)
      : 0;
    attackBonus = available(input.abilityResults[ability].modifier + (trained ? proficiency : 0) + magicalBonus + rangedBonus);
  }
  const damage = activity.damage?.[0] ?? item.damage;
  let damageText: string | undefined;
  const hasDamageFormula = damage?.bonus !== undefined && damage.bonus.trim().length > 0;
  if (hasDamageFormula) { diagnostics.push('Damage formula is unsupported.'); warnings.push(`${item.name}: formula strings are not evaluated.`); }
  if (ability !== undefined && input.abilityResults !== undefined && damage?.number !== undefined && damage.denomination !== undefined) damageText = `${damage.number}d${damage.denomination}${hasDamageFormula ? '' : signed(input.abilityResults[ability].modifier + magicalBonus)}${damage.types.length > 0 ? ` ${damage.types.join(', ')}` : ''}`;
  const range = weaponRange(item, activity);
  const weaponProperties = [...new Set(item.properties.map((property) => WEAPON_PROPERTY_NAMES[property] ?? property))].sort((left, right) => left.localeCompare(right));
  const weaponMastery = hasWeaponMastery(item, input.weaponMasteries) ? humanizeMastery(item.mastery!) : undefined;
  const description = item.description?.trim();
  return { name: item.name, source: item.name, executable: false, activation: activity.activation?.type, attackBonus, saveDc: missing('Saving throw DC is not applicable.'), factKind: 'attack', ...(range === undefined ? {} : { range }), ...(damageText === undefined ? {} : { damage: damageText }), ...(description ? { description } : {}), ...(weaponProperties.length === 0 ? {} : { weaponProperties }), ...(weaponMastery === undefined ? {} : { weaponMastery }), diagnostics };
}

function hasWeaponMastery(item: FoundryItemSummary, weaponMasteries: ReadonlySet<string> | undefined): boolean {
  const identifiers = [item.subcategory, item.identifier, item.id]
    .flatMap((value) => value?.trim() ? [value.trim().toLocaleLowerCase()] : []);
  const mastery = item.mastery?.trim();
  return !!mastery && identifiers.some((identifier) => weaponMasteries?.has(identifier) === true);
}
function humanizeMastery(value: string): string { return value.charAt(0).toLocaleUpperCase() + value.slice(1); }

function activityEntry(name: string, source: string, activity: FeatureSheetActivity, isFeature = false, input?: ActionSheetProjectionInput, spell?: FoundrySpellSummary): ActionSheetEntry {
  const featureResource = isFeature ? activity.resource : undefined;
  // Only feature resources have a persisted mutable key here. Action/spell
  // activity uses without a projected resource are display-only until their
  // owning subsystem supplies authoritative state.
  const resourceKey = featureResource?.key;
  const resourceValue = featureResource !== undefined
    ? { key: featureResource.key, current: featureResource.current, maximum: featureResource.maximum, reset: featureResource.reset }
    : !isFeature && activity.uses !== undefined && recoverableResetForUses(activity.uses) !== undefined
      ? resource(activity.uses)
      : undefined;
  const diagnostics: string[] = [];
  const damage = activity.resolvedDamage ?? formatActivityDamage(activity, diagnostics);
  const save = activity.save;
  const saveDc = save === undefined ? missing<number>('Saving throw DC is unavailable.') : resolveSaveDc(save, input?.abilityResults, input?.proficiencyBonus, input?.spellSaveDc, diagnostics);
  const range = formatActivityRange(activity.range ?? spell?.range, activity.target);
  const attackBonus: SheetValue<number> = activity.attack === undefined ? missing<number>('Attack modifier is not applicable.') : spell !== undefined ? (input?.spellAttackBonus ?? missing<number>('Spell attack bonus is unavailable.')) : missing<number>('Attack modifier is unavailable.');
  const factKind = activity.attack !== undefined || activity.type.toLowerCase() === 'attack' ? 'attack' : save !== undefined ? 'save' : damage !== undefined ? 'damage' : undefined;
  return { name: activity.name ?? name, source, executable: false, activation: activity.activation?.type, attackBonus, saveDc, ...(factKind === undefined ? {} : { factKind }), ...(save?.ability?.[0] === undefined ? {} : { saveAbility: save.ability[0] }), ...(range === undefined ? {} : { range }), ...(damage === undefined ? {} : { damage }), ...(activity.target === undefined ? {} : { target: activity.target }), ...(save === undefined ? {} : { save }), ...(resourceValue === undefined ? {} : { resource: { current: resourceValue.current, maximum: resourceValue.maximum, reset: resourceValue.reset }, ...(resourceKey === undefined ? {} : { resourceKey }) }), diagnostics };
}
function unarmedStrike(input: ActionSheetProjectionInput): ActionSheetEntry {
  const strength = input.abilityResults?.str.modifier;
  const attackBonus = strength === undefined || input.proficiencyBonus.kind === 'missing'
    ? missing<number>('Unarmed strike requires Strength and proficiency bonus.')
    : available(strength + input.proficiencyBonus.value);
  return {
    name: 'Unarmed strike', source: 'Combat reference', executable: false, staticReference: true, attackBonus, saveDc: missing('Saving throw DC is not applicable.'),
    range: '5 ft.', factKind: 'attack', ...(strength === undefined ? {} : { damage: `${Math.max(0, 1 + strength)} bludgeoning` }), diagnostics: [],
  };
}
function resource(uses: FoundryUsesSummary): NonNullable<ActionSheetEntry['resource']> {
  const reset = recoverableResetForUses(uses);
  return {
    current: missing('Current use state is unavailable.'),
    maximum: uses.maximum === undefined ? missing('Maximum uses are unavailable.') : available(uses.maximum),
    reset: reset === undefined ? missing('Recovery period is unavailable.') : available(reset === 'short-rest' ? 'short rest' : 'long rest'),
  };
}

function resolveSaveDc(save: NonNullable<FoundryActivitySummary['save']>, abilities: AbilityScoreResults | undefined, proficiency: SheetValue<number> | undefined, spellSaveDc: SheetValue<number> | undefined, diagnostics: string[]): SheetValue<number> {
  if (save.dc?.formula?.trim()) {
    diagnostics.push('Saving throw DC formulas are unsupported.');
    return missing('Saving throw DC formula is unsupported.');
  }
  const calculation = normalizeAbility(save.dc?.calculation);
  if (save.dc?.calculation?.toLowerCase() === 'spellcasting') return spellSaveDc ?? missing('Spell save DC is unavailable.');
  if (calculation === undefined) {
    diagnostics.push('Saving throw DC calculation is unavailable or unsupported.');
    return missing('Saving throw DC calculation is unavailable or unsupported.');
  }
  if (abilities === undefined || abilities[calculation] === undefined) {
    diagnostics.push(`Saving throw DC requires the ${calculation.toUpperCase()} modifier.`);
    return missing(`Saving throw DC requires the ${calculation.toUpperCase()} modifier.`);
  }
  if (proficiency?.kind !== 'available') {
    diagnostics.push('Saving throw DC requires a proficiency bonus.');
    return missing('Saving throw DC requires a proficiency bonus.');
  }
  return available(8 + proficiency.value + abilities[calculation].modifier);
}

function formatActivityRange(range: FoundryActivitySummary['range'], target: FoundryActivitySummary['target']): string | undefined {
  const nonBlank = (value: string | number | undefined): string | undefined => typeof value === 'number' ? String(value) : value?.trim() || undefined;
  const rangeUnits = nonBlank(range?.units);
  const rangeValue = nonBlank(range?.value);
  const rangeLabel = nonBlank(range?.special) ?? (rangeUnits?.toLowerCase() === 'self' ? 'Self' : rangeValue === undefined ? undefined : `${rangeValue}${rangeUnits === undefined ? '' : ` ${formatRangeUnits(rangeUnits)}`}`);
  if (target === undefined) return rangeLabel;
  const template = target.template;
  if (template === undefined) return rangeLabel ?? (target.affects?.type?.trim().toLowerCase() === 'self' ? 'Self' : undefined);
  const rawUnits = nonBlank(template.units);
  const units = rawUnits === 'ft' ? 'ft.' : rawUnits;
  const templateSize = nonBlank(template.size);
  const size = templateSize === undefined ? undefined : `${templateSize}${units === undefined ? '' : ` ${units}`}`;
  const type = nonBlank(template.type);
  const templateWidth = nonBlank(template.width);
  const width = templateWidth === undefined ? undefined : `${templateWidth}${units === undefined ? '' : ` ${units}`} wide`;
  const templateLabel = [size, type, width === undefined ? undefined : `(${width})`].filter((value): value is string => value !== undefined && value.length > 0).join(' ') || (target.affects?.type === 'self' ? 'Self' : undefined);
  return [rangeLabel, templateLabel].filter((value): value is string => value !== undefined && value.length > 0).join('; ') || undefined;
}

function formatActivityDamage(activity: FoundryActivitySummary, diagnostics: string[]): string | undefined {
  if (activity.damage === undefined || activity.damage.length === 0) return undefined;
  const parts = activity.damage.flatMap((part) => {
    if (part.customFormula !== undefined) { diagnostics.push('Damage formula is unsupported.'); return []; }
    if (part.number === undefined || part.denomination === undefined) { diagnostics.push('Damage dice are unavailable.'); return []; }
    const bonus = part.bonus?.trim();
    return [`${part.number}d${part.denomination}${bonus ? ` ${bonus}` : ''}${part.types.length > 0 ? ` ${part.types.join(', ')}` : ''}`];
  });
  return parts.length === 0 ? undefined : parts.join(' + ');
}
function activityGroup(activity: FoundryActivitySummary, hasFeatureResource?: boolean, isFeature = false): ActionGroupKey {
  const recoverable = hasFeatureResource ?? recoverableResetForUses(activity.uses) !== undefined;
  if (recoverable) return 'limited-use';
  if (activity.type.toLowerCase() === 'attack') return 'attacks';
  const activation = activity.activation?.type.toLowerCase();
  if (activation === 'action') return 'actions';
  if (activation === 'bonus' || activation === 'bonusaction' || activation === 'bonus-action') return 'bonus-actions';
  if (activation === 'reaction') return 'reactions';
  return isFeature ? 'at-will' : 'other';
}
function normalizeAbility(value: string | undefined): Ability | undefined { const key = value?.toLowerCase(); return ({ str: 'str', strength: 'str', dex: 'dex', dexterity: 'dex', con: 'con', constitution: 'con', int: 'int', intelligence: 'int', wis: 'wis', wisdom: 'wis', cha: 'cha', charisma: 'cha' } as Record<string, Ability | undefined>)[key ?? '']; }
function weaponAbility(item: FoundryItemSummary, activity: FoundryActivitySummary, results: AbilityScoreResults | undefined): Ability | undefined {
  const explicit = normalizeAbility(activity.attack?.ability);
  if (explicit !== undefined) return explicit;
  if (item.properties.includes('fin') || item.category?.toLowerCase() === 'natural') {
    if (results === undefined) return undefined;
    return results.dex.modifier > results.str.modifier ? 'dex' : 'str';
  }
  const attackType = activity.attack?.type?.toLowerCase();
  if (attackType === 'melee') return 'str';
  if (attackType === 'ranged') return 'dex';
  const category = item.category?.toLowerCase();
  if (category?.endsWith('m')) return 'str';
  if (category?.endsWith('r')) return 'dex';
  return undefined;
}
function weaponRange(item: FoundryItemSummary, activity: FoundryActivitySummary): string | undefined {
  if (activity.range?.special?.trim()) return activity.range.special.trim();
  const value = activity.range?.value ?? item.range?.value;
  const long = item.range?.long;
  const units = activity.range?.units ?? item.range?.units;
  if (value === undefined && long === undefined) return units?.trim() || undefined;
  const distance = long === undefined ? String(value ?? long) : value === undefined ? String(long) : `${String(value)}/${String(long)}`;
  return `${distance}${units?.trim() ? ` ${formatRangeUnits(units)}` : ''}`;
}
function formatRangeUnits(units: string): string { return units === 'ft' ? 'ft.' : units; }
function signed(value: number): string { return value >= 0 ? `+${value}` : String(value); }
function available<T>(value: T): SheetValue<T> { return { kind: 'available', value }; }
function missing<T>(reason: string): SheetValue<T> { return { kind: 'missing', reason }; }
