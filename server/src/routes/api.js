import { Router } from 'express'
import { accountInfo, qrCheck, qrKey, qrUrl } from '../netease/api.js'
import {
  getScheduler,
  getUser,
  listUsers,
  removeUser,
  setScheduler,
  updateSettings,
  upsertUser,
} from '../store.js'
import { applySchedule } from '../scheduler.js'
import { refreshProfile, runScrobble, runSignin } from '../tasks.js'

const router = Router()

/** Strip sensitive fields (cookie) before sending a user to the client. */
function sanitize(user) {
  if (!user) return null
  const { cookie, playedIds, ...rest } = user
  return { ...rest, playedCount: (playedIds || []).length }
}

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    res.status(500).json({ ok: false, error: e.message }),
  )

// --- QR login -------------------------------------------------------------

router.post(
  '/login/qr/key',
  asyncH(async (_req, res) => {
    const key = await qrKey()
    if (!key) return res.status(502).json({ ok: false, error: '获取二维码失败' })
    res.json({ ok: true, key, qrurl: qrUrl(key) })
  }),
)

router.get(
  '/login/qr/check',
  asyncH(async (req, res) => {
    const key = String(req.query.key || '')
    if (!key) return res.status(400).json({ ok: false, error: 'missing key' })
    const result = await qrCheck(key)
    if (result.code === 803 && result.cookie) {
      const info = await accountInfo(result.cookie)
      const uid = info?.account?.id || info?.profile?.userId
      if (!uid) {
        return res.json({ ok: true, code: 803, error: '登录态获取失败，请重试' })
      }
      upsertUser({
        uid,
        cookie: result.cookie,
        nickname: info?.profile?.nickname,
        avatarUrl: info?.profile?.avatarUrl,
      })
      try {
        await refreshProfile(uid)
      } catch {
        /* non-fatal */
      }
      return res.json({ ok: true, code: 803, user: sanitize(getUser(uid)) })
    }
    res.json({
      ok: true,
      code: result.code,
      message: result.message,
      nickname: result.nickname,
      avatarUrl: result.avatarUrl,
    })
  }),
)

// --- Users ----------------------------------------------------------------

router.get('/users', (_req, res) => {
  res.json({ ok: true, users: listUsers().map(sanitize) })
})

router.delete('/users/:uid', (req, res) => {
  removeUser(req.params.uid)
  res.json({ ok: true })
})

router.post('/users/:uid/settings', (req, res) => {
  const user = updateSettings(req.params.uid, req.body || {})
  if (!user) return res.status(404).json({ ok: false, error: 'user not found' })
  res.json({ ok: true, user: sanitize(user) })
})

router.post(
  '/users/:uid/signin',
  asyncH(async (req, res) => {
    const result = await runSignin(req.params.uid)
    res.json({ ...result, user: sanitize(getUser(req.params.uid)) })
  }),
)

router.post(
  '/users/:uid/scrobble',
  asyncH(async (req, res) => {
    const result = await runScrobble(req.params.uid)
    res.json({ ...result, user: sanitize(getUser(req.params.uid)) })
  }),
)

router.post(
  '/users/:uid/refresh',
  asyncH(async (req, res) => {
    await refreshProfile(req.params.uid)
    res.json({ ok: true, user: sanitize(getUser(req.params.uid)) })
  }),
)

// --- Scheduler ------------------------------------------------------------

router.get('/scheduler', (_req, res) => {
  res.json({ ok: true, scheduler: getScheduler() })
})

router.post('/scheduler', (req, res) => {
  const scheduler = setScheduler(req.body || {})
  applySchedule()
  res.json({ ok: true, scheduler })
})

export default router
