import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  createTokenCrypto,
  tokenCryptoFromConfig,
  getUserToken,
} from '../../src/services/auth/tokenCrypto.js';

const key1 = randomBytes(32);
const key2 = randomBytes(32);

describe('tokenCrypto', () => {
  const crypto = createTokenCrypto({ 1: key1 }, 1);

  it('round-trips a token and stores iv || tag || ciphertext', () => {
    const { enc, keyId } = crypto.encrypt('gho_exampletoken');
    expect(keyId).toBe(1);
    expect(enc.length).toBe(12 + 16 + Buffer.byteLength('gho_exampletoken'));
    expect(enc.includes(Buffer.from('gho_exampletoken'))).toBe(false);
    expect(crypto.decrypt(enc, 1)).toBe('gho_exampletoken');
  });

  it('uses a fresh IV every time', () => {
    const a = crypto.encrypt('same').enc;
    const b = crypto.encrypt('same').enc;
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it.each([
    ['iv', 0],
    ['auth tag', 12],
    ['ciphertext', 28],
  ])('throws when the %s is tampered with', (_part, offset) => {
    const { enc } = crypto.encrypt('gho_exampletoken');
    const bad = Buffer.from(enc);
    bad[offset] ^= 0x01;
    expect(() => crypto.decrypt(bad, 1)).toThrow();
  });

  it('throws on a truncated value, a wrong key and an unknown key ID', () => {
    const { enc } = crypto.encrypt('x');
    expect(() => crypto.decrypt(enc.subarray(0, 20), 1)).toThrow();
    expect(() => createTokenCrypto({ 1: key2 }, 1).decrypt(enc, 1)).toThrow();
    expect(() => crypto.decrypt(enc, 9)).toThrow(/Unknown/);
  });

  it('supports rotation: old tokens decrypt with their own key ID', () => {
    const old = crypto.encrypt('old-token');
    const rotated = createTokenCrypto({ 1: key1, 2: key2 }, 2);
    expect(rotated.encrypt('new').keyId).toBe(2);
    expect(rotated.decrypt(old.enc, old.keyId)).toBe('old-token');
  });

  it('rejects keys of the wrong size and a missing current key', () => {
    expect(() => createTokenCrypto({ 1: randomBytes(16) }, 1)).toThrow();
    expect(() => createTokenCrypto({ 1: key1 }, 2)).toThrow();
  });

  it('builds from the validated configuration', () => {
    const c = tokenCryptoFromConfig({
      TOKEN_ENCRYPTION_KEY: key1.toString('base64'),
      TOKEN_KEY_ID: 1,
    });
    expect(c.decrypt(crypto.encrypt('t').enc, 1)).toBe('t');
  });
});

describe('getUserToken', () => {
  const crypto = createTokenCrypto({ 1: key1 }, 1);
  const poolReturning = (rows) => ({ query: async () => ({ rows }) });

  it('decrypts the stored token', async () => {
    const { enc, keyId } = crypto.encrypt('gho_abc');
    const pool = poolReturning([{ access_token_enc: enc, token_key_id: keyId }]);
    expect(await getUserToken(pool, crypto, 'u-1')).toBe('gho_abc');
  });

  it('returns null for an unknown user or a user without a token', async () => {
    expect(await getUserToken(poolReturning([]), crypto, 'u-1')).toBeNull();
    const none = poolReturning([{ access_token_enc: null, token_key_id: 1 }]);
    expect(await getUserToken(none, crypto, 'u-1')).toBeNull();
  });

  it('throws when the stored value was tampered with', async () => {
    const { enc, keyId } = crypto.encrypt('gho_abc');
    enc[enc.length - 1] ^= 1;
    const pool = poolReturning([{ access_token_enc: enc, token_key_id: keyId }]);
    await expect(getUserToken(pool, crypto, 'u-1')).rejects.toThrow();
  });
});
