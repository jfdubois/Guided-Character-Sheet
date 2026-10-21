import type { ClassConfiguration } from './class-configuration';
import type { ClassSourceSummary } from './character-sources';
import { isClassEntitlementEligible } from './class-feature-eligibility';

export interface ClassLevelCard {
  key: string;
  title: string;
  description?: string;
  choiceAdvancementIds: string[];
}
export interface ClassLevelCardRow { level: number; cards: ClassLevelCard[]; }

/** Groups eligible source features and advancements, keeping unresolved relationships visible at their source level. */
export function buildClassLevelCards(summary: ClassSourceSummary, configuration: ClassConfiguration): ClassLevelCardRow[] {
  const eligible = new Map(configuration.advancements.map((advancement) => [advancement.id, advancement]));
  const byLevel = new Map<number, Map<string, ClassLevelCard>>();
  const ensureRow = (level: number): Map<string, ClassLevelCard> => {
    let cards = byLevel.get(level);
    if (cards === undefined) { cards = new Map(); byLevel.set(level, cards); }
    return cards;
  };
  for (let level = 1; level <= configuration.targetLevel; level += 1) ensureRow(level);
  const displayAdvancements = configuration.advancements.map((advancement) => advancement.level === 0 ? { ...advancement, level: 1 } : advancement);
  const progression = { class: configuration.class, targetLevel: configuration.targetLevel, selections: configuration.selections };
  const features = (summary.features ?? []).filter((feature) => eligible.has(feature.advancementId) && isClassEntitlementEligible(progression, feature));
  const featureCountByAdvancement = new Map<string, number>();
  for (const feature of features) featureCountByAdvancement.set(feature.advancementId, (featureCountByAdvancement.get(feature.advancementId) ?? 0) + 1);
  const featureCardKey = (feature: (typeof features)[number]): string => featureCountByAdvancement.get(feature.advancementId) === 1
    ? `feature:${feature.advancementId}`
    : `feature:${feature.advancementId}:${feature.source.id}`;
  for (const feature of features) {
    const key = featureCardKey(feature);
    ensureRow(feature.level).set(key, {
      key, title: feature.source.name,
      ...(feature.description === undefined ? {} : { description: feature.description }), choiceAdvancementIds: [],
    });
  }
  const featureKeys = new Set(features.map((feature) => feature.advancementId));
  for (const advancement of configuration.advancements) {
    if (advancement.type === 'HitPoints' && advancement.level === 0) continue;
    if (featureKeys.has(advancement.id)) continue;
    const parentId = advancement.requiresChoice?.key.replace(/^class:/, '');
    if (parentId !== undefined && (featureKeys.has(parentId) || eligible.has(parentId))) continue;
    const displayLevel = Math.max(1, advancement.level);
    if (implicitFeatureParent({ ...advancement, level: displayLevel }, features, displayAdvancements) !== undefined) continue;
    ensureRow(displayLevel).set(`advancement:${advancement.id}`, {
      key: `advancement:${advancement.id}`, title: advancement.title,
      ...(advancement.hint.length > 0 ? { description: advancement.hint } : {}), choiceAdvancementIds: [],
    });
  }
  for (const choice of configuration.choices) {
    const advancement = eligible.get(choice.advancementId);
    if (advancement === undefined) {
      if (!choice.advancementId.startsWith('derived:')) continue;
      const title = choice.kind === 'spell' ? derivedChoiceTitle(choice.selectionRole) : 'Class choice';
      const key = `derived:${choice.advancementId}`;
      const row = ensureRow(1);
      const card = row.get(key) ?? { key, title, choiceAdvancementIds: [] };
      if (!card.choiceAdvancementIds.includes(choice.advancementId)) card.choiceAdvancementIds.push(choice.advancementId);
      row.set(key, card);
      continue;
    }
    const parentId = advancement.requiresChoice?.key.replace(/^class:/, '');
    const feature = (parentId === undefined ? undefined : features.find((candidate) => candidate.advancementId === parentId))
      ?? (advancement.requiresChoice === undefined ? implicitFeatureParent(advancement, features, configuration.advancements) : undefined);
    const parentAdvancement = parentId === undefined ? undefined : eligible.get(parentId);
    const cardKey = feature !== undefined ? featureCardKey(feature) : parentAdvancement !== undefined ? `advancement:${parentAdvancement.id}` : `advancement:${advancement.id}`;
    const row = ensureRow(feature?.level ?? parentAdvancement?.level ?? advancement.level);
    const card = row.get(cardKey) ?? {
      key: cardKey, title: advancement.title,
      ...(advancement.hint.length > 0 ? { description: advancement.hint } : {}), choiceAdvancementIds: [],
    };
    if (!card.choiceAdvancementIds.includes(choice.advancementId)) card.choiceAdvancementIds.push(choice.advancementId);
    row.set(cardKey, card);
  }
  return [...byLevel.entries()].sort(([left], [right]) => left - right).map(([level, cards]) => ({ level, cards: [...cards.values()] }));
}

