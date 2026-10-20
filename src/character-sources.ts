import type { CharacterRuleset } from './character-model';
import type { SourceStoreAdapter } from './source-store';
import type { SourceSnapshot } from './source-tree';
import { createFoundrySourceCatalog, type FoundrySourceCatalogAdapter, type FoundrySourceRecord, type FoundrySourceReference as CatalogSourceReference, type FoundryItemSummary, type ItemSearchFilters, type ResolvedFoundryDependency, type SpellSearchFilters, type FoundrySpellSummary } from './foundry-source-catalog';
import { isRecord, stringValues } from './foundry-utils';
import { projectStartingEquipment, type EquipmentPackageSummary } from './equipment';
import { readFoundryActivities, readFoundryUsesDiagnostic, type FoundryActivitySummary, type FoundryUsesSummary } from './foundry-activity-summary';
import { normalizeFoundryDescription } from './foundry-description';
import { formatFoundryIdentifier, readFoundryScaleValue, type FoundryScaleValue } from './foundry-scale-value';

export interface CharacterSourceOption {
  name: string;
  identifier: string;
  id: string;
  sourcePath: string;
}

export interface ClassSourceOption extends CharacterSourceOption { ruleset: CharacterRuleset; }

export interface ClassAdvancementSummary {
  id: string;
  type: string;
  level: number;
  title: string;
  hint: string;
  classRestriction?: string;
  dependencies: ResolvedSourceDependency[];
  spellLevel?: number;
  spellLists?: string[];
  abilityOptions?: string[];
  requiresChoice?: { key: string; value: string };
  raw: Record<string, unknown>;
}

export interface ClassSourceSummary {
  source: FoundrySourceReference;
  ruleset: CharacterRuleset;
  description?: string;
  overviewHtml?: string;
  hitDie: string;
  primaryAbility?: Record<string, unknown>;
  spellcasting?: Record<string, unknown>;
  spellOptions?: FoundrySourceReference[];
  proficiencies?: ClassProficiencies;
  features?: ClassFeatureSummary[];
  scales?: ClassScaleValueSummary[];
  advancements: ClassAdvancementSummary[];
  startingEquipment?: EquipmentPackageSummary;
}

export interface BackgroundAbilityScores { advancementId?: string; points?: number; locked?: string[]; fixed?: Record<string, number>; cap?: number; }
export interface BackgroundLanguageChoice { count: number; pool: string[]; }
export interface BackgroundEquipmentGroup { type: string; key?: string; count?: number; group?: string; }
export interface BackgroundFeatureSummary { advancementId: string; source: FoundrySourceReference; description?: string; activities?: FoundryActivitySummary[]; activityDiagnostics?: string[]; uses?: FoundryUsesSummary; }
export interface GrantedFeatAdvancementSummary {
  id: string;
  type: string;
  title: string;
  hint: string;
  dependencies: ResolvedSourceDependency[];
  spellLevel?: number;
  spellLists?: string[];
  abilityOptions?: string[];
  raw: Record<string, unknown>;
}
export interface GrantedFeatSourceSummary { source: FoundrySourceReference; advancementId?: string; minimumLevel?: number; description?: string; advancements: GrantedFeatAdvancementSummary[]; activeEffects?: Record<string, unknown>[]; }
export interface BackgroundSourceSummary {
  source: FoundrySourceReference;
  ruleset: CharacterRuleset;
  description?: string;
  abilityScores?: BackgroundAbilityScores;
  skills: string[];
  languages: string[];
  languageChoices: BackgroundLanguageChoice[];
  tools: string[];
  feat?: FoundrySourceReference;
  grantedFeats?: GrantedFeatSourceSummary[];
  grantedFeat?: GrantedFeatSourceSummary;
  features: BackgroundFeatureSummary[];
  equipment: BackgroundEquipmentGroup[];
  wealth?: string;
  startingEquipment?: EquipmentPackageSummary;
}

export interface ClassProficiencyChoice { advancementId: string; count: number; category: string; pool: string[]; }
export interface ClassProficiencies { armor: string[]; weapons: string[]; tools: string[]; savingThrows: string[]; languages: string[]; skills: string[]; choices: ClassProficiencyChoice[]; }
export interface ClassFeatureSummary { advancementId: string; level: number; source: FoundrySourceReference; requiresChoice?: { key: string; value: string }; classRestriction?: string; description?: string; activities?: FoundryActivitySummary[]; activityDiagnostics?: string[]; uses?: FoundryUsesSummary; activeEffects?: Record<string, unknown>[]; }
export interface ClassScaleValueSummary { advancementId: string; title: string; identifier?: string; level: number; requiresChoice?: { key: string; value: string }; classRestriction?: string; value?: number; values: ReadonlyMap<number, FoundryScaleValue>; diagnostics: string[]; }
export interface SpeciesScaleValueSummary { advancementId: string; title: string; identifier?: string; level: number; value?: number; values: ReadonlyMap<number, FoundryScaleValue>; diagnostics: string[]; }

export type FoundrySourceReference = CatalogSourceReference;

export type ResolvedSourceDependency = ResolvedFoundryDependency;

export interface SpeciesAdvancementSummary {
  id: string;
  type: string;
  level: number;
  hint: string;
  automatic: boolean;
  dependencies: ResolvedSourceDependency[];
  spellLevel?: number;
  spellLists?: string[];
  abilityOptions?: string[];
  nested?: boolean;
  requiresChoice?: { key: string; value: string };
  raw: Record<string, unknown>;
}
export interface SpeciesSizeSummary {
  advancementId: string;
  level: number;
  sizes: string[];
}
export interface SpeciesSpellGrantSummary {
  advancementId: string;
  level: number;
  spells: FoundrySourceReference[];
  abilityOptions: string[];
  preparation?: string;
  uses?: { max?: string | number; per?: string; requireSlot?: boolean };
  raw: Record<string, unknown>;
}

export interface SpeciesFeatureEntitlement { level: number; automatic?: boolean; advancementId?: string; selection?: { key: string; value: string }; }
export interface SpeciesFeatureSummary { source: FoundrySourceReference; level: number; description?: string; damageTypes?: string[]; automatic?: boolean; advancementId?: string; selection?: { key: string; value: string }; entitlements?: SpeciesFeatureEntitlement[]; activities?: FoundryActivitySummary[]; activityDiagnostics?: string[]; uses?: FoundryUsesSummary; activeEffects?: Record<string, unknown>[]; rollAnnotations?: SpeciesRollAnnotationSummary[]; savingThrowNotes?: SpeciesSavingThrowNoteSummary[]; hitPointModifiers?: SpeciesHitPointModifierSummary[]; effectDiagnostics?: string[]; }
export interface SpeciesResistanceSummary { damageType: string; source: FoundrySourceReference; advancementId: string; selected?: boolean; }
export interface SpeciesRollAnnotationSummary { target: 'saving-throw' | 'skill'; ability: string; mode: 'advantage' | 'disadvantage'; source: FoundrySourceReference; }
export interface SpeciesSavingThrowNoteSummary { text: string; source: FoundrySourceReference; }
export interface SpeciesHitPointModifierSummary { perLevel: number; source: FoundrySourceReference; }

export interface SpeciesSourceSummary {
  source: FoundrySourceReference;
  ruleset: CharacterRuleset;
  description?: string;
  overviewHtml?: string;
  movement?: Record<string, unknown>;
  senses?: Record<string, unknown>;
  creatureType?: Record<string, unknown>;
  creatureTypeProjection?: { value: string; source: FoundrySourceReference };
  resistances?: SpeciesResistanceSummary[];
  size?: SpeciesSizeSummary;
  spellGrants?: SpeciesSpellGrantSummary[];
  scales?: SpeciesScaleValueSummary[];
  features?: SpeciesFeatureSummary[];
  advancements: SpeciesAdvancementSummary[];
}

export type SourceReaderAdapter = FoundrySourceCatalogAdapter;

export interface SourceReader {
  listOrigins(ruleset: CharacterRuleset): Promise<CharacterSourceOption[]>;
  listClasses(ruleset: CharacterRuleset): Promise<ClassSourceOption[]>;
  listBackgrounds(ruleset: CharacterRuleset): Promise<CharacterSourceOption[]>;
}

export interface SourceIndex {
  listSpecies(ruleset: CharacterRuleset): Promise<FoundrySourceReference[]>;
  listClasses(ruleset: CharacterRuleset): Promise<FoundrySourceReference[]>;
  listBackgrounds(ruleset: CharacterRuleset): Promise<FoundrySourceReference[]>;
  getByUuid(uuid: string): Promise<FoundrySourceReference | null>;
  getFeatSummary(source: FoundrySourceReference, ruleset: CharacterRuleset): Promise<GrantedFeatSourceSummary | null>;
  getRaw(sourcePath: string): Record<string, unknown> | undefined;
  getSpeciesSummary(ruleset: CharacterRuleset, sourcePath: string): Promise<SpeciesSourceSummary>;
  getClassSummary(ruleset: CharacterRuleset, sourcePath: string): Promise<ClassSourceSummary>;
  getBackgroundSummary(ruleset: CharacterRuleset, sourcePath: string): Promise<BackgroundSourceSummary>;
  getItemSummary(ruleset: CharacterRuleset, sourcePath: string): Promise<FoundryItemSummary | null>;
  searchItems(query: string, filters?: ItemSearchFilters): Promise<FoundryItemSummary[]>;
  searchSpells(filters: SpellSearchFilters): Promise<FoundrySpellSummary[]>;
  resolveSelector(selector: string, ruleset: CharacterRuleset): Promise<FoundryItemSummary[]>;
  getWeaponMasteryDescriptions(): Promise<ReadonlyMap<string, string>>;
  getWeaponPropertyDescriptions(ruleset: CharacterRuleset): Promise<ReadonlyMap<string, string>>;
}

