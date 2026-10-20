import type { EquipmentPackageNode } from './equipment';
import type { FoundryItemSummary, FoundrySourceReference } from './foundry-source-catalog';
import { isFoundrySourceReference, isSafeSourcePath } from './foundry-source-reference';

interface InventoryEntryBase {
  entryId: string;
  quantity: number;
  equipped: boolean;
  provenance: EquipmentProvenance[];
  containerEntryId?: string;
}

export interface InventoryItemSnapshot { itemType: string; category?: string; rarity?: string; magic: boolean; weight?: { value: number; units?: string }; price?: { value: number; denomination: string }; }
export interface CustomInventoryItem { name: string; type?: string; category?: string; weight?: { value: number; units?: string }; price?: { value: number; denomination: string }; description?: string; equippable?: boolean; attunement?: 'optional' | 'required'; armor?: { value: number; dex?: number }; strength?: number; stealthDisadvantage?: boolean; }
export interface FoundryInventoryEntry extends InventoryEntryBase { source: FoundrySourceReference; custom?: never; item?: InventoryItemSnapshot; }
export interface CustomInventoryEntry extends InventoryEntryBase { custom: CustomInventoryItem; source?: never; item?: never; }
export type InventoryEntry = FoundryInventoryEntry | CustomInventoryEntry;

export function isFoundryInventoryEntry(entry: InventoryEntry): entry is FoundryInventoryEntry { return 'source' in entry && entry.source !== undefined && !('custom' in entry); }
export function isCustomInventoryEntry(entry: InventoryEntry): entry is CustomInventoryEntry { return 'custom' in entry && entry.custom !== undefined && !('source' in entry); }

export interface InventoryCurrency { cp: number; sp: number; ep: number; gp: number; pp: number; }
export interface CharacterInventory { items: InventoryEntry[]; currency: InventoryCurrency; currencyProvenance?: CurrencyProvenance[]; }
export interface EquipmentSelection { selected: Record<string, string>; semantic: Record<string, FoundrySourceReference>; }
export interface EquipmentProvenance { sourcePath: string; packageNodeId: string; quantity?: number; }
export interface CurrencyProvenance extends EquipmentProvenance { denomination: keyof InventoryCurrency; amount: number; }

export function emptyInventory(): CharacterInventory { return { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }; }

