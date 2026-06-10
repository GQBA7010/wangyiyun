import {
  accountInfo,
  checkSession,
  dailySignin,
  likeSong,
  partnerDailyTasks,
  partnerEvaluate,
  partnerExtraTasks,
  partnerReportListen,
  playlistDetail,
  scrobble,
  userDetail,
  yunbeiTaskFinish,
  yunbeiTasksTodo,
} from './netease/api.js'
import type { PartnerWork } from './netease/api.js'
import { getFingerprint, type DeviceFingerprint } from './netease/fingerprint.js'
import {
  addLog,
  getAccountById,
  getSongPool,
  getUser,
  save,
  setSongPool,
  upsertUser,
} from './store.js'
import { notifyCookieExpired } from './mail.js'
import type { NeteaseUser } from './types.js'

export interface TaskResult {
  ok: boolean
  message: string
}

/** Real-time progress of a scrobble batch for a hosted account. */
export interface ScrobbleProgress {
  uid: number
  startedAt: number
  current: number
  total: number
  /** Estimated seconds remaining based on average gap between songs. */
  estimatedRemaining: number
}

// Global map tracking accounts currently in a scrobble batch.
const activeScrobbles = new Map<number, ScrobbleProgress>()

/** Get current listening status for a set of UIDs (or all if empty). */
export function getScrobbleStatus(uids?: number[]): ScrobbleProgress[] {
  if (!uids || !uids.length) return [...activeScrobbles.values()]
  return uids
    .map((uid) => activeScrobbles.get(uid))
    .filter((v): v is ScrobbleProgress => !!v)
}

export interface PartnerResult extends TaskResult {
  eligible?: boolean
  evaluated?: number
}

export interface YunbeiResult extends TaskResult {
  claimed?: number
  total?: number
}

// Well-known public chart playlists used to source a large, varied pool of
// song ids for listen-count farming.
const CHART_PLAYLISTS = [
  3778678, // 热歌榜
  3779629, // 新歌榜
  19723756, // 飙升榜
  2884035, // 原创榜
]

const POOL_TTL = 6 * 60 * 60 * 1000 // refresh song pool every 6h

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Mark a hosted account as expired and email its owner once (only on the
 * first transition into the expired state, to avoid notification spam).
 */
function markExpired(uid: number): void {
  const user = getUser(uid)
  if (!user) return
  const wasExpired = user.status === 'expired'
  upsertUser({ uid, status: 'expired' })
  if (!wasExpired && user.ownerId) {
    const owner = getAccountById(user.ownerId)
    if (owner?.email) {
      void notifyCookieExpired(owner.email, user.nickname ?? '', uid)
    }
  }
}

/** Resolve the device fingerprint for a hosted account. */
function fp(user: NeteaseUser): DeviceFingerprint {
  return getFingerprint(user.uid, user.province)
}

/** Check whether the account cookie is still valid and update status. */
export async function checkUserSession(uid: number): Promise<{ valid: boolean }> {
  const user = getUser(uid)
  if (!user) return { valid: false }
  const valid = await checkSession(user.cookie, fp(user))
  if (valid) upsertUser({ uid, status: 'active' })
  else markExpired(uid)
  return { valid }
}

/** Refresh account profile (level / listenSongs / nickname / province / city). */
export async function refreshProfile(uid: number): Promise<NeteaseUser | undefined> {
  const user = getUser(uid)
  if (!user) return undefined
  const detail = await userDetail(uid, user.cookie, fp(user))
  if (detail.profile) {
    return upsertUser({
      uid,
      nickname: detail.profile.nickname ?? user.nickname,
      avatarUrl: detail.profile.avatarUrl ?? user.avatarUrl,
      level: detail.level ?? user.level,
      listenSongs: detail.listenSongs ?? user.listenSongs,
      province: detail.profile.province ?? user.province,
      city: detail.profile.city ?? user.city,
      status: 'active',
    })
  }
  // profile fetch failed — might be expired
  if (detail.code === 301 || detail.code === -462) {
    markExpired(uid)
  }
  return user
}