export interface SourceIndexOptions {
  lookupAdapter?: SourceStoreAdapter;
  lookupPath?: string;
  snapshot?: SourceSnapshot | (() => Promise<SourceSnapshot>);
}

export function createSourceReader(adapter: SourceReaderAdapter, sourceRoot: string): SourceReader {
  const catalog = createFoundrySourceCatalog(adapter, sourceRoot);
  return {
    async listOrigins(ruleset): Promise<CharacterSourceOption[]> {
      return (await catalog.list('species', ruleset)).map(toCharacterSourceOption);
    },
    async listClasses(ruleset): Promise<ClassSourceOption[]> {
      return (await catalog.list('class', ruleset)).map((record) => ({ ...toCharacterSourceOption(record), ruleset }));
    },
    async listBackgrounds(ruleset): Promise<CharacterSourceOption[]> {
      return (await catalog.list('background', ruleset)).map(toCharacterSourceOption);
    },
  };
}

function toCharacterSourceOption(record: FoundrySourceRecord): CharacterSourceOption { return { name: record.name, identifier: record.identifier ?? '', id: record.id, sourcePath: record.sourcePath }; }

export function createSourceIndex(adapter: SourceReaderAdapter, sourceRoot: string, options: SourceIndexOptions = {}): SourceIndex {
  const root = sourceRoot.replace(/\/$/, '');
  const catalog = createFoundrySourceCatalog(adapter, sourceRoot);
  const records = new Map<string, FoundrySourceReference>();
  const speciesRecords = new Map<string, { reference: FoundrySourceReference; value: Record<string, unknown> }>();
  const backgroundRecords = new Map<string, { reference: FoundrySourceReference; value: Record<string, unknown> }>();
  const sourceRecords = new Map<string, Record<string, unknown>>();
  let lookupLoaded = false;
  let lookupSnapshot: SourceSnapshot | undefined;
  const lookupEntries = new Map<string, FoundrySourceReference>();
  let masteryDescriptionsPromise: Promise<ReadonlyMap<string, string>> | undefined;
  const propertyDescriptionsPromises = new Map<CharacterRuleset, Promise<ReadonlyMap<string, string>>>();

  async function loadLookup(): Promise<void> {
    if (lookupLoaded) return;
    lookupLoaded = true;
    if (!options.lookupAdapter || !options.lookupPath || !options.snapshot) return;
    lookupSnapshot = typeof options.snapshot === 'function' ? await options.snapshot() : options.snapshot;
    if (!(await options.lookupAdapter.exists(options.lookupPath))) return;
    let value: unknown;
    try { value = JSON.parse(await options.lookupAdapter.read(options.lookupPath)); } catch { return; }
    if (!isRecord(value) || value.sourceRoot !== root || !sameSnapshot(value.snapshot, lookupSnapshot) || !isRecord(value.entries)) {
      await persistLookup();
      return;
    }
    for (const [uuid, entry] of Object.entries(value.entries)) {
      if (isValidCachedEntry(uuid, entry)) lookupEntries.set(uuid, entry);
    }
  }

  async function persistLookup(): Promise<void> {
    if (!options.lookupAdapter || !options.lookupPath || !lookupSnapshot) return;
    await options.lookupAdapter.write(options.lookupPath, JSON.stringify({ sourceRoot: root, snapshot: lookupSnapshot, entries: Object.fromEntries(lookupEntries) }, null, 2));
  }

  async function readSpecies(ruleset: CharacterRuleset): Promise<FoundrySourceReference[]> {
    const result = await catalog.list('species', ruleset);
    for (const record of result) {
      const reference = toReference(record);
      speciesRecords.set(`${ruleset}:${record.sourcePath}`, { reference, value: record.raw });
      rememberRecord(record);
    }
    return result.map(toReference);
  }

  async function readClasses(ruleset: CharacterRuleset): Promise<FoundrySourceReference[]> {
    const result = await catalog.list('class', ruleset);
    result.forEach(rememberRecord);
    return result.map(toReference);
  }

  async function readBackgrounds(ruleset: CharacterRuleset): Promise<FoundrySourceReference[]> {
    const result = await catalog.list('background', ruleset);
    for (const record of result) {
      const reference = toReference(record);
      backgroundRecords.set(`${ruleset}:${record.sourcePath}`, { reference, value: record.raw });
      rememberRecord(record);
    }
    return result.map(toReference);
  }

  async function indexPack(pack: string): Promise<void> {
    for (const record of await catalog.listPack(pack)) rememberRecord(record);
  }

  function toReference(record: FoundrySourceRecord): FoundrySourceReference { const { raw: _raw, ...reference } = record; return reference; }
  function rememberRecord(record: FoundrySourceRecord): void {
    records.set(`Compendium.${record.pack}.Item.${record.id}`, toReference(record));
    records.set(`Compendium.${record.pack}.${record.id}`, toReference(record));
    sourceRecords.set(record.sourcePath, record.raw);
  }
  function rememberDependencySources(dependencies: ResolvedSourceDependency[]): void {
    for (const dependency of dependencies) if (dependency.source) {
      const raw = catalog.getRaw(dependency.source.sourcePath);
      records.set(`Compendium.${dependency.source.pack}.Item.${dependency.source.id}`, dependency.source);
      records.set(`Compendium.${dependency.source.pack}.${dependency.source.id}`, dependency.source);
      if (raw) sourceRecords.set(dependency.source.sourcePath, raw);
    }
  }

  async function projectGrantedFeat(source: FoundrySourceReference, ruleset: CharacterRuleset, advancementId?: string): Promise<GrantedFeatSourceSummary> {
    const raw = sourceRecords.get(source.sourcePath) ?? catalog.getRaw(source.sourcePath);
    const system = raw && isRecord(raw.system) ? raw.system : {};
    const prerequisites = isRecord(system.prerequisites) ? system.prerequisites : undefined;
    const minimumLevel = typeof prerequisites?.level === 'number' && Number.isInteger(prerequisites.level) && prerequisites.level >= 1 ? prerequisites.level : undefined;
    const rawAdvancement = system.advancement;
    const entries = rawAdvancement === undefined ? [] : Array.isArray(rawAdvancement)
      ? rawAdvancement.map((value) => ({ value, id: isRecord(value) && typeof value._id === 'string' ? value._id : undefined }))
      : isRecord(rawAdvancement) ? Object.entries(rawAdvancement).map(([id, value]) => ({ value, id })) : null;
    if (entries === null) throw new Error(`Invalid advancement data at ${source.sourcePath}`);
    const advancements: GrantedFeatAdvancementSummary[] = [];
    for (const candidate of entries) {
      const entry = candidate.value;
      if (!isRecord(entry) || typeof candidate.id !== 'string' || typeof entry.type !== 'string') continue;
      const configuration = isRecord(entry.configuration) ? entry.configuration : {};
      const spellMetadata = readSpellAdvancementMetadata(configuration);
      let dependencies = spellMetadata?.valid === true && spellPoolValues(configuration).length === 0
        ? (await catalog.searchSpells({ ruleset, level: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists })).map((spell) => ({ uuid: `Compendium.${spell.pack}.Item.${spell.id}`, source: spell, ...(spell.description === undefined ? {} : { description: spell.description }) }))
        : await catalog.resolveDependencies(configuration, ruleset);
      if (entry.type === 'ItemChoice' && configuration.type === 'spell' && spellMetadata?.valid !== true) dependencies = [...dependencies, { uuid: 'spell:*', source: null, reason: 'unsupported spell restriction' }];
      rememberDependencySources(dependencies);
      advancements.push({
        id: candidate.id,
        type: entry.type,
        title: typeof entry.title === 'string' ? entry.title : entry.type,
        hint: typeof entry.hint === 'string' ? entry.hint : '',
        dependencies,
        ...(spellMetadata?.valid === true ? { spellLevel: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists, abilityOptions: stringValues(isRecord(configuration.spell) ? configuration.spell.ability : undefined) } : {}),
        raw: entry,
      });
    }
    const description = isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value) : undefined;
    return { source, ...(advancementId === undefined ? {} : { advancementId }), ...(minimumLevel === undefined ? {} : { minimumLevel }), ...(description ? { description } : {}), advancements, activeEffects: Array.isArray(raw?.effects) ? raw.effects.filter(isRecord) : [] };
  }

  return {
    listSpecies: readSpecies,
    listClasses: readClasses,
    listBackgrounds: readBackgrounds,
    async getByUuid(uuid) {
      await loadLookup();
      const cached = lookupEntries.get(uuid);
      if (cached) return cached;
      const parts = uuid.split('.');
      if (!parseUuid(uuid)) return null;
      const pack = parts[2];
      await indexPack(pack);
      const source = records.get(uuid) ?? null;
      if (source) { lookupEntries.set(uuid, source); await persistLookup(); }
      return source;
    },
    async getFeatSummary(source, ruleset) {
      if (source.type !== 'feat') return null;
      const sourcePack = /^packs\/_source\/([^/]+)\//.exec(source.sourcePath)?.[1];
      if (sourcePack === undefined || source.pack !== `dnd5e.${sourcePack}`) return null;
      const raw = await catalog.getRawRecord(source.sourcePath);
      if (!raw || raw.type !== 'feat' || raw._id !== source.id || typeof raw.name !== 'string' || !isRecord(raw.system)) return null;
      const sourceRules = isRecord(raw.system.source) ? raw.system.source.rules : undefined;
      if ((sourceRules === '2014' || sourceRules === '2024') && sourceRules !== ruleset) return null;
      const canonical: FoundrySourceReference = {
        sourcePath: source.sourcePath,
        pack: `dnd5e.${sourcePack}`,
        type: 'feat',
        id: raw._id,
        ...(typeof raw.system.identifier === 'string' ? { identifier: raw.system.identifier } : {}),
        name: raw.name,
      };
      sourceRecords.set(canonical.sourcePath, raw);
      return projectGrantedFeat(canonical, ruleset);
    },
    getRaw(sourcePath) { return catalog.getRaw(sourcePath); },
    searchSpells: (filters) => catalog.searchSpells(filters),
    async getSpeciesSummary(ruleset, sourcePath): Promise<SpeciesSourceSummary> {
      await readSpecies(ruleset);
      const record = speciesRecords.get(`${ruleset}:${sourcePath}`);
      if (!record) throw new Error(`Species source record not found: ${sourcePath}`);
      const system = isRecord(record.value.system) ? record.value.system : {};
      const rawAdvancement = system.advancement;
      const entries = rawAdvancement === undefined ? [] : Array.isArray(rawAdvancement)
        ? rawAdvancement.map((value) => value)
        : isRecord(rawAdvancement) ? Object.values(rawAdvancement) : null;
      if (entries === null) throw new Error(`Invalid advancement data at ${sourcePath}`);
      const advancements: SpeciesAdvancementSummary[] = [];
      const visited = new Set<string>();
      async function appendAdvancements(values: unknown[], context: string, depth: number, requiresChoice?: { key: string; value: string }): Promise<void> {
        if (depth > 8) { advancements.push({ id: `${context}:depth`, type: 'Unsupported', level: 0, hint: '', automatic: false, dependencies: [{ uuid: context, source: null, reason: 'maximum dependency depth exceeded' }], raw: {} }); return; }
        for (const [index, value] of values.entries()) {
        if (!isRecord(value) || typeof value._id !== 'string' || typeof value.type !== 'string' || (value.level !== undefined && typeof value.level !== 'number') || (value.hint !== undefined && typeof value.hint !== 'string')) {
          throw new Error(`Invalid advancement entry at ${context} system.advancement[${index}]`);
        }
        const configuration = isRecord(value.configuration) ? value.configuration : undefined;
        const automatic = configuration === undefined || !hasConfiguredChoice(configuration);
        const spellMetadata = configuration === undefined ? undefined : readSpellAdvancementMetadata(configuration);
        let dependencies: ResolvedSourceDependency[] = [];
        if (configuration !== undefined) {
          if (spellMetadata?.valid === true && spellPoolValues(configuration).length === 0) {
            dependencies = (await catalog.searchSpells({ ruleset, level: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists })).map((spell) => ({
              uuid: `Compendium.${spell.pack}.Item.${spell.id}`,
              source: spell,
              ...(spell.description === undefined ? {} : { description: spell.description }),
            }));
          } else {
            dependencies = await catalog.resolveDependencies(configuration, ruleset);
            if (spellMetadata?.valid === true) {
              const spellsByReference = new Map((await catalog.listSpells(ruleset)).map((spell) => [sourceReferenceKey(spell), spell]));
              dependencies = dependencies.map((dependency) => {
                if (dependency.source?.type !== 'spell') return dependency;
                const spell = spellsByReference.get(sourceReferenceKey(dependency.source));
                return spell === undefined
                  ? dependency
                  : { ...dependency, source: spell, ...(dependency.description === undefined && spell.description !== undefined ? { description: spell.description } : {}) };
              });
            }
          }
        }
        rememberDependencySources(dependencies);
        advancements.push({
          id: value._id,
          type: value.type,
          level: typeof value.level === 'number' ? value.level : 0,
          hint: value.hint ?? '',
          automatic,
          dependencies,
          ...(spellMetadata?.valid === true ? { spellLevel: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists, abilityOptions: spellMetadata.abilityOptions } : {}),
          ...(depth > 0 ? { nested: true } : {}),
          ...(requiresChoice === undefined ? {} : { requiresChoice }),
          raw: value,
        });
        for (const dependency of dependencies) {
          if (!dependency.source) continue;
          if (dependency.uuid.includes(':')) continue;
          if (visited.has(dependency.uuid)) {
            advancements.push({ id: `${dependency.uuid}:cycle`, type: 'Unsupported', level: 0, hint: '', automatic: false, dependencies: [{ uuid: dependency.uuid, source: dependency.source, reason: 'cyclic dependency' }], raw: {} });
            continue;
          }
          visited.add(dependency.uuid);
          const nested = sourceRecords.get(dependency.source.sourcePath) ?? catalog.getRaw(dependency.source.sourcePath);
          const nestedSystem = nested && isRecord(nested.system) ? nested.system : undefined;
          const nestedAdvancement = nestedSystem?.advancement;
          const nestedEntries = Array.isArray(nestedAdvancement) ? nestedAdvancement : isRecord(nestedAdvancement) ? Object.values(nestedAdvancement) : [];
          const nestedRequiresChoice = requiresChoice ?? (!automatic && configuration !== undefined ? { key: `species:${value._id}`, value: dependency.uuid } : undefined);
          await appendAdvancements(nestedEntries, dependency.source.sourcePath, depth + 1, nestedRequiresChoice);
          visited.delete(dependency.uuid);
        }
        }
      }
      await appendAdvancements(entries, sourcePath, 0);
      const sizeAdvancements = advancements.filter((entry) => entry.type === 'Size');
      const size = sizeAdvancements.length === 0 ? undefined : (() => {
        const entry = sizeAdvancements[0]!;
        const configuration = isRecord(entry.raw.configuration) ? entry.raw.configuration : undefined;
        const sizes = stringValues(configuration?.sizes);
        if (sizes.length === 0) throw new Error(`Invalid Size advancement at ${sourcePath} (${entry.id})`);
        return { advancementId: entry.id, level: entry.level, sizes };
      })();
      const featureMap = new Map<string, SpeciesFeatureSummary>();
      for (const advancement of advancements) for (const dependency of advancement.dependencies) {
        if (!dependency.source || dependency.source.type !== 'feat') continue;
        const sourceRecord = sourceRecords.get(dependency.source.sourcePath);
        const featureSystem = sourceRecord && isRecord(sourceRecord.system) ? sourceRecord.system : undefined;
        const description = featureSystem && isRecord(featureSystem.description) && typeof featureSystem.description.value === 'string' ? toPlainText(featureSystem.description.value, featureSystem) : undefined;
        const damageTypes = featureSystem ? extractDamageTypes(featureSystem) : [];
        const activitySummary = featureSystem ? readFoundryActivities(featureSystem) : { activities: [], diagnostics: [] };
        const uses = featureSystem ? readFoundryUsesDiagnostic(featureSystem) : { uses: undefined, diagnostics: [] };
        const effects = sourceRecord && featureSystem ? extractSpeciesEffectProjections(sourceRecord, featureSystem, dependency.source) : undefined;
        const existing = featureMap.get(dependency.source.sourcePath);
        const selection = advancement.requiresChoice ?? (advancement.automatic ? undefined : { key: `species:${advancement.id}`, value: dependency.uuid });
        const entitlement = { level: advancement.level, automatic: advancement.automatic, advancementId: advancement.id, ...(selection === undefined ? {} : { selection }) };
        const entitlements = existing?.entitlements ?? (existing === undefined ? [] : [{ level: existing.level, automatic: existing.automatic, advancementId: existing.advancementId, ...(existing.selection === undefined ? {} : { selection: existing.selection }) }]);
        const allEntitlements = [...entitlements, entitlement];
        const level = Math.min(...allEntitlements.map((candidate) => candidate.level));
        const primaryEntitlement = allEntitlements.find((candidate) => candidate.level === level)!;
        const automatic = allEntitlements.some((candidate) => candidate.level === level && candidate.automatic === true);
        featureMap.set(dependency.source.sourcePath, { source: dependency.source, level, ...(description ?? existing?.description ? { description: description ?? existing?.description } : {}), ...((damageTypes.length > 0 ? damageTypes : existing?.damageTypes) ? { damageTypes: damageTypes.length > 0 ? damageTypes : existing?.damageTypes } : {}), ...((activitySummary.activities.length > 0 ? activitySummary.activities : existing?.activities) ? { activities: activitySummary.activities.length > 0 ? activitySummary.activities : existing?.activities } : {}), ...(activitySummary.diagnostics.length > 0 || uses.diagnostics.length > 0 ? { activityDiagnostics: [...activitySummary.diagnostics, ...uses.diagnostics] } : existing?.activityDiagnostics ? { activityDiagnostics: existing.activityDiagnostics } : {}), ...(uses.uses ? { uses: uses.uses } : existing?.uses ? { uses: existing.uses } : {}), ...(effects?.rollAnnotations.length ? { rollAnnotations: effects.rollAnnotations } : existing?.rollAnnotations ? { rollAnnotations: existing.rollAnnotations } : {}), ...(effects?.savingThrowNotes.length ? { savingThrowNotes: effects.savingThrowNotes } : existing?.savingThrowNotes ? { savingThrowNotes: existing.savingThrowNotes } : {}), ...(effects?.hitPointModifiers.length ? { hitPointModifiers: effects.hitPointModifiers } : existing?.hitPointModifiers ? { hitPointModifiers: existing.hitPointModifiers } : {}), ...(effects?.diagnostics.length ? { effectDiagnostics: effects.diagnostics } : existing?.effectDiagnostics ? { effectDiagnostics: existing.effectDiagnostics } : {}), automatic, advancementId: primaryEntitlement.advancementId, ...(automatic || primaryEntitlement.selection === undefined ? {} : { selection: primaryEntitlement.selection }), entitlements: allEntitlements });
      }
      for (const feature of featureMap.values()) {
        const featureRecord = sourceRecords.get(feature.source.sourcePath);
        if (featureRecord && Array.isArray(featureRecord.effects)) feature.activeEffects = featureRecord.effects.filter(isRecord);
      }
      const resistances: SpeciesResistanceSummary[] = advancements.flatMap((advancement) => {
        if (advancement.type !== 'Trait') return [];
        const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : undefined;
        const grants = [
          ...stringValues(configuration?.grants),
          ...(Array.isArray(configuration?.choices) ? configuration.choices.flatMap((choice) => isRecord(choice) ? stringValues(choice.pool) : []) : []),
        ].filter((value) => value.startsWith('dr:'));
        const title = typeof advancement.raw.title === 'string' ? advancement.raw.title : undefined;
        const source = advancement.dependencies.find((dependency) => dependency.source?.type === 'feat')?.source
          ?? [...featureMap.values()].find((feature) => feature.source.name === title)?.source
          ?? record.reference;
        const fixed = new Set(stringValues(configuration?.grants));
        return grants.map((grant) => ({ damageType: grant.slice(3), source, advancementId: advancement.id, selected: fixed.has(grant) }));
      });
      const spellGrants = advancements.flatMap((advancement): SpeciesSpellGrantSummary[] => {
        const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : undefined;
        const spell = configuration && isRecord(configuration.spell) ? configuration.spell : undefined;
        const spells = advancement.dependencies.flatMap((dependency) => dependency.source?.type === 'spell' ? [{ ...dependency.source }] : []);
        if (advancement.type !== 'ItemGrant' || spell === undefined || spells.length === 0) return [];
        const uses = isRecord(spell.uses) ? spell.uses : undefined;
        const abilityOptions = stringValues(spell.ability).flatMap((ability) => SPELLCASTING_ABILITY_LABELS[ability] === undefined ? [] : [SPELLCASTING_ABILITY_LABELS[ability]]);
        return [{ advancementId: advancement.id, level: advancement.level, spells, abilityOptions: [...new Set(abilityOptions)], ...(typeof spell.preparation === 'string' ? { preparation: spell.preparation } : {}), ...(uses === undefined ? {} : { uses: { ...(typeof uses.max === 'string' || typeof uses.max === 'number' ? { max: uses.max } : {}), ...(typeof uses.per === 'string' ? { per: uses.per } : {}), ...(typeof uses.requireSlot === 'boolean' ? { requireSlot: uses.requireSlot } : {}) } }), raw: advancement.raw }];
      });
      return {
        source: record.reference,
        ruleset,
        ...(isRecord(system.description) && typeof system.description.value === 'string' ? { description: toPlainText(system.description.value), overviewHtml: system.description.value } : {}),
        ...(isRecord(system.movement) ? { movement: system.movement } : {}),
        ...(isRecord(system.senses) ? { senses: system.senses } : {}),
        ...(isRecord(system.type) ? { creatureType: system.type } : {}),
        ...(isRecord(system.type) && typeof system.type.value === 'string' ? { creatureTypeProjection: { value: system.type.value, source: record.reference } } : {}),
        ...(resistances.length > 0 ? { resistances } : {}),
        ...(size === undefined ? {} : { size }),
        ...(featureMap.size > 0 ? { features: [...featureMap.values()] } : {}),
        ...(spellGrants.length > 0 ? { spellGrants } : {}),
        ...(() => { const scales = extractSpeciesScales(advancements); return scales.length > 0 ? { scales } : {}; })(),
        advancements,
      };
    },
    async getClassSummary(ruleset, sourcePath): Promise<ClassSourceSummary> {
      await readClasses(ruleset);
      const value = sourceRecords.get(sourcePath);
      if (!value) throw new Error(`Class source record not found: ${sourcePath}`);
      const system = isRecord(value.system) ? value.system : {};
      const reference = records.get(`Compendium.dnd5e.${ruleset === '2014' ? 'classes' : 'classes24'}.Item.${value._id}`);
      if (!reference) throw new Error(`Class source record not found: ${sourcePath}`);
      const classIdentifier = typeof system.identifier === 'string' ? system.identifier : undefined;
      const subclassDependencies = classIdentifier === undefined ? [] : await getSubclassDependencies(ruleset, classIdentifier);
      const rawAdvancement = system.advancement;
      const entries = rawAdvancement === undefined ? [] : Array.isArray(rawAdvancement)
        ? rawAdvancement
        : isRecord(rawAdvancement) ? Object.values(rawAdvancement) : null;
      if (entries === null) throw new Error(`Invalid advancement data at ${sourcePath}`);
      const advancements: ClassAdvancementSummary[] = [];
      const visitedFeatureAdvancements = new Set<string>();
      async function appendFeatureAdvancements(values: unknown[], context: string, inheritedLevel: number, requiresChoice: { key: string; value: string } | undefined, depth: number): Promise<void> {
        if (depth > 8) return;
        for (const [index, value] of values.entries()) {
          if (!isRecord(value) || typeof value._id !== 'string' || typeof value.type !== 'string') throw new Error(`Invalid nested advancement entry at ${context} system.advancement[${index}]`);
          const featureKey = `${context}:${value._id}`;
          if (visitedFeatureAdvancements.has(featureKey)) continue;
          visitedFeatureAdvancements.add(featureKey);
          const configuration = isRecord(value.configuration) ? value.configuration : {};
          const spellMetadata = readClassSpellAdvancementMetadata(configuration, system);
          let dependencies = spellMetadata?.valid === true && spellPoolValues(configuration).length === 0
            ? (await catalog.searchSpells({ ruleset, level: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists })).map((spell) => ({ uuid: `Compendium.${spell.pack}.Item.${spell.id}`, source: spell, ...(spell.description === undefined ? {} : { description: spell.description }) }))
            : await catalog.resolveDependencies(configuration, ruleset);
          if (spellMetadata?.valid === true && spellPoolValues(configuration).length > 0) {
            const spellsByReference = new Map((await catalog.listSpells(ruleset)).map((spell) => [sourceReferenceKey(spell), spell]));
            dependencies = dependencies.map((dependency) => {
              if (dependency.source?.type !== 'spell') return dependency;
              const spell = spellsByReference.get(sourceReferenceKey(dependency.source));
              return spell === undefined ? dependency : { ...dependency, source: spell, ...(dependency.description === undefined && spell.description !== undefined ? { description: spell.description } : {}) };
            });
          }
          if (value.type === 'ItemChoice' && configuration.type === 'spell' && spellMetadata?.valid !== true) dependencies = [...dependencies, { uuid: 'spell:*', source: null, reason: 'unsupported spell restriction' }];
          rememberDependencySources(dependencies);
          const level = typeof value.level === 'number' && value.level > 0 ? value.level : inheritedLevel;
          advancements.push({ id: value._id, type: value.type, level, title: typeof value.title === 'string' ? value.title : value.type, hint: typeof value.hint === 'string' ? value.hint : '', dependencies, ...(spellMetadata?.valid === true ? { spellLevel: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists, abilityOptions: spellMetadata.abilityOptions } : {}), ...(requiresChoice === undefined ? {} : { requiresChoice }), raw: value });
          for (const dependency of dependencies) {
            if (!dependency.source || dependency.uuid.includes(':')) continue;
            const nested = sourceRecords.get(dependency.source.sourcePath) ?? catalog.getRaw(dependency.source.sourcePath);
            const nestedSystem = nested && isRecord(nested.system) ? nested.system : undefined;
            const nestedAdvancement = nestedSystem?.advancement;
            const nestedEntries = Array.isArray(nestedAdvancement) ? nestedAdvancement : isRecord(nestedAdvancement) ? Object.values(nestedAdvancement) : [];
            const nestedRequirement = classAdvancementRequiresSelection(value.type, configuration)
              ? { key: `class:${value._id}`, value: dependency.uuid }
              : requiresChoice;
            if (nestedEntries.length > 0) await appendFeatureAdvancements(nestedEntries, dependency.source.sourcePath, level, nestedRequirement, depth + 1);
          }
        }
      }
      for (const [index, entry] of entries.entries()) {
        if (!isRecord(entry) || typeof entry._id !== 'string' || typeof entry.type !== 'string' || (entry.level !== undefined && typeof entry.level !== 'number') || (entry.title !== undefined && typeof entry.title !== 'string') || (entry.hint !== undefined && typeof entry.hint !== 'string') || (entry.classRestriction !== undefined && typeof entry.classRestriction !== 'string')) {
          throw new Error(`Invalid advancement entry at ${sourcePath} system.advancement[${index}]`);
        }
        const configuration = isRecord(entry.configuration) ? entry.configuration : {};
        const spellMetadata = readClassSpellAdvancementMetadata(configuration, system);
        let dependencies = entry.type === 'Subclass' && subclassDependencies.length > 0
          ? subclassDependencies
          : spellMetadata?.valid === true && spellPoolValues(configuration).length === 0
            ? (await catalog.searchSpells({ ruleset, level: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists })).map((spell) => ({ uuid: `Compendium.${spell.pack}.Item.${spell.id}`, source: spell, ...(spell.description === undefined ? {} : { description: spell.description }) }))
            : await catalog.resolveDependencies(configuration, ruleset);
        if (spellMetadata?.valid === true && spellPoolValues(configuration).length > 0) {
          const spellsByReference = new Map((await catalog.listSpells(ruleset)).map((spell) => [sourceReferenceKey(spell), spell]));
          dependencies = dependencies.map((dependency) => {
            if (dependency.source?.type !== 'spell') return dependency;
            const spell = spellsByReference.get(sourceReferenceKey(dependency.source));
            return spell === undefined ? dependency : { ...dependency, source: spell, ...(dependency.description === undefined && spell.description !== undefined ? { description: spell.description } : {}) };
          });
        }
        if (entry.type === 'ItemChoice' && configuration.type === 'spell' && spellMetadata?.valid !== true) {
          dependencies = [...dependencies, { uuid: 'spell:*', source: null, reason: 'unsupported spell restriction' }];
        }
        rememberDependencySources(dependencies);
        advancements.push({ id: entry._id, type: entry.type, level: typeof entry.level === 'number' ? entry.level : 0, title: typeof entry.title === 'string' ? entry.title : entry.type, hint: typeof entry.hint === 'string' ? entry.hint : '', ...(entry.classRestriction === undefined ? {} : { classRestriction: entry.classRestriction }), dependencies, ...(spellMetadata?.valid === true ? { spellLevel: spellMetadata.spellLevel, spellLists: spellMetadata.spellLists, abilityOptions: spellMetadata.abilityOptions } : {}), raw: entry });
        for (const dependency of dependencies) {
          const feature = dependency.source === null ? undefined : catalog.getRaw(dependency.source.sourcePath);
          const cantrip = feature === undefined ? undefined : grantedCantripMetadata(feature);
          const featureSource = dependency.source;
          if (cantrip !== undefined && featureSource !== null) {
            const cantripDependencies = (await catalog.searchSpells({ ruleset, level: 0, spellLists: [cantrip.spellList] })).map((spell) => ({ uuid: `Compendium.${spell.pack}.Item.${spell.id}`, source: spell, ...(spell.description === undefined ? {} : { description: spell.description }) }));
            const cantripId = `${entry._id}:${featureSource.id}:cantrip`;
            advancements.push({ id: cantripId, type: 'ItemChoice', level: typeof entry.level === 'number' ? entry.level : 0, title: featureSource.name, hint: cantrip.hint, dependencies: cantripDependencies, spellLevel: 0, spellLists: [cantrip.spellList], abilityOptions: [], requiresChoice: { key: `class:${entry._id}`, value: dependency.uuid }, raw: { _id: cantripId, type: 'ItemChoice', title: featureSource.name, hint: cantrip.hint, configuration: { type: 'spell', choices: 1, pool: [], restriction: { type: 'class', list: [`class:${cantrip.spellList}`] } } } });
          }
          const nested = dependency.source === null ? undefined : sourceRecords.get(dependency.source.sourcePath) ?? catalog.getRaw(dependency.source.sourcePath);
          const nestedSystem = nested && isRecord(nested.system) ? nested.system : undefined;
          const nestedAdvancement = nestedSystem?.advancement;
          const nestedEntries = Array.isArray(nestedAdvancement) ? nestedAdvancement : isRecord(nestedAdvancement) ? Object.values(nestedAdvancement) : [];
          const nestedRequirement = classAdvancementRequiresSelection(entry.type, configuration)
            ? { key: `class:${entry._id}`, value: dependency.uuid }
            : undefined;
          if (dependency.source && nestedEntries.length > 0) await appendFeatureAdvancements(nestedEntries, dependency.source.sourcePath, typeof entry.level === 'number' ? entry.level : 0, nestedRequirement, 0);
        }
      }
      const hitDie = ruleset === '2014'
        ? typeof system.hitDice === 'string' ? system.hitDice : ''
        : isRecord(system.hd) && typeof system.hd.denomination === 'string' ? system.hd.denomination : '';
      if (!hitDie) throw new Error(`Missing class hit die at ${sourcePath}`);
      const primaryLevelOneAdvancements = advancements.filter((entry) => entry.level <= 1 && (entry.classRestriction === undefined || entry.classRestriction === 'primary'));
      const primaryClassAdvancements = advancements.filter((entry) => entry.classRestriction === undefined || entry.classRestriction === 'primary');
      const startingEquipment = Array.isArray(system.startingEquipment) ? await projectStartingEquipment(system.startingEquipment, ruleset === '2024' && typeof system.wealth === 'string' ? system.wealth : undefined) : undefined;
      const spellcasting = isRecord(system.spellcasting) ? system.spellcasting : undefined;
      const configuredSpellLists = stringValues(spellcasting?.spellLists);
      const spellLists = configuredSpellLists.length > 0 ? configuredSpellLists : classIdentifier === undefined ? [] : [classIdentifier];
      const spellOptions = ruleset === '2024' && spellcasting !== undefined && spellLists.length > 0
        ? (await Promise.all([0, 1].map((level) => catalog.searchSpells({ ruleset, level, spellLists })))).flat()
        : [];
      return { source: reference, ruleset, ...(isRecord(system.description) && typeof system.description.value === 'string' ? { description: toPlainText(system.description.value), overviewHtml: system.description.value } : {}), hitDie, ...(isRecord(system.primaryAbility) ? { primaryAbility: system.primaryAbility } : {}), ...(spellcasting === undefined ? {} : { spellcasting }), ...(spellOptions.length > 0 ? { spellOptions } : {}), proficiencies: extractClassProficiencies(primaryLevelOneAdvancements), features: extractClassFeatures(primaryClassAdvancements, sourceRecords), scales: extractClassScales(primaryClassAdvancements), advancements, ...(startingEquipment === undefined ? {} : { startingEquipment }) };
    },
    async getBackgroundSummary(ruleset, sourcePath): Promise<BackgroundSourceSummary> {
      await readBackgrounds(ruleset);
      const record = backgroundRecords.get(`${ruleset}:${sourcePath}`);
      if (!record) throw new Error(`Background source record not found: ${sourcePath}`);
      const system = isRecord(record.value.system) ? record.value.system : {};
      const rawAdvancement = system.advancement;
      const entries = rawAdvancement === undefined ? [] : Array.isArray(rawAdvancement) ? rawAdvancement : isRecord(rawAdvancement) ? Object.values(rawAdvancement) : null;
      if (entries === null) throw new Error(`Invalid advancement data at ${sourcePath}`);
      const advancements: ClassAdvancementSummary[] = [];
      for (const [index, entry] of entries.entries()) {
        if (!isRecord(entry) || typeof entry._id !== 'string' || typeof entry.type !== 'string') throw new Error(`Invalid advancement entry at ${sourcePath} system.advancement[${index}]`);
        const configuration = isRecord(entry.configuration) ? entry.configuration : {};
      const dependencies = await catalog.resolveDependencies(configuration, ruleset);
        rememberDependencySources(dependencies);
        advancements.push({ id: entry._id, type: entry.type, level: typeof entry.level === 'number' ? entry.level : 0, title: typeof entry.title === 'string' ? entry.title : entry.type, hint: typeof entry.hint === 'string' ? entry.hint : '', dependencies, raw: entry });
      }
      const skills: string[] = []; const languages: string[] = []; const tools: string[] = []; const languageChoices: BackgroundLanguageChoice[] = [];
      for (const advancement of advancements.filter((entry) => entry.type === 'Trait')) {
        const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : {};
        for (const grant of stringValues(configuration.grants)) {
          const category = grant.split(':', 1)[0];
          if (category === 'skills') skills.push(grant);
          else if (category === 'languages') languages.push(grant);
          else if (category === 'tool' || category === 'tools') tools.push(grant);
        }
        if (Array.isArray(configuration.choices)) for (const choice of configuration.choices) if (isRecord(choice) && typeof choice.count === 'number') {
          const pool = stringValues(choice.pool);
          if (pool.some((value) => value.startsWith('languages:'))) languageChoices.push({ count: choice.count, pool });
        }
      }
      const itemGrants = advancements.filter((entry) => entry.type === 'ItemGrant');
      const granted = itemGrants.flatMap((entry) => entry.dependencies.flatMap((dependency) => dependency.source ? [{ advancementId: entry.id, source: dependency.source }] : []));
      const grantedFeatEntries = granted.filter((entry) => entry.source.type === 'feat');
      const grantedFeats = await Promise.all(grantedFeatEntries.map((entry) => projectGrantedFeat(entry.source, ruleset, entry.advancementId)));
      const grantedFeat = grantedFeats[0];
      const featureRecords = granted.map((entry) => { const source = sourceRecords.get(entry.source.sourcePath); const system = source && isRecord(source.system) ? source.system : undefined; const description = system && isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value) : undefined; const activitySummary = system ? readFoundryActivities(system) : { activities: [], diagnostics: [] }; const uses = system ? readFoundryUsesDiagnostic(system) : { uses: undefined, diagnostics: [] }; return { ...entry, ...(description ? { description } : {}), ...(activitySummary.activities.length > 0 ? { activities: activitySummary.activities } : {}), ...(activitySummary.diagnostics.length > 0 || uses.diagnostics.length > 0 ? { activityDiagnostics: [...activitySummary.diagnostics, ...uses.diagnostics] } : {}), ...(uses.uses ? { uses: uses.uses } : {}) }; });
      const ability = advancements.find((entry) => entry.type === 'AbilityScoreImprovement');
      const abilityConfig = ability && isRecord(ability.raw.configuration) ? ability.raw.configuration : undefined;
      const equipment = isRecord(system.startingEquipment) ? [] : Array.isArray(system.startingEquipment) ? system.startingEquipment.filter(isRecord).map((entry) => ({ type: typeof entry.type === 'string' ? entry.type : 'unknown', ...(typeof entry.key === 'string' ? { key: entry.key } : {}), ...(typeof entry.count === 'number' ? { count: entry.count } : {}), ...(typeof entry.group === 'string' ? { group: entry.group } : {}) })) : [];
      const rawDescription = isRecord(system.description) && typeof system.description.value === 'string' ? system.description.value : undefined;
      const description = rawDescription === undefined ? undefined : toPlainText(ruleset === '2014' ? rawDescription.split(/<hr\s*\/?>/i, 1)[0] : rawDescription);
      const startingEquipment = Array.isArray(system.startingEquipment) ? await projectStartingEquipment(system.startingEquipment, ruleset === '2024' && typeof system.wealth === 'string' ? system.wealth : undefined) : undefined;
      const featReference = ruleset === '2014' ? granted[0]?.source : grantedFeatEntries[0]?.source;
      return { source: record.reference, ruleset, ...(description ? { description } : {}), ...(abilityConfig ? { abilityScores: { ...(ability ? { advancementId: ability.id } : {}), ...(typeof abilityConfig.points === 'number' ? { points: abilityConfig.points } : {}), ...(Array.isArray(abilityConfig.locked) ? { locked: stringValues(abilityConfig.locked) } : {}), ...(isRecord(abilityConfig.fixed) ? { fixed: abilityConfig.fixed as Record<string, number> } : {}), ...(typeof abilityConfig.cap === 'number' ? { cap: abilityConfig.cap } : {}), } } : {}), skills, languages, languageChoices, tools, grantedFeats, ...(featReference ? { feat: featReference, ...(grantedFeat === undefined ? {} : { grantedFeat }) } : {}), features: ruleset === '2014' ? featureRecords : [], equipment, ...(typeof system.wealth === 'string' ? { wealth: system.wealth } : {}), ...(startingEquipment === undefined ? {} : { startingEquipment }) };
    },
    async getWeaponMasteryDescriptions() {
      masteryDescriptionsPromise ??= (async () => {
        const sourcePath = 'packs/_source/content24/appendices/appendix-d-rule-references.yml';
        const raw = await catalog.getRawRecord(sourcePath);
        if (!raw || !Array.isArray(raw.pages)) throw new Error(`Weapon Mastery rules are unavailable in the pinned source: ${sourcePath}`);
        const expected = ['cleave', 'graze', 'nick', 'push', 'sap', 'slow', 'topple', 'vex'];
        const descriptions = new Map<string, string>();
        for (const page of raw.pages) {
          if (!isRecord(page) || typeof page.name !== 'string' || !isRecord(page.text) || typeof page.text.content !== 'string') continue;
          const name = page.name.toLocaleLowerCase();
          if (!expected.includes(name)) continue;
          const description = toPlainText(page.text.content);
          if (description.length > 0) descriptions.set(name, description);
        }
        const missing = expected.filter((name) => !descriptions.has(name));
        if (missing.length > 0) throw new Error(`Weapon Mastery rules are missing from the pinned source: ${missing.join(', ')}`);
        return descriptions;
      })();
      return masteryDescriptionsPromise;
    },
    async getWeaponPropertyDescriptions(ruleset) {
      const existing = propertyDescriptionsPromises.get(ruleset);
      if (existing !== undefined) return existing;
      const promise = (async () => {
        const sourcePath = ruleset === '2024' ? 'packs/_source/content24/chapter-6/equipment.yml' : 'packs/_source/rules/chapter-5-equipment.yml';
        const raw = await catalog.getRawRecord(sourcePath);
        const page = Array.isArray(raw?.pages) ? raw.pages.find((candidate) => isRecord(candidate) && candidate.name === (ruleset === '2024' ? 'Properties' : 'Weapons')) : undefined;
        if (!isRecord(page) || !isRecord(page.text) || typeof page.text.content !== 'string') throw new Error(`Weapon properties are unavailable in the pinned source: ${sourcePath}`);
        const names: Readonly<Record<string, string>> = { Ammunition: 'amm', Finesse: 'fin', Heavy: 'hvy', Light: 'lgt', Loading: 'lod', Reach: 'rch', Special: 'spc', Thrown: 'thr', 'Two-Handed': 'two', Versatile: 'ver' };
        const descriptions = new Map<string, string>();
        const entries = ruleset === '2024'
          ? page.text.content.matchAll(/<h3>([^<]+)<\/h3>([\s\S]*?)(?=<h3>|$)/g)
          : page.text.content.matchAll(/<p><strong>([A-Za-z-]+)\.\s*<\/strong>([\s\S]*?)(?=<p><strong>[A-Za-z-]+\.|<h3>|$)/g);
        for (const match of entries) {
          const code = names[match[1]!];
          if (code === undefined) continue;
          const description = toPlainText(match[2]!);
          if (description.length > 0) descriptions.set(code, description);
        }
        const expected = Object.entries(names).filter(([name]) => ruleset === '2014' || name !== 'Special').map(([, code]) => code);
        const missing = expected.filter((code) => !descriptions.has(code));
        if (missing.length > 0) throw new Error(`Weapon property rules are missing from the pinned source: ${missing.join(', ')}`);
        return descriptions;
      })();
      propertyDescriptionsPromises.set(ruleset, promise);
      return promise;
    },
    async getItemSummary(ruleset, sourcePath) { return catalog.getItemSummary(ruleset, sourcePath); },
    async searchItems(query, filters) { return catalog.searchItems(query, filters); },
    async resolveSelector(selector, ruleset) { return catalog.resolveSelector(selector, ruleset); },
  };

  async function getSubclassDependencies(ruleset: CharacterRuleset, classIdentifier: string): Promise<ResolvedSourceDependency[]> {
    const subclasses = await catalog.listPack('subclasses');
    return subclasses.filter((record) => {
      const system = isRecord(record.raw.system) ? record.raw.system : {};
      return isRecord(system.source) && String(system.source.rules) === ruleset && system.classIdentifier === classIdentifier;
    }).map((record) => {
      const raw = catalog.getRaw(record.sourcePath);
      const system = raw && isRecord(raw.system) ? raw.system : undefined;
      const description = system && isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value, system) : undefined;
      return { uuid: `Compendium.${record.pack}.Item.${record.id}`, source: record, ...(description === undefined ? {} : { description }) };
    });
  }
}

