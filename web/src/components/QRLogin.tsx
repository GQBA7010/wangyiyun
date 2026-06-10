import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Loader2, RefreshCw, ScanLine, X } from 'lucide-react'
import { api, type User } from '../lib/api'
import { Modal } from './Modal'

interface QRLoginProps {
  onClose: () => void
  onSuccess: (user: User) => void
}

type Status =
  | { kind: 'loading' }
  | { kind: 'waiting' }
  | { kind: 'scanned'; nickname?: string; avatarUrl?: string }
  | { kind: 'expired' }
  | { kind: 'error'; message: string }

export function QRLogin({ onClose, onSuccess }: QRLoginProps) {
  const [dataUrl, setDataUrl] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const pollRef = useRef<number | null>(null)
  const keyRef = useRef('')

  const stopPoll = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  const start = useCallback(async () => {
    stopPoll()
    setStatus({ kind: 'loading' })
    try {
      const { key, qrurl } = await api.qrKey()
      keyRef.current = key
      setDataUrl(
        await QRCode.toDataURL(qrurl, {
          margin: 1,
          width: 240,
          color: { dark: '#0f172a', light: '#ffffff' },
        }),
      )
      setStatus({ kind: 'waiting' })
      pollRef.current = window.setInterval(async () => {
        try {
          const r = await api.qrCheck(keyRef.current)
          if (r.code === 800) {
            stopPoll()
            setStatus({ kind: 'expired' })
          } else if (r.code === 802) {
            setStatus({ kind: 'scanned', nickname: r.nickname, avatarUrl: r.avatarUrl })
          } else if (r.code === 803 && r.user) {
            stopPoll()
            onSuccess(r.user)
          }
        } catch (e) {
          stopPoll()
          setStatus({ kind: 'error', message: (e as Error).message })
        }
      }, 2200)
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
    }
  }, [onSuccess])

  useEffect(() => {
    start()
    return stopPoll
  }, [start])

  return (
    <Modal onClose={onClose} className="max-w-sm">
      {(close) => (
        <div className="glass p-7 shadow-card">
          <button
            onClick={close}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="mb-1 flex items-center gap-2 text-brand-600">
            <ScanLine className="h-5 w-5" />
            <span className="text-sm font-semibold">扫码登录</span>
          </div>
          <h2 className="mb-5 text-xl font-bold text-slate-900">添加网易云账号</h2>

          <div className="relative mx-auto flex h-[264px] w-[264px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
            {dataUrl && (status.kind === 'waiting' || status.kind === 'scanned') ? (
              <img src={dataUrl} alt="登录二维码" className="h-full w-full rounded-lg" />
            ) : (
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
              </div>
            )}

            {status.kind === 'scanned' && (
              <div className="absolute inset-3 flex flex-col items-center justify-center gap-3 rounded-lg bg-white/95 text-center backdrop-blur-sm">
                {status.avatarUrl && (
                  <img
                    src={status.avatarUrl}
                    alt=""
                    className="h-16 w-16 rounded-full ring-2 ring-brand-500"
                  />
                )}
                <p className="text-sm font-semibold text-slate-900">
                  {status.nickname || '已扫码'}
                </p>
                <p className="text-xs font-medium text-accent-600">请在手机上确认登录</p>
              </div>
            )}

            {status.kind === 'expired' && (
              <div className="absolute inset-3 flex flex-col items-center justify-center gap-3 rounded-lg bg-white/95 backdrop-blur-sm">
                <p className="text-sm text-slate-500">二维码已过期</p>
                <button onClick={start} className="btn-ghost">
                  <RefreshCw className="h-4 w-4" /> 刷新
                </button>
              </div>
            )}
          </div>

          <p className="mt-5 text-center text-sm text-slate-500">
            {status.kind === 'waiting' && '打开网易云音乐 App，扫描二维码登录'}
            {status.kind === 'loading' && '正在生成二维码…'}
            {status.kind === 'scanned' && '扫码成功，等待确认'}
            {status.kind === 'error' && (
              <span className="text-rose-500">{status.message}</span>
            )}
          </p>
        </div>
      )}
    </Modal>
  )
}
