import { getScheduler, getUser, listUsers } from './store.js'
import { runScrobble, runSignin, runUserTasks, runYunbeiTasks } from './tasks.js'

let loopActive = false // the continuous loop is currently running
let stopRequested = false // request the continuous loop to stop
let busy = false // a task batch is currently executing (manual or loop)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CYCLE_GAP_MS = 5000 // short breather between full listen cycles

/** True if a timestamp falls within today (Asia/Shanghai). */
function isToday(ts) {
  if (!ts) return false
  const opts = { timeZone: 'Asia/Shanghai' }
  return (
    new Date(ts).toLocaleDateString('en-CA', opts) ===
    new Date().toLocaleDateString('en-CA', opts)
  )
}

/** Manual one-shot: run all enabled tasks once for every account. */
async function runAll() {
  if (busy) return
  busy = true
  try {
    for (const user of listUsers()) {
      try {
        await runUserTasks(user.uid)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[scheduler] task failed for ${user.uid}:`, e.message)
      }
    }
  } finally {
    busy = false
  }
}

/**
 * Continuous 24/7 auto-listen loop. While enabled, it keeps scrobbling for
 * every account non-stop, cycle after cycle. Daily sign-in is performed once
 * per day per account; listening repeats indefinitely.
 */
async function continuousLoop() {
  if (loopActive) return
  loopActive = true
  stopRequested = false
  // eslint-disable-next-line no-console
  console.log('[scheduler] continuous 24/7 auto-listen started')
  try {
    while (!stopRequested) {
      const users = listUsers()
      if (!users.length) {
        await sleep(CYCLE_GAP_MS)
        continue
      }
      for (const user of users) {
        if (stopRequested) break
        busy = true
        try {
          const fresh = getUser(user.uid)
          if (user.settings?.autoSignin && !isToday(fresh?.lastSignin?.at)) {
            await runSignin(user.uid)
          }
          if (user.settings?.autoTasks && !isToday(fresh?.lastYunbei?.at)) {
            await runYunbeiTasks(user.uid)
          }
          if (user.settings?.autoScrobble) {
            await runScrobble(user.uid)
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error(`[scheduler] loop failed for ${user.uid}:`, e.message)
        } finally {
          busy = false
        }
      }
      if (!stopRequested) await sleep(CYCLE_GAP_MS)
    }
  } finally {
    loopActive = false
    // eslint-disable-next-line no-console
    console.log('[scheduler] continuous auto-listen stopped')
  }
}

/**
 * Start or stop the continuous auto-listen loop based on the persisted
 * `scheduler.enabled` flag. Enabling means 24/7 non-stop listening.
 */
export function applySchedule() {
  const { enabled } = getScheduler()
  if (enabled) {
    stopRequested = false
    if (!loopActive) continuousLoop()
  } else {
    stopRequested = true
  }
}

export { runAll }