function extractSpeciesScales(advancements: SpeciesAdvancementSummary[]): SpeciesScaleValueSummary[] {
  return advancements.filter((entry) => entry.type === 'ScaleValue').map((entry) => {
    const configuration = isRecord(entry.raw.configuration) ? entry.raw.configuration : {};
    const scale = isRecord(configuration.scale) ? configuration.scale : {};
    const values = new Map<number, FoundryScaleValue>();
    const diagnostics: string[] = [];
    const distance = isRecord(configuration.distance) ? configuration.distance : {};
    for (const [key, raw] of Object.entries(scale)) {
      if (!/^\d+$/.test(key)) continue;
      const parsed = readFoundryScaleValue(configuration.type, raw, distance.units);
      if (parsed) values.set(Number(key), parsed);
      else diagnostics.push(`Invalid ${String(configuration.type)} scale value at advancement ${entry.id}, level ${key}.`);
    }
    const explicitIdentifier = typeof configuration.identifier === 'string' ? configuration.identifier.trim() : '';
    const title = typeof entry.raw.title === 'string' ? entry.raw.title : entry.type;
    const identifier = explicitIdentifier || formatFoundryIdentifier(title);
    if (!identifier) diagnostics.push(`Scale advancement ${entry.id} has no usable identifier or title.`);
    const levelOneValue = values.get(1) ?? values.get(0);
    const value = levelOneValue?.type === 'number' ? levelOneValue.value : undefined;
    return { advancementId: entry.id, title, ...(identifier ? { identifier } : {}), level: entry.level, ...(value === undefined ? {} : { value }), values, diagnostics };
  });
}

