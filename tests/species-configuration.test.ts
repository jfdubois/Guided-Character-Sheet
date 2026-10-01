import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createCharacterDocument, withOrigin, withRuleset } from '../src/character-model';
import { buildSpeciesConfiguration, createSpeciesConfiguration, getAvailableSpeciesSpellChoices, isSpeciesChoiceAvailable, isSupportedSelector, restoreSpeciesConfiguration, setSpeciesChoice, setSpeciesSize, setSpeciesSpellChoice, setSpeciesSpellcastingAbility, toSpeciesConfigurationSelection, validateSpeciesConfiguration, type SpeciesConfigurationSource } from '../src/species-configuration';
import { createSourceIndex, type SourceReaderAdapter, type SpeciesSourceSummary } from '../src/character-sources';
import type { SpellChoice } from '../src/spell-configuration';
import type { FoundrySourceReference, FoundrySpellSummary } from '../src/foundry-source-catalog';

const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };
const origin = { sourcePath: 'packs/_source/origins24/species/elf.yml', identifier: 'elf', id: 'elf-id' };
const summary: SpeciesSourceSummary = { source: { sourcePath: origin.sourcePath, pack: 'dnd5e.origins24', type: 'race', id: origin.id, identifier: origin.identifier, name: 'Elf' }, ruleset: '2024', advancements: [] };

const explicitFeatUuid = 'Compendium.dnd5e.feats24.Item.explicitFeat';
const explicitSpellUuid = 'Compendium.dnd5e.spells24.Item.explicitSpell';
const outsideSpellReference: FoundrySourceReference = {
  sourcePath: 'packs/_source/spells24/1st-level/outside-spell.yml',
  pack: 'dnd5e.spells24',
  type: 'spell',
  id: 'outsideSpell',
  identifier: 'outside-spell',
  name: 'Outside Spell',
};

function sourceMemoryAdapter(files: Record<string, string>): SourceReaderAdapter {
  return {
    async exists(path) { return Object.keys(files).some((file) => file === path || file.startsWith(`${path}/`)); },
    async list(path) { return Object.keys(files).filter((file) => file.startsWith(`${path}/`)); },
    async read(path) { const value = files[path]; if (value === undefined) throw new Error(`missing ${path}`); return value; },
  };
}

async function buildExplicitPoolConfiguration(poolPlacement: 'top-level' | 'nested-choice' = 'top-level') {
  const root = 'sources';
  const speciesPath = 'packs/_source/origins24/species/explicit-human.yml';
  const spellPoolConfiguration = poolPlacement === 'nested-choice'
    ? `        choices:
          '0':
            count: 1
            pool: [${explicitSpellUuid}]
        pool: []`
    : `        choices: { "0": { count: 1 } }
        pool: [${explicitSpellUuid}]`;
  const index = createSourceIndex(sourceMemoryAdapter({
    [`${root}/${speciesPath}`]: `type: race
name: Explicit Human
system:
  identifier: explicit-human
  source: { rules: 2024 }
  advancement:
    - _id: feat-choice
      type: ItemChoice
      title: Versatile
      configuration:
        choices: { "0": { count: 1 } }
        pool: [${explicitFeatUuid}]
_id: explicitHuman`,
    [`${root}/packs/_source/feats24/explicit-magic.yml`]: `type: feat
name: Explicit Magic
system:
  source: { rules: 2024 }
  advancement:
    - _id: explicit-spell-choice
      type: ItemChoice
      title: Explicit Spell
      configuration:
        type: spell
${spellPoolConfiguration}
        restriction: { level: "1", list: [class:wizard] }
        spell: { ability: [int] }
_id: explicitFeat`,
    [`${root}/packs/_source/spells24/1st-level/explicit-spell.yml`]: `type: spell
name: Explicit Spell
system:
  identifier: explicit-spell
  source: { rules: 2024 }
  level: 1
  spellLists: [wizard]
  properties: []
_id: explicitSpell`,
    [`${root}/${outsideSpellReference.sourcePath}`]: `type: spell
name: Outside Spell
system:
  identifier: outside-spell
  source: { rules: 2024 }
  level: 1
  spellLists: [wizard]
  properties: []
_id: outsideSpell`,
  }), root);
  const source = await index.getSpeciesSummary('2024', speciesPath);
  return { source, configuration: buildSpeciesConfiguration(source, snapshot) };
}

async function buildAutomaticNestedSpellConfiguration() {
  const root = 'sources';
  const speciesPath = 'packs/_source/origins24/species/granted-magic.yml';
  const grantedFeatUuid = 'Compendium.dnd5e.feats24.Item.grantedMagic';
  const grantedSpellUuid = 'Compendium.dnd5e.spells24.Item.grantedCantrip';
  const index = createSourceIndex(sourceMemoryAdapter({
    [`${root}/${speciesPath}`]: `type: race
name: Granted Magic Species
system:
  identifier: granted-magic-species
  source: { rules: 2024 }
  advancement:
    - _id: granted-feat
      type: ItemGrant
      configuration:
        items:
          - uuid: ${grantedFeatUuid}
_id: grantedMagicSpecies`,
    [`${root}/packs/_source/feats24/granted-magic.yml`]: `type: feat
name: Granted Magic
system:
  source: { rules: 2024 }
  advancement:
    - _id: granted-cantrip-choice
      type: ItemChoice
      title: Granted Cantrip
      configuration:
        type: spell
        choices: { "0": { count: 1 } }
        pool: []
        restriction: { level: "0", list: [class:wizard] }
        spell: { ability: [int] }
_id: grantedMagic`,
    [`${root}/packs/_source/spells24/cantrips/granted-cantrip.yml`]: `type: spell
name: Granted Cantrip
system:
  identifier: granted-cantrip
  source: { rules: 2024 }
  level: 0
  spellLists: [wizard]
  properties: []
_id: grantedCantrip`,
  }), root);
  const source = await index.getSpeciesSummary('2024', speciesPath);
  return { source, configuration: buildSpeciesConfiguration(source, snapshot), grantedSpellUuid };
}

