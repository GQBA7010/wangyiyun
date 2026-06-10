import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { getDb } from './db.js'
import { logger } from './logger.js'
import {
  decryptString,
  encryptString,
  hashPassword,
  randomId,
  randomSecret,
} from './security/crypto.js'
import type {
  AccountRole,
  AppData,
  LogEntry,
  NeteaseUser,
  NeteaseUserPatch,
  PlatformAccount,
  PublicAccount,
  SchedulerState,
  Settings,
  SongPool,
} from './types.js'

/** Legacy JSON data file — imported into SQLite on first run, then renamed. */
const LEGACY_DATA_FILE = path.join(config.dataDir, 'data.json')

const DEFAULT_SETTINGS: Settings = {
  autoSignin: true,
  autoScrobble: true,
  autoTasks: true,
  autoPartner: false, // music-partner evaluation — off by default (needs qualification)
  partnerScore: 3, // scoring strategy 1-4 (3 = 3-4 分, the recommended default)
  scrobbleCount: 300,
}

function defaultData(): AppData {
  return {
    // App secret used for session signing + data encryption. Generated once
    // and persisted unless SESSION_SECRET is provided via the environment.
    secret: '',
    // Platform accounts (the people who log into the console).
    accounts: {},
    // Hosted NetEase accounts, each tagged with the owning account id.
    neteaseUsers: {},
    songPool: { ids: [], fetchedAt: 0 },
  }
}

let cache: AppData | null = null

/** The active secret: env override wins, else the persisted random secret. */
export function getSecret(): string {
  if (config.sessionSecret) return config.sessionSecret
  return load().secret
}

interface AccountRow {
  id: string
  username: string
  username_lower: string
  password_hash: string
  email: string
  created_at: number
  last_login_at: number
  scheduler_json: string
  role: string
  disabled: number
  session_version: number
}

interface NeteaseUserRow {
  uid: string
  owner_id: string | null
  data_json: string
}

function readMeta(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function writeMeta(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value)
}

/**
 * One-time import of the legacy data.json into SQLite. The original file is
 * kept (renamed to data.json.migrated) so nothing is ever destroyed.
 */
function importLegacyJson(): Partial<AppData> | null {
  if (!fs.existsSync(LEGACY_DATA_FILE)) return null
  try {
    const parsed = JSON.parse(
      fs.readFileSync(LEGACY_DATA_FILE, 'utf8'),
    ) as Partial<AppData>
    fs.renameSync(LEGACY_DATA_FILE, `${LEGACY_DATA_FILE}.migrated`)
    logger.info('legacy data.json imported into SQLite (renamed to data.json.migrated)')
    return parsed
  } catch (e) {
    // Never silently discard user data: keep the corrupt file for inspection.
    logger.error(
      { err: e instanceof Error ? e.message : String(e) },
      'failed to parse legacy data.json — leaving file untouched',
    )
    return null
  }
}

