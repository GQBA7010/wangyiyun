import { describe, expect, it } from 'vitest'
import {
  decryptString,
  encryptString,
  hashPassword,
  isEncrypted,
  randomId,
  randomSecret,
  signToken,
  verifyPassword,
  verifyToken,
} from './crypto.js'

const SECRET = 'unit-test-secret-please-ignore'

describe('password hashing', () => {
  it('hashes into a self-describing scrypt string and verifies', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
  })

  it('rejects a wrong password and malformed hashes', () => {
    const hash = hashPassword('s3cret-password')
    expect(verifyPassword('wrong-password', hash)).toBe(false)
    expect(verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(verifyPassword('x', null)).toBe(false)
  })

  it('produces a distinct hash each time (random salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })
})

describe('symmetric encryption (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const cipher = encryptString('MUSIC_U=abc123; __csrf=def', SECRET)
    expect(isEncrypted(cipher)).toBe(true)
    expect(cipher).not.toContain('MUSIC_U=abc123')
    expect(decryptString(cipher, SECRET)).toBe('MUSIC_U=abc123; __csrf=def')
  })

  it('returns empty when decrypting with the wrong secret', () => {
    const cipher = encryptString('top secret', SECRET)
    expect(decryptString(cipher, 'a-different-secret')).toBe('')
  })

  it('passes plaintext through untouched', () => {
    expect(isEncrypted('plain')).toBe(false)
    expect(decryptString('plain', SECRET)).toBe('plain')
    expect(encryptString('', SECRET)).toBe('')
  })
})

describe('signed session tokens (HMAC)', () => {
  it('signs and verifies a payload', () => {
    const exp = Date.now() + 60_000
    const token = signToken({ sub: 'acc-1', exp }, SECRET)
    const payload = verifyToken(token, SECRET)
    expect(payload?.sub).toBe('acc-1')
  })

  it('rejects tampered tokens, wrong secrets and expired payloads', () => {
    const token = signToken({ sub: 'acc-1', exp: Date.now() + 60_000 }, SECRET)
    expect(verifyToken(token + 'x', SECRET)).toBeNull()
    expect(verifyToken(token, 'other-secret')).toBeNull()
    const expired = signToken({ sub: 'acc-1', exp: Date.now() - 1 }, SECRET)
    expect(verifyToken(expired, SECRET)).toBeNull()
    expect(verifyToken('garbage', SECRET)).toBeNull()
  })
})

describe('random generators', () => {
  it('produce unique hex values of the expected length', () => {
    expect(randomId()).toMatch(/^[0-9a-f]{24}$/)
    expect(randomSecret()).toMatch(/^[0-9a-f]{64}$/)
    expect(randomId()).not.toBe(randomId())
  })
})
