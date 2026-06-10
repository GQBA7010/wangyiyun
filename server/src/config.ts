import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** A boolean env var: "true"/"false" (case-insensitive), defaulting when unset. */
const boolFromEnv = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v == null || v === '' ? def : v.toLowerCase() === 'true'))

/** A positive integer env var with a fallback. */
const intFromEnv = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const n = Number(v)
      return v == null || v === '' || Number.isNaN(n) ? def : n
    })

/** Express `trust proxy` accepts a boolean, a hop count, or a subnet string. */
const trustProxyFromEnv = z
  .string()
  .optional()
  .transform((v): boolean | number | string => {
    if (v == null || v === '') return 1
    if (v === 'true') return true
    if (v === 'false') return false
    const n = Number(v)
    return Number.isNaN(n) ? v : n
  })

const isProd = process.env.NODE_ENV === 'production'

const EnvSchema = z.object({
  PORT: intFromEnv(3000),
  DATA_DIR: z
    .string()
    .optional()
    .transform((v) => v || path.join(__dirname, '..', 'data')),
  SESSION_SECRET: z
    .string()
    .optional()
    .transform((v) => v ?? ''),
  SESSION_MAX_AGE_MS: intFromEnv(7 * 24 * 60 * 60 * 1000),
  TRUST_PROXY: trustProxyFromEnv,
  COOKIE_SECURE: boolFromEnv(isProd),
  ALLOW_REGISTRATION: boolFromEnv(true),
  MIN_PASSWORD_LENGTH: intFromEnv(8),
  MAX_ACCOUNTS: intFromEnv(0), // 0 = unlimited
  MAX_NETEASE_PER_USER: intFromEnv(5),
  BACKUP_INTERVAL_HOURS: intFromEnv(6),
  BACKUP_KEEP: intFromEnv(20),
})

const parsed = EnvSchema.parse(process.env)

/** Centralised, validated runtime configuration sourced from the environment. */
export const config = {
  isProd,
  port: parsed.PORT,
  dataDir: parsed.DATA_DIR,

  // Secret used to sign session tokens and derive the data-encryption key. If
  // unset, a strong random secret is generated and persisted on first run (see
  // store.ts) so sessions and encrypted data survive restarts.
  sessionSecret: parsed.SESSION_SECRET,

  // Session lifetime for the auth cookie.
  sessionMaxAgeMs: parsed.SESSION_MAX_AGE_MS,
  sessionCookieName: 'lumen_session',

  // Trust the first reverse-proxy hop (BaoTa / Nginx) so client IPs and the
  // Secure-cookie heuristic work correctly behind TLS termination.
  trustProxy: parsed.TRUST_PROXY,

  // When true (default in production), session cookies are marked Secure and
  // therefore only sent over HTTPS. Set COOKIE_SECURE=false for plain HTTP.
  cookieSecure: parsed.COOKIE_SECURE,

  // Account-registration policy.
  allowRegistration: parsed.ALLOW_REGISTRATION,
  minPasswordLength: parsed.MIN_PASSWORD_LENGTH,
  maxAccounts: parsed.MAX_ACCOUNTS,
  maxNeteasePerUser: parsed.MAX_NETEASE_PER_USER,

  // Periodic SQLite backups (0 hours disables the loop).
  backupIntervalMs: parsed.BACKUP_INTERVAL_HOURS * 60 * 60 * 1000,
  backupKeep: parsed.BACKUP_KEEP,
} as const
