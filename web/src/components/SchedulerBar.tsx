import { useState } from 'react'
import { Clock, Zap } from 'lucide-react'
import { api, type Scheduler } from '../lib/api'
import { Toggle } from './Toggle'

interface SchedulerBarProps {
  scheduler: Scheduler
  onChange: (s: Scheduler) => void
  notify: (message: string, ok?: boolean) => void
}

const PRESETS: { label: string; cron: string }[] = [
  { label: '每天 08:00', cron: '0 8 * * *' },
  { label: '每天 12:00', cron: '0 12 * * *' },
  { label: '每天 22:00', cron: '0 22 * * *' },
  { label: '每 6 小时', cron: '0 */6 * * *' },
]

export function SchedulerBar({ scheduler, onChange, notify }: SchedulerBarProps) {
  const [cron, setCron] = useState(scheduler.cron)

  const save = async (patch: Partial<Scheduler>) => {
    try {
      const { scheduler: s } = await api.setScheduler(patch)
      onChange(s)
      setCron(s.cron)
      notify('定时设置已保存', true)
    } catch (e) {
      notify((e as Error).message, false)
    }
  }

  return (
    <div className="glass flex flex-col gap-4 p-5 shadow-card md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-accent-500/30">
          <Clock className="h-5 w-5 text-brand-300" />
        </div>
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            全自动调度
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                scheduler.enabled
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'bg-white/10 text-slate-400'
              }`}
            >
              {scheduler.enabled ? '运行中' : '已暂停'}
            </span>
          </p>
          <p className="text-xs text-slate-400">
            后台按计划自动为所有账号执行已开启的任务（时区 Asia/Shanghai）
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.cron}
            onClick={() => save({ cron: p.cron, enabled: true })}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              scheduler.cron === p.cron
                ? 'bg-brand-500 text-white'
                : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1">
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            onBlur={() => cron !== scheduler.cron && save({ cron })}
            spellCheck={false}
            className="w-28 bg-transparent text-center font-mono text-xs text-white outline-none"
          />
        </div>
        <button
          onClick={() => save({ enabled: !scheduler.enabled })}
          className="flex items-center gap-2 rounded-lg px-2 py-1"
          title="启用 / 暂停"
        >
          <Zap
            className={`h-4 w-4 ${scheduler.enabled ? 'text-accent-400' : 'text-slate-500'}`}
          />
          <Toggle checked={scheduler.enabled} onChange={(v) => save({ enabled: v })} />
        </button>
      </div>
    </div>
  )
}