/** Run daily sign-in (PC + mobile). Idempotent — already-signed is fine. */
export async function runSignin(uid: number): Promise<TaskResult> {
  const user = getUser(uid)
  if (!user) return { ok: false, message: 'user not found' }
  const f = fp(user)
  const results: string[] = []
  for (const type of [0, 1]) {
    try {
      const res = await dailySignin(type, user.cookie, f)
      const label = type === 0 ? 'PC' : '移动'
      if (res.code === 200) {
        results.push(`${label}签到成功 +${res.point ?? 0}`)
      } else if (res.code === -2) {
        results.push(`${label}今日已签到`)
      } else {
        results.push(`${label}签到: ${res.msg ?? res.message ?? res.code}`)
      }
    } catch (e) {
      results.push(`${type === 0 ? 'PC' : '移动'}签到失败: ${errMessage(e)}`)
    }
    // Realistic delay between PC & mobile sign-in (5-30s)
    await sleep(5000 + Math.floor(Math.random() * 25000))
  }
  const message = results.join('；')
  addLog(uid, 'signin', message, true)
  user.lastSignin = { at: Date.now(), message }
  save()
  return { ok: true, message }
}

async function getSongPoolIds(
  cookie: string | undefined,
  f?: DeviceFingerprint,
): Promise<number[]> {
  const pool = getSongPool()
  if (pool.ids.length && Date.now() - pool.fetchedAt < POOL_TTL) {
    return pool.ids
  }
  const all = new Set<number>()
  for (const pid of CHART_PLAYLISTS) {
    try {
      const ids = await playlistDetail(pid, cookie, f)
      ids.forEach((id) => all.add(id))
    } catch {
      /* ignore individual chart failures */
    }
    await sleep(1000 + Math.floor(Math.random() * 2000))
  }
  const ids = [...all]
  if (ids.length) setSongPool(ids)
  return ids.length ? ids : pool.ids
}

/**
 * Scrobble a batch of unique songs the account has not played before
 * (deduplicated via user.playedIds). Resets the dedup set once exhausted.
 */
