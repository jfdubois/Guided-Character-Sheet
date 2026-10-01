import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('plugin scaffold', () => {
  it('declares a desktop-only plugin with a valid entry point', async () => {
    const manifest = JSON.parse(await readFile('manifest.json', 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      id: 'guided-character-sheet',
      isDesktopOnly: true,
    });
    expect(manifest.main).toBeUndefined();
    expect(await readFile('src/main.ts', 'utf8')).toContain('export default class');
  });

  it('types the settings tab plugin parameter as an Obsidian Plugin', async () => {
    const settings = await readFile('src/settings.ts', 'utf8');
    expect(settings).toContain('import { App, normalizePath, Plugin, PluginSettingTab } from \'obsidian\';');
    expect(settings).toContain('plugin: Plugin');
    expect(settings).not.toContain('plugin: unknown');
    expect(settings).not.toContain('as never');
  });

  it('narrows the vault adapter with an instanceof check', async () => {
    const main = await readFile('src/main.ts', 'utf8');
    expect(main).toContain('adapter instanceof FileSystemAdapter');
    expect(main).not.toContain('this.app.vault.adapter as FileSystemAdapter');
  });

  it('uses Obsidian helpers for paths and settings headings', async () => {
    const pluginPath = await readFile('src/plugin-path.ts', 'utf8');
    const settings = await readFile('src/settings.ts', 'utf8');
    expect(pluginPath).not.toContain('replace(/[\\\\/]$/, \'\')');
    expect(settings).toContain('normalizePath(this.app.vault.configDir)');
    expect(settings).toContain("new Setting(this.containerEl).setName('Source synchronization').setHeading()");
    expect(settings).not.toContain("createEl('h2'");
  });

  it('exposes character creation commands and configured storage', async () => {
    const settingsModel = await readFile('src/settings-model.ts', 'utf8');
    const main = await readFile('src/main.ts', 'utf8');
    expect(settingsModel).toContain("characterFolder: 'Characters'");
    expect(main).toContain("name: 'Create new character'");
    expect(main).toContain("name: 'Open character sheet'");
    expect(main).toContain('this.settings.characterFolder');
  });
});
