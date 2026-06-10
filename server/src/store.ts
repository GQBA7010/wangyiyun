import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import {
  decryptString,
  encryptString,
  hashPassword,
  randomId,
  randomSecret,
} from './security/crypto.js'
import type {
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

const DATA_FILE = path.join(config.dataDir, 'data.json')

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

function ensureDir(): void {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
}

/** The active secret: env override wins, else the persisted random secret. */
export function getSecret(): string {
  if (config.sessionSecret) return config.sessionSecret
  return load().secret
}

export function load(): AppData {
  if (cache) return cache
  ensureDir()
  let data = defaultData()
  if (fs.existsSync(DATA_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Partial<AppData>
      data = { ...data, ...parsed }
    } catch {
      data = defaultData()
    }
  }
  cache = data

  // Ensure a persistent secret exists (only used when no env secret is set).
  if (!config.sessionSecret && !cache.secret) {
    cache.secret = randomSecret()
  }

  // Decrypt at-rest cookies into the in-memory cache so the rest of the app
  // works with plaintext. Disk always stays encrypted (see persist()).
  const secret = config.sessionSecret || cache.secret
  for (const u of Object.values(cache.neteaseUsers)) {
    if (u.cookie) u.cookie = decryptString(u.cookie, secret)
  }

  persist()
  return cache
}

/** Serialise the cache to disk with sensitive fields encrypted. */
function persist(): void {
  if (!cache) return
  ensureDir()
  const secret = config.sessionSecret || cache.secret
  const onDisk: AppData = {
    ...cache,
    neteaseUsers: Object.fromEntries(
      Object.entries(cache.neteaseUsers).map(([uid, u]) => [
        uid,
        { ...u, cookie: u.cookie ? encryptString(u.cookie, secret) : u.cookie },
      ]),
    ),
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(onDisk, null, 2))
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
}: {
  username: string
  password: string
}): PublicAccount {
  const data = load()
  const id = randomId()
  const clean = String(username).trim()
  const account: PlatformAccount = {
    id,
    username: clean,
    usernameLower: clean.toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    scheduler: { enabled: false },
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
