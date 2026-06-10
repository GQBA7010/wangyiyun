import { createApp } from './app.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { applySchedule } from './scheduler.js'
import { startBackups } from './db.js'
import { ensureDefaultAdmin, load } from './store.js'

load()
ensureDefaultAdmin()
startBackups()
applySchedule()

const app = createApp()

app.listen(config.port, () => {
  logger.info(`Lumen 控制台已启动: http://localhost:${config.port}`)
  if (!config.sessionSecret) {
    logger.warn(
      '未设置 SESSION_SECRET，已生成随机密钥并持久化到数据目录。' +
        '生产环境建议在环境变量中显式设置 SESSION_SECRET。',
    )
  }
  if (!config.cookieSecure) {
    logger.warn(
      'Cookie Secure 已关闭（COOKIE_SECURE=false）——仅建议在无 HTTPS 的内网使用。',
    )
  }
})
