import type { CharacterDocument } from './character-model';
import type { FoundryItemSummary } from './foundry-source-catalog';
import { isFoundryInventoryEntry, type CustomInventoryItem, type InventoryEntry } from './inventory';
import type { EquipmentStatus } from './mutable-character-state';

export type InventoryProjectionValue<T> = { kind: 'available'; value: T } | { kind: 'missing'; reason: string };
export type ResolvedInventoryItems = ReadonlyMap<string, InventoryProjectionValue<FoundryItemSummary>>;

export interface InventoryActionPreview {
  kind: 'available';
  label: 'Equip' | 'Equipped' | 'Attune' | 'Attuned';
  active: boolean;
}

export interface InventorySheetRow {
  entryId: string;
  name: string;
  detail: string[];
  quantity: number;
  unitWeight: InventoryProjectionValue<{ value: number; units: string }>;
  stackWeight: InventoryProjectionValue<{ value: number; units: string }>;
  equipAction: InventoryActionPreview | { kind: 'missing'; reason: string } | null;
  attuneAction: InventoryActionPreview | { kind: 'missing'; reason: string } | null;
  notes: string[];
}

export interface InventoryArmorEffects {
  armorClass: InventoryProjectionValue<number>;
  stealthDisadvantageSources: string[];
}

export type InventorySheetProjection =
  | { kind: 'missing'; reason: string; warnings: string[] }
  | {
      kind: 'available';
      rows: InventorySheetRow[];
      totalWeight: InventoryProjectionValue<{ value: number; units: string }>;
      currency: { cp: number; sp: number; ep: number; gp: number; pp: number };
      armor: InventoryArmorEffects;
      warnings: string[];
    };

interface RowCapabilities {
  equippable: boolean;
  attunement?: 'optional' | 'required';
  weight?: { value: number; units?: string };
  type?: string;
  category?: string;
  armor?: { value: number; dex?: number };
  strength?: number;
  stealthDisadvantage?: boolean;
}

// Display labels for the pinned dnd5e weaponTypes codes; the source code stays intact.
const WEAPON_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  simpleM: 'simple melee',
  simpleR: 'simple ranged',
  martialM: 'martial melee',
  martialR: 'martial ranged',
  natural: 'natural',
  improv: 'improvised',
  siege: 'siege weapon',
};

export function projectInventorySheet(document: CharacterDocument, resolvedItems: ResolvedInventoryItems, dexterityModifier?: number, unarmoredDefense?: { calculation: 'unarmoredBarb' | 'unarmoredMonk' | 'unarmoredBard' | 'draconic'; secondaryModifier: number; base?: number }): InventorySheetProjection {
  const mutable = document.mutable;
  if (mutable === undefined) return { kind: 'missing', reason: 'Mutable inventory is not available from character finalization.', warnings: [] };
  const warnings: string[] = [];
  const rows = mutable.inventory.items.map((entry) => projectRow(entry, mutable.equipmentStatus, resolvedItems, warnings));
  rows.sort((left, right) => left.name.localeCompare(right.name) || left.entryId.localeCompare(right.entryId));
  const armor = projectArmor(document, resolvedItems, dexterityModifier, unarmoredDefense);
  if (armor.armorClass.kind === 'missing' && armor.armorClass.reason !== 'Dexterity modifier is unavailable for armor class projection.') warnings.push(armor.armorClass.reason);
  return {
    kind: 'available',
    rows,
    totalWeight: totalWeight(rows),
    currency: { ...mutable.inventory.currency },
    armor,
    warnings,
  };
}