type SpellAdvancementMetadata = {
  valid: true;
  spellLevel: number;
  spellLists: string[];
  abilityOptions: string[];
} | { valid: false };

function readSpellAdvancementMetadata(configuration: Record<string, unknown>): SpellAdvancementMetadata | undefined {
  if (configuration.type !== 'spell') return undefined;
  const restriction = isRecord(configuration.restriction) ? configuration.restriction : undefined;
  const rawLevel = restriction?.level;
  const spellLevel = typeof rawLevel === 'number' ? rawLevel : typeof rawLevel === 'string' && /^\d+$/.test(rawLevel) ? Number(rawLevel) : undefined;
  const rawLists = stringValues(restriction?.list);
  const spellLists = rawLists.flatMap((value) => value.startsWith('class:') && value.length > 6 ? [value.slice(6).toLocaleLowerCase()] : []);
  const spell = isRecord(configuration.spell) ? configuration.spell : undefined;
  const rawAbilities = stringValues(spell?.ability);
  const abilityOptions = rawAbilities.flatMap((ability) => SPELLCASTING_ABILITY_LABELS[ability] === undefined ? [] : [SPELLCASTING_ABILITY_LABELS[ability]]);
  if (spellLevel === undefined || !Number.isInteger(spellLevel) || spellLevel < 0 || spellLevel > 9 || rawLists.length === 0 || spellLists.length !== rawLists.length || abilityOptions.length !== rawAbilities.length) return { valid: false };
  return { valid: true, spellLevel, spellLists: [...new Set(spellLists)], abilityOptions: [...new Set(abilityOptions)] };
}

