import { Router } from 'express'
import type { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { config } from '../config.js'
import {
  changePassword,
  countAccounts,
  createAccount,
  getAccountByUsername,
  publicAccount,
  touchLogin,
} from '../store.js'
import { verifyPassword } from '../security/crypto.js'
import {
  clearSession,
  currentAccount,
  requireAuth,
  setSession,
} from '../security/auth.js'
import { createCaptcha, verifyCaptcha } from '../security/captcha.js'

const router = Router()

// Throttle auth attempts to deter credential-stuffing / brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: '尝试过于频繁，请稍后再试' },
})

const USERNAME_RE = /^[a-zA-Z0-9_.\u4e00-\u9fa5-]{3,32}$/

const credentialsSchema = z.object({
  username: z.string().optional().default(''),
  password: z.string().optional().default(''),
  captchaId: z.string().optional().default(''),
  captcha: z.string().optional().default(''),
})

type Credentials = z.infer<typeof credentialsSchema>

function parseBody(req: Request): Credentials {
  const result = credentialsSchema.safeParse(req.body)
  return result.success ? result.data : credentialsSchema.parse({})
}

function validateCredentials(username: string, password: string): string | null {
  if (!username || !USERNAME_RE.test(username)) {
    return '用户名需为 3–32 位字母、数字、下划线或中文'
  }
  if (password.length < config.minPasswordLength) {
    return `密码至少需 ${config.minPasswordLength} 位`
  }
  return null
}

// Issue a fresh image CAPTCHA challenge. Throttled by the global /api limiter.
router.get('/captcha', (_req: Request, res: Response) => {
  const { id, svg } = createCaptcha()
  res.set('Cache-Control', 'no-store')
  res.json({ ok: true, captchaId: id, svg })
})

router.get('/me', (req: Request, res: Response) => {
  const account = currentAccount(req)
  res.json({
    ok: true,
    account: account ? publicAccount(account) : null,
    allowRegistration: config.allowRegistration,
  })
})

router.post('/register', authLimiter, (req: Request, res: Response) => {
  if (!config.allowRegistration) {
    res.status(403).json({ ok: false, error: '注册已关闭' })
    return
  }
  const { username: rawUsername, password, captchaId, captcha } = parseBody(req)
  if (!verifyCaptcha(captchaId, captcha)) {
    res.status(400).json({ ok: false, error: '验证码错误或已过期', captcha: true })
    return
  }
  const username = rawUsername.trim()
  const err = validateCredentials(username, password)
  if (err) {
    res.status(400).json({ ok: false, error: err })
    return
  }

  if (getAccountByUsername(username)) {
    res.status(409).json({ ok: false, error: '用户名已被占用' })
    return
  }
  if (config.maxAccounts > 0 && countAccounts() >= config.maxAccounts) {
    res.status(403).json({ ok: false, error: '注册名额已满' })
    return
  }

  const account = createAccount({ username, password })
  setSession(res, account.id)
  res.json({ ok: true, account })
})

router.post('/login', authLimiter, (req: Request, res: Response) => {
  const { username: rawUsername, password, captchaId, captcha } = parseBody(req)
  if (!verifyCaptcha(captchaId, captcha)) {
    res.status(400).json({ ok: false, error: '验证码错误或已过期', captcha: true })
    return
  }
  const username = rawUsername.trim()
  if (!username || !password) {
    res.status(400).json({ ok: false, error: '请输入用户名和密码' })
    return
  }

  const account = getAccountByUsername(username)
  if (!account || !verifyPassword(password, account.passwordHash)) {
    res.status(401).json({ ok: false, error: '用户名或密码错误' })
    return
  }
  if (account.disabled) {
    res.status(403).json({ ok: false, error: '账号已被禁用，请联系管理员' })
    return
  }

  touchLogin(account.id)
  setSession(res, account.id)
  res.json({ ok: true, account: publicAccount(account) })
})

// Change password (authenticated users).
const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1),
})

router.post('/change-password', requireAuth, (req: Request, res: Response) => {
  const result = changePasswordSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ ok: false, error: '请输入当前密码和新密码' })
    return
  }
  const { oldPassword, newPassword } = result.data
  const account = req.account!
  if (!verifyPassword(oldPassword, account.passwordHash)) {
    res.status(401).json({ ok: false, error: '当前密码错误' })
    return
  }
  if (newPassword.length < config.minPasswordLength) {
    res
      .status(400)
      .json({ ok: false, error: `新密码至少需 ${config.minPasswordLength} 位` })
    return
  }
  changePassword(account.id, newPassword)
  res.json({ ok: true })
})

router.post('/logout', (_req: Request, res: Response) => {
  clearSession(res)
  res.json({ ok: true })
})

export default router