function projectArmor(document: CharacterDocument, resolvedItems: ResolvedInventoryItems, dexterityModifier: number | undefined, unarmoredDefense?: { calculation: 'unarmoredBarb' | 'unarmoredMonk' | 'unarmoredBard' | 'draconic'; secondaryModifier: number; base?: number }): InventoryArmorEffects {
  const mutable = document.mutable;
  if (mutable === undefined) return { armorClass: { kind: 'missing', reason: 'Mutable inventory is not available from character finalization.' }, stealthDisadvantageSources: [] };
  const equippedArmor: Array<{ name: string; capabilities: RowCapabilities }> = [];
  const equippedShields: Array<{ name: string; capabilities: RowCapabilities }> = [];
  const stealthSources: string[] = [];
  let armorFailure: string | undefined;

  for (const entry of mutable.inventory.items) {
    const name = isFoundryInventoryEntry(entry) ? entry.source.name : entry.custom.name;
    const resolved = isFoundryInventoryEntry(entry) ? resolvedItems.get(entry.entryId) : undefined;
    const capabilities = isFoundryInventoryEntry(entry)
      ? resolved?.kind === 'available' ? fromFoundry(resolved.value) : undefined
      : fromCustom(entry.custom);
    if (capabilities === undefined) {
      armorFailure ??= `Item source details are unavailable for ${name}.`;
      continue;
    }
    const shield = capabilities.category === 'shield';
    const armor = capabilities.category !== undefined && ['light', 'medium', 'heavy', 'natural'].includes(capabilities.category);
    if (!shield && !armor) continue;
    const matches = mutable.equipmentStatus.filter((status) => status.entryId === entry.entryId);
    if (matches.length !== 1) {
      const status = matches.length === 0 ? 'missing' : 'duplicated';
      armorFailure ??= `Equipment status is ${status} for ${name}.`;
      continue;
    }
    if (!matches[0].equipped) continue;
    if (capabilities.stealthDisadvantage === true) stealthSources.push(name);
    if (shield) equippedShields.push({ name, capabilities });
    else equippedArmor.push({ name, capabilities });
  }

  const sources = [...new Set(stealthSources)].sort((left, right) => left.localeCompare(right));
  if (armorFailure !== undefined) return { armorClass: { kind: 'missing', reason: armorFailure }, stealthDisadvantageSources: sources };
  if (equippedArmor.length > 1) return { armorClass: { kind: 'missing', reason: 'Multiple equipped armor items prevent armor class projection.' }, stealthDisadvantageSources: sources };
  if (equippedShields.length > 1) return { armorClass: { kind: 'missing', reason: 'Multiple equipped shields prevent armor class projection.' }, stealthDisadvantageSources: sources };
  const armor = equippedArmor[0]?.capabilities.armor;
  if (equippedArmor.length === 1 && armor === undefined) return { armorClass: { kind: 'missing', reason: 'Equipped armor is not available for armor class projection.' }, stealthDisadvantageSources: sources };
  if (dexterityModifier === undefined) return { armorClass: { kind: 'missing', reason: 'Dexterity modifier is unavailable for armor class projection.' }, stealthDisadvantageSources: sources };
  const shield = equippedShields[0]?.capabilities.armor;
  if (equippedShields.length === 1 && shield === undefined) return { armorClass: { kind: 'missing', reason: 'Equipped shield armor value is unavailable.' }, stealthDisadvantageSources: sources };
  if (unarmoredDefense !== undefined && equippedArmor.length === 0 && !(unarmoredDefense.calculation === 'unarmoredMonk' && equippedShields.length > 0)) {
    return { armorClass: { kind: 'available', value: (unarmoredDefense.base ?? 10) + dexterityModifier + unarmoredDefense.secondaryModifier + (shield?.value ?? 0) }, stealthDisadvantageSources: sources };
  }
  const dexterity = equippedArmor[0]?.capabilities.category === 'heavy' ? 0 : armor?.dex === undefined ? dexterityModifier : Math.min(dexterityModifier, armor.dex);
  return { armorClass: { kind: 'available', value: (armor?.value ?? 10) + dexterity + (shield?.value ?? 0) }, stealthDisadvantageSources: sources };
}

function projectRow(entry: InventoryEntry, statuses: EquipmentStatus[], resolvedItems: ResolvedInventoryItems, warnings: string[]): InventorySheetRow {
  const resolved = isFoundryInventoryEntry(entry) ? resolvedItems.get(entry.entryId) : undefined;
  const name = isFoundryInventoryEntry(entry) ? entry.source.name : entry.custom.name;
  let capabilities: RowCapabilities | undefined;
  if (isFoundryInventoryEntry(entry)) {
    if (resolved?.kind === 'available') capabilities = fromFoundry(resolved.value);
    else warnings.push(`${name}: ${resolved?.reason ?? 'Item source details are unavailable.'}`);
  } else capabilities = fromCustom(entry.custom);

  const weight = projectWeight(name, capabilities?.weight, entry.quantity);
  const status = actionStatus(name, entry.entryId, statuses, warnings);
  const equipAction = capabilities?.equippable === true
    ? actionPreview(status, 'equip')
    : null;
  const attuneAction = capabilities?.attunement !== undefined
    ? actionPreview(status, 'attune')
    : null;

  return {
    entryId: entry.entryId,
    name,
    detail: [capabilities?.type, capabilities?.type === 'weapon' && capabilities.category !== undefined ? WEAPON_CATEGORY_LABELS[capabilities.category] ?? capabilities.category : capabilities?.category].filter((value): value is string => value !== undefined && value.trim().length > 0),
    quantity: entry.quantity,
    unitWeight: weight.unit,
    stackWeight: weight.stack,
    equipAction,
    attuneAction,
    notes: notes(capabilities),
  };
}

