import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIRED_RETENTION,
  FSRS_45_FACTOR,
  FSRS_45_VERSION,
  formatIntervalPreview,
  intervalForRetention,
  retrievability,
  scheduleReview,
} from './fsrsScheduler';

describe('FSRS-4.5 deterministic scheduler', () => {
  it('uses the FSRS-4.5 forgetting curve constants', () => {
    expect(FSRS_45_FACTOR).toBeCloseTo(19 / 81, 12);
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 8);
    expect(intervalForRetention(10, DEFAULT_DESIRED_RETENTION)).toBeCloseTo(10, 8);
  });

  it('creates reproducible initial schedules and records the version', () => {
    const reviewedAt = new Date('2026-08-21T12:00:00Z');
    const first = scheduleReview({ promptId: 'p1', outcome: 'good', reviewedAt });
    const second = scheduleReview({ promptId: 'p1', outcome: 'good', reviewedAt });

    expect(first).toEqual(second);
    expect(first.schedule.fsrs_version).toBe(FSRS_45_VERSION);
    expect(first.schedule.desired_retention).toBe(0.9);
    expect(first.schedule.state).toBe('review');
  });

  it('treats hard as successful recall with a shorter interval than good', () => {
    const reviewedAt = new Date('2026-08-21T12:00:00Z');
    const hard = scheduleReview({ promptId: 'p1', outcome: 'hard', reviewedAt });
    const good = scheduleReview({ promptId: 'p1', outcome: 'good', reviewedAt });

    expect(hard.schedule.state).toBe('review');
    expect(hard.intervalDays).toBeLessThan(good.intervalDays);
  });

  it('moves again cards to relearning and keeps the next due date near-term', () => {
    const result = scheduleReview({ promptId: 'p1', outcome: 'again', reviewedAt: new Date('2026-08-21T12:00:00Z') });

    expect(result.schedule.state).toBe('relearning');
    expect(result.intervalDays).toBe(1);
    expect(result.schedule.last_outcome).toBe('again');
  });

  it('formats interval previews for review buttons', () => {
    expect(formatIntervalPreview(1)).toBe('1 day');
    expect(formatIntervalPreview(12)).toBe('12 days');
    expect(formatIntervalPreview(45)).toBe('2 months');
  });
});