type ClassSpellAdvancementMetadata = { valid: true; spellLevel?: number; spellLists: string[]; abilityOptions: string[] } | { valid: false };

function readClassSpellAdvancementMetadata(configuration: Record<string, unknown>, classSystem: Record<string, unknown>): ClassSpellAdvancementMetadata | undefined {
  if (configuration.type !== 'spell') return undefined;
  const restriction = isRecord(configuration.restriction) ? configuration.restriction : {};
  const rawLevel = restriction.level;
  const spellLevel = typeof rawLevel === 'number' ? rawLevel : typeof rawLevel === 'string' && /^\d+$/.test(rawLevel) ? Number(rawLevel) : undefined;
  const rawLists = stringValues(restriction.list);
  const restrictedLists = rawLists.flatMap((value) => /^class:[^:]+$/i.test(value) ? [value.slice('class:'.length).toLocaleLowerCase()] : []);
  const spell = isRecord(configuration.spell) ? configuration.spell : {};
  const rawAbilities = stringValues(spell.ability);
  const spellcasting = isRecord(classSystem.spellcasting) ? classSystem.spellcasting : {};
  const classAbility = typeof spellcasting.ability === 'string' ? [spellcasting.ability] : [];
  const abilityOptions = [...new Set((rawAbilities.length > 0 ? rawAbilities : classAbility).flatMap((ability) => SPELLCASTING_ABILITY_LABELS[ability] === undefined ? [] : [SPELLCASTING_ABILITY_LABELS[ability]]))];
  const spellLists = [...new Set(restrictedLists)];
  if ((spellLevel !== undefined && (!Number.isInteger(spellLevel) || spellLevel < 0 || spellLevel > 9)) || rawLists.length !== restrictedLists.length || rawAbilities.some((ability) => SPELLCASTING_ABILITY_LABELS[ability] === undefined)) return { valid: false };
  return { valid: true, ...(spellLevel === undefined ? {} : { spellLevel }), spellLists, abilityOptions };
}

