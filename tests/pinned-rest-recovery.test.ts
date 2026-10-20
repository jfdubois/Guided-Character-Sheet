import { describe, expect, it } from 'vitest';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

describe('pinned long-rest recovery sources', () => {
  it('preserves mixed class recovery profiles from the 2024 YAML', async () => {
    const index = createPinnedSourceIndex();
    const barbarian = (await index.listClasses('2024')).find((source) => source.identifier === 'barbarian');
    const fighter = (await index.listClasses('2024')).find((source) => source.identifier === 'fighter');
    if (barbarian === undefined || fighter === undefined) throw new Error('Pinned Barbarian or Fighter source is unavailable');
    const [barbarianSummary, fighterSummary] = await Promise.all([index.getClassSummary('2024', barbarian.sourcePath), index.getClassSummary('2024', fighter.sourcePath)]);
    expect(barbarianSummary.features?.find((feature) => feature.source.identifier === 'rage')?.uses?.recovery).toEqual([
      { period: 'lr', type: 'recoverAll' },
      { period: 'sr', type: 'formula', formula: '1' },
    ]);
    expect(fighterSummary.features?.find((feature) => feature.source.identifier === 'second-wind')?.uses?.recovery).toEqual([
      { period: 'lr', type: 'recoverAll' },
      { period: 'sr', type: 'formula', formula: '1' },
    ]);
  }, 30_000);

  it('preserves long- and short-rest species recovery from the 2024 YAML', async () => {
    const index = createPinnedSourceIndex();
    const orc = (await index.listSpecies('2024')).find((source) => source.identifier === 'orc');
    if (orc === undefined) throw new Error('Pinned Orc source is unavailable');
    const summary = await index.getSpeciesSummary('2024', orc.sourcePath);
    expect(summary.features?.find((feature) => feature.source.identifier === 'relentless-endurance')?.uses?.recovery).toEqual([{ period: 'lr', type: 'recoverAll' }]);
    expect(summary.features?.find((feature) => feature.source.identifier === 'adrenaline-rush')?.uses?.recovery).toEqual([{ period: 'sr', type: 'recoverAll' }]);
  }, 30_000);
});
