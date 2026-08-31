import { describe, expect, it, vi } from 'vitest';
import { PendingWorkCoordinator } from './pendingWork';

describe('PendingWorkCoordinator', () => {
  it('waits for all registered work and shares duplicate barriers', async () => {
    const coordinator = new PendingWorkCoordinator();
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    coordinator.register('note', first);
    coordinator.register('session', second);
    const a = coordinator.flushAll();
    const b = coordinator.flushAll();
    expect(a).toBe(b);
    await a;
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('rejects the barrier when required persistence fails', async () => {
    const coordinator = new PendingWorkCoordinator();
    coordinator.register('note', async () => { throw new Error('disk full'); });
    await expect(coordinator.flushAll()).rejects.toThrow('disk full');
  });
});