export async function runScrobble(uid: number): Promise<TaskResult> {
  const user = getUser(uid)
  if (!user) return { ok: false, message: 'user not found' }
  // Smaller batches per cycle to look more natural (15-40 songs)
  const maxCount = Math.max(1, Math.min(500, user.settings.scrobbleCount || 300))
  const count = Math.min(maxCount, 15 + Math.floor(Math.random() * 26))
  const f = fp(user)

  const pool = await getSongPoolIds(user.cookie, f)
  if (!pool.length) {
    const message = '听歌打卡失败：歌曲池为空'
    addLog(uid, 'scrobble', message, false)
    return { ok: false, message }
  }

  let played = new Set<number>(user.playedIds || [])
  let candidates = pool.filter((id) => !played.has(id))
  if (candidates.length < count) {
    played = new Set()
    candidates = [...pool]
  }

  // Shuffle candidates so the listening order varies
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]
  }

  const batch = candidates.slice(0, count)
  let ok = 0

  // Track progress for real-time status
  const avgGapSec = 75 // average gap ~75s (30-120s range)
  activeScrobbles.set(uid, {
    uid,
    startedAt: Date.now(),
    current: 0,
    total: batch.length,
    estimatedRemaining: batch.length * avgGapSec,
  })

  try {
    for (let i = 0; i < batch.length; i++) {
      const id = batch[i]!
      // Update progress
      activeScrobbles.set(uid, {
        uid,
        startedAt: activeScrobbles.get(uid)!.startedAt,
        current: i + 1,
        total: batch.length,
        estimatedRemaining: Math.max(0, (batch.length - i - 1) * avgGapSec),
      })
      try {
        // Realistic play duration: 120-300s with ±15% variation
        const base = 120 + Math.floor(Math.random() * 180)
        const jitter = Math.floor(base * (Math.random() * 0.3 - 0.15))
        const time = base + jitter
        const res = await scrobble(id, time, user.cookie, '', f)
        if (res.code === 200 || res.data) ok += 1
        played.add(id)
      } catch {
        /* skip individual song failures */
      }
      // Realistic gap between songs: 30-120s (simulates actual listening)
      if (i < batch.length - 1) {
        await sleep(30000 + Math.floor(Math.random() * 90000))
      }
    }
  } finally {
    activeScrobbles.delete(uid)
  }

  const fresh = getUser(uid)
  const message = `听歌打卡完成：成功 ${ok}/${batch.length} 首（不重复）`
  if (fresh) {
    fresh.playedIds = [...played].slice(-5000)
    fresh.lastScrobble = { at: Date.now(), count: ok, message }
    save()
  }
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
export async function runYunbeiTasks(uid: number): Promise<YunbeiResult> {
  const user = getUser(uid)
  if (!user) return { ok: false, message: 'user not found' }
  const f = fp(user)

  const todoRes = await yunbeiTasksTodo(user.cookie, f)
  const tasks = todoRes.data ?? []
  if (!tasks.length) {
    const message = '云贝任务：暂无待办任务'
    addLog(uid, 'yunbei', message, true)
    return { ok: true, message, claimed: 0, total: 0 }
  }

  let claimed = 0
  const details: string[] = []

  for (const task of tasks) {
    await sleep(2000 + Math.floor(Math.random() * 5000))

    // Task already completed and claimable
    if (task.userTaskId && task.userTaskId > 0) {
      try {
        const res = await yunbeiTaskFinish(
          task.userTaskId,
          task.depositCode ?? 0,
          user.cookie,
          f,
        )
        if (res.code === 200) {
          claimed += 1
          details.push(`${task.taskName} +${task.taskPoint}云贝 ✓`)
        } else {
          details.push(`${task.taskName} 领取失败(${res.code})`)
        }
      } catch {
        details.push(`${task.taskName} 领取异常`)
      }
      continue
    }

    // Try to auto-complete "收藏歌曲" by liking a random song
    if (task.taskName?.includes('收藏') || task.taskName?.includes('喜欢')) {
      try {
        const pool = await getSongPoolIds(user.cookie, f)
        if (pool.length) {
          const songId = pool[Math.floor(Math.random() * pool.length)] as number
          const res = await likeSong(songId, user.cookie, f)
          if (res.code === 200) {
            details.push(`${task.taskName} → 已收藏歌曲${songId}`)
          } else {
            details.push(`${task.taskName} 收藏受限(${res.code})`)
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
    await sleep(3000 + Math.floor(Math.random() * 3000))
    try {
      const recheck = await yunbeiTasksTodo(user.cookie, f)
      for (const t of recheck.data ?? []) {
        if (t.userTaskId && t.userTaskId > 0) {
          const res = await yunbeiTaskFinish(
            t.userTaskId,
            t.depositCode ?? 0,
            user.cookie,
            f,
          )
          if (res.code === 200) {
            claimed += 1
            details.push(`${t.taskName} +${t.taskPoint}云贝 ✓(自动)`)
          }
        }
      }
    } catch {
      /* non-fatal recheck */
    }
  }

  const message = `云贝任务：${tasks.length}项待办，领取${claimed}项${
    details.length ? '（' + details.join('；') + '）' : ''
  }`
  addLog(uid, 'yunbei', message, true)
  const fresh = getUser(uid)
  if (fresh) {
    fresh.lastYunbei = { at: Date.now(), message, claimed, total: tasks.length }
    save()
  }
  return { ok: true, message, claimed, total: tasks.length }
}

/** Decide an evaluation score (1-5) for a work using the owner's strategy. */
function pickPartnerScore(work: PartnerWork | undefined, strategy = 3): number {
  const hasEnglish = /[a-zA-Z]/.test(`${work?.name ?? ''}${work?.authorName ?? ''}`)
  if (strategy === 1) return hasEnglish ? 2 : 1
  if (strategy === 2) return hasEnglish ? 3 : 2
  if (strategy === 4) return 4
  return hasEnglish ? 4 : 3 // strategy 3 (default, 3-4 分)
}

const PARTNER_EXTRA_CAP = 7 // daily bonus-evaluation cap

/**
 * Music Partner (音乐合伙人) auto-evaluation. Fetches the day's pending works
 * and submits a rating for each (base works + up to 7 bonus works). Idempotent
 * within a day — already-evaluated works are skipped, so re-running on every
 * refresh simply rates anything newly available ("刷新了就评价").
 *
 * Gracefully degrades when the account has no partner qualification.
 */
export async function runPartnerEvaluate(uid: number): Promise<PartnerResult> {
  const user = getUser(uid)
  if (!user) return { ok: false, message: 'user not found' }
  const strategy = Math.max(1, Math.min(4, Number(user.settings.partnerScore) || 3))
  const f = fp(user)

  let daily
  try {
    daily = await partnerDailyTasks(user.cookie, f)
  } catch (e) {
    const message = `音乐合伙人：获取任务失败 ${errMessage(e)}`
    addLog(uid, 'partner', message, false)
    return { ok: false, message }
  }

  // No qualification / not invited -> record once and bail (no spam).
  if (!daily || daily.code !== 200 || !daily.data) {
    const ineligible =
      daily?.code === 405 ||
      /资格|权限|未授权|not.*partner/i.test(daily?.message ?? daily?.msg ?? '')
    const message = ineligible
      ? '音乐合伙人：当前账号暂无测评资格'
      : `音乐合伙人：暂不可用（${daily?.code ?? '无响应'}）`
    addLog(uid, 'partner', message, false)
    const fresh0 = getUser(uid)
    if (fresh0) {
      fresh0.lastPartner = { at: Date.now(), message, eligible: false, evaluated: 0 }
      save()
    }
    return { ok: false, eligible: false, message }
  }

  const data = daily.data
  const taskId = data.id
  const baseWorks = Array.isArray(data.works) ? data.works : []
  let evaluated = 0
  let baseDone = 0

  // Base daily works.
  for (const t of baseWorks) {
    if (t.completed || !t.work?.id) continue
    try {
      const score = pickPartnerScore(t.work, strategy)
      const res = await partnerEvaluate(
        { taskId, workId: t.work.id, score },
        user.cookie,
        f,
      )
      if (res.code === 200) {
        evaluated += 1
        baseDone += 1
      }
    } catch {
      /* skip individual work failures */
    }
    await sleep(1500 + Math.floor(Math.random() * 1500))
  }

  // Bonus (extra) works: report a listen first, then evaluate, up to the cap.
  let extraDone = 0
  try {
    const extraRes = await partnerExtraTasks(user.cookie, f)
    if (extraRes.code === 200 && Array.isArray(extraRes.data)) {
      const pending = extraRes.data.filter((t) => !t.completed && t.work?.id)
      for (const t of pending) {
        if (extraDone >= PARTNER_EXTRA_CAP) break
        const work = t.work
        if (!work?.id) continue
        try {
          await partnerReportListen(
            { workId: work.id, resourceId: work.resourceId },
            user.cookie,
            f,
          )
          await sleep(2000 + Math.floor(Math.random() * 3000))
          const score = pickPartnerScore(work, strategy)
          const res = await partnerEvaluate(
            { taskId, workId: work.id, score, extra: true },
            user.cookie,
            f,
          )
          if (res.code === 200) {
            evaluated += 1
            extraDone += 1
          }
        } catch {
          /* skip individual bonus failures */
        }
        await sleep(3000 + Math.floor(Math.random() * 5000))
      }
    }
  } catch {
    /* extra list is best-effort */
  }

  const message =
    evaluated > 0
      ? `音乐合伙人：本轮评测 ${evaluated} 首（基础 ${baseDone} · 加分 ${extraDone}）`
      : `音乐合伙人：暂无待评测作品（今日 ${data.completedCount ?? 0}/${data.count ?? 0}）`
  addLog(uid, 'partner', message, true)
  const fresh = getUser(uid)
  if (fresh) {
    fresh.lastPartner = { at: Date.now(), message, eligible: true, evaluated }
    save()
  }
  return { ok: true, eligible: true, message, evaluated }
}

/** Run all enabled automations for one user. */
export async function runUserTasks(uid: number): Promise<void> {
  const user = getUser(uid)
  if (!user) return
  if (user.settings.autoSignin) await runSignin(uid)
  if (user.settings.autoScrobble) await runScrobble(uid)
  if (user.settings.autoTasks) await runYunbeiTasks(uid)
  if (user.settings.autoPartner) await runPartnerEvaluate(uid)
}

export async function refreshAccountUid(cookie: string): Promise<number | undefined> {
  // No fingerprint yet — this runs during QR login before the uid is known
  const info = await accountInfo(cookie)
  return info.account?.id ?? info.profile?.userId
}