function spellPoolValues(configuration: Record<string, unknown>): string[] {
  const choices = Array.isArray(configuration.choices)
    ? configuration.choices
    : isRecord(configuration.choices) ? Object.values(configuration.choices) : [];
  return [
    ...stringValues(configuration.pool),
    ...choices.flatMap((choice) => isRecord(choice) ? stringValues(choice.pool) : []),
  ];
}

function sourceReferenceKey(source: FoundrySourceReference): string {
  return `${source.sourcePath}:${source.pack}:${source.type}:${source.id}`;
}

const SPELLCASTING_ABILITY_LABELS: Readonly<Record<string, string>> = {
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
};

function extractDamageTypes(system: Record<string, unknown>): string[] {
  if (!isRecord(system.activities)) return [];
  const types = Object.values(system.activities).flatMap((activity) => {
    if (!isRecord(activity) || !isRecord(activity.damage) || !Array.isArray(activity.damage.parts)) return [];
    return activity.damage.parts.flatMap((part) => isRecord(part) && Array.isArray(part.types) ? part.types.filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : []);
  });
  return [...new Set(types)];
}

interface SpeciesEffectProjections {
  rollAnnotations: SpeciesRollAnnotationSummary[];
  savingThrowNotes: SpeciesSavingThrowNoteSummary[];
  hitPointModifiers: SpeciesHitPointModifierSummary[];
  diagnostics: string[];
}

