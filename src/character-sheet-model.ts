import { ABILITIES, calculateAbilityScores, collectAbilityBonuses, sumAbilityBonuses, type Ability, type AbilityScoreResults } from './ability-scores';
import type { CharacterDocument } from './character-model';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from './character-sources';
import { getLevelOneClassProgression } from './level-one-progression';
import { projectInventorySheet, type InventorySheetProjection, type ResolvedInventoryItems } from './inventory-sheet-model';
import { projectSpellSheet, type SpellSheetProjection } from './spell-sheet-model';
import { projectFeatureSheet, type FeatureSheetProjection } from './feature-sheet-model';
import { projectBackgroundSheet, type BackgroundSheetProjection } from './background-sheet-model';
import type { FoundrySourceReference, FoundrySpellSummary } from './foundry-source-catalog';
import { projectActionSheet, type ActionSheetProjection } from './action-sheet-model';
import { isRecord } from './foundry-utils';
import { effectiveHitPointMaximum } from './mutable-character-state';

export type SheetValue<T> =
  | { kind: 'available'; value: T }
  | { kind: 'missing'; reason: string };

export type CharacterSheetSection = 'abilities' | 'actions' | 'inventory' | 'spells' | 'features-and-traits' | 'background';

export interface CharacterSheetSources {
  species?: SpeciesSourceSummary;
  class?: ClassSourceSummary;
  background?: BackgroundSourceSummary;
  inventoryItems?: ResolvedInventoryItems;
  spellSummaries?: ReadonlyMap<string, FoundrySpellSummary>;
  grantedSpells?: FoundrySourceReference[];
  toolLabels?: ReadonlyMap<string, string>;
  warnings: string[];
}

export interface CharacterSheetProjection {
  identity: {
    name: string;
    ruleset: string;
    species: SheetValue<string>;
    size?: SheetValue<string>;
    className: SheetValue<string>;
    level: SheetValue<number>;
    background: SheetValue<string>;
  };
  header: {
    proficiencyBonus: SheetValue<number>;
    speed: SheetValue<string>;
    initiative: SheetValue<number>;
    armorClass: SheetValue<number>;
    hitPoints: SheetValue<{ current: number; maximum: number; temporary: number }>;
    inspiration: SheetValue<boolean>;
  };
  abilities: Array<{ key: Ability; label: string; score: SheetValue<number>; modifier: SheetValue<number> }>;
  savingThrows: Array<{ ability: Ability; label: string; proficient: SheetValue<boolean>; modifier: SheetValue<number>; annotations?: Array<{ marker: 'A' | 'D'; source: string }> }>;
  skills: Array<{ key: string; label: string; ability: SheetValue<Ability>; proficient: SheetValue<boolean>; expertise?: SheetValue<boolean>; training?: SheetValue<0 | 1 | 2>; modifier: SheetValue<number>; disadvantageSources: string[]; annotations?: Array<{ marker: 'A' | 'D'; source: string }> }>;
  defenses?: { creatureType: SheetValue<string>; resistances: Array<{ damageType: string; source: string }> };
  savingThrowNotes?: Array<{ text: string; source: string }>;
  senses: Array<{ label: string; value: SheetValue<string | number> }>;
  training: Array<{ label: string; values: SheetValue<string[]> }>;
  inventory: InventorySheetProjection;
  spells?: SpellSheetProjection;
  features?: FeatureSheetProjection;
  backgroundDetails?: BackgroundSheetProjection;
  actions?: ActionSheetProjection;
  warnings: string[];
}

export const CHARACTER_SHEET_SECTIONS: ReadonlyArray<{ value: CharacterSheetSection; label: string }> = [
  { value: 'abilities', label: 'Abilities' },
  { value: 'actions', label: 'Actions' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'spells', label: 'Spells' },
  { value: 'features-and-traits', label: 'Features and traits' },
  { value: 'background', label: 'Background' },
];

const ABILITY_LABELS: Readonly<Record<Ability, string>> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};

