import type { NeteaseUser, PlatformAccount } from './types.js'

// Augment Express' Request with the values our auth / isolation middleware
// attach. They are optional because they only exist after the relevant
// middleware has run; route handlers use `requireAccount` / `requireOwnedUser`
// to retrieve them with a non-optional type.
declare global {
  namespace Express {
    interface Request {
      account?: PlatformAccount
      neteaseUser?: NeteaseUser
    }
  }
}

export {}
