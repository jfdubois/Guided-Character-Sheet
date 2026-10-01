import { describe, expect, it } from 'vitest';
import { createFoundrySourceCatalog, type FoundrySourceCatalogAdapter } from '../src/foundry-source-catalog';

function memoryAdapter(files: Record<string, string>): FoundrySourceCatalogAdapter {
  return {
    async exists(path) { return Object.keys(files).some((file) => file === path || file.startsWith(`${path}/`)); },
    async list(path) { return Object.keys(files).filter((file) => file.startsWith(`${path}/`)); },
    async read(path) { const value = files[path]; if (value === undefined) throw new Error(`missing ${path}`); return value; },
  };
}

describe('Foundry source catalog', () => {
  it.each([
    ['weapon', 'false', true],
    ['equipment', 'true', true],
    ['tool', 'false', true],
    ['container', 'false', true],
    ['consumable', 'false', true],
    ['loot', 'false', false],
    ['weapon', 'null', false],
  ])('checks the pinned %s item model before offering Equip (equipped: %s)', async (type, equipped, expected) => {
    const sourcePath = `packs/_source/equipment24/${type}.yml`;
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`sources/${sourcePath}`]: `type: ${type}\nname: Test item\n_id: test-item\nsystem:\n  source: { rules: '2024' }\n  equipped: ${equipped}`,
    }), 'sources');
    await expect(catalog.getItemSummary('2024', sourcePath)).resolves.toMatchObject({ equippable: expected });
  });

  it('reads one item directly and preserves supported equipment semantics', async () => {
    const root = 'sources';
    const armorPath = 'packs/_source/equipment24/armor/heavy/chain-mail.yml';
    const attunedPath = 'packs/_source/equipment24/armor/wondrous-mail.yml';
    const adapter = memoryAdapter({
      [`${root}/${armorPath}`]: `type: equipment
name: Chain Mail
system:
  source: { rules: '2024' }
  equipped: false
  attunement: ''
  armor: { value: 16, dex: 0 }
  strength: 13
  type: { value: heavy, baseItem: chainmail }
  properties: [stealthDisadvantage]
  weight: { value: 55, units: lb }
_id: chain-mail`,
      [`${root}/${attunedPath}`]: `type: equipment
name: Wondrous Mail
system:
  source: { rules: '2024' }
  equipped: false
  attunement: required
  armor: { value: 15, dex: 2 }
  type: { value: medium, baseItem: halfplate }
  properties: []
_id: wondrous-mail`,
    });
    const catalog = createFoundrySourceCatalog({
      ...adapter,
      async list() { throw new Error('direct lookup must not list the item pack'); },
    }, root);

    await expect(catalog.getItemSummary('2024', armorPath)).resolves.toMatchObject({
      name: 'Chain Mail',
      category: 'heavy',
      subcategory: 'chainmail',
      equippable: true,
      armor: { value: 16, dex: 0 },
      strength: 13,
      properties: ['stealthDisadvantage'],
    });
    await expect(catalog.getItemSummary('2024', attunedPath)).resolves.toMatchObject({ attunement: 'required' });
    await expect(catalog.getItemSummary('2024', 'packs/_source/equipment24/armor/missing.yml')).resolves.toBeNull();
    await expect(catalog.getItemSummary('2014', armorPath)).resolves.toBeNull();
  });

  it('normalizes Foundry references and removes secret notes from catalog descriptions', async () => {
    const root = 'sources';
    const sourcePath = 'packs/_source/equipment24/weapons/unarmed-strike.yml';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/${sourcePath}`]: `type: weapon
name: Unarmed Strike
system:
  source: { rules: '2024' }
  description:
    value: '<p>See: &amp;Reference[unarmedstrike]</p><section class="secret"><p>Foundry configuration note.</p></section>'
_id: unarmed-strike`,
    }), root);

    await expect(catalog.getItemSummary('2024', sourcePath)).resolves.toMatchObject({
      description: 'See: Unarmed strike',
    });
  });

  it('resolves a legacy item explicitly referenced by 2024 content', async () => {
    const root = 'sources';
    const sourcePath = 'packs/_source/items/equipment/travelers-clothes.yml';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/${sourcePath}`]: `type: equipment
name: Traveler's Clothes
system:
  source: { rules: '2014' }
  equipped: false
  attunement: ''
  armor: { value: null, dex: null }
  type: { value: clothing, baseItem: '' }
  properties: []
  weight: { value: 4, units: lb }
_id: travelers-clothes`,
    }), root);

    await expect(catalog.getItemSummary('2024', sourcePath)).resolves.toMatchObject({
      name: "Traveler's Clothes",
      ruleset: '2014',
      category: 'clothing',
      weight: { value: 4, units: 'lb' },
    });
  });

  it('searches item source records with ruleset and rarity filters', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/equipment24/weapons/mace.yml`]: `type: weapon
name: Mace
system:
  source: { rules: 2024 }
  rarity: common
  quantity: 1
  price: { value: 5, denomination: gp }
  weight: { value: 4, units: lb }
  description: { value: '<p>A mace.</p>' }
_id: mace`,
      [`${root}/packs/_source/equipment24/weapons/sword.yml`]: `type: weapon
name: Flame Sword
system:
  source: { rules: 2024 }
  rarity: rare
_id: sword`,
    }), root);

    await expect(catalog.searchItems('mace', { ruleset: '2024', rarity: 'common' })).resolves.toEqual([
      expect.objectContaining({ name: 'Mace', itemType: 'weapon', rarity: 'common', price: { value: 5, denomination: 'gp' }, weight: { value: 4, units: 'lb' } }),
    ]);
    const [item] = await catalog.searchItems('mace', { ruleset: '2024' });
    expect(item).not.toHaveProperty('raw');
  });

  it('searches normalized 2024 spells by level and spell list', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/spells24/cantrips/wizard-cantrip.yml`]: `type: spell
name: Wizard Cantrip
system:
  source: { rules: 2024 }
  level: 0
  school: evo
  spellLists: [wizard]
  properties: [vocal]
  description: { value: '<p>A wizard cantrip.</p>' }
_id: wizard-cantrip`,
      [`${root}/packs/_source/spells24/1st-level/cleric-first-level.yml`]: `type: spell
name: Cleric First-Level Spell
system:
  source: { rules: 2024 }
  level: 1
  school: abj
  spellLists: [cleric]
  properties: [ritual]
_id: cleric-first-level`,
      [`${root}/packs/_source/spells24/1st-level/wizard-first-level.yml`]: `type: spell
name: Wizard First-Level Spell
system:
  source: { rules: 2024 }
  level: 1
  school: ill
  spellLists: [wizard]
_id: wizard-first-level`,
    }), root);

    await expect(catalog.searchSpells({ ruleset: '2024', level: 0, spellLists: ['wizard'] })).resolves.toEqual([
      expect.objectContaining({ name: 'Wizard Cantrip', level: 0, spellLists: ['wizard'] }),
    ]);
    await expect(catalog.searchSpells({ ruleset: '2024', level: 1, spellLists: ['cleric'] })).resolves.toEqual([
      expect.objectContaining({ name: 'Cleric First-Level Spell', level: 1 }),
    ]);
  });

  it('associates pinned 2014 and 2024 spell-list Journal pages with spell records', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/spells24/cantrips/wizard-cantrip.yml`]: `type: spell
name: Pinned Wizard Cantrip
system:
  source: { rules: 2024 }
  level: 0
  school: evo
  properties: []
_id: pinned-wizard-cantrip`,
      [`${root}/packs/_source/spells24/1st-level/cleric-spell.yml`]: `type: spell
name: Pinned Cleric Spell
system:
  source: { rules: 2024 }
  level: 1
  properties: []
_id: pinned-cleric-spell`,
      [`${root}/packs/_source/spells/1st-level/wizard-spell.yml`]: `type: spell
name: Pinned 2014 Wizard Spell
system:
  source: { rules: 2014 }
  level: 1
  properties: []
_id: pinned-wizard-spell`,
      [`${root}/packs/_source/content24/chapter-7/spells.yml`]: `name: Spells
pages:
  - name: Wizard Spell List
    type: spells
    _id: wizard-list
    system:
      type: class
      spells:
        - Compendium.dnd5e.spells24.Item.pinned-wizard-cantrip
  - name: Cleric Spell List
    type: spells
    _id: cleric-list
    system:
      type: class
      spells:
        - Compendium.dnd5e.spells24.Item.pinned-cleric-spell`,
      [`${root}/packs/_source/rules/chapter-10-spellcasting.yml`]: `name: 'Chapter 10: Spellcasting'
pages:
  - name: Wizard Spells
    type: spells
    _id: wizard-list-2014
    system:
      identifier: wizard
      spells:
        - Compendium.dnd5e.spells.Item.pinned-wizard-spell`,
    }), root);

    await expect(catalog.searchSpells({ ruleset: '2024', spellLists: ['wizard'] })).resolves.toEqual([
      expect.objectContaining({ name: 'Pinned Wizard Cantrip', spellLists: ['wizard'] }),
    ]);
    await expect(catalog.searchSpells({ ruleset: '2024', spellLists: ['cleric'] })).resolves.toEqual([
      expect.objectContaining({ name: 'Pinned Cleric Spell', spellLists: ['cleric'] }),
    ]);
    await expect(catalog.searchSpells({ ruleset: '2024', spellLists: ['cleric'], query: 'wizard' })).resolves.toEqual([]);
    await expect(catalog.searchSpells({ ruleset: '2014', spellLists: ['wizard'] })).resolves.toEqual([
      expect.objectContaining({ name: 'Pinned 2014 Wizard Spell', spellLists: ['wizard'] }),
    ]);
  });

  it('excludes a Wizard-list spell from a Cleric-only query and preserves descriptions', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/spells24/1st-level/wizard-spell.yml`]: `type: spell
name: Wizard Spell
system:
  source: { rules: 2024 }
  level: 1
  spellLists: [wizard]
  description: { value: '<p>Only a wizard can use this.</p>' }
_id: wizard-spell`,
    }), root);

    await expect(catalog.searchSpells({ ruleset: '2024', level: 1, spellLists: ['cleric'] })).resolves.toEqual([]);
    await expect(catalog.searchSpells({ ruleset: '2024', level: 1, spellLists: ['wizard'] })).resolves.toEqual([
      expect.objectContaining({ description: 'Only a wizard can use this.' }),
    ]);
  });

  it('lists 2014 spells and resolves explicit spell UUIDs through the spell pack', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/spells/1st-level/cleric-spell.yml`]: `type: spell
name: 2014 Cleric Spell
system:
  source: { rules: 2014 }
  level: 1
  school: abj
  spellLists: [cleric]
_id: cleric-spell`,
    }), root);

    await expect(catalog.listSpells('2014')).resolves.toEqual([
      expect.objectContaining({ name: '2014 Cleric Spell', ruleset: '2014', level: 1 }),
    ]);
    await expect(catalog.resolveDependencies({ uuid: 'Compendium.dnd5e.spells.Item.cleric-spell' })).resolves.toEqual([
      expect.objectContaining({ source: expect.objectContaining({ name: '2014 Cleric Spell' }) }),
    ]);
  });

  it('skips supplemental non-spell records when searching 2014 and 2024 spell packs', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/spells/1st-level/2014-spell.yml`]: `type: spell
name: 2014 Spell
system:
  source: { rules: '2014' }
  level: 1
  properties: []
_id: spell-2014`,
      [`${root}/packs/_source/spells/supplemental-items/conjured-flame-blade.yml`]: `type: weapon
name: Conjured Flame Blade
system:
  source: { rules: '2014' }
  identifier: conjured-flame-blade
  properties: [mgc]
_id: 8cPlf8sC5j7O6mTv`,
      [`${root}/packs/_source/spells24/cantrips/2024-spell.yml`]: `type: spell
name: 2024 Spell
system:
  source: { rules: '2024' }
  level: 0
  properties: []
_id: spell-2024`,
      [`${root}/packs/_source/spells24/supplemental-items/magical-berries.yml`]: `type: consumable
name: Magical Berries
system:
  source: { rules: '2024' }
  identifier: magical-berries
  properties: [mgc]
_id: phbutlMagicalBer`,
    }), root);

    await expect(catalog.searchSpells({ ruleset: '2014', level: 1 })).resolves.toEqual([
      expect.objectContaining({ name: '2014 Spell', type: 'spell', ruleset: '2014' }),
    ]);
    await expect(catalog.searchSpells({ ruleset: '2024', level: 0 })).resolves.toEqual([
      expect.objectContaining({ name: '2024 Spell', type: 'spell', ruleset: '2024' }),
    ]);
  });

  it('does not reread a spell pack when querying repeated filters', async () => {
    const root = 'sources';
    let reads = 0;
    const adapter = memoryAdapter({
      [`${root}/packs/_source/spells24/cantrips/cached-spell.yml`]: `type: spell
name: Cached Spell
system:
  source: { rules: 2024 }
  level: 0
  spellLists: [wizard]
_id: cached-spell`,
    });
    const counted = { ...adapter, async read(path: string) { reads += 1; return adapter.read(path); } };
    const catalog = createFoundrySourceCatalog(counted, root);
    await catalog.searchSpells({ ruleset: '2024', level: 0, spellLists: ['wizard'] });
    const firstReadCount = reads;
    await catalog.searchSpells({ ruleset: '2024', level: 0, spellLists: ['wizard'] });
    expect(firstReadCount).toBeGreaterThan(0);
    expect(reads).toBe(firstReadCount);
  });

  it('rejects a malformed spell record with its source path', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/spells24/cantrips/malformed.yml`]: `type: spell
name: Malformed Spell
system:
  source: { rules: 2024 }
  level: invalid
_id: malformed-spell`,
    }), root);

    await expect(catalog.listSpells('2024')).rejects.toThrow('packs/_source/spells24/cantrips/malformed.yml');
  });

  it('rejects a missing or unsupported spell ruleset with its source path', async () => {
    const root = 'sources';
    const files: Record<string, string> = {
      [`${root}/packs/_source/spells24/cantrips/missing-ruleset.yml`]: `type: spell
name: Missing Ruleset
system:
  level: 0
_id: missing-ruleset`,
    };
    const catalog = createFoundrySourceCatalog(memoryAdapter(files), root);
    await expect(catalog.listSpells('2024')).rejects.toThrow('packs/_source/spells24/cantrips/missing-ruleset.yml');

    files[`${root}/packs/_source/spells24/cantrips/missing-ruleset.yml`] = `type: spell
name: Unsupported Ruleset
system:
  source: { rules: 2030 }
  level: 0
_id: unsupported-ruleset`;
    await expect(catalog.listSpells('2024')).rejects.toThrow('packs/_source/spells24/cantrips/missing-ruleset.yml');
  });

  it('clears a rejected spell indexing promise so a later query can retry', async () => {
    const root = 'sources';
    const path = `${root}/packs/_source/spells24/cantrips/retry.yml`;
    const files: Record<string, string> = {
      [path]: `type: spell
name: Retry Spell
system:
  source: { rules: 2030 }
  level: 0
_id: retry-spell`,
    };
    const catalog = createFoundrySourceCatalog(memoryAdapter(files), root);
    await expect(catalog.listSpells('2024')).rejects.toThrow(path.slice(root.length + 1));
    files[path] = `type: spell
name: Retry Spell
system:
  source: { rules: 2024 }
  level: 0
_id: retry-spell`;
    await expect(catalog.listSpells('2024')).resolves.toEqual([
      expect.objectContaining({ name: 'Retry Spell', level: 0 }),
    ]);
  });

  it('expands tool wildcards into source-backed tool pools', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/equipment24/tools/artisan/calligrapher.yml`]: 'type: tool\nname: Calligrapher\nsystem: { source: { rules: 2024 }, identifier: calligrapher }\n_id: calligrapher',
      [`${root}/packs/_source/equipment24/tools/musical/flute.yml`]: 'type: tool\nname: Flute\nsystem: { source: { rules: 2024 }, identifier: flute }\n_id: flute',
    }), root);
    await expect(catalog.resolveSelector('tools:*', '2024')).resolves.toHaveLength(2);
    await expect(catalog.resolveSelector('tool:art:*', '2024')).resolves.toEqual([expect.objectContaining({ name: 'Calligrapher' })]);
  });

  it('resolves tool wildcard dependencies into source-backed options', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/equipment24/tools/artisan/calligrapher.yml`]: 'type: tool\nname: Calligrapher\nsystem: { source: { rules: 2024 }, identifier: calligrapher }\n_id: calligrapher',
      [`${root}/packs/_source/equipment24/tools/musical/flute.yml`]: 'type: tool\nname: Flute\nsystem: { source: { rules: 2024 }, identifier: flute }\n_id: flute',
    }), root);

    await expect(catalog.resolveDependencies({ choices: [{ count: 3, pool: ['tool:*'] }] }, '2024')).resolves.toEqual([
      expect.objectContaining({ uuid: 'tool:*', source: expect.objectContaining({ name: 'Calligrapher' }) }),
      expect.objectContaining({ uuid: 'tool:*', source: expect.objectContaining({ name: 'Flute' }) }),
    ]);
  });

  it('marks recognized language selectors as synthetic instead of unresolved', async () => {
    const catalog = createFoundrySourceCatalog(memoryAdapter({}), 'sources');
    const dependencies = await catalog.resolveDependencies({ grants: ['languages:exotic:druidic'] }, '2024');
    expect(dependencies).toEqual([{ uuid: 'languages:exotic:druidic', source: null, reason: 'unresolved selector' }]);
  });

  it('resolves language selectors and expands the all-languages wildcard', async () => {
    const catalog = createFoundrySourceCatalog(memoryAdapter({}), 'sources');

    await expect(catalog.resolveSelector('languages:standard:common', '2014')).resolves.toEqual([
      expect.objectContaining({ name: 'Common', identifier: 'common', category: 'standard' }),
    ]);
    const languages = await catalog.resolveSelector('languages:*', '2014');
    expect(languages).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Common', identifier: 'common' }),
      expect.objectContaining({ name: 'Abyssal', identifier: 'abyssal' }),
      expect.objectContaining({ name: 'Primordial (Aquan)', identifier: 'aquan' }),
    ]));
  });

  it('does not treat spell restriction lists as dependencies', async () => {
    const catalog = createFoundrySourceCatalog(memoryAdapter({}), 'sources');
    await expect(catalog.resolveDependencies({ type: 'spell', restriction: { list: ['class:wizard'] } })).resolves.toEqual([]);
  });

  it('keeps focus and armor selectors limited to their source categories', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/items/spellcasting-focus/wand.yml`]: 'type: equipment\nname: Wand\nsystem: { source: { rules: 2014 } }\n_id: wand',
      [`${root}/packs/_source/items/armor/heavy/chain-mail.yml`]: 'type: equipment\nname: Chain Mail\nsystem: { source: { rules: 2014 } }\n_id: chain',
      [`${root}/packs/_source/items/armor/light/leather.yml`]: 'type: equipment\nname: Leather\nsystem: { source: { rules: 2014 } }\n_id: leather',
    }), root);
    await expect(catalog.resolveSelector('focus:*', '2014')).resolves.toEqual([expect.objectContaining({ name: 'Wand' })]);
    await expect(catalog.resolveSelector('armor:hvy:*', '2014')).resolves.toEqual([expect.objectContaining({ name: 'Chain Mail' })]);
  });

  it('excludes magical and rare items from starting-equipment selectors', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/equipment24/weapons/simple-mace.yml`]: 'type: weapon\nname: Mace\nsystem: { source: { rules: 2024 }, rarity: \'\', type: { value: simple } }\n_id: mace',
      [`${root}/packs/_source/equipment24/weapons/magic-sword.yml`]: 'type: weapon\nname: Magic Sword\nsystem: { source: { rules: 2024 }, rarity: rare, type: { value: martial } }\n_id: magic',
    }), root);
    await expect(catalog.resolveSelector('weapon:*', '2024')).resolves.toEqual([expect.objectContaining({ name: 'Mace', magic: false })]);
  });

  it('does not reread an item pack when resolving repeated selectors', async () => {
    const root = 'sources';
    let reads = 0;
    const adapter = memoryAdapter({
      [`${root}/packs/_source/equipment24/weapons/mace.yml`]: 'type: weapon\nname: Mace\nsystem: { source: { rules: 2024 }, type: { value: simple } }\n_id: mace',
    });
    const counted = { ...adapter, async read(path: string) { reads += 1; return adapter.read(path); } };
    const catalog = createFoundrySourceCatalog(counted, root);
    await catalog.resolveSelector('weapon:sim:*', '2024');
    const firstReadCount = reads;
    await catalog.resolveSelector('weapon:sim:*', '2024');
    expect(firstReadCount).toBeGreaterThan(0);
    expect(reads).toBe(firstReadCount);
  });

  it('filters source records by family and ruleset while preserving raw records', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/races/elf.yml`]: 'type: race\nname: Elf\nsystem: { identifier: elf, source: { rules: 2014 } }\n_id: elf',
      [`${root}/packs/_source/races/wrong.yml`]: 'type: race\nname: Wrong\nsystem: { identifier: wrong, source: { rules: 2024 } }\n_id: wrong',
      [`${root}/packs/_source/origins24/species/elf.yml`]: 'type: race\nname: Elf 2024\nsystem: { identifier: elf, source: { rules: 2024 } }\n_id: elf24',
    }), root);

    await expect(catalog.list('species', '2014')).resolves.toEqual([
      expect.objectContaining({ sourcePath: 'packs/_source/races/elf.yml', id: 'elf', raw: expect.objectContaining({ name: 'Elf' }) }),
    ]);
    await expect(catalog.list('species', '2024')).resolves.toEqual([
      expect.objectContaining({ sourcePath: 'packs/_source/origins24/species/elf.yml', id: 'elf24', raw: expect.objectContaining({ name: 'Elf 2024' }) }),
    ]);
  });

  it('normalizes advancement entries without replacing their raw Foundry shape', async () => {
    const root = 'sources';
    const catalog = createFoundrySourceCatalog(memoryAdapter({
      [`${root}/packs/_source/classes/fighter.yml`]: `type: class
name: Fighter
system:
  identifier: fighter
  source: { rules: 2014 }
  advancement:
    - _id: feature
      type: ItemGrant
      configuration: { items: [{ uuid: Compendium.dnd5e.classfeatures.Item.feature }] }
_id: fighter`,
      [`${root}/packs/_source/classfeatures/feature.yml`]: 'type: feat\nname: Feature\nsystem: {}\n_id: feature',
    }), root);

    const record = await catalog.get('class', '2014', 'packs/_source/classes/fighter.yml');
    expect(record?.raw).toHaveProperty('system.advancement');
    await expect(catalog.resolveDependencies(record?.raw.system && (record.raw.system as Record<string, unknown>).advancement)).resolves.toEqual([
      expect.objectContaining({ uuid: 'Compendium.dnd5e.classfeatures.Item.feature', source: expect.objectContaining({ name: 'Feature' }) }),
    ]);
  });

  it('projects weapon activity and spell display metadata without raw records', async () => {
    const root = 'sources';
    const files: Record<string, string> = {
      [`${root}/packs/_source/items/weapon.yml`]: `type: weapon
name: Test Bow
system:
  source: { rules: 2014 }
  type: { value: simpleM, baseItem: longbow }
  damage: { base: { number: 1, denomination: 8, types: [piercing] } }
  range: { value: 150, long: 600, units: ft }
  properties: [amm, two]
  activities: { attack: { _id: attack, type: attack, activation: { type: action, value: 1 } } }
_id: weapon`,
      [`${root}/packs/_source/spells24/cantrips/spell.yml`]: `type: spell
name: Test Spell
system:
  source: { rules: 2024 }
  level: 0
  school: evo
  properties: [ritual, concentration]
  activation: { type: action, value: 1 }
  duration: { value: 1, units: minute }
  range: { value: 30, units: ft }
  components: { vocal: true, somatic: true, material: true }
  materials: { value: a pearl }
  preparation: { mode: prepared }
  activities: { cast: { _id: cast, type: attack, activation: { type: action, value: 1 } } }
_id: spell`,
    };
    const catalog = createFoundrySourceCatalog(memoryAdapter(files), root);
    await expect(catalog.getItemSummary('2014', 'packs/_source/items/weapon.yml')).resolves.toMatchObject({ damage: { number: 1, denomination: 8, types: ['piercing'] }, range: { value: 150, long: 600, units: 'ft' }, activities: [{ id: 'attack', type: 'attack' }] });
    await expect(catalog.listSpells('2024')).resolves.toMatchObject([{ activation: { type: 'action', value: 1 }, duration: { value: 1, units: 'minute' }, range: { value: 30, units: 'ft' }, materials: 'a pearl', preparation: 'prepared', activities: [{ id: 'cast', type: 'attack' }] }]);
  });
});