const SKILLS: ReadonlyArray<{ key: string; label: string; ability: Ability }> = [
  { key: 'acr', label: 'Acrobatics', ability: 'dex' },
  { key: 'ani', label: 'Animal handling', ability: 'wis' },
  { key: 'arc', label: 'Arcana', ability: 'int' },
  { key: 'ath', label: 'Athletics', ability: 'str' },
  { key: 'dec', label: 'Deception', ability: 'cha' },
  { key: 'his', label: 'History', ability: 'int' },
  { key: 'ins', label: 'Insight', ability: 'wis' },
  { key: 'itm', label: 'Intimidation', ability: 'cha' },
  { key: 'inv', label: 'Investigation', ability: 'int' },
  { key: 'med', label: 'Medicine', ability: 'wis' },
  { key: 'nat', label: 'Nature', ability: 'int' },
  { key: 'prc', label: 'Perception', ability: 'wis' },
  { key: 'prf', label: 'Performance', ability: 'cha' },
  { key: 'per', label: 'Persuasion', ability: 'cha' },
  { key: 'rel', label: 'Religion', ability: 'int' },
  { key: 'slt', label: 'Sleight of hand', ability: 'dex' },
  { key: 'ste', label: 'Stealth', ability: 'dex' },
  { key: 'sur', label: 'Survival', ability: 'wis' },
];

const TRAINING_LABELS: Readonly<Record<string, string>> = {
  'armor:lgt': 'Light armor',
  'armor:med': 'Medium armor',
  'armor:hvy': 'Heavy armor',
  'armor:shl': 'Shields',
  'weapon:sim': 'Simple weapons',
  'weapon:mar': 'Martial weapons',
  'tool:gaming': 'Gaming set',
  'languages:common': 'Common',
};

export function isCharacterSheetSection(value: unknown): value is CharacterSheetSection {
  return CHARACTER_SHEET_SECTIONS.some((section) => section.value === value);
}

