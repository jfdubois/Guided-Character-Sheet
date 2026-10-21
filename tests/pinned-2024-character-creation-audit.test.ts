import { describe, expect, it } from 'vitest';
import { audit2024CharacterCreation, formatAuditJson, formatAuditMarkdown } from './support/character-creation-audit';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

describe('pinned 2024 character creation audit', () => {
  it('reports no semantic completeness violations', async () => {
    const result = await audit2024CharacterCreation(createPinnedSourceIndex());
    process.stdout.write(`CHARACTER_CREATION_AUDIT_JSON=${formatAuditJson(result)}\n`);
    process.stdout.write(`${formatAuditMarkdown(result)}\n`);
    const semantic = result.findings.filter((finding) => finding.invariant.startsWith('choice.species-')
      || finding.invariant.startsWith('presentation.species-')
      || finding.invariant === 'calculation.species-hp-effect'
      || finding.invariant === 'presentation.species-spell-use'
      || finding.invariant === 'choice.class-expertise');
    const counts = Object.fromEntries([...new Set(semantic.map((finding) => finding.invariant))]
      .map((invariant) => [invariant, semantic.filter((finding) => finding.invariant === invariant).length]));
    expect(counts).toEqual({});
    expect(semantic).toEqual([]);
    expect(result.findings.map(({ sourceName, nodeId, observed }) => ({ sourceName, nodeId, observed }))).toEqual([
      { sourceName: 'Fighter', nodeId: 'F4BJnjlTZ7nAuzjg', observed: 'Compendium.dnd5e.feats24.Item.phbfstBlindFight: unresolved source UUID' },
      { sourceName: 'Fighter', nodeId: 'F4BJnjlTZ7nAuzjg', observed: 'Compendium.dnd5e.feats24.Item.phbfstDueling000: unresolved source UUID' },
      { sourceName: 'Fighter', nodeId: 'F4BJnjlTZ7nAuzjg', observed: 'Compendium.dnd5e.feats24.Item.phbfstIntercepti: unresolved source UUID' },
      { sourceName: 'Fighter', nodeId: 'F4BJnjlTZ7nAuzjg', observed: 'Compendium.dnd5e.feats24.Item.phbfstProtection: unresolved source UUID' },
      { sourceName: 'Fighter', nodeId: 'F4BJnjlTZ7nAuzjg', observed: 'Compendium.dnd5e.feats24.Item.phbfstThrownWeap: unresolved source UUID' },
      { sourceName: 'Fighter', nodeId: 'F4BJnjlTZ7nAuzjg', observed: 'Compendium.dnd5e.feats24.Item.phbfstUnarmedFig: unresolved source UUID' },
      { sourceName: 'Monk', nodeId: 'H32KYn1ozuG9jgYH', observed: 'Compendium.dnd5e.classes24.Item.phbmnkSelfrestor: unresolved source UUID' },
    ]);
    if (result.findings.some((finding) => finding.severity === 'error')) throw new Error(`2024 character-creation audit found ${result.findings.filter((finding) => finding.severity === 'error').length} errors. See the grouped report above.`);
  });
});
