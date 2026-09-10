import { describe, expect, it } from 'vitest';
import { assertR3R4RecoveryGate, assertWalRecovery, runR3R4RecoveryGate } from './r3r4RecoveryGate';

describe('R3/R4 responsiveness and recovery gate', () => {
  it('measures autosave, search, export, backup, and FSRS budgets', async () => {
    const report = await runR3R4RecoveryGate();
    assertR3R4RecoveryGate(report);
    expect(report.autosaveMedianMs).toBeLessThanOrEqual(50);
    expect(report.noteSearchMedianMs).toBeLessThan(300);
    expect(report.cancellationSafe).toBe(true);
    expect(report.recoverySafe).toBe(true);
  });

  it('asserts real WAL recovery behavior via assertWalRecovery', async () => {
    const safe = await assertWalRecovery();
    expect(safe).toBe(true);
  });
});

