import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'

export interface ToastItem {
  id: number
  message: string
  ok: boolean
}

export function ToastStack({
  toasts,
  dismiss,
}: {
  toasts: ToastItem[]
  dismiss: (id: number) => void
}) {
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[80] flex flex-col items-center gap-3 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:items-end">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}

const EXIT_MS = 220

function Toast({ toast, dismiss }: { toast: ToastItem; dismiss: (id: number) => void }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const enter = requestAnimationFrame(() => setShown(true))
    const hide = window.setTimeout(() => setShown(false), 4000)
    const remove = window.setTimeout(() => dismiss(toast.id), 4000 + EXIT_MS)
    return () => {
      cancelAnimationFrame(enter)
      window.clearTimeout(hide)
      window.clearTimeout(remove)
    }
  }, [toast.id, dismiss])

  return (
    <div
      className={`glass pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 shadow-card transition-all duration-200 ease-out sm:w-auto ${
        shown ? 'translate-y-0 opacity-100 sm:translate-x-0' : 'translate-y-2 opacity-0 sm:translate-x-4 sm:translate-y-0'
      }`}
    >
      {toast.ok ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-500" />
      ) : (
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
      )}
      <p className="text-sm text-slate-700">{toast.message}</p>
    </div>
  )
}
