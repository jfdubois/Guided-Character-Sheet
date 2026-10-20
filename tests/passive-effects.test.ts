import { describe, expect, it } from 'vitest';
import type { FoundrySourceReference } from '../src/character-sources';
import { interpretPassiveEffects, type PassiveEffectInput } from '../src/passive-effects';

function source(id: string, name = id): FoundrySourceReference {
  return { sourcePath: `packs/${id}.yml`, pack: 'dnd5e.origins24', type: 'feat', id, name };
}

function alertEffect(overrides: Partial<PassiveEffectInput> = {}): PassiveEffectInput {
  return { disabled: false, transfer: true, system: { changes: [{ key: 'flags.dnd5e.initiativeAlert', type: 'add', value: true }] }, ...overrides };
}

describe('interpretPassiveEffects', () => {
  it('turns a transferable 2024 Alert flag into one initiative proficiency contribution', () => {
    const result = interpretPassiveEffects([{ source: source('alert'), effects: [alertEffect()] }], '2024');
    expect(result.contributions).toEqual([{ source: source('alert'), key: 'flags.dnd5e.initiativeAlert', target: 'initiative-proficiency', operation: 'set-tier', value: 'proficiency' }]);
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores disabled and non-transferred effects', () => {
    const result = interpretPassiveEffects([{ source: source('alert'), effects: [alertEffect({ disabled: true }), alertEffect({ transfer: false })] }], '2024');
    expect(result.contributions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects a malformed disabled flag instead of treating the effect as enabled', () => {
    const result = interpretPassiveEffects([{ source: source('alert'), effects: [alertEffect({ disabled: 'true' })] }], '2024');
    expect(result.contributions).toEqual([]);
    expect(result.diagnostics).toMatchObject([{ source: source('alert') }]);
  });

  it('diagnoses an unsupported operation or malformed value on a direct key', () => {
    const effects = [
      { disabled: false, transfer: true, system: { changes: [{ key: 'flags.dnd5e.initiativeAlert', type: 'multiply', value: true }] } },
      { disabled: false, transfer: true, system: { changes: [{ key: 'flags.dnd5e.initiativeAlert', type: 'add', value: 'yes' }] } },
    ];
    const result = interpretPassiveEffects([{ source: source('alert'), effects }], '2024');
    expect(result.contributions).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.every((diagnostic) => diagnostic.source.id === 'alert')).toBe(true);
  });

  it('does not apply the 2024 initiative flag to a different ruleset', () => {
    const result = interpretPassiveEffects([{ source: source('alert'), effects: [alertEffect()] }], '2014');
    expect(result.contributions).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('deduplicates the same source effect reached through multiple grants', () => {
    const ref = source('alert');
    const result = interpretPassiveEffects([{ source: ref, effects: [alertEffect()] }, { source: { ...ref }, effects: [alertEffect()] }], '2024');
    expect(result.contributions).toHaveLength(1);
  });

  it('keeps advantage and conditional roll modes descriptive', () => {
    const result = interpretPassiveEffects([{ source: source('cunning'), effects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.abilities.int.save.roll.mode', type: 'add', value: 1 }] } }] }], '2024');
    expect(result.contributions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.descriptiveKeys).toEqual(['system.abilities.int.save.roll.mode']);
  });

  it('reports malformed effect containers and changes without throwing', () => {
    const result = interpretPassiveEffects([{ source: source('bad'), effects: [{ disabled: false, transfer: true, system: { changes: [{ value: 2 }, 'bad'] } }, { disabled: false, transfer: true, system: { changes: 'bad' } }] }], '2024');
    expect(result.diagnostics).toHaveLength(3);
    expect(result.contributions).toEqual([]);
  });

  it('uses a single proficiency tier when multiple sources provide initiative proficiency', () => {
    const result = interpretPassiveEffects([{ source: source('a'), effects: [alertEffect()] }, { source: source('b'), effects: [alertEffect()] }], '2024');
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]?.source.id).toBe('a');
  });

  it('preserves distinct additive contributions for armor class and ranged attacks', () => {
    const result = interpretPassiveEffects([
      { source: source('defense'), effects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.ac.bonus', type: 'add', value: 1 }] } }] },
      { source: source('archery'), effects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.bonuses.rwak.attack', type: 'add', value: 2 }] } }] },
    ], '2024');
    expect(result.contributions.map(({ target, operation, value }) => ({ target, operation, value }))).toEqual([
      { target: 'ranged-weapon-attack-bonus', operation: 'add', value: 2 },
    ]);
    expect(result.descriptiveKeys).toEqual(['system.attributes.ac.bonus']);
  });

  it('retains separately identified same-key additions from one source', () => {
    const result = interpretPassiveEffects([{ source: source('defense'), effects: [{ _id: 'effect-one', disabled: false, transfer: true, system: { changes: [
      { key: 'system.bonuses.rwak.attack', type: 'add', value: 1 },
      { key: 'system.bonuses.rwak.attack', type: 'add', value: 2 },
    ] } }] }], '2024');
    expect(result.contributions.map((contribution) => contribution.value)).toEqual([1, 2]);
  });

  it('projects the two pinned Unarmored Defense calculation modes without evaluating formulas', () => {
    const result = interpretPassiveEffects([{ source: source('unarmored-defense'), effects: [{ disabled: false, transfer: true, system: { changes: [
      { key: 'system.attributes.ac.calc', type: 'override', value: 'unarmoredBarb' },
      { key: 'system.attributes.ac.calc', type: 'override', value: 'unarmoredMonk' },
    ] } }] }], '2024');
    expect(result.contributions.map(({ target, operation, value }) => ({ target, operation, value }))).toEqual([
      { target: 'armor-class-calculation', operation: 'set-calculation', value: 'unarmoredBarb' },
      { target: 'armor-class-calculation', operation: 'set-calculation', value: 'unarmoredMonk' },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('reports source-linked diagnostics for unknown AC calculation modes', () => {
    const result = interpretPassiveEffects([{ source: source('unarmored-defense'), effects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.ac.calc', type: 'override', value: 'unarmoredWizard' }] } }] }], '2024');
    expect(result.contributions).toEqual([]);
    expect(result.diagnostics[0]).toMatchObject({ source: source('unarmored-defense'), key: 'system.attributes.ac.calc' });
  });

  it('translates eligible class proficiency, cantrip, and exact Wisdom formula effects', () => {
    const result = interpretPassiveEffects([{ source: source('primal-order'), effects: [{ disabled: false, transfer: true, system: { changes: [
      { key: 'system.traits.armorProf.value', type: 'add', value: 'med' },
      { key: 'system.traits.weaponProf.value', type: 'add', value: 'mar' },
      { key: 'system.scale.druid.cantrips-known', type: 'add', value: 1 },
      { key: 'system.skills.nat.bonuses.check', type: 'add', value: '(max(1,@abilities.wis.mod))' },
    ] } }] }], '2024');
    expect(result.contributions.map(({ target, operation, value }) => ({ target, operation, value }))).toEqual([
      { target: 'armor-proficiency', operation: 'add', value: 'med' },
      { target: 'weapon-proficiency', operation: 'add', value: 'mar' },
      { target: 'cantrip-capacity', operation: 'add', value: 1 },
      { target: 'skill-check-bonus', operation: 'add-minimum-ability-modifier', value: { skill: 'nat', ability: 'wis', minimum: 1 } },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects formula variants and preserves supported sense upgrades as typed contributions', () => {
    const result = interpretPassiveEffects([{ source: source('invocation'), effects: [{ disabled: false, transfer: true, system: { changes: [
      { key: 'system.attributes.senses.darkvision', type: 'upgrade', value: 120 },
      { key: 'system.skills.nat.bonuses.check', type: 'add', value: '@abilities.wis.mod' },
    ] } }] }], '2024');
    expect(result.contributions.map(({ target, operation, value }) => ({ target, operation, value }))).toEqual([
      { target: 'sense-darkvision', operation: 'upgrade', value: 120 },
    ]);
    expect(result.diagnostics[0]).toMatchObject({ key: 'system.skills.nat.bonuses.check' });
  });
});
