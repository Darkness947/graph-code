import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../../errors/AppError.js';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * AES-256-GCM token encryption (spec 7.3). Stored layout: iv || authTag || ciphertext.
 * A key map lets keys be rotated: new tokens use `currentKeyId`, old ones keep their key ID.
 * @param {Record<number, Buffer>} keys key ID -> 32-byte key
 * @param {number} currentKeyId
 */
export function createTokenCrypto(keys, currentKeyId) {
  for (const [id, key] of Object.entries(keys)) {
    if (!Buffer.isBuffer(key) || key.length !== 32) {
      throw new Error(`Encryption key ${id} must be 32 bytes`);
    }
  }
  if (!keys[currentKeyId]) throw new Error('The current encryption key ID has no key');

  return {
    currentKeyId,
    /**
     * @param {string} plaintext
     * @returns {{ enc: Buffer, keyId: number }}
     */
    encrypt(plaintext) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', keys[currentKeyId], iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return { enc: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), keyId: currentKeyId };
    },
    /**
     * Throws if the value was tampered with, is too short, or the key is wrong or unknown.
     * @param {Buffer} enc
     * @param {number} keyId
     * @returns {string}
     */
    decrypt(enc, keyId) {
      const key = keys[keyId];
      if (!key) throw new Error('Unknown token key ID');
      if (!Buffer.isBuffer(enc) || enc.length < IV_LENGTH + TAG_LENGTH) {
        throw new Error('Stored token is malformed');
      }
      const iv = enc.subarray(0, IV_LENGTH);
      const tag = enc.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const data = enc.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },
  };
}

/**
 * Builds the crypto helper from the validated configuration.
 * @param {{ TOKEN_ENCRYPTION_KEY: string, TOKEN_KEY_ID: number }} config
 */
export function tokenCryptoFromConfig(config) {
  return createTokenCrypto(
    { [config.TOKEN_KEY_ID]: Buffer.from(config.TOKEN_ENCRYPTION_KEY, 'base64') },
    config.TOKEN_KEY_ID,
  );
}

/**
 * Returns the user's decrypted GitHub token, or null when the user or token is missing.
 * @param {import('pg').Pool} pool
 * @param {ReturnType<typeof createTokenCrypto>} crypto
 * @param {string} userId
 * @returns {Promise<string | null>}
 */
export async function getUserToken(pool, crypto, userId) {
  const { rows } = await pool.query(
    'SELECT access_token_enc, token_key_id FROM users WHERE id = $1',
    [userId],
  );
  if (rows.length === 0 || !rows[0].access_token_enc) return null;
  return crypto.decrypt(rows[0].access_token_enc, rows[0].token_key_id);
}

/**
 * Like getUserToken, but throws UNAUTHENTICATED when the user has no usable token.
 * @param {import('pg').Pool} pool
 * @param {ReturnType<typeof createTokenCrypto>} crypto
 * @param {string} userId
 * @returns {Promise<string>}
 */
export async function requireUserToken(pool, crypto, userId) {
  const token = await getUserToken(pool, crypto, userId);
  if (!token) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.');
  return token;
}
