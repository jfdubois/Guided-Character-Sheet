import { describe, expect, it } from 'vitest';
import { collectExpertiseProficiencies, filterExpertiseCandidates, getExpertisePool, isExpertiseEligibleValue, validateExpertiseSelections } from '../src/expertise-eligibility';
import { buildClassConfiguration, type ClassConfiguration } from '../src/class-configuration';
import type { BackgroundSourceSummary, ClassSourceSummary, SpeciesSourceSummary } from '../src/character-sources';
import type { SpeciesConfiguration } from '../src/species-configuration';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

const classReference = { sourcePath: 'classes/rogue.yml', pack: 'dnd5e.classes24', type: 'class' as const, id: 'rogue', identifier: 'rogue', name: 'Rogue' };
const classSummary: ClassSourceSummary = {
  source: classReference,
  ruleset: '2024',
  hitDie: 'd8',
  advancements: [
    { id: 'skill-proficiencies', type: 'Trait', level: 1, title: 'Skill proficiencies', hint: '', dependencies: [], raw: { configuration: { mode: 'default', choices: [{ count: 1, pool: ['skills:*'] }] } } },
    { id: 'fixed-skill', type: 'Trait', level: 1, title: 'Fixed skill', hint: '', dependencies: [], raw: { configuration: { grants: ['skills:dec'] } } },
    { id: 'expertise', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: [{ count: 2, pool: ['skills:*'] }] } } },
    { id: 'later-grant', type: 'Trait', level: 6, title: 'Later grant', hint: '', dependencies: [], raw: { configuration: { grants: ['skills:ste'] } } },
  ],
};

function classConfiguration(targetLevel = 1): ClassConfiguration {
  const selections = [
    { advancementId: 'skill-proficiencies', kind: 'trait' as const, configuredPool: ['skills:*'], selected: ['skills:arc'] },
    { advancementId: 'expertise', kind: 'expertise' as const, mode: 'expertise' as const, configuredPool: ['skills:*'], selected: [] },
  ];
  return {
    class: { sourcePath: classReference.sourcePath, identifier: 'rogue', id: 'rogue' },
    foundry: { systemVersion: '4.0.0', sourceBranch: 'main', sourceCommit: 'a'.repeat(40) },
    targetLevel,
    summary: classSummary,
    advancements: classSummary.advancements.filter((advancement) => advancement.level <= targetLevel),
    selections,
    choices: selections,
    passiveSelections: [],
    diagnostics: [],
  };
}

const background: BackgroundSourceSummary = {
  source: { sourcePath: 'backgrounds/acolyte.yml', pack: 'dnd5e.origins24', type: 'background', id: 'acolyte', name: 'Acolyte' },
  ruleset: '2024', skills: ['skills:ins'], languages: [], languageChoices: [], tools: ['tool:thief'], features: [], equipment: [],
};

const speciesSummary: SpeciesSourceSummary = {
  source: { sourcePath: 'species/elf.yml', pack: 'dnd5e.origins24', type: 'race', id: 'elf', name: 'Elf' },
  ruleset: '2024',
  advancements: [{ id: 'keen-senses', type: 'Trait', level: 1, hint: '', automatic: false, dependencies: [], raw: { configuration: { choices: [{ count: 1, pool: ['skills:per'] }] } } }],
};

const speciesConfiguration: SpeciesConfiguration = {
  origin: { sourcePath: speciesSummary.source.sourcePath, identifier: 'elf', id: 'elf' },
  foundry: { systemVersion: '4.0.0', sourceBranch: 'main', sourceCommit: 'a'.repeat(40) },
  grants: [],
  choices: [{ key: 'species:keen-senses', level: 1, label: 'Keen Senses', count: 1, source: { id: 'keen-senses', type: 'Trait' }, options: [{ value: 'skills:per', label: 'Perception', source: { id: 'skills:per', type: 'skill' } }], selected: ['skills:per'], raw: { configuration: { choices: [{ count: 1, pool: ['skills:per'] }] } } }],
  spellChoices: [],
  diagnostics: [],
};