export function projectCharacterSheet(document: CharacterDocument, sources: CharacterSheetSources): CharacterSheetProjection {
  const warnings = [...sources.warnings];
  const progression = document.classProgressions?.[0];
  const canCalculateAbilities = document.abilityScores !== undefined && sources.species !== undefined && sources.class !== undefined && sources.background !== undefined;
  const results = canCalculateAbilities
    ? calculateAbilityScores(document.abilityScores!, sumAbilityBonuses(collectAbilityBonuses(sources.species, sources.class, progression, sources.background, document.backgroundChoices?.abilityScores)))
    : undefined;
  const proficiencyBonus = sources.class === undefined
    ? missing<number>('Class source is unavailable.')
    : available(getLevelOneClassProgression(sources.class).proficiencyBonus);
  const selectors = collectSelectors(document, sources);
  collectUnknownSelectors(selectors.saves, 'saves', new Set(ABILITIES), warnings);
  collectUnknownSelectors(selectors.skills, 'skills', new Set(SKILLS.map(({ key }) => key)), warnings);
  const inventory = projectInventorySheet(document, sources.inventoryItems ?? new Map(), results?.dex.modifier);
  const spells = projectSpellSheet(document, { class: sources.class, species: sources.species, background: sources.background, progression, abilityResults: results, proficiencyBonus, spellSummaries: sources.spellSummaries ?? new Map(), grantedSpells: sources.grantedSpells });
  const features = projectFeatureSheet(document, { class: sources.class, species: sources.species, background: sources.background });
  const backgroundDetails = projectBackgroundSheet(document, { background: sources.background, abilityResults: results, abilityBonuses: sources.background === undefined ? undefined : collectAbilityBonuses(sources.species, sources.class, progression, sources.background, document.backgroundChoices?.abilityScores) });
  const actions = projectActionSheet(document, {
    inventoryItems: sources.inventoryItems,
    abilityResults: results,
    proficiencyBonus,
    weaponTraining: sources.class?.proficiencies?.weapons ?? [],
    weaponMasteries: collectWeaponMasteries(document, sources.class),
    spellRows: spells.kind === 'empty' ? [] : [...spells.cantrips, ...spells.levels.flatMap((level) => level.spells)].map((row) => ({ name: row.name, level: row.level, source: row.source, prepared: row.prepared, ownership: row.ownership })),
    spellAttackBonus: spells.kind === 'empty' ? undefined : spells.spellAttack,
    spellSaveDc: spells.kind === 'empty' ? undefined : spells.saveDc,
    featureActivities: features.groups.flatMap((group) => group.entries.flatMap((entry) => entry.activities.map((activity) => ({ sourceName: entry.name, activity })))),
    includeCombatReference: true,
  });
  warnings.push(...spells.warnings);
  warnings.push(...features.warnings);
  warnings.push(...inventory.warnings);
  warnings.push(...actions.warnings);
  const armorClass = inventory.kind === 'available' ? inventory.armor.armorClass : missing<number>(inventory.reason);
  const stealthDisadvantageSources = inventory.kind === 'available' ? inventory.armor.stealthDisadvantageSources : [];
  const skills = SKILLS.map((skill) => ({ ...skillRow(skill, results, proficiencyBonus, selectors.skills, selectors.expertise, canCalculateAbilities, warnings), disadvantageSources: skill.key === 'ste' ? [...stealthDisadvantageSources] : [] }));
  const saveAnnotations = sources.species?.rollAnnotations?.filter((annotation) => annotation.target === 'saving-throw') ?? [];
  const selectedResistances = new Set(document.speciesConfiguration?.choices.flatMap((choice) => choice.selected).filter((value) => value.startsWith('dr:')).map((value) => value.slice(3)) ?? []);
  const resistanceRows = (sources.species?.resistances ?? [])
    .filter((resistance) => resistance.selected !== false || selectedResistances.has(resistance.damageType))
    .filter((resistance, index, all) => all.findIndex((candidate) => candidate.damageType === resistance.damageType) === index)
    .map((resistance) => ({ damageType: resistance.damageType, source: resistance.source.name }));

  return {
    identity: {
      name: document.name,
      ruleset: document.ruleset ?? 'Not selected',
      species: identityValue(sources.species?.source.name, document.origin?.identifier, 'Species has not been selected.'),
      size: projectSpeciesSize(document, sources.species),
      className: identityValue(sources.class?.source.name, progression?.class.identifier, 'Class has not been selected.'),
      level: progression === undefined ? missing('Class level has not been selected.') : available(progression.targetLevel),
      background: identityValue(sources.background?.source.name, document.background?.identifier, 'Background has not been selected.'),
    },
    header: {
      proficiencyBonus,
      speed: movementValue(sources.species),
      initiative: abilityModifier(results, 'dex', 'Initiative requires complete ability-score sources.'),
      armorClass,
      hitPoints: document.mutable?.hitPoints === undefined ? missing('Hit points are not available from character handover.') : available({ current: document.mutable.hitPoints.current, maximum: effectiveHitPointMaximum(document.mutable.hitPoints), temporary: document.mutable.hitPoints.temporary ?? 0 }),
      inspiration: document.mutable?.inspiration === undefined ? missing('Inspiration is not available from character handover.') : available(document.mutable.inspiration),
    },
    abilities: ABILITIES.map((ability) => ({
      key: ability,
      label: ABILITY_LABELS[ability],
      score: results === undefined ? missing('Complete ability-score sources are required.') : available(results[ability].final),
      modifier: abilityModifier(results, ability, 'Complete ability-score sources are required.'),
    })),
    savingThrows: ABILITIES.map((ability) => savingThrow(ability, results, proficiencyBonus, selectors.saves, sources.class !== undefined, saveAnnotations.filter((annotation) => annotation.ability === ability).map((annotation) => ({ marker: annotation.mode === 'advantage' ? 'A' as const : 'D' as const, source: annotation.source.name })))),
    skills,
    defenses: { creatureType: sources.species?.creatureTypeProjection !== undefined ? available(sources.species.creatureTypeProjection.value) : typeof sources.species?.creatureType?.value === 'string' ? available(sources.species.creatureType.value) : missing('Creature type is unavailable from the species source.'), resistances: resistanceRows },
    savingThrowNotes: (sources.species?.savingThrowNotes ?? []).map((note) => ({ text: note.text, source: note.source.name })),
    senses: projectSenses(sources.species, skills),
    training: projectTraining(selectors, sources),
    inventory,
    spells,
    features,
    backgroundDetails,
    actions,
    warnings,
  };
}

