import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import {
  changePassword,
  countUserNeteaseAccounts,
  deleteAccount,
  listAccounts,
  listUsers,
  publicAccount,
  updateAccount,
} from '../store.js'
import { requireAuth, requireAccount } from '../security/auth.js'
import { config } from '../config.js'

const router = Router()

/** Only admins may access routes behind this middleware. */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const acc = requireAccount(req)
  if (acc.role !== 'admin') {
    res.status(403).json({ ok: false, error: '需要管理员权限' })
    return
  }
  next()
}

router.use(requireAuth)
router.use(requireAdmin)

// ---- Overview / stats ----
router.get('/stats', (_req: Request, res: Response) => {
  const accounts = listAccounts()
  const allUsers = listUsers()
  res.json({
    ok: true,
    stats: {
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter((a) => !a.disabled).length,
      disabledAccounts: accounts.filter((a) => a.disabled).length,
      totalNeteaseUsers: allUsers.length,
      maxAccounts: config.maxAccounts,
      maxNeteasePerUser: config.maxNeteasePerUser,
    },
  })
})

// ---- Account CRUD ----
router.get('/accounts', (_req: Request, res: Response) => {
  const accounts = listAccounts()
  const allUsers = listUsers()
  const result = accounts.map((acc) => ({
    ...publicAccount(acc),
    neteaseCount: allUsers.filter((u) => u.ownerId === acc.id).length,
  }))
  res.json({ ok: true, accounts: result })
})

const patchAccountSchema = z.object({
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
})

router.patch('/accounts/:id', (req: Request, res: Response) => {
  const id = req.params.id ?? ''
  const caller = requireAccount(req)
  const result = patchAccountSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ ok: false, error: '参数错误' })
    return
  }
  if (id === caller.id && result.data.disabled === true) {
    res.status(400).json({ ok: false, error: '不能禁用自己的账号' })
    return
  }
  const updated = updateAccount(id, result.data)
  if (!updated) {
    res.status(404).json({ ok: false, error: '账号不存在' })
    return
  }
  res.json({ ok: true, account: publicAccount(updated) })
})

router.delete('/accounts/:id', (req: Request, res: Response) => {
  const id = req.params.id ?? ''
  const caller = requireAccount(req)
  if (id === caller.id) {
    res.status(400).json({ ok: false, error: '不能删除自己的账号' })
    return
  }
  const ok = deleteAccount(id)
  if (!ok) {
    res.status(404).json({ ok: false, error: '账号不存在' })
    return
  }
  res.json({ ok: true })
})

// ---- Admin reset password for any user ----
const resetPasswordSchema = z.object({
  newPassword: z.string().min(1),
})

router.post('/accounts/:id/reset-password', (req: Request, res: Response) => {
  const id = req.params.id ?? ''
  const result = resetPasswordSchema.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ ok: false, error: '请输入新密码' })
    return
  }
  const { newPassword } = result.data
  if (newPassword.length < config.minPasswordLength) {
    res
      .status(400)
      .json({ ok: false, error: `密码至少需 ${config.minPasswordLength} 位` })
    return
  }
  const ok = changePassword(id, newPassword)
  if (!ok) {
    res.status(404).json({ ok: false, error: '账号不存在' })
    return
  }
  res.json({ ok: true })
})

// ---- Hosted accounts per user (admin view) ----
router.get('/accounts/:id/netease', (req: Request, res: Response) => {
  const id = req.params.id ?? ''
  const count = countUserNeteaseAccounts(id)
  const users = listUsers(id)
  res.json({
    ok: true,
    count,
    limit: config.maxNeteasePerUser,
    users: users.map((u) => ({
      uid: u.uid,
      nickname: u.nickname,
      status: u.status,
    })),
  })
})

export default router
