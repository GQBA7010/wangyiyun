import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Plus, Sparkles, Users } from 'lucide-react'
import { api, type Scheduler, type User } from './lib/api'
import { formatNumber } from './lib/format'
import { AccountCard } from './components/AccountCard'
import { QRLogin } from './components/QRLogin'
import { SchedulerBar } from './components/SchedulerBar'
import { ToastStack, type ToastItem } from './components/Toast'

export default function App() {
  const [users, setUsers] = useState<User[]>([])
  const [scheduler, setScheduler] = useState<Scheduler>({ cron: '0 8 * * *', enabled: true })
  const [showLogin, setShowLogin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const notify = useCallback((message: string, ok = true) => {
    setToasts((t) => [...t, { id: Date.now() + Math.random(), message, ok }])
  }, [])
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const load = useCallback(async () => {
    try {
      const [{ users: u }, { scheduler: s }] = await Promise.all([
        api.listUsers(),
        api.getScheduler(),
      ])
      setUsers(u)
      setScheduler(s)
    } catch (e) {
      notify((e as Error).message, false)
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    load()
  }, [load])

  const upsertUser = (user: User) =>
    setUsers((list) => {
      const idx = list.findIndex((x) => x.uid === user.uid)
      if (idx === -1) return [...list, user]
      const next = [...list]
      next[idx] = user
      return next
    })

  const removeUser = async (uid: number) => {
    setUsers((list) => list.filter((x) => x.uid !== uid))
    try {
      await api.removeUser(uid)
      notify('已移除账号', true)
    } catch (e) {
      notify((e as Error).message, false)
    }
  }

  const stats = useMemo(() => {
    const totalListen = users.reduce((s, u) => s + (u.listenSongs ?? 0), 0)
    const active = users.filter(
      (u) => u.settings.autoSignin || u.settings.autoScrobble,
    ).length
    return { accounts: users.length, active, totalListen }
  }, [users])

  return (
    <div className="min-h-screen bg-mesh">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        {/* header */}
        <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-brand-300">
              <Sparkles className="h-3.5 w-3.5" /> 懒人自动化 · 全自动后台运行
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Lumen
              <span className="bg-gradient-to-r from-brand-400 to-accent-400 bg-clip-text text-transparent">
                {' '}
                控制台
              </span>
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              网易云音乐 · 自动签到 / 自动听歌打卡，一处开关，全程托管。
            </p>
          </div>
          <button onClick={() => setShowLogin(true)} className="btn-primary self-start">
            <Plus className="h-4 w-4" /> 添加账号
          </button>
        </header>

        {/* stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard icon={<Users className="h-5 w-5" />} label="托管账号" value={stats.accounts} />
          <StatCard
            icon={<Activity className="h-5 w-5" />}
            label="自动任务启用"
            value={stats.active}
          />
          <StatCard
            icon={<Sparkles className="h-5 w-5" />}
            label="累计听歌量"
            value={formatNumber(stats.totalListen)}
          />
        </div>

        <div className="mb-8">
          <SchedulerBar scheduler={scheduler} onChange={setScheduler} notify={notify} />
        </div>

        {/* accounts */}
        {loading ? (
          <div className="py-24 text-center text-slate-500">加载中…</div>
        ) : users.length === 0 ? (
          <EmptyState onAdd={() => setShowLogin(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {users.map((u, i) => (
              <AccountCard
                key={u.uid}
                user={u}
                index={i}
                onChange={upsertUser}
                onRemove={removeUser}
                notify={notify}
              />
            ))}
          </div>
        )}

        <footer className="mt-16 border-t border-white/[0.06] pt-6 text-center text-xs text-slate-600">
          Lumen · 仅供个人学习与自动化使用 · 登录态安全存储于你自己的服务器
        </footer>
      </div>

      {showLogin && (
        <QRLogin
          onClose={() => setShowLogin(false)}
          onSuccess={(user) => {
            upsertUser(user)
            setShowLogin(false)
            notify(`账号「${user.nickname || user.uid}」已添加`, true)
          }}
        />
      )}

      <ToastStack toasts={toasts} dismiss={dismiss} />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
}) {
  return (
    <div className="glass flex items-center gap-4 p-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/25 to-accent-500/25 text-brand-300">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value}</p>
        <p className="text-xs text-slate-400">{label}</p>
      </div>
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-5 px-6 py-20 text-center">
      <div className="flex h-20 w-20 animate-float items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500/30 to-accent-500/30">
        <Users className="h-9 w-9 text-brand-300" />
      </div>
      <div>
        <h3 className="text-xl font-bold text-white">还没有账号</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-400">
          扫码登录你的网易云账号，开启自动签到与自动听歌打卡，剩下的交给后台托管。
        </p>
      </div>
      <button onClick={onAdd} className="btn-primary">
        <Plus className="h-4 w-4" /> 扫码添加账号
      </button>
    </div>
  )
}