function implicitFeatureParent(advancement: ClassConfiguration['advancements'][number], features: NonNullable<ClassSourceSummary['features']>, advancements: ClassConfiguration['advancements']): NonNullable<ClassSourceSummary['features']>[number] | undefined {
  if (advancement.requiresChoice !== undefined) return undefined;
  const featureMatches = features.filter((feature) => feature.level === advancement.level && feature.source.name === advancement.title);
  const choiceMatches = advancements.filter((candidate) => candidate.level === advancement.level && candidate.title === advancement.title && (candidate.type === 'Trait' || candidate.type === 'ItemChoice' || candidate.type === 'ScaleValue'));
  return featureMatches.length === 1 && choiceMatches.length === 1 ? featureMatches[0] : undefined;
}

export function getFirstIncompleteClassLevel(configuration: ClassConfiguration): number | undefined {
  const choices = configuration.choices
    .map((selection) => ({ selection, advancement: configuration.advancements.find((entry) => entry.id === selection.advancementId) }))
    .sort((left, right) => (left.advancement?.level ?? 1) - (right.advancement?.level ?? 1));
  for (const { selection, advancement } of choices) {
    if (isComplete(selection, advancement?.raw.configuration)) continue;
    return advancement?.level ?? 1;
  }
  return undefined;
}

export function renderClassLevelCards(root: HTMLElement, rows: ClassLevelCardRow[], firstIncompleteLevel: number): Map<string, HTMLElement> {
  const cardElements = new Map<string, HTMLElement>();
  for (const row of rows) {
    const section = root.createEl('details', { cls: 'guided-character-sheet__callout guided-character-sheet__level-section' });
    section.open = row.level === firstIncompleteLevel;
    section.createEl('summary', { text: `Level ${row.level}` });
    const content = section.createDiv({ cls: 'guided-character-sheet__callout-content' });
    const list = content.createDiv({ cls: 'guided-character-sheet__level-cards' });
    for (const card of row.cards) {
      const article = list.createEl('article', { cls: 'guided-character-sheet__level-card', attr: { 'data-card-key': card.key } });
      article.createEl('h5', { text: card.title });
      if (card.description !== undefined) article.createDiv({ text: card.description, cls: 'guided-character-sheet__level-card-description' });
      cardElements.set(card.key, article);
    }
  }
  return cardElements;
}

function isComplete(selection: ClassConfiguration['choices'][number], rawConfiguration: unknown): boolean {
  if (selection.kind === 'subclass') return selection.selected !== undefined;
  if (selection.kind === 'ability-score') return Object.values(selection.assignments).reduce((sum, value) => sum + value, 0) === selection.points;
  const configuration = rawConfiguration !== null && typeof rawConfiguration === 'object' ? rawConfiguration as Record<string, unknown> : {};
  const groups = Array.isArray(configuration.choices) ? configuration.choices : [];
  const groupedCount = groups.reduce((sum, group) => sum + (group !== null && typeof group === 'object' && typeof (group as Record<string, unknown>).count === 'number' ? (group as Record<string, number>).count : 0), 0);
  const configuredCount = typeof configuration.choices === 'number' ? configuration.choices : groupedCount;
  const required = selection.kind === 'spell' ? (selection.count ?? configuredCount ?? 1) : (configuredCount || 1);
  const selectedCount = selection.kind === 'item' || selection.kind === 'spell' || selection.kind === 'trait' || selection.kind === 'expertise' ? selection.selected.length : 0;
  return selectedCount >= required;
}

function derivedChoiceTitle(role: Extract<ClassConfiguration['choices'][number], { kind: 'spell' }>['selectionRole']): string {
  if (role === 'cantrips-known') return 'Cantrips known';
  if (role === 'spellbook') return 'Spellbook spells';
  return 'Known spells';
}
