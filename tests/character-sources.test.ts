import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createSourceIndex, createSourceReader, type SourceReaderAdapter, type SpeciesSourceSummary } from '../src/character-sources';
import { buildSpeciesConfiguration } from '../src/species-configuration';
import type { SourceStoreAdapter } from '../src/source-store';
import type { SourceSnapshot } from '../src/source-tree';
import { isRecord } from '../src/foundry-utils';
import { buildClassConfiguration, getLevelOneDerivedSpellChoices, setClassSelection, toClassProgressionSelection } from '../src/class-configuration';
import { createCharacterDocument, withOrigin, withClassProgression, withRuleset } from '../src/character-model';
import { getLevelOneClassProgression } from '../src/level-one-progression';

function memoryAdapter(files: Record<string, string>): SourceReaderAdapter {
  return {
    async exists(path) { return Object.keys(files).some((file) => file === path || file.startsWith(`${path}/`)); },
    async list(path) { return Object.keys(files).filter((file) => file.startsWith(`${path}/`)); },
    async read(path) { const value = files[path]; if (value === undefined) throw new Error(`missing ${path}`); return value; },
  };
}

function lookupAdapter(files: Record<string, string>): SourceStoreAdapter {
  return {
    async mkdir() {},
    async exists(path) { return files[path] !== undefined; },
    async read(path) { if (files[path] === undefined) throw new Error(`missing ${path}`); return files[path]; },
    async readBinary() { throw new Error('not used'); },
    async write(path, data) { files[path] = data; },
    async writeBinary() { throw new Error('not used'); },
    async list() { return []; },
    async remove(path) { delete files[path]; },
    async rmdir() {},
  };
}

const lookupSnapshot: SourceSnapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: '6.0.x', commit: 'a'.repeat(40), systemVersion: '6.0.0' };

