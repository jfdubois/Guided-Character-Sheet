import { describe, expect, it } from 'vitest';
import { readFoundryActivities, readFoundryUses, readFoundryUsesDiagnostic } from '../src/foundry-activity-summary';

describe('Foundry activity summaries', () => {
  it('preserves recovery formulas used by rest automation', () => {
    expect(readFoundryUses({ uses: { max: '2', recovery: [{ period: 'lr', type: 'recoverAll' }, { period: 'sr', type: 'formula', formula: '1' }] } })).toEqual({ maximum: '2', recovery: [{ period: 'lr', type: 'recoverAll' }, { period: 'sr', type: 'formula', formula: '1' }] });
  });
  it('reports malformed top-level uses instead of silently dropping them', () => {
    expect(readFoundryUsesDiagnostic({ uses: { max: { invalid: true }, recovery: 'shortRest' } })).toEqual({ diagnostics: ['uses.recovery must be an array', 'uses.max must be a string or number'] });
  });
  it('normalizes attack activity fields and uses recovery metadata', () => {
    const result = readFoundryActivities({
      activities: { attack: { _id: 'attack', name: 'Longsword', type: 'attack', activation: { type: 'action', value: 1 }, range: { value: 5, units: 'ft' }, attack: { ability: 'str', bonus: '@mod', type: { value: 'melee', classification: 'weapon' } }, damage: { parts: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }] }, consumption: { targets: [{ type: 'itemUses', value: '1', target: 'charges' }] }, uses: { max: '3', recovery: [{ period: 'sr', type: 'recoverAll' }] } } },
    });
    expect(result).toEqual({ activities: [{ id: 'attack', name: 'Longsword', type: 'attack', activation: { type: 'action', value: 1 }, range: { value: 5, units: 'ft' }, attack: { ability: 'str', bonus: '@mod', type: 'melee', classification: 'weapon' }, damage: [{ number: 1, denomination: 8, bonus: '@mod', types: ['slashing'] }], consumption: [{ type: 'itemUses', value: '1', target: 'charges' }], uses: { maximum: '3', recovery: [{ period: 'sr', type: 'recoverAll' }] } }], diagnostics: [] });
  });

  it('accepts pinned optional nulls, numeric dice strings, and empty use records', () => {
    const result = readFoundryActivities({
      activities: {
        mark: {
          _id: 'mark', type: 'damage', activation: { type: '', value: null },
          damage: { parts: [{ number: 1, denomination: '6', bonus: '', types: ['force'] }] },
          consumption: { targets: [] }, uses: { spent: 0, recovery: [], max: '' },
        },
      },
    });

    expect(result).toEqual({
      activities: [{ id: 'mark', type: 'damage', activation: { type: '' }, damage: [{ number: 1, denomination: 6, bonus: '', types: ['force'] }], consumption: [] }],
      diagnostics: [],
    });
  });

  it('accepts a null automatic die count when pinned damage uses a custom formula', () => {
    const result = readFoundryActivities({
      activities: {
        breath: {
          _id: 'breath', type: 'save',
          damage: { parts: [{ custom: { enabled: true, formula: '@scale.dragonborn.breath' }, number: null, denomination: 0, bonus: '', types: ['acid'] }] },
          consumption: { targets: [] },
        },
      },
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.activities[0]?.damage).toEqual([{ denomination: 0, bonus: '', types: ['acid'], customFormula: '@scale.dragonborn.breath' }]);
  });

  it('treats a null denomination as absent while diagnosing malformed non-null denominations', () => {
    const result = readFoundryActivities({ activities: {
      damage: { _id: 'damage', type: 'damage', damage: { parts: [
        { custom: { enabled: true, formula: '@scale.rogue.sneak-attack' }, number: null, denomination: null, bonus: '', types: ['piercing'] },
        { number: 1, denomination: 'd6', types: ['piercing'] },
      ] } },
    } });

    expect(result.activities[0]?.damage).toEqual([
      { bonus: '', types: ['piercing'], customFormula: '@scale.rogue.sneak-attack' },
      { number: 1, types: ['piercing'] },
    ]);
    expect(result.diagnostics).toEqual(['activities.damage.damage.parts[1].denomination must be a number']);
  });

  it('retains an enabled custom damage formula', () => {
    const result = readFoundryActivities({ activities: {
      sneak: {
        _id: 'sneak', type: 'damage', damage: { parts: [
          { custom: { enabled: true, formula: '@scale.rogue.sneak-attack' }, types: ['piercing'] },
          { custom: { enabled: false, formula: '1d6' } },
        ] },
      },
    } });

    expect(result.activities[0]?.damage).toEqual([
      { customFormula: '@scale.rogue.sneak-attack', types: ['piercing'] },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('diagnoses malformed enabled custom formulas', () => {
    const result = readFoundryActivities({ activities: {
      malformed: {
        _id: 'malformed', type: 'damage', damage: { parts: [
          { custom: { enabled: true } },
          { custom: { enabled: true, formula: '  ' } },
          { custom: { enabled: true, formula: 6 } },
        ] },
      },
    } });

    expect(result.activities[0]?.damage).toBeUndefined();
    expect(result.diagnostics).toEqual([
      'activities.malformed.damage.parts[0].custom.formula must be a nonblank string when enabled',
      'activities.malformed.damage.parts[1].custom.formula must be a nonblank string when enabled',
      'activities.malformed.damage.parts[2].custom.formula must be a nonblank string when enabled',
    ]);
  });

  it('normalizes malformed and legacy records with diagnostics', () => {
    expect(readFoundryActivities({ activities: { bad: { _id: 'bad', type: 42 }, missing: { type: 'utility' } } })).toEqual({ activities: [], diagnostics: ['activities.bad.type must be a string', 'activities.missing is missing a string id'] });
    expect(readFoundryActivities({})).toEqual({ activities: [], diagnostics: [] });
  });

  it('diagnoses malformed nested supported fields while retaining valid portions', () => {
    const result = readFoundryActivities({ activities: {
      malformed: {
        _id: 'malformed', type: 'utility',
        activation: { type: 4, value: 'one' }, range: { value: [], units: 5 },
        attack: { ability: 7, type: 'melee' }, damage: { parts: [{ number: '1', types: 'slashing' }, null] },
        consumption: { targets: [{ type: 4 }, null] }, uses: { max: [], recovery: [{ period: 3 }, null] },
      },
    } });
    expect(result.activities).toEqual([{ id: 'malformed', type: 'utility', consumption: [] }]);
    expect(result.diagnostics).toEqual([
      'activities.malformed.activation.type must be a string', 'activities.malformed.activation.value must be a number',
      'activities.malformed.range.value must be a string or number', 'activities.malformed.range.units must be a string',
      'activities.malformed.attack.ability must be a string', 'activities.malformed.attack.type must be an object',
      'activities.malformed.damage.parts[0].number must be a number', 'activities.malformed.damage.parts[0].types must be an array',
      'activities.malformed.damage.parts[1] must be an object', 'activities.malformed.consumption.targets[0].type must be a string',
      'activities.malformed.consumption.targets[1] must be an object', 'activities.malformed.uses.recovery[0].period must be a string',
      'activities.malformed.uses.recovery[1] must be an object', 'activities.malformed.uses.max must be a string or number',
    ]);
  });

  it('retains multiple activities in deterministic source order', () => {
    expect(readFoundryActivities({ activities: {
      second: { _id: 'second', name: 'Second', type: 'utility' },
      first: { _id: 'first', name: 'First', type: 'attack' },
    } }).activities.map((activity) => activity.id)).toEqual(['second', 'first']);
  });

  it('retains static save and target presentation fields without interpreting them', () => {
    const result = readFoundryActivities({ activities: { breath: { _id: 'breath', type: 'save', target: { template: { type: 'cone', size: '15', units: 'ft' }, affects: { type: 'creature' } }, save: { ability: ['dex'], dc: { calculation: 'con' } } } } });
    expect(result.activities[0]).toMatchObject({ target: { template: { type: 'cone', size: '15', units: 'ft' }, affects: { type: 'creature' } }, save: { ability: ['dex'], dc: { calculation: 'con' } } });
  });

  it('drops blank target-template fields while retaining a concrete affected target', () => {
    const result = readFoundryActivities({ activities: { damage: { _id: 'damage', type: 'damage', range: { units: 'self', special: '' }, target: { template: { type: '', size: '', width: '', units: '' }, affects: { type: 'creature' } } } } });

    expect(result.activities[0]).toMatchObject({ range: { units: 'self', special: '' }, target: { affects: { type: 'creature' } } });
    expect(result.activities[0]?.target?.template).toBeUndefined();
  });

  it('accepts scalar save abilities used by spell activity records', () => {
    const result = readFoundryActivities({ activities: { save: { _id: 'save', type: 'save', save: { ability: 'dex', dc: { calculation: 'spellcasting' } } } } });
    expect(result.diagnostics).toEqual([]);
    expect(result.activities[0]?.save).toEqual({ ability: ['dex'], dc: { calculation: 'spellcasting' } });
  });
});
