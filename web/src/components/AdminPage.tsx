import { useCallback, useEffect, useState } from 'react'
import {
  Ban,
  CheckCircle,
  Crown,
  RotateCcw,
  Shield,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { api, type AdminAccount, type AdminStats, ApiError } from '../lib/api'
import { ConfirmDialog } from './ConfirmDialog'

export function AdminPage({
  currentAccountId,
  notify,
}: {
  currentAccountId: string
  notify: (msg: string, ok?: boolean) => void
}) {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [accounts, setAccounts] = useState<AdminAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<AdminAccount | null>(null)
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null)
  const [newPw, setNewPw] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, a] = await Promise.all([api.adminStats(), api.adminAccounts()])
      setStats(s.stats)
      setAccounts(a.accounts)
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '加载失败', false)
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const toggle = async (acc: AdminAccount, field: 'disabled' | 'role') => {
    try {
      const patch =
        field === 'disabled'
          ? { disabled: !acc.disabled }
          : { role: acc.role === 'admin' ? ('user' as const) : ('admin' as const) }
      await api.adminPatchAccount(acc.id, patch)
      notify(field === 'disabled' ? (acc.disabled ? '已启用' : '已禁用') : '角色已更新')
      load()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '操作失败', false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await api.adminDeleteAccount(pendingDelete.id)
      notify(`已删除「${pendingDelete.username}」`)
      setPendingDelete(null)
      load()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '删除失败', false)
      setPendingDelete(null)
    }
  }

  const submitReset = async () => {
    if (!resetTarget || !newPw) return
    try {
      await api.adminResetPassword(resetTarget.id, newPw)
      notify(`「${resetTarget.username}」密码已重置`)
      setResetTarget(null)
      setNewPw('')
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '重置失败', false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MiniStat label="用户总数" value={stats.totalAccounts} />
          <MiniStat label="正常用户" value={stats.activeAccounts} />
          <MiniStat label="已禁用" value={stats.disabledAccounts} />
          <MiniStat label="托管账号总数" value={stats.totalNeteaseUsers} />
        </div>
      )}

      {/* accounts table */}
      <div className="glass overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-4 py-3 font-medium text-slate-500">用户名</th>
                <th className="px-4 py-3 font-medium text-slate-500">角色</th>
                <th className="px-4 py-3 font-medium text-slate-500">托管</th>
                <th className="px-4 py-3 font-medium text-slate-500">状态</th>
                <th className="px-4 py-3 font-medium text-slate-500">注册时间</th>
                <th className="px-4 py-3 font-medium text-slate-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc) => {
                const isSelf = acc.id === currentAccountId
                return (
                  <tr key={acc.id} className="border-b border-slate-50 hover:bg-slate-50/30">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {acc.username}
                      {isSelf && (
                        <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-600">
                          当前
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {acc.role === 'admin' ? (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Crown className="h-3.5 w-3.5" /> 管理员
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <User className="h-3.5 w-3.5" /> 普通
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{acc.neteaseCount}</td>
                    <td className="px-4 py-3">
                      {acc.disabled ? (
                        <span className="inline-flex items-center gap-1 text-red-500">
                          <Ban className="h-3.5 w-3.5" /> 已禁用
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle className="h-3.5 w-3.5" /> 正常
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(acc.createdAt).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {!isSelf && (
                          <>
                            <button
                              onClick={() => toggle(acc, 'role')}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              title={acc.role === 'admin' ? '降级为普通用户' : '升级为管理员'}
                            >
                              <Shield className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => toggle(acc, 'disabled')}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              title={acc.disabled ? '启用' : '禁用'}
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setPendingDelete(acc)}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                              title="删除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setResetTarget(acc)
                            setNewPw('')
                          }}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          title="重置密码"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="删除账号"
          message={`确定删除「${pendingDelete.username}」及其所有托管的网易云账号吗？此操作不可撤销。`}
          confirmLabel="删除"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-slate-900">
              重置「{resetTarget.username}」密码
            </h3>
            <input
              type="password"
              placeholder="新密码（至少 8 位）"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="input w-full"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setResetTarget(null)} className="btn-ghost">
                取消
              </button>
              <button onClick={submitReset} className="btn-primary" disabled={!newPw}>
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-accent-50 text-brand-600 ring-1 ring-brand-100">
        <Users className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  )
}
