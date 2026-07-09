// agent/src/crypto/secret-crypto.ts
// AES-256-GCM encryption for agent.config.encrypted_key.
// - Key derived from AGENT_CRED_ENCRYPTION_KEY env (any length string).
// - IV is 12 bytes random per encrypt() call.
// - Output format: base64( IV(12) || authTag(16) || ciphertext(N) )
//
// authTag verified on decrypt; tampered ciphertexts throw.
// Originally copied from ui/src/lib/chat/secret-crypto.ts (same algorithm)
// in Phase 1 of the Agent config consolidation plan.
// IMPORTANT: keep API parity with the UI module so a key stored by either
// side can be read by the other (same encryption key + same algorithm).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export class SecretCryptoError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SecretCryptoError';
  }
}

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const MIN_KEY_LEN = 16;

function deriveKey(userKey: string): Buffer {
  if (userKey.length < MIN_KEY_LEN) {
    throw new SecretCryptoError(`Encryption key too short (min ${MIN_KEY_LEN} chars)`);
  }
  return createHash('sha256').update(userKey, 'utf-8').digest();
}

export function encrypt(plaintext: string, userKey: string): string {
  if (!userKey) throw new SecretCryptoError('Encryption key required');
  const key = deriveKey(userKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(ciphertext: string, userKey: string): string {
  if (!userKey) throw new SecretCryptoError('Encryption key required');
  const key = deriveKey(userKey);
  let buf: Buffer;
  try {
    buf = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new SecretCryptoError('Invalid base64 ciphertext');
  }
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new SecretCryptoError('Ciphertext too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf-8');
  } catch (e) {
    throw new SecretCryptoError('Decrypt failed (wrong key or tampered ciphertext)');
  }
}

// Internal: exposed for testability only
export function _getKey(userKey: string): Buffer { return deriveKey(userKey); }
