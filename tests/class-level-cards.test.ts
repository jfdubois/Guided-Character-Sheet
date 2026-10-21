import { describe, expect, it } from 'vitest';
import { buildClassConfiguration, restoreClassConfiguration, setClassSelection, toClassProgressionSelection, type ClassAdvancementSelection } from '../src/class-configuration';
import { buildClassLevelCards, getFirstIncompleteClassLevel, renderClassLevelCards } from '../src/class-level-cards';
import type { ClassSourceSummary } from '../src/character-sources';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
const feature = (id: string, level: number, name: string, requiresChoice?: { key: string; value: string }) => ({
  advancementId: id, level, source: { sourcePath: `features/${id}.yml`, pack: 'dnd5e.classes', type: 'feat', id: `${id}-source`, name },
  ...(requiresChoice ? { requiresChoice } : {}), description: `${name} description`,
});
function summary(): ClassSourceSummary {
  return {
    source: { sourcePath: 'classes/test.yml', pack: 'dnd5e.classes', type: 'class', id: 'test', name: 'Tester' }, ruleset: '2014', hitDie: 'd8',
    features: [feature('f1', 1, 'First feature'), feature('f3', 3, 'Subclass feature', { key: 'class:subclass', value: 'Compendium.dnd5e.subclasses.Item.subclass1' })],
    advancements: [
      { id: 'f1', type: 'ItemGrant', level: 1, title: 'First feature', hint: '', dependencies: [], raw: {} },
      { id: 'choice1', type: 'ItemChoice', level: 1, title: 'Feature choice', hint: '', dependencies: [], requiresChoice: { key: 'class:f1', value: 'feature' }, raw: { configuration: { choices: 1, pool: ['feature'] } } },
      { id: 'unlinked', type: 'ItemChoice', level: 2, title: 'Unlinked choice', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['option'] } } },
      { id: 'subclass', type: 'Subclass', level: 3, title: 'Subclass', hint: '', dependencies: [{ uuid: 'Compendium.dnd5e.subclasses.Item.subclass1', source: { sourcePath: 'subclasses/subclass1.yml', pack: 'dnd5e.subclasses', type: 'subclass', id: 'subclass1', name: 'Path' } }], raw: {} },
      { id: 'subchoice', type: 'ItemChoice', level: 3, title: 'Subclass choice', hint: '', dependencies: [], requiresChoice: { key: 'class:subclass', value: 'Compendium.dnd5e.subclasses.Item.subclass1' }, raw: { configuration: { choices: 1, pool: ['option'] } } },
      { id: 'later', type: 'ItemGrant', level: 4, title: 'Later', hint: '', dependencies: [], raw: {} },
    ],
  };
}

