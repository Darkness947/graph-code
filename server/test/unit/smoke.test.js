import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../../src/server.js';

describe('server skeleton', () => {
  it('builds an Express app that answers requests', async () => {
    const res = await request(createServer()).get('/anything');
    expect(res.status).toBe(404);
  });
});
