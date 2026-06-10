import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// SMTP env vars are read at import time; set them before the dynamic import so
// the forgot-password endpoints are enabled. Codes are injected via the
// storeCode test seam (no real email is sent).
let app: Express
let store: typeof import('../store.js')
let mail: typeof import('../mail.js')
let dataDir: string

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-reset-'))
  process.env.DATA_DIR = dataDir
  process.env.SESSION_SECRET = 'reset-test-secret'
  process.env.COOKIE_SECURE = 'false'
  process.env.SMTP_USER = 'test@example.com'
  process.env.SMTP_PASS = 'test-pass'
  store = await import('../store.js')
  store.load()
  store.ensureDefaultAdmin()
  mail = await import('../mail.js')
  const { createApp } = await import('../app.js')
  app = createApp()
})

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

async function solveCaptcha(): Promise<{ captchaId: string; captcha: string }> {
  const res = await request(app).get('/api/auth/captcha')
  expect(res.status).toBe(200)
  const svg = res.body.svg as string
  const answer = [...svg.matchAll(/>([A-Z2-9])<\/text>/g)].map((m) => m[1]).join('')
  return { captchaId: res.body.captchaId as string, captcha: answer }
}

async function login(username: string, password: string) {
  const captcha = await solveCaptcha()
  return request(app)
    .post('/api/auth/login')
    .send({ username, password, ...captcha })
}

describe('forgot password reset', () => {
  const EMAIL = 'reset@example.com'

  beforeAll(() => {
    store.createAccount({
      username: 'reset_user',
      password: 'pw-12345678',
      email: EMAIL,
    })
  })

  it('rejects forgot-code for an unbound email', async () => {
    const captcha = await solveCaptcha()
    const res = await request(app)
      .post('/api/auth/forgot-code')
      .send({ email: 'nobody@example.com', ...captcha })
    expect(res.status).toBe(404)
  })

  it('rejects reset with a wrong code', async () => {
    const codeId = mail.storeCode(EMAIL, '111111')
    const res = await request(app).post('/api/auth/reset-password').send({
      email: EMAIL,
      emailCodeId: codeId,
      emailCode: '999999',
      password: 'pw-new-87654321',
    })
    expect(res.status).toBe(400)
  })

  it('rejects reset when the email has no account', async () => {
    const codeId = mail.storeCode('nobody@example.com', '222222')
    const res = await request(app).post('/api/auth/reset-password').send({
      email: 'nobody@example.com',
      emailCodeId: codeId,
      emailCode: '222222',
      password: 'pw-new-87654321',
    })
    expect(res.status).toBe(404)
  })

  it('resets the password with a valid code and revokes old sessions', async () => {
    const oldLogin = await login('reset_user', 'pw-12345678')
    expect(oldLogin.status).toBe(200)
    const oldCookies = oldLogin.headers['set-cookie'] as unknown as string[]

    const codeId = mail.storeCode(EMAIL, '333333')
    const res = await request(app).post('/api/auth/reset-password').send({
      email: EMAIL,
      emailCodeId: codeId,
      emailCode: '333333',
      password: 'pw-new-87654321',
    })
    expect(res.status).toBe(200)
    expect(res.body.username).toBe('reset_user')

    // Old session is revoked by the version bump.
    const after = await request(app).get('/api/users').set('Cookie', oldCookies)
    expect(after.status).toBe(401)

    // Old password no longer works; the new one does.
    expect((await login('reset_user', 'pw-12345678')).status).toBe(401)
    expect((await login('reset_user', 'pw-new-87654321')).status).toBe(200)
  })
})
