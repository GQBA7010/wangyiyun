import {
  accountInfo,
  dailySignin,
  playlistDetail,
  scrobble,
  userDetail,
} from './netease/api.js'
import {
  addLog,
  getSongPool,
  getUser,
  save,
  setSongPool,
  upsertUser,
} from './store.js'

// Well-known public chart playlists used to source a large, varied pool of
// song ids for listen-count farming.
const CHART_PLAYLISTS = [
  3778678, // 热歌榜
  3779629, // 新歌榜
  19723756, // 飙升榜
  2884035, // 原创榜
]

const POOL_TTL = 6 * 60 * 60 * 1000 // refresh song pool every 6h

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Refresh account profile (level / listenSongs / nickname). */
export async function refreshProfile(uid) {
  const user = getUser(uid)
  if (!user) return null
  const detail = await userDetail(uid, user.cookie)
  if (detail?.profile) {
    return upsertUser({
      uid,
      nickname: detail.profile.nickname ?? user.nickname,
      avatarUrl: detail.profile.avatarUrl ?? user.avatarUrl,
      level: detail.level ?? user.level,
      listenSongs: detail.listenSongs ?? user.listenSongs,
    })
  }
  return user
}

/** Run daily sign-in (PC + mobile). Idempotent — already-signed is fine. */
export async function runSignin(uid) {
  const user = getUser(uid)
  if (!user) return { ok: false, message: 'user not found' }
  const results = []
  for (const type of [0, 1]) {
    try {
      const res = await dailySignin(type, user.cookie)
      const label = type === 0 ? 'PC' : '移动'
      if (res?.code === 200) {
        results.push(`${label}签到成功 +${res.point ?? 0}`)
      } else if (res?.code === -2) {
        results.push(`${label}今日已签到`)
      } else {
        results.push(`${label}签到: ${res?.msg || res?.message || res?.code}`)
      }
    } catch (e) {
      results.push(`${type === 0 ? 'PC' : '移动'}签到失败: ${e.message}`)
    }
    await sleep(800)
  }
  const message = results.join('；')
  addLog(uid, 'signin', message, true)
  user.lastSignin = { at: Date.now(), message }
  save()
  return { ok: true, message }
}

async function getSongPoolIds(cookie) {
  const pool = getSongPool()
  if (pool.ids.length && Date.now() - pool.fetchedAt < POOL_TTL) {
    return pool.ids
  }
  const all = new Set()
  for (const pid of CHART_PLAYLISTS) {
    try {
      const ids = await playlistDetail(pid, cookie)
      ids.forEach((id) => all.add(id))
    } catch {
      /* ignore individual chart failures */
    }
    await sleep(500)
  }
  const ids = [...all]
  if (ids.length) setSongPool(ids)
  return ids.length ? ids : pool.ids
}

/**
 * Scrobble a batch of unique songs the account has not played before
 * (deduplicated via user.playedIds). Resets the dedup set once exhausted.
 */
export async function runScrobble(uid) {
  const user = getUser(uid)
  if (!user) return { ok: false, message: 'user not found' }
  const count = Math.max(1, Math.min(500, user.settings?.scrobbleCount || 300))

  const pool = await getSongPoolIds(user.cookie)
  if (!pool.length) {
    const message = '听歌打卡失败：歌曲池为空'
    addLog(uid, 'scrobble', message, false)
    return { ok: false, message }
  }

  let played = new Set(user.playedIds || [])
  let candidates = pool.filter((id) => !played.has(id))
  if (candidates.length < count) {
    // exhausted unique songs — reset dedup set and start a fresh cycle
    played = new Set()
    candidates = [...pool]
  }

  const batch = candidates.slice(0, count)
  let ok = 0
  for (const id of batch) {
    try {
      const time = 180 + Math.floor(Math.random() * 60)
      const res = await scrobble(id, time, user.cookie)
      if (res?.code === 200 || res?.data) ok += 1
      played.add(id)
    } catch {
      /* skip individual song failures */
    }
    await sleep(300 + Math.floor(Math.random() * 300))
  }

  const fresh = getUser(uid)
  fresh.playedIds = [...played].slice(-5000)
  const message = `听歌打卡完成：成功 ${ok}/${batch.length} 首（不重复）`
  fresh.lastScrobble = { at: Date.now(), count: ok, message }
  save()
  addLog(uid, 'scrobble', message, ok > 0)

  // refresh listen count so the UI reflects progress
  try {
    await refreshProfile(uid)
  } catch {
    /* non-fatal */
  }
  return { ok: ok > 0, message }
}

/** Run all enabled automations for one user. */
export async function runUserTasks(uid) {
  const user = getUser(uid)
  if (!user) return
  if (user.settings?.autoSignin) await runSignin(uid)
  if (user.settings?.autoScrobble) await runScrobble(uid)
}

export async function refreshAccountUid(cookie) {
  const info = await accountInfo(cookie)
  return info?.account?.id || info?.profile?.userId
}
