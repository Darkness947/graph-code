import { describe, expect, it } from 'vitest';
import { aiErrorIcon, aiErrorMessage, REMOVED_NOTE } from './messages.js';

describe('AI messages (spec 8.9)', () => {
  it.each([
    [
      'AI_QUOTA_EXCEEDED',
      'AI analysis is temporarily unavailable — try again in a moment.',
      'bi-clock',
    ],
    ['AI_TIMEOUT', 'The AI service took too long to respond. Try again.', 'bi-clock'],
    [
      'AI_UNREACHABLE',
      "Couldn't reach the AI service. Check your connection and try again.",
      'bi-plug',
    ],
    [
      'AI_MALFORMED',
      "Couldn't generate a reliable analysis for this file. Try again.",
      'bi-exclamation-triangle',
    ],
    ['GITHUB_UNAVAILABLE', "GitHub isn't responding right now. Try again in a moment.", 'bi-plug'],
    ['INTERNAL', 'Something went wrong. Try again.', 'bi-exclamation-triangle'],
  ])('%s', (code, message, icon) => {
    expect(aiErrorMessage(code)).toBe(message);
    expect(aiErrorIcon(code)).toBe(icon);
  });

  it('puts the wait into the rate-limit message', () => {
    expect(aiErrorMessage('RATE_LIMITED', 42)).toBe(
      "You're doing that too often. Try again in 42 seconds.",
    );
    expect(aiErrorIcon('RATE_LIMITED')).toBe('bi-clock');
  });

  it('falls back to the generic message for an unknown code', () => {
    expect(aiErrorMessage('NOT_FOUND')).toBe('Something went wrong. Try again.');
  });

  it('counts the removed files', () => {
    expect(REMOVED_NOTE(2)).toBe(
      "2 suggested file(s) were removed because they don't exist in this repository.",
    );
  });
});