export function flattenSelectedEquipment(roots: EquipmentPackageNode[], selection: EquipmentSelection, provenance: EquipmentProvenance): CharacterInventory {
  const result = emptyInventory();
  const add = (node: EquipmentPackageNode): void => {
    if (node.type === 'OR') {
      const selectedId = selection.selected[node.nodeId];
      const child = node.children?.length === 1 ? node.children[0] : node.children?.find((candidate) => candidate.nodeId === selectedId);
      if (child) add(child);
      return;
    }
    if (node.type === 'AND') { for (const child of node.children ?? []) add(child); return; }
    if (node.type === 'linked' && node.item && (node.quantity ?? 0) > 0) {
      const existing = result.items.find((entry) => isFoundryInventoryEntry(entry) && entry.source.pack === node.item?.pack && entry.source.id === node.item?.id);
      const quantity = node.quantity ?? 1;
      const contribution = { ...provenance, quantity };
      if (existing) { existing.quantity += quantity; existing.provenance.push(contribution); } else result.items.push({ entryId: `source:${node.item.pack}:${node.item.id}`, source: { ...node.item }, quantity, equipped: false, provenance: [contribution] });
      return;
    }
    if (node.type === 'currency' && node.currency) {
      const denomination = node.currency.denomination.toLowerCase() as keyof InventoryCurrency;
      if (denomination in result.currency) {
        result.currency[denomination] += node.currency.amount;
        const currencyProvenance = (result as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance ?? [];
        currencyProvenance.push({ ...provenance, denomination, amount: node.currency.amount });
        (result as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance = currencyProvenance;
      }
    }
    if (node.semantic) {
      const source = selection.semantic[node.nodeId];
      if (source) {
        const existing = result.items.find((entry) => isFoundryInventoryEntry(entry) && entry.source.pack === source.pack && entry.source.id === source.id);
        const quantity = node.quantity ?? 1;
        const contribution = { ...provenance, quantity };
        if (existing) { existing.quantity += quantity; existing.provenance.push(contribution); }
        else result.items.push({ entryId: `source:${source.pack}:${source.id}`, source: { ...source }, quantity, equipped: false, provenance: [contribution] });
      }
    }
  };
  for (const root of roots) add(root);
  return result;
}

export function mergeInventories(left: CharacterInventory, right: CharacterInventory): CharacterInventory {
  const result: CharacterInventory = { items: left.items.map(cloneInventoryEntry), currency: { ...left.currency } };
  for (const item of right.items) {
    const existing = isFoundryInventoryEntry(item)
      ? result.items.find((entry) => isFoundryInventoryEntry(entry) && entry.source.pack === item.source.pack && entry.source.id === item.source.id)
      : result.items.find((entry) => isCustomInventoryEntry(entry) && entry.entryId === item.entryId);
    if (existing) { existing.quantity += item.quantity; existing.provenance.push(...item.provenance.map((value) => ({ ...value }))); } else result.items.push(cloneInventoryEntry(item));
  }
  for (const denomination of Object.keys(result.currency) as Array<keyof InventoryCurrency>) result.currency[denomination] += right.currency[denomination];
  const leftCurrencyProvenance = (left as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance;
  const rightCurrencyProvenance = (right as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance;
  if (leftCurrencyProvenance !== undefined || rightCurrencyProvenance !== undefined) (result as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance = [...(leftCurrencyProvenance ?? []), ...(rightCurrencyProvenance ?? [])].map((value) => ({ ...value }));
  return result;
}

export function replaceInventorySource(current: CharacterInventory, sourcePath: string, replacement: CharacterInventory): CharacterInventory {
  const result: CharacterInventory = {
    items: [],
    currency: { ...current.currency },
    ...((current as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance === undefined ? {} : { currencyProvenance: (current as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance!.map((value) => ({ ...value })) }),
  };
  for (const entry of current.items) {
    const matching = entry.provenance.filter((value) => value.sourcePath === sourcePath);
    if (matching.length === 0) {
      result.items.push(cloneInventoryEntry(entry));
      continue;
    }
    if (matching.some((value) => value.quantity === undefined)) continue;
    const removedQuantity = matching.reduce((total, value) => total + (value.quantity ?? 0), 0);
    const remainingQuantity = entry.quantity - removedQuantity;
    if (remainingQuantity > 0) result.items.push({ ...cloneInventoryEntry(entry), quantity: remainingQuantity, provenance: entry.provenance.filter((value) => value.sourcePath !== sourcePath).map((value) => ({ ...value })) });
  }
  const currencyProvenance = (result as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance;
  if (currencyProvenance !== undefined) {
    for (const contribution of currencyProvenance.filter((value) => value.sourcePath === sourcePath)) result.currency[contribution.denomination] -= contribution.amount;
    const retained = currencyProvenance.filter((value) => value.sourcePath !== sourcePath);
    if (retained.length > 0) (result as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance = retained;
    else delete (result as CharacterInventory & { currencyProvenance?: CurrencyProvenance[] }).currencyProvenance;
  }
  return mergeInventories(result, replacement);
}

export function addInventoryItem(inventory: CharacterInventory, source: FoundrySourceReference | FoundryItemSummary, quantity = 1): CharacterInventory {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Invalid inventory quantity');
  const result: CharacterInventory = { items: inventory.items.map(cloneInventoryEntry), currency: { ...inventory.currency }, ...(inventory.currencyProvenance === undefined ? {} : { currencyProvenance: inventory.currencyProvenance.map((value) => ({ ...value })) }) };
  const existing = result.items.find((entry) => isFoundryInventoryEntry(entry) && entry.containerEntryId === undefined && entry.source.pack === source.pack && entry.source.id === source.id);
  if (existing) existing.quantity += quantity;
  else {
    const { itemType, category, rarity, magic, weight, price } = source as Partial<FoundryItemSummary>;
    result.items.push({ entryId: `source:${source.pack}:${source.id}`, source: { sourcePath: source.sourcePath, pack: source.pack, type: source.type, id: source.id, ...(source.identifier === undefined ? {} : { identifier: source.identifier }), name: source.name }, quantity, equipped: false, provenance: [], ...(itemType === undefined || magic === undefined ? {} : { item: { itemType, ...(category === undefined ? {} : { category }), ...(rarity === undefined ? {} : { rarity }), magic, ...(weight === undefined ? {} : { weight }), ...(price === undefined ? {} : { price }) } }) });
  }
  return result;
}

export interface InventoryItemChanges {
  added: Array<{ source: FoundryItemSummary; quantity: number }>;
  removedEntryIds: string[];
  quantityChanges: Array<{ entryId: string; delta: number }>;
}

export function applyInventoryItemChanges(inventory: CharacterInventory, changes: InventoryItemChanges): CharacterInventory {
  const removed = new Set(changes.removedEntryIds);
  let result: CharacterInventory = {
    items: inventory.items.filter((entry) => !removed.has(entry.entryId)).map((entry) => {
      const copy = cloneInventoryEntry(entry);
      if (copy.containerEntryId !== undefined && removed.has(copy.containerEntryId)) delete copy.containerEntryId;
      return copy;
    }),
    currency: { ...inventory.currency },
    ...(inventory.currencyProvenance === undefined ? {} : { currencyProvenance: inventory.currencyProvenance.map((value) => ({ ...value })) }),
  };
  for (const change of changes.quantityChanges) {
    if (removed.has(change.entryId)) continue;
    const entry = result.items.find((item) => item.entryId === change.entryId);
    if (entry === undefined) throw new Error(`Inventory item is no longer available: ${change.entryId}`);
    const quantity = entry.quantity + change.delta;
    if (!Number.isSafeInteger(change.delta) || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('Invalid inventory quantity');
    entry.quantity = quantity;
  }
  for (const { source, quantity } of changes.added) result = addInventoryItem(result, source, quantity);
  return result;
}

export interface InventorySourceResolver {
  getByUuid(uuid: string): Promise<FoundrySourceReference | null>;
  getRaw(sourcePath: string): Record<string, unknown> | undefined;
}

export async function expandInventoryContainers(inventory: CharacterInventory, resolver: InventorySourceResolver): Promise<CharacterInventory> {
  const result: CharacterInventory = {
    items: inventory.items.map(cloneInventoryEntry),
    currency: { ...inventory.currency },
    ...(inventory.currencyProvenance === undefined ? {} : { currencyProvenance: inventory.currencyProvenance.map((value) => ({ ...value })) }),
  };
  const pending = [...result.items];
  const expanded = new Set<string>();
  for (let index = 0; index < pending.length; index += 1) {
    const parent = pending[index];
    if (expanded.has(parent.entryId)) continue;
    expanded.add(parent.entryId);
    if (!isFoundryInventoryEntry(parent)) continue;
    const raw = resolver.getRaw(parent.source.sourcePath);
    if (!isContainerRecord(raw)) continue;
    const description = raw.system && isRecord(raw.system) && isRecord(raw.system.description) && typeof raw.system.description.value === 'string' ? raw.system.description.value : '';
    const references = extractContainedReferences(description);
    for (const reference of references) {
      const source = await resolver.getByUuid(reference.uuid);
      if (source === null) continue;
      const quantity = reference.quantity * parent.quantity;
      const entryId = `source:${source.pack}:${source.id}:container:${parent.entryId}`;
      const child: InventoryEntry = { entryId, source: { ...source }, quantity, equipped: false, containerEntryId: parent.entryId, provenance: parent.provenance.map((value) => ({ ...value, quantity: (value.quantity ?? parent.quantity) * reference.quantity })) };
      const existing = result.items.find((entry) => entry.entryId === entryId);
      if (existing) existing.quantity += quantity;
      else { result.items.push(child); pending.push(child); }
    }
  }
  return result;
}

export function isCharacterInventory(value: unknown): value is CharacterInventory {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(isInventoryEntryValue) || !isRecord(value.currency)) return false;
  const currency = value.currency;
  if (!['cp', 'sp', 'ep', 'gp', 'pp'].every((key) => typeof currency[key] === 'number' && Number.isFinite(currency[key]) && (currency[key] as number) >= 0)) return false;
  return value.currencyProvenance === undefined || Array.isArray(value.currencyProvenance) && value.currencyProvenance.every(isCurrencyProvenance);
}

function cloneInventoryEntry(entry: InventoryEntry): InventoryEntry {
  const base = { entryId: entry.entryId, quantity: entry.quantity, equipped: entry.equipped, provenance: entry.provenance.map((value) => ({ ...value })), ...(entry.containerEntryId === undefined ? {} : { containerEntryId: entry.containerEntryId }) };
  if (isFoundryInventoryEntry(entry)) return { ...base, source: { ...entry.source }, ...(entry.item === undefined ? {} : { item: structuredClone(entry.item) }) };
  return { ...base, custom: structuredClone(entry.custom) };
}

function isInventoryEntryValue(value: unknown): value is InventoryEntry {
  if (!isRecord(value) || typeof value.entryId !== 'string' || value.entryId.length === 0 || !isPositiveInteger(value.quantity) || typeof value.equipped !== 'boolean' || value.containerEntryId !== undefined && (typeof value.containerEntryId !== 'string' || value.containerEntryId.length === 0) || !Array.isArray(value.provenance) || !value.provenance.every(isProvenance)) return false;
  const hasSource = value.source !== undefined;
  const hasCustom = value.custom !== undefined;
  if (hasSource === hasCustom) return false;
  if (hasSource) return isFoundrySourceReference(value.source) && (value.item === undefined || isInventoryItem(value.item));
  return value.item === undefined && isCustomItem(value.custom);
}

function isCustomItem(value: unknown): boolean {
  return isRecord(value) && typeof value.name === 'string' && value.name.trim().length > 0
    && (value.type === undefined || typeof value.type === 'string')
    && (value.category === undefined || typeof value.category === 'string')
    && (value.description === undefined || typeof value.description === 'string')
    && (value.equippable === undefined || typeof value.equippable === 'boolean')
    && (value.attunement === undefined || value.attunement === 'optional' || value.attunement === 'required')
    && (value.stealthDisadvantage === undefined || typeof value.stealthDisadvantage === 'boolean')
    && (value.weight === undefined || isMeasure(value.weight))
    && (value.price === undefined || isPrice(value.price))
    && (value.armor === undefined || isArmor(value.armor))
    && (value.strength === undefined || isFiniteNumber(value.strength));
}

function isInventoryItem(value: unknown): boolean { return isRecord(value) && typeof value.itemType === 'string' && typeof value.magic === 'boolean' && (value.category === undefined || typeof value.category === 'string') && (value.rarity === undefined || typeof value.rarity === 'string') && (value.weight === undefined || isMeasure(value.weight)) && (value.price === undefined || isPrice(value.price)); }
function isProvenance(value: unknown): value is EquipmentProvenance { return isRecord(value) && typeof value.sourcePath === 'string' && isSafeSourcePath(value.sourcePath) && typeof value.packageNodeId === 'string' && value.packageNodeId.length > 0 && (value.quantity === undefined || isPositiveInteger(value.quantity)); }
function isCurrencyProvenance(value: unknown): value is CurrencyProvenance { return isProvenance(value) && isRecord(value) && typeof value.denomination === 'string' && isCurrencyDenomination(value.denomination) && isPositiveInteger(value.amount); }
function isMeasure(value: unknown): boolean { return isRecord(value) && isFiniteNumber(value.value) && value.value >= 0 && (value.units === undefined || typeof value.units === 'string'); }
function isPrice(value: unknown): boolean { return isRecord(value) && isFiniteNumber(value.value) && value.value >= 0 && typeof value.denomination === 'string'; }
function isArmor(value: unknown): boolean { return isRecord(value) && isFiniteNumber(value.value) && (value.dex === undefined || isFiniteNumber(value.dex)); }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isPositiveInteger(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0; }
function isCurrencyDenomination(value: string): value is keyof InventoryCurrency { return value === 'cp' || value === 'sp' || value === 'ep' || value === 'gp' || value === 'pp'; }

function extractContainedReferences(description: string): Array<{ uuid: string; quantity: number }> {
  const result: Array<{ uuid: string; quantity: number }> = [];
  const pattern = /@UUID\[([^\]]+)\]\{[^}]+\}/g;
  for (const match of description.matchAll(pattern)) {
    const prefix = description.slice(Math.max(0, (match.index ?? 0) - 32), match.index ?? 0);
    const quantityMatch = prefix.match(/(?:^|\s)(\d+)\s*(?:days?\s+of|flasks?\s+of)?\s*$/i);
    result.push({ uuid: match[1], quantity: quantityMatch === null ? 1 : Number(quantityMatch[1]) });
  }
  return result;
}

function isContainerRecord(value: Record<string, unknown> | undefined): value is Record<string, unknown> & { system: Record<string, unknown> } {
  return value !== undefined && value.type === 'container' && isRecord(value.system);
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
