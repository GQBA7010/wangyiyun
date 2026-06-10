import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config.js'
import { logger } from './logger.js'

const DB_FILE = path.join(config.dataDir, 'lumen.db')
const BACKUP_DIR = path.join(config.dataDir, 'backups')

let db: Database.Database | null = null

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  email          TEXT NOT NULL DEFAULT '',
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER NOT NULL,
  scheduler_json TEXT NOT NULL DEFAULT '{"enabled":false}',
  role           TEXT NOT NULL DEFAULT 'user',
  disabled       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS netease_users (
  uid       TEXT PRIMARY KEY,
  owner_id  TEXT,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_netease_users_owner ON netease_users(owner_id);
`

/** Open (and initialise) the SQLite database. Idempotent. */
export function getDb(): Database.Database {
  if (db) return db
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true })
  db = new Database(DB_FILE)
  // WAL keeps readers/writers from blocking each other and survives crashes.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  migrate(db)
  return db
}

/** Additive schema migrations for databases created by older versions. */
function migrate(d: Database.Database): void {
  const cols = (d.pragma('table_info(accounts)') as { name: string }[]).map((c) => c.name)
  if (!cols.includes('role')) {
    d.exec("ALTER TABLE accounts ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")
  }
  if (!cols.includes('disabled')) {
    d.exec('ALTER TABLE accounts ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0')
  }
  if (!cols.includes('email')) {
    d.exec("ALTER TABLE accounts ADD COLUMN email TEXT NOT NULL DEFAULT ''")
  }
}

export function dbFilePath(): string {
  return DB_FILE
}

/** Lightweight connectivity probe used by the health endpoint. */
export function dbHealthy(): boolean {
  try {
    getDb().prepare('SELECT 1').get()
    return true
  } catch {
    return false
  }
}

/** Close the database (used by tests). */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/** Copy the live database to a timestamped file under data/backups. */
export async function backupNow(): Promise<string> {
  const d = getDb()
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const target = path.join(BACKUP_DIR, `lumen-${stamp}.db`)
  await d.backup(target)
  pruneBackups()
  return target
}

/** Keep only the newest `config.backupKeep` backup files. */
function pruneBackups(): void {
  if (!fs.existsSync(BACKUP_DIR)) return
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('lumen-') && f.endsWith('.db'))
    .sort()
  while (files.length > config.backupKeep) {
    const oldest = files.shift()
    if (oldest) fs.rmSync(path.join(BACKUP_DIR, oldest), { force: true })
  }
}

let backupTimer: NodeJS.Timeout | null = null

/** Start the periodic backup loop (idempotent). */
export function startBackups(): void {
  if (backupTimer || config.backupIntervalMs <= 0) return
  const run = (): void => {
    backupNow()
      .then((file) => logger.info({ file }, 'database backup created'))
      .catch((e: unknown) =>
        logger.error(
          { err: e instanceof Error ? e.message : String(e) },
          'database backup failed',
        ),
      )
  }
  run()
  backupTimer = setInterval(run, config.backupIntervalMs)
  backupTimer.unref()
}
