import cron from 'node-cron'
import { getScheduler, listUsers } from './store.js'
import { runUserTasks } from './tasks.js'

let task = null
let running = false

async function runAll() {
  if (running) return
  running = true
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
    running = false
  }
}

/** (Re)start the cron job from the persisted scheduler config. */
export function applySchedule() {
  if (task) {
    task.stop()
    task = null
  }
  const { cron: expr, enabled } = getScheduler()
  if (!enabled) return
  if (!cron.validate(expr)) {
    // eslint-disable-next-line no-console
    console.error(`[scheduler] invalid cron expression: ${expr}`)
    return
  }
  task = cron.schedule(expr, runAll, { timezone: 'Asia/Shanghai' })
  // eslint-disable-next-line no-console
  console.log(`[scheduler] active with cron "${expr}" (Asia/Shanghai)`)
}

export { runAll }
