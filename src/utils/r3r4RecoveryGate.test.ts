import { describe, expect, it } from 'vitest';
import { assertR3R4RecoveryGate, runR3R4RecoveryGate } from './r3r4RecoveryGate';

describe('R3/R4 responsiveness and recovery gate', () => {
  it('measures autosave, search, export, backup, and FSRS budgets', () => {
    const report = runR3R4RecoveryGate();
    assertR3R4RecoveryGate(report);
    expect(report.noteSearchMedianMs).toBeLessThan(300);
    expect(report.cancellationSafe).toBe(true);
  });
});

