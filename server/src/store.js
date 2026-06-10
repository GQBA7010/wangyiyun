import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data')
const DATA_FILE = path.join(DATA_DIR, 'data.json')

const DEFAULT_SETTINGS = {
  autoSignin: true,
  autoScrobble: true,
  scrobbleCount: 300,
}

const DEFAULT_DATA = {
  users: {},
  // Global scheduler config. cron in standard 5-field syntax.
  scheduler: { cron: '0 8 * * *', enabled: true },
  songPool: { ids: [], fetchedAt: 0 },
}

let cache = null

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function load() {
  if (cache) return cache
  ensureDir()
  if (fs.existsSync(DATA_FILE)) {
    try {
      cache = { ...DEFAULT_DATA, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) }
    } catch {
      cache = structuredClone(DEFAULT_DATA)
    }
  } else {
    cache = structuredClone(DEFAULT_DATA)
  }
  return cache
}

export function save() {
  ensureDir()
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2))
}

export function listUsers() {
  return Object.values(load().users)
}

export function getUser(uid) {
  return load().users[uid]
}

export function upsertUser(user) {
  const data = load()
  const existing = data.users[user.uid]
  data.users[user.uid] = {
    settings: { ...DEFAULT_SETTINGS },
    logs: [],
    playedIds: [],
    ...existing,
    ...user,
    settings: { ...DEFAULT_SETTINGS, ...existing?.settings, ...user.settings },
  }
  save()
  return data.users[user.uid]
}

export function removeUser(uid) {
  const data = load()
  delete data.users[uid]
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

export function getScheduler() {
  return load().scheduler
}

export function setScheduler(patch) {
  const data = load()
  data.scheduler = { ...data.scheduler, ...patch }
  save()
  return data.scheduler
}

export function getSongPool() {
  return load().songPool
}

export function setSongPool(ids) {
  const data = load()
  data.songPool = { ids, fetchedAt: Date.now() }
  save()
  return data.songPool
}
