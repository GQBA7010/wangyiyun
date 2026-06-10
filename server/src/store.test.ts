import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The store reads config (incl. DATA_DIR + SESSION_SECRET) at import time, so we
// point them at a throwaway directory before dynamically importing the module.
let store: typeof import('./store.js')
let dataDir: string

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-store-'))
  process.env.DATA_DIR = dataDir
  process.env.SESSION_SECRET = 'store-test-secret'
  store = await import('./store.js')
})

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('platform accounts', () => {
  it('creates an account, finds it, and never exposes the password hash', () => {
    const created = store.createAccount({ username: 'Alice', password: 'pw-12345678' })
    expect(created).not.toHaveProperty('passwordHash')

    const found = store.getAccountByUsername('alice') // case-insensitive
    expect(found?.id).toBe(created.id)
    expect(found?.passwordHash.startsWith('scrypt$')).toBe(true)
  })

  it('toggles the per-account scheduler', () => {
    const acc = store.createAccount({ username: 'sched_user', password: 'pw-12345678' })
    expect(store.getAccountScheduler(acc.id).enabled).toBe(false)
    store.setAccountScheduler(acc.id, { enabled: true })
    expect(store.getAccountScheduler(acc.id).enabled).toBe(true)
  })
})

describe('hosted NetEase accounts (tenant isolation)', () => {
  it('isolates accounts by owner', () => {
    const owner = store.createAccount({ username: 'owner1', password: 'pw-12345678' })
    const other = store.createAccount({ username: 'owner2', password: 'pw-12345678' })
    store.upsertUser({ uid: 5001, ownerId: owner.id, cookie: 'MUSIC_U=secret' })

    expect(store.getOwnedUser(owner.id, 5001)?.uid).toBe(5001)
    expect(store.getOwnedUser(other.id, 5001)).toBeNull()
    expect(store.listUsers(owner.id)).toHaveLength(1)
    expect(store.listUsers(other.id)).toHaveLength(0)
  })

  it('merges settings over defaults and persists updates', () => {
    const owner = store.createAccount({ username: 'owner3', password: 'pw-12345678' })
    store.upsertUser({ uid: 6001, ownerId: owner.id })
    const before = store.getUser(6001)
    expect(before?.settings.autoSignin).toBe(true)
    expect(before?.settings.autoPartner).toBe(false)

    store.updateSettings(6001, { autoPartner: true, scrobbleCount: 120 })
    const after = store.getUser(6001)
    expect(after?.settings.autoPartner).toBe(true)
    expect(after?.settings.scrobbleCount).toBe(120)
  })
})

describe('encryption at rest', () => {
  it('writes hosted-account cookies encrypted to the database', async () => {
    const owner = store.createAccount({ username: 'enc_user', password: 'pw-12345678' })
    store.upsertUser({ uid: 7001, ownerId: owner.id, cookie: 'MUSIC_U=plain-cookie' })
    store.save()

    const { getDb } = await import('./db.js')
    const row = getDb()
      .prepare('SELECT data_json FROM netease_users WHERE uid = ?')
      .get('7001') as { data_json: string }
    expect(row.data_json).not.toContain('MUSIC_U=plain-cookie')
    expect(row.data_json).toContain('enc:v1:')

    // In memory the cookie remains usable (decrypted).
    expect(store.getUser(7001)?.cookie).toBe('MUSIC_U=plain-cookie')
  })
})

describe('removal', () => {
  it('deletes hosted accounts from the database', async () => {
    const owner = store.createAccount({ username: 'rm_user', password: 'pw-12345678' })
    store.upsertUser({ uid: 8001, ownerId: owner.id })
    store.removeUser(8001)
    expect(store.getUser(8001)).toBeUndefined()

    const { getDb } = await import('./db.js')
    const row = getDb().prepare('SELECT uid FROM netease_users WHERE uid = ?').get('8001')
    expect(row).toBeUndefined()
  })
})
