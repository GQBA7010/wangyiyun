import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { Express, NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { pinoHttp } from 'pino-http'
import { config } from './config.js'
import { logger } from './logger.js'
import adminRouter from './routes/admin.js'
import apiRouter from './routes/api.js'
import authRouter from './routes/auth.js'
import { schedulerStatus } from './scheduler.js'
import { dbHealthy } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, '..', 'public')

/** Build the fully configured Express app (no listeners / background jobs). */
export function createApp(): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)

  // --- Observability ------------------------------------------------------
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

  // --- Security & platform middleware -------------------------------------
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

  // CSRF protection: cookies are SameSite=Lax; additionally reject
  // state-changing cross-origin requests whose Origin/Referer does not match
  // the request host.
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next()
      return
    }
    const source = req.headers.origin ?? req.headers.referer
    if (!source) {
      next() // non-browser clients (curl, scripts) don't send Origin
      return
    }
    try {
      if (new URL(String(source)).host !== req.headers.host) {
        res.status(403).json({ ok: false, error: '跨站请求被拒绝' })
        return
      }
    } catch {
      res.status(403).json({ ok: false, error: '跨站请求被拒绝' })
      return
    }
    next()
  })

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

  // --- Routes --------------------------------------------------------------
  app.get('/api/health', (_req: Request, res: Response) => {
    const db = dbHealthy()
    res.status(db ? 200 : 503).json({
      ok: db,
      ts: Date.now(),
      uptime: Math.floor(process.uptime()),
      db: db ? 'up' : 'down',
      scheduler: schedulerStatus(),
      smtp: config.smtpEnabled,
    })
  })
  app.use('/api/auth', authRouter)
  app.use('/api/admin', adminRouter)
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

  return app
}
