import { Infinity as InfinityIcon, Zap } from 'lucide-react'
import { api, type Scheduler } from '../lib/api'
import { Toggle } from './Toggle'

interface SchedulerBarProps {
  scheduler: Scheduler
  onChange: (s: Scheduler) => void
  notify: (message: string, ok?: boolean) => void
}

export function SchedulerBar({ scheduler, onChange, notify }: SchedulerBarProps) {
  const save = async (patch: Partial<Scheduler>) => {
    try {
      const { scheduler: s } = await api.setScheduler(patch)
      onChange(s)
      notify(
        patch.enabled ? '已开启全天 24 小时自动听歌' : '已暂停自动听歌',
        true,
      )
    } catch (e) {
      notify((e as Error).message, false)
    }
  }

  return (
    <div className="glass flex flex-col gap-4 p-5 shadow-card md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500/30 to-accent-500/30">
          <InfinityIcon className="h-5 w-5 text-brand-300" />
        </div>
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            全天自动听歌
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                scheduler.enabled
                  ? 'bg-accent-500/15 text-accent-400'
                  : 'bg-white/10 text-slate-400'
              }`}
            >
              {scheduler.enabled ? '24 小时运行中' : '已暂停'}
            </span>
          </p>
          <p className="text-xs text-slate-400">
            开启后全天 24 小时不间断为所有账号自动听歌打卡（每日自动签到一次，时区 Asia/Shanghai）
          </p>
        </div>
      </div>

      <div
        className="flex items-center gap-2 self-start rounded-lg bg-white/[0.04] px-3 py-2 md:self-auto"
        title="开启 / 暂停 全天自动听歌"
      >
        <Zap
          className={`h-4 w-4 ${scheduler.enabled ? 'text-accent-400' : 'text-slate-500'}`}
        />
        <span className="text-xs font-medium text-slate-200">
          {scheduler.enabled ? '不间断运行' : '已暂停'}
        </span>
        <Toggle checked={scheduler.enabled} onChange={(v) => save({ enabled: v })} />
      </div>
    </div>
  )
}
