import { describe, expect, it } from 'vitest';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

describe('passive effect source summaries', () => {
  it('retains class feature effect records for entitled-feature collection', async () => {
    const index = createPinnedSourceIndex();
    const summary = await index.getClassSummary('2024', 'packs/_source/classes24/barbarian/barbarian.yml');
    const defense = summary.features?.find((feature) => feature.source.name === 'Unarmored Defense');
    expect(defense?.activeEffects?.[0]).toMatchObject({ transfer: true, system: { changes: [{ key: 'system.attributes.ac.calc', value: 'unarmoredBarb' }] } });
  }, 15000);

  it('retains species feature effect records alongside existing species projections', async () => {
    const index = createPinnedSourceIndex();
    const summary = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/gnome-rock.yml');
    const cunning = summary.features?.find((feature) => feature.source.name === 'Gnomish Cunning');
    expect(cunning?.activeEffects?.[0]).toMatchObject({ transfer: true, system: { changes: expect.arrayContaining([expect.objectContaining({ key: 'system.abilities.int.save.roll.mode' })]) } });
    expect(cunning?.rollAnnotations).toHaveLength(3);
  }, 15000);
});
