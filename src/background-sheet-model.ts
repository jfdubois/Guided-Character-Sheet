import type { Ability, AbilityBonusSources, AbilityScoreResults } from './ability-scores';
import type { CharacterDocument } from './character-model';
import type { BackgroundSourceSummary } from './character-sources';
import type { FoundrySourceReference } from './foundry-source-catalog';
import { isFoundryInventoryEntry } from './inventory';
import type { InventoryCurrency } from './inventory';
import type { SheetValue } from './character-sheet-model';
import { buildBackgroundAbilityConfiguration, validateBackgroundAbilitySelection } from './background-ability-configuration';

export interface BackgroundSheetProjection {
  source: SheetValue<FoundrySourceReference>;
  sourceFacts: {
    description: SheetValue<string>;
    abilityScores: SheetValue<BackgroundSourceSummary['abilityScores']>;
    skills: SheetValue<string[]>;
    languages: SheetValue<string[]>;
    tools: SheetValue<string[]>;
    feat: SheetValue<FoundrySourceReference>;
    features: SheetValue<BackgroundSourceSummary['features']>;
  };
  abilityImprovements: SheetValue<Array<{ ability: Ability; bonus: number; finalScore: SheetValue<number> | number }>>;
  choices: { languages: SheetValue<string[]> };
  equipment: {
    source: SheetValue<BackgroundSourceSummary['equipment']>;
    items: Array<{ name: string; quantity: SheetValue<number>; provenance: string[] }>;
    wealth: SheetValue<string>;
    currency: Record<keyof InventoryCurrency, SheetValue<number>>;
  };
  biography: Record<'personalityTraits' | 'ideals' | 'bonds' | 'flaws' | 'faith' | 'appearance' | 'physicalDetails', SheetValue<string>>;
  warnings: string[];
}

export interface BackgroundSheetInputs {
  background?: BackgroundSourceSummary;
  abilityResults?: AbilityScoreResults;
  abilityBonuses?: AbilityBonusSources;
}

const BIOGRAPHY_REASON = 'Biography data is not stored in the character document.';

export function projectBackgroundSheet(document: CharacterDocument, inputs: BackgroundSheetInputs): BackgroundSheetProjection {
  const background = inputs.background;
  const warnings: string[] = [];
  if (background === undefined) warnings.push('Background source is unavailable.');
  const missingSource = <T>(reason: string): SheetValue<T> => ({ kind: 'missing', reason });
  const sourceFacts = background === undefined ? {
    description: missingSource<string>('Background source is unavailable.'), abilityScores: missingSource<BackgroundSourceSummary['abilityScores']>('Background source is unavailable.'), skills: missingSource<string[]>('Background source is unavailable.'), languages: missingSource<string[]>('Background source is unavailable.'), tools: missingSource<string[]>('Background source is unavailable.'), feat: missingSource<FoundrySourceReference>('Background source is unavailable.'), features: missingSource<BackgroundSourceSummary['features']>('Background source is unavailable.'),
  } : {
    description: valueOrMissing(background.description, 'Background description is unavailable.'),
    abilityScores: valueOrMissing(background.abilityScores, 'Background ability-score rules are unavailable.'),
    skills: available(labels(background.skills)), languages: available(labels(background.languages)), tools: available(labels(background.tools)),
    feat: valueOrMissing(background.feat, 'Background feat is not granted by the source.'), features: available(background.features.map((feature) => ({ ...feature }))),
  };
  const abilityImprovements: BackgroundSheetProjection['abilityImprovements'] = background === undefined ? missingSource<Array<{ ability: Ability; bonus: number; finalScore: SheetValue<number> | number }>>('Background source is unavailable.') : projectImprovements(background, inputs, document);
  const savedLanguages = document.backgroundChoices?.languages;
  const choices = { languages: savedLanguages === undefined ? missingSource<string[]>('No saved background language choices.') : available(labels(savedLanguages)) };
  const sourcePath = background?.source.sourcePath;
  const items = sourcePath === undefined ? [] : (document.mutable?.inventory.items ?? []).filter((entry) => entry.provenance.some((provenance) => provenance.sourcePath === sourcePath)).map((entry) => {
    const provenance = entry.provenance.filter((value) => value.sourcePath === sourcePath);
    const quantity = provenance.some((value) => value.quantity === undefined) ? missing<number>('Background item quantity is unavailable from provenance.') : available(provenance.reduce((total, value) => total + value.quantity!, 0));
    return { name: isFoundryInventoryEntry(entry) ? entry.source.name : entry.custom.name, quantity, provenance: provenance.map((value) => value.packageNodeId) };
  });
  const currency = projectCurrency(document, sourcePath);
  const wealth = background === undefined ? missingSource<string>('Background source is unavailable.') : valueOrMissing(background.wealth, 'Starting wealth is unavailable.');
  return {
    source: background === undefined ? missingSource<FoundrySourceReference>('Background source is unavailable.') : available(background.source), sourceFacts,
    abilityImprovements, choices,
    equipment: { source: background === undefined ? missingSource<BackgroundSourceSummary['equipment']>('Background source is unavailable.') : available(background.equipment.map((group) => ({ ...group }))), items, wealth, currency },
    biography: { personalityTraits: missingSource(BIOGRAPHY_REASON), ideals: missingSource(BIOGRAPHY_REASON), bonds: missingSource(BIOGRAPHY_REASON), flaws: missingSource(BIOGRAPHY_REASON), faith: missingSource(BIOGRAPHY_REASON), appearance: missingSource(BIOGRAPHY_REASON), physicalDetails: missingSource(BIOGRAPHY_REASON) }, warnings,
  };
}

