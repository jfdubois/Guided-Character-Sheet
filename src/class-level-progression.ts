import type { ClassSourceSummary, FoundrySourceReference } from './character-sources';
import type { ClassProgressionSelection } from './class-configuration';
import type { CharacterDocument } from './character-model';
import { evaluateScaleAtLevel, getLevelOneClassProgression, type LevelOneSpellSlot } from './level-one-progression';
import { isRecord } from './foundry-utils';

export interface ClassLevelProgressionProjection {
  spellcasting?: {
    spellSlots: LevelOneSpellSlot[];
    cantripsKnown?: number;
    learnedSpells?: number;
    spellbookSpells?: number;
    preparedCapacity?: number;
  };
  diagnostics: string[];
}

export interface ClassLevelProgressionContext {
  abilityModifiers?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
}

/** Creates a temporary lower-level document without retaining inactive choices or HP entries. */
export function projectClassLevelPreviewDocument(document: CharacterDocument, summary: ClassSourceSummary, targetLevel: number): CharacterDocument {
  const savedProgression = document.classProgressions?.find((progression) => progression.class.sourcePath === summary.source.sourcePath);
  if (savedProgression === undefined) throw new Error(`No saved class progression for ${summary.source.sourcePath}.`);
  if (targetLevel > savedProgression.targetLevel) throw new Error('A higher-level preview requires HP history and cannot be projected as a character document.');
  const progression = trimClassProgression(savedProgression, summary, targetLevel);
  const classProgressions = document.classProgressions!.map((entry) => entry.class.sourcePath === summary.source.sourcePath ? progression : structuredClone(entry));
  const classHitPoints = document.classHitPoints?.filter((entry) => entry.classSourcePath !== summary.source.sourcePath || entry.level <= targetLevel);
  return {
    ...document,
    classProgressions,
    ...(classHitPoints === undefined ? {} : { classHitPoints }),
  };
}

const SPELL_SLOT_TABLE: readonly (readonly number[])[] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
const PACT_TABLE: readonly { level: number; slots: number }[] = [
  { level: 1, slots: 1 }, { level: 1, slots: 2 }, { level: 2, slots: 2 }, { level: 2, slots: 2 },
  { level: 3, slots: 2 }, { level: 3, slots: 2 }, { level: 4, slots: 2 }, { level: 4, slots: 2 },
  { level: 5, slots: 2 }, { level: 5, slots: 2 }, { level: 5, slots: 3 }, { level: 5, slots: 3 },
  { level: 5, slots: 3 }, { level: 5, slots: 3 }, { level: 5, slots: 3 }, { level: 5, slots: 3 },
  { level: 5, slots: 4 }, { level: 5, slots: 4 }, { level: 5, slots: 4 }, { level: 5, slots: 4 },
];

