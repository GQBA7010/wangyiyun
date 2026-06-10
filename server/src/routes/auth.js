import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../config.js'
import {
  countAccounts,
  createAccount,
  getAccountByUsername,
  publicAccount,
  touchLogin,
} from '../store.js'
import { verifyPassword } from '../security/crypto.js'
import { clearSession, currentAccount, setSession } from '../security/auth.js'

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

function validateCredentials(username, password) {
  if (!username || !USERNAME_RE.test(username)) {
    return '用户名需为 3–32 位字母、数字、下划线或中文'
  }
  if (typeof password !== 'string' || password.length < config.minPasswordLength) {
    return `密码至少需 ${config.minPasswordLength} 位`
  }
  return null
}

router.get('/me', (req, res) => {
  const account = currentAccount(req)
  res.json({
    ok: true,
    account: publicAccount(account),
    allowRegistration: config.allowRegistration,
  })
})

router.post('/register', authLimiter, (req, res) => {
  if (!config.allowRegistration) {
    return res.status(403).json({ ok: false, error: '注册已关闭' })
  }
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const err = validateCredentials(username, password)
  if (err) return res.status(400).json({ ok: false, error: err })

  if (getAccountByUsername(username)) {
    return res.status(409).json({ ok: false, error: '用户名已被占用' })
  }
  if (config.maxAccounts > 0 && countAccounts() >= config.maxAccounts) {
    return res.status(403).json({ ok: false, error: '注册名额已满' })
  }

  const account = createAccount({ username, password })
  setSession(res, account.id)
  res.json({ ok: true, account })
})

router.post('/login', authLimiter, (req, res) => {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '请输入用户名和密码' })
  }

  const account = getAccountByUsername(username)
  if (!account || !verifyPassword(password, account.passwordHash)) {
    return res.status(401).json({ ok: false, error: '用户名或密码错误' })
  }

  touchLogin(account.id)
  setSession(res, account.id)
  res.json({ ok: true, account: publicAccount(account) })
})

router.post('/logout', (_req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

export default router
