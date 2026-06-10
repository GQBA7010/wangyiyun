import crypto from 'node:crypto'

// ---------------------------------------------------------------------------
// Password hashing (scrypt — built into Node, no native dependency)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64

/** Hash a plaintext password. Returns a self-describing `scrypt$salt$hash` string. */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `scrypt$${salt}$${derived}`
}

/** Constant-time verify a plaintext password against a stored hash. */
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
  const expected = Buffer.from(hash, 'hex')
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected)
}

// ---------------------------------------------------------------------------
// Symmetric encryption at rest (AES-256-GCM) for sensitive fields (cookies)
// ---------------------------------------------------------------------------

const ENC_PREFIX = 'enc:v1:'

function dataKey(secret) {
  // Derive a stable 32-byte key from the app secret.
  return crypto.scryptSync(secret, 'lumen-data-key', 32)
}

/** Encrypt a UTF-8 string. Returns `enc:v1:<iv>:<tag>:<ciphertext>` (base64 parts). */
export function encryptString(plain, secret) {
  if (plain == null || plain === '') return plain
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey(secret), iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX)
}

/** Decrypt a value produced by {@link encryptString}. Plaintext passes through. */
export function decryptString(value, secret) {
  if (!isEncrypted(value)) return value
  try {
    const [iv, tag, data] = value.slice(ENC_PREFIX.length).split(':')
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      dataKey(secret),
      Buffer.from(iv, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return '' // wrong key or tampered data — treat as unusable
  }
}

// ---------------------------------------------------------------------------
// Stateless signed session tokens (HMAC-SHA256)
// ---------------------------------------------------------------------------

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

/** Sign a session payload into a compact `<payload>.<sig>` token. */
export function signToken(payload, secret) {
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

/** Verify and decode a session token. Returns the payload or null. */
export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

export function randomId() {
  return crypto.randomBytes(12).toString('hex')
}

export function randomSecret() {
  return crypto.randomBytes(32).toString('hex')
}
