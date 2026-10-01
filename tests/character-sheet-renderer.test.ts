import { describe, expect, it, vi } from 'vitest';
import { renderCharacterSheet } from '../src/character-sheet-renderer';
import type { CharacterSheetProjection } from '../src/character-sheet-model';

const available = <T>(value: T) => ({ kind: 'available' as const, value });
const missing = <T>(reason: string) => ({ kind: 'missing' as const, reason });

const completeSheet: CharacterSheetProjection = {
  identity: {
    name: 'Ayla',
    ruleset: '2024',
    species: available('Elf'),
    className: available('Fighter'),
    level: available(1),
    background: available('Soldier'),
  },
  header: {
    proficiencyBonus: available(2),
    speed: available('30 ft.'),
    initiative: available(2),
    armorClass: available(18),
    hitPoints: missing('Not available from character handover.'),
    inspiration: missing('Not available from character handover.'),
  },
  abilities: [
    ['str', 'Strength', 16, 3], ['dex', 'Dexterity', 14, 2], ['con', 'Constitution', 13, 1],
    ['int', 'Intelligence', 12, 1], ['wis', 'Wisdom', 10, 0], ['cha', 'Charisma', 8, -1],
  ].map(([key, label, score, modifier]) => ({
    key: key as CharacterSheetProjection['abilities'][number]['key'],
    label: String(label),
    score: available(Number(score)),
    modifier: available(Number(modifier)),
  })),
  savingThrows: [
    { ability: 'str', label: 'Strength', proficient: available(true), modifier: available(5) },
    { ability: 'dex', label: 'Dexterity', proficient: available(false), modifier: available(2) },
  ],
  skills: [
    { key: 'ath', label: 'Athletics', ability: available('str'), proficient: available(true), modifier: available(5), disadvantageSources: [] },
    { key: 'prc', label: 'Perception', ability: available('wis'), proficient: available(true), modifier: available(2), disadvantageSources: [] },
    { key: 'ste', label: 'Stealth', ability: available('dex'), proficient: available(false), modifier: available(2), disadvantageSources: ['Chain Mail'] },
  ],
  senses: [
    { label: 'Darkvision', value: available('60 ft.') },
    { label: 'Passive perception', value: missing('Passive skill calculations are not implemented.') },
  ],
  training: [
    { label: 'Armor', values: available(['Light armor', 'Medium armor']) },
    { label: 'Weapons', values: available(['Simple weapons']) },
    { label: 'Tools', values: available(['Gaming set']) },
    { label: 'Languages', values: available(['Common']) },
  ],
  inventory: {
    kind: 'available',
    rows: [
      { entryId: 'travel', name: 'Travel journal', detail: [], quantity: 1, unitWeight: missing('Item weight is unavailable for Travel journal.'), stackWeight: missing('Item weight is unavailable for Travel journal.'), equipAction: null, attuneAction: null, notes: [] },
      { entryId: 'shield', name: 'Shield', detail: ['equipment', 'shield'], quantity: 1, unitWeight: available({ value: 6, units: 'lb' }), stackWeight: available({ value: 6, units: 'lb' }), equipAction: { kind: 'available', label: 'Equip', active: false }, attuneAction: { kind: 'available', label: 'Attune', active: false }, notes: ['Armor 2'] },
      { entryId: 'chain', name: 'Chain Mail', detail: ['equipment', 'heavy'], quantity: 1, unitWeight: available({ value: 55, units: 'lb' }), stackWeight: available({ value: 55, units: 'lb' }), equipAction: { kind: 'available', label: 'Equipped', active: true }, attuneAction: { kind: 'available', label: 'Attuned', active: true }, notes: ['Armor 16, Dex cap 0', 'Strength 13', 'Stealth disadvantage'] },
    ],
    totalWeight: missing('Item weight is unavailable for Travel journal.'),
    currency: { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 },
    armor: { armorClass: available(18), stealthDisadvantageSources: ['Chain Mail'] },
    warnings: [],
  },
  warnings: [],
};

