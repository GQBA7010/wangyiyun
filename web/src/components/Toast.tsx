import { useEffect } from 'react'
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
    <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col gap-3">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}

function Toast({ toast, dismiss }: { toast: ToastItem; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), 4200)
    return () => clearTimeout(timer)
  }, [toast.id, dismiss])

  return (
    <div className="glass pointer-events-auto flex max-w-sm animate-fade-up items-start gap-3 px-4 py-3 shadow-card">
      {toast.ok ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-400" />
      ) : (
        <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
      )}
      <p className="text-sm text-slate-200">{toast.message}</p>
    </div>
  )
}