describe('class level cards', () => {
  it('groups the pinned Wizard Scholar choice under the Scholar feature card', async () => {
    const index = createPinnedSourceIndex();
    const source = await index.getClassSummary('2024', 'packs/_source/classes24/wizard/wizard.yml');
    const configuration = buildClassConfiguration(source, snapshot, 2);
    const cards = buildClassLevelCards(source, configuration);
    const levelTwo = cards.find((row) => row.level === 2)?.cards ?? [];
    const scholarCards = levelTwo.filter((card) => card.title === 'Scholar');
    const scholarChoiceIds = source.advancements.filter((advancement) => advancement.level === 2 && advancement.title === 'Scholar' && (advancement.type === 'Trait' || advancement.type === 'ItemChoice')).map((advancement) => advancement.id);

    expect(scholarChoiceIds).toHaveLength(1);
    expect(scholarCards).toHaveLength(1);
    expect(scholarCards[0]?.key).toMatch(/^feature:/);
    expect(scholarCards[0]?.choiceAdvancementIds).toContain(scholarChoiceIds[0]);
  });

  it('restores a level-two Rogue progression with 2024 Thief choices and gates its features until selection', async () => {
    const summary = await createPinnedSourceIndex().getClassSummary('2024', 'packs/_source/classes24/rogue/rogue.yml');
    const atLevelTwo = buildClassConfiguration(summary, snapshot, 2);
    const atLevelThree = buildClassConfiguration(summary, snapshot, 3);
    const restored = restoreClassConfiguration(
      { ...toClassProgressionSelection(atLevelTwo), targetLevel: 3 },
      { class: atLevelThree.class, summary, configuration: atLevelThree },
    );
    const subclassChoice = restored.choices.find((choice) => choice.kind === 'subclass');
    const thief = subclassChoice?.kind === 'subclass' ? subclassChoice.options.find((option) => option.name === 'Thief') : undefined;

    expect(thief).toBeDefined();
    expect(buildClassLevelCards(summary, restored).flatMap((row) => row.cards.map((card) => card.title))).not.toEqual(expect.arrayContaining(['Fast Hands', 'Second-Story Work']));

    const selected = setClassSelection(restored, { ...subclassChoice!, kind: 'subclass', selected: thief! });
    const selectedCards = buildClassLevelCards(summary, selected);
    expect(selectedCards.find((row) => row.level === 3)?.cards.map((card) => card.title)).toEqual(expect.arrayContaining(['Fast Hands', 'Second-Story Work']));
    expect(selectedCards.some((row) => row.level === 0)).toBe(false);
    expect(selectedCards.flatMap((row) => row.cards).filter((card) => card.title === 'Sneak Attack')).toHaveLength(1);
  });

  it('places a choice on its source-linked feature card exactly once', () => {
    const source = summary();
    const cards = buildClassLevelCards(source, buildClassConfiguration(source, snapshot, 3));
    const linked = cards.flatMap((row) => row.cards).filter((card) => card.choiceAdvancementIds.includes('choice1'));
    expect(linked).toHaveLength(1);
    expect(linked[0]?.key).toBe('feature:f1');
    expect(cards.flatMap((row) => row.cards).some((card) => card.key === 'advancement:choice1')).toBe(false);
  });

  it('keeps an advancement without a reliable feature link on its own source-level card', () => {
    const source = summary();
    const cards = buildClassLevelCards(source, buildClassConfiguration(source, snapshot, 3));
    const standalone = cards.flatMap((row) => row.cards).filter((card) => card.key === 'advancement:unlinked');
    expect(standalone).toHaveLength(1);
    expect(cards.find((row) => row.level === 2)?.cards).toContain(standalone[0]);
  });

  it('groups a unique same-level same-name choice under its feature for presentation', () => {
    const source = summary();
    source.features = [...(source.features ?? []), feature('scholar-feature', 2, 'Scholar')];
    source.advancements = [...source.advancements, { id: 'scholar-feature', type: 'ItemGrant', level: 2, title: 'Scholar', hint: '', dependencies: [], raw: {} }, { id: 'scholar-choice', type: 'Trait', level: 2, title: 'Scholar', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['Arcana', 'History'] } } }];
    const cards = buildClassLevelCards(source, buildClassConfiguration(source, snapshot, 2));
    const levelCards = cards.find((row) => row.level === 2)?.cards ?? [];
    expect(levelCards.filter((card) => card.title === 'Scholar')).toHaveLength(1);
    expect(levelCards.find((card) => card.key === 'feature:scholar-feature')?.choiceAdvancementIds).toContain('scholar-choice');
  });

  it('keeps ambiguous same-name choices standalone', () => {
    const source = summary();
    source.features = [...(source.features ?? []), feature('scholar-one', 2, 'Scholar'), feature('scholar-two', 2, 'Scholar')];
    source.advancements = [...source.advancements, { id: 'scholar-one', type: 'ItemGrant', level: 2, title: 'Scholar', hint: '', dependencies: [], raw: {} }, { id: 'scholar-two', type: 'ItemGrant', level: 2, title: 'Scholar', hint: '', dependencies: [], raw: {} }, { id: 'scholar-choice', type: 'Trait', level: 2, title: 'Scholar', hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['Arcana'] } } }];
    const cards = buildClassLevelCards(source, buildClassConfiguration(source, snapshot, 2));
    const levelCards = cards.find((row) => row.level === 2)?.cards ?? [];
    expect(levelCards.filter((card) => card.title === 'Scholar')).toHaveLength(3);
    expect(levelCards.find((card) => card.key === 'advancement:scholar-choice')?.choiceAdvancementIds).toContain('scholar-choice');
  });

  it('orders level rows and includes selected subclass dependent choices', () => {
    const source = summary();
    const built = buildClassConfiguration(source, snapshot, 3);
    const subclass = source.advancements[3]!.dependencies[0]!.source!;
    const configuration = setClassSelection(built, { advancementId: 'subclass', kind: 'subclass', selected: subclass, options: [subclass] });
    const cards = buildClassLevelCards(source, configuration);
    expect(cards.map((row) => row.level)).toEqual([1, 2, 3]);
    expect(configuration.choices.map((choice) => choice.advancementId)).toContain('subchoice');
    expect(cards.flatMap((row) => row.cards).some((card) => card.choiceAdvancementIds.includes('subchoice'))).toBe(true);
  });

  it('does not include cards above target and uses stable card keys across builds', () => {
    const source = summary();
    const configuration = buildClassConfiguration(source, snapshot, 3);
    const first = buildClassLevelCards(source, configuration);
    const second = buildClassLevelCards(source, configuration);
    expect(first.map((row) => row.level)).toEqual([1, 2, 3]);
    expect(first.flatMap((row) => row.cards).map((card) => card.key)).toEqual(second.flatMap((row) => row.cards).map((card) => card.key));
  });

  it('places derived spell choices on one standalone level-one card', () => {
    const source = summary();
    const configuration = buildClassConfiguration(source, snapshot, 3);
    const derived: ClassAdvancementSelection = { advancementId: 'derived:classes/test.yml:known-spells', kind: 'spell', selectionRole: 'known-spells', selected: [], count: 2 };
    configuration.choices = [derived];
    const cards = buildClassLevelCards(source, configuration);
    const matches = cards.flatMap((row) => row.cards.map((card) => ({ level: row.level, card }))).filter(({ card }) => card.choiceAdvancementIds.includes(derived.advancementId));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ level: 1, card: { key: `derived:${derived.advancementId}` } });
    const rendered: string[] = [];
    const dom = fakeDomRoot(rendered);
    const elements = renderClassLevelCards(dom.root as unknown as HTMLElement, cards, 1);
    expect(rendered).toContain('Known spells');
    expect(elements.has(`derived:${derived.advancementId}`)).toBe(true);
  });

  it('opens the first level with an incomplete choice', () => {
    const source = summary();
    const configuration = buildClassConfiguration(source, snapshot, 3);
    const levelOne = configuration.choices.find((choice) => choice.advancementId === 'choice1')!;
    const completedLevelOne = { ...levelOne, kind: 'trait' as const, selected: ['feature'] };
    const levelTwo = configuration.choices.find((choice) => choice.advancementId === 'unlinked')!;
    configuration.choices = [completedLevelOne, levelTwo];
    configuration.selections = configuration.selections.map((choice) => choice.advancementId === 'choice1' ? completedLevelOne : choice);
    expect(getFirstIncompleteClassLevel(configuration)).toBe(2);
    const dom = fakeDomRoot([]);
    renderClassLevelCards(dom.root as unknown as HTMLElement, buildClassLevelCards(source, configuration), getFirstIncompleteClassLevel(configuration)!);
    expect(dom.sections.map((section) => ({ label: section.summaryText, open: section.open }))).toEqual([
      { label: 'Level 1', open: false }, { label: 'Level 2', open: true }, { label: 'Level 3', open: false },
    ]);
  });
});

function fakeDomRoot(rendered: string[]): { root: Record<string, unknown>; sections: Array<Record<string, unknown>> } {
  const sections: Array<Record<string, unknown>> = [];
  const createNode = (): Record<string, unknown> => {
    const node: Record<string, unknown> = {
      open: false,
      createDiv: () => createNode(),
      createEl: (tag: string, options?: { text?: string }) => {
        if (options?.text !== undefined) rendered.push(options.text);
        if (tag === 'summary') node.summaryText = options?.text;
        const child = createNode();
        if (tag === 'details') sections.push(child);
        return child;
      },
    };
    return node;
  };
  return { root: createNode(), sections };
}
