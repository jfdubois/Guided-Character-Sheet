export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === 'string' ? [entry] : isRecord(entry) && typeof entry.uuid === 'string' ? [entry.uuid] : [])
    : [];
}
