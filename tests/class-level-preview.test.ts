import { describe, expect, it } from 'vitest';
import { createCharacterDocument, parseCharacterDocument, type CharacterDocument } from '../src/character-model';
import type { ClassSourceSummary } from '../src/character-sources';
import { buildClassConfiguration, restoreClassConfiguration } from '../src/class-configuration';
import { projectClassLevelPreviewDocument } from '../src/class-level-progression';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
const classPath = 'packs/_source/classes24/wizard/wizard.yml';
const classSummary: ClassSourceSummary = {
  source: { sourcePath: classPath, pack: 'dnd5e.classes24', type: 'class', id: 'wizard', identifier: 'wizard', name: 'Wizard' },
  ruleset: '2024', hitDie: 'd6', spellcasting: { progression: 'none' },
  advancements: [1, 2, 3].map((level) => ({ id: `choice-${level}`, type: 'Trait', level, title: `Choice ${level}`, hint: '', dependencies: [], raw: { configuration: { choices: 1, pool: ['skills:arc'] } } })),
};

function savedLevelThreeCharacter(): CharacterDocument {
  const base = createCharacterDocument('Ayla', snapshot);
  return {
    ...base,
    ruleset: '2024',
    step: 'background',
    origin: { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf' },
    classProgressions: [{
      class: { sourcePath: classPath, identifier: 'wizard', id: 'wizard' },
      targetLevel: 3,
      selections: [{ advancementId: 'choice-3', kind: 'trait', selected: ['skills:arc'], configuredPool: ['skills:arc'] }],
    }],
    classHitPoints: [
      { classSourcePath: classPath, level: 1, value: 'max' },
      { classSourcePath: classPath, level: 2, value: 'avg' },
      { classSourcePath: classPath, level: 3, value: 'avg' },
    ],
    background: { sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', identifier: 'soldier', id: 'soldier' },
  };
}

describe('class level preview document', () => {
  it('trims higher-level choices and HP for a lower preview without changing saved data', () => {
    const saved = savedLevelThreeCharacter();
    const savedBefore = structuredClone(saved);
    const preview = projectClassLevelPreviewDocument(saved, classSummary, 1);

    expect(parseCharacterDocument(preview)).toEqual(preview);
    expect(preview.classProgressions?.[0]?.targetLevel).toBe(1);
    expect(preview.classProgressions?.[0]?.selections).toEqual([]);
    expect(preview.classHitPoints).toEqual([{ classSourcePath: classPath, level: 1, value: 'max' }]);
    const rebuilt = buildClassConfiguration(classSummary, snapshot, 1);
    const restored = restoreClassConfiguration(preview.classProgressions![0]!, { class: preview.classProgressions![0]!.class, summary: classSummary, configuration: rebuilt });
    expect(restored.diagnostics).toEqual([]);
    expect(saved).toEqual(savedBefore);
  });
});
