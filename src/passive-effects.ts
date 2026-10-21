import type { FoundrySourceReference } from './character-sources';
import type { CharacterRuleset } from './character-model';

export interface PassiveEffectInput { disabled?: unknown; transfer?: unknown; system?: unknown; }
export interface PassiveEffectSource { source: FoundrySourceReference; effects: unknown[]; }

interface ContributionBase { source: FoundrySourceReference; key: string; }
export type PassiveEffectContribution =
  | (ContributionBase & { target: 'initiative-proficiency'; operation: 'set-tier'; value: 'proficiency' })
  | (ContributionBase & { target: 'hit-points-per-level'; operation: 'add'; value: number })
  | (ContributionBase & { target: 'armor-class-calculation'; operation: 'set-calculation'; value: 'unarmoredBarb' | 'unarmoredMonk' | 'unarmoredBard' | 'draconic' })
  | (ContributionBase & { target: 'ranged-weapon-attack-bonus'; operation: 'add'; value: number })
  | (ContributionBase & { target: 'armor-proficiency' | 'weapon-proficiency'; operation: 'add'; value: string })
  | (ContributionBase & { target: 'cantrip-capacity'; operation: 'add'; value: number })
  | (ContributionBase & { target: 'skill-check-bonus'; operation: 'add-minimum-ability-modifier'; value: { skill: 'arc' | 'rel' | 'nat'; ability: 'wis'; minimum: 1 } })
  | (ContributionBase & { target: 'skill-check-bonus'; operation: 'add-half-proficiency-if-untrained'; value: true })
  | (ContributionBase & { target: 'saving-throw-proficiency'; operation: 'add-all'; value: true })
  | (ContributionBase & { target: 'initiative-advantage'; operation: 'annotate'; value: true })
  | (ContributionBase & { target: 'skill-advantage'; operation: 'annotate'; value: 'ath' })
  | (ContributionBase & { target: 'movement-speed'; operation: 'equal-to-walk'; value: 'climb' })
  | (ContributionBase & { target: 'sense-darkvision' | 'sense-truesight' | 'sense-blindsight'; operation: 'upgrade'; value: number })
  | (ContributionBase & { target: 'condition-immunity'; operation: 'add'; value: string });

export interface PassiveEffectDiagnostic { source: FoundrySourceReference; key?: string; message: string; }
export interface PassiveEffectResult { contributions: PassiveEffectContribution[]; diagnostics: PassiveEffectDiagnostic[]; descriptiveKeys: string[]; }
export type PassiveEffectKeyClass = 'direct' | 'descriptive' | 'unsupported' | 'unclassified';

const directKeys = new Set([
  'flags.dnd5e.initiativeAlert',
  'system.attributes.hp.bonuses.level',
  'system.attributes.ac.calc',
  'system.bonuses.rwak.attack',
  'system.traits.armorProf.value',
  'system.traits.weaponProf.value',
  'system.scale.cleric.cantrips-known.value',
  'system.scale.druid.cantrips-known',
  'system.attributes.senses.darkvision',
  'system.attributes.senses.truesight',
]);

const descriptiveKeys = new Set([
  'flags.dnd5e.halflingLucky',
  'flags.dnd5e.halflingNimbleness',
  'flags.dnd5e.powerfulBuild',
  'system.attributes.ac.bonus',
  'system.attributes.concentration.roll.mode',
]);

export function classifyPassiveEffectKey(key: string): PassiveEffectKeyClass {
  if (directKeys.has(key) || /^system\.skills\.(arc|rel|nat)\.bonuses\.check$/.test(key)) return 'direct';
  if (descriptiveKeys.has(key) || /^system\.abilities\.(str|dex|con|int|wis|cha)\.save\.roll\.mode$/.test(key)) return 'descriptive';
  if (key.startsWith('system.') || key.startsWith('flags.dnd5e.')) return 'unsupported';
  return 'unclassified';
}