function projectSpeciesSize(document: CharacterDocument, species: SpeciesSourceSummary | undefined): SheetValue<string> {
  const size = species?.size;
  if (size === undefined) return missing('Species size is unavailable from the source.');
  const selected = document.speciesConfiguration?.size;
  if (size.sizes.length > 1) {
    if (selected?.advancementId !== size.advancementId || !size.sizes.includes(selected.selected)) return missing('A valid species size choice is required.');
    return available(sizeLabel(selected.selected));
  }
  return available(sizeLabel(size.sizes[0]!));
}

function sizeLabel(value: string): string { return ({ tiny: 'Tiny', sm: 'Small', med: 'Medium', lg: 'Large', huge: 'Huge', grg: 'Gargantuan' }[value] ?? value); }

function collectWeaponMasteries(document: CharacterDocument, classSource: ClassSourceSummary | undefined): ReadonlySet<string> {
  const mastered = new Set<string>();
  if (classSource === undefined) return mastered;
  const advancements = new Map(classSource.advancements.flatMap((advancement) => {
    const configuration = isRecord(advancement.raw.configuration) ? advancement.raw.configuration : undefined;
    return advancement.type === 'Trait' && configuration?.mode === 'mastery' ? [[advancement.id, advancement] as const] : [];
  }));
  for (const progression of document.classProgressions ?? []) {
    if (progression.class.sourcePath !== classSource.source.sourcePath) continue;
    for (const selection of progression.selections) {
      if (selection.kind !== 'trait' || !advancements.has(selection.advancementId)) continue;
      for (const value of selection.selected) {
        const parts = value.toLocaleLowerCase().split(':').filter((part) => part.length > 0 && part !== '*');
        if (parts[0] === 'weapon' && parts.length > 1) mastered.add(parts.at(-1)!);
      }
    }
  }
  return mastered;
}

function available<T>(value: T): SheetValue<T> { return { kind: 'available', value }; }
function missing<T>(reason: string): SheetValue<T> { return { kind: 'missing', reason }; }

function identityValue(sourceName: string | undefined, identifier: string | undefined, reason: string): SheetValue<string> {
  if (sourceName !== undefined) return available(sourceName);
  if (identifier !== undefined) return available(humanize(identifier));
  return missing(reason);
}

function abilityModifier(results: AbilityScoreResults | undefined, ability: Ability, reason: string): SheetValue<number> {
  return results === undefined ? missing(reason) : available(results[ability].modifier);
}

function movementValue(species: SpeciesSourceSummary | undefined): SheetValue<string> {
  const movement = species?.movement;
  const walk = movement?.walk;
  if (typeof walk !== 'number' || !Number.isFinite(walk)) return missing('Walking speed is unavailable from the species source.');
  const units = typeof movement?.units === 'string' && movement.units.trim().length > 0 ? movement.units.trim() : undefined;
  return available(`${walk}${units === undefined ? '' : ` ${formatUnits(units)}`}`);
}

function savingThrow(ability: Ability, results: AbilityScoreResults | undefined, proficiencyBonus: SheetValue<number>, selectors: Set<string>, classAvailable: boolean, annotations: Array<{ marker: 'A' | 'D'; source: string }> = []): CharacterSheetProjection['savingThrows'][number] {
  if (!classAvailable) return { ability, label: ABILITY_LABELS[ability], proficient: missing('Class saving throws are unavailable.'), modifier: missing('Class saving throws are unavailable.'), annotations };
  const proficient = selectors.has(ability);
  if (results === undefined || proficiencyBonus.kind === 'missing') return { ability, label: ABILITY_LABELS[ability], proficient: available(proficient), modifier: missing('Complete ability-score sources are required.'), annotations };
  return { ability, label: ABILITY_LABELS[ability], proficient: available(proficient), modifier: available(results[ability].modifier + (proficient ? proficiencyBonus.value : 0)), annotations };
}

