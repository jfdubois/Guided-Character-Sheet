# Shared Character Leveling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let creation and Edit character use one level-organized editor that can raise or lower a single class level and apply a complete, source-backed character update.

**Architecture:** Keep the existing character view and source catalog. Add a pure HP ledger and a level-aware Foundry projection, then a pure Apply reconciler that the view writes with `Vault.process()`. Completed-character editing uses a draft until Apply; creation reuses the same class cards while retaining its current incomplete-document persistence.

**Tech Stack:** TypeScript, Obsidian public API, Vitest, pinned Foundry D&D source.

**Spec:** `docs/superpowers/specs/2026-10-20-shared-character-leveling-design.md`

## Global Constraints

- This release uses the pinned Foundry SRD source and supports one class progression per character.
- The saved character contains only choices and HP gains effective at its saved level.
- Source-backed eligibility remains enforced; Features and traits is descriptive; Actions shows only eligible structured activities and their usage controls.
- Spell preparation and usage remain separate; the plugin does not roll dice or infer outcomes.
- The existing effective-maximum override remains separate and is preserved across leveling.
- Unknown required Foundry structures block Apply with a source-specific diagnostic.
- Use public Obsidian APIs and safe DOM construction; do not modify or commit `external/foundryvtt/` or `external/obsidian/obsidian.ts`.
- Before owner testing, build the production bundle and copy `main.js` to the dedicated test-vault plugin directory.

## Review Focus

1. A saved high-level character without HP history must require entered gains and retain its old maximum until Apply (Task 1 test).
2. Lowering then raising in one draft must not persist inactive choices; a completed Apply keeps only effective entries (Tasks 2 and 3 tests).
3. A resource without long-rest recovery must retain its spent count, while a removed grant loses its counter (Task 3 test).
4. Missing or ambiguous Foundry progression data must block Apply with a diagnostic, including spell-slot progression (Task 2 test).
5. An external character-file edit during an open draft must stop Apply without overwriting it (Task 4 test).

---

## File map

- `src/class-hit-points.ts`: validate and calculate the effective per-level HP ledger.
- `src/class-level-progression.ts`: interpret class advancements and spell progression at a target level from pinned Foundry semantics.
- `src/class-level-cards.ts`: group eligible features and choices by class level and authoritative relationship.
- `src/character-level-change.ts`: validate and reconcile a completed draft with mutable sheet state.
- `src/character-reset-modal.ts`: public-API OK/Cancel confirmation for ruleset and class replacement.
- `src/character-model.ts`, `src/class-configuration.ts`, `src/character-sources.ts`, `src/spell-sheet-model.ts`, `src/character-view.ts`, `src/character-store.ts`, `styles.css`: integrate the new units with existing persistence, projections, and UI.
- Focused tests in `tests/` mirror the new units; existing model/view/sheet tests receive regression assertions.

### Task 1: Effective HP ledger and document validation

**Files:** Create `src/class-hit-points.ts`, `tests/class-hit-points.test.ts`; modify `src/character-model.ts`, `tests/character-model.test.ts`, `src/character-view.ts` finalization path.

**Interfaces:** Produce `ClassHitPointEntry = { classSourcePath: string; level: number; value: 'max' | 'avg' | number }`, `validateClassHitPoints(entries: readonly ClassHitPointEntry[], classSourcePath: string, hitDie: string, targetLevel: number): string[]`, and `calculateClassHitPoints(entries, classSourcePath, hitDie, targetLevel, constitutionModifier, permanentPerLevelBonus): number`. Store effective entries as optional `CharacterDocument.classHitPoints`, with legacy level-one initialization during edit/finalization; never infer missing higher-level rolls.

