import { FileSystemAdapter, Notice, Plugin, normalizePath, requestUrl } from 'obsidian';
import { fetchSourceSnapshot, fetchSourceTree, type SourceTreeRequest } from './source-tree';
import { SourceStore, sourceUrl, createFileSystemAdapter } from './source-store';
import { GuidedCharacterSheetSettingTab, type SettingsActions } from './settings';
import { DEFAULT_SETTINGS, formatComparisonNotice, validateSettings, type GuidedCharacterSheetSettings } from './settings-model';
import { OperationMutex } from './operation-mutex';
import { resolvePluginDirectory } from './plugin-path';
import { CharacterView, CHARACTER_VIEW_TYPE } from './character-view';
import { createSourceIndex, createSourceReader, type SourceIndex, type SourceReader } from './character-sources';
import { CharacterStore } from './character-store';

export default class GuidedCharacterSheetPlugin extends Plugin implements SettingsActions {
  settings!: GuidedCharacterSheetSettings;
  private store!: SourceStore;
  private sourceReader!: SourceReader;
  private sourceIndex!: SourceIndex;
  private characterStore!: CharacterStore;
  private readonly operations = new OperationMutex();
  async onload(): Promise<void> {
    const saved = await this.loadData();
    try { this.settings = validateSettings({ ...DEFAULT_SETTINGS, ...(saved && typeof saved === 'object' ? saved : {}) }); } catch { this.settings = { ...DEFAULT_SETTINGS }; }
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) throw new Error('This plugin requires Obsidian desktop storage.');
    const filesystem = adapter;
    const pluginDirectory = resolvePluginDirectory(this.manifest, normalizePath(this.app.vault.configDir));
    const sourceAdapter = createFileSystemAdapter(filesystem);
    this.store = new SourceStore(sourceAdapter, pluginDirectory);
    this.sourceReader = createSourceReader(sourceAdapter, `${pluginDirectory}/sources`);
    this.sourceIndex = createSourceIndex(sourceAdapter, `${pluginDirectory}/sources`, {
      lookupAdapter: sourceAdapter,
      lookupPath: `${pluginDirectory}/source-uuid-lookup.json`,
      snapshot: () => this.store.readSnapshot(this.request()),
    });
    this.characterStore = new CharacterStore(this.app.vault, this.settings.characterFolder);
    this.registerView(CHARACTER_VIEW_TYPE, (leaf) => new CharacterView(leaf, this.characterStore, this.sourceReader, this.sourceIndex));
    this.addCommand({ id: 'create-new-character', name: 'Create new character', callback: () => { void this.createNewCharacter(); } });
    this.addCommand({ id: 'open-character-sheet', name: 'Open character sheet', callback: () => { void this.openCharacterSheet(); } });
    this.addSettingTab(new GuidedCharacterSheetSettingTab(this.app, this));
  }

  async createNewCharacter(name = 'New character'): Promise<void> {
    try {
      const snapshot = await this.store.readSnapshot(this.request());
      const file = await this.characterStore.create(name, snapshot);
      await this.openCharacterFile(file, 'create');
    } catch (error) { new Notice(`Create character failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  async openCharacterSheet(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (file !== null) {
      try { await this.characterStore.read(file); await this.openCharacterFile(file, 'open'); return; } catch { /* show the character picker below */ }
    }
    await this.openCharacterPicker();
  }

  private async openCharacterFile(file: import('obsidian').TFile, mode: 'create' | 'open'): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) throw new Error('No workspace leaf is available.');
    await leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: { mode, filePath: file.path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async openCharacterPicker(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf === null) throw new Error('No workspace leaf is available.');
    await leaf.setViewState({ type: CHARACTER_VIEW_TYPE, state: { mode: 'open' }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }


  async downloadSources(): Promise<void> { return this.operations.run(() => this.run('Download sources', async () => { const request = this.request(); const snapshot = await fetchSourceSnapshot(request, async (url) => (await requestUrl({ url })).json, async (url) => (await requestUrl({ url })).text); const entries = await fetchSourceTree(request, async (url) => (await requestUrl({ url })).json); const notice = new Notice(`Downloading sources: 0/${entries.length}`, 0); try { await this.store.download(request, entries, snapshot, async (entry) => (await requestUrl({ url: sourceUrl(request, entry) })).arrayBuffer, { onProgress: (completed, total) => notice.setMessage(`Downloading sources: ${completed}/${total}`) }); new Notice(`Downloaded ${entries.length} source files.`); } finally { notice.hide(); } })); }
  async compareWithOnline(): Promise<void> { return this.operations.run(() => this.run('Compare with online', async () => { const request = this.request(); const entries = await fetchSourceTree(request, async (url) => (await requestUrl({ url })).json); new Notice(formatComparisonNotice(await this.store.compare(request, entries))); })); }
  private request(): SourceTreeRequest { return { owner: this.settings.owner, repo: this.settings.repo, branch: this.settings.branch, prefix: 'packs/_source/' }; }
  private async run(name: string, action: () => Promise<void>): Promise<void> { try { await action(); } catch (error) { new Notice(`${name} failed: ${error instanceof Error ? error.message : String(error)}`); } }

  onunload(): void {}
}
