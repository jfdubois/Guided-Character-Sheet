export interface SourceManifestEntry {
  remoteSha: string;
  localSha256: string;
}

export interface ComparisonResult {
  unchanged: string[];
  locallyModified: string[];
  onlineChanged: string[];
  addedOnline: string[];
  removedOnline: string[];
  notDownloaded: string[];
}

export function compareSources(
  online: Map<string, string>,
  manifest: Map<string, SourceManifestEntry>,
  local: Map<string, string>,
): ComparisonResult {
  const result: ComparisonResult = {
    unchanged: [],
    locallyModified: [],
    onlineChanged: [],
    addedOnline: [],
    removedOnline: [],
    notDownloaded: [],
  };

  const paths = new Set([...online.keys(), ...manifest.keys()]);
  for (const path of paths) {
    const remoteSha = online.get(path);
    const entry = manifest.get(path);

    if (entry === undefined) {
      result.addedOnline.push(path);
      continue;
    }
    if (remoteSha === undefined) {
      result.removedOnline.push(path);
      continue;
    }

    const localSha256 = local.get(path);
    if (localSha256 === undefined) {
      result.notDownloaded.push(path);
      continue;
    }

    const remoteMatches = remoteSha === entry.remoteSha;
    const localMatches = localSha256 === entry.localSha256;
    if (remoteMatches && localMatches) result.unchanged.push(path);
    if (!remoteMatches) result.onlineChanged.push(path);
    if (!localMatches) result.locallyModified.push(path);
  }

  for (const pathsToSort of Object.values(result)) pathsToSort.sort();
  return result;
}