export function classifyPassiveEffectChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): PassiveEffectKeyClass {
  if (isDraconicSorceryHpChange(source, ruleset, key, operation, value)
    || isDraconicSorceryAcChange(source, ruleset, key, operation, value)
    || isDraconicBloodlineAcChange(source, ruleset, key, operation, value)
    || isFeralSensesBlindsightChange(source, ruleset, key, operation, value)
    || isNaturesWardImmunityChange(source, ruleset, key, operation, value)) return 'direct';
  if (phaseThreeContributions(source, ruleset, key, operation, value).length > 0) return 'direct';
  if (isKnownPhaseThreeDescriptiveChange(source, ruleset, key, operation, value)) return 'descriptive';
  if (!isRecognizedMovementChange(source, ruleset, key, operation, value)) return classifyPassiveEffectKey(key);
  return source.sourcePath.endsWith('/rogue/subclass-features/thief/second-story-work.yml') ? 'direct' : 'descriptive';
}

export function interpretPassiveEffects(sources: PassiveEffectSource[], ruleset: CharacterRuleset): PassiveEffectResult {
  const contributions: PassiveEffectContribution[] = [];
  const diagnostics: PassiveEffectDiagnostic[] = [];
  const descriptive = new Set<string>();
  const seen = new Set<string>();
  let initiativeProficiencyAdded = false;
  const diagnostic = (source: FoundrySourceReference, key: string | undefined, message: string): void => { diagnostics.push({ source, ...(key === undefined ? {} : { key }), message }); };
  for (const { source, effects } of sources) {
    for (const [effectIndex, rawEffect] of effects.entries()) {
      if (!isRecord(rawEffect)) { diagnostic(source, undefined, `Malformed passive effect from ${source.name}.`); continue; }
      if (typeof rawEffect.disabled !== 'boolean') { diagnostic(source, undefined, `Malformed disabled state in passive effect from ${source.name}.`); continue; }
      if (typeof rawEffect.transfer !== 'boolean') { diagnostic(source, undefined, `Malformed transfer state in passive effect from ${source.name}.`); continue; }
      if (rawEffect.disabled || !rawEffect.transfer) continue;
      if (!isRecord(rawEffect.system) || !Array.isArray(rawEffect.system.changes)) { diagnostic(source, undefined, `Malformed changes in passive effect from ${source.name}.`); continue; }
      for (const [changeIndex, rawChange] of rawEffect.system.changes.entries()) {
        if (!isRecord(rawChange) || typeof rawChange.key !== 'string' || rawChange.key.trim().length === 0) {
          diagnostic(source, undefined, `Malformed passive effect change from ${source.name}.`);
          continue;
        }
        const key = rawChange.key;
        const classification = classifyPassiveEffectChange(source, ruleset, key, rawChange.type, rawChange.value);
        const phaseThree = phaseThreeContributions(source, ruleset, key, rawChange.type, rawChange.value);
        if (phaseThree.length > 0) {
          const effectId = typeof rawEffect._id === 'string' ? rawEffect._id : `effect:${effectIndex}`;
          const changeId = typeof rawChange._id === 'string' ? rawChange._id : `change:${changeIndex}`;
          for (const contribution of phaseThree) {
            const identity = `${source.sourcePath}\u0000${source.pack}\u0000${source.type}\u0000${source.id}\u0000${effectId}\u0000${changeId}\u0000${contribution.target}`;
            if (seen.has(identity)) continue;
            seen.add(identity);
            contributions.push(contribution);
          }
          continue;
        }
        if (classification === 'descriptive') { descriptive.add(key); continue; }
        if (classification === 'direct' && key === 'system.attributes.movement.climb' && source.sourcePath.endsWith('/rogue/subclass-features/thief/second-story-work.yml')) {
          const effectId = typeof rawEffect._id === 'string' ? rawEffect._id : `effect:${effectIndex}`;
          const changeId = typeof rawChange._id === 'string' ? rawChange._id : `change:${changeIndex}`;
          const identity = `${source.sourcePath}\u0000${source.pack}\u0000${source.type}\u0000${source.id}\u0000${effectId}\u0000${changeId}`;
          if (!seen.has(identity)) {
            seen.add(identity);
            contributions.push({ source, key, target: 'movement-speed', operation: 'equal-to-walk', value: 'climb' });
          }
          continue;
        }
        if (classification === 'unclassified' || classification === 'unsupported') {
          diagnostic(source, key, `Unsupported passive effect change from ${source.name}: ${key}.`);
          continue;
        }
        let contribution: PassiveEffectContribution | undefined;
        if (key === 'flags.dnd5e.initiativeAlert') {
          if (ruleset !== '2024') { diagnostic(source, key, `Unsupported ruleset for passive effect from ${source.name}: ${key}.`); continue; }
          if (rawChange.type !== 'add' || rawChange.value !== true) { diagnostic(source, key, `Malformed direct passive effect from ${source.name}: ${key}.`); continue; }
          contribution = { source, key, target: 'initiative-proficiency', operation: 'set-tier', value: 'proficiency' };
        } else if (key === 'system.attributes.hp.bonuses.level') {
          if (rawChange.type !== 'add' || typeof rawChange.value !== 'number' || !Number.isFinite(rawChange.value)) { diagnostic(source, key, `Malformed direct passive effect from ${source.name}: ${key}.`); continue; }
          contribution = { source, key, target: 'hit-points-per-level', operation: 'add', value: rawChange.value };
        } else if (isDraconicSorceryHpChange(source, ruleset, key, rawChange.type, rawChange.value)) {
          contribution = { source, key, target: 'hit-points-per-level', operation: 'add', value: 1 };
        } else if (isDraconicSorceryAcChange(source, ruleset, key, rawChange.type, rawChange.value)) {
          contribution = { source, key, target: 'armor-class-calculation', operation: 'set-calculation', value: 'unarmoredBard' };
        } else if (isDraconicBloodlineAcChange(source, ruleset, key, rawChange.type, rawChange.value)) {
          contribution = { source, key, target: 'armor-class-calculation', operation: 'set-calculation', value: 'draconic' };
        } else if (isFeralSensesBlindsightChange(source, ruleset, key, rawChange.type, rawChange.value)) {
          contribution = { source, key, target: 'sense-blindsight', operation: 'upgrade', value: 30 };
        } else if (isNaturesWardImmunityChange(source, ruleset, key, rawChange.type, rawChange.value)) {
          contribution = { source, key, target: 'condition-immunity', operation: 'add', value: rawChange.value as string };
        } else if (key === 'system.attributes.ac.calc') {
          if (rawChange.type !== 'override' || (rawChange.value !== 'unarmoredBarb' && rawChange.value !== 'unarmoredMonk')) { diagnostic(source, key, `Unsupported AC calculation from ${source.name}: ${String(rawChange.value)}.`); continue; }
          contribution = { source, key, target: 'armor-class-calculation', operation: 'set-calculation', value: rawChange.value };
        } else if (key === 'system.bonuses.rwak.attack') {
          const bonus = typeof rawChange.value === 'number' ? rawChange.value
            : typeof rawChange.value === 'string' && /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(rawChange.value) ? Number(rawChange.value) : Number.NaN;
          if (rawChange.type !== 'add' || !Number.isFinite(bonus)) { diagnostic(source, key, `Malformed direct passive effect from ${source.name}: ${key}.`); continue; }
          contribution = { source, key, target: 'ranged-weapon-attack-bonus', operation: 'add', value: bonus };
        } else if (key === 'system.traits.armorProf.value' || key === 'system.traits.weaponProf.value') {
          const values = key === 'system.traits.armorProf.value' ? ['med', 'hvy'] : ['mar'];
          if (rawChange.type !== 'add' || typeof rawChange.value !== 'string' || !values.includes(rawChange.value)) { diagnostic(source, key, `Malformed direct passive effect from ${source.name}: ${key}.`); continue; }
          contribution = { source, key, target: key === 'system.traits.armorProf.value' ? 'armor-proficiency' : 'weapon-proficiency', operation: 'add', value: rawChange.value };
        } else if (key === 'system.scale.cleric.cantrips-known.value' || key === 'system.scale.druid.cantrips-known') {
          if (rawChange.type !== 'add' || rawChange.value !== 1) { diagnostic(source, key, `Malformed direct passive effect from ${source.name}: ${key}.`); continue; }
          contribution = { source, key, target: 'cantrip-capacity', operation: 'add', value: 1 };
        } else if (/^system\.skills\.(arc|rel|nat)\.bonuses\.check$/.test(key)) {
          const match = /^system\.skills\.(arc|rel|nat)\.bonuses\.check$/.exec(key)!;
          if (rawChange.type !== 'add' || rawChange.value !== '(max(1,@abilities.wis.mod))') { diagnostic(source, key, `Unsupported skill bonus formula from ${source.name}: ${String(rawChange.value)}.`); continue; }
          contribution = { source, key, target: 'skill-check-bonus', operation: 'add-minimum-ability-modifier', value: { skill: match[1] as 'arc' | 'rel' | 'nat', ability: 'wis', minimum: 1 } };
        } else if (key === 'system.attributes.senses.darkvision' || key === 'system.attributes.senses.truesight') {
          if (rawChange.type !== 'upgrade' || typeof rawChange.value !== 'number' || !Number.isFinite(rawChange.value) || rawChange.value <= 0) { diagnostic(source, key, `Malformed direct passive effect from ${source.name}: ${key}.`); continue; }
          contribution = { source, key, target: key === 'system.attributes.senses.darkvision' ? 'sense-darkvision' : 'sense-truesight', operation: 'upgrade', value: rawChange.value };
        }
        if (contribution === undefined) continue;
        const effectId = typeof rawEffect._id === 'string' ? rawEffect._id : `effect:${effectIndex}`;
        const changeId = typeof rawChange._id === 'string' ? rawChange._id : `change:${changeIndex}`;
        const identity = `${source.sourcePath}\u0000${source.pack}\u0000${source.type}\u0000${source.id}\u0000${effectId}\u0000${changeId}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (contribution.target === 'initiative-proficiency') {
          if (initiativeProficiencyAdded) continue;
          initiativeProficiencyAdded = true;
        }
        contributions.push(contribution);
      }
    }
  }
  return { contributions, diagnostics, descriptiveKeys: [...descriptive].sort() };
}

/** Returns the source-backed Draconic Resilience HP-per-Sorcerer-level modifier from already eligible class features. */
export function draconicSorceryHitPointsPerLevel(sources: PassiveEffectSource[], ruleset: CharacterRuleset): number {
  let total = 0;
  for (const effect of interpretPassiveEffects(sources, ruleset).contributions) {
    if (effect.target === 'hit-points-per-level' && effect.source.sourcePath === 'packs/_source/classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml') total += effect.value;
  }
  return total;
}

function hasSource(source: FoundrySourceReference, ruleset: CharacterRuleset, path: string, pack: string, id: string): boolean {
  return ruleset === (path.startsWith('classes24/') ? '2024' : '2014')
    && source.sourcePath === `packs/_source/${path}` && source.pack === pack && source.type === 'feat' && source.id === id;
}

function isDraconicSorceryHpChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return hasSource(source, ruleset, 'classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml', 'dnd5e.classes24', 'phbscrDraconicRe')
    && key === 'system.attributes.hp.bonuses.overall' && operation === 'add' && value === '@classes.sorcerer.levels';
}
function isDraconicSorceryAcChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return hasSource(source, ruleset, 'classes24/sorcerer/subclass-features/draconic-sorcery/draconic-resilience.yml', 'dnd5e.classes24', 'phbscrDraconicRe')
    && key === 'system.attributes.ac.calc' && operation === 'override' && value === 'unarmoredBard';
}
function isDraconicBloodlineAcChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return hasSource(source, ruleset, 'classfeatures/sorcerer/draconic-bloodline-features/draconic-resilience.yml', 'dnd5e.classfeatures', 'MW1ExvBLm8Hg82aA')
    && key === 'system.attributes.ac.calc' && operation === 'override' && value === 'draconic';
}
function isFeralSensesBlindsightChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return hasSource(source, ruleset, 'classes24/ranger/class-features/feral-senses.yml', 'dnd5e.classes24', 'phbrgrFeralSense')
    && key === 'system.attributes.senses.blindsight' && operation === 'upgrade' && value === 30;
}
function isNaturesWardImmunityChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  const current = hasSource(source, ruleset, 'classes24/druid/subclass-features/circle-of-land/natures-ward.yml', 'dnd5e.classes24', 'phbdrdNaturesWar') && value === 'poison';
  const legacy = hasSource(source, ruleset, 'classfeatures/druid/circle-of-the-land-features/natures-ward.yml', 'dnd5e.classfeatures', 'OTvrJSJSUgAwXrWX') && (value === 'diseased' || value === 'poisoned');
  return (current || legacy) && key === 'system.traits.ci.value' && operation === 'add';
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function phaseThreeContributions(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): PassiveEffectContribution[] {
  if (isDiamondSoulChange(source, ruleset, key, operation, value)) {
    return [{ source, key, target: 'saving-throw-proficiency', operation: 'add-all', value: true }];
  }
  if (isJackOfAllTradesChange(source, ruleset, key, operation, value)) {
    return [{ source, key, target: 'skill-check-bonus', operation: 'add-half-proficiency-if-untrained', value: true }];
  }
  if (isFeralInstinctInitiativeChange(source, ruleset, key, operation, value)) {
    return [{ source, key, target: 'initiative-advantage', operation: 'annotate', value: true }];
  }
  if (isRemarkableAthleteChange(source, ruleset, key, operation, value)) {
    return [
      { source, key, target: 'initiative-advantage', operation: 'annotate', value: true },
      { source, key, target: 'skill-advantage', operation: 'annotate', value: 'ath' },
    ];
  }
  return [];
}

function isDiamondSoulChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return key === 'flags.dnd5e.diamondSoul' && operation === 'override' && value === true
    && (hasPhaseThreeSource(source, ruleset, 'classes24/monk/class-features/disciplined-survivor.yml', 'dnd5e.classes24', 'phbmnkDiscipline', '2024')
      || hasPhaseThreeSource(source, ruleset, 'classfeatures/monk/monk-features/diamond-soul.yml', 'dnd5e.classfeatures', '7D2EkLdISwShEDlN', '2014'));
}

function isJackOfAllTradesChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return key === 'flags.dnd5e.jackOfAllTrades' && operation === 'override' && value === true
    && (hasPhaseThreeSource(source, ruleset, 'classes24/bard/class-features/jack-of-all-trades.yml', 'dnd5e.classes24', 'phbbrdJackOfAllT', '2024')
      || hasPhaseThreeSource(source, ruleset, 'classfeatures/bard/bard-features/jack-of-all-trades.yml', 'dnd5e.classfeatures', 'ezWijmCnlnQ9ZRX2', '2014'));
}

function isFeralInstinctInitiativeChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return key === 'system.attributes.init.roll.mode' && operation === 'add' && value === 1
    && (hasPhaseThreeSource(source, ruleset, 'classes24/barbarian/class-features/feral-instinct.yml', 'dnd5e.classes24', 'phbbrbFeralInsti', '2024')
      || hasPhaseThreeSource(source, ruleset, 'classfeatures/barbarian/barbarian-features/feral-instinct.yml', 'dnd5e.classfeatures', 'NlXslw4yAqmKZWtN', '2014'));
}

function isRemarkableAthleteChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  return ruleset === '2024' && key === 'flags.dnd5e.remarkableAthlete' && operation === 'override' && value === true
    && source.sourcePath === 'packs/_source/classes24/fighter/subclass-features/champion/remarkable-athlete.yml'
    && source.pack === 'dnd5e.classes24' && source.type === 'feat' && source.id === 'phbftrRemarkable';
}

function hasPhaseThreeSource(source: FoundrySourceReference, ruleset: CharacterRuleset, path: string, pack: string, id: string, sourceRuleset: CharacterRuleset): boolean {
  return ruleset === sourceRuleset && source.sourcePath === `packs/_source/${path}` && source.pack === pack && source.type === 'feat' && source.id === id;
}

function isKnownPhaseThreeDescriptiveChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, operation: unknown, value: unknown): boolean {
  const known = (path: string, pack: string, id: string, sourceRuleset: CharacterRuleset, expectedKey: string, expectedOperation: unknown, expectedValue: unknown): boolean =>
    hasPhaseThreeSource(source, ruleset, path, pack, id, sourceRuleset) && key === expectedKey && operation === expectedOperation && value === expectedValue;
  return known('classes24/rogue/subclass-features/thief/use-magic-device.yml', 'dnd5e.classes24', 'phbrgeUseMagicDe', '2024', 'system.attributes.attunement.max', 'add', 1)
    || known('races/orc/orc-features/savage-attacks.yml', 'dnd5e.races', '0kUsT4sMUOr5FcoX', '2014', 'flags.dnd5e.meleeCriticalDamageDice', 'add', 1)
    || known('classes24/rogue/class-features/reliable-talent.yml', 'dnd5e.classes24', 'phbrgeReliableTa', '2024', 'flags.dnd5e.reliableTalent', 'override', true)
    || known('classfeatures/rogue/rogue-features/reliable-talent.yml', 'dnd5e.classfeatures', 'YN9xm6MCvse4Y60u', '2014', 'flags.dnd5e.reliableTalent', 'override', true)
    || known('classes24/fighter/subclass-features/champion/improved-critical.yml', 'dnd5e.classes24', 'phbftrImprovedCr', '2024', 'flags.dnd5e.weaponCriticalThreshold', 'downgrade', 19)
    || known('classes24/fighter/subclass-features/champion/superior-critical.yml', 'dnd5e.classes24', 'phbftrSuperiorCr', '2024', 'flags.dnd5e.weaponCriticalThreshold', 'downgrade', 18)
    || known('classes24/paladin/class-features/aura-of-protection.yml', 'dnd5e.classes24', 'phbpdnProtection', '2024', 'system.bonuses.abilities.save', 'add', '@abilities.cha.mod')
    || known('classes24/paladin/class-features/radiant-strikes.yml', 'dnd5e.classes24', 'phbpdnRadiantStr', '2024', 'system.bonuses.mwak.damage', 'add', '1d8[radiant]')
    || known('classfeatures/paladin/paladin-features/improved-divine-smite.yml', 'dnd5e.classfeatures', 'FAk41RPCTcvCk6KI', '2014', 'system.bonuses.mwak.damage', 'add', '+1d8[Radiant]')
    || known('classfeatures/shared-features/fighting-styles/dueling.yml', 'dnd5e.classfeatures', 'hCop9uJrWhF1QPb4', '2014', 'system.bonuses.mwak.damage', 'add', '+2')
    || ['push', 'sap', 'slow'].some((property) => known('classes24/fighter/class-features/tactical-master.yml', 'dnd5e.classes24', 'phbftrTacticalMa', '2024', 'system.traits.weaponProf.mastery.bonus', 'add', property))
    || known('classfeatures/warlock/the-fiend-features/fiendish-resilience.yml', 'dnd5e.classfeatures', '9UZ2WjUF2k58CQug', '2014', 'system.traits.dr.custom', 'add', 'Fiendish Resilience');
}

/**
 * Recognizes only pinned movement changes whose conditional rules remain in
 * the feature description. These are intentionally descriptive until the
 * sheet can resolve their armor and shield conditions.
 */
function isRecognizedMovementChange(source: FoundrySourceReference, ruleset: CharacterRuleset, key: string, type: unknown, value: unknown): boolean {
  const relativePath = source.sourcePath.replace(/^packs\/_source\//, '');
  if (ruleset === '2024'
    && relativePath === 'classes24/rogue/subclass-features/thief/second-story-work.yml'
    && source.id === 'phbrgeSecondstor' && source.type === 'feat' && source.pack === 'dnd5e.classes24') {
    return key === 'system.attributes.movement.climb' && type === 'upgrade' && value === '@attributes.movement.speed';
  }
  if (ruleset === '2024' && relativePath === 'classes24/ranger/class-features/roving.yml'
    && source.id === 'phbrgrRoving0000' && source.type === 'feat' && source.pack === 'dnd5e.classes24') {
    return key === 'system.attributes.movement.walk' && type === 'add' && value === 10
      || (key === 'system.attributes.movement.climb' || key === 'system.attributes.movement.swim') && type === 'upgrade' && value === '@attributes.movement.walk';
  }
  if ((ruleset === '2014' && relativePath === 'classfeatures/barbarian/barbarian-features/fast-movement.yml'
      || ruleset === '2024' && relativePath === 'classes24/barbarian/class-features/fast-movement.yml')
    && source.name === 'Fast Movement' && source.type === 'feat') {
    return key === 'system.attributes.movement.walk' && type === 'add' && value === 10;
  }
  if ((ruleset === '2014' && relativePath === 'classfeatures/monk/monk-features/unarmored-movement.yml'
      || ruleset === '2024' && relativePath === 'classes24/monk/class-features/unarmored-movement.yml')
    && source.name === 'Unarmored Movement' && source.type === 'feat') {
    return key === 'system.attributes.movement.walk' && type === 'add' && value === '@scale.monk.unarmored-movement';
  }
  return false;
}
