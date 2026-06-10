import { Router } from 'express'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { z } from 'zod'
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
import { requireAccount, requireAuth, requireOwnedUser } from '../security/auth.js'
import {
  checkUserSession,
  refreshProfile,
  runPartnerEvaluate,
  runScrobble,
  runSignin,
  runYunbeiTasks,
} from '../tasks.js'
import type { NeteaseUser, Settings } from '../types.js'

const router = Router()

// Every endpoint below requires an authenticated platform account.
router.use(requireAuth)

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Strip sensitive / internal fields before sending a user to the client. */
function sanitize(user: NeteaseUser | null | undefined) {
  if (!user) return null
  const { cookie: _cookie, playedIds, ownerId: _ownerId, ...rest } = user
  return {
    ...rest,
    playedCount: (playedIds || []).length,
    status: user.status ?? 'unknown',
  }
}

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>

const asyncH =
  (fn: AsyncHandler): RequestHandler =>
  (req, res) => {
    fn(req, res).catch((e: unknown) => {
      res.status(500).json({ ok: false, error: errMessage(e) })
    })
  }

/**
 * Resolve `:uid` to a hosted account owned by the caller, enforcing tenant
 * isolation. Responds 404 (not 403) so owners can't probe others' uids.
 */
function ownUser(req: Request, res: Response, next: NextFunction): void {
  const user = getOwnedUser(requireAccount(req).id, req.params.uid ?? '')
  if (!user) {
    res.status(404).json({ ok: false, error: '账号不存在' })
    return
  }
  req.neteaseUser = user
  next()
}

// --- QR login (binds the new NetEase account to the current platform user) -

router.post(
  '/login/qr/key',
  asyncH(async (_req, res) => {
    const key = await qrKey()
    if (!key) return res.status(502).json({ ok: false, error: '获取二维码失败' })
    return res.json({ ok: true, key, qrurl: qrUrl(key) })
  }),
)

router.get(
  '/login/qr/check',
  asyncH(async (req, res) => {
    const key = typeof req.query.key === 'string' ? req.query.key : ''
    if (!key) return res.status(400).json({ ok: false, error: 'missing key' })
    const result = await qrCheck(key)
    if (result.code === 803 && result.cookie) {
      const info = await accountInfo(result.cookie)
      const uid = info.account?.id ?? info.profile?.userId
      if (!uid) {
        return res.json({ ok: true, code: 803, error: '登录态获取失败，请重试' })
      }
      // Refuse to hijack a NetEase account already hosted by someone else.
      const existing = getUser(uid)
      const account = requireAccount(req)
      if (existing?.ownerId && existing.ownerId !== account.id) {
        return res.json({ ok: true, code: 803, error: '该网易云账号已被其他用户托管' })
      }
      upsertUser({
        uid,
        ownerId: account.id,
        cookie: result.cookie,
        nickname: info.profile?.nickname,
        avatarUrl: info.profile?.avatarUrl,
      })
      try {
        await refreshProfile(uid)
      } catch {
        /* non-fatal */
      }
      return res.json({ ok: true, code: 803, user: sanitize(getUser(uid)) })
    }
    return res.json({
      ok: true,
      code: result.code,
      message: result.message,
      nickname: result.nickname,
      avatarUrl: result.avatarUrl,
    })
  }),
)

// --- Hosted accounts (scoped to the caller) -------------------------------

router.get('/users', (req: Request, res: Response) => {
  res.json({ ok: true, users: listUsers(requireAccount(req).id).map(sanitize) })
})

router.delete('/users/:uid', ownUser, (req: Request, res: Response) => {
  removeUser(requireOwnedUser(req).uid)
  res.json({ ok: true })
})

const settingsSchema = z
  .object({
    autoSignin: z.coerce.boolean(),
    autoScrobble: z.coerce.boolean(),
    autoTasks: z.coerce.boolean(),
    autoPartner: z.coerce.boolean(),
    scrobbleCount: z.coerce.number(),
    partnerScore: z.coerce.number(),
  })
  .partial()

