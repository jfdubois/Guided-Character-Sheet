import { describe, expect, it } from 'vitest';
import { getEligibleClassFeatures, getEligibleClassScales } from '../src/class-feature-eligibility';
import { getEligibleClassProficiencies } from '../src/class-proficiency-eligibility';
import { createCharacterDocument, withRuleset } from '../src/character-model';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: '0'.repeat(40), systemVersion: '6.0.0' };

describe('pinned class source mapping', () => {
  it('retains and level-gates the pinned level-five Barbarian features', async () => {
    const index = createPinnedSourceIndex();
    const source = (await index.listClasses('2024')).find((candidate) => candidate.identifier === 'barbarian');
    if (source === undefined) throw new Error('Pinned 2024 Barbarian source is unavailable');
    const summary = await index.getClassSummary('2024', source.sourcePath);
    const levelFive = summary.features?.filter((feature) => feature.level === 5) ?? [];
    expect(levelFive.map((feature) => feature.source.name)).toEqual(expect.arrayContaining(['Extra Attack', 'Fast Movement']));
    expect(levelFive.every((feature) => feature.requiresChoice === undefined)).toBe(true);

    const base = withRuleset(createCharacterDocument('Barbarian', snapshot), '2024');
    const atLevel = (targetLevel: number) => ({ ...base, classProgressions: [{ class: { sourcePath: source.sourcePath, identifier: source.identifier ?? '', id: source.id }, targetLevel, selections: [] }] });
    expect(getEligibleClassFeatures(atLevel(4), summary).some((feature) => feature.level === 5)).toBe(false);
    expect(getEligibleClassFeatures(atLevel(5), summary).filter((feature) => feature.level === 5).map((feature) => feature.source.name)).toEqual(expect.arrayContaining(['Extra Attack', 'Fast Movement']));
  }, 30_000);

  it('keeps nested scales from automatic feature grants automatic', async () => {
    const index = createPinnedSourceIndex();
    const source = (await index.listClasses('2024')).find((candidate) => candidate.identifier === 'cleric');
    if (source === undefined) throw new Error('Pinned 2024 Cleric source is unavailable');
    const summary = await index.getClassSummary('2024', source.sourcePath);
    const divineSpark = summary.scales?.find((scale) => scale.advancementId === 'uFauTQi3ls40bO1J');
    expect(divineSpark).toMatchObject({ identifier: 'spark', level: 2 });
    expect(divineSpark?.requiresChoice).toBeUndefined();

    const document = {
      ...withRuleset(createCharacterDocument('Cleric', snapshot), '2024'),
      classProgressions: [{ class: { sourcePath: source.sourcePath, identifier: source.identifier ?? '', id: source.id }, targetLevel: 2, selections: [] }],
    };
    expect(getEligibleClassScales(document, summary).map((scale) => scale.advancementId)).toContain('uFauTQi3ls40bO1J');
  }, 30_000);

  it('preserves the pinned Druid challenge-rating scale as typed source data', async () => {
    const index = createPinnedSourceIndex();
    const source = (await index.listClasses('2024')).find((candidate) => candidate.identifier === 'druid');
    if (source === undefined) throw new Error('Pinned 2024 Druid source is unavailable');
    const summary = await index.getClassSummary('2024', source.sourcePath);
    const wildShape = summary.scales?.find((scale) => scale.advancementId === 'pIfdGSkqdp00omkE');
    expect(wildShape?.diagnostics).toEqual([]);
    expect([...wildShape!.values]).toEqual([
      [2, { type: 'cr', value: 0.25 }],
      [4, { type: 'cr', value: 0.5 }],
      [8, { type: 'cr', value: 1 }],
    ]);
  }, 30_000);

  it('projects the pinned Rogue level-fifteen saving-throw grants only at their source level', async () => {
    const index = createPinnedSourceIndex();
    const source = (await index.listClasses('2024')).find((candidate) => candidate.identifier === 'rogue');
    if (source === undefined) throw new Error('Pinned 2024 Rogue source is unavailable');
    const summary = await index.getClassSummary('2024', source.sourcePath);
    const slipperyMind = summary.advancements.find((advancement) => advancement.id === 'FiaNLovfP6tnY4tD');
    expect(slipperyMind).toMatchObject({ type: 'Trait', level: 15 });

    const base = withRuleset(createCharacterDocument('Rogue', snapshot), '2024');
    const atLevel = (targetLevel: number) => ({ ...base, classProgressions: [{ class: { sourcePath: source.sourcePath, identifier: source.identifier ?? '', id: source.id }, targetLevel, selections: [] }] });
    expect(getEligibleClassProficiencies(atLevel(14), summary)?.savingThrows).not.toEqual(expect.arrayContaining(['saves:wis', 'saves:cha']));
    expect(getEligibleClassProficiencies(atLevel(15), summary)?.savingThrows).toEqual(expect.arrayContaining(['saves:wis', 'saves:cha']));
  }, 30_000);
});
