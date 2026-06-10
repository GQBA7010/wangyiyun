import { useState } from 'react'
import { Loader2, Lock, LogIn, Music4, UserPlus } from 'lucide-react'
import { api, type Account } from '../lib/api'

interface AuthPageProps {
  allowRegistration: boolean
  onAuthed: (account: Account) => void
}

type Mode = 'login' | 'register'

export function AuthPage({ allowRegistration, onAuthed }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { account } =
        mode === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password)
      onAuthed(account)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-mesh px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow">
            <Music4 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
            Lumen
            <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">
              {' '}
              控制台
            </span>
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            网易云音乐自动化托管 · 注册即可开始
          </p>
        </div>

        <div className="glass p-7 shadow-card">
          {/* tabs */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            <TabButton active={mode === 'login'} onClick={() => switchMode('login')}>
              <LogIn className="h-4 w-4" /> 登录
            </TabButton>
            <TabButton
              active={mode === 'register'}
              onClick={() => switchMode('register')}
              disabled={!allowRegistration}
            >
              <UserPlus className="h-4 w-4" /> 注册
            </TabButton>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="用户名">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="3–32 位字母 / 数字 / 中文"
                className="auth-input"
                required
              />
            </Field>
            <Field label="密码">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={mode === 'register' ? '至少 8 位' : '请输入密码'}
                className="auth-input"
                required
              />
            </Field>

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                {error}
              </p>
            )}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === 'login' ? (
                <LogIn className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>

          {!allowRegistration && mode === 'login' && (
            <p className="mt-4 text-center text-xs text-slate-400">本站暂未开放注册</p>
          )}
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <Lock className="h-3 w-3" />
          数据按账号隔离 · 登录态加密存储于服务器
        </p>
      </div>
    </div>
  )
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'bg-white text-slate-900 shadow-soft' : 'text-slate-500 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  )
}
