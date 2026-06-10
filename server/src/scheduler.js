import { getAccountScheduler, getUser, listUsers } from './store.js'
import { runScrobble, runSignin, runUserTasks, runYunbeiTasks } from './tasks.js'

let loopActive = false // the continuous loop is currently running
let busy = false // a task batch is currently executing (manual or loop)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CYCLE_GAP_MS = 5000 // short breather between full listen cycles
const IDLE_GAP_MS = 15000 // longer wait when nobody has auto-listen enabled

/** True if a timestamp falls within today (Asia/Shanghai). */
function isToday(ts) {
  if (!ts) return false
  const opts = { timeZone: 'Asia/Shanghai' }
  return (
    new Date(ts).toLocaleDateString('en-CA', opts) ===
    new Date().toLocaleDateString('en-CA', opts)
  )
}

/** Whether a hosted account's owner has 24/7 auto-listen enabled. */
function ownerEnabled(user) {
  return !!getAccountScheduler(user.ownerId)?.enabled
}

/** Manual one-shot: run all enabled tasks once for a single owner's accounts. */
async function runAll(ownerId) {
  if (busy) return
  busy = true
  try {
    for (const user of listUsers(ownerId)) {
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
 * Continuous 24/7 auto-listen loop. Runs for the lifetime of the process and
 * only acts on accounts whose owner has enabled auto-listen. Daily sign-in /
 * yunbei tasks run once per day per account; listening repeats indefinitely.
 */
async function continuousLoop() {
  if (loopActive) return
  loopActive = true
  // eslint-disable-next-line no-console
  console.log('[scheduler] continuous 24/7 auto-listen worker started')
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const users = listUsers().filter(ownerEnabled)
    if (!users.length) {
      await sleep(IDLE_GAP_MS)
      continue
    }
    for (const user of users) {
      if (!ownerEnabled(user)) continue
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
    await sleep(CYCLE_GAP_MS)
  }
}

/** Start the continuous auto-listen worker (idempotent). */
export function applySchedule() {
  if (!loopActive) continuousLoop()
}

export { runAll }
