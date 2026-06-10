import {
  accountInfo,
  checkSession,
  dailySignin,
  likeSong,
  playlistDetail,
  scrobble,
  userDetail,
  yunbeiTaskFinish,
  yunbeiTasksTodo,
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

/** Check whether the account cookie is still valid and update status. */
export async function checkUserSession(uid) {
  const user = getUser(uid)
  if (!user) return { valid: false }
  const valid = await checkSession(user.cookie)
  upsertUser({ uid, status: valid ? 'active' : 'expired' })
  return { valid }
}

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
      status: 'active',
    })
  }
  // profile fetch failed — might be expired
  if (detail?.code === 301 || detail?.code === -462) {
    upsertUser({ uid, status: 'expired' })
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

/**
 * Run yunbei task center: check todo tasks, auto-complete doable ones
 * (e.g. like a song), and claim rewards for completed tasks.
 */
export async function runYunbeiTasks(uid) {
  const user = getUser(uid)
  if (!user) return { ok: false, message: 'user not found' }

  const todoRes = await yunbeiTasksTodo(user.cookie)
  const tasks = todoRes?.data || []
  if (!tasks.length) {
    const message = '云贝任务：暂无待办任务'
    addLog(uid, 'yunbei', message, true)
    return { ok: true, message, claimed: 0, total: 0 }
  }

  let claimed = 0
  const details = []

  for (const task of tasks) {
    await sleep(500 + Math.floor(Math.random() * 500))

    // Task already completed and claimable
    if (task.userTaskId && task.userTaskId > 0) {
      try {
        const res = await yunbeiTaskFinish(
          task.userTaskId,
          task.depositCode || 0,
          user.cookie,
        )
        if (res?.code === 200) {
          claimed += 1
          details.push(`${task.taskName} +${task.taskPoint}云贝 ✓`)
        } else {
          details.push(`${task.taskName} 领取失败(${res?.code})`)
        }
      } catch {
        details.push(`${task.taskName} 领取异常`)
      }
      continue
    }

    // Try to auto-complete "收藏歌曲" by liking a random song
    if (task.taskName?.includes('收藏') || task.taskName?.includes('喜欢')) {
      try {
        const pool = await getSongPoolIds(user.cookie)
        if (pool.length) {
          const songId = pool[Math.floor(Math.random() * pool.length)]
          const res = await likeSong(songId, user.cookie)
          if (res?.code === 200) {
            details.push(`${task.taskName} → 已收藏歌曲${songId}`)
          } else {
            details.push(`${task.taskName} 收藏受限(${res?.code})`)
          }
        }
      } catch {
        details.push(`${task.taskName} 自动收藏失败`)
      }
      continue
    }

    details.push(`${task.taskName} (待手动完成)`)
  }

  // Re-check for newly claimable tasks after auto-actions
  if (details.some((d) => d.includes('已收藏'))) {
    await sleep(2000)
    try {
      const recheck = await yunbeiTasksTodo(user.cookie)
      for (const t of recheck?.data || []) {
        if (t.userTaskId && t.userTaskId > 0) {
          const res = await yunbeiTaskFinish(
            t.userTaskId,
            t.depositCode || 0,
            user.cookie,
          )
          if (res?.code === 200) {
            claimed += 1
            details.push(`${t.taskName} +${t.taskPoint}云贝 ✓(自动)`)
          }
        }
      }
    } catch {
      /* non-fatal recheck */
    }
  }

  const message = `云贝任务：${tasks.length}项待办，领取${claimed}项${details.length ? '（' + details.join('；') + '）' : ''}`
  addLog(uid, 'yunbei', message, true)
  const fresh = getUser(uid)
  fresh.lastYunbei = { at: Date.now(), message, claimed, total: tasks.length }
  save()
  return { ok: true, message, claimed, total: tasks.length }
}

/** Run all enabled automations for one user. */
export async function runUserTasks(uid) {
  const user = getUser(uid)
  if (!user) return
  if (user.settings?.autoSignin) await runSignin(uid)
  if (user.settings?.autoScrobble) await runScrobble(uid)
  if (user.settings?.autoTasks) await runYunbeiTasks(uid)
}

export async function refreshAccountUid(cookie) {
  const info = await accountInfo(cookie)
  return info?.account?.id || info?.profile?.userId
}
