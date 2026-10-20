import { describe, expect, it } from 'vitest';
import { formatFoundryIdentifier, readFoundryScaleValue } from '../src/foundry-scale-value';

describe('Foundry scale values', () => {
  it('reads supported typed values without coercion', () => {
    expect(readFoundryScaleValue('number', { value: 2 })).toEqual({ type: 'number', value: 2 });
    expect(readFoundryScaleValue('cr', { value: 0.25 })).toEqual({ type: 'cr', value: 0.25 });
    expect(readFoundryScaleValue('dice', { number: 1, faces: 6, modifiers: [] })).toEqual({ type: 'dice', number: 1, faces: 6, modifiers: [] });
    expect(readFoundryScaleValue('distance', { value: 10 }, 'ft')).toEqual({ type: 'distance', value: 10, units: 'ft' });
  });

  it('preserves a null dice count from the pinned Foundry schema', () => {
    expect(readFoundryScaleValue('dice', { number: null, faces: 6, modifiers: [] })).toEqual({ type: 'dice', number: null, faces: 6, modifiers: [] });
  });

  it('uses Foundry’s default feet unit when distance units are empty or absent', () => {
    expect(readFoundryScaleValue('distance', { value: 10 }, '')).toEqual({ type: 'distance', value: 10, units: 'ft' });
    expect(readFoundryScaleValue('distance', { value: 10 })).toEqual({ type: 'distance', value: 10, units: 'ft' });
  });

  it('formats a title using the pinned Foundry identifier convention', () => {
    expect(formatFoundryIdentifier('Sneak Attack')).toBe('sneak-attack');
    expect(formatFoundryIdentifier('')).toBeUndefined();
  });

  it('rejects malformed typed values rather than coercing them', () => {
    expect(readFoundryScaleValue('number', { value: '2' })).toBeUndefined();
    expect(readFoundryScaleValue('dice', { number: 1, faces: '6', modifiers: [] })).toBeUndefined();
    expect(readFoundryScaleValue('distance', { value: 10 }, 6)).toBeUndefined();
    expect(readFoundryScaleValue('cr', { value: -1 })).toBeUndefined();
    expect(readFoundryScaleValue('unknown', { value: 2 })).toBeUndefined();
  });
});
