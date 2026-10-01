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
    expect(result.findings).toEqual([expect.objectContaining({
      invariant: 'resolution.dependency',
      severity: 'warning',
      sourceName: 'Monk',
      nodeId: 'H32KYn1ozuG9jgYH',
    })]);
    if (result.findings.some((finding) => finding.severity === 'error')) throw new Error(`2024 character-creation audit found ${result.findings.filter((finding) => finding.severity === 'error').length} errors. See the grouped report above.`);
  });
});
