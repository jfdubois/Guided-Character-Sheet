import { calculateAbilityScores, collectAbilityBonuses, sumAbilityBonuses } from './ability-scores';
import { parseCharacterDocument, type CharacterDocument } from './character-model';
import type { CharacterSheetSources } from './character-sheet-model';
import { calculateClassHitPoints, validateClassHitPoints } from './class-hit-points';
import { validateClassConfiguration, restoreClassConfiguration, buildClassConfiguration } from './class-configuration';
import { projectClassLevelProgression, trimClassProgression } from './class-level-progression';
import { buildSpeciesConfiguration, restoreSpeciesConfiguration, validateSpeciesConfiguration } from './species-configuration';
import { projectCharacterSheet } from './character-sheet-model';
import { createFinalizedMutableCharacterState, effectiveHitPointMaximum, type CharacterResource, type CharacterSpellUse, type MutableHitPoints } from './mutable-character-state';
import type { MutableReset } from './resource-period';
import { getEligibleSpeciesFeatures } from './species-feature-eligibility';
import { getEligibleClassFeatures } from './class-feature-eligibility';
import { draconicSorceryHitPointsPerLevel } from './passive-effects';
import { projectLevelResources } from './character-level-resources';

/** Validate a level draft and reconcile its source-owned projections before a store write. */
export function applyCharacterLevelDraft(saved: CharacterDocument, draft: CharacterDocument, sources: CharacterSheetSources): CharacterDocument {
  const current = parseCharacterDocument(saved);
  let next = parseCharacterDocument(draft);
  const oldProgression = current.classProgressions?.[0];
  const draftProgression = next.classProgressions?.[0];
  const classSummary = sources.class;
  const species = sources.species;
  const background = sources.background;
  const rulesetReset = current.ruleset !== next.ruleset;
  const classReset = oldProgression !== undefined && draftProgression !== undefined && oldProgression.class.sourcePath !== draftProgression.class.sourcePath;
  const rebuilding = rulesetReset || classReset || current.mutable === undefined;
  if (next.ruleset === null || draftProgression === undefined || classSummary === undefined || species === undefined || background === undefined || (!rebuilding && (current.ruleset === null || oldProgression === undefined))) throw new Error('Required character source data is unavailable for level reconciliation.');
  if (current.foundry.systemVersion !== next.foundry.systemVersion || current.foundry.sourceCommit !== next.foundry.sourceCommit || current.foundry.sourceBranch !== next.foundry.sourceBranch) throw new Error('The pinned Foundry source snapshot changed. Reopen the character before applying.');
  if ((!rebuilding && oldProgression!.class.sourcePath !== draftProgression.class.sourcePath) || draftProgression.class.sourcePath !== classSummary.source.sourcePath || classSummary.ruleset !== next.ruleset || species.ruleset !== next.ruleset || background.ruleset !== next.ruleset) throw new Error('Character source selections do not match the loaded sources.');
  if (sources.warnings.some((warning) => /^(Species|Class|Background) source unavailable/i.test(warning))) throw new Error(sources.warnings.find((warning) => /^(Species|Class|Background) source unavailable/i.test(warning))!);

  const targetLevel = draftProgression.targetLevel;
  let progression = trimClassProgression(draftProgression, classSummary, targetLevel);
  const abilityResults = next.abilityScores === undefined ? undefined : calculateAbilityScores(next.abilityScores, sumAbilityBonuses(collectAbilityBonuses(species, classSummary, progression, background, next.backgroundChoices?.abilityScores)));
  if (abilityResults === undefined) throw new Error('Complete ability scores are required for level reconciliation.');
  const abilityModifiers = { str: abilityResults.str.modifier, dex: abilityResults.dex.modifier, con: abilityResults.con.modifier, int: abilityResults.int.modifier, wis: abilityResults.wis.modifier, cha: abilityResults.cha.modifier };
  const levelProjection = projectClassLevelProgression(classSummary, targetLevel, { abilityModifiers });
  if (levelProjection.diagnostics.length > 0) throw new Error(levelProjection.diagnostics[0]);
  const snapshot = { owner: 'foundryvtt', repo: 'dnd5e', branch: next.foundry.sourceBranch, commit: next.foundry.sourceCommit, systemVersion: next.foundry.systemVersion };
  const configurationBase = buildClassConfiguration(classSummary, snapshot, targetLevel);
  const derived = new Map(configurationBase.selections.filter((selection) => selection.kind === 'spell' && selection.advancementId.startsWith(`derived:${classSummary.source.sourcePath}:`)).map((selection) => [selection.advancementId, selection]));
  progression = { ...progression, selections: progression.selections.flatMap((selection) => {
    if (selection.kind !== 'spell' || !selection.advancementId.startsWith(`derived:${classSummary.source.sourcePath}:`)) return [selection];
    const current = derived.get(selection.advancementId);
    if (current?.kind !== 'spell') return [];
    const options = new Set((current.options ?? []).map((option) => `${option.source.sourcePath}:${option.source.pack}:${option.source.type}:${option.source.id}`));
    return [{ ...current, selected: selection.selected.filter((spell) => options.has(`${spell.sourcePath}:${spell.pack}:${spell.type}:${spell.id}`)).slice(0, current.count ?? Number.MAX_SAFE_INTEGER) }];
  }) };
  const configuration = restoreClassConfiguration(progression, { class: configurationBase.class, summary: classSummary, configuration: configurationBase, snapshot });
  const classErrors = validateClassConfiguration(configuration, { class: configuration.class, summary: classSummary, configuration: configurationBase, snapshot });
  if (classErrors.length > 0) throw new Error(classErrors[0]);
  const incompleteClassChoice = requiredClassChoiceError(configuration.selections, classSummary, targetLevel);
  if (incompleteClassChoice !== undefined) throw new Error(incompleteClassChoice);
  if (next.origin === undefined) throw new Error('Species selection is missing for level reconciliation.');
  const speciesSummary = { ...species, source: { ...species.source, identifier: species.source.identifier ?? next.origin.identifier } };
  const speciesBuilt = buildSpeciesConfiguration(speciesSummary, snapshot);
  const speciesSource = { origin: next.origin, summary: speciesSummary, grants: speciesBuilt.grants, choices: speciesBuilt.choices, spellChoices: speciesBuilt.spellChoices, snapshot };
  const speciesConfiguration = next.speciesConfiguration === undefined ? speciesBuilt : restoreSpeciesConfiguration(next.speciesConfiguration, speciesSource);
  const speciesErrors = validateSpeciesConfiguration(speciesConfiguration, speciesSource);
  if (speciesErrors.length > 0) throw new Error(speciesErrors[0]);
  const storedHitPoints = next.classHitPoints ?? (rebuilding ? [] : current.classHitPoints ?? [{ classSourcePath: classSummary.source.sourcePath, level: 1, value: 'max' as const }]);
  const hpEntries = storedHitPoints.filter((entry) => entry.classSourcePath === classSummary.source.sourcePath && entry.level <= targetLevel).map((entry) => ({ ...entry }));
  const hpErrors = validateClassHitPoints(hpEntries, classSummary.source.sourcePath, classSummary.hitDie, targetLevel);
  if (hpErrors.length > 0) throw new Error(hpErrors[0]);

  const featureDocument = { ...next, classProgressions: [progression] };
  const permanentBonus = getEligibleSpeciesFeatures(featureDocument, species).flatMap((feature) => feature.hitPointModifiers ?? []).reduce((total, modifier) => total + modifier.perLevel, 0)
    + draconicSorceryHitPointsPerLevel(getEligibleClassFeatures(featureDocument, classSummary).map((feature) => ({ source: feature.source, effects: feature.activeEffects ?? [] })), next.ruleset ?? classSummary.ruleset);
  const maximum = calculateClassHitPoints(hpEntries, classSummary.source.sourcePath, classSummary.hitDie, targetLevel, abilityResults.con.modifier, permanentBonus);
  const derivedDocument = parseCharacterDocument({ ...featureDocument, classHitPoints: hpEntries });
  const sheet = projectCharacterSheet(derivedDocument, sources);

  const oldMutable = current.mutable;
  const projectedResources = projectLevelResources(derivedDocument, classSummary, species, background);
  if (projectedResources.diagnostics.length > 0) throw new Error(projectedResources.diagnostics[0]);
  const resources = reconcileCounters(oldMutable?.resources ?? [], projectedResources.resources);
  const spellProjection = collectSpellUses(sheet);
  if (spellProjection.diagnostics.length > 0) throw new Error(spellProjection.diagnostics[0]);
  const derivedSpellUses = spellProjection.uses;
  const spellUses = reconcileCounters(oldMutable?.spellUses ?? [], derivedSpellUses);
  if (rebuilding) {
    const initial = createFinalizedMutableCharacterState(next.inventory ?? { items: [], currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }, {
      ruleset: next.ruleset, classSourcePath: classSummary.source.sourcePath, classHitDie: classSummary.hitDie,
      constitutionModifier: abilityResults.con.modifier,
      spellSlots: levelProjection.spellcasting?.spellSlots ?? [], spellUses: derivedSpellUses, resources,
      characterLevel: targetLevel,
    });
    const rebuilt = { ...initial, hitPoints: { current: maximum, maximum, temporary: 0 }, resources: reconcileCounters([], resources), spellUses: reconcileCounters([], derivedSpellUses) };
    return parseCharacterDocument({ ...derivedDocument, mutable: rebuilt });
  }
  if (oldMutable === undefined) throw new Error('Mutable character state is unavailable.');
  const spellSlots = (levelProjection.spellcasting?.spellSlots ?? []).map((slot) => {
    const previous = oldMutable.spellSlots?.find((entry) => entry.key === slot.key || entry.key === undefined && slot.key === undefined && entry.level === slot.level);
    return { key: slot.key, kind: slot.kind, level: slot.level, maximum: slot.maximum, current: previous === undefined ? slot.maximum : preserveSpent(previous.current, previous.maximum, slot.maximum), recovery: [...slot.recovery] };
  });
  const hitDice = next.ruleset === '2024'
    ? [{ classSourcePath: classSummary.source.sourcePath, denomination: classSummary.hitDie, current: preserveSpent(oldMutable.hitDice?.find((pool) => pool.classSourcePath === classSummary.source.sourcePath)?.current ?? oldProgression!.targetLevel, oldMutable.hitDice?.find((pool) => pool.classSourcePath === classSummary.source.sourcePath)?.maximum ?? oldProgression!.targetLevel, targetLevel), maximum: targetLevel }]
    : undefined;
  const preparedSpellKeys = new Set((sheet.spells?.cantrips ?? []).concat(sheet.spells?.levels.flatMap((level) => level.spells) ?? []).filter((spell) => spell.prepared.kind === 'available' && spell.prepared.value).map((spell) => spell.source.kind === 'available' ? `${spell.source.value.sourcePath}:${spell.source.value.pack}:${spell.source.value.type}:${spell.source.value.id}` : ''));
  const mutable = {
    ...oldMutable,
    hitPoints: oldMutable.hitPoints === undefined ? undefined : reconcileHitPoints(oldMutable.hitPoints, maximum),
    resources,
    spellUses,
    spellSlots,
    ...(hitDice === undefined ? { hitDice: oldMutable.hitDice } : { hitDice }),
    preparedSpells: oldMutable.preparedSpells.filter((spell) => preparedSpellKeys.has(`${spell.sourcePath}:${spell.pack}:${spell.type}:${spell.id}`)),
  };
  return parseCharacterDocument({ ...derivedDocument, mutable });
}

