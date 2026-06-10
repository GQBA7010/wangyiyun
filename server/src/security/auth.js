import { config } from '../config.js'
import { signToken, verifyToken } from './crypto.js'
import { getAccountById, getSecret } from '../store.js'

/** Issue a signed session cookie for the given account id. */
export function setSession(res, accountId) {
  const exp = Date.now() + config.sessionMaxAgeMs
  const token = signToken({ sub: accountId, exp }, getSecret())
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionMaxAgeMs,
    path: '/',
  })
}

export function clearSession(res) {
  res.clearCookie(config.sessionCookieName, { path: '/' })
}

/** Resolve the authenticated account from the session cookie, or null. */
export function currentAccount(req) {
  const token = req.cookies?.[config.sessionCookieName]
  if (!token) return null
  const payload = verifyToken(token, getSecret())
  if (!payload?.sub) return null
  return getAccountById(payload.sub)
}

/** Express middleware: require a valid session, else 401. */
export function requireAuth(req, res, next) {
  const account = currentAccount(req)
  if (!account) return res.status(401).json({ ok: false, error: '未登录或登录已过期' })
  req.account = account
  next()
}