router.post('/users/:uid/settings', ownUser, (req: Request, res: Response) => {
  const parsed = settingsSchema.safeParse(req.body)
  const body = parsed.success ? parsed.data : {}
  const patch: Partial<Settings> = {}
  if (body.autoSignin !== undefined) patch.autoSignin = body.autoSignin
  if (body.autoScrobble !== undefined) patch.autoScrobble = body.autoScrobble
  if (body.autoTasks !== undefined) patch.autoTasks = body.autoTasks
  if (body.autoPartner !== undefined) patch.autoPartner = body.autoPartner
  if (body.scrobbleCount !== undefined) {
    patch.scrobbleCount = Math.max(1, Math.min(500, body.scrobbleCount || 300))
  }
  if (body.partnerScore !== undefined) {
    patch.partnerScore = Math.max(1, Math.min(4, body.partnerScore || 3))
  }
  const uid = requireOwnedUser(req).uid
  const user = updateSettings(uid, patch)
  res.json({ ok: true, user: sanitize(user) })
})

router.post(
  '/users/:uid/signin',
  ownUser,
  asyncH(async (req, res) => {
    const uid = requireOwnedUser(req).uid
    const result = await runSignin(uid)
    res.json({ ...result, user: sanitize(getUser(uid)) })
  }),
)

router.post(
  '/users/:uid/scrobble',
  ownUser,
  asyncH(async (req, res) => {
    const uid = requireOwnedUser(req).uid
    const result = await runScrobble(uid)
    res.json({ ...result, user: sanitize(getUser(uid)) })
  }),
)

router.post(
  '/users/:uid/refresh',
  ownUser,
  asyncH(async (req, res) => {
    const uid = requireOwnedUser(req).uid
    await refreshProfile(uid)
    res.json({ ok: true, user: sanitize(getUser(uid)) })
  }),
)

router.post(
  '/users/:uid/check',
  ownUser,
  asyncH(async (req, res) => {
    const uid = requireOwnedUser(req).uid
    const { valid } = await checkUserSession(uid)
    res.json({ ok: true, valid, user: sanitize(getUser(uid)) })
  }),
)

router.post(
  '/users/:uid/tasks',
  ownUser,
  asyncH(async (req, res) => {
    const uid = requireOwnedUser(req).uid
    const result = await runYunbeiTasks(uid)
    res.json({ ...result, user: sanitize(getUser(uid)) })
  }),
)

router.post(
  '/users/:uid/partner',
  ownUser,
  asyncH(async (req, res) => {
    const uid = requireOwnedUser(req).uid
    const result = await runPartnerEvaluate(uid)
    // The HTTP request always succeeds; an ineligible account is a normal
    // outcome conveyed via `eligible`/`message`, not a transport error.
    res.json({
      ok: true,
      message: result.message,
      eligible: result.eligible,
      evaluated: result.evaluated,
      user: sanitize(getUser(uid)),
    })
  }),
)

// --- Per-user scheduler ---------------------------------------------------

router.get('/scheduler', (req: Request, res: Response) => {
  res.json({ ok: true, scheduler: getAccountScheduler(requireAccount(req).id) })
})

const schedulerSchema = z.object({ enabled: z.coerce.boolean().optional() })

router.post('/scheduler', (req: Request, res: Response) => {
  const parsed = schedulerSchema.safeParse(req.body)
  const scheduler = setAccountScheduler(requireAccount(req).id, {
    enabled: parsed.success ? !!parsed.data.enabled : false,
  })
  res.json({ ok: true, scheduler })
})

// --- Run all of the caller's enabled tasks now ----------------------------

router.post('/run-all', (req: Request, res: Response) => {
  void runAll(requireAccount(req).id)
  res.json({ ok: true, message: '已触发全部任务' })
})

export default router
