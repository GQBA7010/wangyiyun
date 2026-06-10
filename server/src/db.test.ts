import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Config (DATA_DIR / SESSION_SECRET) is read at import time, so point it at a
// throwaway directory containing a legacy data.json before importing modules.
let store: typeof import('./store.js')
let db: typeof import('./db.js')
let dataDir: string

const SECRET = 'migrate-test-secret'

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-migrate-'))
  process.env.DATA_DIR = dataDir
  process.env.SESSION_SECRET = SECRET

  const { encryptString, hashPassword } = await import('./security/crypto.js')
  const legacy = {
    secret: '',
    accounts: {
      acc1: {
        id: 'acc1',
        username: 'Legacy',
        usernameLower: 'legacy',
        passwordHash: hashPassword('pw-12345678'),
        createdAt: 1700000000000,
        lastLoginAt: 1700000000000,
        scheduler: { enabled: true },
      },
    },
    neteaseUsers: {
      '9001': {
        uid: 9001,
        ownerId: 'acc1',
        cookie: encryptString('MUSIC_U=legacy-cookie', SECRET),
        nickname: '老用户',
        settings: {
          autoSignin: true,
          autoScrobble: false,
          autoTasks: true,
          autoPartner: false,
          partnerScore: 3,
          scrobbleCount: 50,
        },
        logs: [],
        playedIds: [1, 2, 3],
      },
    },
    songPool: { ids: [11, 22], fetchedAt: 1700000000000 },
  }
  fs.writeFileSync(path.join(dataDir, 'data.json'), JSON.stringify(legacy))

  store = await import('./store.js')
  db = await import('./db.js')
})

afterAll(() => {
  db.closeDb()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('legacy data.json migration', () => {
  it('imports accounts and hosted users into SQLite on first load', () => {
    const data = store.load()
    expect(Object.keys(data.accounts)).toContain('acc1')
    expect(store.getAccountByUsername('legacy')?.id).toBe('acc1')
    expect(store.getAccountScheduler('acc1').enabled).toBe(true)

    const user = store.getUser(9001)
    expect(user?.ownerId).toBe('acc1')
    expect(user?.cookie).toBe('MUSIC_U=legacy-cookie')
    expect(user?.playedIds).toEqual([1, 2, 3])
    expect(store.getSongPool().ids).toEqual([11, 22])
  })

  it('renames the legacy file so it is only imported once', () => {
    expect(fs.existsSync(path.join(dataDir, 'data.json'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'data.json.migrated'))).toBe(true)
  })
})

describe('backups', () => {
  it('creates a timestamped backup copy of the database', async () => {
    const file = await db.backupNow()
    expect(fs.existsSync(file)).toBe(true)
    expect(path.basename(file)).toMatch(/^lumen-.*\.db$/)
  })
})
