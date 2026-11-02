/**
 * All server time flows through a Clock so that timer rules (90-minute cap,
 * 20-minute break, heartbeat grace) are testable without waiting in real time.
 * The client clock is display-only (FOCUS-002).
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class FakeClock implements Clock {
  constructor(private current = Date.parse('2026-01-05T09:00:00.000Z')) {}

  now(): number {
    return this.current;
  }

  advanceSeconds(seconds: number): void {
    this.current += seconds * 1000;
  }

  advanceMinutes(minutes: number): void {
    this.advanceSeconds(minutes * 60);
  }
}

export const iso = (ms: number): string => new Date(ms).toISOString();
export const ms = (isoString: string): number => Date.parse(isoString);
