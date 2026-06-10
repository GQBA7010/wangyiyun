import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import apiRouter from './routes/api.js'
import { applySchedule } from './scheduler.js'
import { load } from './store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000
const PUBLIC_DIR = path.join(__dirname, '..', 'public')

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

app.use('/api', apiRouter)
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// Serve the built frontend (web/dist copied to server/public on build).
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'))
  })
}

load()
applySchedule()

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`网易云自动化服务已启动: http://localhost:${PORT}`)
})