- [ ] **Step 1: Write failing tests** for 1d10 maximum at level 1, average and numeric gains at levels 2–3, Constitution changes affecting all three levels, minimum one HP per level, malformed/out-of-range/duplicate/missing entries, target-level reduction excluding higher entries, and legacy higher-level files preserving their saved maximum until a complete Apply.
  Key assertions: `calculateClassHitPoints([max, avg, 4], fighterPath, 'd10', 3, 2, 0) === 26`; with Constitution 3 it is `29`; a numeric `11` or a missing level 2 yields validation errors; parsing a legacy file leaves its existing `mutable.hitPoints.maximum` unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/class-hit-points.test.ts tests/character-model.test.ts`; expect the new tests to fail.
- [ ] **Step 3: Implement** the ledger and document parser rules. Validate the exact effective level sequence and class source; reject persisted entries above `targetLevel`. Seed `max` when finalizing a new level-one character. Keep `mutable.hitPoints.maximumOverride` independent.
- [ ] **Step 4: Run** the same tests; expect pass. Run `npm run build`; expect TypeScript and bundling to pass.
- [ ] **Step 5: Commit** only the Task 1 source and test paths after inspecting staged paths.

### Task 2: Level-aware Foundry progression

**Files:** Create `src/class-level-progression.ts`, `tests/class-level-progression.test.ts`; modify `src/character-sources.ts`, `src/class-configuration.ts`, `src/spell-sheet-model.ts`, `src/character-view.ts`, and their focused tests.

**Interfaces:** Consume `ClassSourceSummary`, `ClassConfiguration`, and pinned Foundry spellcasting semantics. Produce `projectClassLevelProgression(summary: ClassSourceSummary, targetLevel: number): { spellcasting?: { spellSlots: LevelOneSpellSlot[]; cantripsKnown?: number; learnedSpells?: number; spellbookSpells?: number; preparedCapacity?: number }; diagnostics: string[] }` and `trimClassProgression(progression: ClassProgressionSelection, summary: ClassSourceSummary, targetLevel: number): ClassProgressionSelection`. Replace `getLevelOneClassProgression()` use in finalization and spell projection; keep verified level-one outcomes without extending its prose-based fallback to later levels. A required progression that cannot be interpreted yields a diagnostic, never guessed slots or capacities.

- [ ] **Step 1: Write failing tests** for 2014 and 2024 source-backed entitlement gating across the 1–20 range, a higher-level spellcaster's slots and preparation ceiling, a pact caster, lower-level trimming of feat/spell/subclass selections, and a synthetic unknown progression that reports a source-specific diagnostic. Check a down/up draft does not persist hidden selections after trim.
  Key assertions: `trimClassProgression(level3Rogue, rogueSummary, 1).selections` contains no level-3 subclass choice; a caster's level-3 slot projection differs from level 1; unsupported spellcasting returns a diagnostic containing its source path and no fabricated slots.
- [ ] **Step 2: Run** `npx vitest run tests/class-level-progression.test.ts tests/class-configuration.test.ts tests/spell-sheet-model.test.ts`; expect new tests to fail.
- [ ] **Step 3: Implement** the compatibility adapter using the pinned Foundry class fields and spellcasting rules as reference, without executing or copying Foundry code. Extend the source summary only with upstream fields needed by the adapter. Update spell sheet and finalization callers to use the level-aware result; retain explicit diagnostics for unknown data.
- [ ] **Step 4: Run** the same tests plus `npm run audit:2024:mapping`; expect pass. Run `npm run build`; expect pass.
- [ ] **Step 5: Commit** only the Task 2 source and test paths after inspecting staged paths.

### Task 3: Feature cards by level

**Files:** Create `src/class-level-cards.ts`, `tests/class-level-cards.test.ts`; modify `src/character-view.ts`, `styles.css`, `tests/character-view.test.ts`.

**Interfaces:** Produce `buildClassLevelCards(summary: ClassSourceSummary, configuration: ClassConfiguration): Array<{ level: number; cards: Array<{ key: string; title: string; description?: string; choiceAdvancementIds: string[] }> }>`. Cards use advancement IDs and resolved source references; unknown relationships become standalone advancement cards at their actual level.

- [ ] **Step 1: Write failing tests** for feature plus linked choice in one card, a standalone choice without a reliable parent, level order, a newly selected subclass dependency, no level-above-target card, and stable card IDs across rerender.
  Key assertions: the linked choice's `advancementId` occurs in exactly one feature card's `choiceAdvancementIds`; an unlinked choice appears once in a level-matched standalone card; `rows.map(row => row.level)` equals `[1, 2, 3]` for a level-3 fixture.
- [ ] **Step 2: Run** `npx vitest run tests/class-level-cards.test.ts tests/character-view.test.ts`; expect new tests to fail.
- [ ] **Step 3: Implement** the pure grouping and render it in one class tab with collapsible level sections. Reuse existing class choice controls, safe description rendering, overview, core traits, and starting-equipment controls. Add plugin-scoped CSS and accessible section/tab labels.
- [ ] **Step 4: Run** the same tests and `npm run build`; expect pass.
- [ ] **Step 5: Commit** only the Task 3 source, CSS, and tests after inspecting staged paths.

### Task 4: Draft editing and section navigation

**Files:** Create `src/character-reset-modal.ts`; modify `src/character-view.ts`, `src/character-store.ts`, `tests/character-view.test.ts`, `tests/character-store.test.ts`.

**Interfaces:** Completed-character edit keeps `savedDocument` and `draftDocument` distinct. Introduce `CharacterStore.updateIfUnchanged(file: TFile, expected: CharacterDocument, update: (current: CharacterDocument) => CharacterDocument): Promise<CharacterDocument>` using `Vault.process()` and a comparison that rejects external changes. Existing creation writes remain supported.

- [ ] **Step 1: Write failing tests** for species selection in Species, ruleset staying in Identity, OK/Cancel ruleset reset, class replacement warning, editor Cancel preserving the file, and external file modification preventing Apply. Test that an ignored confirm does not change the select or the file.
  Key assertions: declining reset leaves `document.ruleset` and all saved choices unchanged; Cancel leaves the saved JSON byte-equivalent; `updateIfUnchanged()` rejects a changed file and does not call the update callback.
- [ ] **Step 2: Run** `npx vitest run tests/character-view.test.ts tests/character-store.test.ts`; expect new tests to fail.
- [ ] **Step 3: Implement** one draft for completed-character edits, Apply/Cancel affordances, section relocation, and an Obsidian `Modal` confirmation. Route editor mutations to the draft, flush any pending creation writes before switching modes, and compare the saved file inside `Vault.process()` at Apply time.
- [ ] **Step 4: Run** the same tests and `npm run build`; expect pass.
- [ ] **Step 5: Commit** only Task 4 source and tests after inspecting staged paths.

### Task 5: Atomic Apply reconciliation

**Files:** Create `src/character-level-change.ts`, `tests/character-level-change.test.ts`; modify `src/character-view.ts`, `src/mutable-character-state.ts`, `src/character-sheet-model.ts`, and focused tests.

**Interfaces:** Produce `applyCharacterLevelDraft(saved: CharacterDocument, draft: CharacterDocument, sources: CharacterSheetSources): CharacterDocument`. It consumes Tasks 1–2 validators/projections, trims all ineffective selections, recalculates calculated HP, rebuilds eligible spell slots and uses, resources and hit dice, then applies long-rest recovery semantics. It returns a parsed document or throws a diagnostic before persistence.

- [ ] **Step 1: Write failing tests** for 1→3 and 3→1, HP current/full/temporary and override, gained and lost resources and Actions, recovery-period `none` remaining spent, preserved inventory/equipment/inspiration/valid spell overlay, invalid prepared spells removed, missing source data blocking Apply, and a cancelled draft leaving the saved file unchanged.
  Key assertions: a 3→1 result has one HP entry and no level-3 feature resource or action; `hitPoints.current === hitPoints.maximumOverride` when an override exists and temporary HP is `0`; a `reset: 'none'` resource retains its old current count; missing required source data throws before a document is returned.
- [ ] **Step 2: Run** `npx vitest run tests/character-level-change.test.ts tests/character-sheet-model.test.ts tests/action-sheet-model.test.ts`; expect new tests to fail.
- [ ] **Step 3: Implement** the pure reconciler and connect Apply through Task 4's conditional store update. Reuse existing long-rest logic for recoverable existing entries, initialize only newly eligible counters at maximum, preserve reset metadata, and fail before writing if any required source projection is unresolved.
- [ ] **Step 4: Run** the same tests, `npm test`, and `npm run build`; expect pass.
- [ ] **Step 5: Commit** only Task 5 source and tests after inspecting staged paths.

### Task 6: End-to-end verification and test-vault handoff

**Files:** Modify only files needed to close a demonstrated integration gap; add focused regression tests for each gap. Build output goes to the development plugin location and is not committed as source.

**Interfaces:** The Edit character button opens a completed character draft; Apply writes exactly one valid effective build; Cancel and failed Apply leave the saved character intact.

- [ ] **Step 1: Run** `npm test`, `npm run audit:2024:mapping`, and `npm run build`; record exact output. Repair any concrete failure with a focused test and rerun its failing command.
- [ ] **Step 2: Exercise** a dedicated test-vault character through level 1→2→1, Apply and Cancel, ruleset reset confirmation, and the finished Features, Actions, Spells, and HP sections when an Obsidian UI session is available. Otherwise add a view-level integration test for the same state transitions and report that visual testing remains for the owner.
- [ ] **Step 3: Copy** the production `main.js` to `TEST-Vault/.obsidian/plugins/<plugin-id>/main.js`, using the actual vault and manifest ID; confirm source and copied bundle timestamps/hash agree.
- [ ] **Step 4: Review** changed code against `AGENTS.md`, the product boundaries, public `external/obsidian/obsidian.ts` declarations, source licensing, and staged-path rules. Fix only concrete issues and rerun affected verification.
- [ ] **Step 5: Commit** any integration fixes after inspecting staged paths; report verified behavior and any pinned-source level that remains unsupported with its diagnostic.