describe('species configuration', () => {
  it('projects fixed species spell grants separately and creates one shared ability choice', () => {
    const spell: FoundrySourceReference = { sourcePath: 'packs/_source/spells24/cantrips/lineage.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'lineage', name: 'Lineage Spell' };
    const built = buildSpeciesConfiguration({ ...summary, spellGrants: [{ advancementId: 'lineage-cantrip', level: 0, spells: [spell], abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'], preparation: 'always', uses: { requireSlot: false }, raw: { _id: 'lineage-cantrip', type: 'ItemGrant', configuration: { spell: { uses: { requireSlot: false } } } } }] }, snapshot);
    expect(built.spellChoices).toEqual([]);
    expect(built.spellGrants).toHaveLength(1);
    expect(built.spellcastingAbility).toMatchObject({ advancementIds: ['lineage-cantrip'], options: ['Intelligence', 'Wisdom', 'Charisma'] });
    const selected = setSpeciesSpellcastingAbility(built, 'species-spellcasting-ability', 'Wisdom');
    expect(toSpeciesConfigurationSelection(selected).spellcastingAbility).toEqual({ advancementIds: ['lineage-cantrip'], selected: 'Wisdom' });
  });
  it('derives and does not persist a fixed single-ability species choice', () => {
    const spell: FoundrySourceReference = { sourcePath: 'packs/_source/spells24/cantrips/lineage.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'lineage', name: 'Lineage Spell' };
    const built = buildSpeciesConfiguration({ ...summary, spellGrants: [{ advancementId: 'lineage-cantrip', level: 0, spells: [spell], abilityOptions: ['Wisdom'], raw: {} }] }, snapshot);
    expect(built.spellcastingAbility?.selected).toBe('Wisdom');
    expect(toSpeciesConfigurationSelection(built).spellcastingAbility).toBeUndefined();
  });
  it('reports stale fixed-spell provenance and missing multi-option ability on restore', () => {
    const spell: FoundrySourceReference = { sourcePath: 'packs/_source/spells24/cantrips/lineage.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'lineage', name: 'Lineage Spell' };
    const grant = { advancementId: 'current-grant', level: 0, spells: [spell], abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'], raw: {} };
    const source: SpeciesConfigurationSource = { origin, summary: { ...summary, spellGrants: [grant] }, grants: [], choices: [], snapshot };
    const selection = { ...toSpeciesConfigurationSelection(createSpeciesConfiguration(origin, snapshot)), spellcastingAbility: { advancementIds: ['stale-grant'], selected: '' } };
    const restored = restoreSpeciesConfiguration(selection, source);
    restored.spellcastingAbility!.selected = undefined;
    expect(restored.spellcastingAbility).toMatchObject({ advancementIds: ['stale-grant'] });
    expect(restored.spellcastingAbility?.selected).toBeUndefined();
    expect(validateSpeciesConfiguration(restored, source)).toEqual(expect.arrayContaining([
      'Changed species spellcasting ability provenance',
      'Species spellcasting ability is required',
    ]));
  });
  it('auto-resolves fixed sizes and persists only a chosen size identity and value', () => {
    const fixed = buildSpeciesConfiguration({ ...summary, size: { advancementId: 'fixed-size', level: 0, sizes: ['med'] } }, snapshot);
    expect(fixed.size).toEqual({ advancementId: 'fixed-size', level: 0, options: ['med'], selected: 'med' });
    expect(toSpeciesConfigurationSelection(fixed)).not.toHaveProperty('size');

    const selectable = buildSpeciesConfiguration({ ...summary, size: { advancementId: 'choice-size', level: 0, sizes: ['sm', 'med'] } }, snapshot);
    const selected = setSpeciesSize(selectable, 'sm');
    expect(toSpeciesConfigurationSelection(selected).size).toEqual({ advancementId: 'choice-size', selected: 'sm' });
    expect(toSpeciesConfigurationSelection(selected).size).not.toHaveProperty('options');
  });

  it('restores stale size data while reporting advancement and value validation errors', () => {
    const sourceSummary = { ...summary, size: { advancementId: 'current-size', level: 0, sizes: ['sm', 'med'] } };
    const source: SpeciesConfigurationSource = { origin, summary: sourceSummary, snapshot, grants: [], choices: [] };
    const saved = { ...createSpeciesConfiguration(origin, snapshot), size: { advancementId: 'old-size', level: 0, options: ['sm', 'med'], selected: 'tiny' } };
    const restored = restoreSpeciesConfiguration(toSpeciesConfigurationSelection(saved), source);
    expect(validateSpeciesConfiguration(restored, source)).toEqual(expect.arrayContaining([
      'Species size advancement is missing or changed',
      'Saved species size is not allowed by the current source',
    ]));
    const missing = { ...createSpeciesConfiguration(origin, snapshot), size: { advancementId: 'current-size', level: 0, options: ['sm', 'med'] } };
    expect(validateSpeciesConfiguration(missing, source)).toContain('Species size requires a choice');
  });

  it('keeps species spell selection serialization shape unchanged', () => {
    const configuration = createSpeciesConfiguration({ sourcePath: 'species.yml', identifier: 'species', id: 'species' }, { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' });
    configuration.spellChoices = [{
      key: 'species:list', advancementId: 'list', label: 'Spell list', count: 1, level: 0,
      spellLists: ['cleric'], selected: ['cleric'], abilityOptions: [], options: [], raw: { type: 'spell-list' },
    }, {
      key: 'species:spell', advancementId: 'spell', label: 'Spell', count: 1, level: 0,
      spellLists: ['cleric'], selected: [{ sourcePath: 'spell.yml', pack: 'dnd5e.spells', type: 'spell', id: 'guidance', name: 'Guidance' }], abilityOptions: ['wis'], selectedAbility: 'wis', options: [], raw: { type: 'spell' },
    }];
    expect(toSpeciesConfigurationSelection(configuration).spellChoices).toEqual([
      { key: 'species:list', advancementId: 'list', kind: 'spell-list', selected: ['cleric'] },
      { key: 'species:spell', advancementId: 'spell', kind: 'spell', selected: [{ sourcePath: 'spell.yml', pack: 'dnd5e.spells', type: 'spell', id: 'guidance', name: 'Guidance' }], selectedAbility: 'wis' },
    ]);
  });
  it('recognizes weapon selectors as supported species dependencies', () => {
    expect(isSupportedSelector('weapon:sim:handaxe')).toBe(true);
    expect(isSupportedSelector('weapon:mar:warhammer')).toBe(true);
  });

  it('derives labels from choice pools when Foundry leaves title and hint empty', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [
      { id: 'skills', type: 'Trait', level: 0, hint: '', automatic: false, dependencies: [{ uuid: 'skills:*', source: null }], raw: { configuration: { choices: [{ count: 2, pool: ['skills:*'] }] } } },
      { id: 'languages', type: 'Trait', level: 0, hint: '', automatic: false, dependencies: [{ uuid: 'languages:*', source: null }], raw: { configuration: { choices: [{ count: 1, pool: ['languages:*'] }] } } },
    ] }, snapshot);
    expect(result.choices.map((choice) => choice.label)).toEqual(['Skill proficiencies', 'Languages']);
  });

  it('does not expose an empty restricted spell choice as a required species choice', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const configuration = buildSpeciesConfiguration(await index.getSpeciesSummary('2014', 'packs/_source/races/elf/high-elf.yml'), snapshot);
    expect(configuration.choices.some((choice) => choice.label === 'Cantrip')).toBe(false);
    expect(configuration.spellChoices).toEqual([]);
    expect(configuration.diagnostics).toEqual([]);
  });

  it('extracts and projects actual pinned 2014 and 2024 species records', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const cases = [
      ['2014', 'packs/_source/races/dwarf/hill-dwarf.yml'],
      ['2024', 'packs/_source/origins24/species/human.yml'],
    ] as const;
    for (const [ruleset, sourcePath] of cases) {
      const actual = await index.getSpeciesSummary(ruleset, sourcePath);
      const projected = buildSpeciesConfiguration(actual, snapshot);
      expect(actual.source.sourcePath).toBe(sourcePath);
      expect(actual.advancements.length).toBeGreaterThan(0);
      expect(projected.origin.sourcePath).toBe(sourcePath);
      expect(projected.grants.every((grant) => grant.source.id && grant.source.type)).toBe(true);
      if (ruleset === '2014') expect(projected.diagnostics).toEqual([]);
      expect(projected.choices.every((choice) => choice.options.every((option) => option.source.id && option.source.type))).toBe(true);
      expect(JSON.stringify(projected)).not.toContain('folder');
      expect(JSON.stringify(projected)).not.toContain('_stats');
      expect(projected.spellChoices.every((choice) => choice.options.every((option) => !('effects' in option.source)))).toBe(true);
    }
  });

  it('does not expose the Skilled feat choices until Human Versatile selects Skilled', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/human.yml');
    const configuration = buildSpeciesConfiguration(summary, snapshot);

    expect(configuration.choices.filter((choice) => isSpeciesChoiceAvailable(choice, configuration)).map((choice) => choice.label)).toEqual(['Skillful', 'Versatile']);

    const versatile = configuration.choices.find((choice) => choice.label === 'Versatile');
    const skilled = versatile?.options.find((option) => option.label === 'Skilled');
    expect(versatile).toBeDefined();
    expect(skilled).toBeDefined();
    const selected = setSpeciesChoice(configuration, versatile!.key, [skilled!.value]);
    const available = selected.choices.filter((choice) => isSpeciesChoiceAvailable(choice, selected));
    expect(available.map((choice) => choice.label)).toEqual(['Skillful', 'Versatile', 'Skill proficiencies']);
    expect(available.find((choice) => choice.label === 'Skill proficiencies')?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Calligrapher's Supplies" }),
    ]));
    expect(selected.diagnostics).not.toEqual(expect.arrayContaining([expect.stringContaining('tool:*')]));
  });

  it('projects pinned Magic Initiate spell restrictions with the Human Versatile parent', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const source = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/human.yml');
    const spellAdvancements = source.advancements.filter((advancement) => advancement.raw.title === 'Two Cantrips' || advancement.raw.title === 'Level 1 Spell');

    expect(spellAdvancements.map((advancement) => ({
      title: advancement.raw.title,
      spellLevel: advancement.spellLevel,
      spellLists: advancement.spellLists,
      abilityOptions: advancement.abilityOptions,
      requiresChoice: advancement.requiresChoice,
    }))).toEqual([
      {
        title: 'Two Cantrips',
        spellLevel: 0,
        spellLists: ['cleric', 'druid', 'wizard'],
        abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'],
        requiresChoice: { key: 'species:KB8IQLwyuL6SOFnv', value: 'Compendium.dnd5e.feats24.Item.phbftMagicInitia' },
      },
      {
        title: 'Level 1 Spell',
        spellLevel: 1,
        spellLists: ['cleric', 'druid', 'wizard'],
        abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'],
        requiresChoice: { key: 'species:KB8IQLwyuL6SOFnv', value: 'Compendium.dnd5e.feats24.Item.phbftMagicInitia' },
      },
    ]);
    expect(spellAdvancements.every((advancement) => advancement.dependencies.some((dependency) => dependency.source?.type === 'spell'))).toBe(true);
  });

  it('retains a spell-list selector and both pinned Magic Initiate spell choices', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const source = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/human.yml');
    const configuration = buildSpeciesConfiguration(source, snapshot);
    const spellChoices = Reflect.get(configuration, 'spellChoices');

    expect(spellChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Spell list', count: 1, selected: [], spellLists: ['cleric', 'druid', 'wizard'] }),
      expect.objectContaining({ label: 'Two Cantrips', count: 2, level: 0, selected: [], spellLists: ['cleric', 'druid', 'wizard'], abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'] }),
      expect.objectContaining({ label: 'Level 1 Spell', count: 1, level: 1, selected: [], spellLists: ['cleric', 'druid', 'wizard'], abilityOptions: ['Intelligence', 'Wisdom', 'Charisma'] }),
    ]));
    expect(spellChoices).toHaveLength(3);
  });

  it('projects an explicit nested spell pool as a source-backed SpellChoice without broadening it', async () => {
    const { configuration } = await buildExplicitPoolConfiguration();
    const spellChoice = configuration.spellChoices.find((choice) => choice.label === 'Explicit Spell');

    expect(configuration.choices.some((choice) => choice.label === 'Explicit Spell')).toBe(false);
    expect(spellChoice).toMatchObject({
      count: 1,
      level: 1,
      spellLists: ['wizard'],
      abilityOptions: ['Intelligence'],
      options: [{
        source: {
          sourcePath: 'packs/_source/spells24/1st-level/explicit-spell.yml',
          pack: 'dnd5e.spells24',
          type: 'spell',
          id: 'explicitSpell',
          identifier: 'explicit-spell',
          name: 'Explicit Spell',
          level: 1,
          spellLists: ['wizard'],
          ritual: false,
        },
      }],
    });
    expect(spellChoice?.options).toHaveLength(1);
  });

  it('rejects a source-backed spell that is outside an explicit nested pool', async () => {
    const { configuration } = await buildExplicitPoolConfiguration();
    const withFeat = setSpeciesChoice(configuration, 'species:feat-choice', [explicitFeatUuid]);
    const listChoice = getAvailableSpeciesSpellChoices(withFeat).find((choice) => choice.label === 'Spell list');
    expect(listChoice).toBeDefined();
    const withList = setSpeciesSpellChoice(withFeat, listChoice!.key, ['wizard']);
    const spellChoice = getAvailableSpeciesSpellChoices(withList).find((choice) => choice.label === 'Explicit Spell');
    expect(spellChoice).toBeDefined();

    expect(() => setSpeciesSpellChoice(withList, spellChoice!.key, [outsideSpellReference])).toThrow('without an authoritative option');
  });

  it('persists the full Foundry reference selected from an explicit nested spell pool', async () => {
    const { configuration } = await buildExplicitPoolConfiguration();
    const withFeat = setSpeciesChoice(configuration, 'species:feat-choice', [explicitFeatUuid]);
    const listChoice = getAvailableSpeciesSpellChoices(withFeat).find((choice) => choice.label === 'Spell list')!;
    const withList = setSpeciesSpellChoice(withFeat, listChoice.key, ['wizard']);
    const spellChoice = getAvailableSpeciesSpellChoices(withList).find((choice) => choice.label === 'Explicit Spell')!;
    const selected = setSpeciesSpellcastingAbility(
      setSpeciesSpellChoice(withList, spellChoice.key, [spellChoice.options[0].source]),
      spellChoice.key,
      'Intelligence',
    );

    expect(toSpeciesConfigurationSelection(selected).spellChoices).toContainEqual({
      key: spellChoice.key,
      advancementId: 'explicit-spell-choice',
      kind: 'spell',
      selected: [{
        sourcePath: 'packs/_source/spells24/1st-level/explicit-spell.yml',
        pack: 'dnd5e.spells24',
        type: 'spell',
        id: 'explicitSpell',
        identifier: 'explicit-spell',
        name: 'Explicit Spell',
      }],
      selectedAbility: 'Intelligence',
    });
  });

  it('projects and persists an automatically granted nested spell as a direct SpellChoice', async () => {
    const { configuration } = await buildAutomaticNestedSpellConfiguration();
    const available = getAvailableSpeciesSpellChoices(configuration);
    const spellChoice = available.find((choice) => choice.label === 'Granted Cantrip');

    expect(configuration.spellChoices.filter((choice) => choice.label === 'Spell list')).toEqual([]);
    expect(spellChoice).toMatchObject({ count: 1, level: 0, spellLists: ['wizard'], abilityOptions: ['Intelligence'] });
    expect(spellChoice).not.toHaveProperty('parent');
    const selected = setSpeciesSpellcastingAbility(
      setSpeciesSpellChoice(configuration, spellChoice!.key, [spellChoice!.options[0].source]),
      spellChoice!.key,
      'Intelligence',
    );
    expect(toSpeciesConfigurationSelection(selected).spellChoices).toContainEqual({
      key: 'species:granted-cantrip-choice',
      advancementId: 'granted-cantrip-choice',
      kind: 'spell',
      selected: [{
        sourcePath: 'packs/_source/spells24/cantrips/granted-cantrip.yml',
        pack: 'dnd5e.spells24',
        type: 'spell',
        id: 'grantedCantrip',
        identifier: 'granted-cantrip',
        name: 'Granted Cantrip',
      }],
      selectedAbility: 'Intelligence',
    });
  });

  it('treats a nested choices pool as explicit and never broadens its resolved options', async () => {
    const { source, configuration } = await buildExplicitPoolConfiguration('nested-choice');
    const advancement = source.advancements.find((entry) => entry.id === 'explicit-spell-choice');
    const spellChoice = configuration.spellChoices.find((choice) => choice.label === 'Explicit Spell');

    expect(advancement?.dependencies.map((dependency) => dependency.uuid)).toEqual([explicitSpellUuid]);
    expect(spellChoice?.options.map((option) => option.source.id)).toEqual(['explicitSpell']);
  });

  it('groups nested spell selectors by parent and normalized allowed-list set', () => {
    const parentSource: FoundrySourceReference = { sourcePath: 'packs/_source/feats24/grouped-magic.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'groupedMagic', name: 'Grouped Magic' };
    const parent = { key: 'species:feat-choice', value: explicitFeatUuid };
    const nestedSpell = (id: string, lists: string[]): SpeciesSourceSummary['advancements'][number] => {
      const spellSource: FoundrySpellSummary = { ...outsideSpellReference, id, name: id, level: 1, spellLists: [...lists], ruleset: '2024', ritual: false };
      return {
        id,
        type: 'ItemChoice',
        level: 0,
        hint: '',
        automatic: false,
        dependencies: [{ uuid: `${explicitSpellUuid}.${id}`, source: spellSource }],
        spellLevel: 1,
        spellLists: lists,
        abilityOptions: ['Intelligence'],
        requiresChoice: parent,
        raw: { _id: id, type: 'ItemChoice', title: id, configuration: { type: 'spell', choices: { '0': { count: 1 } }, pool: [`${explicitSpellUuid}.${id}`], restriction: { level: '1', list: lists.map((list) => `class:${list}`) }, spell: { ability: ['int'] } } },
      };
    };
    const configuration = buildSpeciesConfiguration({ ...summary, advancements: [
      { id: 'feat-choice', type: 'ItemChoice', level: 0, hint: '', automatic: false, dependencies: [{ uuid: explicitFeatUuid, source: parentSource }], raw: { _id: 'feat-choice', type: 'ItemChoice', configuration: { choices: { '0': { count: 1 } }, pool: [explicitFeatUuid] } } },
      nestedSpell('wizard-cleric-a', ['wizard', 'cleric']),
      nestedSpell('wizard-cleric-b', ['cleric', 'wizard']),
      nestedSpell('druid', ['druid']),
    ] }, snapshot);
    const selectors = configuration.spellChoices.filter((choice) => choice.label === 'Spell list');
    const childParents = configuration.spellChoices.filter((choice) => choice.label !== 'Spell list').map((choice) => choice.parent?.key);

    expect(selectors).toHaveLength(2);
    expect(new Set(selectors.map((choice) => choice.key)).size).toBe(2);
    expect(childParents[0]).toBe(childParents[1]);
    expect(childParents[2]).not.toBe(childParents[0]);
  });

  it('keeps synthetic spell selectors distinct for different values of the same parent choice', () => {
    const parentSource: FoundrySourceReference = { sourcePath: 'packs/_source/feats24/shared-source.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'sharedSource', name: 'Shared Source' };
    const secondParentValue = 'Compendium.dnd5e.feats24.Item.explicitFeatAlias';
    const nestedSpell = (id: string, parentValue: string): SpeciesSourceSummary['advancements'][number] => {
      const spellSource: FoundrySpellSummary = { ...outsideSpellReference, id, name: id, level: 1, spellLists: ['wizard'], ruleset: '2024', ritual: false };
      return {
        id,
        type: 'ItemChoice',
        level: 0,
        hint: '',
        automatic: false,
        dependencies: [{ uuid: `${explicitSpellUuid}.${id}`, source: spellSource }],
        spellLevel: 1,
        spellLists: ['wizard'],
        abilityOptions: ['Intelligence'],
        requiresChoice: { key: 'species:feat-choice', value: parentValue },
        raw: { _id: id, type: 'ItemChoice', title: id, configuration: { type: 'spell', choices: { '0': { count: 1 } }, pool: [`${explicitSpellUuid}.${id}`], restriction: { level: '1', list: ['class:wizard'] }, spell: { ability: ['int'] } } },
      };
    };
    const configuration = buildSpeciesConfiguration({ ...summary, advancements: [
      { id: 'feat-choice', type: 'ItemChoice', level: 0, hint: '', automatic: false, dependencies: [{ uuid: explicitFeatUuid, source: parentSource }, { uuid: secondParentValue, source: parentSource }], raw: { _id: 'feat-choice', type: 'ItemChoice', configuration: { choices: { '0': { count: 1 } }, pool: [explicitFeatUuid, secondParentValue] } } },
      nestedSpell('first-parent-value', explicitFeatUuid),
      nestedSpell('second-parent-value', secondParentValue),
    ] }, snapshot);
    const selectors = configuration.spellChoices.filter((choice) => choice.label === 'Spell list');
    const children = configuration.spellChoices.filter((choice) => choice.label !== 'Spell list');

    expect(selectors.map((choice) => choice.parent?.values)).toEqual([[explicitFeatUuid], [secondParentValue]]);
    expect(new Set(selectors.map((choice) => choice.key)).size).toBe(2);
    expect(children[0].parent?.key).not.toBe(children[1].parent?.key);
  });

  it('reveals Magic Initiate choices in dependency order and clears spells while retaining the ability when the list changes', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const configuration = buildSpeciesConfiguration(await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/human.yml'), snapshot);
    expect(getAvailableSpeciesSpellChoices(configuration)).toEqual([]);
    const versatile = configuration.choices.find((choice) => choice.label === 'Versatile');
    const magicInitiate = versatile?.options.find((option) => option.label === 'Magic Initiate');
    expect(versatile).toBeDefined();
    expect(magicInitiate).toBeDefined();
    const withFeat = setSpeciesChoice(configuration, versatile!.key, [magicInitiate!.value]);
    expect(getAvailableSpeciesSpellChoices(withFeat).map((choice) => choice.label)).toEqual(['Spell list']);

    const listChoice = getAvailableSpeciesSpellChoices(withFeat)[0];
    const withClericList = setSpeciesSpellChoice(withFeat, listChoice.key, ['cleric']);
    const clericChoices = getAvailableSpeciesSpellChoices(withClericList);
    expect(clericChoices.map((choice) => choice.label)).toEqual(['Spell list', 'Two Cantrips', 'Level 1 Spell']);
    const cantrips = clericChoices.find((choice) => choice.label === 'Two Cantrips')!;
    const levelOne = clericChoices.find((choice) => choice.label === 'Level 1 Spell')!;
    expect(cantrips.options.every((option) => Array.isArray(Reflect.get(option.source, 'spellLists')) && (Reflect.get(option.source, 'spellLists') as string[]).includes('cleric'))).toBe(true);
    expect(levelOne.options.every((option) => Array.isArray(Reflect.get(option.source, 'spellLists')) && (Reflect.get(option.source, 'spellLists') as string[]).includes('cleric'))).toBe(true);

    const withCantrips = setSpeciesSpellChoice(withClericList, cantrips.key, cantrips.options.slice(0, 2).map((option) => option.source));
    const withLevelOne = setSpeciesSpellChoice(withCantrips, levelOne.key, [levelOne.options[0].source]);
    const withAbility = setSpeciesSpellcastingAbility(withLevelOne, cantrips.key, 'Wisdom');
    const changedList = setSpeciesSpellChoice(withAbility, listChoice.key, ['druid']);
    expect(changedList.spellChoices.filter((choice) => choice.label !== 'Spell list').every((choice) => choice.selected.length === 0)).toBe(true);
    expect(changedList.spellChoices.filter((choice) => choice.label !== 'Spell list').every((choice) => choice.selectedAbility === 'Wisdom')).toBe(true);
    expect(configuration.spellChoices.every((choice) => choice.selected.length === 0)).toBe(true);
  });

  it('creates an empty configuration with source provenance', () => {
    expect(createSpeciesConfiguration(origin, snapshot)).toEqual({
      origin,
      foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'a'.repeat(40) },
      grants: [],
      choices: [],
      spellChoices: [],
      diagnostics: [],
    });
  });

  it('projects automatic grants and supported choices for both rulesets', () => {
    for (const ruleset of ['2014', '2024'] as const) {
      const source: SpeciesSourceSummary = { ...summary, ruleset, source: { ...summary.source, sourcePath: ruleset === '2014' ? 'packs/_source/races/dwarf.yml' : origin.sourcePath }, advancements: [
        { id: 'grant', type: 'ItemGrant', level: 1, hint: 'Darkvision', automatic: true, dependencies: [{ uuid: 'grant-uuid', source: { id: 'darkvision', type: 'feat', name: 'Darkvision', sourcePath: 'packs/_source/feats/darkvision.yml', pack: 'dnd5e.feats' } }], raw: { _id: 'grant', type: 'ItemGrant', configuration: { uuid: 'grant-uuid' } } },
        { id: 'choice', type: 'Trait', level: 1, hint: 'Choose skills', automatic: false, dependencies: [{ uuid: 'skill-a', source: { id: 'skill-a', type: 'skill', name: 'Arcana', sourcePath: 'packs/_source/skills/arcana.yml', pack: 'dnd5e.skills' } }, { uuid: 'skill-b', source: { id: 'skill-b', type: 'skill', name: 'History', sourcePath: 'packs/_source/skills/history.yml', pack: 'dnd5e.skills' } }], raw: { _id: 'choice', type: 'Trait', configuration: { choices: 1, pool: ['skill-a', 'skill-b'] } } },
      ] };
      const result = buildSpeciesConfiguration(source, snapshot);
      expect(result.grants).toHaveLength(1);
      expect(result.choices[0]).toMatchObject({ count: 1, options: [{ label: 'Arcana' }, { label: 'History' }] });
      expect(result.grants[0].raw).not.toHaveProperty('configuration.uuid', 'complete record');
    }
  });

  it('derives Dragonborn resistance from the selected Draconic Ancestry', () => {
    const configuration = buildSpeciesConfiguration({ ...summary, advancements: [
      { id: 'ancestry', type: 'ItemChoice', level: 0, hint: 'Choose a dragon', automatic: false, dependencies: [{ uuid: 'black', source: { id: 'black', type: 'feat', name: 'Black Breath Weapon', sourcePath: 'packs/_source/races/dragonborn/black.yml', pack: 'dnd5e.races' } }], raw: { _id: 'ancestry', title: 'Draconic Ancestry', configuration: { choices: 1, pool: ['black'] } } },
      { id: 'resistance', type: 'Trait', level: 0, hint: 'You have resistance to the damage type associated with your draconic ancestry.', automatic: false, dependencies: [{ uuid: 'dr:acid', source: null, reason: 'unresolved selector' }], raw: { _id: 'resistance', configuration: { choices: [{ count: 1, pool: ['dr:acid'] }] } } },
    ] }, snapshot);
    const selected = setSpeciesChoice({ ...configuration, choices: configuration.choices.map((choice) => choice.key === 'species:ancestry' ? { ...choice, options: [{ ...choice.options[0], damageTypes: ['acid'] }] } : choice) }, 'species:ancestry', ['black']);
    expect(selected.choices.find((choice) => choice.key === 'species:resistance')?.selected).toEqual(['dr:acid']);
  });

  it('reports unsupported and unresolved advancement dependencies with source context', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [
      { id: 'bad', type: 'AbilityScoreImprovement', level: 1, hint: '', automatic: false, dependencies: [], raw: { _id: 'bad', type: 'AbilityScoreImprovement' } },
      { id: 'missing', type: 'ItemGrant', level: 1, hint: '', automatic: true, dependencies: [{ uuid: 'missing-uuid', source: null, reason: 'unresolved' }], raw: { _id: 'missing', type: 'ItemGrant' } },
    ] }, snapshot);
    expect(result.choices).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('packs/_source/origins24/species/elf.yml'),
      expect.stringContaining('bad (AbilityScoreImprovement)'),
      expect.stringContaining('missing-uuid'),
    ]));
  });

  it('maps nested pools and non-UUID selectors into category-aware options', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [
      { id: 'trait', type: 'Trait', level: 1, hint: 'Choose proficiencies', automatic: false, dependencies: [
        { uuid: 'skills:ins', source: null, reason: 'selector' },
        { uuid: 'languages:elvish', source: null, reason: 'selector' },
        { uuid: 'abilities:int', source: null, reason: 'selector' },
        { uuid: 'feats:magic-initiate', source: null, reason: 'selector' },
      ], raw: { _id: 'trait', type: 'Trait', configuration: { choices: [{ count: 2, pool: ['skills:ins', 'languages:elvish', 'abilities:int', 'feats:magic-initiate'] }] } } },
    ] }, snapshot);
    expect(result.choices[0]).toMatchObject({ count: 2, options: [
      { value: 'skills:ins', label: 'Insight', source: { type: 'skill' } },
      { value: 'languages:elvish', source: { type: 'language' } },
      { value: 'abilities:int', source: { type: 'ability' } },
      { value: 'feats:magic-initiate', source: { type: 'feat' } },
    ] });
    expect(result.diagnostics).toEqual([]);
  });

  it('uses readable Foundry skill names for skill selectors', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [{ id: 'keen', type: 'Trait', level: 0, hint: 'Choose a skill', automatic: false, dependencies: [
      { uuid: 'skills:ins', source: null, reason: 'unresolved selector' },
      { uuid: 'skills:prc', source: null, reason: 'unresolved selector' },
      { uuid: 'skills:sur', source: null, reason: 'unresolved selector' },
    ], raw: { _id: 'keen', type: 'Trait', configuration: { choices: [{ count: 1, pool: ['skills:ins', 'skills:prc', 'skills:sur'] }] } } }] }, snapshot);
    expect(result.choices[0]?.options.map((option) => option.label)).toEqual(['Insight', 'Perception', 'Survival']);
  });

  it('supports multi-part language and tool selectors used by 2014 species', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [
      { id: 'fixed', type: 'Trait', level: 0, hint: '', automatic: true, dependencies: [
        { uuid: 'languages:standard:common', source: null, reason: 'selector' },
        { uuid: 'tool:art:tinker', source: null, reason: 'selector' },
      ], raw: { _id: 'fixed', type: 'Trait', configuration: { grants: ['languages:standard:common', 'tool:art:tinker'], choices: [] } } },
      { id: 'choice', type: 'Trait', level: 0, hint: 'Choose a tool', automatic: false, dependencies: [
        { uuid: 'tool:art:brewer', source: null, reason: 'selector' },
        { uuid: 'tool:art:mason', source: null, reason: 'selector' },
      ], raw: { _id: 'choice', type: 'Trait', configuration: { choices: [{ count: 1, pool: ['tool:art:brewer', 'tool:art:mason'] }] } } },
    ] }, snapshot);

    expect(result.grants.map((grant) => grant.label)).toEqual(['Common', 'Tinker']);
    expect(result.choices[0]?.options.map((option) => option.label)).toEqual(['Brewer', 'Mason']);
    expect(result.diagnostics).toEqual([]);
  });

  it('expands the Foundry all-skills selector into the supported skill options', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [{
      id: 'skills', type: 'Trait', level: 0, hint: 'Choose skills', automatic: false,
      dependencies: [{ uuid: 'skills:*', source: null, reason: 'selector' }],
      raw: { _id: 'skills', type: 'Trait', configuration: { choices: [{ count: 2, pool: ['skills:*'] }] } },
    }] }, snapshot);

    expect(result.choices[0]?.options).toHaveLength(18);
    expect(result.choices[0]?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'skills:acr', label: 'Acrobatics' }),
      expect.objectContaining({ value: 'skills:sur', label: 'Survival' }),
    ]));
    expect(result.diagnostics).toEqual([]);
  });

  it('expands a language wildcard into selectable options', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [{
      id: 'language', type: 'Trait', level: 0, hint: 'Choose a language', automatic: false,
      dependencies: [{ uuid: 'languages:*', source: null, reason: 'selector' }],
      raw: { _id: 'language', type: 'Trait', configuration: { choices: [{ count: 1, pool: ['languages:*'] }] } },
    }] }, snapshot);

    expect(result.choices[0]?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'languages:standard:common', label: 'Common' }),
    ]));
    expect(result.diagnostics).not.toEqual(expect.arrayContaining([
      expect.stringContaining('languages:*'),
    ]));
  });

  it('keeps automatic non-grant advancements out of grant diagnostics', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [{ id: 'size', type: 'Size', level: 1, hint: '', automatic: true, dependencies: [], raw: { _id: 'size', type: 'Size', configuration: { sizes: ['med'] } } }] }, snapshot);
    expect(result.grants).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('matches pinned Foundry advancement shapes for 2014 and 2024', () => {
    const pinnedShapes = [
      { ruleset: '2014' as const, path: 'packs/_source/races/elf/high-elf.yml', advancements: [
        { id: 'trait', type: 'Trait', level: 0, hint: '', automatic: false, dependencies: [{ uuid: 'skills:arc', source: null, reason: 'unresolved selector' }, { uuid: 'skills:ins', source: null, reason: 'unresolved selector' }], raw: { _id: 'trait', type: 'Trait', configuration: { grants: [], choices: [{ count: 1, pool: ['skills:arc', 'skills:ins'] }] } } },
      ] },
      { ruleset: '2024' as const, path: 'packs/_source/origins24/species/human.yml', advancements: [
        { id: 'trait', type: 'Trait', level: 0, hint: '', automatic: false, dependencies: [{ uuid: 'skills:*', source: null, reason: 'unresolved selector' }], raw: { _id: 'trait', type: 'Trait', configuration: { grants: [], choices: [{ count: 1, pool: ['skills:*'] }] } } },
        { id: 'feat', type: 'ItemChoice', level: 0, hint: '', automatic: false, dependencies: [{ uuid: 'Compendium.dnd5e.feats24.Item.phbftAlert000000', source: { id: 'phbftAlert000000', type: 'feat', name: 'Alert', sourcePath: 'packs/_source/feats24/alert.yml', pack: 'dnd5e.feats24' } }], raw: { _id: 'feat', type: 'ItemChoice', configuration: { choices: { '0': { count: 1 } }, type: 'feat', pool: ['Compendium.dnd5e.feats24.Item.phbftAlert000000'] } } },
      ] },
    ];
    for (const shape of pinnedShapes) {
      const result = buildSpeciesConfiguration({ ...summary, ruleset: shape.ruleset, source: { ...summary.source, sourcePath: shape.path }, advancements: shape.advancements }, snapshot);
      expect(result.choices.some((choice) => choice.count === 1)).toBe(true);
      expect(JSON.stringify(result)).not.toContain('folder');
      expect(JSON.stringify(result)).not.toContain('_stats');
    }
  });

  it('distinguishes malformed selectors from syntactically valid unsupported selectors', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [{ id: 'selectors', type: 'Trait', level: 1, hint: '', automatic: false, dependencies: [
      { uuid: 'skills:', source: null, reason: 'malformed source UUID' },
      { uuid: 'damage:acid', source: null, reason: 'unresolved selector' },
    ], raw: { _id: 'selectors', type: 'Trait', configuration: { choices: [{ count: 2, pool: ['skills:', 'damage:acid'] }] } } }] }, snapshot);
    expect(result.choices).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining('malformed selector'), expect.stringContaining('unsupported selector')]));
  });

  it('models automatic grants and choices with stable source references', () => {
    const source: SpeciesConfigurationSource = {
      origin,
      summary,
      grants: [{ key: 'grant:darkvision', level: 1, label: 'Darkvision', source: { id: 'grant-id', type: 'ItemGrant' }, raw: { _id: 'grant-id', type: 'ItemGrant' } }],
      choices: [{ key: 'choice:language', level: 1, label: 'Choose a language', count: 1, source: { id: 'choice-id', type: 'Choice' }, options: [{ value: 'elvish', label: 'Elvish', source: { id: 'elvish-id', type: 'Item', name: 'Elvish' } }], selected: [], raw: { _id: 'choice-id', type: 'Choice' } }],
    };
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), grants: source.grants, choices: source.choices };
    expect(configuration.grants[0].raw).toMatchObject({ _id: 'grant-id' });
    expect(configuration.choices[0]).toMatchObject({ key: 'choice:language', count: 1, selected: [] });
    expect(validateSpeciesConfiguration(configuration, source)).toEqual(['Choice "choice:language" requires 1 value']);
  });

  it('updates multiple selected values immutably', () => {
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), choices: [{ key: 'choice:skills', level: 1, label: 'Choose skills', count: 2, source: { id: 'skills-id', type: 'Choice' }, options: [{ value: 'arcana', label: 'Arcana', source: { id: 'arcana-id', type: 'Skill', name: 'Arcana' } }, { value: 'history', label: 'History', source: { id: 'history-id', type: 'Skill', name: 'History' } }], selected: [], raw: {} }] };
    const updated = setSpeciesChoice(configuration, 'choice:skills', ['arcana', 'history']);
    expect(updated.choices[0].selected).toEqual(['arcana', 'history']);
    expect(configuration.choices[0].selected).toEqual([]);
  });

  it('accepts a valid single-choice selection', () => {
    const choice = { key: 'choice:language', level: 1, label: 'Choose a language', count: 1, source: { id: 'choice-id', type: 'Choice' }, options: [{ value: 'elvish', label: 'Elvish', source: { id: 'elvish-id', type: 'Item', name: 'Elvish' } }], selected: [], raw: {} };
    const source: SpeciesConfigurationSource = { origin, summary, grants: [], choices: [choice] };
    const selected = setSpeciesChoice({ ...createSpeciesConfiguration(origin, snapshot), choices: [choice] }, choice.key, ['elvish']);
    expect(validateSpeciesConfiguration(selected, source)).toEqual([]);
  });

  it('rejects unknown keys, disallowed values, and invalid cardinality', () => {
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), choices: [{ key: 'choice:language', level: 1, label: 'Choose a language', count: 1, source: { id: 'choice-id', type: 'Choice' }, options: [{ value: 'elvish', label: 'Elvish', source: { id: 'elvish-id', type: 'Item', name: 'Elvish' } }], selected: ['elvish'], raw: {} }] };
    expect(() => setSpeciesChoice(configuration, 'missing', ['elvish'])).toThrow('Unknown species choice');
    expect(() => setSpeciesChoice(configuration, 'choice:language', ['common'])).toThrow('Invalid species choice value');
    expect(() => setSpeciesChoice(configuration, 'choice:language', ['elvish', 'elvish'])).toThrow('Invalid species choice cardinality');
  });

  it('preserves character and source provenance references', () => {
    const document = withOrigin(withRuleset(createCharacterDocument('Ayla', snapshot), '2024'), origin);
    const configuration = createSpeciesConfiguration(document.origin!, snapshot);
    expect(configuration).toMatchObject({ origin: document.origin, foundry: document.foundry });
  });

  it('reports missing choices, source mismatches, invalid references, and grant mismatches', () => {
    const source: SpeciesConfigurationSource = { origin, summary, grants: [{ key: 'grant:darkvision', level: 1, label: 'Darkvision', source: { id: 'grant-id', type: 'ItemGrant' }, raw: {} }], choices: [] };
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), origin: { ...origin, id: 'other-id' }, choices: [{ key: 'choice:missing', level: 1, label: 'Missing', count: 1, source: { id: '', type: '' }, options: [], selected: [], raw: {} }], grants: [] };
    expect(validateSpeciesConfiguration(configuration, source)).toEqual(expect.arrayContaining([
      'Species origin does not match source summary',
      'Invalid species choice reference: choice:missing',
      'Missing species grant: grant:darkvision',
      'Unknown species choice: choice:missing',
    ]));
  });

  it('preserves saved grant and choice references while reporting changed source records', () => {
    const saved = {
      ...createSpeciesConfiguration(origin, snapshot),
      grants: [{ key: 'grant:old', level: 1, label: 'Old grant', source: { id: 'old-id', type: 'feat' }, raw: {} }],
      choices: [{ key: 'choice:old', level: 1, label: 'Old choice', count: 1, source: { id: 'old-choice', type: 'Choice' }, options: [], selected: ['old-value'], raw: {} }],
    };
    const source: SpeciesConfigurationSource = { origin, summary, snapshot: { ...snapshot, commit: 'b'.repeat(40) }, grants: [], choices: [{ key: 'choice:new', level: 1, label: 'New choice', count: 1, source: { id: 'new-choice', type: 'Choice' }, options: [{ value: 'new-value', label: 'New', source: { id: 'new-id', type: 'Item' } }], selected: [], raw: {} }] };
    const restored = restoreSpeciesConfiguration(toSpeciesConfigurationSelection(saved), source);
    expect(restored.grants[0]?.source).toEqual({ id: 'old-id', type: 'feat' });
    expect(restored.choices.find((choice) => choice.key === 'choice:old')?.selected).toEqual(['old-value']);
    expect(validateSpeciesConfiguration(restored, source)).toEqual(expect.arrayContaining([
      'Species source snapshot differs from current source',
      'Unknown species grant: grant:old',
      'Unknown species choice: choice:old',
      'Choice "choice:new" requires 1 value',
    ]));
  });

  it('persists spell references without catalog records and restores them against current options', () => {
    const spellReference: FoundrySourceReference = { sourcePath: 'packs/_source/spells24/cantrips/guidance.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'guidance', name: 'Guidance', identifier: 'guidance' };
    const spellSummary = { ...spellReference, ruleset: '2024' as const, level: 0, school: 'div', spellLists: ['cleric', 'druid'], ritual: false, description: 'Source description' };
    const listChoice: SpellChoice = { key: 'magic:list', advancementId: 'cantrips', label: 'Spell list', count: 1, level: 0, spellLists: ['cleric', 'druid'], selected: ['cleric'], abilityOptions: [], options: [{ value: 'cleric', source: { ...spellReference, type: 'feat' }, label: 'Cleric' }, { value: 'druid', source: { ...spellReference, type: 'feat' }, label: 'Druid' }], raw: { type: 'spell-list' } };
    const cantripChoice: SpellChoice = { key: 'magic:cantrips', advancementId: 'cantrips', label: 'Two Cantrips', count: 1, level: 0, spellLists: ['cleric', 'druid'], selected: [spellSummary], abilityOptions: ['Wisdom'], selectedAbility: 'Wisdom', parent: { key: listChoice.key, values: [] }, options: [{ value: 'dnd5e.spells24:spell:guidance', source: spellSummary, label: 'Guidance', description: spellSummary.description }], raw: { configuration: { type: 'spell' } } };
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), spellChoices: [listChoice, cantripChoice] };
    const selection = toSpeciesConfigurationSelection(configuration);

    expect(selection.spellChoices).toEqual([
      { key: 'magic:list', advancementId: 'cantrips', kind: 'spell-list', selected: ['cleric'] },
      { key: 'magic:cantrips', advancementId: 'cantrips', kind: 'spell', selected: [spellReference], selectedAbility: 'Wisdom' },
    ]);
    expect(selection.spellChoices?.[1]).not.toHaveProperty('selected.0.level');
    expect(selection.spellChoices?.[1]).not.toHaveProperty('selected.0.spellLists');
    const source: SpeciesConfigurationSource = { origin, summary, grants: [], choices: [], spellChoices: [{ ...listChoice, selected: [] }, { ...cantripChoice, selected: [], selectedAbility: undefined }] };
    const restored = restoreSpeciesConfiguration(selection, source);
    expect(restored.spellChoices.find((choice) => choice.key === cantripChoice.key)).toMatchObject({ selected: [spellReference], selectedAbility: 'Wisdom' });
    expect(validateSpeciesConfiguration(restored, source)).toEqual([]);
  });

  it('reports duplicate, wrong-level, wrong-list, and invalid-ability spell selections', () => {
    const selectedReference: FoundrySourceReference = { sourcePath: 'packs/_source/spells24/1st-level/command.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'command', name: 'Command' };
    const wrongOption = { ...selectedReference, ruleset: '2024' as const, level: 1, spellLists: ['druid'], ritual: false };
    const listChoice: SpellChoice = { key: 'magic:list', advancementId: 'cantrips', label: 'Spell list', count: 1, level: 0, spellLists: ['cleric', 'druid'], selected: ['cleric'], abilityOptions: [], options: [{ value: 'cleric', source: { ...selectedReference, type: 'feat' }, label: 'Cleric' }, { value: 'druid', source: { ...selectedReference, type: 'feat' }, label: 'Druid' }], raw: { type: 'spell-list' } };
    const sourceChoice: SpellChoice = { key: 'magic:cantrips', advancementId: 'cantrips', label: 'Two Cantrips', count: 2, level: 0, spellLists: ['cleric', 'druid'], selected: [], abilityOptions: ['Wisdom'], parent: { key: listChoice.key, values: [] }, options: [{ value: 'dnd5e.spells24:spell:command', source: wrongOption, label: 'Command' }], raw: { configuration: { type: 'spell' } } };
    const configuredChoice = { ...sourceChoice, selected: [selectedReference, selectedReference], selectedAbility: 'Charisma' };
    const configuration = { ...createSpeciesConfiguration(origin, snapshot), spellChoices: [listChoice, configuredChoice] };
    const source: SpeciesConfigurationSource = { origin, summary, grants: [], choices: [], spellChoices: [{ ...listChoice, selected: [] }, sourceChoice] };

    expect(validateSpeciesConfiguration(configuration, source)).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate'),
      expect.stringContaining('level'),
      expect.stringContaining('spell list'),
      expect.stringContaining('ability'),
    ]));
  });

  it('reports an unsupported nested spell restriction instead of inventing a pool', () => {
    const result = buildSpeciesConfiguration({ ...summary, advancements: [{
      id: 'bad-spell', type: 'ItemChoice', level: 0, hint: '', automatic: false, dependencies: [],
      requiresChoice: { key: 'species:feat', value: 'Compendium.dnd5e.feats24.Item.magic' },
      raw: { _id: 'bad-spell', type: 'ItemChoice', title: 'Bad spell', configuration: { type: 'spell', choices: { '0': { count: 1 } }, pool: [], restriction: { list: ['class:wizard'], level: 'cantrip' } } },
    }] }, snapshot);

    expect(result.spellChoices).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('bad-spell (ItemChoice) -> spell:* (unsupported spell restriction)'),
    ]));
  });

  it('reports incomplete and invalid saved choice values without changing them', () => {
    const sourceChoice = { key: 'choice:language', level: 1, label: 'Language', count: 1, source: { id: 'choice-id', type: 'Choice' }, options: [{ value: 'elvish', label: 'Elvish', source: { id: 'elvish-id', type: 'Item' } }], selected: [], raw: {} };
    const source: SpeciesConfigurationSource = { origin, summary, grants: [], choices: [sourceChoice] };
    const incomplete = restoreSpeciesConfiguration({ ...toSpeciesConfigurationSelection(createSpeciesConfiguration(origin, snapshot)), choices: [{ key: sourceChoice.key, source: { id: 'choice-id', type: 'Choice' }, selected: [] }] }, source);
    expect(validateSpeciesConfiguration(incomplete, source)).toContain('Choice "choice:language" requires 1 value');
    const invalid = restoreSpeciesConfiguration({ ...toSpeciesConfigurationSelection(createSpeciesConfiguration(origin, snapshot)), choices: [{ key: sourceChoice.key, source: { id: 'choice-id', type: 'Choice' }, selected: ['common'] }] }, source);
    expect(invalid.choices[0]?.selected).toEqual(['common']);
    expect(validateSpeciesConfiguration(invalid, source)).toContain('Choice "choice:language" contains a disallowed value');
  });
});
