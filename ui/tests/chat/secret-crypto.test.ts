// ui/tests/chat/secret-crypto.test.ts
// Test runner: `node --test` (Node 22+) with --experimental-strip-types.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import { encrypt, decrypt, _getKey, SecretCryptoError } from '../../src/lib/chat/secret-crypto.ts';

const KEY = 'a'.repeat(64);  // 64-char; SHA-256 derives 32 bytes

test('round-trip simple string', () => {
  const ct = encrypt('sk-ant-test-1234', KEY);
  assert.ok(typeof ct === 'string' && ct.length > 0);
  assert.equal(decrypt(ct, KEY), 'sk-ant-test-1234');
});

test('round-trip empty string', () => {
  const ct = encrypt('', KEY);
  assert.equal(decrypt(ct, KEY), '');
});

test('round-trip unicode + long string (>1KB)', () => {
  const long = '中文字符串 ' + 'x'.repeat(2000);
  const ct = encrypt(long, KEY);
  assert.equal(decrypt(ct, KEY), long);
});

test('each encrypt produces different ciphertext (random IV)', () => {
  const a = encrypt('hello', KEY);
  const b = encrypt('hello', KEY);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, KEY), decrypt(b, KEY));
});

test('decrypt with wrong key throws SecretCryptoError', () => {
  const ct = encrypt('secret', KEY);
  assert.throws(() => decrypt(ct, KEY + 'x'), SecretCryptoError);
});

test('decrypt with tampered ciphertext throws', () => {
  const ct = encrypt('secret', KEY);
  // Flip a character in the middle
  const tampered = ct.slice(0, 20) + (ct[20] === 'A' ? 'B' : 'A') + ct.slice(21);
  assert.throws(() => decrypt(tampered, KEY), SecretCryptoError);
});

test('short encryption key throws on use', () => {
  assert.throws(() => encrypt('x', 'short'), SecretCryptoError);
});
