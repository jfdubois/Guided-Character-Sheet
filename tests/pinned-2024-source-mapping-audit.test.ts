import { describe, expect, it } from 'vitest';
import { audit2024SourceMappings, formatSourceMappingJson, formatSourceMappingMarkdown } from './support/source-mapping-audit';
import { createPinnedSourceIndex } from './support/pinned-foundry-source';

describe('pinned 2024 source-mapping audit', () => {
  it('traces supported advancements and feature level boundaries', async () => {
    const result = await audit2024SourceMappings(createPinnedSourceIndex());
    process.stdout.write(`SOURCE_MAPPING_AUDIT_JSON=${formatSourceMappingJson(result)}\n`);
    process.stdout.write(`${formatSourceMappingMarkdown(result)}\n`);
    expect(result.coverage.species).toBeGreaterThan(0);
    expect(result.coverage.classes).toBeGreaterThan(0);
    expect(result.coverage.backgrounds).toBeGreaterThan(0);
    expect(result.coverage.sheetCombinations).toBe(result.coverage.species * result.coverage.classes * result.coverage.backgrounds * 2);
    const errors = result.findings.filter((finding) => finding.severity === 'error');
    if (errors.length > 0) throw new Error(`2024 source-mapping audit found ${errors.length} errors. See the grouped report above.`);
  }, 120_000);
});
