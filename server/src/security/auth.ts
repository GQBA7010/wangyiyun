import type { NextFunction, Request, Response } from 'express'
import { config } from '../config.js'
import { signToken, verifyToken } from './crypto.js'
import { getAccountById, getSecret } from '../store.js'
import type { NeteaseUser, PlatformAccount } from '../types.js'

/** Issue a signed session cookie for the given account id. */
export function setSession(res: Response, accountId: string): void {
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

export function clearSession(res: Response): void {
  res.clearCookie(config.sessionCookieName, { path: '/' })
}

/** Resolve the authenticated account from the session cookie, or null. */
export function currentAccount(req: Request): PlatformAccount | null {
  const cookies = req.cookies as Record<string, string> | undefined
  const token = cookies?.[config.sessionCookieName]
  if (!token) return null
  const payload = verifyToken(token, getSecret())
  if (!payload?.sub) return null
  return getAccountById(payload.sub)
}

/** Express middleware: require a valid session, else 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const account = currentAccount(req)
  if (!account) {
    res.status(401).json({ ok: false, error: '未登录或登录已过期' })
    return
  }
  if (account.disabled) {
    clearSession(res)
    res.status(403).json({ ok: false, error: '账号已被禁用' })
    return
  }
  req.account = account
  next()
}

/**
 * Retrieve the authenticated account attached by {@link requireAuth}. Throws if
 * called on a request that did not pass the middleware (a programming error).
 */
export function requireAccount(req: Request): PlatformAccount {
  if (!req.account) throw new Error('requireAccount called without requireAuth')
  return req.account
}

/** Retrieve the owned hosted account attached by the `ownUser` middleware. */
export function requireOwnedUser(req: Request): NeteaseUser {
  if (!req.neteaseUser) throw new Error('requireOwnedUser called without ownUser')
  return req.neteaseUser
}