function extractSpeciesEffectProjections(raw: Record<string, unknown>, system: Record<string, unknown>, source: FoundrySourceReference): SpeciesEffectProjections {
  const rollAnnotations: SpeciesRollAnnotationSummary[] = [];
  const savingThrowNotes: SpeciesSavingThrowNoteSummary[] = [];
  const hitPointModifiers: SpeciesHitPointModifierSummary[] = [];
  const diagnostics: string[] = [];
  const identifier = typeof system.identifier === 'string' ? system.identifier : undefined;
  const isDwarvenToughness = identifier === 'dwarven-toughness';
  let supportedHitPointChanges = 0;
  let malformedHitPointChange = false;
  const effects = Array.isArray(raw.effects) ? raw.effects : [];
  for (const effect of effects) {
    if (!isRecord(effect) || effect.disabled === true || effect.transfer === false) continue;
    const effectSystem = isRecord(effect.system) ? effect.system : undefined;
    const changes = effectSystem && Array.isArray(effectSystem.changes) ? effectSystem.changes : [];
    for (const change of changes) {
      if (!isRecord(change) || typeof change.key !== 'string') continue;
      if (change.key === 'system.attributes.hp.bonuses.level' && isDwarvenToughness) {
        if (effect.disabled !== true && effect.transfer === true && change.value === 1 && change.type === 'add') supportedHitPointChanges += 1;
        else malformedHitPointChange = true;
        continue;
      }
      const match = /^system\.abilities\.(str|dex|con|int|wis|cha)\.save\.roll\.mode$/i.exec(change.key);
      if (match && (change.value === 1 || change.value === '1')) {
        rollAnnotations.push({ target: 'saving-throw', ability: match[1]!.toLowerCase(), mode: 'advantage', source });
      } else if (match && (change.value === -1 || change.value === '-1')) {
        rollAnnotations.push({ target: 'saving-throw', ability: match[1]!.toLowerCase(), mode: 'disadvantage', source });
      } else if (match) {
        diagnostics.push(`Unsupported stable effect change from ${source.name}: ${change.key}.`);
      } else if (change.key.startsWith('system.')) {
        diagnostics.push(`Unsupported stable effect change from ${source.name}: ${change.key}.`);
      }
    }
  }
  if (isDwarvenToughness) {
    if (supportedHitPointChanges === 1 && !malformedHitPointChange) {
      if (!hitPointModifiers.some((modifier) => modifier.source.sourcePath === source.sourcePath)) hitPointModifiers.push({ perLevel: 1, source });
    } else {
      diagnostics.push(`Malformed supported HP effect from ${source.name}: system.attributes.hp.bonuses.level.`);
    }
  }
  const description = isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value, system) : '';
  if (/advantage on saving throws you make to avoid or end the Poisoned condition/i.test(description)) {
    savingThrowNotes.push({ text: 'Advantage on saving throws to avoid or end the Poisoned condition.', source });
  }
  return { rollAnnotations, savingThrowNotes, hitPointModifiers, diagnostics: [...new Set(diagnostics)] };
}

