# Shared character creation and leveling design

## Purpose and scope

Use one guided editor for level-one creation and later editing from **Edit character**. A person can raise or lower the level of their existing class to compare builds. The saved character contains only choices and HP gains effective at its saved level. This release uses the pinned Foundry SRD source and supports one class progression per character.

The editor must preserve the product decisions in `docs/character-sheet-product-boundaries.md`: source-backed eligibility remains enforced; Features and traits is descriptive; Actions shows only eligible structured activities and their usage controls; spell preparation and usage remain separate; the plugin does not roll dice or infer outcomes.

## Shared editor and navigation

The existing right-side character view remains the editor. Creation and editing share section components and the same class progression controls. The section rail is **Identity**, **Species**, **Class**, **Background**, **Ability scores**, and **Inventory**. Species selection moves from Identity into Species. Identity keeps the name and the 2014/2024 ruleset selector.

Selecting a different ruleset opens an Obsidian OK/Cancel modal warning that the character's selections and sheet state will reset to avoid mixed rules. Cancel restores the prior selection. Confirming resets the editor draft using the existing ruleset transition and leaves the character incomplete until valid choices are made. A saved completed character is not changed until Apply.

Class presents one class tab, labeled with its name and current level, and a level selector from 1 through the maximum supported by the pinned source. The tab layout reserves a place for future multiclass tabs but exposes no add-class control while a class already exists. A character without a class can select its first class. Changing an existing class requires a separate warning because class-dependent choices and HP gains must be rebuilt. This is a replacement of the sole class, not multiclassing.

Within the class tab, level sections run in ascending order from Level 1 through the draft target. Each section contains source-backed feature cards with a name, description, and choice controls when Foundry links the choice to that feature. An advancement without a reliable feature link appears as its own card under the correct level. Sections are collapsible; the first incomplete level opens by default. Starting equipment stays outside the level sections because it is a class-start choice. Existing class overview and core traits remain accessible without obscuring level choices.

Creation can continue saving its incomplete guided document as it does today. Editing a completed character uses an in-memory draft. Apply validates and writes the complete change once; Cancel returns to the saved sheet. Moving the draft level down may temporarily hide higher-level entries so the user can compare options, but Apply removes all entries above the effective target. No inactive selections or HP entries are stored in the character file. A later build-copy feature may create a separate character file for persistent experiments; it is not required here.

## Hit points

Plugin-owned character data records effective per-class-level HP choices, keyed by class source and level. The representation follows the pinned Foundry `HitPoints` advancement semantics: `max` at the first class level, `avg` for the class hit-die average, or a user-entered numeric roll for later levels. The plugin never rolls dice. A roll must be an integer within the class hit die. The editor shows the previous calculated maximum, the selected gain, the Constitution contribution, permanent source-backed bonuses, and the proposed new maximum.

The calculated maximum is recomputed from all effective HP entries, current Constitution modifier, and eligible permanent bonuses. Each level contributes at least one HP after its modifier, following the pinned Foundry calculation. Constitution changes therefore recalculate earlier levels without rewriting the original roll entries. The existing effective-maximum override remains separate and is preserved across leveling; the HP control can clear it. Applying a level change performs long-rest HP recovery to the effective maximum and clears temporary HP. Lowering the level deletes HP entries for removed levels on Apply.

An existing level-one character can initialize its level-one `max` entry from its saved class source. If a legacy higher-level document has no per-level entries, the editor shows its saved maximum as reference and requires the missing effective entries before Apply; it must not invent historical rolls from one total.

## Apply and sheet reconciliation

Apply checks the pinned source snapshot, class and ruleset compatibility, required advancements, choice cardinality and eligibility, HP entries, and all other creation requirements affected by the draft. An incomplete or unsupported source relationship produces a visible diagnostic and prevents the write. The saved file is rechecked during an atomic `Vault.process()` update; an external edit conflict leaves it unchanged.

The update stores only selections through the effective class level. Source-backed projection recalculates abilities, proficiency, expertise, class and species grants, feats, spells, slots, resources, and eligible feature activities. The completed sheet continues deriving Features and traits and Actions from those projections; no duplicate action list is stored. Lowering a level removes actions and use counters whose source entitlement no longer applies. Newly eligible counters start at their source-defined maximum. Existing mutable resources recover as a long rest according to each resource's authoritative recovery period; a resource with no long-rest recovery is not silently refilled. Inventory, equipment state, inspiration, spell overlay, and other unrelated mutable state are preserved unless their source entitlement or a confirmed ruleset/class reset makes them invalid. Preparation is retained only where it remains eligible; preparation and spell usage never consume one another.

Changing the ruleset is an explicit reset, not a normal level transaction. The confirmed reset discards selections and mutable sheet state from the former ruleset. If the user cancels the editor before Apply, the saved character stays unchanged.

## Source and UI boundaries

Foundry fields and advancement relationships remain authoritative. Plugin-owned readers may project those fields into editor cards and sheet state, but must not invent features, spell slots, choices, or actions from prose. Version-specific interpretation belongs in the source adapter. Unknown required structures block Apply with a source-specific diagnostic. The UI uses public Obsidian views, modals, and DOM helpers; source text is rendered as text or through the existing safe overview renderer. The design adds no external service or source download.

## Verification

Tests cover 2014 and 2024 class advancement mapping, effective-level filtering, feature-to-choice placement, raising and lowering, HP average and entered-roll validation, retroactive Constitution changes, override preservation, old-character migration, resource recovery and removal, spell preparation and action eligibility, ruleset reset confirmation, Apply/Cancel, and external edit conflicts. Source mapping tests use synthetic fixtures or the local pinned checkout without committing upstream source data. Before handing plugin changes to the owner for testing, build the production bundle and copy `main.js` to the dedicated test-vault plugin directory as required by `AGENTS.md`.
