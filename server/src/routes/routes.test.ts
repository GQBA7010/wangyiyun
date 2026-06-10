import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'

// Config (DATA_DIR / SESSION_SECRET) is read at import time, so point it at a
// throwaway directory before dynamically importing the app.
let app: Express
let store: typeof import('../store.js')
let dataDir: string

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-routes-'))
  process.env.DATA_DIR = dataDir
  process.env.SESSION_SECRET = 'routes-test-secret'
  process.env.COOKIE_SECURE = 'false'
  store = await import('../store.js')
  store.load()
  store.ensureDefaultAdmin()
  const { createApp } = await import('../app.js')
  app = createApp()
})

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

/** Solve an image CAPTCHA by extracting the glyphs from the SVG markup. */
async function solveCaptcha(): Promise<{ captchaId: string; captcha: string }> {
  const res = await request(app).get('/api/auth/captcha')
  expect(res.status).toBe(200)
  const svg = res.body.svg as string
  const answer = [...svg.matchAll(/>([A-Z2-9])<\/text>/g)].map((m) => m[1]).join('')
  return { captchaId: res.body.captchaId as string, captcha: answer }
}

async function register(username: string): Promise<string[]> {
  const captcha = await solveCaptcha()
  const res = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'pw-12345678', ...captcha })
  expect(res.status).toBe(200)
  expect(res.body.ok).toBe(true)
  return res.headers['set-cookie'] as unknown as string[]
}

async function login(username: string, password: string) {
  const captcha = await solveCaptcha()
  return request(app)
    .post('/api/auth/login')
    .send({ username, password, ...captcha })
}

describe('health endpoint', () => {
  it('reports db up', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.db).toBe('up')
    expect(res.body.scheduler).toBeDefined()
  })
})

describe('auth routes', () => {
  it('seeds the built-in default admin', async () => {
    const res = await login(store.DEFAULT_ADMIN_USERNAME, store.DEFAULT_ADMIN_PASSWORD)
    expect(res.status).toBe(200)
    expect(res.body.account.role).toBe('admin')
  })

  it('registers a regular user (never admin) and sets a session cookie', async () => {
    const captcha = await solveCaptcha()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'first_admin', password: 'pw-12345678', ...captcha })
    expect(res.status).toBe(200)
    expect(res.body.account.role).toBe('user')
    expect(res.body.account.passwordHash).toBeUndefined()
    expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly')
  })

  it('rejects password reset when mail is not configured', async () => {
    const res = await request(app).post('/api/auth/forgot-code').send({ email: 'a@b.c' })
    expect(res.status).toBe(400)
  })

  it('rejects registration with a wrong captcha', async () => {
    const { captchaId } = await solveCaptcha()
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'nope', password: 'pw-12345678', captchaId, captcha: '!!!!' })
    expect(res.status).toBe(400)
    expect(res.body.captcha).toBe(true)
  })

  it('rejects login with a wrong password', async () => {
    const res = await login('first_admin', 'wrong-password')
    expect(res.status).toBe(401)
  })

  it('logs in with correct credentials', async () => {
    const res = await login('first_admin', 'pw-12345678')
    expect(res.status).toBe(200)
    expect(res.body.account.username).toBe('first_admin')
  })

  it('revokes old sessions after a password change', async () => {
    const cookies = await register('revoke_user')
    const before = await request(app).get('/api/users').set('Cookie', cookies)
    expect(before.status).toBe(200)

    const acc = store.getAccountByUsername('revoke_user')!
    store.changePassword(acc.id, 'pw-new-87654321')

    const after = await request(app).get('/api/users').set('Cookie', cookies)
    expect(after.status).toBe(401)
  })
})

describe('CSRF protection', () => {
  it('rejects state-changing requests from a foreign origin', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'https://evil.example')
    expect(res.status).toBe(403)
  })

  it('allows same-origin state-changing requests', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'http://127.0.0.1') // supertest host is 127.0.0.1
      .set('Host', '127.0.0.1')
    expect(res.status).toBe(200)
  })
})

describe('tenant isolation over HTTP', () => {
  it('requires auth for /api/users', async () => {
    const res = await request(app).get('/api/users')
    expect(res.status).toBe(401)
  })

  it("hides other tenants' hosted accounts", async () => {
    const cookiesA = await register('tenant_a')
    const cookiesB = await register('tenant_b')
    const accA = store.getAccountByUsername('tenant_a')!
    store.upsertUser({ uid: 9001, ownerId: accA.id, cookie: 'MUSIC_U=secret' })

    const listA = await request(app).get('/api/users').set('Cookie', cookiesA)
    expect(listA.body.users).toHaveLength(1)
    expect(listA.body.users[0].cookie).toBeUndefined() // never leaks the cookie

    const listB = await request(app).get('/api/users').set('Cookie', cookiesB)
    expect(listB.body.users).toHaveLength(0)

    // Deleting someone else's account responds 404 (no probing).
    const del = await request(app).delete('/api/users/9001').set('Cookie', cookiesB)
    expect(del.status).toBe(404)
    expect(store.getUser(9001)).not.toBeNull()
  })

  it('lets the owner delete their own hosted account', async () => {
    const cookiesA = (await login('tenant_a', 'pw-12345678')).headers[
      'set-cookie'
    ] as unknown as string[]
    const del = await request(app).delete('/api/users/9001').set('Cookie', cookiesA)
    expect(del.status).toBe(200)
    expect(store.getUser(9001)).toBeFalsy()
  })
})

describe('admin routes', () => {
  it('blocks non-admin users', async () => {
    const cookies = (await login('tenant_b', 'pw-12345678')).headers[
      'set-cookie'
    ] as unknown as string[]
    const res = await request(app).get('/api/admin/accounts').set('Cookie', cookies)
    expect(res.status).toBe(403)
  })

  it('lets the admin list users and disable an account', async () => {
    const cookies = (
      await login(store.DEFAULT_ADMIN_USERNAME, store.DEFAULT_ADMIN_PASSWORD)
    ).headers['set-cookie'] as unknown as string[]
    const list = await request(app).get('/api/admin/accounts').set('Cookie', cookies)
    expect(list.status).toBe(200)
    expect(list.body.accounts.length).toBeGreaterThanOrEqual(3)

    const target = store.getAccountByUsername('tenant_b')!
    const dis = await request(app)
      .patch(`/api/admin/accounts/${target.id}`)
      .set('Cookie', cookies)
      .send({ disabled: true })
    expect(dis.status).toBe(200)

    // Disabled accounts can no longer log in.
    const res = await login('tenant_b', 'pw-12345678')
    expect(res.status).toBe(403)
  })
})
