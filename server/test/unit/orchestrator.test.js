import { describe, it, expect, vi } from 'vitest';
import {
  IngestionOrchestrator,
  PHASES,
  PLACEHOLDER_STEPS,
} from '../../src/services/ingestion/orchestrator.js';
import { IngestionError } from '../../src/services/ingestion/IngestionError.js';

const JOB = { id: 'job-1', repositoryId: 'repo-1', jobType: 'initial' };

function fakeJobs(over = {}) {
  return {
    start: vi.fn().mockResolvedValue(JOB),
    setPhase: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(true),
    ...over,
  };
}
const okSteps = () => Object.fromEntries(PHASES.map((p) => [p, vi.fn().mockResolvedValue()]));

describe('IngestionOrchestrator.run (unit)', () => {
  it('sets each phase before running its step, in order', async () => {
    const order = [];
    const jobs = fakeJobs({ setPhase: vi.fn(async (_id, p) => (order.push(`set:${p}`), true)) });
    const steps = Object.fromEntries(PHASES.map((p) => [p, async () => order.push(`run:${p}`)]));
    await new IngestionOrchestrator({ jobs, steps, logger: { error: vi.fn() } }).run('job-1');
    expect(order).toEqual(PHASES.flatMap((p) => [`set:${p}`, `run:${p}`]));
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('stops without failing when the job stops running mid-pipeline', async () => {
    const steps = okSteps();
    const jobs = fakeJobs({ setPhase: vi.fn(async (_id, p) => p !== 'parsing') });
    await new IngestionOrchestrator({ jobs, steps, logger: { error: vi.fn() } }).run('job-1');
    expect(steps.extracting).toHaveBeenCalled();
    expect(steps.parsing).not.toHaveBeenCalled();
    expect(jobs.fail).not.toHaveBeenCalled();
  });

  it('a database error while claiming the job fails it with INTERNAL', async () => {
    const logger = { error: vi.fn() };
    const jobs = fakeJobs({ start: vi.fn().mockRejectedValue(new Error('connection reset')) });
    await new IngestionOrchestrator({ jobs, steps: okSteps(), logger }).run('job-1');
    expect(jobs.fail).toHaveBeenCalledExactlyOnceWith('job-1', 'INTERNAL');
    expect(logger.error).toHaveBeenCalledWith(
      'Ingestion job job-1 failed in setup with INTERNAL: connection reset',
    );
  });

  it('a database error while setting the first phase fails with INTERNAL, not DOWNLOAD_FAILED', async () => {
    const jobs = fakeJobs({ setPhase: vi.fn().mockRejectedValue(new Error('db down')) });
    await new IngestionOrchestrator({ jobs, steps: okSteps(), logger: { error: vi.fn() } }).run(
      'job-1',
    );
    expect(jobs.fail).toHaveBeenCalledExactlyOnceWith('job-1', 'INTERNAL');
  });

  it('an IngestionError keeps its own code', async () => {
    const steps = okSteps();
    steps.extracting.mockRejectedValue(new IngestionError('NO_SUPPORTED_FILES'));
    const jobs = fakeJobs();
    await new IngestionOrchestrator({ jobs, steps, logger: { error: vi.fn() } }).run('job-1');
    expect(jobs.fail).toHaveBeenCalledExactlyOnceWith('job-1', 'NO_SUPPORTED_FILES');
  });

  it('never rejects, even when recording the failure fails', async () => {
    const logger = { error: vi.fn() };
    const steps = okSteps();
    steps.fetching.mockRejectedValue(new Error('timeout'));
    const jobs = fakeJobs({ fail: vi.fn().mockRejectedValue(new Error('db down')) });
    await expect(
      new IngestionOrchestrator({ jobs, steps, logger }).run('job-1'),
    ).resolves.toBeUndefined();
    expect(jobs.fail).toHaveBeenCalledWith('job-1', 'DOWNLOAD_FAILED');
    expect(logger.error).toHaveBeenLastCalledWith(
      'Ingestion job job-1: could not record failure: db down',
    );
  });

  it('placeholder steps fail in fetching with INTERNAL', async () => {
    const jobs = fakeJobs();
    await new IngestionOrchestrator({ jobs, logger: { error: vi.fn() } }).run('job-1');
    expect(Object.keys(PLACEHOLDER_STEPS)).toEqual(PHASES);
    expect(jobs.fail).toHaveBeenCalledExactlyOnceWith('job-1', 'INTERNAL');
  });

  it('rejects unknown ingestion codes', () => {
    expect(() => new IngestionError('NOPE')).toThrow('Unknown ingestion code: NOPE');
  });
});