describe('source-driven expertise eligibility', () => {
  it('intersects the 2024 Rogue pool with selected class, fixed class, background, and species proficiencies', () => {
    const proficiencies = collectExpertiseProficiencies({ classSummary, classConfiguration: classConfiguration(), background, speciesSummary, speciesConfiguration });
    const candidates = ['skills:arc', 'skills:dec', 'skills:ins', 'skills:per', 'skills:ste', 'skills:ath'].map((id) => ({ id }));

    expect(proficiencies).toEqual(expect.arrayContaining(['skills:arc', 'skills:dec', 'skills:ins', 'skills:per', 'tool:thief']));
    expect(proficiencies).not.toContain('skills:ste');
    expect(filterExpertiseCandidates(candidates, ['skills:*'], proficiencies).map(({ id }) => id)).toEqual(['skills:arc', 'skills:dec', 'skills:ins', 'skills:per']);
  });

  it('supports the source-defined 2014 Rogue Thieves’ Tools pool entry only when proficient', () => {
    const pool = ['tool:thief', 'skills:*'];
    expect(isExpertiseEligibleValue('tool:thief', pool, ['tool:thief'])).toBe(true);
    expect(isExpertiseEligibleValue('tool:thief', pool, ['skills:arc'])).toBe(false);
    expect(isExpertiseEligibleValue('tool:thief', ['skills:*'], ['tool:thief'])).toBe(false);

    const rogue2014: ClassSourceSummary = {
      ...classSummary,
      ruleset: '2014',
      proficiencies: { armor: [], weapons: [], tools: ['tool:thief'], savingThrows: [], languages: [], skills: [], choices: [] },
      advancements: [
        { id: 'thieves-tools', type: 'Trait', level: 1, title: 'Thieves’ tools', hint: '', dependencies: [], raw: { configuration: { grants: ['tool:thief'] } } },
        { id: 'expertise-2014', type: 'Trait', level: 1, title: 'Expertise', hint: '', dependencies: [], raw: { configuration: { mode: 'expertise', choices: [{ count: 2, pool }] } } },
      ],
    };
    const configuration = { ...classConfiguration(), summary: rogue2014, advancements: rogue2014.advancements, selections: [], choices: [] };
    expect(collectExpertiseProficiencies({ classSummary: rogue2014, classConfiguration: configuration })).toContain('tool:thief');
  });

  it('preserves the different authoritative expertise pools in the pinned Rogue sources', async () => {
    const index = createPinnedSourceIndex();
    const [rogue2014, rogue2024] = await Promise.all([
      index.getClassSummary('2014', 'packs/_source/classes/rogue.yml'),
      index.getClassSummary('2024', 'packs/_source/classes24/rogue/rogue.yml'),
    ]);
    const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
    const expertise2014 = buildClassConfiguration(rogue2014, snapshot, 1).advancements.find((advancement) => getExpertisePool(advancement).length > 0 && advancement.raw.configuration && (advancement.raw.configuration as Record<string, unknown>).mode === 'expertise');
    const expertise2024 = buildClassConfiguration(rogue2024, snapshot, 1).advancements.find((advancement) => getExpertisePool(advancement).length > 0 && advancement.raw.configuration && (advancement.raw.configuration as Record<string, unknown>).mode === 'expertise');

    expect(expertise2014 && getExpertisePool(expertise2014)).toEqual(['tool:thief', 'skills:*']);
    expect(expertise2024 && getExpertisePool(expertise2024)).toEqual(['skills:*']);
  });

  it('preserves duplicate and newly stale selections as actionable diagnostics after proficiency changes', () => {
    expect(validateExpertiseSelections(['skills:arc', 'skills:arc'], ['skills:*'], ['skills:arc'], () => 'Arcana')).toContain('Duplicate expertise selection: Arcana.');
    expect(validateExpertiseSelections(['skills:arc'], ['skills:*'], ['skills:ins'], () => 'Arcana')).toEqual([
      'Expertise requires proficiency in Arcana.',
      'Update the expertise selection for Arcana or restore that proficiency.',
    ]);
    expect(validateExpertiseSelections(['skills:per'], ['skills:arc'], ['skills:per'], () => 'Perception')[0]).toContain('outside the current source-defined pool');
  });

  it('does not activate proficiencies or expertise grants before their source level', () => {
    const proficiencies = collectExpertiseProficiencies({ classSummary, classConfiguration: classConfiguration(), background, speciesSummary, speciesConfiguration });
    expect(proficiencies).not.toContain('skills:ste');
    expect(isExpertiseEligibleValue('skills:ste', ['skills:*'], proficiencies)).toBe(false);
  });
});
