# Source-backed passive effects and feat visibility

Status: design for product-owner review, 2026-10-12.

## Intent and boundary

The sheet should automatically reflect direct, stable changes supplied by an
eligible Foundry source feature. This includes supported calculations and
static additions or subtractions to facts already projected by the sheet. It
must not require a new character, a manual toggle, or a feat-name special case
for Alert's Initiative proficiency.

Advantage, disadvantage, a choice made during play, a temporary or conditional
effect, and a dice result remain visible in the source feature description
without being applied as permanent arithmetic. This follows
`docs/character-sheet-product-boundaries.md`; this design does not expand the
automation boundary. Level-one creation is the active baseline, and later
grants remain level-gated.

All granted and selected feats should be visible with their authoritative
descriptions during the relevant creation step and in Features and traits
after creation. A feat that has no configuration choices must still appear.

## Current evidence and root causes

- Alert's pinned feat record has a transferable active effect setting
  `flags.dnd5e.initiativeAlert` to `true`. The pinned Foundry 2024 Initiative
  calculation interprets that flag as full proficiency. The plugin currently
  projects Initiative from Dexterity alone.
- The 2024 background reader returns an empty `features` list and one
  `grantedFeat`. Creation formerly rendered only `features`, while its separate
  feat control appeared only for feats requiring choices. This hid Alert. The
  recent generic callout fix now displays the granted feat and its description.
  The four pinned 2024 backgrounds each grant exactly one feat, but the reader
  still selects only the first grant.
- Class `ItemGrant` features and species source features already carry
  descriptions. Class feats selected through an item or ability-score choice
  are projected into completed-sheet Feats without source details. Species
  choice-pool entries are intentionally not shown as automatic features, but a
  selected feat must have a visible description after selection.
- Species effects already have a narrow reader for saving-throw roll markers
  and Dwarven Toughness HP. There is no shared effect path for eligible class,
  background-feat, and species grants.

## Approach

Use a plugin-owned, version-aware adapter for a documented subset of Foundry
effect semantics. Do not run Foundry JavaScript, evaluate arbitrary formulas,
clone its Actor model, or infer arithmetic from prose. The pinned Foundry
records and system implementation define the baseline semantics; plugin code
only translates understood effects into character-sheet facts.

Rejected alternatives:

1. A feat-name check for Alert is quick but misses the same effect from another
   eligible source and makes the feat name a competing rule definition.
2. A generic Foundry active-effect engine is too broad for this plugin, unsafe
   for remote data, and inconsistent with the no-simulation product boundary.

### Source and entitlement flow

The source reader resolves granted or selected feat references from class,
species, and background source records. It retains source identity, ruleset,
description, and raw effect changes at the adapter boundary, without copying
complete upstream records into character storage. A shared collector considers
only features actually entitled to the character: current level, class and
species choices, background grant, and source availability all apply before
an effect reaches sheet calculation. The same source reference is deduplicated
when multiple paths grant it.

The collector must not silently truncate multiple grants to the first feat.
Existing saved characters retain their references and receive the new
projection on reload; no character-file migration is required for this work.

### Effect interpretation

For each entitled source, the adapter inspects `effects[]` and
`effects[].system.changes[]`. It validates transfer and disabled state,
change key, operation, value, and relevant ruleset. It accepts only
always-on, deterministic effects with an understood target. It produces a
typed contribution carrying the source reference and original Foundry key.

The first target is Initiative proficiency from
`flags.dnd5e.initiativeAlert` in the 2024 ruleset. Initiative becomes Dexterity
modifier plus the applicable proficiency contribution. Proficiency is a
single tier, not an additive bonus for each source; duplicate or competing
proficiency effects cannot double-count it. The adapter should reuse the
existing proficiency-bonus projection. An unsupported or malformed Alert
effect must not be guessed from the feat's name or prose.

The implementation plan must first inventory transferable effects of pinned
level-one class, species, background, and feat grants whose targets affect
existing stable sheet facts. Every such effect must be classified as:

- supported direct contribution, with target-specific combination rules;
- known descriptive or conditional effect, excluded from automatic totals;
- unsupported or malformed effect, with a visible source-linked diagnostic.

Add support for each direct, deterministic contribution found in that bounded
inventory rather than adding only Alert. A new or changed upstream key must
not be silently treated as zero. Later-level and item effects remain in their
existing workflows; this design does not activate future grants or infer that
an unequipped item applies. When those sources become eligible in a later
workflow, they use the same adapter contract.

Contributions combine according to their specific target: numeric additions
may sum where the source operation permits it; overrides and proficiency
tiers require explicit precedence; the same source effect applies once.
Formula-like values are accepted only when a narrowly specified, source-backed
meaning can be resolved without executing arbitrary expressions. Otherwise
the effect remains descriptive with a diagnostic.

### Feat visibility

The creation and completed-sheet projections use one resolved feat identity
and source description for each eligible grant or selection. A background feat
appears even without choices; feat configuration controls remain separate.
Automatic class features and species traits keep their existing cards. A
selected class or species feat gets a description card once selected, but a
mere choice-pool candidate does not become an owned feature. Future-level
feats stay hidden until eligible. Features and traits remains description-only
and never duplicates action usage controls.

If a feat source cannot be resolved, retain its saved name or reference and
show a clear unavailable-source message rather than dropping it or inventing
text. Duplicate grants show one feat with provenance from each grant path.

## Error handling and compatibility

Unknown effect keys, unsupported operations, conditional effects mistaken for
passive effects, and malformed values never enter a calculated total. Known
descriptive effects stay readable without a warning; genuinely unsupported
direct effects surface a source-linked diagnostic. Failure of one source does
not erase contributions already validated from another. Source-version
changes require an adapter review and pinned-source regression audit, not an
assumption that matching YAML shape guarantees matching semantics.

The feature uses existing Obsidian and source-reader boundaries. No new
network access, dependency, character-data schema, or upstream file changes
are required. The pinned Foundry checkout remains read-only and uncommitted.

## Verification and acceptance

- Unit tests cover transferable versus disabled and conditional effects,
  numeric operation and precedence, duplicate sources, malformed values,
  missing source data, and level/choice eligibility.
- A pinned-source test confirms that Criminal's Alert effect adds proficiency
  to Initiative in 2024, only once, and that removing the grant restores the
  Dexterity-only total. Advantage-only effects leave the numeric total alone.
- Source-backed tests cover every pinned 2024 background feat (Acolyte,
  Criminal, Sage, Soldier), an automatic class feat, a selected class feat,
  an automatic species trait, and a selected species feat. Creation and
  completed-sheet displays show each eligible description once.
- An audit classifies every relevant pinned level-one transferable effect and
  fails on an unclassified direct effect. Unsupported effects remain visible
  in diagnostics, not silently omitted from calculated facts.
- The full test suite and production build pass. The built `main.js` is copied
  to `TEST-Vault/.obsidian/plugins/guided-character-sheet/main.js` before
  asking for an in-Obsidian check. Existing characters need only a plugin
  reload, not recreation.
