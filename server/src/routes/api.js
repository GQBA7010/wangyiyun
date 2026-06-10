import { Router } from 'express'
import { accountInfo, qrCheck, qrKey, qrUrl } from '../netease/api.js'
import {
  getAccountScheduler,
  getOwnedUser,
  getUser,
  listUsers,
  removeUser,
  setAccountScheduler,
  updateSettings,
  upsertUser,
} from '../store.js'
import { runAll } from '../scheduler.js'
import { requireAuth } from '../security/auth.js'
import {
  checkUserSession,
  refreshProfile,
  runPartnerEvaluate,
  runScrobble,
  runSignin,
  runYunbeiTasks,
} from '../tasks.js'

const router = Router()

// Every endpoint below requires an authenticated platform account.
router.use(requireAuth)

/** Strip sensitive / internal fields before sending a user to the client. */
function sanitize(user) {
  if (!user) return null
  const { cookie, playedIds, ownerId, ...rest } = user
  return { ...rest, playedCount: (playedIds || []).length, status: user.status || 'unknown' }
}

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    res.status(500).json({ ok: false, error: e.message }),
  )

/**
 * Resolve `:uid` to a hosted account owned by the caller, enforcing tenant
 * isolation. Responds 404 (not 403) so owners can't probe others' uids.
 */
function ownUser(req, res, next) {
  const user = getOwnedUser(req.account.id, req.params.uid)
  if (!user) return res.status(404).json({ ok: false, error: '账号不存在' })
  req.neteaseUser = user
  next()
}

// --- QR login (binds the new NetEase account to the current platform user) -

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
      // Refuse to hijack a NetEase account already hosted by someone else.
      const existing = getUser(uid)
      if (existing && existing.ownerId && existing.ownerId !== req.account.id) {
        return res.json({ ok: true, code: 803, error: '该网易云账号已被其他用户托管' })
      }
      upsertUser({
        uid,
        ownerId: req.account.id,
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

// --- Hosted accounts (scoped to the caller) -------------------------------

router.get('/users', (req, res) => {
  res.json({ ok: true, users: listUsers(req.account.id).map(sanitize) })
})

router.delete('/users/:uid', ownUser, (req, res) => {
  removeUser(req.params.uid)
  res.json({ ok: true })
})

router.post('/users/:uid/settings', ownUser, (req, res) => {
  const body = req.body || {}
  const patch = {}
  for (const key of ['autoSignin', 'autoScrobble', 'autoTasks', 'autoPartner']) {
    if (key in body) patch[key] = Boolean(body[key])
  }
  if ('scrobbleCount' in body) {
    patch.scrobbleCount = Math.max(1, Math.min(500, Number(body.scrobbleCount) || 300))
  }
  if ('partnerScore' in body) {
    patch.partnerScore = Math.max(1, Math.min(4, Number(body.partnerScore) || 3))
  }
  const user = updateSettings(req.params.uid, patch)
  res.json({ ok: true, user: sanitize(user) })
})

router.post(
  '/users/:uid/signin',
  ownUser,
  asyncH(async (req, res) => {
    const result = await runSignin(req.params.uid)
    res.json({ ...result, user: sanitize(getUser(req.params.uid)) })
  }),
)

router.post(
  '/users/:uid/scrobble',
  ownUser,
  asyncH(async (req, res) => {
    const result = await runScrobble(req.params.uid)
    res.json({ ...result, user: sanitize(getUser(req.params.uid)) })
  }),
)

router.post(
  '/users/:uid/refresh',
  ownUser,
  asyncH(async (req, res) => {
    await refreshProfile(req.params.uid)
    res.json({ ok: true, user: sanitize(getUser(req.params.uid)) })
  }),
)

router.post(
  '/users/:uid/check',
  ownUser,
  asyncH(async (req, res) => {
    const { valid } = await checkUserSession(req.params.uid)
    res.json({ ok: true, valid, user: sanitize(getUser(req.params.uid)) })
  }),
)

router.post(
  '/users/:uid/tasks',
  ownUser,
  asyncH(async (req, res) => {
    const result = await runYunbeiTasks(req.params.uid)
    res.json({ ...result, user: sanitize(getUser(req.params.uid)) })
  }),
)

router.post(
  '/users/:uid/partner',
  ownUser,
  asyncH(async (req, res) => {
    const result = await runPartnerEvaluate(req.params.uid)
    // The HTTP request always succeeds; an ineligible account is a normal
    // outcome conveyed via `eligible`/`message`, not a transport error.
    res.json({
      ok: true,
      message: result.message,
      eligible: result.eligible,
      evaluated: result.evaluated,
      user: sanitize(getUser(req.params.uid)),
    })
  }),
)

// --- Per-user scheduler ---------------------------------------------------

router.get('/scheduler', (req, res) => {
  res.json({ ok: true, scheduler: getAccountScheduler(req.account.id) })
})

router.post('/scheduler', (req, res) => {
  const scheduler = setAccountScheduler(req.account.id, {
    enabled: Boolean(req.body?.enabled),
  })
  res.json({ ok: true, scheduler })
})

// --- Run all of the caller's enabled tasks now ----------------------------

router.post(
  '/run-all',
  asyncH(async (req, res) => {
    runAll(req.account.id)
    res.json({ ok: true, message: '已触发全部任务' })
  }),
)

export default router
