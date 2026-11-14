import { describe, it, expect, vi } from 'vitest';
import { createQueue } from '../../src/services/ingestion/queue.js';

/** A run function whose calls stay pending until released; records the start order. */
function controlledRun() {
  const started = [];
  const release = new Map();
  const run = (jobId) =>
    new Promise((resolve) => {
      started.push(jobId);
      release.set(jobId, resolve);
    });
  return { run, started, release: (id) => release.get(id)() };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createQueue', () => {
  it('rejects a concurrency below 1', () => {
    expect(() => createQueue({ concurrency: 0, run: vi.fn() })).toThrow();
  });

  it('runs jobs in FIFO order, one at a time with concurrency 1', async () => {
    const c = controlledRun();
    const queue = createQueue({ concurrency: 1, run: c.run });
    ['a', 'b', 'c'].forEach(queue.enqueue);
    await tick();
    expect(c.started).toEqual(['a']);

    c.release('a');
    await tick();
    expect(c.started).toEqual(['a', 'b']);
    c.release('b');
    await tick();
    c.release('c');
    await queue.idle();
    expect(c.started).toEqual(['a', 'b', 'c']);
  });

  it('never runs more than the concurrency limit at once', async () => {
    const c = controlledRun();
    const queue = createQueue({ concurrency: 2, run: c.run });
    ['a', 'b', 'c', 'd'].forEach(queue.enqueue);
    await tick();
    expect(c.started).toEqual(['a', 'b']);
    c.release('b');
    await tick();
    expect(c.started).toEqual(['a', 'b', 'c']);
    for (const id of ['a', 'c']) c.release(id);
    await tick();
    c.release('d');
    await queue.idle();
  });

  it('logs a crashed run and keeps going', async () => {
    const logger = { error: vi.fn() };
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const queue = createQueue({ concurrency: 1, run, logger });
    queue.enqueue('a');
    queue.enqueue('b');
    await queue.idle();
    expect(run.mock.calls).toEqual([['a'], ['b']]);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Ingestion job a crashed: boom');
  });

  it('also survives a run that throws synchronously', async () => {
    const logger = { error: vi.fn() };
    const run = vi.fn((id) => {
      if (id === 'a') throw new Error('sync');
      return Promise.resolve();
    });
    const queue = createQueue({ concurrency: 1, run, logger });
    queue.enqueue('a');
    queue.enqueue('b');
    await queue.idle();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('idle resolves immediately when empty', async () => {
    await expect(createQueue({ concurrency: 1, run: vi.fn() }).idle()).resolves.toBeUndefined();
  });
});
