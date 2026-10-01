import { parse } from 'yaml';
import type { CharacterRuleset } from './character-model';
import { readFoundryActivities, readFoundryUsesDiagnostic, type FoundryActivitySummary, type FoundryUsesSummary } from './foundry-activity-summary';
import { normalizeFoundryDescription } from './foundry-description';

export interface FoundrySourceCatalogAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<string[]>;
  read(path: string): Promise<string>;
}

export interface FoundrySourceReference {
  sourcePath: string;
  pack: string;
  type: string;
  id: string;
  identifier?: string;
  name: string;
}

export interface FoundrySourceRecord extends FoundrySourceReference {
  raw: Record<string, unknown>;
}

export interface FoundryItemSummary extends FoundrySourceReference {
  ruleset: CharacterRuleset;
  itemType: string;
  category?: string;
  subcategory?: string;
  rarity?: string;
  magic: boolean;
  equippable: boolean;
  attunement?: 'optional' | 'required';
  armor?: { value: number; dex?: number };
  strength?: number;
  properties: string[];
  weight?: { value: number; units?: string };
  price?: { value: number; denomination: string };
  description?: string;
  damage?: { number?: number; denomination?: number; bonus?: string; types: string[] };
  range?: { value?: string | number; long?: string | number; units?: string };
  mastery?: string;
  magicalBonus?: number;
  activities?: FoundryActivitySummary[];
  activityDiagnostics?: string[];
  uses?: FoundryUsesSummary;
}

export interface FoundrySpellSummary extends FoundrySourceReference {
  ruleset: CharacterRuleset;
  level: number;
  school?: string;
  spellLists: string[];
  ritual: boolean;
  description?: string;
  activation?: { type: string; value?: number };
  duration?: { value?: string | number; units?: string; special?: string; concentration?: boolean };
  range?: { value?: string | number; units?: string; special?: string };
  properties?: string[];
  materials?: string;
  preparation?: string;
  activities?: FoundryActivitySummary[];
  activityDiagnostics?: string[];
  uses?: FoundryUsesSummary;
}

export interface FoundryLanguageOption {
  value: string;
  label: string;
}

export interface ItemSearchFilters {
  ruleset?: CharacterRuleset;
  itemType?: string;
  rarity?: string;
  magic?: boolean;
}

export interface SpellSearchFilters {
  ruleset: CharacterRuleset;
  level?: number;
  spellLists?: string[];
  query?: string;
}

export interface ResolvedFoundryDependency {
  uuid: string;
  source: FoundrySourceReference | null;
  description?: string;
  reason?: string;
}

type SourceFamily = 'species' | 'class' | 'background';

const SOURCE_FAMILIES: Record<SourceFamily, { prefix: (ruleset: CharacterRuleset) => string; pack: (ruleset: CharacterRuleset) => string; type: string }> = {
  species: { prefix: (ruleset) => ruleset === '2014' ? 'packs/_source/races/' : 'packs/_source/origins24/species/', pack: (ruleset) => ruleset === '2014' ? 'dnd5e.races' : 'dnd5e.origins24', type: 'race' },
  class: { prefix: (ruleset) => ruleset === '2014' ? 'packs/_source/classes/' : 'packs/_source/classes24/', pack: (ruleset) => ruleset === '2014' ? 'dnd5e.classes' : 'dnd5e.classes24', type: 'class' },
  background: { prefix: (ruleset) => ruleset === '2014' ? 'packs/_source/backgrounds/' : 'packs/_source/origins24/backgrounds/', pack: (ruleset) => ruleset === '2014' ? 'dnd5e.backgrounds' : 'dnd5e.origins24', type: 'background' },
};

const SPELL_LIST_REGISTRY_PATHS: Record<CharacterRuleset, string> = {
  '2014': 'packs/_source/rules/chapter-10-spellcasting.yml',
  '2024': 'packs/_source/content24/chapter-7/spells.yml',
};

export interface FoundrySourceCatalog {
  list(family: SourceFamily, ruleset: CharacterRuleset): Promise<FoundrySourceRecord[]>;
  listPack(pack: string): Promise<FoundrySourceRecord[]>;
  get(family: SourceFamily, ruleset: CharacterRuleset, sourcePath: string): Promise<FoundrySourceRecord | null>;
  getByUuid(uuid: string): Promise<FoundrySourceReference | null>;
  getRaw(sourcePath: string): Record<string, unknown> | undefined;
  indexPack(pack: string): Promise<void>;
  resolveDependencies(value: unknown, ruleset?: CharacterRuleset): Promise<ResolvedFoundryDependency[]>;
  getItemSummary(ruleset: CharacterRuleset, sourcePath: string): Promise<FoundryItemSummary | null>;
  searchItems(query: string, filters?: ItemSearchFilters): Promise<FoundryItemSummary[]>;
  listSpells(ruleset: CharacterRuleset): Promise<FoundrySpellSummary[]>;
  searchSpells(filters: SpellSearchFilters): Promise<FoundrySpellSummary[]>;
  resolveSelector(selector: string, ruleset: CharacterRuleset): Promise<FoundryItemSummary[]>;
}

