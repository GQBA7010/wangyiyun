import { useState } from 'react'
import { X } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { Modal } from './Modal'

export function ChangePasswordModal({
  onClose,
  notify,
}: {
  onClose: () => void
  notify: (msg: string, ok?: boolean) => void
}) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!oldPw || !newPw) return notify('请填写完整', false)
    if (newPw !== confirm) return notify('两次密码不一致', false)
    if (newPw.length < 8) return notify('新密码至少需 8 位', false)
    setBusy(true)
    try {
      await api.changePassword(oldPw, newPw)
      notify('密码修改成功')
      onClose()
    } catch (e) {
      notify(e instanceof ApiError ? e.message : '修改失败', false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="mb-4 text-lg font-bold text-slate-900">修改密码</h2>
        <div className="space-y-3">
          <input
            type="password"
            placeholder="当前密码"
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            className="input w-full"
          />
          <input
            type="password"
            placeholder="新密码（至少 8 位）"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            className="input w-full"
          />
          <input
            type="password"
            placeholder="确认新密码"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input w-full"
          />
        </div>
        <button
          onClick={submit}
          disabled={busy}
          className="btn-primary mt-5 w-full justify-center"
        >
          {busy ? '提交中…' : '确认修改'}
        </button>
      </div>
    </Modal>
  )
}