describe('read-only character sheet renderer', () => {
  it('renders available hit points as an accessible adjustment button', () => {
    const rendered = createSheetTestRoot();
    const onAdjust = vi.fn();
    renderCharacterSheet(rendered.root, { ...completeSheet, header: { ...completeSheet.header, hitPoints: available({ current: 8, maximum: 10, temporary: 2 }) } }, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'abilities', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(), onAdjustHitPoints: onAdjust,
    });
    const control = rendered.controls.find((candidate) => candidate.text.includes('Hit points:'));
    expect(control?.ariaLabel).toContain('temporary 2');
    control?.dispatch('click');
    expect(onAdjust).toHaveBeenCalledOnce();
  });

  it('renders inspiration as a mutable checkbox and reports both corrections', () => {
    const rendered = createSheetTestRoot();
    const onToggle = vi.fn();
    renderCharacterSheet(rendered.root, { ...completeSheet, header: { ...completeSheet.header, inspiration: available(true) } }, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'abilities', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(), onToggleInspiration: onToggle,
    });
    const control = rendered.controls.find((candidate) => candidate.ariaLabel === 'Inspiration');
    expect(control).toMatchObject({ type: 'checkbox', checked: true, disabled: false });
    expect(rendered.classes).toContain('guided-character-sheet__inspiration-control');
    if (control === undefined) throw new Error('Missing inspiration checkbox');
    control.checked = false;
    control.dispatch('change');
    control.checked = true;
    control.dispatch('change');
    expect(onToggle).toHaveBeenNthCalledWith(1, false);
    expect(onToggle).toHaveBeenNthCalledWith(2, true);
  });

  it('disables inspiration when its state or update control is unavailable', () => {
    const missingView = createSheetTestRoot();
    renderCharacterSheet(missingView.root, completeSheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'abilities', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(),
    });
    expect(missingView.controls.find((candidate) => candidate.ariaLabel.startsWith('Inspiration:'))).toMatchObject({ type: 'checkbox', checked: false, disabled: true });
    const readOnlyView = createSheetTestRoot();
    renderCharacterSheet(readOnlyView.root, { ...completeSheet, header: { ...completeSheet.header, inspiration: available(true) } }, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'abilities', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(),
    });
    expect(readOnlyView.controls.find((candidate) => candidate.ariaLabel === 'Inspiration: Inspiration controls are unavailable.')).toMatchObject({ type: 'checkbox', checked: true, disabled: true });
  });

  it('renders resolved size in the identity summary and accessible label', () => {
    const rendered = createSheetTestRoot();
    const sheet = { ...completeSheet, identity: { ...completeSheet.identity, size: available('Small') } };
    renderCharacterSheet(rendered.root, sheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }],
      selectedFilePath: 'Characters/ayla.json',
      selectedSection: 'abilities',
      onSelectCharacter: vi.fn(),
      onEdit: vi.fn(),
      onSectionChange: vi.fn(),
    });
    expect(rendered.classText['guided-character-sheet__sheet-subtitle']?.some((value) => value.includes('Elf (Small)'))).toBe(true);
    expect(rendered.ariaLabels.some((label) => label.includes('Size: Small'))).toBe(true);
  });

  it('renders the sticky header and stacked Abilities sections', () => {
    const rendered = createSheetTestRoot();

    renderCharacterSheet(rendered.root, completeSheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }],
      selectedFilePath: 'Characters/ayla.json',
      selectedSection: 'abilities',
      onSelectCharacter: vi.fn(),
      onEdit: vi.fn(),
      onSectionChange: vi.fn(),
    });

    expect(rendered.classes).toContain('guided-character-sheet__sheet-header');
    expect(rendered.classes).toContain('guided-character-sheet--open');
    expect(rendered.classes).toEqual(expect.arrayContaining([
      'guided-character-sheet__sheet-layout',
      'guided-character-sheet__sheet-header',
      'guided-character-sheet__sheet-identity',
      'guided-character-sheet__sheet-facts',
      'guided-character-sheet__sheet-navigation',
      'guided-character-sheet__ability-cards',
      'guided-character-sheet__sheet-section',
      'guided-character-sheet__missing-value',
    ]));
    expect(rendered.text).toEqual(expect.arrayContaining([
      'Ayla', 'Edit character', 'Abilities', 'Saving throws', 'Skills',
      'Senses', 'Proficiencies and training',
    ]));
    expect(rendered.controls.find(({ text }) => text === 'Rest unavailable')?.disabled).toBe(true);
    expect(rendered.headingOrder).toEqual(['Abilities', 'Saving throws', 'Skills', 'Senses', 'Proficiencies and training']);
    expect(rendered.classText['guided-character-sheet__ability-card-label']).toEqual(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']);
    expect(rendered.classText['guided-character-sheet__visually-hidden']).toEqual(expect.arrayContaining(['Strength score: 16', 'Strength modifier: +3']));
    expect(rendered.text).toContain('Disadvantage');
    expect(rendered.classText['guided-character-sheet__visually-hidden']).toContain('Stealth disadvantage: Chain Mail.');
  });

  it('renders missing values with accessible reasons instead of numeric defaults', () => {
    const rendered = createSheetTestRoot();

    renderCharacterSheet(rendered.root, completeSheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }],
      selectedFilePath: 'Characters/ayla.json',
      selectedSection: 'abilities',
      onSelectCharacter: vi.fn(),
      onEdit: vi.fn(),
      onSectionChange: vi.fn(),
    });

    expect(rendered.text).toContain('—');
    expect(rendered.classText['guided-character-sheet__visually-hidden']).toEqual(expect.arrayContaining([
      'Hit points: Not available from character handover.',
    ]));
  });

  it('renders saving throw markers, conditional notes, and defense sources accessibly', () => {
    const rendered = createSheetTestRoot();
    const sheet: CharacterSheetProjection = {
      ...completeSheet,
      savingThrows: [
        { ability: 'int', label: 'Intelligence', proficient: available(false), modifier: available(1), annotations: [{ marker: 'A', source: 'Gnomish Cunning' }, { marker: 'D', source: 'Test condition' }] },
      ],
      savingThrowNotes: [{ text: 'Advantage on saving throws to avoid or end the Poisoned condition.', source: 'Dwarven Resilience' }],
      defenses: { creatureType: available('humanoid'), resistances: [{ damageType: 'poison', source: 'Dwarven Resilience' }, { damageType: 'acid', source: 'Draconic Ancestry' }] },
    };
    renderCharacterSheet(rendered.root, sheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'abilities',
      onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(),
    });

    expect(rendered.text).toEqual(expect.arrayContaining(['A', 'D', 'Advantage on saving throws to avoid or end the Poisoned condition.', 'humanoid', 'poison, acid']));
    expect(rendered.ariaLabels).toEqual(expect.arrayContaining([
      'Advantage on Intelligence saving throw from Gnomish Cunning',
      'Disadvantage on Intelligence saving throw from Test condition',
    ]));
    expect(rendered.classText['guided-character-sheet__visually-hidden']).toEqual(expect.arrayContaining([
      'poison: Dwarven Resilience', 'acid: Draconic Ancestry', ' Source: Dwarven Resilience',
    ]));
  });

  it('renders expertise as a star with an accessible label while preserving other training markers', () => {
    const rendered = createSheetTestRoot();
    const sheet: CharacterSheetProjection = { ...completeSheet, skills: [
      { key: 'ath', label: 'Athletics', ability: available('str'), proficient: available(true), expertise: available(true), training: available(2), modifier: available(7), disadvantageSources: [] },
      { key: 'prc', label: 'Perception', ability: available('wis'), proficient: available(true), expertise: available(false), training: available(1), modifier: available(2), disadvantageSources: [] },
      { key: 'ste', label: 'Stealth', ability: available('dex'), proficient: available(false), expertise: available(false), training: available(0), modifier: available(2), disadvantageSources: [] },
    ] };
    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'abilities', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(rendered.text).toContain('★');
    expect(rendered.ariaLabels).toContain('Athletics: Expertise');
    expect(rendered.text).toContain('●');
    expect(rendered.text).toContain('○');
  });

  it('exposes missing identity reasons to assistive technology', () => {
    const rendered = createSheetTestRoot();
    const incompleteSheet = structuredClone(completeSheet);
    incompleteSheet.identity.species = missing('Species has not been selected.');
    incompleteSheet.identity.className = missing('Class has not been selected.');

    renderCharacterSheet(rendered.root, incompleteSheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }],
      selectedFilePath: 'Characters/ayla.json',
      selectedSection: 'abilities',
      onSelectCharacter: vi.fn(),
      onEdit: vi.fn(),
      onSectionChange: vi.fn(),
    });

    expect(rendered.ariaLabels).toContain('Character details: Species: Species has not been selected. Class: Class has not been selected. Level: 1. Background: Soldier.');
  });

  it('routes character, edit, and section interactions only through callbacks', () => {
    const rendered = createSheetTestRoot();
    const onSelectCharacter = vi.fn();
    const onEdit = vi.fn();
    const onSectionChange = vi.fn();

    renderCharacterSheet(rendered.root, completeSheet, {
      characters: [
        { filePath: 'Characters/ayla.json', name: 'Ayla' },
        { filePath: 'Characters/borin.json', name: 'Borin' },
      ],
      selectedFilePath: 'Characters/ayla.json',
      selectedSection: 'abilities',
      onSelectCharacter,
      onEdit,
      onSectionChange,
    });

    const character = rendered.control('Character');
    character.value = 'Characters/borin.json';
    character.dispatch('change');
    rendered.control('Edit character').dispatch('click');
    const section = rendered.control('Sheet section');
    section.value = 'inventory';
    section.dispatch('change');

    expect(onSelectCharacter).toHaveBeenCalledWith('Characters/borin.json');
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onSectionChange).toHaveBeenCalledWith('inventory');
    expect(rendered.control('Rest unavailable').handlers.size).toBe(0);
  });

  it('renders one compact Inventory list in projection order with disabled action previews', () => {
    const rendered = createSheetTestRoot();
    renderCharacterSheet(rendered.root, completeSheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }],
      selectedFilePath: 'Characters/ayla.json',
      selectedSection: 'inventory',
      onSelectCharacter: vi.fn(),
      onEdit: vi.fn(),
      onSectionChange: vi.fn(),
    });

    expect(rendered.text).toEqual(expect.arrayContaining(['Inventory', 'Carried weight', 'Currency', '12 GP', 'Quantity 1', 'Armor 16, Dex cap 0', 'Read-only prototype']));
    expect(rendered.text).not.toContain('Not implemented yet');
    expect(rendered.text.indexOf('Chain Mail')).toBeLessThan(rendered.text.indexOf('Shield'));
    expect(rendered.text.indexOf('Shield')).toBeLessThan(rendered.text.indexOf('Travel journal'));
    for (const label of ['Equipped', 'Attune', 'Attuned']) {
      const control = rendered.control(label);
      expect(control.disabled).toBe(true);
      expect(control.handlers.size).toBe(0);
    }
    expect(rendered.ariaLabels.some((label) => label.includes('Travel journal') && label.includes('prototype'))).toBe(false);
    expect(rendered.classText['guided-character-sheet__visually-hidden']).toContain('Travel journal weight: Item weight is unavailable for Travel journal.');
    expect(rendered.headingOrder).not.toContain('Saving throws');
  });

  it('emits equipment toggles for active equip controls', () => {
    const rendered = createSheetTestRoot();
    const onToggleEquipment = vi.fn();
    const sheet = structuredClone(completeSheet);
    if (sheet.inventory.kind !== 'available') throw new Error('Expected available inventory fixture');
    sheet.inventory.rows.push({ entryId: 'dagger', name: 'Dagger', detail: ['weapon', 'simpleM'], quantity: 1, unitWeight: available({ value: 1, units: 'lb' }), stackWeight: available({ value: 1, units: 'lb' }), equipAction: { kind: 'available', label: 'Equip', active: false }, attuneAction: null, notes: [] });
    renderCharacterSheet(rendered.root, sheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }],
      selectedFilePath: 'Characters/ayla.json',
      selectedSection: 'inventory',
      onSelectCharacter: vi.fn(),
      onEdit: vi.fn(),
      onSectionChange: vi.fn(),
      onToggleEquipment,
    });

    const weaponControl = rendered.controls.find((control) => control.ariaLabel === 'Equip Dagger');
    if (weaponControl === undefined) throw new Error('Missing weapon Equip control');
    const shieldControl = rendered.controls.find((control) => control.ariaLabel === 'Equip Shield');
    if (shieldControl === undefined) throw new Error('Missing shield Equip control');
    weaponControl.dispatch('click');
    shieldControl.dispatch('click');
    rendered.control('Equipped').dispatch('click');

    expect(onToggleEquipment).toHaveBeenNthCalledWith(1, 'dagger', true);
    expect(onToggleEquipment).toHaveBeenNthCalledWith(2, 'shield', true);
    expect(onToggleEquipment).toHaveBeenNthCalledWith(3, 'chain', false);
    expect(rendered.text).toContain('Attune actions are not active yet.');
    expect(rendered.text).not.toContain(' — Equip and Attune actions are not active yet.');
  });

  it('renders a focused empty Inventory state without a fabricated weight unit', () => {
    const rendered = createSheetTestRoot();
    const emptySheet = structuredClone(completeSheet);
    if (emptySheet.inventory.kind !== 'available') throw new Error('Expected available inventory fixture');
    emptySheet.inventory.rows = [];
    emptySheet.inventory.totalWeight = missing('No carried items.');
    emptySheet.inventory.currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

    renderCharacterSheet(rendered.root, emptySheet, {
      characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'inventory',
      onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(),
    });

    expect(rendered.text).toEqual(expect.arrayContaining(['No inventory items', 'No currency', '—']));
    expect(rendered.text.some((value) => value.includes(' lb'))).toBe(false);
  });

  it('renders attack name, range, hit bonus, full damage, and description as labeled facts', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    sheet.actions = {
      groups: [{ key: 'attacks', label: 'Attacks', entries: [{ name: 'Dagger', source: 'Dagger', executable: false, range: '20/60 ft.', attackBonus: available(5), damage: '1d4+3 piercing', description: 'A balanced blade.', diagnostics: [] }] }],
      combatReference: [],
      warnings: [],
    };

    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'actions', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });

    expect(rendered.text).toEqual(expect.arrayContaining(['Dagger', 'Range', '20/60 ft.', 'To hit / DC', '+5', 'Damage', '1d4+3 piercing', 'A balanced blade.']));
    expect(rendered.classes).toEqual(expect.arrayContaining(['guided-character-sheet__action-details', 'guided-character-sheet__action-fact', 'guided-character-sheet__action-description']));
    expect(rendered.classText['guided-character-sheet__visually-hidden']).toEqual(expect.arrayContaining(['Dagger to hit or DC: +5']));
  });

  it('renders at-will damage and labeled recoverable resource facts', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    sheet.actions = { groups: [
      { key: 'at-will', label: 'At will', entries: [{ name: 'Sneak Attack', source: 'Sneak Attack', executable: false, attackBonus: missing('Not applicable.'), damage: '1d6', diagnostics: [] }] },
      { key: 'limited-use', label: 'Limited use', entries: [{ name: 'Second Wind', source: 'Second Wind', executable: false, attackBonus: missing('Not applicable.'), resource: { current: available(1), maximum: available(2), reset: available('short rest') }, diagnostics: [] }] },
    ], combatReference: [], warnings: [] };

    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'actions', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });

    expect(rendered.text).toEqual(expect.arrayContaining(['At will', 'Sneak Attack', '1d6', 'Limited use', 'Second Wind', 'Short rest']));
    expect(rendered.text).not.toEqual(expect.arrayContaining(['Uses', 'Maximum', 'Recovery']));
  });

  it('only renders action fact cards for attacks, saves, and damage-bearing entries', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    sheet.actions = { groups: [{ key: 'actions', label: 'Actions', entries: [
      { name: 'Light', source: 'Light', executable: false, activation: 'action', attackBonus: missing('Not applicable.'), diagnostics: [] },
      { name: 'Animal Friendship', source: 'Animal Friendship', executable: false, activation: 'action', attackBonus: missing('Not applicable.'), factKind: 'save', range: '30 ft.', saveDc: available(13), saveAbility: 'wis', diagnostics: [] },
    ] }], combatReference: [], warnings: [] };

    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'actions', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });

    expect(rendered.text).toEqual(expect.arrayContaining(['Light', 'Animal Friendship', '30 ft.', 'DC 13 WIS']));
    expect(rendered.classes.filter((value) => value === 'guided-character-sheet__action-details')).toHaveLength(1);
    expect(rendered.classes.filter((value) => value === 'guided-character-sheet__action-fact')).toHaveLength(2);
    expect(rendered.classText['guided-character-sheet__sheet-subtitle']).toEqual(expect.arrayContaining(['Range', 'To hit / DC']));
    expect(rendered.classText['guided-character-sheet__sheet-subtitle']).not.toContain('Damage');
  });

  it('renders remaining sections as read-only accessible previews', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    sheet.spells = { kind: 'available', castingAbility: available('Wisdom'), spellModifier: available(3), spellAttack: available(5), saveDc: available(13), cantrips: [{ name: 'Light', level: 0, source: missing('Spell source is unavailable.'), prepared: available(true), ownership: ['cantrips-known'] }], levels: [{ level: 1, spells: [{ name: 'Entangle', level: 1, source: available({ sourcePath: 'packs/_source/spells24/1st-level/entangle.yml', pack: 'dnd5e.spells24', type: 'spell', id: 'entangle', name: 'Entangle', ruleset: '2024', level: 1, spellLists: ['druid'], ritual: false, description: 'Grasping weeds and vines sprout from the ground.', activation: { type: 'action' }, range: { value: '90', units: 'ft' }, properties: ['concentration'] }), prepared: available(false), ownership: ['known-spells'] }], slots: { maximum: 2, expended: missing('Slot expenditure is not persisted.') } }], unresolvedSpells: [{ name: 'Missing Spell', source: missing('Spell source is unavailable.'), reason: 'Spell level is unavailable because the source record could not be resolved.' }], freeUses: [{ key: 'ward', name: 'Ward', maximum: 1, current: missing('Free-use expenditure is not persisted.'), recoveryPeriod: 'lr' }], warnings: ['Spell source unavailable: Light'] };
    sheet.features = { groups: [{ category: 'class', label: 'Class features', entries: [{ key: 'fighter:second-wind', name: 'Second Wind', category: 'class', source: available({ sourcePath: 'x', pack: 'p', type: 'feat', id: 'f', name: 'Second Wind' }), origins: ['Class'], description: available('Recover hit points.'), activities: [], resource: { key: 'feature:x', current: missing('Current resource value is unavailable.'), maximum: available(1), reset: available('short rest') }, diagnostics: [] }] }, { category: 'species', label: 'Species traits', entries: [] }, { category: 'background', label: 'Background features', entries: [] }, { category: 'feats', label: 'Feats', entries: [] }], warnings: [] };
    sheet.actions = { groups: [{ key: 'attacks', label: 'Attacks', entries: [{ name: 'Longsword', source: 'Longsword', executable: false, range: '5 ft.', attackBonus: available(5), damage: '1d8+3 slashing', diagnostics: [] }] }], combatReference: ['Dash', 'Disengage', 'Dodge'], warnings: [] };
    sheet.backgroundDetails = { source: missing('Background source is unavailable.'), sourceFacts: { description: missing('Background source is unavailable.'), abilityScores: missing('Background source is unavailable.'), skills: missing('Background source is unavailable.'), languages: missing('Background source is unavailable.'), tools: missing('Background source is unavailable.'), feat: missing('Background source is unavailable.'), features: missing('Background source is unavailable.') }, abilityImprovements: missing('Background source is unavailable.'), choices: { languages: missing('No saved background language choices.') }, equipment: { source: missing('Background source is unavailable.'), items: [], wealth: missing('Starting wealth is unavailable.'), currency: { cp: missing('No persisted background-attributable currency.'), sp: missing('No persisted background-attributable currency.'), ep: missing('No persisted background-attributable currency.'), gp: missing('No persisted background-attributable currency.'), pp: missing('No persisted background-attributable currency.') } }, biography: { personalityTraits: missing('Biography data is not stored in the character document.'), ideals: missing('Biography data is not stored in the character document.'), bonds: missing('Biography data is not stored in the character document.'), flaws: missing('Biography data is not stored in the character document.'), faith: missing('Biography data is not stored in the character document.'), appearance: missing('Biography data is not stored in the character document.'), physicalDetails: missing('Biography data is not stored in the character document.') }, warnings: [] };

    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'spells', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(rendered.text).toEqual(expect.arrayContaining(['Spells', 'Ability', 'WIS', 'Modifier', '+3', 'Spell attack', '+5', 'Save DC', '13', 'Prep', 'Light', 'Entangle', '1 action · 90 ft · Concentration', 'Description', 'Grasping weeds and vines sprout from the ground.', 'Spell slots', 'Ward', '1 unavailable per long rest', 'Unresolved spells', 'Missing Spell', 'Spell level is unavailable because the source record could not be resolved.', 'Features and traits']));
    expect(rendered.classes).toEqual(expect.arrayContaining(['guided-character-sheet__spell-prep-heading', 'guided-character-sheet__spell-prep']));
    expect(rendered.text).not.toContain('packs/_source/spells24/1st-level/entangle.yml');
    expect(rendered.text).not.toContain('2 available');
    expect(rendered.text).not.toContain('2 unavailable');
    expect(rendered.text).not.toContain('1 available');
    expect(rendered.text).not.toContain('Not implemented yet');
    const inputs = rendered.controls.filter((control) => control.tag === 'input' && control.type === 'checkbox');
    expect(inputs).toHaveLength(6);
    expect(inputs.every((control) => control.disabled && control.handlers.size === 0)).toBe(true);
    expect(inputs.filter((control) => control.checked)).toHaveLength(1);
    const checkbox = (label: string): TestControl => {
      const control = inputs.find((candidate) => candidate.ariaLabel === label);
      if (control === undefined) throw new Error(`Missing checkbox ${label}`);
      return control;
    };
    expect(checkbox('Light prepared: Spell source is unavailable.')).toMatchObject({ checked: true, disabled: true });
    expect(checkbox('Light prepared: Spell source is unavailable.').handlers.size).toBe(0);
    for (const label of ['Use 1st-level spell slot 1: Slot expenditure is not persisted.', 'Use 1st-level spell slot 2: Slot expenditure is not persisted.', 'Ward use 1: unavailable: Free-use expenditure is not persisted.']) {
      expect(checkbox(label).checked).toBe(false);
      expect(checkbox(label).disabled).toBe(true);
      expect(checkbox(label).handlers.size).toBe(0);
    }

    const featureView = createSheetTestRoot();
    renderCharacterSheet(featureView.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'features-and-traits', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(featureView.text).toEqual(expect.arrayContaining(['Features and traits', 'Second Wind', 'Recover hit points.']));
    expect(featureView.text).not.toContain('short rest');
    expect(featureView.text).not.toContain('Not implemented yet');

    const actionView = createSheetTestRoot();
    renderCharacterSheet(actionView.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'actions', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(actionView.text).toEqual(expect.arrayContaining(['Actions', 'Longsword', 'Range', '5 ft.', 'To hit / DC', 'Longsword to hit or DC: +5', 'Damage', '1d8+3 slashing', 'Combat actions', 'Dash, Disengage, Dodge']));
    expect(actionView.text.some((text) => text.includes('unavailable unavailable'))).toBe(false);
    expect(actionView.controls.some((control) => control.text.includes('unavailable unavailable'))).toBe(false);

    const backgroundView = createSheetTestRoot();
    if (sheet.backgroundDetails) {
      sheet.backgroundDetails.source = available({ sourcePath: 'background.yml', pack: 'p', type: 'background', id: 'soldier', name: 'Soldier' });
      sheet.backgroundDetails.sourceFacts.description = available('A veteran soldier.');
      sheet.backgroundDetails.sourceFacts.abilityScores = available({ fixed: { str: 2 } });
      sheet.backgroundDetails.sourceFacts.feat = available({ sourcePath: 'feat.yml', pack: 'p', type: 'feat', id: 'feat', name: 'Alert' });
      sheet.backgroundDetails.sourceFacts.features = available([{ advancementId: 'feature', source: { sourcePath: 'feature.yml', pack: 'p', type: 'feat', id: 'feature', name: 'Military Rank' } }]);
      sheet.backgroundDetails.equipment.items = [{ name: 'Trophy', quantity: available(2), provenance: ['p'] }];
      sheet.backgroundDetails.equipment.wealth = available('10 GP');
      sheet.backgroundDetails.equipment.source = available([{ type: 'AND', key: 'jBbYoNZtbWE8sFAK', group: 'internal-package-group' }]);
      sheet.backgroundDetails.equipment.currency.gp = available(10);
      sheet.backgroundDetails.abilityImprovements = available([{ ability: 'int', bonus: 2, finalScore: 14 }, { ability: 'wis', bonus: 1, finalScore: 11 }]);
    }
    renderCharacterSheet(backgroundView.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'background', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(backgroundView.text).toEqual(expect.arrayContaining(['Background', 'Soldier', 'A veteran soldier.', 'Biography', 'Biography is not yet provided or stored.']));
    for (const creationOnlyDetail of ['Skills', 'Languages', 'Tools', 'Feat', 'Features', 'Ability improvements', 'Language choices', 'Starting equipment', 'Wealth', 'Alert', 'Military Rank', 'Trophy', 'Trophy quantity: 2', 'GP: 10']) {
      expect(backgroundView.text).not.toContain(creationOnlyDetail);
    }
    expect(backgroundView.text.some((value) => /jBbYoNZtbWE8sFAK|internal-package-group/.test(value))).toBe(false);
  });

  it('omits preparation controls for always-prepared cantrips but keeps them for prepared spells', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    const light = { sourcePath: 'packs/_source/spells24/cantrips/light.yml', pack: 'dnd5e.spells24', type: 'spell' as const, id: 'light', name: 'Light', ruleset: '2024' as const, level: 0, spellLists: ['wizard'], ritual: false, preparation: 'always' };
    const dancingLights = { ...light, sourcePath: 'packs/_source/spells24/cantrips/dancing-lights.yml', id: 'dancing-lights', name: 'Dancing Lights' };
    const shield = { ...light, sourcePath: 'packs/_source/spells24/1st-level/shield.yml', id: 'shield', name: 'Shield', level: 1, preparation: 'prepared' };
    sheet.spells = { kind: 'available', castingAbility: available('Intelligence'), spellModifier: available(3), spellAttack: available(5), saveDc: available(13), cantrips: [light, dancingLights].map((source) => ({ name: source.name, level: 0, source: available(source), prepared: available(true), ownership: ['cantrips-known'] })), levels: [{ level: 1, spells: [{ name: 'Shield', level: 1, source: available(shield), prepared: available(false), ownership: ['known-spells'] }], slots: { maximum: 2, expended: available(0) } }], unresolvedSpells: [], freeUses: [], warnings: [] };
    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'spells', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    const labels = rendered.controls.filter((control) => control.tag === 'input' && control.type === 'checkbox').map((control) => control.ariaLabel);
    expect(labels).not.toContain('Light prepared');
    expect(labels).not.toContain('Dancing Lights prepared');
    expect(labels).toContain('Shield prepared: Preparation is unavailable.');
  });

  it('omits the Prep column and keeps all-always-prepared cantrip names left-aligned', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    const light = { sourcePath: 'packs/_source/spells24/cantrips/light.yml', pack: 'dnd5e.spells24', type: 'spell' as const, id: 'light', name: 'Light', ruleset: '2024' as const, level: 0, spellLists: ['wizard'], ritual: false, preparation: 'always' };
    const dancingLights = { ...light, sourcePath: 'packs/_source/spells24/cantrips/dancing-lights.yml', id: 'dancing-lights', name: 'Dancing Lights' };
    sheet.spells = { kind: 'available', castingAbility: available('Intelligence'), spellModifier: available(3), spellAttack: available(5), saveDc: available(13), cantrips: [light, dancingLights].map((source) => ({ name: source.name, level: 0, source: available(source), prepared: available(true), ownership: ['cantrips-known'] })), levels: [], unresolvedSpells: [], freeUses: [], warnings: [] };
    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'spells', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });

    expect(rendered.text).not.toContain('Prep');
    expect(rendered.classes).not.toContain('guided-character-sheet__spell-column-headings');
    expect(rendered.classes).not.toContain('guided-character-sheet__spell-prep');
    expect(rendered.classes).toContain('guided-character-sheet__spell-primary--without-prep');
  });

  it('retains the Prep column for a mixed subsection', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    const light = { sourcePath: 'packs/_source/spells24/cantrips/light.yml', pack: 'dnd5e.spells24', type: 'spell' as const, id: 'light', name: 'Light', ruleset: '2024' as const, level: 0, spellLists: ['wizard'], ritual: false, preparation: 'always' };
    const fireBolt = { ...light, sourcePath: 'packs/_source/spells24/cantrips/fire-bolt.yml', id: 'fire-bolt', name: 'Fire Bolt', preparation: 'prepared' as const };
    sheet.spells = { kind: 'available', castingAbility: available('Intelligence'), spellModifier: available(3), spellAttack: available(5), saveDc: available(13), cantrips: [light, fireBolt].map((source) => ({ name: source.name, level: 0, source: available(source), prepared: available(true), ownership: ['cantrips-known'] })), levels: [], unresolvedSpells: [], freeUses: [], warnings: [] };
    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'spells', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });

    expect(rendered.text).toContain('Prep');
    expect(rendered.classes).toContain('guided-character-sheet__spell-column-headings');
    expect(rendered.classes).toContain('guided-character-sheet__spell-prep-heading');
    expect(rendered.classes).toContain('guided-character-sheet__spell-prep-spacer');
    expect(rendered.classes).not.toContain('guided-character-sheet__spell-primary--without-prep');
  });

  it('renders usable spell management and preparation controls with blocked-state context', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    const shield = { sourcePath: 'packs/_source/spells24/1st-level/shield.yml', pack: 'dnd5e.spells24', type: 'spell' as const, id: 'shield', name: 'Shield', ruleset: '2024' as const, level: 1, spellLists: ['wizard'], ritual: false, preparation: 'prepared', description: 'An imperceptible barrier protects you.' };
    const future = { ...shield, sourcePath: 'packs/_source/spells24/2nd-level/misty-step.yml', id: 'misty-step', name: 'Misty Step', level: 2 };
    sheet.spells = { kind: 'available', castingAbility: available('Intelligence'), spellModifier: available(3), spellAttack: available(5), saveDc: available(13), cantrips: [], levels: [{ level: 1, spells: [{ name: 'Shield', level: 1, source: available(shield), prepared: available(false), ownership: ['spellbook'] }], slots: { maximum: 2, expended: available(0) } }, { level: 2, spells: [{ name: 'Misty Step', level: 2, source: available(future), prepared: available(false), ownership: ['spellbook'], preparationBlockedReason: 'Spell level is above the highest castable spell level.' }], slots: { maximum: 0, expended: available(0) } }], unresolvedSpells: [], freeUses: [], preparedCount: 0, preparedCapacity: 1, highestCastableSpellLevel: 1, warnings: [] };
    const manage = vi.fn(); const prepare = vi.fn();
    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'spells', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(), onManageSpells: manage, onToggleSpellPreparation: prepare });
    const manageButton = rendered.controls.find((control) => control.tag === 'button' && control.text === 'Manage spells');
    expect(manageButton?.disabled).toBe(false); manageButton?.dispatch('click'); expect(manage).toHaveBeenCalledOnce();
    const shieldControl = rendered.controls.find((control) => control.ariaLabel === 'Shield prepared');
    expect(shieldControl?.disabled).toBe(false); if (shieldControl) { shieldControl.checked = true; shieldControl.dispatch('change'); }
    expect(prepare).toHaveBeenCalledWith(shield, true);
    expect(rendered.controls.find((control) => control.ariaLabel === 'Misty Step prepared: Spell level is above the highest castable spell level.')?.disabled).toBe(true);
    expect(rendered.text).toEqual(expect.arrayContaining(['Prep 0/1', 'Description', 'An imperceptible barrier protects you.']));
    expect(rendered.classes).toEqual(expect.arrayContaining(['guided-character-sheet__spell-column-headings', 'guided-character-sheet__spell-slots']));
  });

  it('provides independent reversible controls for slots, free uses, and feature resources', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    sheet.spells = { kind: 'available', castingAbility: available('Wisdom'), spellModifier: available(3), spellAttack: available(5), saveDc: available(13), cantrips: [], levels: [{ level: 1, spells: [], slots: { maximum: 2, expended: available(1) } }], unresolvedSpells: [], freeUses: [{ key: 'find-familiar', name: 'Find Familiar', maximum: 2, current: available(1), recoveryPeriod: 'lr' }], warnings: [] };
    sheet.features = { groups: [{ category: 'class', label: 'Class features', entries: [{ key: 'feature-id', name: 'Second Wind', category: 'class', source: available({ sourcePath: 'feature.yml', pack: 'p', type: 'feat', id: 'feature', name: 'Second Wind' }), origins: ['Class'], description: available('Recover hit points.'), activities: [{ id: 'recover', name: 'Recovery', type: 'heal', consumption: [], resource: { key: 'feature:feature.yml:activity:recover', current: available(1), maximum: available(1), reset: available('long rest') } }], resource: { key: 'feature:feature.yml', current: available(1), maximum: available(2), reset: available('short rest') }, diagnostics: [] }] }, { category: 'species', label: 'Species traits', entries: [] }, { category: 'background', label: 'Background features', entries: [] }, { category: 'feats', label: 'Feats', entries: [] }], warnings: [] };
    const slot = vi.fn(); const free = vi.fn(); const feature = vi.fn();
    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'spells', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(), onToggleSpellSlot: slot, onToggleSpellUse: free });
    const slotOne = rendered.controls.find((control) => control.ariaLabel === 'Use 1st-level spell slot 1');
    const slotTwo = rendered.controls.find((control) => control.ariaLabel === 'Use 1st-level spell slot 2');
    expect(slotOne?.checked).toBe(true); expect(slotTwo?.checked).toBe(false);
    if (slotOne) { slotOne.checked = false; slotOne.dispatch('change'); }
    expect(slot).toHaveBeenCalledWith(1, false);
    const freeTwo = rendered.controls.find((control) => control.ariaLabel === 'Find Familiar use 2');
    expect(rendered.controls.find((control) => control.ariaLabel === 'Find Familiar use 1')?.checked).toBe(true);
    expect(freeTwo?.checked).toBe(false);
    if (freeTwo) { freeTwo.checked = true; freeTwo.dispatch('change'); }
    expect(free).toHaveBeenCalledWith('find-familiar', true);
    sheet.actions = { groups: [{ key: 'limited-use', label: 'Limited use', entries: [{ name: 'Second Wind', source: 'Second Wind', executable: false, attackBonus: missing('Not applicable.'), resource: { current: available(1), maximum: available(2), reset: available('short rest') }, resourceKey: 'feature:feature.yml', diagnostics: [] }] }], combatReference: [], warnings: [] };
    const actionView = createSheetTestRoot();
    renderCharacterSheet(actionView.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'actions', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn(), onToggleFeatureResource: feature });
    const featureTwo = actionView.controls.find((control) => control.ariaLabel === 'Second Wind use 2');
    expect(actionView.controls.find((control) => control.ariaLabel === 'Second Wind use 1')?.checked).toBe(true);
    expect(featureTwo?.checked).toBe(false);
    if (featureTwo) { featureTwo.checked = true; featureTwo.dispatch('change'); }
    expect(feature).toHaveBeenCalledWith('feature:feature.yml', true);
  });

  it('keeps feature activities out of the Features and traits presentation', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    sheet.features = { groups: [{ category: 'species', label: 'Species traits', entries: [{ key: 'dragon:breath-weapon', name: 'Breath Weapon', category: 'species', source: available({ sourcePath: 'breath.yml', pack: 'p', type: 'feat', id: 'breath', name: 'Breath Weapon' }), origins: ['Species'], description: available('Exhale destructive energy.'), activities: [{ id: 'cone', name: 'Breath Weapon (Cone)', type: 'save', activation: { type: 'action' }, consumption: [] }, { id: 'line', name: 'Breath Weapon (Line)', type: 'save', activation: { type: 'action' }, consumption: [] }], diagnostics: [] }] }, { category: 'class', label: 'Class features', entries: [] }, { category: 'background', label: 'Background features', entries: [] }, { category: 'feats', label: 'Feats', entries: [] }], warnings: [] };

    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'features-and-traits', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });

    expect(rendered.text).toEqual(expect.arrayContaining(['Breath Weapon', 'Exhale destructive energy.']));
    expect(rendered.text).not.toContain('Breath Weapon (Cone)');
    expect(rendered.text).not.toContain('Breath Weapon (Line)');
  });

  it.each([
    ['features-and-traits', 'Features and traits'],
    ['actions', 'Actions'],
    ['background', 'Background'],
  ] as const)('renders the %s section independently', (selectedSection, heading) => {
    const rendered = createSheetTestRoot();
    renderCharacterSheet(rendered.root, completeSheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection, onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(rendered.headingOrder).toContain(heading);
    expect(rendered.text).not.toContain('Not implemented yet');
  });

  it('deduplicates overlapping section and global warnings, including missing sections', () => {
    const rendered = createSheetTestRoot();
    const sheet = structuredClone(completeSheet);
    sheet.features = { groups: [{ category: 'class', label: 'Class features', entries: [] }], warnings: ['Same warning'] };
    sheet.warnings = ['Same warning'];
    renderCharacterSheet(rendered.root, sheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'features-and-traits', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(rendered.text.filter((value) => value === 'Same warning')).toHaveLength(1);
    const missingView = createSheetTestRoot();
    const missingSheet = structuredClone(completeSheet); delete missingSheet.actions; missingSheet.warnings = ['Missing warning'];
    renderCharacterSheet(missingView.root, missingSheet, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: 'actions', onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
    expect(missingView.text).toEqual(expect.arrayContaining(['Actions: Action sources are unavailable.', 'Missing warning']));

    const cases: Array<['spells' | 'features-and-traits' | 'actions' | 'background', string, (sheet: CharacterSheetProjection) => void]> = [
      ['spells', 'Spell warning', (value) => { value.spells = { kind: 'empty', reason: 'No spellcasting progression is available.', castingAbility: missing('No ability.'), spellModifier: missing('No modifier.'), spellAttack: missing('No attack.'), saveDc: missing('No DC.'), cantrips: [], levels: [], unresolvedSpells: [], freeUses: [], warnings: ['Spell warning'] }; }],
      ['features-and-traits', 'Feature warning', (value) => { delete value.features; }],
      ['actions', 'Action warning', (value) => { delete value.actions; }],
      ['background', 'Background warning', (value) => { delete value.backgroundDetails; }],
    ];
    for (const [section, warning, configure] of cases) {
      const view = createSheetTestRoot(); const value = structuredClone(completeSheet); configure(value); value.warnings = [warning];
      renderCharacterSheet(view.root, value, { characters: [{ filePath: 'Characters/ayla.json', name: 'Ayla' }], selectedFilePath: 'Characters/ayla.json', selectedSection: section, onSelectCharacter: vi.fn(), onEdit: vi.fn(), onSectionChange: vi.fn() });
      expect(view.text.filter((entry) => entry === warning)).toHaveLength(1);
      expect(view.text).not.toContain('Not implemented yet');
    }
  });
});

interface TestControl {
  tag: string;
  ariaLabel: string;
  type: string;
  text: string;
  value: string;
  disabled: boolean;
  checked?: boolean;
  handlers: Map<string, () => void>;
  dispatch(event: string): void;
}

function createSheetTestRoot(): {
  root: HTMLElement;
  text: string[];
  classes: string[];
  ariaLabels: string[];
  headingOrder: string[];
  classText: Record<string, string[]>;
  controls: TestControl[];
  control(label: string): TestControl;
} {
  const text: string[] = [];
  const classes: string[] = [];
  const ariaLabels: string[] = [];
  const headingOrder: string[] = [];
  const classText: Record<string, string[]> = {};
  const controls: TestControl[] = [];

  const createNode = (tag = 'div', options?: TestOptions): Record<string, unknown> => {
    if (options?.text !== undefined) text.push(options.text);
    if (options?.cls !== undefined) {
      const nodeClasses = options.cls.split(' ').filter(Boolean);
      classes.push(...nodeClasses);
      if (options.text !== undefined) {
        for (const nodeClass of nodeClasses) (classText[nodeClass] ??= []).push(options.text);
      }
    }
    if (options?.attr?.['aria-label'] !== undefined) ariaLabels.push(options.attr['aria-label']);
    if (tag === 'h3' && options?.text !== undefined) headingOrder.push(options.text);
    const handlers = new Map<string, () => void>();
    const node: Record<string, unknown> = {
      value: options?.value ?? '',
      textContent: options?.text ?? '',
      disabled: false,
      selected: false,
      createDiv: (child?: TestOptions) => createNode('div', child),
      createSpan: (child?: TestOptions) => createNode('span', child),
      createEl: (childTag: string, child?: TestOptions) => createNode(childTag, child),
      addEventListener: (event: string, handler: () => void) => handlers.set(event, handler),
      setAttribute: (name: string, value: string) => { if (name === 'aria-label') ariaLabels.push(value); },
      classList: { add: (...values: string[]) => classes.push(...values) },
    };
    if (tag === 'select' || tag === 'button' || tag === 'input') {
      const control = node as unknown as TestControl;
      control.tag = tag;
      control.ariaLabel = options?.attr?.['aria-label'] ?? '';
      control.type = options?.attr?.type ?? '';
      control.type = options?.attr?.type ?? '';
      control.text = options?.text ?? options?.attr?.['aria-label'] ?? '';
      control.handlers = handlers;
      (control as TestControl & { checked?: boolean }).checked = false;
      control.dispatch = (event: string) => handlers.get(event)?.();
      controls.push(control);
    }
    return node;
  };

  return {
    root: createNode() as unknown as HTMLElement,
    text,
    classes,
    ariaLabels,
    headingOrder,
    classText,
    controls,
    control: (label: string) => {
      const result = controls.find((candidate) => candidate.text === label);
      if (result === undefined) throw new Error(`Missing test control: ${label}`);
      return result;
    },
  };
}

interface TestOptions {
  text?: string;
  value?: string;
  cls?: string;
  attr?: Record<string, string>;
}
