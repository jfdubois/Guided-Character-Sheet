import { describe, expect, it } from 'vitest';
import { calculateAbilityScores, type AbilityScoreSelection } from '../src/ability-scores';
import type { CharacterDocument } from '../src/character-model';
import { projectBackgroundSheet } from '../src/background-sheet-model';
import type { BackgroundSourceSummary } from '../src/character-sources';

const selection: AbilityScoreSelection = { method: 'standard-array', base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }, manual: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 } };
const document: CharacterDocument = {
  format: 1, kind: 'guided-character', name: 'Ayla', ruleset: '2024', step: 'background',
  foundry: { systemVersion: '6.0.0', sourceBranch: '6.0.x', sourceCommit: 'abc123' },
  background: { sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', identifier: 'soldier', id: 'soldier-id' },
  backgroundChoices: { languages: ['languages:standard:elvish'] }, abilityScores: selection,
  mutable: { preparedSpells: [], inventory: { items: [{ entryId: 'rope', source: { sourcePath: 'packs/_source/equipment24/rope.yml', pack: 'dnd5e.equipment24', type: 'equipment', id: 'rope', name: 'Rope' }, quantity: 5, equipped: false, provenance: [{ sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', packageNodeId: 'gear', quantity: 2 }, { sourcePath: 'packs/_source/classes24/fighter/fighter.yml', packageNodeId: 'gear', quantity: 3 }] }], currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 }, currencyProvenance: [{ sourcePath: 'packs/_source/origins24/backgrounds/soldier.yml', packageNodeId: 'wealth', denomination: 'gp', amount: 10 }] }, equipmentStatus: [], resources: [] },
};
const source: BackgroundSourceSummary = {
  source: { sourcePath: document.background!.sourcePath, pack: 'dnd5e.origins24', type: 'background', id: 'soldier-id', identifier: 'soldier', name: 'Soldier' }, ruleset: '2024', description: 'A veteran.',
  abilityScores: { points: 3, locked: ['str', 'dex', 'con'] }, skills: ['skills:ath'], languages: ['languages:common'], languageChoices: [{ count: 1, pool: ['languages:standard:*'] }], tools: ['tool:gaming'], feat: { sourcePath: 'packs/_source/feats24/savage.yml', pack: 'dnd5e.feats24', type: 'feat', id: 'savage', name: 'Savage attacker' }, features: [], equipment: [{ type: 'AND', key: 'gear' }], wealth: '10 gp',
};
const abilityResults = calculateAbilityScores(selection, { str: 1, dex: 0, con: 0, int: 1, wis: 1, cha: 0 });

describe('background sheet projection', () => {
  it('separates source facts and saved choices while leaving 2024 improvements unavailable', () => {
    const sheet = projectBackgroundSheet(document, { background: source, abilityResults, abilityBonuses: { species: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, class: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, background: { str: 1, dex: 0, con: 0, int: 1, wis: 1, cha: 0 } } });
    expect(sheet.source).toEqual({ kind: 'available', value: source.source });
    expect(sheet.sourceFacts.description).toEqual({ kind: 'available', value: 'A veteran.' });
    expect(sheet.abilityImprovements).toEqual({ kind: 'missing', reason: 'No saved background ability-score allocation.' });
    expect(sheet.warnings).not.toContain('Saved background ability-score assignments are unavailable.');
    expect(sheet.choices.languages).toEqual({ kind: 'available', value: ['Elvish'] });
    expect(sheet.sourceFacts.languages).toEqual({ kind: 'available', value: ['Common'] });
    expect(sheet.sourceFacts.feat).toEqual({ kind: 'available', value: source.feat });
    expect(sheet.equipment.items).toEqual([{ name: 'Rope', quantity: { kind: 'available', value: 2 }, provenance: ['gear'] }]);
    expect(sheet.equipment.wealth).toEqual({ kind: 'available', value: '10 gp' });
    expect(sheet.equipment.currency.gp).toEqual({ kind: 'available', value: 10 });
  });

  it('projects valid saved 2024 background improvements with final scores', () => {
    const configuredDocument = { ...document, backgroundChoices: { ...document.backgroundChoices, abilityScores: { advancementId: 'asi', assignments: { int: 2, wis: 1 } } } };
    const configuredSource = { ...source, abilityScores: { ...source.abilityScores!, advancementId: 'asi', cap: 2 } };
    const configuredResults = calculateAbilityScores(selection, { str: 0, dex: 0, con: 0, int: 2, wis: 1, cha: 0 });
    const sheet = projectBackgroundSheet(configuredDocument, { background: configuredSource, abilityResults: configuredResults, abilityBonuses: { species: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, class: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, background: { str: 0, dex: 0, con: 0, int: 2, wis: 1, cha: 0 } } });
    expect(sheet.abilityImprovements).toEqual({ kind: 'available', value: [{ ability: 'int', bonus: 2, finalScore: 14 }, { ability: 'wis', bonus: 1, finalScore: 11 }] });
  });

  it('reports stale saved 2024 background allocations distinctly', () => {
    const staleDocument = { ...document, backgroundChoices: { ...document.backgroundChoices, abilityScores: { advancementId: 'old', assignments: { int: 2, wis: 1 } } } };
    const configuredSource = { ...source, abilityScores: { ...source.abilityScores!, advancementId: 'asi', cap: 2 } };
    const sheet = projectBackgroundSheet(staleDocument, { background: configuredSource, abilityResults });
    expect(sheet.abilityImprovements).toEqual({ kind: 'missing', reason: 'Saved background ability-score allocation does not match the current source.' });
  });

  it('keeps fixed 2014 facts and biography fields explicitly missing', () => {
    const summary: BackgroundSourceSummary = { ...source, ruleset: '2014', abilityScores: { fixed: { wis: 2 } }, languageChoices: [], feat: undefined, features: [{ advancementId: 'feature', source: source.source, description: 'Feature' }] };
    const sheet = projectBackgroundSheet({ ...document, ruleset: '2014', backgroundChoices: undefined }, { background: summary, abilityResults });
    expect(sheet.abilityImprovements).toMatchObject({ kind: 'available', value: [{ ability: 'wis', bonus: 2, finalScore: 11 }] });
    expect(sheet.choices.languages).toEqual({ kind: 'missing', reason: 'No saved background language choices.' });
    expect(sheet.biography.personalityTraits).toEqual({ kind: 'missing', reason: 'Biography data is not stored in the character document.' });
    expect(sheet.sourceFacts.features).toEqual({ kind: 'available', value: summary.features });
  });

  it('reports missing source and does not mutate the character document', () => {
    const before = structuredClone(document);
    const sheet = projectBackgroundSheet(document, {});
    expect(sheet.source).toEqual({ kind: 'missing', reason: 'Background source is unavailable.' });
    expect(sheet.warnings).toContain('Background source is unavailable.');
    expect(document).toEqual(before);
  });

  it('keeps an item quantity missing when a background provenance contribution has no quantity', () => {
    const missingQuantity = structuredClone(document);
    delete missingQuantity.mutable!.inventory.items[0]!.provenance[0]!.quantity;
    const sheet = projectBackgroundSheet(missingQuantity, { background: source });
    expect(sheet.equipment.items[0]!.quantity).toEqual({ kind: 'missing', reason: 'Background item quantity is unavailable from provenance.' });
  });
});