function grantedCantripMetadata(raw: Record<string, unknown>): { spellList: string; hint: string } | undefined {
  const system = isRecord(raw.system) ? raw.system : undefined;
  const description = system && isRecord(system.description) && typeof system.description.value === 'string' ? system.description.value : undefined;
  if (description === undefined || !/@UUID\[[^\]]+#cantrip\]/i.test(description)) return undefined;
  const match = description.match(/\{([A-Za-z]+)\s+spell list\}/i);
  if (match === null || match[1] === undefined) return undefined;
  const spellList = match[1].toLocaleLowerCase();
  return { spellList, hint: `Choose one cantrip from the ${match[1]} spell list.` };
}

function extractClassProficiencies(advancements: ClassAdvancementSummary[]): ClassProficiencies {
  const result: ClassProficiencies = { armor: [], weapons: [], tools: [], savingThrows: [], languages: [], skills: [], choices: [] };
  for (const advancement of advancements.filter((entry) => entry.type === 'Trait')) {
    const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : {};
    for (const grant of stringValues(configuration.grants)) {
      const [category] = grant.split(':', 1);
      const target = { armor: result.armor, weapon: result.weapons, tool: result.tools, saves: result.savingThrows, languages: result.languages, skills: result.skills }[category as 'armor' | 'weapon' | 'tool' | 'saves' | 'languages' | 'skills'];
      if (target) target.push(grant);
    }
    const choices = Array.isArray(configuration.choices) ? configuration.choices : [];
    for (const choice of choices) {
      if (!isRecord(choice) || typeof choice.count !== 'number' || !Array.isArray(choice.pool)) continue;
      const pool = stringValues(choice.pool);
      const category = pool.map((value) => value.split(':', 1)[0]).find((value) => value.length > 0) ?? 'unknown';
      result.choices.push({ advancementId: advancement.id, count: choice.count, category, pool });
    }
  }
  return result;
}

function extractClassFeatures(advancements: ClassAdvancementSummary[], records: Map<string, Record<string, unknown>>): ClassFeatureSummary[] {
  return advancements.filter((entry) => entry.type === 'ItemGrant').flatMap((entry) => entry.dependencies.flatMap((dependency) => {
    if (!dependency.source || dependency.source.type !== 'feat') return [];
    const record = records.get(dependency.source.sourcePath);
    const system = record && isRecord(record.system) ? record.system : {};
    const description = isRecord(system.description) && typeof system.description.value === 'string' ? toPlainText(system.description.value, system) : undefined;
    const activitySummary = readFoundryActivities(system); const uses = readFoundryUsesDiagnostic(system);
    return [{ advancementId: entry.id, level: entry.level, source: dependency.source, ...(entry.requiresChoice === undefined ? {} : { requiresChoice: { ...entry.requiresChoice } }), ...(entry.classRestriction === undefined ? {} : { classRestriction: entry.classRestriction }), ...(description ? { description } : {}), ...(activitySummary.activities.length > 0 ? { activities: activitySummary.activities } : {}), ...(activitySummary.diagnostics.length > 0 || uses.diagnostics.length > 0 ? { activityDiagnostics: [...activitySummary.diagnostics, ...uses.diagnostics] } : {}), ...(uses.uses ? { uses: uses.uses } : {}), ...(record && Array.isArray(record.effects) ? { activeEffects: record.effects.filter(isRecord) } : {}) }];
  }));
}

function extractClassScales(advancements: ClassAdvancementSummary[]): ClassScaleValueSummary[] {
  return advancements.filter((entry) => entry.type === 'ScaleValue').map((entry) => {
    const configuration = isRecord(entry.raw.configuration) ? entry.raw.configuration : {};
    const scale = isRecord(configuration.scale) ? configuration.scale : {};
    const values = new Map<number, FoundryScaleValue>();
    const diagnostics: string[] = [];
    const distance = isRecord(configuration.distance) ? configuration.distance : {};
    for (const [key, raw] of Object.entries(scale)) {
      if (!/^\d+$/.test(key)) continue;
      const parsed = readFoundryScaleValue(configuration.type, raw, distance.units);
      if (parsed) values.set(Number(key), parsed);
      else diagnostics.push(`Invalid ${String(configuration.type)} scale value at advancement ${entry.id}, level ${key}.`);
    }
    const explicitIdentifier = typeof configuration.identifier === 'string' ? configuration.identifier.trim() : '';
    const identifier = explicitIdentifier || formatFoundryIdentifier(entry.title);
    if (!identifier) diagnostics.push(`Scale advancement ${entry.id} has no usable identifier or title.`);
    const levelOneValue = values.get(1);
    const value = levelOneValue?.type === 'number' ? levelOneValue.value : undefined;
    return { advancementId: entry.id, title: entry.title, ...(identifier === undefined ? {} : { identifier }), level: entry.level, ...(entry.requiresChoice === undefined ? {} : { requiresChoice: { ...entry.requiresChoice } }), ...(entry.classRestriction === undefined ? {} : { classRestriction: entry.classRestriction }), ...(value === undefined ? {} : { value }), values, diagnostics };
  });
}

function hasConfiguredChoice(configuration: Record<string, unknown>): boolean {
  const choices = configuration.choices;
  if (Array.isArray(choices)) return choices.length > 0;
  if (isRecord(choices)) return Object.keys(choices).length > 0;
  if (typeof choices === 'number') return choices > 0;

  const pool = configuration.pool;
  if (Array.isArray(pool)) return pool.length > 0;
  if (isRecord(pool)) return Object.keys(pool).length > 0;

  const choice = configuration.choice;
  if (Array.isArray(choice)) return choice.length > 0;
  if (isRecord(choice)) return Object.keys(choice).length > 0;
  return choice !== undefined && choice !== null;
}

function classAdvancementRequiresSelection(type: string, configuration: Record<string, unknown>): boolean {
  return type === 'ItemChoice' || type === 'Subclass' || type === 'AbilityScoreImprovement' && hasConfiguredChoice(configuration);
}

function toPlainText(value: string, system?: Record<string, unknown>): string {
  const resolved = system === undefined ? value : resolveDescriptionLookups(value, system);
  return normalizeFoundryDescription(resolved);
}

function resolveDescriptionLookups(value: string, system: Record<string, unknown>): string {
  const activities = isRecord(system.activities) ? system.activities : {};
  return value.replace(/\[\[lookup\s+@labels\.description\.(affects|template)\s+activity=([A-Za-z0-9_-]+)\]\]/g, (match, kind: string, activityId: string) => {
    const activity = isRecord(activities[activityId]) ? activities[activityId] : undefined;
    const target = activity && isRecord(activity.target) ? activity.target : undefined;
    if (target === undefined) return match;
    if (kind === 'affects') return formatAffectedTargets(target);
    return formatAreaTemplate(target);
  });
}

function formatAffectedTargets(target: Record<string, unknown>): string {
  const affects = isRecord(target.affects) ? target.affects : {};
  const type = typeof affects.type === 'string' ? affects.type : 'target';
  const labels: Record<string, string> = { creature: 'creature', creatureOrObject: 'creature or object', enemy: 'enemy', ally: 'ally', object: 'object', space: 'space', willing: 'willing creature' };
  const noun = labels[type] ?? type;
  const count = typeof affects.count === 'number' && affects.count > 0 ? affects.count : undefined;
  return count === undefined ? `each ${noun}` : `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatAreaTemplate(target: Record<string, unknown>): string {
  const template = isRecord(target.template) ? target.template : {};
  const type = typeof template.type === 'string' ? template.type : undefined;
  const units = typeof template.units === 'string' && template.units.length > 0 ? template.units : 'ft';
  const size = formatTemplateDimension(template.size, units, 'long');
  const width = formatTemplateDimension(template.width, units, 'wide');
  if (type === 'line' || type === 'ray') {
    const dimensions = [width, size].filter((value): value is string => value !== undefined).join(', ');
    return `${dimensions}${dimensions.length > 0 ? ' ' : ''}line`;
  }
  if (type === 'cone') return `${size ?? 'variable'} cone`;
  return size === undefined ? (type ?? 'area') : `${size} ${type ?? 'area'}`;
}

function formatTemplateDimension(value: unknown, units: string, descriptor: string): string | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const normalized = String(value).trim();
  const longUnit = { ft: 'foot', m: 'meter', mi: 'mile', km: 'kilometer' }[units] ?? units;
  return normalized.length === 0 ? undefined : `${normalized}-${longUnit}-${descriptor}`;
}

function isReference(value: unknown): value is FoundrySourceReference {
  return isRecord(value) && typeof value.sourcePath === 'string' && typeof value.pack === 'string' && typeof value.type === 'string' && typeof value.id === 'string' && typeof value.name === 'string' && (value.identifier === undefined || typeof value.identifier === 'string');
}

function isValidCachedEntry(uuid: string, value: unknown): value is FoundrySourceReference {
  const parsed = parseUuid(uuid);
  return parsed !== null && isReference(value) && value.pack === `dnd5e.${parsed.pack}` && value.id === parsed.id && isSafeSourcePath(value.sourcePath, parsed.pack);
}

function parseUuid(uuid: string): { pack: string; id: string } | null {
  const parts = uuid.split('.');
  if ((parts.length !== 4 && parts.length !== 5) || parts[0] !== 'Compendium' || parts[1] !== 'dnd5e') return null;
  const pack = parts[2];
  const id = parts.length === 5 ? parts[4] : parts[3];
  if (!/^[A-Za-z0-9_-]+$/.test(pack) || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  if (parts.length === 5 && parts[3] !== 'Item') return null;
  return { pack, id };
}

function isSafeSourcePath(sourcePath: string, pack: string): boolean {
  const parts = sourcePath.split('/');
  return parts.length >= 4 && parts[0] === 'packs' && parts[1] === '_source' && parts[2] === pack && parts.every((part) => part.length > 0 && part !== '..' && part !== '.') && !sourcePath.includes('\\');
}

function sameSnapshot(left: unknown, right: SourceSnapshot): boolean {
  return isRecord(left) && left.owner === right.owner && left.repo === right.repo && left.branch === right.branch && left.commit === right.commit && left.systemVersion === right.systemVersion;
}
