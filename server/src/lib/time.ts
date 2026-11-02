import { unprocessable } from './errors.js';

/** Study-day boundaries follow the learner's timezone (NFR localization). */
export function studyDay(epochMs: number, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(epochMs),
  );
}

export function assertValidTimezone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw unprocessable('INVALID_TIMEZONE', `Unknown timezone "${timeZone}"`);
  }
}

/** Last `days` study days ending today, oldest first. */
export function recentStudyDays(nowMs: number, timeZone: string, days: number): string[] {
  const result = new Set<string>();
  // Step in 12h increments so DST shifts never skip a calendar day.
  for (let offset = 0; result.size < days && offset < days * 3; offset++) {
    result.add(studyDay(nowMs - offset * 12 * 3600 * 1000, timeZone));
  }
  return [...result].slice(0, days).reverse();
}
