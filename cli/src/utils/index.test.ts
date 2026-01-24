import { describe, it, expect } from 'vitest';
import { isNonEmptyString } from './index.js';

describe('isNonEmptyString', () => {
  it('returns true for non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true);
    expect(isNonEmptyString('a')).toBe(true);
    expect(isNonEmptyString(' ')).toBe(true);
  });

  it('returns false for empty strings', () => {
    expect(isNonEmptyString('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(123)).toBe(false);
    expect(isNonEmptyString([])).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
  });
});