describe('character source reader', () => {
  it('projects level-one species defenses and roll effects from the pinned 2024 records', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = { async exists(path) { try { await fs.access(path); return true; } catch { return false; } }, async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); }, async read(path) { return fs.readFile(path, 'utf8'); } };
    const index = createSourceIndex(adapter, root);

    const gnome = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/gnome-rock.yml');
    expect(gnome.creatureTypeProjection).toMatchObject({ value: 'humanoid', source: { name: 'Gnome, Rock' } });
    expect(gnome.hitPointModifiers).toBeUndefined();
    expect(gnome.rollAnnotations).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'saving-throw', ability: 'int', mode: 'advantage', source: expect.objectContaining({ name: 'Gnomish Cunning' }) }),
      expect.objectContaining({ target: 'saving-throw', ability: 'wis', mode: 'advantage', source: expect.objectContaining({ name: 'Gnomish Cunning' }) }),
      expect.objectContaining({ target: 'saving-throw', ability: 'cha', mode: 'advantage', source: expect.objectContaining({ name: 'Gnomish Cunning' }) }),
    ]));

    const dwarf = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/dwarf.yml');
    expect(dwarf.hitPointModifiers).toEqual([{ perLevel: 1, source: expect.objectContaining({ name: 'Dwarven Toughness' }) }]);
    expect(dwarf.resistances).toEqual(expect.arrayContaining([
      expect.objectContaining({ damageType: 'poison', selected: true, source: expect.objectContaining({ name: 'Dwarven Resilience' }) }),
    ]));
    expect(dwarf.savingThrowNotes).toEqual([{ text: 'Advantage on saving throws to avoid or end the Poisoned condition.', source: expect.objectContaining({ name: 'Dwarven Resilience' }) }]);
    expect(dwarf.rollAnnotations ?? []).toHaveLength(0);

    const halfling = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/halfling.yml');
    expect(halfling.features?.some((feature) => feature.source.name === 'Luck')).toBe(true);
    expect(halfling.rollAnnotations ?? []).toHaveLength(0);
  });

  it('preserves disadvantage and diagnoses unsupported stable species effect changes', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/test.yml`]: `type: race
name: Test Species
system:
  source: { rules: 2024 }
  identifier: test-species
  advancement:
    - _id: grant
      type: ItemGrant
      level: 0
      configuration: { uuid: Compendium.dnd5e.origins24.Item.test-effect }
_id: test-species`,
      [`${root}/packs/_source/origins24/species/traits/test-effect.yml`]: `type: feat
name: Test Effect
system: { description: { value: Test effect. } }
effects:
  - disabled: false
    system:
      changes:
        - { key: system.abilities.int.save.roll.mode, value: -1 }
        - { key: system.attributes.ac.bonus, value: 1 }
_id: test-effect`,
    }), root);

    const summary = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/test.yml');

    expect(summary.rollAnnotations).toEqual([
      expect.objectContaining({ target: 'saving-throw', ability: 'int', mode: 'disadvantage', source: expect.objectContaining({ name: 'Test Effect' }) }),
    ]);
    expect(summary.effectDiagnostics).toEqual([
      'Unsupported stable effect change from Test Effect: system.attributes.ac.bonus.',
    ]);
  });

  it('does not infer HP from prose and diagnoses malformed supported effects', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/test.yml`]: `type: race\nname: Test Species\nsystem:\n  source: { rules: 2024 }\n  identifier: test-species\n  advancement:\n    - _id: grant\n      type: ItemGrant\n      level: 0\n      configuration: { uuid: Compendium.dnd5e.origins24.Item.test-effect }\n_id: test-species`,
      [`${root}/packs/_source/origins24/species/traits/test-effect.yml`]: `type: feat\nname: Dwarven Toughness\nsystem:\n  identifier: dwarven-toughness\n  description: { value: "Your Hit Point maximum increases by 1." }\neffects:\n  - disabled: false\n    system:\n      changes:\n        - { key: system.attributes.hp.bonuses.level, value: "1", type: add }\n_id: test-effect`,
    }), root);
    const summary = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/test.yml');
    expect(summary.hitPointModifiers).toBeUndefined();
    expect(summary.effectDiagnostics).toContain('Malformed supported HP effect from Dwarven Toughness: system.attributes.hp.bonuses.level.');
  });

  it('projects the pinned Dragonborn species scale with its level-zero value and later thresholds', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = { async exists(path) { try { await fs.access(path); return true; } catch { return false; } }, async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); }, async read(path) { return fs.readFile(path, 'utf8'); } };
    const summary = await createSourceIndex(adapter, root).getSpeciesSummary('2024', 'packs/_source/origins24/species/dragonborn.yml');
    expect(summary.scales).toEqual([expect.objectContaining({ identifier: 'breath', values: new Map([[0, { type: 'dice', number: 1, faces: 10, modifiers: [] }], [5, { type: 'dice', number: 2, faces: 10, modifiers: [] }], [11, { type: 'dice', number: 3, faces: 10, modifiers: [] }], [17, { type: 'dice', number: 4, faces: 10, modifiers: [] }]]) })]);
    const breath = summary.features?.find((feature) => feature.source.name === 'Breath Weapon');
    expect(breath?.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Breath Weapon (Cone)', target: { affects: { type: 'creature' }, template: { type: 'cone', size: '15', units: 'ft' } }, save: { ability: ['dex'], dc: { calculation: 'con', formula: '' } } }),
      expect.objectContaining({ name: 'Breath Weapon (Line)', target: { affects: { type: 'creature' }, template: { type: 'line', size: '30', width: '5', units: 'ft' } }, save: { ability: ['dex'], dc: { calculation: 'con', formula: '' } } }),
    ]));
  });
  it('projects nested choices from a background-granted feat', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = { async exists(path) { try { await fs.access(path); return true; } catch { return false; } }, async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); }, async read(path) { return fs.readFile(path, 'utf8'); } };
    const index = createSourceIndex(adapter, root);
    const acolyte = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/acolyte.yml');
    expect(acolyte.grantedFeat?.source).toMatchObject({ id: 'phbftMagicInitia', name: 'Magic Initiate' });
    expect(acolyte.grantedFeat?.advancements.map((entry) => ({ id: entry.id, type: entry.type, spellLevel: entry.spellLevel, spellLists: entry.spellLists, abilityOptions: entry.abilityOptions }))).toEqual([
      { id: 'ElkyDafWSUXOkPdJ', type: 'ItemChoice', spellLevel: 0, spellLists: ['cleric', 'druid', 'wizard'], abilityOptions: ['int', 'wis', 'cha'] },
      { id: 'ZbKHs2FVCkJVNW8p', type: 'ItemChoice', spellLevel: 1, spellLists: ['cleric', 'druid', 'wizard'], abilityOptions: ['int', 'wis', 'cha'] },
    ]);
    expect(acolyte.grantedFeat?.advancements[0]?.dependencies.some((entry) => entry.source?.type === 'spell')).toBe(true);
  });

  it('keeps choice-free background feats free of nested controls', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = { async exists(path) { try { await fs.access(path); return true; } catch { return false; } }, async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); }, async read(path) { return fs.readFile(path, 'utf8'); } };
    const index = createSourceIndex(adapter, root);
    const criminal = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/criminal.yml');
    const soldier = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/soldier.yml');
    expect(criminal.grantedFeat).toMatchObject({ source: { name: 'Alert' }, advancements: [] });
    expect(soldier.grantedFeat).toMatchObject({ source: { name: 'Savage Attacker' }, advancements: [] });
  });

  it('retains malformed required background feat advancements as raw unresolved entries', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/backgrounds/test.yml`]: `type: background\nname: Test\nsystem:\n  source: { rules: 2024 }\n  advancement:\n    - _id: feat\n      type: ItemGrant\n      configuration: { items: [{ uuid: Compendium.dnd5e.feats24.Item.bad }] }\n_id: background`,
      [`${root}/packs/_source/feats24/bad.yml`]: `type: feat\nname: Bad Feat\nsystem:\n  advancement:\n    broken: { type: ItemChoice, configuration: { type: spell, restriction: { list: [not-a-supported-restriction] } } }\n_id: bad`,
    }), root);
    const result = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/test.yml');
    expect(result.grantedFeat?.advancements).toEqual([expect.objectContaining({ id: 'broken', type: 'ItemChoice', raw: expect.objectContaining({ type: 'ItemChoice' }), dependencies: expect.arrayContaining([expect.objectContaining({ uuid: 'spell:*', source: null })]) })]);
  });

  it('selects the feat when an item grant also contains a non-feat dependency', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/backgrounds/mixed.yml`]: `type: background\nname: Mixed\nsystem:\n  source: { rules: 2024 }\n  advancement:\n    - _id: grant\n      type: ItemGrant\n      configuration:\n        items:\n          - uuid: Compendium.dnd5e.equipment24.Item.weapon\n          - uuid: Compendium.dnd5e.feats24.Item.feat\n_id: mixed`,
      [`${root}/packs/_source/equipment24/weapon.yml`]: `type: weapon\nname: Training Sword\nsystem: { source: { rules: 2024 } }\n_id: weapon`,
      [`${root}/packs/_source/feats24/feat.yml`]: `type: feat\nname: Mixed Feat\nsystem: { source: { rules: 2024 }, advancement: [] }\n_id: feat`,
    }), root);
    const result = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/mixed.yml');
    expect(result.grantedFeat?.source).toMatchObject({ type: 'feat', id: 'feat', name: 'Mixed Feat' });
    expect(result.feat).toMatchObject({ type: 'feat', id: 'feat', name: 'Mixed Feat' });
  });

  it('retains the owning background ability advancement id', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = { async exists(path) { try { await fs.access(path); return true; } catch { return false; } }, async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); }, async read(path) { return fs.readFile(path, 'utf8'); } };
    const index = createSourceIndex(adapter, root);
    const acolyte = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/acolyte.yml');
    expect(acolyte.abilityScores).toMatchObject({ advancementId: 'kDI6zoUamHzFTvHG', points: 3, cap: 2, locked: ['str', 'dex', 'con'] });
  });

  it('projects pinned 2024 Barbarian and Acolyte equipment as package-or-wealth summaries', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = { async exists(path) { try { await fs.access(path); return true; } catch { return false; } }, async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); }, async read(path) { return fs.readFile(path, 'utf8'); } };
    const index = createSourceIndex(adapter, root);
    const barbarian = await index.getClassSummary('2024', 'packs/_source/classes24/barbarian/barbarian.yml');
    const acolyte = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/acolyte.yml');
    const legacyBarbarian = await index.getClassSummary('2014', 'packs/_source/classes/barbarian.yml');
    expect(barbarian.startingEquipment?.roots[0]).toMatchObject({ type: 'OR', children: [{ nodeId: '0Yx0DOCxeeNYZw7n' }, { nodeId: 'synthetic:starting-equipment-wealth' }] });
    expect(acolyte.startingEquipment?.roots[0]).toMatchObject({ type: 'OR', children: [{ nodeId: 'jBbYoNZtbWE8sFAK' }, { nodeId: 'synthetic:starting-equipment-wealth' }] });
    expect(barbarian.startingEquipment?.roots[0].children?.[1].children?.[0].currency).toEqual({ denomination: 'gp', amount: 75 });
    expect(acolyte.startingEquipment?.roots[0].children?.[1].children?.[0].currency).toEqual({ denomination: 'gp', amount: 50 });
    expect(barbarian.startingEquipment?.roots[0].children?.[0].children).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'Compendium.dnd5e.equipment24.Item.phbwepGreataxe00' })]));
    expect(acolyte.startingEquipment?.roots[0].children?.[0].children).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'focus', key: 'holy' })]));
    expect(legacyBarbarian.startingEquipment?.roots[0].nodeId).not.toBe('synthetic:starting-equipment-choice');
  });
  it('lists backgrounds from the ruleset-specific source folders', async () => {
    const root = 'sources';
    const reader = createSourceReader(memoryAdapter({
      [`${root}/packs/_source/backgrounds/acolyte.yml`]: 'type: background\nname: Acolyte\nsystem: { identifier: acolyte, source: { rules: 2014 } }\n_id: old',
      [`${root}/packs/_source/origins24/backgrounds/sage.yml`]: 'type: background\nname: Sage\nsystem: { identifier: sage, source: { rules: 2024 } }\n_id: new',
    }), root);

    await expect(reader.listBackgrounds('2014')).resolves.toEqual([{ name: 'Acolyte', identifier: 'acolyte', id: 'old', sourcePath: 'packs/_source/backgrounds/acolyte.yml' }]);
    await expect(reader.listBackgrounds('2024')).resolves.toEqual([{ name: 'Sage', identifier: 'sage', id: 'new', sourcePath: 'packs/_source/origins24/backgrounds/sage.yml' }]);
  });

  it('normalizes background description and grants from 2014 and 2024 records', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/backgrounds/acolyte.yml`]: `type: background
name: Acolyte
system:
  identifier: acolyte
  source: { rules: 2014 }
  description: { value: '<p>A temple servant.</p><hr /><p><strong>Skill Proficiencies:</strong> Insight, Religion</p><p><strong>Languages:</strong> Two of your choice</p><p><strong>Equipment:</strong> A holy symbol</p><p><strong>Feature:</strong> Shelter of the Faithful</p>' }
  advancement:
    - _id: prof
      type: Trait
      configuration: { grants: [skills:ins, skills:rel], choices: [{ count: 2, pool: [languages:*] }] }
    - _id: feature
      type: ItemGrant
      configuration: { items: [{ uuid: Compendium.dnd5e.backgrounds.Item.feature }] }
  startingEquipment:
    - type: AND
      _id: group
_id: old`,
      [`${root}/packs/_source/backgrounds/acolyte-feature/feature.yml`]: 'type: feat\nname: Shelter of the Faithful\nsystem: { description: { value: "<p>You receive shelter.</p>" } }\n_id: feature',
      [`${root}/packs/_source/origins24/backgrounds/sage.yml`]: `type: background
name: Sage
system:
  identifier: sage
  source: { rules: 2024 }
  description: { value: '<p><strong>Ability Scores:</strong> Intelligence, Wisdom, Charisma</p><p><strong>Feat:</strong> Magic Initiate</p><p><strong>Skill Proficiencies:</strong> Arcana and History</p><p><strong>Tool Proficiency:</strong> Calligrapher''s Supplies</p><p><strong>Equipment:</strong> Choose A or B</p>' }
  advancement:
    - _id: ability
      type: AbilityScoreImprovement
      configuration: { points: 3, locked: [str, dex, con] }
    - _id: prof
      type: Trait
      configuration: { grants: [skills:arc, skills:his, tool:art:calligrapher], choices: [{ count: 2, pool: [languages:standard:*] }] }
    - _id: feat
      type: ItemGrant
      configuration: { items: [{ uuid: Compendium.dnd5e.feats24.Item.magic }] }
_id: new`,
      [`${root}/packs/_source/feats24/magic.yml`]: 'type: feat\nname: Magic Initiate\nsystem: {}\n_id: magic',
    }), root);

    await expect(index.getBackgroundSummary('2014', 'packs/_source/backgrounds/acolyte.yml')).resolves.toMatchObject({
      description: 'A temple servant.',
      skills: ['skills:ins', 'skills:rel'], languages: [], languageChoices: [{ count: 2, pool: ['languages:*'] }],
      features: [{ source: { name: 'Shelter of the Faithful' }, description: 'You receive shelter.' }], equipment: [{ type: 'AND' }],
    });
    await expect(index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/sage.yml')).resolves.toMatchObject({
      abilityScores: { points: 3, locked: ['str', 'dex', 'con'] }, feat: { name: 'Magic Initiate' }, skills: ['skills:arc', 'skills:his'], tools: ['tool:art:calligrapher'], languageChoices: [{ count: 2, pool: ['languages:standard:*'] }],
    });
  });
  it('accepts pinned class advancements with omitted optional metadata and keeps raw records', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes24/fighter/fighter.yml`]: `type: class
name: Fighter
system:
  source: { rules: 2024 }
  identifier: fighter
  hd: { denomination: d10 }
  advancement:
    - _id: hp
      type: HitPoints
_id: fighter`,
    }), root);
    const result = await index.getClassSummary('2024', 'packs/_source/classes24/fighter/fighter.yml');
    expect(result.advancements[0]).toMatchObject({ id: 'hp', level: 0, title: 'HitPoints', hint: '', raw: { _id: 'hp', type: 'HitPoints' } });
  });

  it('projects an empty-pool class spell advancement from the pinned catalog and class spellcasting ability', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes24/wizard/wizard.yml`]: `type: class
name: Wizard
system:
  source: { rules: 2024 }
  identifier: wizard
  hd: { denomination: d6 }
  spellcasting: { progression: full, ability: int }
  advancement:
    - _id: cantrips
      type: ItemChoice
      level: 1
      title: Cantrips
      configuration:
        choices: { '1': { count: 3 } }
        type: spell
        pool: []
        spell: { ability: [], preparation: atwill }
        restriction: { level: 0, list: [] }
_id: wizard`,
      [`${root}/packs/_source/spells24/light.yml`]: `type: spell
name: Light
system:
  source: { rules: 2024 }
  level: 0
  school: evo
  preparation: { mode: prepared }
_id: light`,
      [`${root}/packs/_source/content24/chapter-7/spells.yml`]: `type: JournalEntry
name: Spells
system: {}
pages:
  - type: spells
    name: Wizard Spell List
    system:
      type: class
      identifier: wizard
      spells: [Compendium.dnd5e.spells24.Item.light]
_id: registry`,
    }), root);

    const result = await index.getClassSummary('2024', 'packs/_source/classes24/wizard/wizard.yml');
    expect(result.advancements).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'cantrips', spellLevel: 0, spellLists: [], abilityOptions: ['Intelligence'], dependencies: expect.arrayContaining([expect.objectContaining({ source: expect.objectContaining({ id: 'light' }) })]) })]));
  });

  it('exposes the spell catalog through the source index for interactive class choices', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/spells24/light.yml`]: `type: spell
name: Light
system:
  source: { rules: 2024 }
  level: 0
  preparation: { mode: prepared }
_id: light`,
      [`${root}/packs/_source/content24/chapter-7/spells.yml`]: `type: JournalEntry
name: Spells
system: {}
pages:
  - type: spells
    name: Wizard Spell List
    system:
      type: class
      identifier: wizard
      spells: [Compendium.dnd5e.spells24.Item.light]
_id: registry`,
    }), root);

    await expect(index.searchSpells({ ruleset: '2024', level: 0, spellLists: ['wizard'] })).resolves.toEqual([
      expect.objectContaining({ id: 'light', name: 'Light', spellLists: ['wizard'] }),
    ]);
  });

  it('projects the pinned 2024 Wizard level-one progression and preserves scale thresholds', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const index = createSourceIndex({
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    }, root);
    const summary = await index.getClassSummary('2024', 'packs/_source/classes24/wizard/wizard.yml');
    expect(getLevelOneClassProgression(summary).spellcasting).toMatchObject({ spellcastingAbility: 'Intelligence', cantripsKnown: 3, spellbookSpells: 6, preparedSpells: 4 });
    expect(summary.spellOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Acid Splash', level: 0, spellLists: expect.arrayContaining(['wizard']) }),
      expect.objectContaining({ name: 'Alarm', level: 1, spellLists: expect.arrayContaining(['wizard']) }),
    ]));
    expect(summary.spellcasting?.progression).toBe('full');
    const scale = summary.scales?.find((entry) => entry.identifier === 'max-prepared');
    expect(scale?.values).toEqual(new Map([[1, 4], [2, 5], [3, 6], [4, 7], [5, 9], [6, 10], [7, 11], [8, 12], [9, 14], [10, 15], [11, 16], [13, 17], [14, 18], [15, 19], [16, 21], [17, 22], [18, 23], [19, 24], [20, 25]].map(([level, value]) => [level, { type: 'number', value }])));
  });

  it('reads typed scale values and derives blank identifiers from advancement titles', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/rogue.yml`]: `type: class
name: Rogue
system:
  source: { rules: 2014 }
  identifier: rogue
  hitDice: d8
  advancement:
    - _id: count
      type: ScaleValue
      title: Sneak Attack
      configuration:
        type: dice
        identifier: ''
        scale:
          '1': { number: 1, faces: 6, modifiers: [] }
    - _id: reach
      type: ScaleValue
      title: Reach
      configuration:
        type: distance
        identifier: reach
        distance: { units: ft }
        scale:
          '1': { value: 10 }
    - _id: broken
      type: ScaleValue
      title: Broken
      configuration:
        type: number
        scale:
          '1': { value: '2' }
_id: rogue`,
    }), root);

    await expect(index.getClassSummary('2014', 'packs/_source/classes/rogue.yml')).resolves.toMatchObject({
      scales: [
        { advancementId: 'count', identifier: 'sneak-attack', values: new Map([[1, { type: 'dice', number: 1, faces: 6, modifiers: [] }]]) },
        { advancementId: 'reach', identifier: 'reach', values: new Map([[1, { type: 'distance', value: 10, units: 'ft' }]]) },
        { advancementId: 'broken', values: new Map(), diagnostics: [expect.stringContaining('Invalid') ] },
      ],
    });
  });

  it('diagnoses a scale with no usable identifier', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/rogue.yml`]: `type: class
name: Rogue
system:
  source: { rules: 2014 }
  identifier: rogue
  hitDice: d8
  advancement:
    - _id: unnamed
      type: ScaleValue
      title: ''
      configuration: { type: number, identifier: '', scale: { '1': { value: 1 } } }
_id: rogue`,
    }), root);
    await expect(index.getClassSummary('2014', 'packs/_source/classes/rogue.yml')).resolves.toMatchObject({
      scales: [{ diagnostics: [expect.stringContaining('identifier')] }],
    });
  });

  it('projects pinned armor details through direct item lookup', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const index = createSourceIndex({
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    }, root);

    await expect(index.getItemSummary('2024', 'packs/_source/equipment24/armor/heavy/chain-mail.yml')).resolves.toMatchObject({
      name: 'Chain Mail',
      armor: { value: 16, dex: 0 },
      strength: 13,
      properties: expect.arrayContaining(['stealthDisadvantage']),
    });
    await expect(index.getItemSummary('2024', 'packs/_source/equipment24/armor/shield.yml')).resolves.toMatchObject({
      name: 'Shield',
      category: 'shield',
      armor: { value: 2 },
    });
  });

  it('projects pinned level-one spell roles for every 2024 spellcasting class', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const index = createSourceIndex({ async exists(path) { try { await fs.access(path); return true; } catch { return false; } }, async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); }, async read(path) { return fs.readFile(path, 'utf8'); } }, root);
    const expected: Record<string, Array<[string, number]>> = { wizard: [['cantrips-known', 3], ['spellbook', 6]], bard: [['cantrips-known', 2], ['known-spells', 4]], cleric: [['cantrips-known', 3], ['known-spells', 4]], druid: [['cantrips-known', 2], ['known-spells', 4]], sorcerer: [['cantrips-known', 4], ['known-spells', 2]], warlock: [['cantrips-known', 2], ['known-spells', 2]], paladin: [['known-spells', 2]], ranger: [['known-spells', 2]] };
    for (const [identifier, roles] of Object.entries(expected)) {
      const summary = await index.getClassSummary('2024', `packs/_source/classes24/${identifier}/${identifier}.yml`);
      const choices = getLevelOneDerivedSpellChoices(summary).filter((choice): choice is Extract<typeof choice, { kind: 'spell' }> => choice.kind === 'spell');
      expect(choices.map((choice) => [choice.selectionRole, choice.count])).toEqual(roles);
      expect(choices.map((choice) => choice.selectionRole)).not.toContain('prepared-spells');
    }
  });
  it('lists only direct 2014 class records', async () => {
    const root = 'sources';
    const reader = createSourceReader(memoryAdapter({
      [`${root}/packs/_source/classes/fighter.yml`]: 'type: class\nname: Fighter\nsystem:\n  source: { rules: 2014 }\n  identifier: fighter\n_id: fighter-id',
      [`${root}/packs/_source/classes/wizard.yml`]: 'type: class\nname: Wizard\nsystem:\n  source: { rules: 2024 }\n  identifier: wizard\n_id: wizard-id',
      [`${root}/packs/_source/classes/fighter/subclass.yml`]: 'type: subclass\nname: Champion\nsystem: { source: { rules: 2014 } }\n_id: subclass-id',
      [`${root}/packs/_source/classes/_folder.yml`]: 'type: folder\nname: Classes\n_id: folder-id',
    }), root);
    await expect(reader.listClasses('2014')).resolves.toEqual([{ name: 'Fighter', identifier: 'fighter', id: 'fighter-id', sourcePath: 'packs/_source/classes/fighter.yml', ruleset: '2014' }]);
  });

  it('lists only same-name nested 2024 class records', async () => {
    const root = 'sources';
    const reader = createSourceReader(memoryAdapter({
      [`${root}/packs/_source/classes24/fighter/fighter.yml`]: 'type: class\nname: Fighter\nsystem:\n  source: { rules: 2024 }\n  identifier: fighter\n_id: fighter-id',
      [`${root}/packs/_source/classes24/wizard/wizard.yml`]: 'type: class\nname: Wizard\nsystem:\n  source: { rules: 2014 }\n  identifier: wizard\n_id: wizard-id',
      [`${root}/packs/_source/classes24/fighter/subclass.yml`]: 'type: subclass\nname: Champion\nsystem: { source: { rules: 2024 } }\n_id: subclass-id',
      [`${root}/packs/_source/classes24/_folder.yml`]: 'type: folder\nname: Classes\n_id: folder-id',
    }), root);
    await expect(reader.listClasses('2024')).resolves.toEqual([{ name: 'Fighter', identifier: 'fighter', id: 'fighter-id', sourcePath: 'packs/_source/classes24/fighter/fighter.yml', ruleset: '2024' }]);
  });

  it('indexes classes and normalizes pinned hit-die shapes for both rulesets', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/fighter.yml`]: `type: class
name: Fighter
system:
  source: { rules: 2014 }
  identifier: fighter
  hitDice: d10
  primaryAbility: { value: Strength }
  spellcasting: { progression: none }
  advancement:
    - _id: feature
      type: ItemGrant
      level: 1
      title: Fighting Style
      hint: Choose a style
_id: fighter-2014`,
      [`${root}/packs/_source/classes24/fighter/fighter.yml`]: `type: class
name: Fighter 2024
system:
  source: { rules: 2024 }
  identifier: fighter
  hd: { denomination: d10, number: 1 }
  primaryAbility: { value: Strength }
  spellcasting: { progression: none }
  advancement: []
_id: fighter-2024`,
    }), root);

    await expect(index.listClasses('2014')).resolves.toMatchObject([{ name: 'Fighter', pack: 'dnd5e.classes', id: 'fighter-2014' }]);
    await expect(index.listClasses('2024')).resolves.toMatchObject([{ name: 'Fighter 2024', pack: 'dnd5e.classes24', id: 'fighter-2024' }]);
    await expect(index.getClassSummary('2014', 'packs/_source/classes/fighter.yml')).resolves.toMatchObject({ hitDie: 'd10', primaryAbility: { value: 'Strength' }, spellcasting: { progression: 'none' }, advancements: [{ title: 'Fighting Style', hint: 'Choose a style' }] });
    await expect(index.getClassSummary('2024', 'packs/_source/classes24/fighter/fighter.yml')).resolves.toMatchObject({ hitDie: 'd10', primaryAbility: { value: 'Strength' }, spellcasting: { progression: 'none' }, advancements: [] });
  });

  it('extracts level-one proficiencies, granted features, and scale values from standard class advancements', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/barbarian.yml`]: `type: class
name: Barbarian
system:
  source: { rules: 2014 }
  identifier: barbarian
  hitDice: d12
  advancement:
    - _id: armor
      type: Trait
      level: 1
      configuration: { grants: [armor:lgt, armor:med, armor:shl], choices: [] }
    - _id: saves
      type: Trait
      level: 1
      configuration: { grants: [saves:str, saves:con], choices: [] }
    - _id: skills
      type: Trait
      level: 1
      configuration: { grants: [], choices: [{ count: 2, pool: [skills:ath, skills:prc] }] }
    - _id: features
      type: ItemGrant
      level: 1
      configuration: { items: [{ uuid: Compendium.dnd5e.classfeatures.Item.rage }] }
    - _id: rages
      type: ScaleValue
      configuration: { type: number, identifier: rages, scale: { '1': { value: 2 } } }
      title: Rages
_id: barbarian`,
      [`${root}/packs/_source/classfeatures/rage.yml`]: `type: feat
name: Rage
system:
  description: { value: '<p>Enter a rage.</p>' }
_id: rage`,
    }), root);

    await expect(index.getClassSummary('2014', 'packs/_source/classes/barbarian.yml')).resolves.toMatchObject({
      proficiencies: { armor: ['armor:lgt', 'armor:med', 'armor:shl'], savingThrows: ['saves:str', 'saves:con'], choices: [{ category: 'skills', count: 2, pool: ['skills:ath', 'skills:prc'] }] },
      features: [{ source: { name: 'Rage' }, description: 'Enter a rage.' }],
      scales: [{ title: 'Rages', identifier: 'rages', value: 2 }],
    });
  });

  it('extracts object-form class advancements, preserves restrictions and resolves feature dependencies', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/fighter.yml`]: `type: class
name: Fighter
system:
  source: { rules: 2014 }
  identifier: fighter
  hitDice: d10
  advancement:
    first:
      _id: first
      type: ItemGrant
      level: 1
      title: Fighting Style
      hint: Choose a style
      classRestriction: secondary
      configuration: { uuid: Compendium.dnd5e.classfeatures.Item.style }
_id: fighter`,
      [`${root}/packs/_source/classfeatures/style.yml`]: 'type: feat\nname: Style\nsystem: {}\n_id: style',
    }), root);

    await expect(index.getClassSummary('2014', 'packs/_source/classes/fighter.yml')).resolves.toMatchObject({
      advancements: [{ id: 'first', level: 1, title: 'Fighting Style', hint: 'Choose a style', classRestriction: 'secondary', raw: { classRestriction: 'secondary' }, dependencies: [{ source: { id: 'style', pack: 'dnd5e.classfeatures' } }] }],
    });
  });

  it('rejects missing class hit dice and malformed advancement fields with the source path', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes24/wizard/wizard.yml`]: `type: class
name: Wizard
system:
      source: { rules: 2024 }
      identifier: wizard
  hitDice: d6
  advancement:
    - _id: bad
      type: ItemGrant
      level: one
      title: Feature
      hint: Hint
_id: wizard`,
    }), root);

    await expect(index.getClassSummary('2024', 'packs/_source/classes24/wizard/wizard.yml')).rejects.toThrow('packs/_source/classes24/wizard/wizard.yml');

    const missingHitDie = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes24/cleric/cleric.yml`]: 'type: class\nname: Cleric\nsystem: { source: { rules: 2024 }, identifier: cleric, advancement: [] }\n_id: cleric',
    }), root);
    await expect(missingHitDie.getClassSummary('2024', 'packs/_source/classes24/cleric/cleric.yml')).rejects.toThrow('Missing class hit die');
  });

  it('retains unresolved and malformed class dependencies as diagnostics', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/fighter.yml`]: `type: class
name: Fighter
system:
  source: { rules: 2014 }
  identifier: fighter
  hitDice: d10
  advancement:
    - _id: first
      type: ItemGrant
      level: 1
      title: Feature
      hint: Hint
      configuration: { uuids: [Compendium.dnd5e.classfeatures.Item.missing, not-a-uuid] }
_id: fighter`,
    }), root);

    await expect(index.getClassSummary('2014', 'packs/_source/classes/fighter.yml')).resolves.toMatchObject({
      advancements: [{ dependencies: [
        { uuid: 'Compendium.dnd5e.classfeatures.Item.missing', source: null, reason: 'unresolved source UUID' },
        { uuid: 'not-a-uuid', source: null, reason: 'malformed source UUID' },
      ] }],
    });
  });
  it('builds and persists only a requested UUID from its pack-scoped source scan', async () => {
    const root = 'sources';
    const sourceReads: string[] = [];
    const sourceFiles: Record<string, string> = {
      [`${root}/packs/_source/feats/example.yml`]: 'type: feat\nname: Example\nsystem: {}\n_id: example',
      [`${root}/packs/_source/feats/other.yml`]: 'type: feat\nname: Other\nsystem: {}\n_id: other',
      [`${root}/packs/_source/classes/fighter.yml`]: 'type: class\nname: Fighter\nsystem: {}\n_id: fighter',
    };
    const source = memoryAdapter(sourceFiles);
    const reader: SourceReaderAdapter = { ...source, async read(path) { sourceReads.push(path); return source.read(path); }, async list(path) { sourceReads.push(`list:${path}`); return source.list(path); } };
    const lookup: Record<string, string> = {};
    const index = createSourceIndex(reader, root, { lookupAdapter: lookupAdapter(lookup), lookupPath: 'plugin/uuid-lookup.json', snapshot: lookupSnapshot });

    await expect(index.getByUuid('Compendium.dnd5e.feats.Item.example')).resolves.toMatchObject({ id: 'example', pack: 'dnd5e.feats' });
    expect(sourceReads.filter((path) => path.startsWith('list:'))).toEqual([`list:${root}/packs/_source/feats`]);
    expect(JSON.parse(lookup['plugin/uuid-lookup.json'])).toMatchObject({ entries: { 'Compendium.dnd5e.feats.Item.example': { id: 'example' } } });
    expect(JSON.parse(lookup['plugin/uuid-lookup.json']).entries).not.toHaveProperty('Compendium.dnd5e.feats.Item.other');
  });

  it('loads a requested UUID from the validated lookup without rereading its source', async () => {
    const root = 'sources';
    const lookup: Record<string, string> = {};
    const first = createSourceIndex(memoryAdapter({ [`${root}/packs/_source/feats/example.yml`]: 'type: feat\nname: Example\nsystem: {}\n_id: example' }), root, { lookupAdapter: lookupAdapter(lookup), lookupPath: 'plugin/uuid-lookup.json', snapshot: lookupSnapshot });
    await first.getByUuid('Compendium.dnd5e.feats.Item.example');
    const second = createSourceIndex({ ...memoryAdapter({}), async read() { throw new Error('source record should not be read'); } }, root, { lookupAdapter: lookupAdapter(lookup), lookupPath: 'plugin/uuid-lookup.json', snapshot: lookupSnapshot });
    await expect(second.getByUuid('Compendium.dnd5e.feats.Item.example')).resolves.toMatchObject({ name: 'Example' });
  });

  it('does not persist unresolved UUIDs and invalidates entries from another snapshot', async () => {
    const lookup: Record<string, string> = { 'plugin/uuid-lookup.json': JSON.stringify({ sourceRoot: 'sources', snapshot: { ...lookupSnapshot, commit: 'b'.repeat(40) }, entries: { 'Compendium.dnd5e.feats.stale': { name: 'Stale' } } }) };
    const index = createSourceIndex(memoryAdapter({ 'sources/packs/_source/classes/fighter.yml': 'type: class\nname: Fighter\nsystem: {}\n_id: fighter' }), 'sources', { lookupAdapter: lookupAdapter(lookup), lookupPath: 'plugin/uuid-lookup.json', snapshot: lookupSnapshot });
    await expect(index.getByUuid('Compendium.dnd5e.feats.Item.missing')).resolves.toBeNull();
    expect(JSON.parse(lookup['plugin/uuid-lookup.json']).entries).toEqual({});
  });

  it('rejects traversal-like UUID pack segments before constructing source paths', async () => {
    const calls: string[] = [];
    const source = memoryAdapter({ 'sources/packs/_source/classes/fighter.yml': 'type: class\nname: Fighter\nsystem: {}\n_id: fighter' });
    const adapter: SourceReaderAdapter = { ...source, async exists(path) { calls.push(`exists:${path}`); return source.exists(path); }, async list(path) { calls.push(`list:${path}`); return source.list(path); } };
    const index = createSourceIndex(adapter, 'sources');
    await expect(index.getByUuid('Compendium.dnd5e../outside.Item.bad')).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('ignores cached entries with unsafe paths or mismatched UUID identity', async () => {
    const lookup: Record<string, string> = { 'plugin/uuid-lookup.json': JSON.stringify({
      sourceRoot: 'sources', snapshot: lookupSnapshot, entries: {
        'Compendium.dnd5e.feats.Item.example': { sourcePath: 'packs/_source/../classes/fighter.yml', pack: 'dnd5e.feats', type: 'feat', id: 'example', name: 'Tampered' },
        'Compendium.dnd5e.feats.Item.other': { sourcePath: 'packs/_source/feats/other.yml', pack: 'dnd5e.classes', type: 'feat', id: 'other', name: 'Wrong pack' },
      },
    }) };
    const index = createSourceIndex(memoryAdapter({ 'sources/packs/_source/classes/fighter.yml': 'type: class\nname: Fighter\nsystem: {}\n_id: fighter' }), 'sources', { lookupAdapter: lookupAdapter(lookup), lookupPath: 'plugin/uuid-lookup.json', snapshot: lookupSnapshot });
    await expect(index.getByUuid('Compendium.dnd5e.feats.Item.example')).resolves.toBeNull();
    await expect(index.getByUuid('Compendium.dnd5e.feats.Item.other')).resolves.toBeNull();
  });
  it('extracts and resolves an object-form 2014 advancement summary', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/races/dwarf.yml`]: `type: race
name: Dwarf
system:
  source: { rules: 2014 }
  identifier: dwarf
  description: Stone-born
  advancement:
    grant:
      _id: grant
      type: ItemGrant
      level: 1
      hint: Darkvision
      configuration: { uuid: Compendium.dnd5e.feats.Item.darkvision }
_id: dwarf-id`,
      [`${root}/packs/_source/feats/darkvision.yml`]: 'type: feat\nname: Darkvision\nsystem: { description: { value: "You can see in dim light within 60 feet." } }\n_id: darkvision',
    }), root);
    await expect(index.getSpeciesSummary('2014', 'packs/_source/races/dwarf.yml')).resolves.toMatchObject({
      source: { id: 'dwarf-id' },
      advancements: [{ id: 'grant', type: 'ItemGrant', level: 1, automatic: true, dependencies: [{ source: { name: 'Darkvision' } }] }],
      features: [{ source: { name: 'Darkvision' }, description: 'You can see in dim light within 60 feet.' }],
    });
  });

  it('treats a fixed grant with an empty choices list as automatic', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/dwarf.yml`]: `type: race
name: Dwarf
system:
  source: { rules: 2024 }
  identifier: dwarf
  advancement:
    resistance:
      _id: resistance
      type: Trait
      level: 0
      hint: Poison resistance
      configuration:
        grants: [dr:poison]
        choices: []
_id: dwarf-id`,
    }), root);

    await expect(index.getSpeciesSummary('2024', 'packs/_source/origins24/species/dwarf.yml')).resolves.toMatchObject({
      advancements: [{ id: 'resistance', automatic: true }],
    });
  });

  it('resolves legacy four-part compendium UUIDs from pinned 2014 Dragonborn data', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getSpeciesSummary('2014', 'packs/_source/races/dragonborn/dragonborn.yml');
    const ancestry = summary.advancements.find((entry) => entry.id === 'QIrBmvSmNOTEJLWn');
    expect(ancestry?.dependencies).toHaveLength(10);
    expect(ancestry?.dependencies.every((dependency) => dependency.source !== null)).toBe(true);
  });

  it('resolves all language choices for pinned 2014 Human without unresolved diagnostics', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getSpeciesSummary('2014', 'packs/_source/races/human/human.yml');
    const configuration = buildSpeciesConfiguration(summary, lookupSnapshot);
    const languageChoice = configuration.choices.find((choice) => choice.options.some((option) => option.value === 'languages:standard:common'));
    expect(languageChoice?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'languages:standard:common', label: 'Common' }),
      expect.objectContaining({ value: 'languages:exotic:abyssal', label: 'Abyssal' }),
    ]));
    expect(configuration.diagnostics.filter((diagnostic) => diagnostic.includes('languages:'))).toEqual([]);
  });

  it('resolves Dragonborn activity lookups in feature descriptions', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getSpeciesSummary('2014', 'packs/_source/races/dragonborn/dragonborn.yml');
    const black = summary.features?.find((feature) => feature.source.name === 'Black Breath Weapon');
    expect(black?.description).toContain('each creature');
    expect(black?.description).toContain('5-foot-wide, 30-foot-long line');
    expect(black?.description).not.toContain('[[lookup');
  });

  it('derives 2014 subclass choices from subclass class identifiers', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const cleric = await index.getClassSummary('2014', 'packs/_source/classes/cleric.yml');
    const domain = cleric.advancements.find((entry) => entry.title === 'Divine Domain');
    expect(domain?.dependencies.length).toBeGreaterThan(0);
    expect(domain?.dependencies.every((dependency) => dependency.source?.type === 'subclass')).toBe(true);
    expect(domain?.dependencies.some((dependency) => dependency.source?.name === 'Life Domain')).toBe(true);
    expect(domain?.dependencies.find((dependency) => dependency.source?.name === 'Life Domain')?.description).toContain('The Life domain focuses');
  });

  it('keeps pinned class spell advancement semantics across the four regression classes', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const direct = new Map([
      ['2014:wizard', 'packs/_source/classes/wizard.yml'],
      ['2014:sorcerer', 'packs/_source/classes/sorcerer.yml'],
      ['2014:bard', 'packs/_source/classes/bard.yml'],
      ['2014:paladin', 'packs/_source/classes/paladin.yml'],
      ['2024:wizard', 'packs/_source/classes24/wizard/wizard.yml'],
      ['2024:sorcerer', 'packs/_source/classes24/sorcerer/sorcerer.yml'],
      ['2024:bard', 'packs/_source/classes24/bard/bard.yml'],
      ['2024:paladin', 'packs/_source/classes24/paladin/paladin.yml'],
    ]);
    for (const [key, sourcePath] of direct) {
      const [ruleset, identifier] = key.split(':') as ['2014' | '2024', string];
      const summary = await index.getClassSummary(ruleset, sourcePath);
      const spells = summary.advancements.filter((entry) => entry.type === 'ItemChoice' && entry.requiresChoice === undefined && isRecord(entry.raw.configuration) && entry.raw.configuration.type === 'spell');
      if (ruleset === '2014' && identifier === 'wizard') {
        expect(spells.length).toBeGreaterThan(0);
        expect(spells[0]?.raw.configuration).toMatchObject({ type: 'spell', pool: [], choices: expect.any(Object) });
      }
      if (ruleset === '2014' && identifier === 'bard') expect(spells.find((entry) => entry.title === 'Magical Secrets')).toMatchObject({ spellLists: [], spellLevel: undefined, abilityOptions: ['Charisma'], raw: { configuration: { type: 'spell', pool: [], restriction: { level: 'available' }, choices: expect.any(Object) } } });
      if (ruleset === '2014' && (identifier === 'sorcerer' || identifier === 'paladin') || ruleset === '2024') expect(spells).toHaveLength(0);
      expect(summary.advancements.some((entry) => entry.type === 'ItemGrant' || entry.type === 'Subclass')).toBe(true);
    }
  });

  it('projects pinned Bard 2014 Magical Secrets without inventing a level restriction', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getClassSummary('2014', 'packs/_source/classes/bard.yml');
    const configuration = buildClassConfiguration(summary, lookupSnapshot, 10);
    const choice = configuration.choices.find((entry) => entry.kind === 'spell' && entry.advancementId === 'EC1yNAV6khHilOhz');
    if (choice === undefined || choice.kind !== 'spell') throw new Error('Expected Magical Secrets spell choice');
    expect(choice).not.toHaveProperty('level');
    expect(choice.count).toBe(2);
    const higherLevel = (choice.options ?? []).find((option) => option.source.name === 'Fireball');
    if (higherLevel === undefined) throw new Error('Expected Fireball in unrestricted Magical Secrets options');
    expect(setClassSelection(configuration, { ...choice, selected: [higherLevel.source] }).choices.find((entry) => entry.advancementId === choice.advancementId)).toMatchObject({ selected: [{ name: 'Fireball' }] });
  });

  it('projects the pinned 2024 Druid Magician cantrip choice after Primal Order', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getClassSummary('2024', 'packs/_source/classes24/druid/druid.yml');
    const magician = summary.advancements.find((entry) => entry.title === 'Primal Order: Magician');
    expect(magician).toMatchObject({ type: 'ItemChoice', spellLevel: 0, spellLists: ['druid'] });
    expect(magician?.requiresChoice).toEqual({ key: 'class:NpBpNlHOO43gMD0U', value: 'Compendium.dnd5e.classes24.Item.phbPrimalOrderMa' });
  });

  it('projects nested feature spell choices for the pinned 2024 Paladin and Ranger classes', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    for (const [sourcePath, featureName, spellList, ability] of [
      ['packs/_source/classes24/paladin/paladin.yml', 'Blessed Warrior', 'cleric', 'Charisma'],
      ['packs/_source/classes24/ranger/ranger.yml', 'Druidic Warrior', 'druid', 'Charisma'],
    ] as const) {
      const summary = await index.getClassSummary('2024', sourcePath);
      const spellChoice = summary.advancements.find((entry) => entry.title === 'Choose Cantrips' && entry.requiresChoice?.value.includes(featureName === 'Blessed Warrior' ? 'phbfstBlessedWar' : 'phbfstDruidicWar'));
      expect(spellChoice).toMatchObject({ type: 'ItemChoice', spellLevel: 0, spellLists: [spellList], abilityOptions: [ability], requiresChoice: expect.objectContaining({ key: expect.stringMatching(/^class:/) }), raw: { configuration: { type: 'spell', choices: expect.any(Object) } } });
    }
  });

  it('accepts a newly built pinned 2024 Wizard progression as a character progression', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getClassSummary('2024', 'packs/_source/classes24/wizard/wizard.yml');
    const configuration = buildClassConfiguration(summary, lookupSnapshot, 1);
    const document = withOrigin(withRuleset(createCharacterDocument('Wizard test', lookupSnapshot), '2024'), { sourcePath: 'packs/_source/origins24/species/human.yml', identifier: 'human', id: 'human-id' });
    const progression = toClassProgressionSelection(configuration);
    expect(progression).toEqual(expect.objectContaining({ class: expect.any(Object), targetLevel: 1, selections: expect.any(Array) }));
    expect(() => withClassProgression(document, progression)).not.toThrow();
  });

  it('rejects unsupported and mixed class spell restrictions instead of broadening them', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/wizard.yml`]: `type: class
name: Wizard
system:
  source: { rules: 2014 }
  identifier: wizard
  hitDice: d6
  advancement:
    - _id: unsupported
      type: ItemChoice
      level: 1
      configuration:
        type: spell
        choices: 1
        restriction: { list: [school:evocation], level: 1 }
        spell: { ability: [int] }
    - _id: mixed
      type: ItemChoice
      level: 1
      configuration:
        type: spell
        choices: 1
        restriction: { list: [class:wizard, school:evocation], level: 1 }
        spell: { ability: [int] }
_id: wizard-id`,
    }), root);

    const summary = await index.getClassSummary('2014', 'packs/_source/classes/wizard.yml');
    const configuration = buildClassConfiguration(summary, lookupSnapshot, 1);
    expect(configuration.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining('unsupported'),
      expect.stringContaining('mixed'),
    ]));
    expect(configuration.choices.filter((choice) => choice.kind === 'spell')).toEqual(expect.arrayContaining([
      expect.objectContaining({ advancementId: 'unsupported', options: [] }),
      expect.objectContaining({ advancementId: 'mixed', options: [] }),
    ]));
  });

  it('keeps descriptions for direct class feature choices', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const summary = await index.getClassSummary('2014', 'packs/_source/classes/fighter.yml');
    const style = summary.advancements.find((entry) => entry.title === 'Fighting Style');
    expect(style?.dependencies.find((dependency) => dependency.source?.name === 'Defense')?.description).toContain('While you are wearing armor');
  });

  it('reads pinned 2014 and 2024 background records', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    const old = await index.getBackgroundSummary('2014', 'packs/_source/backgrounds/acolyte.yml');
    const current = await index.getBackgroundSummary('2024', 'packs/_source/origins24/backgrounds/acolyte.yml');
    expect(old.skills).toEqual(expect.arrayContaining(['skills:ins', 'skills:rel']));
    expect(old.features[0]?.source.name).toBe('Shelter of the Faithful');
    expect(current.abilityScores?.points).toBe(3);
    expect(current.feat?.name).toBe('Magic Initiate');
    expect(current.languageChoices).toEqual([{ count: 2, pool: ['languages:standard:*'] }]);
    expect(current.tools).toEqual(['tool:art:calligrapher']);
  });

  it('preserves valid resistance selectors from pinned Dragonborn records without unresolved warnings', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    for (const [ruleset, path] of [['2014', 'packs/_source/races/dragonborn/dragonborn.yml'], ['2024', 'packs/_source/origins24/species/dragonborn.yml']] as const) {
      const result = buildSpeciesConfiguration(await index.getSpeciesSummary(ruleset, path), lookupSnapshot);
      expect(result.choices.flatMap((choice) => choice.options).map((option) => option.value)).toEqual(expect.arrayContaining(['dr:acid', 'dr:cold', 'dr:fire', 'dr:lightning', 'dr:poison']));
      expect(result.diagnostics.filter((diagnostic) => diagnostic.includes('dr:'))).toEqual([]);
      if (ruleset === '2014') {
        const ancestry = result.choices.find((choice) => choice.key === 'species:QIrBmvSmNOTEJLWn');
        expect(ancestry).toMatchObject({ label: 'Draconic Ancestry', count: 1 });
        expect(ancestry?.options[0]).toMatchObject({ label: 'Black', description: expect.stringContaining('exhale destructive acid') });
      }
    }
    const result = buildSpeciesConfiguration({ source: { ...lookupSnapshot, sourcePath: 'packs/_source/origins24/species/test.yml', pack: 'dnd5e.origins24', type: 'race', id: 'test', name: 'Test' }, ruleset: '2024', advancements: [{ id: 'resistance', type: 'Trait', level: 0, hint: 'Resistance', automatic: false, dependencies: [{ uuid: 'dr:necrotic', source: null, reason: 'unresolved selector' }], raw: { configuration: { choices: [{ count: 1, pool: ['dr:necrotic'] }] } } }] }, lookupSnapshot);
    expect(result.choices[0]?.options[0]).toMatchObject({ value: 'dr:necrotic', label: 'Necrotic', source: { type: 'damage-resistance' } });
    expect(result.diagnostics).toEqual([]);
  });

  it('deduplicates a source feature reached directly and through a nested grant', async () => {
    const root = 'sources';
    const uuid = 'Compendium.dnd5e.feats.Item.shared';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/elf.yml`]: `type: race\nname: Elf\nsystem:\n  source: { rules: 2024 }\n  identifier: elf\n  advancement:\n    - _id: direct\n      type: ItemGrant\n      level: 1\n      configuration: { items: [{ uuid: ${uuid} }] }\n_id: elf-id`,
      [`${root}/packs/_source/feats/shared.yml`]: `type: feat\nname: Shared\nsystem:\n  advancement:\n    - _id: nested\n      type: ItemGrant\n      level: 1\n      configuration: { uuid: ${uuid} }\n_id: shared`,
    }), root);
    const result = buildSpeciesConfiguration(await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/elf.yml'), lookupSnapshot);
    expect(result.grants).toHaveLength(1);
    expect(result.grants[0]?.source).toEqual({ id: 'shared', type: 'feat', name: 'Shared' });
  });

  it('does not warn when a nested granted feature has a valid empty advancement list', async () => {
    const root = 'sources';
    const uuid = 'Compendium.dnd5e.feats.Item.shared';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/elf.yml`]: `type: race\nname: Elf\nsystem:\n  source: { rules: 2024 }\n  identifier: elf\n  advancement:\n    - _id: direct\n      type: ItemGrant\n      level: 1\n      configuration: { items: [{ uuid: ${uuid} }] }\n_id: elf-id`,
      [`${root}/packs/_source/feats/shared.yml`]: `type: feat\nname: Shared\nsystem:\n  advancement: []\n  identifier: shared\n_id: shared`,
    }), root);
    const summary = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/elf.yml');
    expect(summary.advancements.some((entry) => entry.type === 'Unsupported')).toBe(false);
  });

  it('extracts array-form 2024 advancements and leaves choices pending', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/elf.yml`]: `type: race
name: Elf
system:
  source: { rules: 2024 }
  identifier: elf
  advancement:
    - _id: choice
      type: AbilityScoreImprovement
      level: 1
      hint: Choose an ability
      configuration: { choices: 1, pool: [Compendium.dnd5e.feats.Item.missing] }
_id: elf-id`,
    }), root);
    await expect(index.getSpeciesSummary('2024', 'packs/_source/origins24/species/elf.yml')).resolves.toMatchObject({
      advancements: [{ id: 'choice', automatic: false, dependencies: [{ uuid: 'Compendium.dnd5e.feats.Item.missing', source: null, reason: expect.stringContaining('unresolved') }] }],
    });
  });

  it('follows nested advancement dependencies and terminates cycles with diagnostics', async () => {
    const root = 'sources';
    const uuid = (id: string) => `Compendium.dnd5e.feats.Item.${id}`;
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/elf.yml`]: `type: race\nname: Elf\nsystem:\n  source: { rules: 2024 }\n  identifier: elf\n  advancement:\n    - _id: root\n      type: ItemGrant\n      level: 1\n      configuration: { uuid: ${uuid('nested')} }\n_id: elf-id`,
      [`${root}/packs/_source/feats/nested.yml`]: `type: feat\nname: Nested\nsystem:\n  advancement:\n    - _id: nested-choice\n      type: ItemChoice\n      level: 1\n      configuration: { choices: 1, pool: [${uuid('nested')}] }\n_id: nested`,
    }), root);
    const summary = await index.getSpeciesSummary('2024', 'packs/_source/origins24/species/elf.yml');
    expect(summary.advancements.some((entry) => entry.id === 'nested-choice')).toBe(true);
    expect(summary.advancements.some((entry) => entry.dependencies.some((dependency) => dependency.reason?.includes('cyclic')))).toBe(true);
    expect(buildSpeciesConfiguration(summary, lookupSnapshot).choices.some((choice) => choice.key === 'species:nested-choice')).toBe(true);
    expect(summary.advancements.length).toBeLessThan(20);
  });

  it('reports malformed advancements with the species path', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/races/bad.yml`]: `type: race
name: Bad
system: { source: { rules: 2014 }, identifier: bad, advancement: { nope: { type: ItemGrant } } }
_id: bad-id`,
    }), root);
    await expect(index.getSpeciesSummary('2014', 'packs/_source/races/bad.yml')).rejects.toThrow('packs/_source/races/bad.yml');
  });

  it('reads nested Foundry summary fields and preserves malformed UUID-bearing values', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/gnome.yml`]: `type: race
name: Gnome
system:
  source: { rules: 2024 }
  identifier: gnome
  description: { value: Deeply curious. }
  type: { value: humanoid }
  advancement:
    - _id: grant
      type: ItemGrant
      level: 1
      hint: Feature
      configuration: { uuid: not-a-valid-uuid }
_id: gnome-id`,
    }), root);
    await expect(index.getSpeciesSummary('2024', 'packs/_source/origins24/species/gnome.yml')).resolves.toMatchObject({
      description: 'Deeply curious.',
      creatureType: { value: 'humanoid' },
      advancements: [{ dependencies: [{ uuid: 'not-a-valid-uuid', source: null, reason: expect.stringContaining('malformed') }] }],
    });
  });

  it('projects nested Foundry description markup into readable plain text', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/origins24/species/elf.yml`]: `type: race
name: Elf
system:
  source: { rules: 2024 }
  identifier: elf
  description:
    value: '<h3>Elven Lineage</h3><p><strong>Elves</strong> are graceful. @UUID[Compendium.dnd5e.feats.Item.darkvision]{Darkvision} lets them see in darkness. @Embed[Compendium.dnd5e.feats.Item.trance]</p>'
_id: elf-id`,
    }), root);

    await expect(index.getSpeciesSummary('2024', 'packs/_source/origins24/species/elf.yml')).resolves.toMatchObject({
      description: 'Elven Lineage Elves are graceful. Darkvision lets them see in darkness.',
    });
  });

  it('removes Foundry-only secret notes and normalizes inline references in feature descriptions', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/races/dwarf.yml`]: `type: race
name: Dwarf
system:
  source: { rules: 2014 }
  identifier: dwarf
  advancement:
    grant:
      _id: grant
      type: ItemGrant
      level: 1
      configuration: { uuid: Compendium.dnd5e.feats.Item.training }
_id: dwarf-id`,
      [`${root}/packs/_source/feats/training.yml`]: `type: feat
name: Training
system:
  description:
    value: '<p>See: &amp;Reference[unarmedstrike]. A target can be &amp;Reference[Restrained apply].</p><section class="secret"><p><strong>Foundry Note</strong></p><p>Configure this in Foundry.</p></section>'
_id: training`,
    }), root);

    const summary = await index.getSpeciesSummary('2014', 'packs/_source/races/dwarf.yml');

    expect(summary.features?.[0]?.description).toBe('See: Unarmed strike. A target can be Restrained.');
  });

  it('preserves species feature levels and routes only feat dependencies into feature summaries', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/races/dragonborn.yml`]: `type: race
name: Dragonborn
system:
  source: { rules: 2014 }
  identifier: dragonborn
  advancement:
    - _id: flight
      type: ItemGrant
      level: 5
      configuration: { items: [{ uuid: Compendium.dnd5e.feats.Item.draconic-flight }] }
    - _id: no-level
      type: ItemGrant
      configuration: { items: [{ uuid: Compendium.dnd5e.feats.Item.no-level }] }
    - _id: chosen-flight
      type: ItemChoice
      level: 7
      configuration: { choices: 1, items: [{ uuid: Compendium.dnd5e.feats.Item.chosen-flight }] }
_id: dragonborn-id`,
      [`${root}/packs/_source/feats/draconic-flight.yml`]: 'type: feat\nname: Draconic Flight\nsystem: {}\n_id: draconic-flight',
      [`${root}/packs/_source/feats/no-level.yml`]: 'type: feat\nname: No Level\nsystem: {}\n_id: no-level',
      [`${root}/packs/_source/feats/chosen-flight.yml`]: 'type: feat\nname: Chosen Flight\nsystem: {}\n_id: chosen-flight',
      [`${root}/packs/_source/classes/barbarian.yml`]: `type: class
name: Barbarian
system:
  source: { rules: 2014 }
  identifier: barbarian
  hitDice: d12
  advancement:
    - _id: rage
      type: ItemGrant
      level: 1
      configuration: { items: [{ uuid: Compendium.dnd5e.feats.Item.rage }, { uuid: Compendium.dnd5e.items.Item.unarmed-strike }] }
_id: barbarian-id`,
      [`${root}/packs/_source/feats/rage.yml`]: 'type: feat\nname: Rage\nsystem: {}\n_id: rage',
      [`${root}/packs/_source/items/unarmed-strike.yml`]: 'type: weapon\nname: Unarmed Strike\nsystem: {}\n_id: unarmed-strike',
    }), root);

    const dragonborn = await index.getSpeciesSummary('2014', 'packs/_source/races/dragonborn.yml');
    expect(dragonborn.features).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: expect.objectContaining({ name: 'Draconic Flight', type: 'feat' }), level: 5 }),
      expect.objectContaining({ source: expect.objectContaining({ name: 'No Level', type: 'feat' }), level: 0 }),
      expect.objectContaining({
        source: expect.objectContaining({ name: 'Chosen Flight', type: 'feat' }),
        selection: { key: 'species:chosen-flight', value: 'Compendium.dnd5e.feats.Item.chosen-flight' },
      }),
    ]));

    const barbarian = await index.getClassSummary('2014', 'packs/_source/classes/barbarian.yml');
    expect(barbarian.features?.map((feature) => feature.source.name)).not.toContain('Unarmed Strike');
    expect(barbarian.features?.map((feature) => feature.source.name)).toContain('Rage');
  });

  it('indexes complete species records separately by ruleset and UUID', async () => {
    const root = 'plugin/sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/races/dwarf.yml`]: 'type: race\nname: Dwarf\nsystem:\n  source:\n    rules: 2014\n  identifier: dwarf\n_id: dwarf-id',
      [`${root}/packs/_source/races/elf/high-elf.yml`]: 'type: race\nname: High Elf\nsystem:\n  source:\n    rules: 2024\n  identifier: high-elf\n_id: high-elf-id',
      [`${root}/packs/_source/races/elf/elf-features/darkvision.yml`]: 'type: feat\nname: Darkvision',
      [`${root}/packs/_source/races/_folder.yml`]: 'type: folder\nname: Races',
      [`${root}/packs/_source/origins24/species/elf.yml`]: 'type: race\nname: Elf\nsystem:\n  source:\n    rules: 2024\n  identifier: elf\n_id: elf-id',
      [`${root}/packs/_source/origins24/species/elf/feature.yml`]: 'type: feat\nname: Feature\nsystem:\n  identifier: feature\n_id: feature-id',
    }), root);

    await expect(index.listSpecies('2014')).resolves.toEqual([{
      pack: 'dnd5e.races', type: 'race', id: 'dwarf-id', name: 'Dwarf', identifier: 'dwarf', sourcePath: 'packs/_source/races/dwarf.yml',
    }]);
    await expect(index.listSpecies('2024')).resolves.toEqual([{
      pack: 'dnd5e.origins24', type: 'race', id: 'elf-id', name: 'Elf', identifier: 'elf', sourcePath: 'packs/_source/origins24/species/elf.yml',
    }]);
    await expect(index.getByUuid('Compendium.dnd5e.origins24.Item.elf-id')).resolves.toMatchObject({ id: 'elf-id', pack: 'dnd5e.origins24' });
    await expect(index.getByUuid('Compendium.dnd5e.origins24.elf-id')).resolves.toMatchObject({ id: 'elf-id', pack: 'dnd5e.origins24' });
    await expect(index.getByUuid('Compendium.dnd5e.origins24.Item.feature-id')).resolves.toMatchObject({ id: 'feature-id', type: 'feat', pack: 'dnd5e.origins24', sourcePath: 'packs/_source/origins24/species/elf/feature.yml' });
    await expect(index.getByUuid('Compendium.dnd5e.origins24.feature-id')).resolves.toMatchObject({ id: 'feature-id', type: 'feat' });
  });
  it('represents a species relationship projection without renaming upstream fields', () => {
    const summary: SpeciesSourceSummary = {
      source: {
        sourcePath: 'packs/_source/origins24/species/elf.yml',
        pack: 'dnd5e.species',
        type: 'race',
        id: 'elf-id',
        identifier: 'elf',
        name: 'Elf',
      },
      ruleset: '2024',
      description: 'Elves are magical people.',
      movement: { walk: 30 },
      senses: { darkvision: 60 },
      creatureType: { value: 'humanoid' },
      advancements: [
        {
          id: 'grant-id',
          type: 'ItemGrant',
          level: 1,
          hint: 'Automatic grant',
          automatic: true,
          dependencies: [{ uuid: 'Compendium.dnd5e.feats.Item.darkvision', source: null, reason: 'granted' }],
          raw: { type: 'ItemGrant', configuration: { uuid: 'Compendium.dnd5e.feats.Item.darkvision' }, level: 1, _id: 'grant-id' },
        },
        {
          id: 'choice-id',
          type: 'AbilityScoreImprovement',
          level: 1,
          hint: 'Choose an advancement',
          automatic: false,
          dependencies: [],
          raw: { type: 'AbilityScoreImprovement', configuration: { choices: 1 }, level: 1, _id: 'choice-id' },
        },
      ],
    };

    expect(summary.advancements[0].raw).toMatchObject({ type: 'ItemGrant', configuration: expect.any(Object), level: 1, _id: 'grant-id' });
    expect(summary.advancements[0].dependencies[0].uuid).toBe('Compendium.dnd5e.feats.Item.darkvision');
  });

  it('lists only top-level race records for the selected ruleset', async () => {
    const root = 'plugin/sources';
    const reader = createSourceReader(memoryAdapter({
      [`${root}/packs/_source/races/dwarf.yml`]: 'type: race\nname: Dwarf\nsystem:\n  identifier: dwarf\n_id: dwarf-id',
      [`${root}/packs/_source/races/elf/high-elf.yml`]: 'type: race\nname: High Elf\nsystem:\n  identifier: high-elf\n_id: high-elf-id',
      [`${root}/packs/_source/races/elf/elf-features/darkvision.yml`]: 'type: feat\nname: Darkvision',
      [`${root}/packs/_source/races/_folder.yml`]: 'type: folder\nname: Races',
      [`${root}/packs/_source/races/elf/_folder.yml`]: 'type: folder\nname: Elf',
      [`${root}/packs/_source/races/dwarf/dwarf-features/darkvision.yml`]: 'type: feat\nname: Darkvision',
      [`${root}/packs/_source/origins24/species/elf.yml`]: 'type: race\nname: Elf\nsystem:\n  identifier: elf\n_id: elf-id',
    }), root);
    await expect(reader.listOrigins('2014')).resolves.toEqual([
      { name: 'Dwarf', identifier: 'dwarf', id: 'dwarf-id', sourcePath: 'packs/_source/races/dwarf.yml' },
      { name: 'High Elf', identifier: 'high-elf', id: 'high-elf-id', sourcePath: 'packs/_source/races/elf/high-elf.yml' },
    ]);
    await expect(reader.listOrigins('2024')).resolves.toEqual([{ name: 'Elf', identifier: 'elf', id: 'elf-id', sourcePath: 'packs/_source/origins24/species/elf.yml' }]);
  });

  it('sorts options by display name and rejects malformed candidates with their path', async () => {
    const root = 'sources';
    const reader = createSourceReader(memoryAdapter({
      [`${root}/packs/_source/races/z.yml`]: 'type: race\nname: Zealot\nsystem:\n  identifier: zealot\n_id: z',
      [`${root}/packs/_source/races/a.yml`]: 'type: item\nname: Not a race',
      [`${root}/packs/_source/races/b.yml`]: 'type: race\nname: Missing id\nsystem: {}',
    }), root);
    await expect(reader.listOrigins('2014')).rejects.toThrow('packs/_source/races/a.yml');
  });

  it('reports missing source files as an actionable source-unavailable error', async () => {
    await expect(createSourceReader(memoryAdapter({}), 'sources').listOrigins('2024')).rejects.toThrow('Source files are not available');
  });

  it('rejects an unsupported ruleset', async () => {
    await expect(createSourceReader(memoryAdapter({}), 'sources').listOrigins('2019' as never)).rejects.toThrow('Invalid character ruleset');
  });

  it('retains feature activities and use recovery metadata', async () => {
    const root = 'sources';
    const index = createSourceIndex(memoryAdapter({
      [`${root}/packs/_source/classes/fighter.yml`]: `type: class
name: Fighter
system:
  source: { rules: 2014 }
  hitDice: d10
  advancement:
    - _id: feature
      type: ItemGrant
      level: 1
      configuration: { items: [{ uuid: Compendium.dnd5e.classfeatures.Item.feature }] }
_id: fighter`,
      [`${root}/packs/_source/classfeatures/feature.yml`]: `type: feat
name: Second Wind
system:
  uses: { max: 2, recovery: [{ period: sr, type: recoverAll }] }
  activities: { use: { _id: use, type: heal, activation: { type: bonus, value: 1 } } }
_id: feature`,
    }), root);
    await expect(index.getClassSummary('2014', 'packs/_source/classes/fighter.yml')).resolves.toMatchObject({ features: [{ uses: { maximum: 2, recovery: [{ period: 'sr', type: 'recoverAll' }] }, activities: [{ id: 'use', type: 'heal' }] }] });
  });

  it('retains authoritative size advancement identity, level, and options', async () => {
    const root = join(process.cwd(), 'external/foundryvtt/dnd5e');
    const adapter: SourceReaderAdapter = {
      async exists(path) { try { await fs.access(path); return true; } catch { return false; } },
      async list(path) { const entries = await fs.readdir(path, { recursive: true, withFileTypes: true }); return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath ?? entry.path, entry.name)); },
      async read(path) { return fs.readFile(path, 'utf8'); },
    };
    const index = createSourceIndex(adapter, root);
    for (const identifier of ['human', 'tiefling-abyssal', 'tiefling-chthonic', 'tiefling-infernal']) {
      const summary = await index.getSpeciesSummary('2024', `packs/_source/origins24/species/${identifier}.yml`);
      expect(summary.size).toMatchObject({ level: 0, sizes: ['sm', 'med'] });
      expect(summary.size?.advancementId).toBeTruthy();
      expect(summary.advancements.find((entry) => entry.id === summary.size?.advancementId)).toMatchObject({ type: 'Size', level: 0 });
    }
  });
});
