import { describe, it, expect } from 'vitest';
import { databaseIdentity } from '../helpers/db.js';

describe('databaseIdentity (guards the test-database reset)', () => {
  it('treats pooled and direct hosts of the same database as identical', () => {
    const direct = 'postgresql://u:p@ep-abc-123.eu-central-1.aws.neon.tech/neondb?sslmode=require';
    const pooled =
      'postgresql://u:p@ep-abc-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&x=1';
    expect(databaseIdentity(direct)).toBe(databaseIdentity(pooled));
  });

  it('distinguishes different endpoints and different database names', () => {
    const a = 'postgresql://u:p@ep-aaa.eu-central-1.aws.neon.tech/neondb';
    const b = 'postgresql://u:p@ep-bbb.eu-central-1.aws.neon.tech/neondb';
    const c = 'postgresql://u:p@ep-aaa.eu-central-1.aws.neon.tech/other';
    expect(databaseIdentity(a)).not.toBe(databaseIdentity(b));
    expect(databaseIdentity(a)).not.toBe(databaseIdentity(c));
  });

  it('is case-insensitive on the host and returns null for unparseable URLs', () => {
    expect(databaseIdentity('postgresql://u:p@EP-AAA.neon.tech/neondb')).toBe(
      databaseIdentity('postgresql://u:p@ep-aaa.neon.tech/neondb'),
    );
    expect(databaseIdentity('not a url')).toBeNull();
  });
});