function skillRow(skill: typeof SKILLS[number], results: AbilityScoreResults | undefined, proficiencyBonus: SheetValue<number>, selectors: Set<string>, expertiseSelectors: Set<string>, proficiencyComplete: boolean, warnings: string[]): CharacterSheetProjection['skills'][number] {
  if (!proficiencyComplete) return { ...skill, ability: available(skill.ability), proficient: missing('Complete proficiency sources are required.'), expertise: missing('Complete proficiency sources are required.'), training: missing('Complete proficiency sources are required.'), modifier: missing('Complete proficiency sources are required.'), disadvantageSources: [] };
  const proficient = selectors.has(skill.key);
  const expertise = expertiseSelectors.has(skill.key);
  if (expertise && !proficient) warnings.push(`Expertise requires proficiency in ${skill.label}.`);
  const multiplier: 0 | 1 | 2 = expertise && proficient ? 2 : proficient ? 1 : 0;
  if (results === undefined || proficiencyBonus.kind === 'missing') return { ...skill, ability: available(skill.ability), proficient: available(proficient), expertise: available(expertise && proficient), training: available(multiplier), modifier: missing('Complete ability-score sources are required.'), disadvantageSources: [] };
  return { ...skill, ability: available(skill.ability), proficient: available(proficient), expertise: available(expertise && proficient), training: available(multiplier), modifier: available(results[skill.ability].modifier + multiplier * proficiencyBonus.value), disadvantageSources: [] };
}

interface SelectorGroups { armor: Set<string>; weapons: Set<string>; tools: Set<string>; languages: Set<string>; saves: Set<string>; skills: Set<string>; expertise: Set<string>; }

function collectSelectors(document: CharacterDocument, sources: CharacterSheetSources): SelectorGroups {
  const classProgression = document.classProgressions?.find((entry) => entry.class.sourcePath === sources.class?.source.sourcePath);
  const activeClassAdvancements = new Map((sources.class?.advancements ?? [])
    .filter((advancement) => advancement.level <= (classProgression?.targetLevel ?? 0) && (advancement.classRestriction === undefined || advancement.classRestriction === 'primary'))
    .map((advancement) => [advancement.id, advancement]));
  const classTraitSelectors = classProgression?.selections.flatMap((selection) => {
    if (selection.kind !== 'trait') return [];
    const advancement = activeClassAdvancements.get(selection.advancementId);
    const configuration = advancement !== undefined && isRecord(advancement.raw.configuration) ? advancement.raw.configuration : undefined;
    return configuration?.mode === 'expertise' ? [] : selection.selected;
  }) ?? [];
  const values = [
    ...(sources.class?.proficiencies?.armor ?? []),
    ...(sources.class?.proficiencies?.weapons ?? []),
    ...(sources.class?.proficiencies?.tools ?? []),
    ...(sources.class?.proficiencies?.languages ?? []),
    ...(sources.class?.proficiencies?.savingThrows ?? []),
    ...(sources.class?.proficiencies?.skills ?? []),
    ...(sources.background?.tools ?? []),
    ...(sources.background?.languages ?? []),
    ...(sources.background?.skills ?? []),
    ...(document.backgroundChoices?.languages ?? []),
    ...classTraitSelectors,
    ...(document.speciesConfiguration?.choices.flatMap((choice) => choice.selected) ?? []),
  ];
  const groups: SelectorGroups = { armor: new Set(), weapons: new Set(), tools: new Set(), languages: new Set(), saves: new Set(), skills: new Set(), expertise: new Set() };
  for (const value of values) {
    const separator = value.indexOf(':');
    const category = separator < 0 ? value : value.slice(0, separator);
    const key = separator < 0 ? '' : value.slice(separator + 1);
    if (!key) continue;
    if (category === 'armor') groups.armor.add(key);
    else if (category === 'weapon') groups.weapons.add(key);
    else if ((category === 'tool' || category === 'tools') && !key.endsWith(':*') && key !== '*') groups.tools.add(key.toLocaleLowerCase());
    else if (category === 'languages') groups.languages.add(value.slice('languages:'.length));
    else if (category === 'saves') groups.saves.add(normalizeAbility(key));
    else if (category === 'skills') groups.skills.add(key);
  }
  for (const selection of classProgression?.selections ?? []) {
    if (selection.kind !== 'expertise') continue;
    const advancement = activeClassAdvancements.get(selection.advancementId);
    const configuration = advancement !== undefined && isRecord(advancement.raw.configuration) ? advancement.raw.configuration : undefined;
    if (configuration?.mode !== 'expertise') continue;
    for (const value of selection.selected) if (value.startsWith('skills:')) groups.expertise.add(value.slice('skills:'.length));
  }
  return groups;
}

