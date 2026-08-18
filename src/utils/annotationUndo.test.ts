import { describe, expect, it } from 'vitest';
import { AnnotationUndoManager, AnnotationUndoAction } from './annotationUndo';

describe('AnnotationUndoManager (FR-9.8 in-session undo)', () => {
  it('records create/edit/trash actions and pops them LIFO', () => {
    const manager = new AnnotationUndoManager();
    manager.pushCreate('a1');
    manager.pushEdit('a2', { color: 'claim', comment: 'old', tags: ['x'] });
    manager.pushTrash('a3');

    expect(manager.size).toBe(3);
    expect(manager.canUndo).toBe(true);

    const first = manager.pop();
    expect(first).toEqual({ kind: 'trash', annotationId: 'a3' });
    const second = manager.pop();
    expect(second).toEqual({ kind: 'edit', annotationId: 'a2', previous: { color: 'claim', comment: 'old', tags: ['x'] } });
    const third = manager.pop();
    expect(third).toEqual({ kind: 'create', annotationId: 'a1' });
    expect(manager.pop()).toBeNull();
    expect(manager.canUndo).toBe(false);
  });

  it('bounded stack evicts the oldest action first', () => {
    const manager = new AnnotationUndoManager({ limit: 3 });
    for (let i = 0; i < 5; i++) manager.pushCreate(`a${i}`);
    expect(manager.size).toBe(3);
    // a0 and a1 were evicted.
    const popped: string[] = [];
    let action = manager.pop();
    while (action) {
      popped.push(action.annotationId);
      action = manager.pop();
    }
    expect(popped).toEqual(['a4', 'a3', 'a2']);
  });

  it('peek does not remove; replay re-pushes after a failed inverse', () => {
    const manager = new AnnotationUndoManager();
    const action: AnnotationUndoAction = { kind: 'create', annotationId: 'a9' };
    manager.push(action);
    expect(manager.peek()).toEqual(action);
    expect(manager.size).toBe(1);
    const popped = manager.pop();
    expect(popped).toEqual(action);
    expect(manager.size).toBe(0);
    manager.replay(action);
    expect(manager.size).toBe(1);
    expect(manager.peek()).toEqual(action);
  });

  it('clear empties the stack', () => {
    const manager = new AnnotationUndoManager();
    manager.pushCreate('a');
    manager.clear();
    expect(manager.canUndo).toBe(false);
    expect(manager.size).toBe(0);
  });

  it('helper push methods build the right action shapes', () => {
    const manager = new AnnotationUndoManager();
    manager.pushTrash('t');
    expect(manager.peek()).toEqual({ kind: 'trash', annotationId: 't' });
  });
});
