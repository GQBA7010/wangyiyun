import { AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal onClose={onCancel} className="max-w-sm" zClass="z-[70]">
      {(close) => (
        <div className="glass p-6 shadow-card">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-500 ring-1 ring-rose-100">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          </div>
          <p className="mb-6 text-sm leading-relaxed text-slate-500">{message}</p>
          <div className="flex justify-end gap-3">
            <button onClick={close} className="btn-ghost">
              {cancelLabel}
            </button>
            <button
              onClick={() => {
                onConfirm()
                close()
              }}
              className="btn-danger"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