export function projectClassLevelProgression(summary: ClassSourceSummary, targetLevel: number, context: ClassLevelProgressionContext = {}): ClassLevelProgressionProjection {
  const diagnostics: string[] = [];
  const source = summary.spellcasting;
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 20) {
    return { diagnostics: [`Invalid class level ${targetLevel} at ${summary.source.sourcePath}.`] };
  }
  if (source === undefined) return { diagnostics };
  const progression = source.progression;
  const kind = progression === 'pact' ? 'pact' : 'spell';
  let spellSlots: LevelOneSpellSlot[] | undefined;
  if (source.spellSlots !== undefined) {
    if (!isRecord(source.spellSlots)) {
      diagnostics.push(`Malformed class spell-slot table at ${summary.source.sourcePath}.`);
      return { diagnostics };
    }
    const entries = Object.entries(source.spellSlots);
    if (entries.some(([level, maximum]) => !/^[1-9]$/.test(level) || typeof maximum !== 'number' || !Number.isInteger(maximum) || maximum < 0)) {
      diagnostics.push(`Malformed class spell-slot table at ${summary.source.sourcePath}.`);
      return { diagnostics };
    }
    spellSlots = entries.map(([level, maximum]) => ({ key: `${kind}:${level}`, kind, level: Number(level), maximum: maximum as number, recovery: kind === 'pact' ? ['short-rest', 'long-rest'] : ['long-rest'] }));
  } else if (progression === 'pact') {
    const tableEntry = PACT_TABLE[targetLevel - 1];
    if (tableEntry) spellSlots = [{ key: `pact:${tableEntry.level}`, kind: 'pact', level: tableEntry.level, maximum: tableEntry.slots, recovery: ['short-rest', 'long-rest'] }];
  } else if (progression === 'full' || progression === 'half' || progression === 'third' || progression === 'artificer') {
    const divisor = progression === 'full' ? 1 : progression === 'third' ? 3 : 2;
    const casterLevel = progression === 'full' ? targetLevel : progression === 'third' ? Math.floor(targetLevel / divisor) : Math.ceil(targetLevel / divisor);
    if (casterLevel === 0) spellSlots = [];
    else {
      const row = SPELL_SLOT_TABLE[casterLevel - 1];
      if (row) spellSlots = row.flatMap((maximum, index) => maximum > 0 ? [{ key: `spell:${index + 1}`, kind: 'spell' as const, level: index + 1, maximum, recovery: ['long-rest' as const] }] : []);
    }
  } else if (progression === 'none') {
    spellSlots = [];
  } else {
    diagnostics.push(`Unsupported class spell-slot progression "${String(progression)}" at ${summary.source.sourcePath}.`);
  }
  if (spellSlots === undefined) diagnostics.push(`Unable to project class spell slots at ${summary.source.sourcePath}.`);
  if (spellSlots === undefined) return { diagnostics };
  const scale = (identifier: string): number | undefined => {
    const found = summary.scales?.find((entry) => entry.identifier === identifier && (entry.classRestriction === undefined || entry.classRestriction === 'primary'));
    const value = found && evaluateScaleAtLevel(found.values, targetLevel);
    return value?.type === 'number' ? value.value : undefined;
  };
  // Preserve the shipped level-one results, including its text-derived data. Later levels are source-structured only.
  const levelOne = getLevelOneClassProgression(summary).spellcasting;
  const levelOneProjection = targetLevel === 1 ? levelOne : undefined;
  const cantripsKnown = scale('cantrips-known') ?? numericAt(source.cantripsKnown, targetLevel) ?? levelOneProjection?.cantripsKnown;
  const learnedSpells = scale('spells-known') ?? numericAt(source.learnedSpells, targetLevel) ?? levelOneProjection?.learnedSpells;
  const structuredSpellbookCount = scale('spells-in-spellbook') ?? numericAt(source.spellbookSpells, targetLevel);
  const wizardSpellbookCount = targetLevel > 1 ? projectPinnedWizardSpellbookCount(summary, targetLevel, levelOne?.spellbookSpells) : undefined;
  const spellbookSpells = structuredSpellbookCount ?? wizardSpellbookCount ?? levelOneProjection?.spellbookSpells;
  let preparedCapacity = scale('max-prepared') ?? numericAt(source.preparedSpells, targetLevel) ?? levelOneProjection?.preparedSpells;
  const preparation = isRecord(source.preparation) ? source.preparation : undefined;
  if (targetLevel > 1 && preparedCapacity === undefined && typeof preparation?.formula === 'string' && preparation.formula.length > 0) {
    const resolved = resolvePreparationFormula(preparation.formula, summary.source.identifier, targetLevel, context);
    if (resolved === undefined) diagnostics.push(`Unable to resolve class preparation formula at ${summary.source.sourcePath}: ${preparation.formula}.`);
    else preparedCapacity = resolved;
  }
  if (targetLevel > 1 && progression !== 'none' && summary.ruleset === '2024' && summary.source.identifier === 'wizard' && summary.source.sourcePath === PINNED_WIZARD_CLASS_PATH && structuredSpellbookCount === undefined && wizardSpellbookCount === undefined) {
    diagnostics.push(`Pinned Wizard spellbook projection could not verify its Spellcasting source identity and level-one count at ${summary.source.sourcePath}; later spell choices cannot be projected safely.`);
  }
  return { spellcasting: { spellSlots, ...(cantripsKnown === undefined ? {} : { cantripsKnown }), ...(learnedSpells === undefined ? {} : { learnedSpells }), ...(spellbookSpells === undefined ? {} : { spellbookSpells }), ...(preparedCapacity === undefined ? {} : { preparedCapacity }) }, diagnostics };
}

