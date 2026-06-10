import { useCallback, useEffect, useState, type ReactNode } from 'react'

interface ModalProps {
  onClose: () => void
  /** Render-prop receives an animated `close` that plays the exit transition. */
  children: ReactNode | ((close: () => void) => ReactNode)
  className?: string
  zClass?: string
}

const EXIT_MS = 200

export function Modal({ onClose, children, className = '', zClass = 'z-50' }: ModalProps) {
  const [open, setOpen] = useState(false)

  // Play enter transition on mount.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    window.setTimeout(onClose, EXIT_MS)
  }, [onClose])

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className={`fixed inset-0 ${zClass} flex items-center justify-center p-4`}>
      <div
        onClick={close}
        className={`absolute inset-0 bg-slate-900/30 backdrop-blur-sm transition-opacity duration-200 ease-out ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        className={`relative w-full ${className} transition-all duration-200 ease-out ${
          open ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'
        }`}
      >
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  )
}
