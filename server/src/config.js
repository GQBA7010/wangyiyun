import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isProd = process.env.NODE_ENV === 'production'

/** Express `trust proxy` accepts a boolean, hop count, or subnet list. */
function parseTrustProxy(v) {
  if (v == null || v === '') return 1
  if (v === 'true') return true
  if (v === 'false') return false
  const n = Number(v)
  return Number.isNaN(n) ? v : n
}

/** Centralised runtime configuration, sourced from environment variables. */
export const config = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),

  // Secret used to sign session tokens and derive the data-encryption key.
  // If unset, a strong random secret is generated and persisted on first run
  // (see store.js) so that sessions and encrypted data survive restarts.
  sessionSecret: process.env.SESSION_SECRET || '',

  // Session lifetime for the auth cookie.
  sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_MS) || 7 * 24 * 60 * 60 * 1000,
  sessionCookieName: 'lumen_session',

  // Trust the first reverse-proxy hop (BaoTa / Nginx) so client IPs and the
  // Secure-cookie heuristic work correctly behind TLS termination.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  // When true (default in production), session cookies are marked Secure and
  // therefore only sent over HTTPS. Set COOKIE_SECURE=false to allow plain
  // HTTP access (e.g. local LAN without TLS).
  cookieSecure:
    process.env.COOKIE_SECURE != null
      ? process.env.COOKIE_SECURE === 'true'
      : isProd,

  // Account-registration policy.
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  minPasswordLength: Number(process.env.MIN_PASSWORD_LENGTH) || 8,
  maxAccounts: Number(process.env.MAX_ACCOUNTS) || 0, // 0 = unlimited
}
