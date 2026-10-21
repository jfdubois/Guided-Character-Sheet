import { describe, expect, it } from 'vitest';
import type { FoundrySourceReference } from '../src/character-sources';
import { classifyPassiveEffectChange, interpretPassiveEffects, type PassiveEffectInput } from '../src/passive-effects';

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

  it('projects pinned signed numeric 2014 Archery bonuses and diagnoses formulas', () => {
    const archery = { sourcePath: 'packs/_source/classfeatures/shared-features/fighting-styles/archery.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'archery', name: 'Archery' };
    const valid = interpretPassiveEffects([{ source: archery, effects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.bonuses.rwak.attack', type: 'add', value: '+2' }] } }] }], '2014');
    expect(valid.contributions.map(({ target, value }) => ({ target, value }))).toEqual([{ target: 'ranged-weapon-attack-bonus', value: 2 }]);
    expect(valid.diagnostics).toEqual([]);

    const invalid = interpretPassiveEffects([{ source: archery, effects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.bonuses.rwak.attack', type: 'add', value: '1d4' }] } }] }], '2014');
    expect(invalid.contributions).toEqual([]);
    expect(invalid.diagnostics).toMatchObject([{ key: 'system.bonuses.rwak.attack' }]);
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

  it('projects the pinned Second-Story Work climb speed change as equal to walking speed', () => {
    const result = interpretPassiveEffects([{ source: {
      sourcePath: 'packs/_source/classes24/rogue/subclass-features/thief/second-story-work.yml',
      pack: 'dnd5e.classes24', type: 'feat', id: 'phbrgeSecondstor', name: 'Second-Story Work',
    }, effects: [{ disabled: false, transfer: true, system: { changes: [{
      key: 'system.attributes.movement.climb', type: 'upgrade', value: '@attributes.movement.speed',
    }] } }] }], '2024');

    expect(result.contributions).toEqual([{
      source: expect.objectContaining({ name: 'Second-Story Work' }),
      key: 'system.attributes.movement.climb', target: 'movement-speed', operation: 'equal-to-walk', value: 'climb',
    }]);
    expect(result.diagnostics).toEqual([]);
  });

  it('recognizes only the pinned conditional Ranger Roving movement changes as descriptive', () => {
    const sourceRef = {
      sourcePath: 'packs/_source/classes24/ranger/class-features/roving.yml',
      pack: 'dnd5e.classes24', type: 'feat', id: 'phbrgrRoving0000', name: 'Roving',
    };
    const changes = [
      { key: 'system.attributes.movement.walk', type: 'add', value: 10 },
      { key: 'system.attributes.movement.climb', type: 'upgrade', value: '@attributes.movement.walk' },
      { key: 'system.attributes.movement.swim', type: 'upgrade', value: '@attributes.movement.walk' },
    ];
    const result = interpretPassiveEffects([{ source: sourceRef, effects: [{ disabled: false, transfer: true, system: { changes } }] }], '2024');

    expect(result.contributions).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.descriptiveKeys).toEqual([
      'system.attributes.movement.climb', 'system.attributes.movement.swim', 'system.attributes.movement.walk',
    ]);
    expect(changes.map((change) => classifyPassiveEffectChange(sourceRef, '2024', change.key, change.type, change.value))).toEqual(['descriptive', 'descriptive', 'descriptive']);
    const changedValue = interpretPassiveEffects([{ source: sourceRef, effects: [{ disabled: false, transfer: true, system: { changes: [{ ...changes[0]!, value: 15 }] } }] }], '2024');
    expect(changedValue.diagnostics).toMatchObject([{ key: 'system.attributes.movement.walk' }]);
    expect(classifyPassiveEffectChange(sourceRef, '2024', changes[0]!.key, changes[0]!.type, 15)).toBe('unsupported');
  });

  it('recognizes the pinned conditional Barbarian and Monk movement changes in both rulesets', () => {
    const cases = [
      { ruleset: '2014' as const, source: { sourcePath: 'packs/_source/classfeatures/barbarian/barbarian-features/fast-movement.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'Kl6zifJ5OmdHlOi2', name: 'Fast Movement' }, value: 10 },
      { ruleset: '2024' as const, source: { sourcePath: 'packs/_source/classes24/barbarian/class-features/fast-movement.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbbrbFastMoveme', name: 'Fast Movement' }, value: 10 },
      { ruleset: '2014' as const, source: { sourcePath: 'packs/_source/classfeatures/monk/monk-features/unarmored-movement.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'zCeqyQ8uIPNdYJSW', name: 'Unarmored Movement' }, value: '@scale.monk.unarmored-movement' },
      { ruleset: '2024' as const, source: { sourcePath: 'packs/_source/classes24/monk/class-features/unarmored-movement.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbmnkUnarmoredM', name: 'Unarmored Movement' }, value: '@scale.monk.unarmored-movement' },
    ];
    for (const { ruleset, source: sourceRef, value } of cases) {
      const effect = { disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.movement.walk', type: 'add', value }] } };
      const result = interpretPassiveEffects([{ source: sourceRef, effects: [effect] }], ruleset);
      expect(result.diagnostics).toEqual([]);
      expect(result.descriptiveKeys).toEqual(['system.attributes.movement.walk']);
      expect(classifyPassiveEffectChange(sourceRef, ruleset, 'system.attributes.movement.walk', 'add', value)).toBe('descriptive');
    }
  });

  it('interprets only the pinned stable Sorcerer, Ranger, and Druid source-backed effects', () => {
    const cases = [
      { source: { sourcePath: 'packs/_source/classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbscrDraconicRe', name: 'Draconic Resilience' }, key: 'system.attributes.hp.bonuses.overall', type: 'add', value: '@classes.sorcerer.levels', target: 'hit-points-per-level' },
      { source: { sourcePath: 'packs/_source/classes24/ranger/class-features/feral-senses.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbrgrFeralSense', name: 'Feral Senses' }, key: 'system.attributes.senses.blindsight', type: 'upgrade', value: 30, target: 'sense-blindsight' },
      { source: { sourcePath: 'packs/_source/classes24/druid/subclass-features/circle-of-land/natures-ward.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbdrdNaturesWar', name: "Nature's Ward" }, key: 'system.traits.ci.value', type: 'add', value: 'poison', target: 'condition-immunity' },
      { source: { sourcePath: 'packs/_source/classfeatures/druid/circle-of-the-land-features/natures-ward.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'OTvrJSJSUgAwXrWX', name: "Nature's Ward" }, key: 'system.traits.ci.value', type: 'add', value: 'diseased', target: 'condition-immunity' },
      { source: { sourcePath: 'packs/_source/classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbscrDraconicRe', name: 'Draconic Resilience' }, key: 'system.attributes.ac.calc', type: 'override', value: 'unarmoredBard', target: 'armor-class-calculation' },
      { source: { sourcePath: 'packs/_source/classfeatures/sorcerer/draconic-bloodline-features/draconic-resilience.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'MW1ExvBLm8Hg82aA', name: 'Draconic Resilience' }, key: 'system.attributes.ac.calc', type: 'override', value: 'draconic', target: 'armor-class-calculation' },
    ] as const;
    for (const item of cases) {
      const result = interpretPassiveEffects([{ source: item.source, effects: [{ disabled: false, transfer: true, system: { changes: [{ key: item.key, type: item.type, value: item.value }] } }] }], item.source.sourcePath.includes('classfeatures/') ? '2014' : '2024');
      expect(result.diagnostics, item.source.sourcePath).toEqual([]);
      expect(result.contributions.map(({ target }) => target), item.source.sourcePath).toContain(item.target);
    }
  });

  it('retains diagnostics for altered source formulas and values', () => {
    const draconic = { sourcePath: 'packs/_source/classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbscrDraconicRe', name: 'Draconic Resilience' };
    const changed = interpretPassiveEffects([{ source: draconic, effects: [{ disabled: false, transfer: true, system: { changes: [{ key: 'system.attributes.hp.bonuses.overall', type: 'add', value: '@abilities.con.mod' }] } }] }], '2024');
    expect(changed.contributions).toEqual([]);
    expect(changed.diagnostics).toMatchObject([{ key: 'system.attributes.hp.bonuses.overall' }]);
  });

  it('projects the pinned Diamond Soul, Jack of All Trades, and systematic advantage effects', () => {
    const cases = [
      { ruleset: '2024' as const, source: { sourcePath: 'packs/_source/classes24/monk/class-features/disciplined-survivor.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbmnkDiscipline', name: 'Disciplined Survivor' }, key: 'flags.dnd5e.diamondSoul', type: 'override', value: true, targets: ['saving-throw-proficiency'] },
      { ruleset: '2014' as const, source: { sourcePath: 'packs/_source/classfeatures/monk/monk-features/diamond-soul.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: '7D2EkLdISwShEDlN', name: 'Diamond Soul' }, key: 'flags.dnd5e.diamondSoul', type: 'override', value: true, targets: ['saving-throw-proficiency'] },
      { ruleset: '2024' as const, source: { sourcePath: 'packs/_source/classes24/bard/class-features/jack-of-all-trades.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbbrdJackOfAllT', name: 'Jack of All Trades' }, key: 'flags.dnd5e.jackOfAllTrades', type: 'override', value: true, targets: ['skill-check-bonus'] },
      { ruleset: '2014' as const, source: { sourcePath: 'packs/_source/classfeatures/bard/bard-features/jack-of-all-trades.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'ezWijmCnlnQ9ZRX2', name: 'Jack of All Trades' }, key: 'flags.dnd5e.jackOfAllTrades', type: 'override', value: true, targets: ['skill-check-bonus'] },
      { ruleset: '2024' as const, source: { sourcePath: 'packs/_source/classes24/barbarian/class-features/feral-instinct.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbbrbFeralInsti', name: 'Feral Instinct' }, key: 'system.attributes.init.roll.mode', type: 'add', value: 1, targets: ['initiative-advantage'] },
      { ruleset: '2014' as const, source: { sourcePath: 'packs/_source/classfeatures/barbarian/barbarian-features/feral-instinct.yml', pack: 'dnd5e.classfeatures', type: 'feat', id: 'NlXslw4yAqmKZWtN', name: 'Feral Instinct' }, key: 'system.attributes.init.roll.mode', type: 'add', value: 1, targets: ['initiative-advantage'] },
      { ruleset: '2024' as const, source: { sourcePath: 'packs/_source/classes24/fighter/subclass-features/champion/remarkable-athlete.yml', pack: 'dnd5e.classes24', type: 'feat', id: 'phbftrRemarkable', name: 'Remarkable Athlete' }, key: 'flags.dnd5e.remarkableAthlete', type: 'override', value: true, targets: ['initiative-advantage', 'skill-advantage'] },
    ];
    for (const { ruleset, source: sourceRef, key, type, value, targets } of cases) {
      const effect = { disabled: false, transfer: true, system: { changes: [{ key, type, value }] } };
      const result = interpretPassiveEffects([{ source: sourceRef, effects: [effect] }], ruleset);
      expect(result.contributions.map(({ target }) => target)).toEqual(targets);
      expect(result.diagnostics).toEqual([]);
      expect(classifyPassiveEffectChange(sourceRef, ruleset, key, type, value)).toBe('direct');
    }
  });

  it('classifies exact known conditional effects as descriptive without hiding changed variants', () => {
    const cases = [
      { ruleset: '2024' as const, path: 'classes24/rogue/subclass-features/thief/use-magic-device.yml', pack: 'dnd5e.classes24', id: 'phbrgeUseMagicDe', name: 'Use Magic Device', key: 'system.attributes.attunement.max', type: 'add', value: 1 },
      { ruleset: '2014' as const, path: 'races/orc/orc-features/savage-attacks.yml', pack: 'dnd5e.races', id: '0kUsT4sMUOr5FcoX', name: 'Savage Attacks', key: 'flags.dnd5e.meleeCriticalDamageDice', type: 'add', value: 1 },
      { ruleset: '2024' as const, path: 'classes24/rogue/class-features/reliable-talent.yml', pack: 'dnd5e.classes24', id: 'phbrgeReliableTa', name: 'Reliable Talent', key: 'flags.dnd5e.reliableTalent', type: 'override', value: true },
      { ruleset: '2014' as const, path: 'classfeatures/rogue/rogue-features/reliable-talent.yml', pack: 'dnd5e.classfeatures', id: 'YN9xm6MCvse4Y60u', name: 'Reliable Talent', key: 'flags.dnd5e.reliableTalent', type: 'override', value: true },
      { ruleset: '2024' as const, path: 'classes24/fighter/subclass-features/champion/improved-critical.yml', pack: 'dnd5e.classes24', id: 'phbftrImprovedCr', name: 'Improved Critical', key: 'flags.dnd5e.weaponCriticalThreshold', type: 'downgrade', value: 19 },
      { ruleset: '2024' as const, path: 'classes24/fighter/subclass-features/champion/superior-critical.yml', pack: 'dnd5e.classes24', id: 'phbftrSuperiorCr', name: 'Superior Critical', key: 'flags.dnd5e.weaponCriticalThreshold', type: 'downgrade', value: 18 },
      { ruleset: '2024' as const, path: 'classes24/paladin/class-features/aura-of-protection.yml', pack: 'dnd5e.classes24', id: 'phbpdnProtection', name: 'Aura of Protection', key: 'system.bonuses.abilities.save', type: 'add', value: '@abilities.cha.mod' },
      { ruleset: '2024' as const, path: 'classes24/paladin/class-features/radiant-strikes.yml', pack: 'dnd5e.classes24', id: 'phbpdnRadiantStr', name: 'Radiant Strikes', key: 'system.bonuses.mwak.damage', type: 'add', value: '1d8[radiant]' },
      { ruleset: '2014' as const, path: 'classfeatures/paladin/paladin-features/improved-divine-smite.yml', pack: 'dnd5e.classfeatures', id: 'FAk41RPCTcvCk6KI', name: 'Improved Divine Smite', key: 'system.bonuses.mwak.damage', type: 'add', value: '+1d8[Radiant]' },
      { ruleset: '2014' as const, path: 'classfeatures/shared-features/fighting-styles/dueling.yml', pack: 'dnd5e.classfeatures', id: 'hCop9uJrWhF1QPb4', name: 'Dueling', key: 'system.bonuses.mwak.damage', type: 'add', value: '+2' },
      { ruleset: '2024' as const, path: 'classes24/fighter/class-features/tactical-master.yml', pack: 'dnd5e.classes24', id: 'phbftrTacticalMa', name: 'Tactical Master', key: 'system.traits.weaponProf.mastery.bonus', type: 'add', value: 'push' },
      { ruleset: '2024' as const, path: 'classes24/fighter/class-features/tactical-master.yml', pack: 'dnd5e.classes24', id: 'phbftrTacticalMa', name: 'Tactical Master', key: 'system.traits.weaponProf.mastery.bonus', type: 'add', value: 'sap' },
      { ruleset: '2024' as const, path: 'classes24/fighter/class-features/tactical-master.yml', pack: 'dnd5e.classes24', id: 'phbftrTacticalMa', name: 'Tactical Master', key: 'system.traits.weaponProf.mastery.bonus', type: 'add', value: 'slow' },
      { ruleset: '2014' as const, path: 'classfeatures/warlock/the-fiend-features/fiendish-resilience.yml', pack: 'dnd5e.classfeatures', id: '9UZ2WjUF2k58CQug', name: 'Fiendish Resilience', key: 'system.traits.dr.custom', type: 'add', value: 'Fiendish Resilience' },
    ];
    for (const { ruleset, path, pack, id, name, key, type, value } of cases) {
      const sourceRef = { sourcePath: `packs/_source/${path}`, pack, type: 'feat', id, name };
      const result = interpretPassiveEffects([{ source: sourceRef, effects: [{ disabled: false, transfer: true, system: { changes: [{ key, type, value }] } }] }], ruleset);
      expect(result.contributions).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(result.descriptiveKeys).toEqual([key]);
      expect(classifyPassiveEffectChange(sourceRef, ruleset, key, type, value)).toBe('descriptive');
      expect(classifyPassiveEffectChange(sourceRef, ruleset, key, type, typeof value === 'number' ? value + 1 : 'changed')).toBe('unsupported');
    }
  });
});
