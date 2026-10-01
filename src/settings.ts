import { App, normalizePath, Plugin, PluginSettingTab } from 'obsidian';
import { Notice } from 'obsidian';
import { Setting } from 'obsidian';
import { validateSettings, type GuidedCharacterSheetSettings } from './settings-model';
import { resolvePluginDirectory } from './plugin-path';

export { DEFAULT_SETTINGS, formatComparisonNotice, type GuidedCharacterSheetSettings } from './settings-model';

export interface SettingsActions { downloadSources(): Promise<void>; compareWithOnline(): Promise<void>; busy?: boolean; }

export class GuidedCharacterSheetSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: Plugin & SettingsActions & { settings: GuidedCharacterSheetSettings }) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Source synchronization').setHeading();
    new Setting(this.containerEl).setName('Repository').addText((text) => text.setValue(`${this.plugin.settings.owner}/${this.plugin.settings.repo}`).onChange(async (value) => {
      const [owner, repo] = value.split('/', 2);
      try { const next = validateSettings({ ...this.plugin.settings, owner, repo }); this.plugin.settings = next; await this.plugin.saveData(next); } catch { text.setValue(`${this.plugin.settings.owner}/${this.plugin.settings.repo}`); new Notice('Invalid repository. Use owner/repository.'); }
    }));
    new Setting(this.containerEl).setName('Branch').addText((text) => text.setValue(this.plugin.settings.branch).onChange(async (value) => {
      try { const next = validateSettings({ ...this.plugin.settings, branch: value }); this.plugin.settings = next; await this.plugin.saveData(next); } catch { text.setValue(this.plugin.settings.branch); new Notice('Invalid branch ref.'); }
    }));
    new Setting(this.containerEl).setName('Character folder').setDesc('Vault-relative folder for character JSON files.').addText((text) => text.setValue(this.plugin.settings.characterFolder).onChange(async (value) => {
      try { const next = validateSettings({ ...this.plugin.settings, characterFolder: value }); this.plugin.settings = next; await this.plugin.saveData(next); text.setValue(next.characterFolder); } catch { text.setValue(this.plugin.settings.characterFolder); new Notice('Invalid character folder. Use a vault-relative path.'); }
    }));
    new Setting(this.containerEl).setName('Local source path').setDesc(`${resolvePluginDirectory(this.plugin.manifest, normalizePath(this.app.vault.configDir))}/sources/packs/_source/`);
    const actionButtons: Array<{ setDisabled(disabled: boolean): unknown }> = [];
    const runAction = async (button: { setDisabled(disabled: boolean): unknown }, action: () => Promise<void>): Promise<void> => {
      if (this.plugin.busy) return;
      this.plugin.busy = true;
      actionButtons.forEach((item) => item.setDisabled(true));
      try { await action(); } finally { this.plugin.busy = false; actionButtons.forEach((item) => item.setDisabled(false)); }
    };
    new Setting(this.containerEl).setName('Download sources').addButton((button) => {
      actionButtons.push(button);
      button.setButtonText('Download sources').onClick(() => runAction(button, () => this.plugin.downloadSources()));
    });
    new Setting(this.containerEl).setName('Compare with online').addButton((button) => {
      actionButtons.push(button);
      button.setButtonText('Compare with online').onClick(() => runAction(button, () => this.plugin.compareWithOnline()));
    });
  }
}
