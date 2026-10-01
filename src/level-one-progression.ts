import type { ClassScaleValueSummary, ClassSourceSummary } from './character-sources';
import { isRecord } from './foundry-utils';

export interface LevelOneSpellProgression {
  spellcastingAbility?: string;
  cantripsKnown?: number;
  learnedSpells?: number;
  spellbookSpells?: number;
  preparedSpells?: number;
  spellLists: string[];
  spellSlots?: Array<{ level: number; maximum: number }>;
  diagnostics?: string[];
}

export interface LevelOneClassProgression {
  classIdentifier: string;
  level: 1;
  proficiencyBonus: number;
  spellcasting?: LevelOneSpellProgression;
  scales: ClassScaleValueSummary[];
}

export function evaluateScaleAtLevel<T>(scale: ReadonlyMap<number, T>, level: number): T | undefined {
  if (!Number.isInteger(level) || level < 1) return undefined;
  let bestThreshold: number | undefined;
  let result: T | undefined;
  for (const [threshold, value] of scale) if (threshold <= level && (bestThreshold === undefined || threshold > bestThreshold)) {
    bestThreshold = threshold;
    result = value;
  }
  return result;
}

export function getLevelOneClassProgression(summary: ClassSourceSummary): LevelOneClassProgression {
  const sourceSpellcasting = summary.spellcasting;
  const featureText = [summary.description ?? '', ...(summary.features?.map((feature) => feature.description ?? '') ?? [])].join(' ');
  const diagnostics: string[] = [];
  const number = (pattern: RegExp, label: string): number | undefined => {
    const match = featureText.match(pattern);
    if (match?.[1] === undefined) return undefined;
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
    const value = words[match[1].toLowerCase()] ?? Number(match[1]);
    if (!Number.isInteger(value) || value < 0) diagnostics.push(`Unable to determine ${label} from class source text.`);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  };
  const numeric = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';
  const cantripsKnown = typeof sourceSpellcasting?.cantripsKnown === 'number' ? sourceSpellcasting.cantripsKnown : number(new RegExp(`(?:know|known)\\s+${numeric}\\s+(?:[A-Za-z]+\\s+)?cantrips`, 'i'), 'cantrip count');
  const spellbookSpells = typeof sourceSpellcasting?.spellbookSpells === 'number' ? sourceSpellcasting.spellbookSpells : number(new RegExp(`(?:contain(?:ing|s)|starts with)\\s+${numeric}\\s+(?:1st[- ]level|level 1)`, 'i'), 'spellbook count');
  const learnedSpells = typeof sourceSpellcasting?.learnedSpells === 'number' ? sourceSpellcasting.learnedSpells : number(new RegExp(`choose\\s+${numeric}\\s+(?:(?:(?:1st[- ]level|level\\s+1\\+?)\\s+)?spells?\\s+from (?:the|your)\\s+[A-Za-z]+\\s+spell list|(?:1st[- ]level|level\\s+1\\+?)\\s+[A-Za-z]+\\s+spells?)`, 'i'), 'known-spell count');
  const preparedSpells = typeof sourceSpellcasting?.preparedSpells === 'number' ? sourceSpellcasting.preparedSpells : number(new RegExp(`choose\\s+${numeric}\\s+spells\\s+from your spellbook`, 'i'), 'prepared-spell capacity');
  const explicitSpellSlots = isRecord(sourceSpellcasting?.spellSlots) ? Object.entries(sourceSpellcasting.spellSlots).flatMap(([level, maximum]) => typeof maximum === 'number' && Number.isInteger(maximum) && maximum >= 0 && Number.isInteger(Number(level)) && Number(level) >= 1 ? [{ level: Number(level), maximum }] : []) : undefined;
  // The 2024 class records expose the authoritative progression kind while the
  // level-one slot table is represented in the linked class feature content.
  // Keep this adapter limited to the initial level supported by character creation.
  const spellSlots = explicitSpellSlots ?? (featureText.length > 0 && sourceSpellcasting?.progression === 'full' ? [{ level: 1, maximum: 2 }] : undefined);
  const spellcasting = sourceSpellcasting === undefined ? undefined : {
    ...(typeof sourceSpellcasting.ability === 'string' ? { spellcastingAbility: ({ int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' } as Record<string, string>)[sourceSpellcasting.ability] ?? sourceSpellcasting.ability } : {}),
    ...(cantripsKnown === undefined ? {} : { cantripsKnown }),
    ...(learnedSpells === undefined ? {} : { learnedSpells }),
    ...(spellbookSpells === undefined ? {} : { spellbookSpells }),
    ...(preparedSpells === undefined ? {} : { preparedSpells }),
    spellLists: Array.isArray(sourceSpellcasting.spellLists) ? sourceSpellcasting.spellLists.filter((value): value is string => typeof value === 'string') : [],
    ...(spellSlots === undefined ? {} : { spellSlots }), ...(diagnostics.length === 0 ? {} : { diagnostics: [...diagnostics] }),
  };
  return { classIdentifier: summary.source.identifier ?? '', level: 1, proficiencyBonus: 2, ...(spellcasting === undefined ? {} : { spellcasting }), scales: summary.scales?.map((scale) => {
    const selectedValue = evaluateScaleAtLevel(scale.values, 1);
    const { value: _numericValue, ...scaleSummary } = scale;
    return { ...scaleSummary, ...(selectedValue?.type === 'number' ? { value: selectedValue.value } : {}) };
  }) ?? [] };
}
