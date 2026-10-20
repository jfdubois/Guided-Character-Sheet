import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getLevelOneClassProgression } from '../src/level-one-progression';
import { createFinalizedMutableCharacterState } from '../src/mutable-character-state';
import { collectFinalizationResources } from '../src/character-view';
import type { CharacterDocument } from '../src/character-model';
import { createPinnedSourceIndex, PINNED_FOUNDRY_ROOT } from './support/pinned-foundry-source';

describe('pinned 2024 Short Rest sources', () => {
  it('provides a supported Hit Point Die for every base class', async () => {
    const index = createPinnedSourceIndex();
    const classes = await index.listClasses('2024');
    expect(classes).toHaveLength(12);
    for (const source of classes) {
      const summary = await index.getClassSummary('2024', source.sourcePath);
      expect(summary.hitDie, source.name).toMatch(/^d(?:6|8|10|12)$/);
      const mutable = createFinalizedMutableCharacterState({ items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, {
        ruleset: '2024', classSourcePath: summary.source.sourcePath, classHitDie: summary.hitDie, constitutionModifier: 0,
        spellSlots: getLevelOneClassProgression(summary).spellcasting?.spellSlots ?? [],
      });
      expect(mutable.hitDice, source.name).toEqual([{ classSourcePath: summary.source.sourcePath, denomination: summary.hitDie, current: 1, maximum: 1 }]);
    }
  }, 30_000);

  it('retains Warlock pact progression and maps its pinned level-one slot', async () => {
    const index = createPinnedSourceIndex();
    const source = (await index.listClasses('2024')).find((candidate) => candidate.identifier === 'warlock');
    if (source === undefined) throw new Error('Pinned 2024 Warlock source is unavailable.');
    const summary = await index.getClassSummary('2024', source.sourcePath);
    expect(summary.spellcasting?.progression).toBe('pact');
    expect(getLevelOneClassProgression(summary).spellcasting?.spellSlots).toEqual([{ key: 'pact:1', kind: 'pact', level: 1, maximum: 1, recovery: ['short-rest', 'long-rest'] }]);

    const config = await readFile(`${PINNED_FOUNDRY_ROOT}/module/config.mjs`, 'utf8');
    expect(config).toMatch(/1:\s*\{\s*slots:\s*1,\s*level:\s*1\s*\}/);
    expect(config).toMatch(/recoverPeriods:\s*\["sr"\][\s\S]*?recoverSpellSlotTypes:\s*new Set\(\["pact"\]\)/);
  }, 30_000);

  it('projects only the selected Goliath ancestry resource for legacy reconciliation', async () => {
    const index = createPinnedSourceIndex();
    const [species, classes, backgrounds] = await Promise.all([index.getSpeciesSummary('2024', 'packs/_source/origins24/species/goliath.yml'), index.listClasses('2024'), index.listBackgrounds('2024')]);
    const rogueSource = classes.find((candidate) => candidate.identifier === 'rogue');
    const acolyteSource = backgrounds.find((candidate) => candidate.identifier === 'acolyte');
    if (rogueSource === undefined || acolyteSource === undefined) throw new Error('Pinned Rogue or Acolyte source is unavailable.');
    const [rogue, acolyte] = await Promise.all([index.getClassSummary('2024', rogueSource.sourcePath), index.getBackgroundSummary('2024', acolyteSource.sourcePath)]);
    const document: CharacterDocument = {
      format: 1, kind: 'guided-character', name: 'Bobby compatibility', ruleset: '2024', step: 'background',
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
      origin: { sourcePath: species.source.sourcePath, identifier: species.source.identifier ?? 'goliath', id: species.source.id },
      speciesConfiguration: {
        origin: { sourcePath: species.source.sourcePath, identifier: species.source.identifier ?? 'goliath', id: species.source.id },
        foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
        grants: [],
        choices: [{ key: 'species:LrdYfRLrRlgsZrNn', source: { id: 'LrdYfRLrRlgsZrNn', type: 'ItemChoice' }, selected: ['Compendium.dnd5e.origins24.Item.phbsptCloudsJaun'] }],
        spellChoices: [],
      },
      classProgressions: [{ class: { sourcePath: rogue.source.sourcePath, identifier: rogue.source.identifier ?? 'rogue', id: rogue.source.id }, targetLevel: 1, selections: [] }],
      background: { sourcePath: acolyte.source.sourcePath, identifier: acolyte.source.identifier ?? 'acolyte', id: acolyte.source.id },
    };
    const keys = collectFinalizationResources(document, rogue, species, acolyte, 2).map((resource) => resource.key);
    expect(keys).toContain('feature:packs/_source/origins24/species/traits/goliath/clouds-jaunt.yml');
    expect(keys).not.toEqual(expect.arrayContaining(['feature:packs/_source/origins24/species/traits/goliath/fires-burn.yml', 'feature:packs/_source/origins24/species/traits/goliath/frosts-chill.yml', 'feature:packs/_source/origins24/species/traits/goliath/hills-tumble.yml', 'feature:packs/_source/origins24/species/traits/goliath/stones-endurance.yml', 'feature:packs/_source/origins24/species/traits/goliath/storms-thunder.yml']));
  }, 30_000);

  it('initializes two source-backed Second Wind uses for a level-one Fighter', async () => {
    const index = createPinnedSourceIndex();
    const [fighter, dwarf, soldier] = await Promise.all([
      index.getClassSummary('2024', 'packs/_source/classes24/fighter/fighter.yml'),
      index.getSpeciesSummary('2024', 'packs/_source/origins24/species/dwarf.yml'),
      index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/soldier.yml'),
    ]);
    const document: CharacterDocument = {
      format: 1, kind: 'guided-character', name: 'Fighter', ruleset: '2024', step: 'background',
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'pinned' },
      origin: { sourcePath: dwarf.source.sourcePath, identifier: 'dwarf', id: dwarf.source.id },
      classProgressions: [{ class: { sourcePath: fighter.source.sourcePath, identifier: 'fighter', id: fighter.source.id }, targetLevel: 1, selections: [] }],
      background: { sourcePath: soldier.source.sourcePath, identifier: 'soldier', id: soldier.source.id },
    };

    const resources = collectFinalizationResources(document, fighter, dwarf, soldier, 2);

    expect(resources).toContainEqual(expect.objectContaining({
      key: 'feature:packs/_source/classes24/fighter/class-features/second-wind.yml',
      current: 2, maximum: 2, reset: 'long-rest',
    }));
  }, 30_000);
});
