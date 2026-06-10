import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('config (zod env parsing)', () => {
  it('coerces numbers, booleans and trust-proxy from the environment', async () => {
    vi.stubEnv('PORT', '4321')
    vi.stubEnv('ALLOW_REGISTRATION', 'false')
    vi.stubEnv('COOKIE_SECURE', 'true')
    vi.stubEnv('TRUST_PROXY', '2')
    vi.stubEnv('MIN_PASSWORD_LENGTH', '10')
    vi.resetModules()

    const { config } = await import('./config.js')
    expect(config.port).toBe(4321)
    expect(config.allowRegistration).toBe(false)
    expect(config.cookieSecure).toBe(true)
    expect(config.trustProxy).toBe(2)
    expect(config.minPasswordLength).toBe(10)
  })

  it('falls back to sane defaults when env vars are absent/blank', async () => {
    vi.stubEnv('PORT', '')
    vi.stubEnv('MAX_ACCOUNTS', '')
    vi.resetModules()

    const { config } = await import('./config.js')
    expect(config.port).toBe(3000)
    expect(config.maxAccounts).toBe(0)
    expect(config.sessionCookieName).toBe('lumen_session')
  })

  it('treats TRUST_PROXY=true/false as booleans', async () => {
    vi.stubEnv('TRUST_PROXY', 'true')
    vi.resetModules()
    const { config } = await import('./config.js')
    expect(config.trustProxy).toBe(true)
  })
})
