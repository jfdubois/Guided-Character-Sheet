import { describe, expect, it } from 'vitest';
import { buildBackgroundAbilityConfiguration, createBackgroundAbilitySelection, validateBackgroundAbilitySelection } from '../src/background-ability-configuration';
import type { BackgroundSourceSummary } from '../src/character-sources';

const acolyte: BackgroundSourceSummary = {
  source: { sourcePath: 'packs/_source/origins24/backgrounds/acolyte.yml', pack: 'dnd5e.origins24', type: 'background', id: 'acolyte', identifier: 'acolyte', name: 'Acolyte' },
  ruleset: '2024',
  abilityScores: { advancementId: 'asi-acolyte', points: 3, cap: 2, locked: ['str', 'dex', 'con'], fixed: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } },
  skills: [], languages: [], languageChoices: [], tools: [], features: [], equipment: [],
};

describe('background ability configuration', () => {
  it('creates canonical balanced and focused allocations', () => {
    const configuration = buildBackgroundAbilityConfiguration(acolyte);
    expect(configuration).toMatchObject({ kind: 'choice', advancementId: 'asi-acolyte', points: 3, cap: 2, eligibleAbilities: ['int', 'wis', 'cha'] });
    if (configuration.kind !== 'choice') throw new Error('Expected choice configuration');
    expect(createBackgroundAbilitySelection(configuration, { int: 1, wis: 1, cha: 1 })).toEqual({ advancementId: 'asi-acolyte', assignments: { int: 1, wis: 1, cha: 1 } });
    expect(createBackgroundAbilitySelection(configuration, { int: 2, wis: 1, cha: 0 })).toEqual({ advancementId: 'asi-acolyte', assignments: { int: 2, wis: 1 } });
  });

  it.each([
    [{ advancementId: 'stale', assignments: { int: 2, wis: 1 } }, 'Background ability advancement does not match the current source.'],
    [{ advancementId: 'asi-acolyte', assignments: { str: 2, wis: 1 } }, 'Strength is not eligible for this background.'],
    [{ advancementId: 'asi-acolyte', assignments: { int: 3 } }, 'Intelligence exceeds the background increase cap of 2.'],
    [{ advancementId: 'asi-acolyte', assignments: { int: 1, wis: 1 } }, 'Background ability increases must allocate exactly 3 points.'],
  ])('rejects an invalid source-backed allocation', (selection, message) => {
    const configuration = buildBackgroundAbilityConfiguration(acolyte);
    expect(validateBackgroundAbilitySelection(configuration, selection)).toContain(message);
  });

  it('rejects an increase that raises a score above 20', () => {
    const configuration = buildBackgroundAbilityConfiguration(acolyte);
    const selection = { advancementId: 'asi-acolyte', assignments: { int: 2, wis: 1 } };
    expect(validateBackgroundAbilitySelection(configuration, selection, { str: 10, dex: 10, con: 10, int: 19, wis: 18, cha: 10 })).toContain('Intelligence cannot be increased above 20.');
  });

  it('rejects combined fixed and selected increases above 20', () => {
    const configuration = buildBackgroundAbilityConfiguration({ ...acolyte, abilityScores: { ...acolyte.abilityScores, fixed: { int: 1 } } });
    if (configuration.kind !== 'choice') throw new Error('Expected choice configuration');
    expect(validateBackgroundAbilitySelection(configuration, { advancementId: 'asi-acolyte', assignments: { int: 1, wis: 2 } }, { str: 10, dex: 10, con: 10, int: 19, wis: 10, cha: 10 })).toContain('Intelligence cannot be increased above 20.');
  });

  it('follows Criminal structured locks when its prose disagrees', () => {
    const criminal = { ...acolyte, source: { ...acolyte.source, sourcePath: 'packs/_source/origins24/backgrounds/criminal.yml', id: 'criminal', identifier: 'criminal', name: 'Criminal' }, abilityScores: { advancementId: 'asi-criminal', points: 3, cap: 2, locked: ['str', 'wis', 'cha'] } };
    expect(buildBackgroundAbilityConfiguration(criminal)).toMatchObject({ kind: 'choice', eligibleAbilities: ['dex', 'con', 'int'] });
  });

  it.each([
    ['four points', { points: 4, cap: 2, locked: ['str', 'dex', 'con'] }],
    ['one-point cap', { points: 3, cap: 1, locked: ['str', 'dex', 'con'] }],
    ['fewer than three eligible abilities', { points: 3, cap: 2, locked: ['str', 'dex', 'con', 'int'] }],
  ])('reports an unsupported %s shape instead of exposing impossible controls', (_label, abilityScores) => {
    expect(buildBackgroundAbilityConfiguration({ ...acolyte, abilityScores: { advancementId: 'asi-acolyte', ...abilityScores } })).toEqual({
      kind: 'unsupported',
      reason: 'Background ability choice shape is unsupported by the creation controls. Expected 3 points, a cap of 2, and at least 3 eligible abilities.',
    });
  });

  it('keeps a larger eligible pool as a supported choice', () => {
    expect(buildBackgroundAbilityConfiguration({ ...acolyte, abilityScores: { ...acolyte.abilityScores, locked: ['str', 'dex'] } })).toMatchObject({ kind: 'choice', eligibleAbilities: ['con', 'int', 'wis', 'cha'] });
  });

  it('returns an unsupported result instead of inventing missing constraints', () => {
    expect(buildBackgroundAbilityConfiguration({ ...acolyte, abilityScores: { points: 3, cap: 2, locked: ['str'] } })).toEqual({ kind: 'unsupported', reason: 'Background ability advancement identity is unavailable.' });
  });
});