function projectImprovements(background: BackgroundSourceSummary, inputs: BackgroundSheetInputs, document: CharacterDocument): BackgroundSheetProjection['abilityImprovements'] {
  const fixed = background.abilityScores?.fixed ?? {};
  if (background.ruleset === '2024' && background.abilityScores !== undefined && background.abilityScores.points !== undefined) {
    const selection = document.backgroundChoices?.abilityScores;
    if (selection === undefined) return missing('No saved background ability-score allocation.');
    const configuration = buildBackgroundAbilityConfiguration(background);
    if (configuration.kind !== 'choice' || validateBackgroundAbilitySelection(configuration, selection).length > 0) {
      return missing('Saved background ability-score allocation does not match the current source.');
    }
  }
  const bonuses = inputs.abilityBonuses?.background;
  const entries = background.ruleset === '2024' ? Object.entries(bonuses ?? {}) : Object.entries(fixed).concat(Object.entries(bonuses ?? {}).filter(([ability]) => fixed[ability] === undefined));
  const improvements = entries.filter((entry): entry is [Ability, number] => isAbility(entry[0]) && typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] !== 0).map(([ability, bonus]) => ({ ability, bonus, finalScore: inputs.abilityResults === undefined ? missing<number>('Final ability score is unavailable.') : inputs.abilityResults[ability].final }));
  return { kind: 'available', value: improvements };
}

function valueOrMissing<T>(value: T | undefined, reason: string): SheetValue<T> { return value === undefined ? { kind: 'missing', reason } : { kind: 'available', value }; }
function available<T>(value: T): SheetValue<T> { return { kind: 'available', value }; }
function labels(values: string[]): string[] { return values.map((value) => humanize(value.split(':').at(-1) ?? value)); }
function humanize(value: string): string { const normalized = value.replace(/[-_]/g, ' ').trim(); return normalized.length === 0 ? value : normalized[0]!.toUpperCase() + normalized.slice(1); }
function isAbility(value: string): value is Ability { return ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(value); }
function missing<T>(reason: string): SheetValue<T> { return { kind: 'missing', reason }; }

function projectCurrency(document: CharacterDocument, sourcePath: string | undefined): Record<keyof InventoryCurrency, SheetValue<number>> {
  const denominations: Array<keyof InventoryCurrency> = ['cp', 'sp', 'ep', 'gp', 'pp'];
  const contributions = sourcePath === undefined ? [] : (document.mutable?.inventory.currencyProvenance ?? []).filter((value) => value.sourcePath === sourcePath);
  return Object.fromEntries(denominations.map((denomination) => {
    const amount = contributions.filter((value) => value.denomination === denomination).reduce((total, value) => total + value.amount, 0);
    return [denomination, amount === 0 ? missing<number>('No persisted background-attributable currency.') : available(amount)];
  })) as Record<keyof InventoryCurrency, SheetValue<number>>;
}
