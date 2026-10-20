import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { classifyPassiveEffectKey } from '../src/passive-effects';

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

function levelOneSourceEffects(): EffectAuditEntry[] {
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
        const id = /\.Item\.([^.]+)$/.exec(uuid)?.[1];
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
      resolveRefs(document, 1);
    }
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
        audit.push({
          sourcePath: path.relative(sourceRoot, filename).replaceAll(path.sep, '/'),
          name: document.name ?? '',
          key: change.key,
          operation: change.type,
          value: change.value,
          classification: classifyPassiveEffectKey(change.key),
        });
      }
    }
  }
  return audit.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe('pinned 2024 level-one passive effect audit', () => {
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
    expect(levelOneSourceEffects()).toEqual(expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  });
});
