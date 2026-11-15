import { describe, expect, it } from 'vitest';
import { addErrorMessage, formatDate, phaseLabel, tierLine } from './messages.js';

describe('phaseLabel (spec 8.5)', () => {
  it.each([
    [{ phase: 'fetching' }, 'Downloading repository…'],
    [{ phase: 'extracting' }, 'Extracting files…'],
    [{ phase: 'parsing', filesProcessed: 142, filesTotal: 340 }, 'Parsing 142 / 340 files…'],
    [{ phase: 'resolving' }, 'Resolving imports…'],
    [{ phase: 'persisting' }, 'Saving graph…'],
  ])('%j -> %s', (job, label) => {
    expect(phaseLabel(job)).toBe(label);
  });
});

describe('tierLine', () => {
  it('has none up to 300 files, then the large and very large lines', () => {
    expect(tierLine(300)).toBeNull();
    expect(tierLine(301)).toBe('Large repository. This can take up to a minute.');
    expect(tierLine(700)).toBe('Large repository. This can take up to a minute.');
    expect(tierLine(701)).toBe('Very large repository. This can take a few minutes.');
  });
});

describe('addErrorMessage (spec 8.9)', () => {
  it('fills in the retry seconds', () => {
    expect(addErrorMessage({ code: 'RATE_LIMITED', retryAfterSeconds: 42 })).toBe(
      "You're doing that too often. Try again in 42 seconds.",
    );
  });
  it('falls back to the generic message', () => {
    expect(addErrorMessage({ code: 'WHATEVER' })).toBe('Something went wrong. Try again.');
  });
});

describe('formatDate (spec 8.5)', () => {
  it('uses three-letter months, including September, and zero-padded time', () => {
    const local = new Date(2026, 8, 5, 9, 7).toISOString();
    expect(formatDate(local)).toBe('5 Sep 2026');
    expect(formatDate(local, { time: true })).toBe('5 Sep 2026, 09:07');
  });
});
