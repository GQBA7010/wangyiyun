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

const DATA_FILE = path.join(config.dataDir, 'data.json')

const DEFAULT_SETTINGS = {
  autoSignin: true,
  autoScrobble: true,
  autoTasks: true,
  scrobbleCount: 300,
}

const DEFAULT_DATA = {
  // App secret used for session signing + data encryption. Generated once
  // and persisted unless SESSION_SECRET is provided via the environment.
  secret: '',
  // Platform accounts (the people who log into the console).
  accounts: {},
  // Hosted NetEase accounts, each tagged with the owning account id.
  neteaseUsers: {},
  songPool: { ids: [], fetchedAt: 0 },
}

let cache = null

function ensureDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
}

/** The active secret: env override wins, else the persisted random secret. */
export function getSecret() {
  if (config.sessionSecret) return config.sessionSecret
  return load().secret
}

export function load() {
  if (cache) return cache
  ensureDir()
  if (fs.existsSync(DATA_FILE)) {
    try {
      cache = { ...structuredClone(DEFAULT_DATA), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }
    } catch {
      cache = structuredClone(DEFAULT_DATA)
    }
  } else {
    cache = structuredClone(DEFAULT_DATA)
  }

  // Ensure a persistent secret exists (only used when no env secret is set).
  if (!config.sessionSecret && !cache.secret) {
    cache.secret = randomSecret()
  }

  // Decrypt at-rest cookies into the in-memory cache so the rest of the app
  // works with plaintext. Disk always stays encrypted (see save()).
  const secret = config.sessionSecret || cache.secret
  for (const u of Object.values(cache.neteaseUsers)) {
    if (u && u.cookie) u.cookie = decryptString(u.cookie, secret)
  }

  persist()
  return cache
}

/** Serialise the cache to disk with sensitive fields encrypted. */
function persist() {
  ensureDir()
  const secret = config.sessionSecret || cache.secret
  const onDisk = {
    ...cache,
    neteaseUsers: Object.fromEntries(
      Object.entries(cache.neteaseUsers).map(([uid, u]) => [
        uid,
        { ...u, cookie: u?.cookie ? encryptString(u.cookie, secret) : u?.cookie },
      ]),
    ),
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(onDisk, null, 2))
}

export function save() {
  persist()
}

// ---------------------------------------------------------------------------
// Platform accounts
// ---------------------------------------------------------------------------

function publicAccount(acc) {
  if (!acc) return null
  const { passwordHash, ...rest } = acc
  return rest
}

export function getAccountById(id) {
  return load().accounts[id] || null
}

export function getAccountByUsername(username) {
  const lower = String(username).trim().toLowerCase()
  return Object.values(load().accounts).find((a) => a.usernameLower === lower) || null
}

export function countAccounts() {
  return Object.keys(load().accounts).length
}

export function createAccount({ username, password }) {
  const data = load()
  const id = randomId()
  const clean = String(username).trim()
  data.accounts[id] = {
    id,
    username: clean,
    usernameLower: clean.toLowerCase(),
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    scheduler: { enabled: false },
  }
  save()
  return publicAccount(data.accounts[id])
}

export function touchLogin(id) {
  const acc = getAccountById(id)
  if (acc) {
    acc.lastLoginAt = Date.now()
    save()
  }
}

export function getAccountScheduler(id) {
  const acc = getAccountById(id)
  return acc?.scheduler || { enabled: false }
}

export function setAccountScheduler(id, patch) {
  const acc = getAccountById(id)
  if (!acc) return null
  acc.scheduler = { ...acc.scheduler, ...patch }
  save()
  return acc.scheduler
}

export { publicAccount }

// ---------------------------------------------------------------------------
// Hosted NetEase accounts
// ---------------------------------------------------------------------------

/** Merge stored settings over defaults so schema additions apply to old users. */
function withDefaults(user) {
  if (!user) return user
  user.settings = { ...DEFAULT_SETTINGS, ...user.settings }
  return user
}

/** List hosted accounts. When `ownerId` is given, only that owner's accounts. */
export function listUsers(ownerId) {
  const all = Object.values(load().neteaseUsers).map(withDefaults)
  return ownerId ? all.filter((u) => u.ownerId === ownerId) : all
}

export function getUser(uid) {
  return withDefaults(load().neteaseUsers[uid])
}

/** Get a hosted account only if it belongs to `ownerId` (isolation guard). */
export function getOwnedUser(ownerId, uid) {
  const user = getUser(uid)
  return user && user.ownerId === ownerId ? user : null
}

export function upsertUser(user) {
  const data = load()
  const uid = Number(user.uid)
  const existing = data.neteaseUsers[uid]
  data.neteaseUsers[uid] = {
    settings: { ...DEFAULT_SETTINGS },
    logs: [],
    playedIds: [],
    ...existing,
    ...user,
    uid,
    ownerId: user.ownerId ?? existing?.ownerId,
    settings: { ...DEFAULT_SETTINGS, ...existing?.settings, ...user.settings },
  }
  save()
  return data.neteaseUsers[uid]
}

export function removeUser(uid) {
  const data = load()
  delete data.neteaseUsers[uid]
  save()
}

export function updateSettings(uid, settings) {
  const user = getUser(uid)
  if (!user) return null
  user.settings = { ...user.settings, ...settings }
  save()
  return user
}

export function addLog(uid, type, message, ok = true) {
  const user = getUser(uid)
  if (!user) return
  user.logs = user.logs || []
  user.logs.unshift({ at: Date.now(), type, message, ok })
  if (user.logs.length > 100) user.logs.length = 100
  save()
}

// ---------------------------------------------------------------------------
// Shared song pool (public chart data — not user-specific)
// ---------------------------------------------------------------------------

export function getSongPool() {
  return load().songPool
}

export function setSongPool(ids) {
  const data = load()
  data.songPool = { ids, fetchedAt: Date.now() }
  save()
  return data.songPool
}
