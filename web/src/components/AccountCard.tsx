import { useState } from 'react'
import {
  AlertTriangle,
  CalendarCheck,
  ChevronDown,
  Gift,
  Headphones,
  Loader2,
  Music2,
  RefreshCw,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react'
import { api, type ScrobbleStatus, type User, type UserSettings } from '../lib/api'
import { formatNumber, timeAgo } from '../lib/format'
import { Toggle } from './Toggle'

interface AccountCardProps {
  user: User
  index: number
  scrobbleStatus?: ScrobbleStatus
  onChange: (user: User) => void
  onRemove: (uid: number) => void
  notify: (message: string, ok?: boolean) => void
}

const LEVEL_TARGET = 10000

export function AccountCard({
  user,
  index,
  scrobbleStatus,
  onChange,
  onRemove,
  notify,
}: AccountCardProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  const patchSettings = async (patch: Partial<UserSettings>) => {
    onChange({ ...user, settings: { ...user.settings, ...patch } })
    try {
      const { user: updated } = await api.updateSettings(user.uid, patch)
      onChange(updated)
    } catch (e) {
      notify((e as Error).message, false)
    }
  }

  const run = async (
    kind: 'signin' | 'scrobble' | 'refresh' | 'check' | 'tasks' | 'partner',
    fn: () => Promise<{ user: User; message?: string }>,
  ) => {
    setBusy(kind)
    try {
      const r = await fn()
      onChange(r.user)
      if (r.message) notify(r.message, true)
      else notify('已刷新账号信息', true)
    } catch (e) {
      notify((e as Error).message, false)
    } finally {
      setBusy(null)
    }
  }

  const listened = user.listenSongs ?? 0
  const progress = Math.min(100, (listened / LEVEL_TARGET) * 100)

  return (
    <div
      className="glass card-hover flex flex-col gap-5 p-6 shadow-card animate-fade-up"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {/* header */}
      <div className="flex items-start gap-4">
        <div className="relative">
          <img
            src={user.avatarUrl || 'https://p1.music.126.net/VnZiScyynLG7atLIZ2YPkw==/18686200114669622.jpg'}
            alt=""
            className="h-14 w-14 rounded-2xl object-cover ring-1 ring-slate-200"
          />
          <span className="absolute -bottom-1.5 -right-1.5 rounded-lg bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
            Lv.{user.level ?? 0}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-bold text-slate-900">
              {user.nickname || `用户 ${user.uid}`}
            </h3>
            {user.status === 'expired' && (
              <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                <AlertTriangle className="h-3 w-3" /> 已过期
              </span>
            )}
            {user.status === 'active' && (
              <span className="flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-semibold text-accent-600">
                <ShieldCheck className="h-3 w-3" /> 在线
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">UID · {user.uid}</p>
        </div>
        <button
          onClick={() => onRemove(user.uid)}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
          title="移除账号"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* real-time listening status */}
      {scrobbleStatus && (
        <div className="flex items-center gap-3 rounded-xl border border-accent-200 bg-gradient-to-r from-accent-50 to-brand-50 px-4 py-3">
          <div className="relative flex h-8 w-8 items-center justify-center">
            <Headphones className="h-5 w-5 text-accent-600" />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-accent-500 ring-2 ring-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-accent-700">正在听歌中</p>
            <p className="text-xs text-accent-600/80">
              第 {scrobbleStatus.current}/{scrobbleStatus.total} 首
              {scrobbleStatus.estimatedRemaining > 0 && (
                <span className="ml-1.5 text-slate-500">
                  · 预计剩余 {Math.ceil(scrobbleStatus.estimatedRemaining / 60)} 分钟
                </span>
              )}
            </p>
          </div>
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-accent-100">
            <div
              className="h-full rounded-full bg-accent-500 transition-all duration-700"
              style={{
                width: `${Math.round((scrobbleStatus.current / scrobbleStatus.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* listen progress */}
      <div>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-slate-500">
            <Music2 className="h-3.5 w-3.5" /> 累计听歌量
          </span>
          <span className="font-semibold text-slate-900">
            {formatNumber(listened)}{' '}
            <span className="text-slate-500">/ {formatNumber(LEVEL_TARGET)}</span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* feature status overview */}
      <div className="grid grid-cols-2 gap-2">
        <StatusChip
          label="自动签到"
          enabled={user.settings.autoSignin}
          ok={user.lastSignin ? true : undefined}
          at={user.lastSignin?.at}
        />
        <StatusChip
          label="自动听歌"
          enabled={user.settings.autoScrobble}
          ok={user.lastScrobble ? true : undefined}
          at={user.lastScrobble?.at}
        />
        <StatusChip
          label="云贝任务"
          enabled={user.settings.autoTasks}
          ok={user.lastYunbei ? true : undefined}
          at={user.lastYunbei?.at}
        />
        <StatusChip
          label="合伙人评测"
          enabled={user.settings.autoPartner}
          ok={
            user.lastPartner
              ? user.lastPartner.eligible !== false
              : undefined
          }
          at={user.lastPartner?.at}
          note={user.lastPartner?.eligible === false ? '无资格' : undefined}
        />
      </div>

      {/* automation toggles */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
        <ToggleRow
          icon={<CalendarCheck className="h-4 w-4 text-brand-500" />}
          title="自动签到"
          desc={`上次：${user.lastSignin?.message ?? '从未执行'} · ${timeAgo(user.lastSignin?.at)}`}
          checked={user.settings.autoSignin}
          onChange={(v) => patchSettings({ autoSignin: v })}
        />
        <div className="h-px bg-slate-200" />
        <ToggleRow
          icon={<Headphones className="h-4 w-4 text-accent-500" />}
          title="自动听歌打卡"
          desc={`上次：${user.lastScrobble?.message ?? '从未执行'} · ${timeAgo(user.lastScrobble?.at)}`}
          checked={user.settings.autoScrobble}
          onChange={(v) => patchSettings({ autoScrobble: v })}
        />

        <div className="h-px bg-slate-200" />
        <ToggleRow
          icon={<Gift className="h-4 w-4 text-amber-500" />}
          title="自动云贝任务"
          desc={`上次：${user.lastYunbei?.message?.slice(0, 40) ?? '从未执行'}${user.lastYunbei?.message && user.lastYunbei.message.length > 40 ? '…' : ''} · ${timeAgo(user.lastYunbei?.at)}`}
          checked={user.settings.autoTasks}
          onChange={(v) => patchSettings({ autoTasks: v })}
        />

        <div className="h-px bg-slate-200" />
        <ToggleRow
          icon={<Star className="h-4 w-4 text-violet-500" />}
          title="自动音乐合伙人评测"
          desc={`上次：${user.lastPartner?.message?.slice(0, 40) ?? '从未执行'}${user.lastPartner?.message && user.lastPartner.message.length > 40 ? '…' : ''} · ${timeAgo(user.lastPartner?.at)}`}
          checked={user.settings.autoPartner}
          onChange={(v) => patchSettings({ autoPartner: v })}
        />

        {user.settings.autoPartner && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-500">评分策略</span>
            <select
              value={user.settings.partnerScore}
              onChange={(e) => patchSettings({ partnerScore: Number(e.target.value) })}
              className="cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat py-1.5 pl-2.5 pr-8 text-base text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2394a3b8%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%2F%3E%3C%2Fsvg%3E')]"
            >
              <option value={1}>偏低（1-2 分）</option>
              <option value={2}>中等（2-3 分）</option>
              <option value={3}>较高（3-4 分）</option>
              <option value={4}>固定 4 分</option>
            </select>
          </div>
        )}

        {user.settings.autoScrobble && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-slate-500">每次打卡歌曲数（去重）</span>
            <input
              type="number"
              min={1}
              max={500}
              value={user.settings.scrobbleCount}
              onChange={(e) =>
                onChange({
                  ...user,
                  settings: {
                    ...user.settings,
                    scrobbleCount: Number(e.target.value),
                  },
                })
              }
              onBlur={(e) =>
                patchSettings({
                  scrobbleCount: Math.max(1, Math.min(500, Number(e.target.value) || 300)),
                })
              }
              className="w-20 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-base text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15"
            />
          </div>
        )}
      </div>

      {/* manual actions */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <ActionBtn
          busy={busy === 'signin'}
          onClick={() => run('signin', () => api.signin(user.uid))}
          icon={<CalendarCheck className="h-4 w-4" />}
          label="签到"
        />
        <ActionBtn
          busy={busy === 'scrobble'}
          onClick={() => run('scrobble', () => api.scrobble(user.uid))}
          icon={<Headphones className="h-4 w-4" />}
          label="听歌"
        />
        <ActionBtn
          busy={busy === 'refresh'}
          onClick={() => run('refresh', () => api.refresh(user.uid))}
          icon={<RefreshCw className="h-4 w-4" />}
          label="刷新"
        />
        <ActionBtn
          busy={busy === 'check'}
          onClick={() => run('check', () => api.check(user.uid).then(r => ({ user: r.user, message: r.valid ? '登录态有效' : '登录态已过期，请重新扫码' })))}
          icon={<ShieldCheck className="h-4 w-4" />}
          label="检测"
        />
        <ActionBtn
          busy={busy === 'tasks'}
          onClick={() => run('tasks', () => api.yunbeiTasks(user.uid))}
          icon={<Gift className="h-4 w-4" />}
          label="云贝"
        />
        <ActionBtn
          busy={busy === 'partner'}
          onClick={() => run('partner', () => api.partner(user.uid))}
          icon={<Star className="h-4 w-4" />}
          label="评测"
        />
      </div>

      {/* logs */}
      <div>
        <button
          onClick={() => setShowLogs((s) => !s)}
          className="flex w-full items-center justify-between text-xs text-slate-500 transition-colors hover:text-slate-800"
        >
          <span>运行日志（{user.logs?.length ?? 0}）</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showLogs ? 'rotate-180' : ''}`}
          />
        </button>
        {showLogs && (
          <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
            {user.logs?.length ? (
              user.logs.map((log, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs"
                >
                  <span
                    className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                      log.ok ? 'bg-accent-500' : 'bg-rose-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-slate-700">{log.message}</p>
                    <p className="text-[10px] text-slate-500">{timeAgo(log.at)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-2 text-center text-xs text-slate-400">暂无日志</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  icon,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="truncate text-[11px] text-slate-500">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  )
}

/** Compact per-feature status pill: name + enabled state + last-run dot/time. */
function StatusChip({
  label,
  enabled,
  ok,
  at,
  note,
}: {
  label: string
  enabled: boolean
  ok?: boolean
  at?: number
  note?: string
}) {
  const dot = !enabled
    ? 'bg-slate-300'
    : ok === false
      ? 'bg-rose-500'
      : ok === true
        ? 'bg-accent-500'
        : 'bg-amber-400'
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-700">{label}</p>
        <p className="truncate text-[10px] text-slate-400">
          {enabled ? (note ?? (at ? timeAgo(at) : '待运行')) : '已关闭'}
        </p>
      </div>
    </div>
  )
}

function ActionBtn({
  busy,
  onClick,
  icon,
  label,
}: {
  busy: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button onClick={onClick} disabled={busy} className="btn-ghost flex-col !py-3">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      <span className="text-xs">{label}</span>
    </button>
  )
}
