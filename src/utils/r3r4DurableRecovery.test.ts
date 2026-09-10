import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('R3/R4 Node durability probe', () => {
  it('recovers a draft across two child processes using fsync-backed atomic storage', () => {
    const script = join(process.cwd(), 'scripts/r3r4_durable_recovery_probe.mjs');
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 90_000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).durableRestartRecovery).toBe(true);
  }, 120_000);
});