function collectUnknownSelectors(values: Set<string>, category: string, supported: Set<string>, warnings: string[]): void {
  for (const value of values) if (!supported.has(value)) warnings.push(`Unsupported ${category} selector: ${category}:${value}`);
}

function normalizeAbility(value: string): string {
  const aliases: Readonly<Record<string, Ability>> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
  return aliases[value] ?? value;
}

function projectSenses(species: SpeciesSourceSummary | undefined, skills: CharacterSheetProjection['skills']): CharacterSheetProjection['senses'] {
  const entries: CharacterSheetProjection['senses'] = [];
  const senses = species?.senses;
  const units = typeof senses?.units === 'string' ? senses.units : undefined;
  if (senses !== undefined) for (const [key, value] of Object.entries(senses)) {
    if (key === 'units' || value === null || value === undefined || value === false || value === '') continue;
    entries.push({ label: humanize(key), value: available(`${String(value)}${typeof value === 'number' && units ? ` ${formatUnits(units)}` : ''}`) });
  }
  entries.push(
    { label: 'Passive perception', value: passiveSkill(skills, 'prc') },
    { label: 'Passive investigation', value: passiveSkill(skills, 'inv') },
    { label: 'Passive insight', value: passiveSkill(skills, 'ins') },
  );
  return entries;
}

function passiveSkill(skills: CharacterSheetProjection['skills'], key: string): SheetValue<number> {
  const modifier = skills.find((skill) => skill.key === key)?.modifier;
  return modifier?.kind === 'available'
    ? available(10 + modifier.value)
    : missing(modifier?.reason ?? 'Skill is unavailable for passive check calculation.');
}

function projectTraining(selectors: SelectorGroups, sources: CharacterSheetSources): CharacterSheetProjection['training'] {
  const complete = sources.class !== undefined && sources.background !== undefined && sources.species !== undefined;
  const values = (category: 'armor' | 'weapon' | 'tool' | 'languages', keys: Set<string>): SheetValue<string[]> => {
    if (!complete) return missing('Complete proficiency sources are required.');
    return available([...keys].map((key) => trainingLabel(category, key, sources.toolLabels)).sort((left, right) => left.localeCompare(right)));
  };
  return [
    { label: 'Armor', values: values('armor', selectors.armor) },
    { label: 'Weapons', values: values('weapon', selectors.weapons) },
    { label: 'Tools', values: values('tool', selectors.tools) },
    { label: 'Languages', values: values('languages', selectors.languages) },
  ];
}

function trainingLabel(category: string, key: string, toolLabels?: ReadonlyMap<string, string>): string {
  if (category === 'tool') return TRAINING_LABELS[`tool:${key}`] ?? toolLabels?.get(`tool:${key}`) ?? humanize(key.split(':').at(-1) ?? key);
  return TRAINING_LABELS[`${category}:${key}`] ?? humanize(key.split(':').at(-1) ?? key);
}

function humanize(value: string): string {
  const spaced = value.replace(/[-_]/g, ' ').trim();
  return spaced.length === 0 ? value : spaced[0]!.toUpperCase() + spaced.slice(1);
}

function formatUnits(units: string): string { return units === 'ft' ? 'ft.' : units; }
