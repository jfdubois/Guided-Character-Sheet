import { describe, expect, it } from 'vitest';
import { resolveFeatureDamagePart } from '../src/feature-damage-resolver';
import type { ClassScaleValueSummary } from '../src/character-sources';
import type { SpeciesScaleValueSummary } from '../src/character-sources';
import type { FoundryDamagePartSummary } from '../src/foundry-activity-summary';

const sneakAttackScale = (entries: Array<[number, { type: 'dice'; number: number | null; faces: number; modifiers: string[] }]>): ClassScaleValueSummary => ({
  advancementId: 'scale-sneak-attack', title: 'Sneak Attack', identifier: 'sneak-attack', level: 1,
  values: new Map(entries), diagnostics: [],
});
const part = (customFormula: string, types: string[] = []): FoundryDamagePartSummary => ({ customFormula, types });
const context = (level: number, scales: ClassScaleValueSummary[] = [sneakAttackScale([[1, { type: 'dice', number: 1, faces: 6, modifiers: [] }], [3, { type: 'dice', number: 2, faces: 6, modifiers: [] }]])], classIdentifier = 'rogue') => ({ classIdentifier, targetLevel: level, scales });

describe('feature damage resolver', () => {
  it('resolves a species-owned scale against total character level without accepting class ownership', () => {
    const species: SpeciesScaleValueSummary = { advancementId: 'breath', title: 'Breath Weapon', identifier: 'breath', level: 0, values: new Map([[0, { type: 'dice', number: 1, faces: 10, modifiers: [] }], [5, { type: 'dice', number: 2, faces: 10, modifiers: [] }]]), diagnostics: [] };
    expect(resolveFeatureDamagePart(part('@scale.dragonborn.breath', ['fire']), { speciesIdentifier: 'dragonborn', speciesScales: [species], targetLevel: 1 })).toEqual({ damage: '1d10 fire' });
    expect(resolveFeatureDamagePart(part('@scale.dragonborn.breath'), { classIdentifier: 'dragonborn', scales: [], targetLevel: 1 })).toMatchObject({ diagnostic: expect.stringContaining('owner') });
  });
  it('resolves an exact class scale at level 1', () => {
    expect(resolveFeatureDamagePart(part('@scale.rogue.sneak-attack'), context(1))).toEqual({ damage: '1d6' });
  });

  it('resolves an exact class scale at level 3', () => {
    expect(resolveFeatureDamagePart(part('@scale.rogue.sneak-attack'), context(3))).toEqual({ damage: '2d6' });
  });

  it('formats a null dice count using Foundry dice semantics', () => {
    expect(resolveFeatureDamagePart(part('@scale.rogue.sneak-attack'), context(1, [sneakAttackScale([[1, { type: 'dice', number: null, faces: 6, modifiers: [] }]])]))).toEqual({ damage: 'd6' });
  });

  it('formats numeric scales as a number', () => {
    const numeric: ClassScaleValueSummary = { advancementId: 'scale', title: 'Damage', identifier: 'damage', level: 1, values: new Map([[1, { type: 'number', value: 3 }]]), diagnostics: [] };
    expect(resolveFeatureDamagePart(part('@scale.rogue.damage'), context(1, [numeric]))).toEqual({ damage: '3' });
  });

  it('rejects distance scales', () => {
    const distance: ClassScaleValueSummary = { advancementId: 'scale', title: 'Range', identifier: 'range', level: 1, values: new Map([[1, { type: 'distance', value: 10, units: 'ft' }]]), diagnostics: [] };
    expect(resolveFeatureDamagePart(part('@scale.rogue.range'), context(1, [distance]))).toMatchObject({ diagnostic: expect.stringContaining('@scale.rogue.range') });
  });

  it('leaves compound formulas unsupported and reports the original formula', () => {
    const formula = '(@scale.rogue.sneak-attack) + @mod';
    expect(resolveFeatureDamagePart(part(formula), context(1))).toEqual({ diagnostic: expect.stringContaining(formula) });
  });

  it('rejects an exact reference followed by a line break', () => {
    const formula = '@scale.rogue.sneak-attack\n';
    expect(resolveFeatureDamagePart(part(formula), context(1))).toEqual({ diagnostic: expect.stringContaining(formula) });
  });

  it('does not resolve a scale owned by a different class', () => {
    expect(resolveFeatureDamagePart(part('@scale.rogue.sneak-attack'), context(1, undefined, 'fighter'))).toMatchObject({ diagnostic: expect.stringContaining('@scale.rogue.sneak-attack') });
  });

  it('diagnoses a missing exact scale', () => {
    expect(resolveFeatureDamagePart(part('@scale.rogue.missing'), context(1))).toMatchObject({ diagnostic: expect.stringContaining('missing') });
  });

  it('does not append inherited damage types to resolved scale damage', () => {
    expect(resolveFeatureDamagePart(part('@scale.rogue.sneak-attack', ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']), context(1))).toEqual({ damage: '1d6' });
  });

  it('preserves a specific damage type on resolved scale damage', () => {
    expect(resolveFeatureDamagePart(part('@scale.rogue.sneak-attack', ['force']), context(1))).toEqual({ damage: '1d6 force' });
  });

  it('does not suppress a list with duplicates as the complete inherited set', () => {
    const types = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'slashing'];
    expect(resolveFeatureDamagePart(part('@scale.rogue.sneak-attack', types), context(1))).toEqual({ damage: `1d6 ${types.join(', ')}` });
  });
});
