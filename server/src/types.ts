/**
 * Shared domain types for the Lumen backend.
 *
 * These describe the persisted data model and the values that flow between the
 * store, the task runners and the HTTP layer. Keeping them in one place lets
 * every module share a single, strict definition of the domain.
 */

/** Per–hosted-account automation preferences. */
export interface Settings {
  autoSignin: boolean
  autoScrobble: boolean
  autoTasks: boolean
  /** Music-partner evaluation — off by default (requires qualification). */
  autoPartner: boolean
  /** Scoring strategy 1-4 (3 = "3-4 分", the recommended default). */
  partnerScore: number
  /** Songs to scrobble per cycle (1-500). */
  scrobbleCount: number
}

export interface LogEntry {
  at: number
  type: string
  message: string
  ok: boolean
}

export interface LastSignin {
  at: number
  message: string
}

export interface LastScrobble {
  at: number
  count: number
  message: string
}

export interface LastYunbei {
  at: number
  message: string
  claimed: number
  total: number
}

export interface LastPartner {
  at: number
  message: string
  eligible: boolean
  evaluated: number
}

export type AccountStatus = 'active' | 'expired' | 'unknown'

/** A NetEase account hosted on behalf of a platform user. */
export interface NeteaseUser {
  uid: number
  /** Owning platform account id (tenant isolation key). */
  ownerId?: string
  /** Login cookie (encrypted at rest, plaintext in memory). */
  cookie?: string
  nickname?: string
  avatarUrl?: string
  level?: number
  listenSongs?: number
  status?: AccountStatus
  settings: Settings
  logs: LogEntry[]
  playedIds: number[]
  lastSignin?: LastSignin
  lastScrobble?: LastScrobble
  lastYunbei?: LastYunbei
  lastPartner?: LastPartner
}

/** A patch applied through {@link upsertUser}; only `uid` is required. */
export type NeteaseUserPatch = Partial<Omit<NeteaseUser, 'uid'>> & {
  uid: number | string
}

export interface SchedulerState {
  enabled: boolean
}

/** A platform user (the person who logs into the console). */
export interface PlatformAccount {
  id: string
  username: string
  usernameLower: string
  passwordHash: string
  createdAt: number
  lastLoginAt: number
  scheduler: SchedulerState
}

/** A platform account with its password hash stripped, safe to send to clients. */
export type PublicAccount = Omit<PlatformAccount, 'passwordHash'>

export interface SongPool {
  ids: number[]
  fetchedAt: number
}

/** The full persisted application state. */
export interface AppData {
  /** App secret for session signing + data encryption (generated if unset). */
  secret: string
  accounts: Record<string, PlatformAccount>
  neteaseUsers: Record<string, NeteaseUser>
  songPool: SongPool
}

/** Decoded session-cookie payload. */
export interface SessionPayload {
  sub: string
  exp: number
}
