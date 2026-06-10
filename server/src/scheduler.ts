import { getAccountScheduler, getUser, listUsers } from './store.js'
import { logger } from './logger.js'
import {
  runPartnerEvaluate,
  runScrobble,
  runSignin,
  runUserTasks,
  runYunbeiTasks,
} from './tasks.js'
import type { NeteaseUser } from './types.js'

let loopActive = false // the continuous loop is currently running
let busy = false // a task batch is currently executing (manual or loop)
let lastCycleAt = 0 // when the last full loop cycle finished

/** Snapshot of scheduler state, exposed via the health endpoint. */
export function schedulerStatus(): {
  loopActive: boolean
  busy: boolean
  lastCycleAt: number
} {
  return { loopActive, busy, lastCycleAt }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Cycle gap: 20-40 min between full listen passes (realistic human session gaps)
const CYCLE_GAP_MIN_MS = 20 * 60 * 1000
const CYCLE_GAP_MAX_MS = 40 * 60 * 1000
const IDLE_GAP_MS = 60_000 // check for newly enabled users once a minute

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Transient failures (network hiccups, upstream 5xx) are retried with
// increasing delays before giving up for the current cycle.
const RETRY_DELAYS_MS = [5_000, 30_000]

async function withRetry(
  label: string,
  uid: number,
  fn: () => Promise<unknown>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn()
      return
    } catch (e) {
      if (attempt >= RETRY_DELAYS_MS.length) throw e
      const delay = RETRY_DELAYS_MS[attempt] ?? 30_000
      logger.warn(
        { uid, task: label, attempt: attempt + 1, err: errMessage(e) },
        'task failed, retrying',
      )
      await sleep(delay)
    }
  }
}

/** True if a timestamp falls within today (Asia/Shanghai). */
function isToday(ts: number | undefined): boolean {
  if (!ts) return false
  const opts: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Shanghai' }
  return (
    new Date(ts).toLocaleDateString('en-CA', opts) ===
    new Date().toLocaleDateString('en-CA', opts)
  )
}

/** Whether a hosted account's owner has 24/7 auto-listen enabled. */
function ownerEnabled(user: NeteaseUser): boolean {
  return !!(user.ownerId && getAccountScheduler(user.ownerId).enabled)
}

/** Manual one-shot: run all enabled tasks once for a single owner's accounts. */
export async function runAll(ownerId: string): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (const user of listUsers(ownerId)) {
      try {
        await runUserTasks(user.uid)
      } catch (e) {
        logger.error({ uid: user.uid, err: errMessage(e) }, 'scheduler task failed')
      }
    }
  } finally {
    busy = false
  }
}

/**
 * Continuous 24/7 auto-listen loop. Runs for the lifetime of the process and
 * only acts on accounts whose owner has enabled auto-listen. Daily sign-in /
 * yunbei tasks run once per day per account; listening repeats indefinitely.
 */
async function continuousLoop(): Promise<void> {
  if (loopActive) return
  loopActive = true
  logger.info('continuous 24/7 auto-listen worker started')
  for (;;) {
    const users = listUsers().filter(ownerEnabled)
    if (!users.length) {
      await sleep(IDLE_GAP_MS)
      continue
    }
    // Shuffle user order so the execution sequence varies each cycle
    for (let i = users.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[users[i], users[j]] = [users[j]!, users[i]!]
    }
    for (const user of users) {
      if (!ownerEnabled(user)) continue
      // Random jitter per user: 0-5 min before starting their tasks
      await sleep(Math.floor(Math.random() * 5 * 60 * 1000))
      busy = true
      try {
        const fresh = getUser(user.uid)
        if (user.settings.autoSignin && !isToday(fresh?.lastSignin?.at)) {
          await withRetry('signin', user.uid, () => runSignin(user.uid))
        }
        if (user.settings.autoTasks && !isToday(fresh?.lastYunbei?.at)) {
          await withRetry('yunbei', user.uid, () => runYunbeiTasks(user.uid))
        }
        if (user.settings.autoPartner) {
          const ineligibleToday =
            fresh?.lastPartner?.eligible === false && isToday(fresh?.lastPartner?.at)
          if (!ineligibleToday) {
            await withRetry('partner', user.uid, () => runPartnerEvaluate(user.uid))
          }
        }
        if (user.settings.autoScrobble) {
          await withRetry('scrobble', user.uid, () => runScrobble(user.uid))
        }
      } catch (e) {
        logger.error({ uid: user.uid, err: errMessage(e) }, 'scheduler loop failed')
      } finally {
        busy = false
      }
    }
    lastCycleAt = Date.now()
    // Random gap between cycles (20-40 minutes)
    const gap =
      CYCLE_GAP_MIN_MS + Math.floor(Math.random() * (CYCLE_GAP_MAX_MS - CYCLE_GAP_MIN_MS))
    await sleep(gap)
  }
}

/** Start the continuous auto-listen worker (idempotent). */
export function applySchedule(): void {
  if (!loopActive) void continuousLoop()
}