const FOUNDRY_LANGUAGES: ReadonlyArray<{ category: string; identifier: string; label: string }> = [
  { category: 'standard', identifier: 'common', label: 'Common' },
  { category: 'standard', identifier: 'draconic', label: 'Draconic' },
  { category: 'standard', identifier: 'dwarvish', label: 'Dwarvish' },
  { category: 'standard', identifier: 'elvish', label: 'Elvish' },
  { category: 'standard', identifier: 'giant', label: 'Giant' },
  { category: 'standard', identifier: 'gnomish', label: 'Gnomish' },
  { category: 'standard', identifier: 'goblin', label: 'Goblin' },
  { category: 'standard', identifier: 'halfling', label: 'Halfling' },
  { category: 'standard', identifier: 'orc', label: 'Orc' },
  { category: 'standard', identifier: 'sign', label: 'Common Sign' },
  { category: 'exotic', identifier: 'aarakocra', label: 'Aarakocra' },
  { category: 'exotic', identifier: 'abyssal', label: 'Abyssal' },
  { category: 'exotic', identifier: 'cant', label: "Thieves' Cant" },
  { category: 'exotic', identifier: 'celestial', label: 'Celestial' },
  { category: 'exotic', identifier: 'deep', label: 'Deep Speech' },
  { category: 'exotic', identifier: 'druidic', label: 'Druidic' },
  { category: 'exotic', identifier: 'gith', label: 'Gith' },
  { category: 'exotic', identifier: 'gnoll', label: 'Gnoll' },
  { category: 'exotic', identifier: 'infernal', label: 'Infernal' },
  { category: 'exotic', identifier: 'primordial:aquan', label: 'Primordial (Aquan)' },
  { category: 'exotic', identifier: 'primordial:auran', label: 'Primordial (Auran)' },
  { category: 'exotic', identifier: 'primordial:ignan', label: 'Primordial (Ignan)' },
  { category: 'exotic', identifier: 'primordial:terran', label: 'Primordial (Terran)' },
  { category: 'exotic', identifier: 'sylvan', label: 'Sylvan' },
  { category: 'exotic', identifier: 'undercommon', label: 'Undercommon' },
];

export function languageSelectorOptions(selector: string): FoundryLanguageOption[] {
  const parts = selector.toLocaleLowerCase().split(':');
  if (parts[0] !== 'languages') return [];
  const candidates = parts.length === 2 && parts[1] === '*' ? FOUNDRY_LANGUAGES
    : parts.length === 3 && parts[2] === '*' ? FOUNDRY_LANGUAGES.filter((language) => language.category === parts[1])
      : parts.length === 3 ? FOUNDRY_LANGUAGES.filter((language) => `${language.category}:${language.identifier}` === `${parts[1]}:${parts[2]}`)
        : parts.length === 2 ? FOUNDRY_LANGUAGES.filter((language) => language.identifier === parts[1]) : [];
  return candidates.map((language) => ({ value: parts.length === 2 && parts[1] !== '*' ? `languages:${language.identifier}` : `languages:${language.category}:${language.identifier}`, label: language.label }));
}

export function canonicalizeLanguageSelector(selector: string): string | null {
  const parts = selector.toLowerCase().split(':');
  if (parts[0] !== 'languages' || parts.some((part) => part.length === 0 || part === '*')) return null;
  const language = parts.length === 2
    ? FOUNDRY_LANGUAGES.find((candidate) => candidate.identifier === parts[1])
    : parts.length >= 3 && (parts[1] === 'standard' || parts[1] === 'exotic')
      ? FOUNDRY_LANGUAGES.find((candidate) => candidate.category === parts[1] && candidate.identifier === parts.slice(2).join(':'))
      : FOUNDRY_LANGUAGES.find((candidate) => candidate.identifier === parts.slice(1).join(':'));
  return language === undefined ? null : `languages:${language.category}:${language.identifier}`;
}

export function languageSelectorKey(selector: string): string {
  const value = (canonicalizeLanguageSelector(selector) ?? selector).toLowerCase().split(':');
  if (value[0] !== 'languages') return value.join(':');
  if (value[1] === 'standard' || value[1] === 'exotic') return value.slice(2).join(':');
  return value.slice(1).join(':');
}

function languageSummary(option: FoundryLanguageOption, ruleset: CharacterRuleset): FoundryItemSummary {
  const identifier = option.value.split(':').at(-1) ?? option.value;
  const category = option.value.split(':')[1];
  return { sourcePath: 'module/config.mjs', pack: 'dnd5e', type: 'language', id: option.value, identifier, name: option.label, ruleset, itemType: 'language', category, magic: false, equippable: false, properties: [] };
}

