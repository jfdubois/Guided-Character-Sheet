import type { FoundrySourceReference } from './character-sources';
import type { CharacterRuleset } from './character-model';

export interface PassiveEffectInput { disabled?: unknown; transfer?: unknown; system?: unknown; }
export interface PassiveEffectSource { source: FoundrySourceReference; effects: unknown[]; }

interface ContributionBase { source: FoundrySourceReference; key: string; }
export type PassiveEffectContribution =
  | (ContributionBase & { target: 'initiative-proficiency'; operation: 'set-tier'; value: 'proficiency' })
  | (ContributionBase & { target: 'hit-points-per-level'; operation: 'add'; value: number })
  | (ContributionBase & { target: 'armor-class-calculation'; operation: 'set-calculation'; value: 'unarmoredBarb' | 'unarmoredMonk' })
  | (ContributionBase & { target: 'ranged-weapon-attack-bonus'; operation: 'add'; value: number })
  | (ContributionBase & { target: 'armor-proficiency' | 'weapon-proficiency'; operation: 'add'; value: string })
  | (ContributionBase & { target: 'cantrip-capacity'; operation: 'add'; value: number })
  | (ContributionBase & { target: 'skill-check-bonus'; operation: 'add-minimum-ability-modifier'; value: { skill: 'arc' | 'rel' | 'nat'; ability: 'wis'; minimum: 1 } })
  | (ContributionBase & { target: 'sense-darkvision' | 'sense-truesight'; operation: 'upgrade'; value: number });

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
        const classification = classifyPassiveEffectKey(key);
        if (classification === 'descriptive') { descriptive.add(key); continue; }
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
        } else if (key === 'system.attributes.ac.calc') {
          if (rawChange.type !== 'override' || (rawChange.value !== 'unarmoredBarb' && rawChange.value !== 'unarmoredMonk')) { diagnostic(source, key, `Unsupported AC calculation from ${source.name}: ${String(rawChange.value)}.`); continue; }
          contribution = { source, key, target: 'armor-class-calculation', operation: 'set-calculation', value: rawChange.value };
        } else if (key === 'system.bonuses.rwak.attack') {
          if (rawChange.type !== 'add' || typeof rawChange.value !== 'number' || !Number.isFinite(rawChange.value)) { diagnostic(source, key, `Malformed direct passive effect from ${source.name}: ${key}.`); continue; }
          contribution = { source, key, target: 'ranged-weapon-attack-bonus', operation: 'add', value: rawChange.value };
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

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