const PINNED_WIZARD_CLASS_PATH = 'packs/_source/classes24/wizard/wizard.yml';
const PINNED_WIZARD_SPELLCASTING_PATH = 'packs/_source/classes24/wizard/class-features/spellcasting.yml';
const PINNED_WIZARD_SPELLCASTING_ID = 'phbwzdSpellcasti';

/** Projects the pinned 2024 Wizard's explicit two-spells-per-level rule. */
function projectPinnedWizardSpellbookCount(summary: ClassSourceSummary, targetLevel: number, levelOneCount: number | undefined): number | undefined {
  if (summary.ruleset !== '2024' || summary.source.identifier !== 'wizard' || summary.source.sourcePath !== PINNED_WIZARD_CLASS_PATH) return undefined;
  const spellcastingFeature = summary.features?.filter((feature) => feature.source.identifier === 'spellcasting');
  if (levelOneCount !== 6 || spellcastingFeature?.length !== 1) return undefined;
  const source = spellcastingFeature[0]?.source;
  if (source?.sourcePath !== PINNED_WIZARD_SPELLCASTING_PATH || source.id !== PINNED_WIZARD_SPELLCASTING_ID || source.identifier !== 'spellcasting') return undefined;
  return levelOneCount + 2 * (targetLevel - 1);
}

export function trimClassProgression(progression: ClassProgressionSelection, summary: ClassSourceSummary, targetLevel: number): ClassProgressionSelection {
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 20) throw new Error(`Invalid class target level: ${targetLevel}`);
  const eligible = new Set(summary.advancements.filter((entry) => entry.level <= targetLevel && (entry.classRestriction === undefined || entry.classRestriction === 'primary')).map((entry) => entry.id));
  const projected = projectClassLevelProgression(summary, targetLevel).spellcasting;
  const initial = getLevelOneClassProgression(summary).spellcasting;
  const derivedCounts: Partial<Record<'cantrips-known' | 'known-spells' | 'spellbook', number>> = {
    'cantrips-known': projected?.cantripsKnown ?? initial?.cantripsKnown,
    'known-spells': projected?.learnedSpells ?? initial?.learnedSpells,
    spellbook: projected?.spellbookSpells ?? initial?.spellbookSpells,
  };
  const selections = progression.selections.flatMap((selection) => {
    if (eligible.has(selection.advancementId)) return [structuredClone(selection)];
    if (selection.kind !== 'spell' || !selection.advancementId.startsWith(`derived:${summary.source.sourcePath}:`)) return [];
    const count = derivedCounts[selection.selectionRole];
    if (count === undefined || count <= 0) return [];
    const maximumSpellLevel = (projected?.spellSlots ?? []).reduce((maximum, slot) => Math.max(maximum, slot.level), 0);
    const eligibleReferences = new Set((summary.spellOptions ?? []).filter((spell) => isDerivedSpellOptionEligible(spell, summary, selection.selectionRole, targetLevel, maximumSpellLevel, projected?.spellbookSpells, initial?.spellbookSpells))
      .map((spell) => `${spell.sourcePath}:${spell.pack}:${spell.type}:${spell.id}`));
    const role = selection.selectionRole;
    const identifier = role === 'cantrips-known' ? 'cantrips-known' : role === 'spellbook' ? 'spells-in-spellbook' : 'spells-known';
    const field = role === 'cantrips-known' ? summary.spellcasting?.cantripsKnown : role === 'spellbook' ? summary.spellcasting?.spellbookSpells : summary.spellcasting?.learnedSpells;
    const structured = summary.scales?.some((scale) => scale.identifier === identifier) || isRecord(field)
      || role === 'spellbook' && targetLevel > 1 && projected?.spellbookSpells !== undefined && projected.spellbookSpells !== initial?.spellbookSpells;
    const level = role === 'cantrips-known' ? 0 : targetLevel > 1 && structured ? -1 : 1;
    const classLists = Array.isArray(summary.spellcasting?.spellLists) ? summary.spellcasting.spellLists.filter((value): value is string => typeof value === 'string') : summary.source.identifier ? [summary.source.identifier.toLocaleLowerCase()] : [];
    return [{ ...structuredClone(selection), count, level, ...(level === -1 ? { maxLevel: maximumSpellLevel } : { maxLevel: undefined }), spellLists: classLists, selected: selection.selected.filter((spell) => eligibleReferences.has(`${spell.sourcePath}:${spell.pack}:${spell.type}:${spell.id}`)).slice(0, count) }];
  });
  const subclassSelection = selections.find((selection) => selection.kind === 'subclass');
  const subclass = subclassSelection?.kind === 'subclass' ? subclassSelection.selected : undefined;
  return { ...structuredClone(progression), targetLevel, ...(subclass === undefined ? { subclass: undefined } : { subclass: structuredClone(subclass) }), selections };
}