function fromFoundry(item: FoundryItemSummary): RowCapabilities {
  return {
    equippable: item.equippable,
    ...(item.attunement === undefined ? {} : { attunement: item.attunement }),
    ...(item.weight === undefined ? {} : { weight: item.weight }),
    type: item.itemType,
    ...(item.category === undefined ? {} : { category: item.category }),
    ...(item.armor === undefined ? {} : { armor: item.armor }),
    ...(item.strength === undefined ? {} : { strength: item.strength }),
    stealthDisadvantage: item.properties.includes('stealthDisadvantage'),
  };
}

function fromCustom(item: CustomInventoryItem): RowCapabilities {
  return {
    equippable: item.equippable === true,
    ...(item.attunement === undefined ? {} : { attunement: item.attunement }),
    ...(item.weight === undefined ? {} : { weight: item.weight }),
    ...(item.type === undefined ? {} : { type: item.type }),
    ...(item.category === undefined ? {} : { category: item.category }),
    ...(item.armor === undefined ? {} : { armor: item.armor }),
    ...(item.strength === undefined ? {} : { strength: item.strength }),
    ...(item.stealthDisadvantage === undefined ? {} : { stealthDisadvantage: item.stealthDisadvantage }),
  };
}

function projectWeight(name: string, weight: { value: number; units?: string } | undefined, quantity: number): {
  unit: InventorySheetRow['unitWeight']; stack: InventorySheetRow['stackWeight'];
} {
  if (weight === undefined || !Number.isFinite(weight.value) || weight.units === undefined || weight.units.trim().length === 0) {
    const missing = { kind: 'missing' as const, reason: `Item weight is unavailable for ${name}.` };
    return { unit: missing, stack: missing };
  }
  const units = weight.units.trim();
  return {
    unit: { kind: 'available', value: { value: weight.value, units } },
    stack: { kind: 'available', value: { value: weight.value * quantity, units } },
  };
}

function actionStatus(name: string, entryId: string, statuses: EquipmentStatus[], warnings: string[]): InventoryProjectionValue<EquipmentStatus> {
  const matches = statuses.filter((status) => status.entryId === entryId);
  if (matches.length === 1) return { kind: 'available', value: matches[0] };
  const reason = matches.length === 0 ? 'Equipment status is missing.' : 'Equipment status is duplicated.';
  warnings.push(`${name}: ${reason}`);
  return { kind: 'missing', reason };
}

function actionPreview(status: InventoryProjectionValue<EquipmentStatus>, action: 'equip' | 'attune'): InventorySheetRow['equipAction'] {
  if (status.kind === 'missing') return status;
  const active = action === 'equip' ? status.value.equipped : status.value.attuned;
  const label: InventoryActionPreview['label'] = action === 'equip' ? active ? 'Equipped' : 'Equip' : active ? 'Attuned' : 'Attune';
  return { kind: 'available', label, active };
}

function totalWeight(rows: InventorySheetRow[]): InventorySheetProjectionValue {
  if (rows.length === 0) return { kind: 'missing', reason: 'No carried items.' };
  const firstMissing = rows.find((row) => row.stackWeight.kind === 'missing');
  if (firstMissing?.stackWeight.kind === 'missing') return firstMissing.stackWeight;
  const available = rows.map((row) => row.stackWeight).filter((weight): weight is Extract<typeof weight, { kind: 'available' }> => weight.kind === 'available');
  const units = available[0].value.units;
  const incompatible = available.find((weight) => weight.value.units !== units);
  if (incompatible !== undefined) return { kind: 'missing', reason: 'Inventory weight units are incompatible.' };
  return { kind: 'available', value: { value: available.reduce((total, weight) => total + weight.value.value, 0), units } };
}

type InventorySheetProjectionValue = InventoryProjectionValue<{ value: number; units: string }>;

function notes(capabilities: RowCapabilities | undefined): string[] {
  if (capabilities === undefined) return [];
  const result: string[] = [];
  if (capabilities.armor !== undefined) result.push(`Armor ${capabilities.armor.value}${capabilities.armor.dex === undefined ? '' : `, Dex cap ${capabilities.armor.dex}`}`);
  if (capabilities.strength !== undefined) result.push(`Strength ${capabilities.strength}`);
  if (capabilities.stealthDisadvantage === true) result.push('Stealth disadvantage');
  return result;
}
