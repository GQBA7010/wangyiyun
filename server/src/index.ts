import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { config } from './config.js'
import { logger } from './logger.js'
import apiRouter from './routes/api.js'
import authRouter from './routes/auth.js'
import { applySchedule } from './scheduler.js'
import { startBackups } from './db.js'
import { load } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', config.trustProxy)

// --- Observability --------------------------------------------------------
app.use(
  pinoHttp({
    logger,
    // Quiet, structured access logs; redact the auth cookie from request logs.
    redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
  }),
)

// --- Security & platform middleware ---------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
)
app.use(compression())
app.use(express.json({ limit: '256kb' }))
app.use(express.urlencoded({ extended: true, limit: '256kb' }))
app.use(cookieParser())

// Coarse global rate limit as a backstop against abuse.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: '请求过于频繁，请稍后再试' },
  }),
)

// --- Routes ---------------------------------------------------------------
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: Date.now() })
})
app.use('/api/auth', authRouter)
app.use('/api', apiRouter)

// Serve the built frontend (web/dist copied to server/public on build).
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR))
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
  })
}

// Centralised error handler: never leak stack traces to clients.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err)
  req.log?.error({ err: message }, 'unhandled request error')
  if (res.headersSent) return
  res.status(500).json({ ok: false, error: '服务器内部错误' })
})

load()
startBackups()
applySchedule()

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
