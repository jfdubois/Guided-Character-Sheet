import { describe, expect, it } from 'vitest';
import { getEligibleClassFeatures, getEligibleClassScales } from '../src/class-feature-eligibility';
import { createCharacterDocument, withRuleset } from '../src/character-model';
import type { ClassProgressionSelection } from '../src/class-configuration';
import type { ClassSourceSummary, FoundrySourceReference } from '../src/character-sources';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: '0'.repeat(40), systemVersion: '6.0.0' };
const classSource = reference('packs/_source/classes24/fighter/fighter.yml', 'fighter', 'Fighter');
const chosenFeature = reference('packs/_source/classes24/fighter/chosen.yml', 'chosen', 'Chosen feature');

function reference(sourcePath: string, id: string, name: string): FoundrySourceReference {
  return { sourcePath, pack: 'dnd5e.classes24', type: 'feat', id, name };
}

function progression(targetLevel: number, selections: ClassProgressionSelection['selections'] = []): ClassProgressionSelection {
  return { class: { sourcePath: classSource.sourcePath, identifier: 'fighter', id: classSource.id }, targetLevel, selections };
}

function document(value: ClassProgressionSelection) {
  return { ...withRuleset(createCharacterDocument('Eligibility', snapshot), '2024'), classProgressions: [value] };
}

function summary(): ClassSourceSummary {
  return {
    source: classSource,
    ruleset: '2024',
    hitDie: 'd10',
    advancements: [],
    features: [
      { advancementId: 'level-five', level: 5, source: reference('packs/_source/classes24/fighter/level-five.yml', 'level-five', 'Level-five feature') },
      { advancementId: 'nested', level: 3, source: chosenFeature, requiresChoice: { key: 'class:parent', value: 'Compendium.dnd5e.classes24.Item.chosen' } },
    ],
    scales: [{ advancementId: 'nested-scale', title: 'Chosen scale', identifier: 'chosen', level: 3, requiresChoice: { key: 'class:parent', value: 'Compendium.dnd5e.classes24.Item.chosen' }, values: new Map([[3, { type: 'number', value: 1 }]]), diagnostics: [] }],
  };
}

describe('class feature eligibility', () => {
  it('excludes a future feature until the owning class reaches its source level', () => {
    expect(getEligibleClassFeatures(document(progression(4)), summary()).map((feature) => feature.advancementId)).not.toContain('level-five');
    expect(getEligibleClassFeatures(document(progression(5)), summary()).map((feature) => feature.advancementId)).toContain('level-five');
  });

  it('requires the owning item choice for nested features and scales', () => {
    const unselected = document(progression(3, [{ advancementId: 'parent', kind: 'item', selected: [], configuredPool: [] }]));
    expect(getEligibleClassFeatures(unselected, summary()).map((feature) => feature.advancementId)).not.toContain('nested');
    expect(getEligibleClassScales(unselected, summary()).map((scale) => scale.advancementId)).not.toContain('nested-scale');

    const selected = document(progression(3, [{ advancementId: 'parent', kind: 'item', selected: [chosenFeature], configuredPool: [] }]));
    expect(getEligibleClassFeatures(selected, summary()).map((feature) => feature.advancementId)).toContain('nested');
    expect(getEligibleClassScales(selected, summary()).map((scale) => scale.advancementId)).toContain('nested-scale');
  });

  it('does not apply another class progression to the selected class source', () => {
    const other = { ...progression(20), class: { sourcePath: 'packs/_source/classes24/wizard/wizard.yml', identifier: 'wizard', id: 'wizard' } };
    expect(getEligibleClassFeatures(document(other), summary())).toEqual([]);
  });
});
