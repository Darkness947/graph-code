import { describe, it, expect } from 'vitest';
import { mapRepository, mapJob } from '../../src/services/repos/repositoryService.js';

const row = {
  id: 'r1',
  owner: 'vercel',
  name: 'next-learn',
  display_name: 'vercel/next-learn',
  status: 'ready',
  file_count: 214,
  edge_count: 388,
  language_summary: { ts: 180 },
  last_ingested_at: new Date('2026-11-12T10:00:00Z'),
  ingestion_ms: 9120,
  job_id: 'j1',
  job_status: 'succeeded',
  job_phase: 'persisting',
  files_total: 340,
  files_processed: 142,
  files_skipped: 0,
  error_code: null,
  error_message: null,
  report: { skippedFiles: [], unresolvedCount: 12 },
};

describe('repository mappers', () => {
  it('maps a row to the Repository shape (spec 6.2)', () => {
    expect(mapRepository(row)).toEqual({
      id: 'r1',
      owner: 'vercel',
      name: 'next-learn',
      displayName: 'vercel/next-learn',
      status: 'ready',
      fileCount: 214,
      edgeCount: 388,
      languageSummary: { ts: 180 },
      lastIngestedAt: '2026-11-12T10:00:00.000Z',
      ingestionMs: 9120,
      latestJob: {
        id: 'j1',
        status: 'succeeded',
        phase: 'persisting',
        filesTotal: 340,
        filesProcessed: 142,
        filesSkipped: 0,
        errorCode: null,
        errorMessage: null,
        report: { skippedFiles: [], unresolvedCount: 12 },
      },
    });
  });

  it('has no latestJob and null timestamps when there is no job', () => {
    const r = mapRepository({ ...row, job_id: null, last_ingested_at: null });
    expect(r.latestJob).toBeNull();
    expect(r.lastIngestedAt).toBeNull();
    expect(mapJob({ job_id: null })).toBeNull();
  });
});