function collectSpellUses(sheet: ReturnType<typeof projectCharacterSheet>): { uses: CharacterSpellUse[]; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const uses = (sheet.spells?.freeUses ?? []).flatMap((use) => {
    const summary = use.recoveryPeriod;
    const reset: MutableReset | undefined = summary === undefined || summary === 'none' ? 'none' : summary === 'sr' || summary === 'shortRest' || summary === 'short rest' ? 'short-rest' : summary === 'lr' || summary === 'longRest' || summary === 'long rest' ? 'long-rest' : undefined;
    if (reset === undefined) { diagnostics.push(`${use.key}: unsupported spell-use recovery period ${String(summary)}.`); return []; }
    return [{ key: use.key, current: use.current.kind === 'available' ? use.current.value : use.maximum, maximum: use.maximum, reset, ...(reset === 'none' ? {} : { recovery: [{ period: reset, type: 'recover-all' as const }] }) }];
  });
  return { uses, diagnostics };
}

function requiredClassChoiceError(selections: import('./class-configuration').ClassAdvancementSelection[], summary: NonNullable<CharacterSheetSources['class']>, targetLevel: number): string | undefined {
  for (const selection of selections) {
    const advancement = summary.advancements.find((entry) => entry.id === selection.advancementId);
    if (selection.kind === 'spell' && selection.advancementId.startsWith(`derived:${summary.source.sourcePath}:`) && selection.count !== undefined && selection.selected.length !== selection.count) return `Choose exactly ${selection.count} spell${selection.count === 1 ? '' : 's'} for ${selection.advancementId.split(':').at(-1)}.`;
    if (advancement === undefined || advancement.level > targetLevel || advancement.classRestriction !== undefined && advancement.classRestriction !== 'primary') continue;
    let expected: number | undefined;
    if (selection.kind === 'spell') expected = selection.count;
    else if (selection.kind === 'subclass') expected = 1;
    else if (selection.kind === 'ability-score') continue;
    else {
      const configuration = advancement.raw.configuration;
      if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) continue;
      const raw = (configuration as Record<string, unknown>).choices;
      if (typeof raw === 'number') expected = raw;
      else if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && typeof (raw[0] as Record<string, unknown>).count === 'number') expected = (raw[0] as Record<string, unknown>).count as number;
      else if (typeof raw === 'object' && raw !== null) {
        const entries = Object.entries(raw as Record<string, unknown>).flatMap(([level, value]) => typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>).count === 'number' && (!/^\d+$/.test(level) || Number(level) <= targetLevel) ? [{ level: /^\d+$/.test(level) ? Number(level) : -1, count: (value as Record<string, unknown>).count as number }] : []).sort((left, right) => right.level - left.level);
        expected = entries[0]?.count;
      }
    }
    const selected = selection.kind === 'trait' || selection.kind === 'expertise' ? selection.selected.length : selection.kind === 'item' ? selection.selected.length : selection.kind === 'spell' ? selection.selected.length : selection.kind === 'subclass' ? Number(selection.selected !== undefined) : 0;
    if (expected !== undefined && selected !== expected) return `Choose exactly ${expected} value${expected === 1 ? '' : 's'} for ${advancement.title || advancement.id}.`;
  }
  return undefined;
}

function reconcileCounters<T extends CharacterResource | CharacterSpellUse>(previous: T[], desired: T[]): T[] {
  return desired.map((entry) => {
    const existing = previous.find((candidate) => candidate.key === entry.key);
    if (existing === undefined) return { ...entry, current: entry.maximum };
    return { ...entry, current: preserveSpent(existing.current, existing.maximum, entry.maximum), ...(entry.recovery === undefined ? {} : { recovery: entry.recovery }) };
  });
}

function preserveSpent(current: number, oldMaximum: number, newMaximum: number): number {
  return Math.max(0, newMaximum - Math.max(0, oldMaximum - current));
}

function reconcileHitPoints(hitPoints: MutableHitPoints, maximum: number): MutableHitPoints {
  const previousEffectiveMaximum = effectiveHitPointMaximum(hitPoints);
  const next = { ...hitPoints, maximum };
  const nextEffectiveMaximum = effectiveHitPointMaximum(next);
  const damage = Math.max(0, previousEffectiveMaximum - hitPoints.current);
  return { ...next, current: Math.max(0, nextEffectiveMaximum - damage) };
}
