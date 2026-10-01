import { isRecord } from './foundry-utils';

export type FoundryScaleValue =
  | { type: 'number'; value: number }
  | { type: 'dice'; number: number | null; faces: number; modifiers: string[] }
  | { type: 'distance'; value: number; units: string };

export function readFoundryScaleValue(type: unknown, raw: unknown, distanceUnits?: unknown): FoundryScaleValue | undefined {
  if (!isRecord(raw)) return undefined;
  if (type === 'number' && typeof raw.value === 'number' && Number.isFinite(raw.value)) {
    return { type, value: raw.value };
  }
  const diceNumber = raw.number;
  if (type === 'dice' && (diceNumber === null || (typeof diceNumber === 'number' && Number.isInteger(diceNumber) && diceNumber >= 0))
    && typeof raw.faces === 'number' && Number.isInteger(raw.faces) && raw.faces > 0
    && Array.isArray(raw.modifiers) && raw.modifiers.every((modifier) => typeof modifier === 'string')) {
    return { type, number: diceNumber, faces: raw.faces, modifiers: [...raw.modifiers] };
  }
  if (type === 'distance' && typeof raw.value === 'number' && Number.isFinite(raw.value)
    && (distanceUnits === undefined || typeof distanceUnits === 'string')) {
    return { type, value: raw.value, units: distanceUnits || 'ft' };
  }
  return undefined;
}

export function formatFoundryIdentifier(title: string): string | undefined {
  const formatted = title.replaceAll(/(\w+)([\\|/])(\w+)/g, '$1-$3')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return formatted.length > 0 ? formatted : undefined;
}