function isDerivedSpellOptionEligible(source: FoundrySourceReference, summary: ClassSourceSummary, role: 'cantrips-known' | 'known-spells' | 'spellbook', targetLevel: number, maximumSpellLevel: number, projectedSpellbookCount: number | undefined, levelOneSpellbookCount: number | undefined): boolean {
  if (source.type !== 'spell' || !isRecord(source)) return false;
  const level = source.level;
  if (typeof level !== 'number' || !Number.isInteger(level)) return false;
  const classLists = Array.isArray(summary.spellcasting?.spellLists) ? summary.spellcasting.spellLists.filter((value): value is string => typeof value === 'string') : summary.source.identifier ? [summary.source.identifier.toLocaleLowerCase()] : [];
  const spellLists = Array.isArray(source.spellLists) ? source.spellLists.filter((value): value is string => typeof value === 'string') : [];
  if (classLists.length === 0 || !spellLists.some((list) => classLists.some((candidate) => candidate.toLocaleLowerCase() === list.toLocaleLowerCase()))) return false;
  if (role === 'cantrips-known') return level === 0;
  const identifier = role === 'spellbook' ? 'spells-in-spellbook' : 'spells-known';
  const field = role === 'spellbook' ? summary.spellcasting?.spellbookSpells : summary.spellcasting?.learnedSpells;
  const structured = summary.scales?.some((scale) => scale.identifier === identifier) || isRecord(field)
    || role === 'spellbook' && targetLevel > 1 && projectedSpellbookCount !== undefined && projectedSpellbookCount !== levelOneSpellbookCount;
  if (targetLevel > 1 && structured) return level > 0 && level <= maximumSpellLevel;
  return level === 1;
}

function resolvePreparationFormula(formula: string, classIdentifier: string | undefined, targetLevel: number, context: ClassLevelProgressionContext): number | undefined {
  const match = /^@abilities\.(str|dex|con|int|wis|cha)\.mod\s*\+\s*@classes\.([a-z0-9-]+)\.levels$/i.exec(formula.trim());
  if (!match || match[2] !== classIdentifier) return undefined;
  const modifier = context.abilityModifiers?.[match[1]!.toLowerCase() as keyof NonNullable<ClassLevelProgressionContext['abilityModifiers']>];
  if (typeof modifier !== 'number' || !Number.isInteger(modifier)) return undefined;
  const capacity = modifier + targetLevel;
  return capacity >= 0 ? capacity : undefined;
}

function numericAt(value: unknown, targetLevel: number): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (isRecord(value)) {
    const eligible = Object.entries(value).filter(([level, count]) => /^\d+$/.test(level) && Number(level) <= targetLevel && typeof count === 'number' && Number.isInteger(count) && count >= 0).sort(([left], [right]) => Number(right) - Number(left));
    return eligible[0]?.[1] as number | undefined;
  }
  return undefined;
}
