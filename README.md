# Guided Character Sheet

Guided Character Sheet is an Obsidian plugin for creating and using Dungeons &
Dragons 5th Edition character sheets. It guides character choices using D&D 5e
source definitions from the Foundry Virtual Tabletop system and keeps the
resulting character in the user's Obsidian vault.

The plugin provides a guided creation flow and a compact character sheet for
reviewing character details and tracking commonly updated information during
play. It supports the 2014 and 2024 D&D 5e rulesets available through its
configured source data.

## Installation

Install the plugin files in an Obsidian desktop vault under
`.obsidian/plugins/guided-character-sheet/`, then enable **Guided Character
Sheet** in Obsidian's Community plugins settings.

Open the plugin settings to download the source definitions, then use the
**Create character** command to begin.

## Privacy and source data

Guided Character Sheet does not collect analytics or require an account. When
the user requests a source download, the plugin connects to GitHub to retrieve
data from the public
[Foundry VTT D&D 5e repository](https://github.com/foundryvtt/dnd5e). Downloaded
source definitions and created characters are stored locally. Downloaded
JavaScript or TypeScript is not executed as plugin code.

## License and attribution

This plugin is distributed under the [MIT License](LICENSE). Foundry VTT D&D
5e source content remains the property of its authors and is distributed under
its applicable license. See the
[Foundry dnd5e repository](https://github.com/foundryvtt/dnd5e) for details.
The spell-slot and Pact-casting progression values in the compatibility
adapter are adapted from the Foundry dnd5e system software, Copyright 2021
Andrew Clayton, and are distributed under its MIT License. See
[third-party notices](THIRD-PARTY-NOTICES.md).