export function load(): AppData {
  if (cache) return cache
  const db = getDb()

  const data = defaultData()
  data.secret = readMeta('secret') ?? ''

  const hasAccounts =
    (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n > 0
  const hasUsers =
    (db.prepare('SELECT COUNT(*) AS n FROM netease_users').get() as { n: number }).n > 0

  // First run with an existing JSON store: import it, then continue from SQLite.
  if (!hasAccounts && !hasUsers && !data.secret) {
    const legacy = importLegacyJson()
    if (legacy) {
      data.secret = legacy.secret ?? ''
      data.accounts = legacy.accounts ?? {}
      data.neteaseUsers = legacy.neteaseUsers ?? {}
      data.songPool = legacy.songPool ?? data.songPool
      // Back-fill role/disabled for accounts created before v3 (SQLite migration).
      let firstAccount = true
      for (const acc of Object.values(data.accounts)) {
        if (!acc.role) acc.role = firstAccount ? 'admin' : 'user'
        if (acc.disabled === undefined) acc.disabled = false
        if (acc.email === undefined) acc.email = ''
        if (acc.sessionVersion === undefined) acc.sessionVersion = 0
        firstAccount = false
      }
      cache = data
      if (!config.sessionSecret && !cache.secret) cache.secret = randomSecret()
      const secret = config.sessionSecret || cache.secret
      for (const u of Object.values(cache.neteaseUsers)) {
        if (u.cookie) u.cookie = decryptString(u.cookie, secret)
      }
      persist()
      return cache
    }
  }

  const pool = readMeta('songPool')
  if (pool) {
    try {
      data.songPool = JSON.parse(pool) as SongPool
    } catch {
      /* keep default */
    }
  }

  for (const row of db.prepare('SELECT * FROM accounts').all() as AccountRow[]) {
    data.accounts[row.id] = {
      id: row.id,
      username: row.username,
      usernameLower: row.username_lower,
      passwordHash: row.password_hash,
      email: row.email || '',
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      scheduler: JSON.parse(row.scheduler_json) as SchedulerState,
      role: (row.role as AccountRole) || 'user',
      disabled: !!row.disabled,
      sessionVersion: row.session_version || 0,
    }
  }

  cache = data
  if (!config.sessionSecret && !cache.secret) {
    cache.secret = randomSecret()
  }
  const secret = config.sessionSecret || cache.secret

  for (const row of db.prepare('SELECT * FROM netease_users').all() as NeteaseUserRow[]) {
    const user = JSON.parse(row.data_json) as NeteaseUser
    if (user.cookie) user.cookie = decryptString(user.cookie, secret)
    data.neteaseUsers[row.uid] = user
  }

  persist()
  return cache
}

/** Sync the in-memory cache into SQLite atomically (cookies encrypted). */
function persist(): void {
  if (!cache) return
  const db = getDb()
  const secret = config.sessionSecret || cache.secret
  const state = cache

  const upsertAccount = db.prepare(
    `INSERT INTO accounts
       (id, username, username_lower, password_hash, email, created_at, last_login_at, scheduler_json, role, disabled, session_version)
     VALUES (@id, @username, @usernameLower, @passwordHash, @email, @createdAt, @lastLoginAt, @scheduler, @role, @disabled, @sessionVersion)
     ON CONFLICT(id) DO UPDATE SET
       username = excluded.username,
       username_lower = excluded.username_lower,
       password_hash = excluded.password_hash,
       email = excluded.email,
       created_at = excluded.created_at,
       last_login_at = excluded.last_login_at,
       scheduler_json = excluded.scheduler_json,
       role = excluded.role,
       disabled = excluded.disabled,
       session_version = excluded.session_version`,
  )
  const upsertNetease = db.prepare(
    `INSERT INTO netease_users (uid, owner_id, data_json)
     VALUES (@uid, @ownerId, @data)
     ON CONFLICT(uid) DO UPDATE SET
       owner_id = excluded.owner_id,
       data_json = excluded.data_json`,
  )
  const deleteAccountsNotIn = db.prepare('DELETE FROM accounts WHERE id = ?')
  const deleteUsersNotIn = db.prepare('DELETE FROM netease_users WHERE uid = ?')

  db.transaction(() => {
    writeMeta('secret', state.secret)
    writeMeta('songPool', JSON.stringify(state.songPool))

    const accountIds = new Set(Object.keys(state.accounts))
    for (const row of db.prepare('SELECT id FROM accounts').all() as { id: string }[]) {
      if (!accountIds.has(row.id)) deleteAccountsNotIn.run(row.id)
    }
    for (const acc of Object.values(state.accounts)) {
      upsertAccount.run({
        id: acc.id,
        username: acc.username,
        usernameLower: acc.usernameLower,
        passwordHash: acc.passwordHash,
        email: acc.email || '',
        createdAt: acc.createdAt,
        lastLoginAt: acc.lastLoginAt,
        scheduler: JSON.stringify(acc.scheduler),
        role: acc.role || 'user',
        disabled: acc.disabled ? 1 : 0,
        sessionVersion: acc.sessionVersion || 0,
      })
    }

    const uids = new Set(Object.keys(state.neteaseUsers))
    for (const row of db.prepare('SELECT uid FROM netease_users').all() as {
      uid: string
    }[]) {
      if (!uids.has(row.uid)) deleteUsersNotIn.run(row.uid)
    }
    for (const [uid, u] of Object.entries(state.neteaseUsers)) {
      const onDisk: NeteaseUser = {
        ...u,
        cookie: u.cookie ? encryptString(u.cookie, secret) : u.cookie,
      }
      upsertNetease.run({
        uid,
        ownerId: u.ownerId ?? null,
        data: JSON.stringify(onDisk),
      })
    }
  })()
}

export function save(): void {
  persist()
}

// ---------------------------------------------------------------------------
// Platform accounts
// ---------------------------------------------------------------------------

export function publicAccount(acc: PlatformAccount): PublicAccount
export function publicAccount(acc: null | undefined): null
export function publicAccount(
  acc: PlatformAccount | null | undefined,
): PublicAccount | null {
  if (!acc) return null
  const { passwordHash: _passwordHash, ...rest } = acc
  return rest
}

export function getAccountById(id: string): PlatformAccount | null {
  return load().accounts[id] ?? null
}

export function getAccountByUsername(username: string): PlatformAccount | null {
  const lower = String(username).trim().toLowerCase()
  return Object.values(load().accounts).find((a) => a.usernameLower === lower) ?? null
}

export function countAccounts(): number {
  return Object.keys(load().accounts).length
}

export function createAccount({
  username,
  password,
  email,
}: {
  username: string
  password: string
  email?: string
}): PublicAccount {
  const data = load()
  const id = randomId()
  const clean = String(username).trim()
  // First ever account gets the admin role.
  const isFirstAccount = Object.keys(data.accounts).length === 0
  const account: PlatformAccount = {
    id,
    username: clean,
    usernameLower: clean.toLowerCase(),
    passwordHash: hashPassword(password),
    email: email || '',
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    scheduler: { enabled: false },
    role: isFirstAccount ? 'admin' : 'user',
    disabled: false,
    sessionVersion: 0,
  }
  data.accounts[id] = account
  save()
  return publicAccount(account)
}

export function touchLogin(id: string): void {
  const acc = getAccountById(id)
  if (acc) {
    acc.lastLoginAt = Date.now()
    save()
  }
}

export function getAccountScheduler(id: string): SchedulerState {
  const acc = getAccountById(id)
  return acc?.scheduler ?? { enabled: false }
}

export function setAccountScheduler(
  id: string,
  patch: Partial<SchedulerState>,
): SchedulerState | null {
  const acc = getAccountById(id)
  if (!acc) return null
  acc.scheduler = { ...acc.scheduler, ...patch }
  save()
  return acc.scheduler
}

// ---------------------------------------------------------------------------
// Hosted NetEase accounts
// ---------------------------------------------------------------------------

/** Merge stored settings over defaults so schema additions apply to old users. */
function withDefaults<T extends NeteaseUser | undefined>(user: T): T {
  if (!user) return user
  user.settings = { ...DEFAULT_SETTINGS, ...user.settings }
  return user
}

/** List hosted accounts. When `ownerId` is given, only that owner's accounts. */
export function listUsers(ownerId?: string): NeteaseUser[] {
  const all = Object.values(load().neteaseUsers).map((u) => withDefaults(u))
  return ownerId ? all.filter((u) => u.ownerId === ownerId) : all
}

export function getUser(uid: number | string): NeteaseUser | undefined {
  return withDefaults(load().neteaseUsers[String(uid)])
}

/** Get a hosted account only if it belongs to `ownerId` (isolation guard). */
export function getOwnedUser(ownerId: string, uid: number | string): NeteaseUser | null {
  const user = getUser(uid)
  return user && user.ownerId === ownerId ? user : null
}

export function upsertUser(patch: NeteaseUserPatch): NeteaseUser {
  const data = load()
  const uid = Number(patch.uid)
  const key = String(uid)
  const existing = data.neteaseUsers[key]
  const merged: NeteaseUser = {
    logs: [],
    playedIds: [],
    ...existing,
    ...patch,
    uid,
    ownerId: patch.ownerId ?? existing?.ownerId,
    settings: { ...DEFAULT_SETTINGS, ...existing?.settings, ...patch.settings },
  }
  data.neteaseUsers[key] = merged
  save()
  return merged
}

export function removeUser(uid: number | string): void {
  const data = load()
  delete data.neteaseUsers[String(uid)]
  save()
}

export function updateSettings(
  uid: number | string,
  settings: Partial<Settings>,
): NeteaseUser | undefined {
  const user = getUser(uid)
  if (!user) return undefined
  user.settings = { ...user.settings, ...settings }
  save()
  return user
}

export function addLog(
  uid: number | string,
  type: string,
  message: string,
  ok = true,
): void {
  const user = getUser(uid)
  if (!user) return
  const entry: LogEntry = { at: Date.now(), type, message, ok }
  user.logs = user.logs || []
  user.logs.unshift(entry)
  if (user.logs.length > 100) user.logs.length = 100
  save()
}

// ---------------------------------------------------------------------------
// Shared song pool (public chart data — not user-specific)
// ---------------------------------------------------------------------------

export function getSongPool(): SongPool {
  return load().songPool
}

export function setSongPool(ids: number[]): SongPool {
  const data = load()
  data.songPool = { ids, fetchedAt: Date.now() }
  save()
  return data.songPool
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

/** List all platform accounts (admin view). */
export function listAccounts(): PlatformAccount[] {
  return Object.values(load().accounts)
}

/** Update the role/disabled fields for a platform account. */
export function updateAccount(
  id: string,
  patch: { role?: AccountRole; disabled?: boolean },
): PlatformAccount | null {
  const acc = getAccountById(id)
  if (!acc) return null
  if (patch.role !== undefined) acc.role = patch.role
  if (patch.disabled !== undefined) acc.disabled = patch.disabled
  save()
  return acc
}

/** Delete a platform account and all its hosted NetEase accounts. */
export function deleteAccount(id: string): boolean {
  const data = load()
  if (!data.accounts[id]) return false
  for (const [uid, user] of Object.entries(data.neteaseUsers)) {
    if (user.ownerId === id) delete data.neteaseUsers[uid]
  }
  delete data.accounts[id]
  save()
  return true
}

// ---------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------

export function changePassword(id: string, newPassword: string): boolean {
  const acc = getAccountById(id)
  if (!acc) return false
  acc.passwordHash = hashPassword(newPassword)
  // Revoke every existing session for this account.
  acc.sessionVersion = (acc.sessionVersion || 0) + 1
  save()
  return true
}

// ---------------------------------------------------------------------------
// Per-user NetEase account limit
// ---------------------------------------------------------------------------

export function countUserNeteaseAccounts(ownerId: string): number {
  return listUsers(ownerId).length
}
