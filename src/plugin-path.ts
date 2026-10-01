export interface PluginPathManifest {
  id: string;
  dir?: string;
}

export function resolvePluginDirectory(manifest: PluginPathManifest, configDir: string): string {
  // `manifest.dir` can be an absolute host path in a running desktop vault.
  // The stable Obsidian vault path is configDir/plugins/<id>; keeping this
  // relative to the vault prevents the filesystem adapter from prefixing an
  // absolute path a second time.
  return `${configDir}/plugins/${manifest.id}`;
}
