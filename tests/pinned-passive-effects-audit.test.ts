import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { classifyPassiveEffectChange, interpretPassiveEffects } from '../src/passive-effects';

const sourceRoot = path.resolve('external/foundryvtt/dnd5e/packs/_source');

interface SourceDocument { _id?: string; type?: string; name?: string; system?: Record<string, unknown>; effects?: unknown; }
interface EffectAuditEntry { sourcePath: string; name: string; key: string; operation: string; value: unknown; classification: string; }

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : filename.endsWith('.yml') ? [filename] : [];
  });
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function entries(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter(record) : record(value) ? Object.values(value).filter(record) : []; }
function advancementRecords(document: SourceDocument): Record<string, unknown>[] {
  const system = document.system ?? {};
  return entries(system.advancement);
}

function advancementLevel(advancement: Record<string, unknown>): number | undefined {
  if (typeof advancement.level === 'number') return advancement.level;
  const configuration = record(advancement.configuration) ? advancement.configuration : {};
  const choiceLevels = record(configuration.choices) ? Object.keys(configuration.choices).map(Number).filter(Number.isFinite) : [];
  return choiceLevels.length > 0 ? Math.min(...choiceLevels) : undefined;
}

function sourceEffectsAtLevel(level: number): EffectAuditEntry[] {
  const candidateDirectories = ['classes24', 'origins24', 'feats24'];
  const byId = new Map<string, { filename: string; document: SourceDocument }>();
  for (const directory of candidateDirectories) for (const filename of sourceFiles(path.join(sourceRoot, directory))) {
    const document = parse(fs.readFileSync(filename, 'utf8')) as SourceDocument;
    if (typeof document._id === 'string') byId.set(document._id, { filename, document });
  }
  const eligible = new Map<string, { filename: string; document: SourceDocument }>();
  const resolveRefs = (parent: SourceDocument, level: number): void => {
    for (const advancement of advancementRecords(parent)) {
      const grantLevel = advancementLevel(advancement);
      if (grantLevel === undefined || grantLevel > level) continue;
      const configuration = record(advancement.configuration) ? advancement.configuration : {};
      const references = [
        ...entries(configuration.items).map((item) => item.uuid),
        ...entries(configuration.pool).map((item) => item.uuid),
      ].filter((uuid): uuid is string => typeof uuid === 'string');
      for (const uuid of references) {
        const id = /(?:\.Item\.)?([^.]+)$/.exec(uuid)?.[1];
        const target = id === undefined ? undefined : byId.get(id);
        if (target === undefined || eligible.has(id!)) continue;
        const prerequisiteLevel = record(target.document.system?.prerequisites)
          ? target.document.system.prerequisites.level
          : undefined;
        if (typeof prerequisiteLevel === 'number' && prerequisiteLevel > level) continue;
        eligible.set(id!, target);
        resolveRefs(target.document, level);
      }
    }
  };

  for (const directory of ['classes24', 'origins24/species', 'origins24/backgrounds']) {
    const root = path.join(sourceRoot, directory);
    for (const filename of sourceFiles(root)) {
      if (directory === 'classes24' && !new RegExp(`^${directory}/[^/]+/[^/]+\\.yml$`).test(path.relative(sourceRoot, filename).replaceAll(path.sep, '/'))) continue;
      if (directory === 'origins24/species' && path.dirname(filename) !== root) continue;
      if (directory === 'origins24/backgrounds' && path.dirname(filename) !== root) continue;
      const document = parse(fs.readFileSync(filename, 'utf8')) as SourceDocument;
      if (directory === 'classes24' && document.type !== 'class' || directory === 'origins24/species' && document.type !== 'race' || directory === 'origins24/backgrounds' && document.type !== 'background') continue;
      resolveRefs(document, level);
    }
  }
  for (const filename of sourceFiles(path.join(sourceRoot, 'classes24'))) {
    const relativePath = path.relative(sourceRoot, filename).replaceAll(path.sep, '/');
    if (!/^classes24\/[^/]+\/[^/]+\.yml$/.test(relativePath)) continue;
    const document = parse(fs.readFileSync(filename, 'utf8')) as SourceDocument;
    if (document.type === 'subclass') resolveRefs(document, level);
  }

  const audit: EffectAuditEntry[] = [];
  for (const { filename, document } of eligible.values()) {
    if (!Array.isArray(document.effects)) continue;
    for (const effect of document.effects) {
      if (!record(effect)) throw new Error(`Malformed effect record in ${filename}`);
      if (typeof effect.disabled !== 'boolean' || typeof effect.transfer !== 'boolean') throw new Error(`Malformed transfer state in ${filename}`);
      if (effect.disabled || !effect.transfer) continue;
      const effectSystem = record(effect.system) ? effect.system : undefined;
      if (effectSystem === undefined || !Array.isArray(effectSystem.changes)) throw new Error(`Malformed transferable changes in ${filename}`);
      for (const change of effectSystem.changes) {
        if (!record(change) || typeof change.key !== 'string' || typeof change.type !== 'string' || !('value' in change)) throw new Error(`Malformed transferable change in ${filename}`);
        const sourcePath = path.relative(sourceRoot, filename).replaceAll(path.sep, '/');
        const source = { sourcePath: `packs/_source/${sourcePath}`, pack: `dnd5e.${sourcePath.split('/')[0]}`, type: document.type ?? '', id: document._id ?? '', name: document.name ?? '' };
        audit.push({
          sourcePath,
          name: document.name ?? '',
          key: change.key,
          operation: change.type,
          value: change.value,
          classification: classifyPassiveEffectChange(source, '2024', change.key, change.type, change.value),
        });
      }
    }
  }
  return audit.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function runtimeDiagnosticInventory(level: number): string[] {
  const paths = [
    ...new Set(sourceEffectsAtLevel(level).map((entry) => entry.sourcePath)),
  ].map((relativePath) => ({ relativePath, ruleset: '2024' as const }));
  const legacyPaths = [...new Set(sourceEffects2014AtLevel(level).map((entry) => entry.sourcePath))]
    .map((relativePath) => ({ relativePath, ruleset: '2014' as const }));
  return [...paths, ...legacyPaths].flatMap(({ relativePath, ruleset }) => {
    const document = parse(fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')) as SourceDocument;
    const source = { sourcePath: `packs/_source/${relativePath}`, pack: `dnd5e.${relativePath.split('/')[0]}`, type: document.type ?? '', id: document._id ?? '', name: document.name ?? '' };
    const result = interpretPassiveEffects([{ source, effects: Array.isArray(document.effects) ? document.effects : [] }], ruleset);
    return result.diagnostics.map((diagnostic) => `${relativePath}: ${diagnostic.key ?? 'malformed'}`);
  }).sort();
}

function sourceEffects2014AtLevel(level: number): EffectAuditEntry[] {
  const featureDirectories = ['classfeatures', 'subclasses'];
  const byId = new Map<string, { filename: string; document: SourceDocument }>();
  for (const directory of featureDirectories) for (const filename of sourceFiles(path.join(sourceRoot, directory))) {
    const document = parse(fs.readFileSync(filename, 'utf8')) as SourceDocument;
    if (typeof document._id === 'string') byId.set(document._id, { filename, document });
  }
  const eligible = new Map<string, { filename: string; document: SourceDocument }>();
  const resolveRefs = (parent: SourceDocument): void => {
    for (const advancement of advancementRecords(parent)) {
      const grantLevel = advancementLevel(advancement);
      if (grantLevel === undefined || grantLevel > level) continue;
      const configuration = record(advancement.configuration) ? advancement.configuration : {};
      const references = [
        ...entries(configuration.items).map((item) => item.uuid),
        ...entries(configuration.pool).map((item) => item.uuid),
      ].filter((uuid): uuid is string => typeof uuid === 'string');
      for (const uuid of references) {
        const id = /(?:\.Item\.)?([^.]+)$/.exec(uuid)?.[1];
        const target = id === undefined ? undefined : byId.get(id);
        if (target === undefined || eligible.has(id!)) continue;
        const prerequisiteLevel = record(target.document.system?.prerequisites)
          ? target.document.system.prerequisites.level
          : undefined;
        if (typeof prerequisiteLevel === 'number' && prerequisiteLevel > level) continue;
        eligible.set(id!, target);
        resolveRefs(target.document);
      }
    }
  };

  for (const directory of ['classes', 'subclasses']) for (const filename of sourceFiles(path.join(sourceRoot, directory))) {
    const document = parse(fs.readFileSync(filename, 'utf8')) as SourceDocument;
    if (directory === 'classes' && document.type !== 'class' || directory === 'subclasses' && document.type !== 'subclass') continue;
    resolveRefs(document);
  }

  const audit: EffectAuditEntry[] = [];
  for (const { filename, document } of eligible.values()) {
    if (!Array.isArray(document.effects)) continue;
    const sourcePath = path.relative(sourceRoot, filename).replaceAll(path.sep, '/');
    const source = { sourcePath: `packs/_source/${sourcePath}`, pack: 'dnd5e.classfeatures', type: document.type ?? '', id: document._id ?? '', name: document.name ?? '' };
    for (const effect of document.effects) {
      if (!record(effect) || effect.disabled || effect.transfer !== true || !record(effect.system) || !Array.isArray(effect.system.changes)) continue;
      for (const change of effect.system.changes) {
        if (!record(change) || typeof change.key !== 'string' || typeof change.type !== 'string' || !('value' in change)) continue;
        audit.push({ sourcePath, name: document.name ?? '', key: change.key, operation: change.type, value: change.value, classification: classifyPassiveEffectChange(source, '2014', change.key, change.type, change.value) });
      }
    }
  }
  return audit.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe('pinned passive effect audit', () => {
  it('interprets the pinned level-gated stable Sorcerer, Ranger, and Druid effects at runtime', () => {
    const paths = [
      'classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml',
      'classes24/ranger/class-features/feral-senses.yml',
      'classes24/druid/subclass-features/circle-of-land/natures-ward.yml',
      'classfeatures/druid/circle-of-the-land-features/natures-ward.yml',
      'classfeatures/sorcerer/draconic-bloodline-features/draconic-resilience.yml',
    ];
    const actual = paths.map((relativePath) => {
      const document = parse(fs.readFileSync(path.join(sourceRoot, relativePath), 'utf8')) as SourceDocument;
      const source = { sourcePath: `packs/_source/${relativePath}`, pack: `dnd5e.${relativePath.split('/')[0]}`, type: document.type ?? '', id: document._id ?? '', name: document.name ?? '' };
      const result = interpretPassiveEffects([{ source, effects: Array.isArray(document.effects) ? document.effects : [] }], relativePath.startsWith('classes24/') ? '2024' : '2014');
      return { path: relativePath, diagnostics: result.diagnostics.map(({ key }) => key), contributions: result.contributions.map(({ target, operation, value }) => ({ target, operation, value })) };
    });
    expect(actual).toEqual([
      { path: paths[0], diagnostics: [], contributions: expect.arrayContaining([{ target: 'hit-points-per-level', operation: 'add', value: 1 }, { target: 'armor-class-calculation', operation: 'set-calculation', value: 'unarmoredBard' }]) },
      { path: paths[1], diagnostics: [], contributions: [{ target: 'sense-blindsight', operation: 'upgrade', value: 30 }] },
      { path: paths[2], diagnostics: [], contributions: [{ target: 'condition-immunity', operation: 'add', value: 'poison' }] },
      { path: paths[3], diagnostics: [], contributions: [{ target: 'condition-immunity', operation: 'add', value: 'diseased' }, { target: 'condition-immunity', operation: 'add', value: 'poisoned' }] },
      { path: paths[4], diagnostics: [], contributions: [{ target: 'armor-class-calculation', operation: 'set-calculation', value: 'draconic' }] },
    ]);
  });

  it('matches the exact eligible source, key, operation, value, and classification inventory', () => {
    const expected: EffectAuditEntry[] = [
      { sourcePath: 'classes24/barbarian/class-features/unarmored-defense.yml', name: 'Unarmored Defense', key: 'system.attributes.ac.calc', operation: 'override', value: 'unarmoredBarb', classification: 'direct' },
      { sourcePath: 'classes24/cleric/class-features/divine-order-protector.yml', name: 'Divine Order: Protector', key: 'system.traits.armorProf.value', operation: 'add', value: 'hvy', classification: 'direct' },
      { sourcePath: 'classes24/cleric/class-features/divine-order-protector.yml', name: 'Divine Order: Protector', key: 'system.traits.weaponProf.value', operation: 'add', value: 'mar', classification: 'direct' },
      { sourcePath: 'classes24/cleric/class-features/divine-order-thaumaturge.yml', name: 'Divine Order: Thaumaturge', key: 'system.scale.cleric.cantrips-known.value', operation: 'add', value: 1, classification: 'direct' },
      { sourcePath: 'classes24/cleric/class-features/divine-order-thaumaturge.yml', name: 'Divine Order: Thaumaturge', key: 'system.skills.arc.bonuses.check', operation: 'add', value: '(max(1,@abilities.wis.mod))', classification: 'direct' },
      { sourcePath: 'classes24/cleric/class-features/divine-order-thaumaturge.yml', name: 'Divine Order: Thaumaturge', key: 'system.skills.rel.bonuses.check', operation: 'add', value: '(max(1,@abilities.wis.mod))', classification: 'direct' },
      { sourcePath: 'classes24/druid/class-features/primal-order-magician.yml', name: 'Primal Order: Magician', key: 'system.scale.druid.cantrips-known', operation: 'add', value: 1, classification: 'direct' },
      { sourcePath: 'classes24/druid/class-features/primal-order-magician.yml', name: 'Primal Order: Magician', key: 'system.skills.arc.bonuses.check', operation: 'add', value: '(max(1,@abilities.wis.mod))', classification: 'direct' },
      { sourcePath: 'classes24/druid/class-features/primal-order-magician.yml', name: 'Primal Order: Magician', key: 'system.skills.nat.bonuses.check', operation: 'add', value: '(max(1,@abilities.wis.mod))', classification: 'direct' },
      { sourcePath: 'classes24/druid/class-features/primal-order-warden.yml', name: 'Primal Order: Warden', key: 'system.traits.armorProf.value', operation: 'add', value: 'med', classification: 'direct' },
      { sourcePath: 'classes24/druid/class-features/primal-order-warden.yml', name: 'Primal Order: Warden', key: 'system.traits.weaponProf.value', operation: 'add', value: 'mar', classification: 'direct' },
      { sourcePath: 'classes24/monk/class-features/unarmored-defense.yml', name: 'Unarmored Defense', key: 'system.attributes.ac.calc', operation: 'override', value: 'unarmoredMonk', classification: 'direct' },
      { sourcePath: 'classes24/warlock/eldritch-invocation-options/eldritch-mind.yml', name: 'Eldritch Mind', key: 'system.attributes.concentration.roll.mode', operation: 'add', value: 1, classification: 'descriptive' },
      { sourcePath: 'feats24/fighting-style-feats/archery.yml', name: 'Archery', key: 'system.bonuses.rwak.attack', operation: 'add', value: 2, classification: 'direct' },
      { sourcePath: 'feats24/fighting-style-feats/defense.yml', name: 'Defense', key: 'system.attributes.ac.bonus', operation: 'add', value: 1, classification: 'descriptive' },
      { sourcePath: 'feats24/origin-feats/alert.yml', name: 'Alert', key: 'flags.dnd5e.initiativeAlert', operation: 'add', value: true, classification: 'direct' },
      { sourcePath: 'origins24/species/traits/dwarf/dwarven-toughness.yml', name: 'Dwarven Toughness', key: 'system.attributes.hp.bonuses.level', operation: 'add', value: 1, classification: 'direct' },
      { sourcePath: 'origins24/species/traits/gnome/gnomish-cunning.yml', name: 'Gnomish Cunning', key: 'system.abilities.cha.save.roll.mode', operation: 'add', value: 1, classification: 'descriptive' },
      { sourcePath: 'origins24/species/traits/gnome/gnomish-cunning.yml', name: 'Gnomish Cunning', key: 'system.abilities.int.save.roll.mode', operation: 'add', value: 1, classification: 'descriptive' },
      { sourcePath: 'origins24/species/traits/gnome/gnomish-cunning.yml', name: 'Gnomish Cunning', key: 'system.abilities.wis.save.roll.mode', operation: 'add', value: 1, classification: 'descriptive' },
      { sourcePath: 'origins24/species/traits/goliath/powerful-build.yml', name: 'Powerful Build', key: 'flags.dnd5e.powerfulBuild', operation: 'override', value: true, classification: 'descriptive' },
      { sourcePath: 'origins24/species/traits/halfling/halfling-nimbleness.yml', name: 'Halfling Nimbleness', key: 'flags.dnd5e.halflingNimbleness', operation: 'override', value: true, classification: 'descriptive' },
      { sourcePath: 'origins24/species/traits/halfling/luck.yml', name: 'Luck', key: 'flags.dnd5e.halflingLucky', operation: 'override', value: true, classification: 'descriptive' },
    ];
    expect(sourceEffectsAtLevel(1)).toEqual(expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  });

  it('keeps an all-level runtime diagnostic inventory for reachable 2014 and 2024 class and subclass effects', () => {
    expect(sourceEffectsAtLevel(20).map(({ sourcePath }) => sourcePath)).toContain('classes24/fighter/subclass-features/champion/remarkable-athlete.yml');
    expect(sourceEffects2014AtLevel(20).map(({ sourcePath }) => sourcePath)).toContain('classfeatures/druid/circle-of-the-land-features/natures-ward.yml');
    expect(runtimeDiagnosticInventory(20)).toEqual([]);
  }, 30000);

  it('classifies all pinned level-gated movement effects without hiding changed variants', () => {
    const expected = [
      { path: 'classes24/rogue/subclass-features/thief/second-story-work.yml', name: 'Second-Story Work', changes: [{ key: 'system.attributes.movement.climb', operation: 'upgrade', value: '@attributes.movement.speed', classification: 'direct' }] },
      { path: 'classes24/ranger/class-features/roving.yml', name: 'Roving', changes: [
        { key: 'system.attributes.movement.walk', operation: 'add', value: 10, classification: 'descriptive' },
        { key: 'system.attributes.movement.climb', operation: 'upgrade', value: '@attributes.movement.walk', classification: 'descriptive' },
        { key: 'system.attributes.movement.swim', operation: 'upgrade', value: '@attributes.movement.walk', classification: 'descriptive' },
      ] },
      { path: 'classes24/barbarian/class-features/fast-movement.yml', name: 'Fast Movement', changes: [{ key: 'system.attributes.movement.walk', operation: 'add', value: 10, classification: 'descriptive' }] },
      { path: 'classes24/monk/class-features/unarmored-movement.yml', name: 'Unarmored Movement', changes: [{ key: 'system.attributes.movement.walk', operation: 'add', value: '@scale.monk.unarmored-movement', classification: 'descriptive' }] },
      { path: 'classfeatures/barbarian/barbarian-features/fast-movement.yml', name: 'Fast Movement', changes: [{ key: 'system.attributes.movement.walk', operation: 'add', value: 10, classification: 'descriptive' }] },
      { path: 'classfeatures/monk/monk-features/unarmored-movement.yml', name: 'Unarmored Movement', changes: [{ key: 'system.attributes.movement.walk', operation: 'add', value: '@scale.monk.unarmored-movement', classification: 'descriptive' }] },
    ];
    const actual = expected.map(({ path: sourcePath }) => {
      const document = parse(fs.readFileSync(path.join(sourceRoot, sourcePath), 'utf8')) as SourceDocument;
      const effects = Array.isArray(document.effects) ? document.effects.filter(record) : [];
      const source = { sourcePath: `packs/_source/${sourcePath}`, pack: `dnd5e.${sourcePath.split('/')[0]}`, type: document.type ?? '', id: document._id ?? '', name: document.name ?? '' };
      const changes = effects.flatMap((effect) => {
        const system = record(effect.system) ? effect.system : {};
        return Array.isArray(system.changes) ? system.changes.filter(record).map((change) => ({ key: change.key, operation: change.type, value: change.value, classification: classifyPassiveEffectChange(source, sourcePath.startsWith('classes24/') ? '2024' : '2014', String(change.key ?? ''), change.type, change.value) })) : [];
      });
      const result = interpretPassiveEffects([{ source, effects }], sourcePath.startsWith('classes24/') ? '2024' : '2014');
      return { path: sourcePath, name: document.name ?? '', changes, diagnostics: result.diagnostics, contributions: result.contributions.map(({ target, operation, value }) => ({ target, operation, value })) };
    });

    expect(actual).toEqual(expected.map(({ path, name, changes }) => ({
      path, name, changes, diagnostics: [],
      contributions: path.endsWith('/second-story-work.yml') ? [{ target: 'movement-speed', operation: 'equal-to-walk', value: 'climb' }] : [],
    })));
    expect(classifyPassiveEffectChange({ sourcePath: 'packs/_source/classes24/ranger/class-features/roving.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbrgrRoving0000', name: 'Roving' }, '2024', 'system.attributes.movement.climb', 'upgrade', 30)).toBe('unsupported');
  });

  it('classifies exact 2014 and 2024 feature effects across class and subclass levels', () => {
    const expected = new Map<string, { classification: 'direct' | 'descriptive'; targets?: string[] }>([
      ['classes24/monk/class-features/disciplined-survivor.yml', { classification: 'direct', targets: ['saving-throw-proficiency'] }],
      ['classfeatures/monk/monk-features/diamond-soul.yml', { classification: 'direct', targets: ['saving-throw-proficiency'] }],
      ['classes24/bard/class-features/jack-of-all-trades.yml', { classification: 'direct', targets: ['skill-check-bonus'] }],
      ['classfeatures/bard/bard-features/jack-of-all-trades.yml', { classification: 'direct', targets: ['skill-check-bonus'] }],
      ['classes24/barbarian/class-features/feral-instinct.yml', { classification: 'direct', targets: ['initiative-advantage'] }],
      ['classfeatures/barbarian/barbarian-features/feral-instinct.yml', { classification: 'direct', targets: ['initiative-advantage'] }],
      ['classes24/fighter/subclass-features/champion/remarkable-athlete.yml', { classification: 'direct', targets: ['initiative-advantage', 'skill-advantage'] }],
      ['classes24/rogue/subclass-features/thief/use-magic-device.yml', { classification: 'descriptive' }],
      ['races/orc/orc-features/savage-attacks.yml', { classification: 'descriptive' }],
      ['classes24/rogue/class-features/reliable-talent.yml', { classification: 'descriptive' }],
      ['classfeatures/rogue/rogue-features/reliable-talent.yml', { classification: 'descriptive' }],
      ['classes24/fighter/subclass-features/champion/improved-critical.yml', { classification: 'descriptive' }],
      ['classes24/fighter/subclass-features/champion/superior-critical.yml', { classification: 'descriptive' }],
      ['classes24/paladin/class-features/aura-of-protection.yml', { classification: 'descriptive' }],
      ['classes24/paladin/class-features/radiant-strikes.yml', { classification: 'descriptive' }],
      ['classfeatures/paladin/paladin-features/improved-divine-smite.yml', { classification: 'descriptive' }],
      ['classfeatures/shared-features/fighting-styles/dueling.yml', { classification: 'descriptive' }],
      ['classes24/fighter/class-features/tactical-master.yml', { classification: 'descriptive' }],
      ['classfeatures/warlock/the-fiend-features/fiendish-resilience.yml', { classification: 'descriptive' }],
    ]);
    const actual = [...expected].map(([sourcePath, expectation]) => {
      const document = parse(fs.readFileSync(path.join(sourceRoot, sourcePath), 'utf8')) as SourceDocument;
      const source = { sourcePath: `packs/_source/${sourcePath}`, pack: `dnd5e.${sourcePath.split('/')[0]}`, type: document.type ?? '', id: document._id ?? '', name: document.name ?? '' };
      const ruleset = sourcePath.startsWith('classes24/') ? '2024' as const : '2014' as const;
      const effects = Array.isArray(document.effects) ? document.effects.filter(record) : [];
      const changes = effects.flatMap((effect) => {
        const system = record(effect.system) ? effect.system : {};
        return Array.isArray(system.changes) ? system.changes.filter(record) : [];
      });
      const result = interpretPassiveEffects([{ source, effects }], ruleset);
      return {
        sourcePath,
        classification: [...new Set(changes.map((change) => classifyPassiveEffectChange(source, ruleset, String(change.key), change.type, change.value)))],
        targets: result.contributions.map(({ target }) => target),
        diagnostics: result.diagnostics,
        expected: expectation,
      };
    });

    expect(actual.every(({ classification, expected }) => classification.length === 1 && classification[0] === expected.classification)).toBe(true);
    expect(actual.every(({ targets, expected }) => JSON.stringify(targets) === JSON.stringify(expected.targets ?? []))).toBe(true);
    expect(actual.every(({ diagnostics }) => diagnostics.length === 0)).toBe(true);
  });
});