export function createFoundrySourceCatalog(adapter: FoundrySourceCatalogAdapter, sourceRoot: string): FoundrySourceCatalog {
  const root = sourceRoot.replace(/\/$/, '');
  const recordsByPath = new Map<string, FoundrySourceRecord>();
  const recordsByUuid = new Map<string, FoundrySourceReference>();
  const listed = new Map<string, FoundrySourceRecord[]>();
  const indexedPacks = new Set<string>();
  const itemSummaries = new Map<string, FoundryItemSummary>();
  const indexedItemScopes = new Set<string>();
  const itemIndexPromises = new Map<string, Promise<void>>();
  const spellSummaries = new Map<string, FoundrySpellSummary>();
  const indexedSpellPacks = new Set<string>();
  const spellIndexPromises = new Map<string, Promise<void>>();
  const spellListMembership = new Map<string, Set<string>>();
  const indexedSpellListRegistries = new Set<CharacterRuleset>();
  const spellListRegistryPromises = new Map<CharacterRuleset, Promise<void>>();

  async function readRecord(path: string, expectedType?: string, ruleset?: CharacterRuleset): Promise<FoundrySourceRecord> {
    const sourcePath = relativePath(root, path);
    if (sourcePath === undefined) throw new Error(`Invalid source path: ${path}`);
    let value: unknown;
    try { value = parse(await adapter.read(path)); } catch (error) { throw new Error(`Invalid source record ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`); }
    if (!isRecord(value) || typeof value.type !== 'string' || typeof value.name !== 'string' || value.name.trim().length === 0 || typeof value._id !== 'string' || value._id.trim().length === 0 || !isRecord(value.system)) throw new Error(`Invalid source record ${sourcePath}`);
    if (expectedType !== undefined && value.type !== expectedType) throw new Error(`Invalid source record ${sourcePath}`);
    const system = value.system;
    if (ruleset !== undefined && isRecord(system.source) && system.source.rules !== undefined && String(system.source.rules) !== ruleset) throw new Error(`Source record does not match ruleset ${sourcePath}`);
    const pack = sourcePath.startsWith('packs/_source/') ? sourcePath.slice('packs/_source/'.length).split('/')[0] : '';
    const reference: FoundrySourceReference = {
      sourcePath,
      pack: `dnd5e.${pack}`,
      type: value.type,
      id: value._id,
      ...(isRecord(system) && typeof system.identifier === 'string' ? { identifier: system.identifier } : {}),
      name: value.name,
    };
    const record: FoundrySourceRecord = { ...reference, raw: value };
    recordsByPath.set(sourcePath, record);
    recordsByUuid.set(`Compendium.${reference.pack}.Item.${reference.id}`, reference);
    recordsByUuid.set(`Compendium.${reference.pack}.${reference.id}`, reference);
    return record;
  }

  async function list(family: SourceFamily, ruleset: CharacterRuleset): Promise<FoundrySourceRecord[]> {
    if (ruleset !== '2014' && ruleset !== '2024') throw new Error('Invalid character ruleset');
    const key = `${family}:${ruleset}`;
    const cached = listed.get(key);
    if (cached) return cached;
    if (!(await adapter.exists(root))) throw new Error('Source files are not available. Download the Foundry sources first.');
    const definition = SOURCE_FAMILIES[family];
    const paths = (await adapter.list(root)).filter((path) => isFamilyPath(root, path, family, ruleset)).sort();
    const result: FoundrySourceRecord[] = [];
    for (const path of paths) {
      try { result.push(await readRecord(path, definition.type, ruleset)); } catch (error) {
        if (error instanceof Error && error.message === `Source record does not match ruleset ${relativePath(root, path)}`) continue;
        if (family === 'class' && error instanceof Error && error.message === `Invalid source record ${relativePath(root, path)}`) continue;
        throw error;
      }
    }
    const sorted = result.sort((left, right) => left.name.localeCompare(right.name));
    listed.set(key, sorted);
    return sorted;
  }

  async function indexPack(pack: string): Promise<void> {
    if (indexedPacks.has(pack)) return;
    const packRoot = `${root}/packs/_source/${pack}`;
    if (!(await adapter.exists(root))) throw new Error('Source files are not available. Download the Foundry sources first.');
    if (!(await adapter.exists(packRoot))) { indexedPacks.add(pack); return; }
    const paths = (await adapter.list(packRoot)).filter((candidate) => {
      const relative = relativePath(root, candidate);
      return relative !== undefined && relative.startsWith('packs/_source/') && relative.endsWith('.yml') && !relative.split('/').includes('_folder.yml');
    }).sort();
    await Promise.all(paths.map(async (path) => { try { await readRecord(path); } catch { /* malformed dependency records remain unresolved */ } }));
    indexedPacks.add(pack);
  }

  return {
    list,
    async listPack(pack) {
      await indexPack(pack);
      return [...recordsByPath.values()].filter((record) => record.pack === `dnd5e.${pack}`);
    },
    async get(family, ruleset, sourcePath) {
      const record = recordsByPath.get(sourcePath);
      if (record) return record.type === SOURCE_FAMILIES[family].type && isRulesetRecord(record.raw, ruleset) ? record : null;
      await list(family, ruleset);
      return recordsByPath.get(sourcePath) ?? null;
    },
    async getByUuid(uuid) {
      const parsed = parseUuid(uuid);
      if (!parsed) return null;
      await indexPack(parsed.pack);
      return recordsByUuid.get(`Compendium.dnd5e.${parsed.pack}.Item.${parsed.id}`) ?? recordsByUuid.get(`Compendium.dnd5e.${parsed.pack}.${parsed.id}`) ?? null;
    },
    getRaw(sourcePath) { return recordsByPath.get(sourcePath)?.raw; },
    indexPack,
    async resolveDependencies(value, ruleset) {
      const uuids = collectUuids(value);
      const result: ResolvedFoundryDependency[] = [];
      for (const uuid of uuids) {
        const parsed = parseUuid(uuid);
        if (uuid === 'tool:*' && ruleset !== undefined) {
          await indexItemPack(ruleset === '2014' ? 'items' : 'equipment24', ruleset, ['tools', 'tool']);
          const tools = [...itemSummaries.values()].filter((item) => item.ruleset === ruleset && item.itemType === 'tool' && !item.magic);
          for (const item of tools) result.push({ uuid, source: item, ...(item.description === undefined ? {} : { description: item.description }) });
          continue;
        }
        if (parsed) await indexPack(parsed.pack);
        const source = parsed ? recordsByUuid.get(`Compendium.dnd5e.${parsed.pack}.Item.${parsed.id}`) ?? recordsByUuid.get(`Compendium.dnd5e.${parsed.pack}.${parsed.id}`) ?? null : null;
        const raw = source === null ? undefined : recordsByPath.get(source.sourcePath)?.raw;
        const system = raw && isRecord(raw.system) ? raw.system : undefined;
        const description = system && isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value) : undefined;
        result.push({ uuid, source, ...(description === undefined ? {} : { description }), ...(source ? {} : { reason: parsed ? 'unresolved source UUID' : isSelector(uuid) ? 'unresolved selector' : 'malformed source UUID' }) });
      }
      return result;
    },
    async getItemSummary(ruleset, sourcePath) {
      const pack = sourcePath.startsWith('packs/_source/items/') ? 'items'
        : sourcePath.startsWith('packs/_source/equipment24/') ? 'equipment24'
          : undefined;
      if (pack === undefined || ruleset === '2014' && pack !== 'items' || !sourcePath.endsWith('.yml') || sourcePath.split('/').includes('..') || sourcePath.split('/').includes('_folder.yml')) return null;
      const key = `${ruleset}:${sourcePath}`;
      const cached = itemSummaries.get(key);
      if (cached !== undefined) return cached;
      const fullPath = `${root}/${sourcePath}`;
      if (!(await adapter.exists(fullPath))) return null;
      const record = await readRecord(fullPath);
      const system = isRecord(record.raw.system) ? record.raw.system : {};
      const sourceRules = isRecord(system.source) && (String(system.source.rules) === '2014' || String(system.source.rules) === '2024') ? String(system.source.rules) as CharacterRuleset : undefined;
      const itemRuleset = sourceRules ?? (pack === 'equipment24' ? '2024' : '2014');
      if (itemRuleset !== ruleset && !(ruleset === '2024' && itemRuleset === '2014' && pack === 'items')) return null;
      const summary = toItemSummary(record, itemRuleset);
      itemSummaries.set(key, summary);
      return summary;
    },
    async searchItems(query, filters = {}) {
      const packs = filters.ruleset === '2014' ? ['items'] : filters.ruleset === '2024' ? ['equipment24'] : ['items', 'equipment24'];
      for (const pack of packs) await indexItemPack(pack, filters.ruleset);
      const normalizedQuery = query.trim().toLocaleLowerCase();
      return [...itemSummaries.values()]
        .filter((item) => filters.ruleset === undefined || item.ruleset === filters.ruleset)
        .filter((item) => filters.itemType === undefined || item.itemType === filters.itemType)
        .filter((item) => filters.rarity === undefined || item.rarity === filters.rarity)
        .filter((item) => filters.magic === undefined || item.magic === filters.magic)
        .map((item) => ({ item, score: fuzzyScore(item, normalizedQuery) }))
        .filter(({ score }) => score >= 0)
        .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name))
        .map(({ item }) => item);
    },
    async listSpells(ruleset) {
      await indexSpellPack(ruleset);
      return [...spellSummaries.values()]
        .filter((spell) => spell.ruleset === ruleset)
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async searchSpells(filters) {
      const spells = await this.listSpells(filters.ruleset);
      const normalizedQuery = filters.query?.trim().toLocaleLowerCase() ?? '';
      const allowedLists = new Set((filters.spellLists ?? []).map((list) => normalizeSpellList(list)));
      return spells
        .filter((spell) => filters.level === undefined || spell.level === filters.level)
        .filter((spell) => allowedLists.size === 0 || spell.spellLists.some((list) => allowedLists.has(list)))
        .map((spell) => ({ spell, score: fuzzyScore(spell, normalizedQuery) }))
        .filter(({ score }) => score >= 0)
        .sort((left, right) => right.score - left.score || left.spell.name.localeCompare(right.spell.name))
        .map(({ spell }) => spell);
    },
    async resolveSelector(selector, ruleset) {
      const normalized = selector.toLocaleLowerCase().replace(/^tools:/, 'tool:');
      if (normalized.startsWith('languages:')) return languageSelectorOptions(normalized).map((option) => languageSummary(option, ruleset));
      const scope = normalized.startsWith('weapon:') ? ['weapons', 'weapon'] : normalized.startsWith('armor:') ? ['armor'] : normalized.startsWith('tool:') ? ['tools', 'tool'] : normalized.startsWith('focus:') ? ['spellcasting-focus', 'spellcasting-focuses'] : undefined;
      const packs = ruleset === '2014' ? ['items'] : ['equipment24'];
      for (const pack of packs) await indexItemPack(pack, ruleset, scope);
      const items = [...itemSummaries.values()].filter((item) => item.ruleset === ruleset);
      const startingItems = items.filter((item) => !item.magic);
      if (normalized === 'tool:*') return startingItems.filter((item) => item.itemType === 'tool');
      if (normalized.startsWith('tool:')) {
        const category = normalized.split(':')[1];
        return startingItems.filter((item) => item.itemType === 'tool' && (category === '*' || item.category?.includes(category) === true || item.identifier?.toLocaleLowerCase().includes(category) === true));
      }
      if (normalized === 'weapon:*') return startingItems.filter((item) => item.itemType === 'weapon');
      if (normalized.startsWith('weapon:')) {
        const category = normalized.split(':')[1];
        return startingItems.filter((item) => item.itemType === 'weapon' && (category === '*' || item.category?.includes(category) === true));
      }
      if (normalized === 'focus:*' || normalized.startsWith('focus:')) {
        const category = normalized.split(':')[1];
        return startingItems.filter((item) => (item.itemType === 'equipment' || item.itemType === 'loot') && item.category?.includes('focus') === true && (category === '*' || item.category?.includes(category) === true));
      }
      if (normalized.startsWith('armor:')) {
        const category = normalized.split(':')[1];
        const aliases: Record<string, string[]> = { lgt: ['light'], med: ['medium'], hvy: ['heavy'], shl: ['shield'] };
        const categories = aliases[category] ?? [category];
        return startingItems.filter((item) => item.itemType === 'equipment' && item.category !== undefined && (category === '*' || categories.some((value) => item.category?.includes(value) === true)));
      }
      return [];
    },
  };

  async function indexSpellPack(ruleset: CharacterRuleset): Promise<void> {
    const pack = ruleset === '2014' ? 'spells' : 'spells24';
    if (indexedSpellPacks.has(pack)) return;
    const pending = spellIndexPromises.get(pack);
    if (pending) return pending;
    const operation = (async (): Promise<void> => {
      await indexSpellListRegistry(ruleset);
      const packRoot = `${root}/packs/_source/${pack}`;
      if (!(await adapter.exists(root))) throw new Error('Source files are not available. Download the Foundry sources first.');
      if (!(await adapter.exists(packRoot))) {
        indexedSpellPacks.add(pack);
        return;
      }
      const paths = (await adapter.list(packRoot)).filter((candidate) => {
        const relative = relativePath(root, candidate);
        return relative !== undefined && relative.endsWith('.yml') && !relative.split('/').includes('_folder.yml');
      }).sort();
      for (const path of paths) {
        const record = await readRecord(path);
        if (record.type !== 'spell') continue;
        const summary = normalizeSpell(record, ruleset);
        if (summary) {
          const registryLists = spellListMembership.get(`${ruleset}:${record.pack}:${record.id}`) ?? new Set<string>();
          spellSummaries.set(`${ruleset}:${record.sourcePath}`, { ...summary, spellLists: [...new Set([...summary.spellLists, ...registryLists])].sort() });
        }
      }
      indexedSpellPacks.add(pack);
    })();
    spellIndexPromises.set(pack, operation);
    try {
      await operation;
    } finally {
      if (!indexedSpellPacks.has(pack) && spellIndexPromises.get(pack) === operation) spellIndexPromises.delete(pack);
    }
  }

  async function indexSpellListRegistry(ruleset: CharacterRuleset): Promise<void> {
    if (indexedSpellListRegistries.has(ruleset)) return;
    const pending = spellListRegistryPromises.get(ruleset);
    if (pending) return pending;
    const operation = (async (): Promise<void> => {
      const sourcePath = SPELL_LIST_REGISTRY_PATHS[ruleset];
      const path = `${root}/${sourcePath}`;
      if (!(await adapter.exists(path))) {
        indexedSpellListRegistries.add(ruleset);
        return;
      }
      let value: unknown;
      try {
        value = parse(await adapter.read(path));
      } catch (error) {
        throw new Error(`Invalid spell list registry ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!isRecord(value) || !Array.isArray(value.pages)) throw new Error(`Invalid spell list registry ${sourcePath}`);
      for (const page of value.pages) {
        if (!isRecord(page) || page.type !== 'spells' || !isRecord(page.system)) continue;
        const system = page.system;
        if (typeof system.type === 'string' && system.type !== 'class') continue;
        const identifier = typeof system.identifier === 'string' && system.identifier.trim().length > 0
          ? normalizeSpellList(system.identifier)
          : spellListIdentifier(typeof page.name === 'string' ? page.name : '');
        if (identifier === undefined) continue;
        const uuids = Array.isArray(system.spells) ? system.spells.filter((uuid): uuid is string => typeof uuid === 'string') : [];
        for (const uuid of uuids) {
          const parsed = parseUuid(uuid);
          if (!parsed || parsed.pack !== (ruleset === '2014' ? 'spells' : 'spells24')) continue;
          const key = `${ruleset}:dnd5e.${parsed.pack}:${parsed.id}`;
          const lists = spellListMembership.get(key) ?? new Set<string>();
          lists.add(identifier);
          spellListMembership.set(key, lists);
        }
      }
      indexedSpellListRegistries.add(ruleset);
    })();
    spellListRegistryPromises.set(ruleset, operation);
    try {
      await operation;
    } finally {
      if (!indexedSpellListRegistries.has(ruleset) && spellListRegistryPromises.get(ruleset) === operation) spellListRegistryPromises.delete(ruleset);
    }
  }

  async function indexItemPack(pack: string, ruleset?: CharacterRuleset, scopes?: string[]): Promise<void> {
    const scopeKey = scopes?.join('|') ?? '*';
    const cacheKey = `${pack}:${ruleset ?? '*'}:${scopeKey}`;
    if (indexedItemScopes.has(cacheKey)) return;
    const pending = itemIndexPromises.get(cacheKey);
    if (pending) return pending;
    const operation = (async (): Promise<void> => {
    const packRoot = `${root}/packs/_source/${pack}`;
    if (!(await adapter.exists(packRoot))) return;
    const paths = (await adapter.list(packRoot)).filter((candidate) => candidate.endsWith('.yml') && !candidate.split('/').includes('_folder.yml') && (scopes === undefined || scopes.some((scope) => candidate.includes(`/${scope}/`) || candidate.endsWith(`/${scope}.yml`))));
    await Promise.all(paths.map(async (path) => { try {
        const record = await readRecord(path);
        const system = isRecord(record.raw.system) ? record.raw.system : {};
        const sourceRules = isRecord(system.source) && (String(system.source.rules) === '2014' || String(system.source.rules) === '2024') ? String(system.source.rules) as CharacterRuleset : undefined;
        const itemRuleset = sourceRules ?? (pack === 'equipment24' ? '2024' : '2014');
        if (ruleset !== undefined && itemRuleset !== ruleset) return;
        itemSummaries.set(`${itemRuleset}:${record.sourcePath}`, toItemSummary(record, itemRuleset));
      } catch { /* malformed item records remain unavailable */ } }));
    indexedItemScopes.add(cacheKey);
    })();
    itemIndexPromises.set(cacheKey, operation);
    await operation;
  }
}

function itemPathCategory(parts: string[]): string | undefined {
  const marker = parts.findIndex((part) => part === 'tools' || part === 'weapons' || part === 'armor' || part === 'spellcasting-focus' || part === 'spellcasting-focuses');
  if (marker >= 0 && (parts[marker] === 'spellcasting-focus' || parts[marker] === 'spellcasting-focuses')) return 'focus';
  return marker >= 0 && parts[marker + 1] !== undefined && parts[marker + 1] !== '_folder.yml' ? parts[marker + 1] : undefined;
}

function toItemSummary(record: FoundrySourceRecord, ruleset: CharacterRuleset): FoundryItemSummary {
  const system = isRecord(record.raw.system) ? record.raw.system : {};
  const pathCategory = itemPathCategory(record.sourcePath.split('/'));
  const category = pathCategory === 'focus'
    ? pathCategory
    : isRecord(system.type) && typeof system.type.value === 'string'
      ? system.type.value
      : pathCategory;
  const subcategory = isRecord(system.type) && typeof system.type.baseItem === 'string' ? system.type.baseItem : undefined;
  const rarity = typeof system.rarity === 'string' && system.rarity.trim().length > 0 ? system.rarity : undefined;
  const weight = isRecord(system.weight) && typeof system.weight.value === 'number'
    ? { value: system.weight.value, ...(typeof system.weight.units === 'string' ? { units: system.weight.units } : {}) }
    : undefined;
  const price = isRecord(system.price) && typeof system.price.value === 'number' && typeof system.price.denomination === 'string'
    ? { value: system.price.value, denomination: system.price.denomination }
    : undefined;
  const description = isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value) : undefined;
  // These pinned dnd5e item models mix in EquippableItemTemplate. The boolean
  // is source state, not a universal capability flag (e.g. on loot records).
  const equippable = ['weapon', 'equipment', 'tool', 'container', 'consumable'].includes(record.type)
    && typeof system.equipped === 'boolean';
  const attunement = system.attunement === 'required' || system.attunement === 'optional' ? system.attunement : undefined;
  const armor = isRecord(system.armor) && typeof system.armor.value === 'number'
    ? { value: system.armor.value, ...(typeof system.armor.dex === 'number' ? { dex: system.armor.dex } : {}) }
    : undefined;
  const strength = typeof system.strength === 'number' ? system.strength : undefined;
  const properties = Array.isArray(system.properties) ? system.properties.filter((value): value is string => typeof value === 'string') : [];
  const baseDamage = isRecord(system.damage) && isRecord(system.damage.base) ? system.damage.base : undefined;
  const damage = baseDamage && (typeof baseDamage.number === 'number' || typeof baseDamage.denomination === 'number' || Array.isArray(baseDamage.types)) ? { ...(typeof baseDamage.number === 'number' ? { number: baseDamage.number } : {}), ...(typeof baseDamage.denomination === 'number' ? { denomination: baseDamage.denomination } : {}), ...(typeof baseDamage.bonus === 'string' ? { bonus: baseDamage.bonus } : {}), types: Array.isArray(baseDamage.types) ? baseDamage.types.filter((value): value is string => typeof value === 'string') : [] } : undefined;
  const rangeRaw = isRecord(system.range) ? system.range : undefined;
  const range = rangeRaw && (rangeRaw.value !== undefined || rangeRaw.long !== undefined || typeof rangeRaw.units === 'string') ? { ...(typeof rangeRaw.value === 'string' || typeof rangeRaw.value === 'number' ? { value: rangeRaw.value } : {}), ...(typeof rangeRaw.long === 'string' || typeof rangeRaw.long === 'number' ? { long: rangeRaw.long } : {}), ...(typeof rangeRaw.units === 'string' ? { units: rangeRaw.units } : {}) } : undefined;
  const activities = readFoundryActivities(system);
  const uses = readFoundryUsesDiagnostic(system);
  const { raw: _raw, ...reference } = record;
  return {
    ...reference,
    ruleset,
    itemType: record.type,
    ...(category === undefined ? {} : { category }),
    ...(subcategory === undefined ? {} : { subcategory }),
    ...(rarity === undefined ? {} : { rarity }),
    magic: rarity !== undefined,
    equippable,
    ...(attunement === undefined ? {} : { attunement }),
    ...(armor === undefined ? {} : { armor }),
    ...(strength === undefined ? {} : { strength }),
    properties,
    ...(weight === undefined ? {} : { weight }),
    ...(price === undefined ? {} : { price }),
    ...(description === undefined ? {} : { description }),
    ...(damage === undefined ? {} : { damage }), ...(range === undefined ? {} : { range }),
    ...(typeof system.mastery === 'string' ? { mastery: system.mastery } : {}), ...(typeof system.magicalBonus === 'number' ? { magicalBonus: system.magicalBonus } : {}),
    ...(activities.activities.length > 0 ? { activities: activities.activities } : {}), ...(activities.diagnostics.length > 0 || uses.diagnostics.length > 0 ? { activityDiagnostics: [...activities.diagnostics, ...uses.diagnostics] } : {}),
    ...(uses.uses ? { uses: uses.uses } : {}),
  };
}

function isFamilyPath(root: string, path: string, family: SourceFamily, ruleset: CharacterRuleset): boolean {
  const relative = relativePath(root, path);
  if (!relative) return false;
  const prefix = SOURCE_FAMILIES[family].prefix(ruleset);
  if (!relative.startsWith(prefix) || !relative.endsWith('.yml')) return false;
  const candidate = relative.slice(prefix.length);
  const parts = candidate.split('/');
  if (parts.at(-1) === '_folder.yml' || parts.some((part) => part.endsWith('-features'))) return false;
  if (family === 'species') return parts.length > 0 && parts.length <= (ruleset === '2014' ? 2 : 1);
  if (family === 'class') return ruleset === '2014' ? parts.length === 1 : parts.length === 2 && parts[0] === parts[1].slice(0, -4);
  return parts.length === 1;
}

function relativePath(root: string, path: string): string | undefined {
  const prefix = `${root}/`;
  if (!path.startsWith(prefix)) return undefined;
  const relative = path.slice(prefix.length);
  return relative && !relative.startsWith('/') && !relative.includes('\\') && !relative.split('/').includes('..') && !relative.split('/').includes('') ? relative : undefined;
}

function isRulesetRecord(value: Record<string, unknown>, ruleset: CharacterRuleset): boolean {
  return isRecord(value.system) && isRecord(value.system.source) && String(value.system.source.rules) === ruleset;
}

function normalizeSpell(record: FoundrySourceRecord, ruleset: CharacterRuleset): FoundrySpellSummary | null {
  const system = record.raw.system;
  if (!isRecord(system)) throw new Error(`Invalid spell record ${record.sourcePath}`);
  const sourceRules = isRecord(system.source) && system.source.rules !== undefined ? String(system.source.rules) : undefined;
  if (sourceRules !== '2014' && sourceRules !== '2024') throw new Error(`Invalid spell record ${record.sourcePath}`);
  if (sourceRules !== ruleset) return null;
  if (typeof system.level !== 'number' || !Number.isInteger(system.level) || system.level < 0 || system.level > 9) {
    throw new Error(`Invalid spell record ${record.sourcePath}`);
  }
  const properties = Array.isArray(system.properties) ? system.properties.filter((property): property is string => typeof property === 'string') : [];
  const description = isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value) : undefined;
  const spellLists = readSpellLists(system.spellLists ?? (isRecord(system.source) ? system.source.spellLists : undefined));
  const school = typeof system.school === 'string' && system.school.trim().length > 0 ? system.school : undefined;
  const activities = readFoundryActivities(system);
  const uses = readFoundryUsesDiagnostic(system);
  const activationRaw = isRecord(system.activation) ? system.activation : undefined;
  const activation = activationRaw && typeof activationRaw.type === 'string' ? { type: activationRaw.type, ...(typeof activationRaw.value === 'number' ? { value: activationRaw.value } : {}) } : undefined;
  const durationRaw = isRecord(system.duration) ? system.duration : undefined;
  const duration = durationRaw ? { ...(typeof durationRaw.value === 'string' || typeof durationRaw.value === 'number' ? { value: durationRaw.value } : {}), ...(typeof durationRaw.units === 'string' ? { units: durationRaw.units } : {}), ...(typeof durationRaw.special === 'string' ? { special: durationRaw.special } : {}), ...(typeof durationRaw.concentration === 'boolean' ? { concentration: durationRaw.concentration } : {}) } : undefined;
  const rangeRaw = isRecord(system.range) ? system.range : undefined;
  const range = rangeRaw ? { ...(typeof rangeRaw.value === 'string' || typeof rangeRaw.value === 'number' ? { value: rangeRaw.value } : {}), ...(typeof rangeRaw.units === 'string' ? { units: rangeRaw.units } : {}), ...(typeof rangeRaw.special === 'string' ? { special: rangeRaw.special } : {}) } : undefined;
  const materials = isRecord(system.materials) && typeof system.materials.value === 'string' ? system.materials.value : undefined;
  const preparation = isRecord(system.preparation) && typeof system.preparation.mode === 'string' ? system.preparation.mode : undefined;
  return {
    sourcePath: record.sourcePath,
    pack: record.pack,
    type: record.type,
    id: record.id,
    ...(record.identifier === undefined ? {} : { identifier: record.identifier }),
    name: record.name,
    ruleset,
    level: system.level,
    ...(school === undefined ? {} : { school }),
    spellLists,
    ritual: properties.includes('ritual') || system.ritual === true,
    properties,
    ...(description === undefined ? {} : { description }),
    ...(activation ? { activation } : {}), ...(duration ? { duration } : {}), ...(range ? { range } : {}), ...(materials ? { materials } : {}), ...(preparation ? { preparation } : {}), activities: activities.activities, activityDiagnostics: [...activities.diagnostics, ...uses.diagnostics], ...(uses.uses ? { uses: uses.uses } : {}),
  };
}

function readSpellLists(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(normalizeSpellList))];
}

function normalizeSpellList(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized.startsWith('class:') ? normalized.slice('class:'.length) : normalized;
}

function spellListIdentifier(name: string): string | undefined {
  const match = name.trim().match(/^(.+?)\s+Spell(?: List|s)$/i);
  return match === null ? undefined : normalizeSpellList(match[1]);
}

function collectUuids(value: unknown, key?: string): string[] {
  if (key === 'list') return [];
  if (typeof value === 'string' && (key === 'uuid' || key === 'uuids' || key === 'pool' || key === 'grants' || key === 'choices' || value.startsWith('Compendium.') || isSelector(value))) return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectUuids(item, key));
  if (isRecord(value)) return Object.entries(value).flatMap(([itemKey, item]) => collectUuids(item, itemKey));
  return [];
}

function parseUuid(uuid: string): { pack: string; id: string } | null {
  const parts = uuid.split('.');
  if ((parts.length !== 4 && parts.length !== 5) || parts[0] !== 'Compendium' || parts[1] !== 'dnd5e') return null;
  const pack = parts[2];
  const id = parts.length === 5 ? parts[4] : parts[3];
  if (!/^[A-Za-z0-9_-]+$/.test(pack) || !/^[A-Za-z0-9_-]+$/.test(id) || parts.length === 5 && parts[3] !== 'Item') return null;
  return { pack, id };
}

function isSelector(value: string): boolean { return /^[A-Za-z][A-Za-z0-9_-]*(?::[^:]+)+$/.test(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function toPlainText(value: string): string {
  return normalizeFoundryDescription(value);
}

function fuzzyScore(item: Pick<FoundrySourceReference, 'name'>, query: string): number {
  if (query.length === 0) return 0;
  const name = item.name.toLocaleLowerCase();
  if (name === query) return 1000;
  if (name.startsWith(query)) return 800 - name.length;
  if (name.includes(query)) return 600 - name.length;
  let position = 0;
  for (const character of query) {
    position = name.indexOf(character, position);
    if (position < 0) return -1;
    position += 1;
  }
  return 300 - name.length;
}
