import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { config } from './config.js'
import { logger } from './logger.js'

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  if (!config.smtpEnabled) return null
  if (transporter) return transporter
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.smtpUser, pass: config.smtpPass },
  })
  return transporter
}

// ---------------------------------------------------------------------------
// In-memory verification code store (code → { email, expiresAt })
// ---------------------------------------------------------------------------

interface PendingCode {
  email: string
  code: string
  expiresAt: number
}

const pendingCodes = new Map<string, PendingCode>()
const CODE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const CODE_COOLDOWN_MS = 60 * 1000 // 1 minute between sends to same email

/** Generate a 6-digit numeric code. */
function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** Store a pending code and return its opaque id. Exported for tests. */
export function storeCode(email: string, code: string, ttlMs = CODE_TTL_MS): string {
  const codeId = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  pendingCodes.set(codeId, { email, code, expiresAt: Date.now() + ttlMs })
  // Cleanup expired codes lazily.
  for (const [k, v] of pendingCodes) {
    if (v.expiresAt < Date.now()) pendingCodes.delete(k)
  }
  return codeId
}

/**
 * Send a verification code to `email`. Returns the codeId (opaque key) on
 * success, or an error string.
 */
export async function sendVerificationCode(
  email: string,
  purpose: '注册' | '找回密码' = '注册',
): Promise<{ ok: true; codeId: string } | { ok: false; error: string }> {
  const t = getTransporter()
  if (!t) return { ok: false, error: '邮件服务未配置' }

  // Cooldown: prevent spam.
  for (const [, v] of pendingCodes) {
    if (v.email === email && v.expiresAt - CODE_TTL_MS + CODE_COOLDOWN_MS > Date.now()) {
      return { ok: false, error: '发送过于频繁，请稍后再试' }
    }
  }

  const code = randomCode()

  try {
    await t.sendMail({
      from: `"${config.smtpFromName}" <${config.smtpUser}>`,
      to: email,
      subject: `【${config.smtpFromName}】${purpose}验证码`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#4f46e5">Lumen ${purpose}验证码</h2>
          <p>你的验证码是：</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e293b;margin:16px 0">${code}</p>
          <p style="color:#64748b;font-size:14px">验证码 10 分钟内有效，请勿泄露给他人。</p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
          <p style="color:#94a3b8;font-size:12px">如非本人操作请忽略此邮件。</p>
        </div>
      `,
    })
  } catch (e) {
    logger.error(
      { err: e instanceof Error ? e.message : String(e), email },
      'failed to send verification email',
    )
    return { ok: false, error: '验证码发送失败，请检查邮箱是否正确' }
  }

  const codeId = storeCode(email, code)
  return { ok: true, codeId }
}

/** Verify the code. Consumes it on success. */
export function verifyCode(codeId: string, code: string, email: string): boolean {
  const entry = pendingCodes.get(codeId)
  if (!entry) return false
  if (entry.expiresAt < Date.now()) {
    pendingCodes.delete(codeId)
    return false
  }
  if (entry.code !== code || entry.email !== email) return false
  pendingCodes.delete(codeId)
  return true
}

// ---------------------------------------------------------------------------
// Notification emails (cookie expiry, task failures, etc.)
// ---------------------------------------------------------------------------

export async function sendNotification(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const t = getTransporter()
  if (!t || !to) return false
  try {
    await t.sendMail({
      from: `"${config.smtpFromName}" <${config.smtpUser}>`,
      to,
      subject: `【${config.smtpFromName}】${subject}`,
      html,
    })
    return true
  } catch (e) {
    logger.error(
      { err: e instanceof Error ? e.message : String(e), to, subject },
      'failed to send notification email',
    )
    return false
  }
}

/** Convenience: notify a user that a hosted account cookie has expired. */
export async function notifyCookieExpired(
  email: string,
  nickname: string,
  uid: number,
): Promise<void> {
  await sendNotification(
    email,
    '网易云账号登录态已过期',
    `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#ef4444">登录态过期提醒</h2>
      <p>你托管的网易云账号 <strong>${nickname || uid}</strong>（UID: ${uid}）的登录态已过期。</p>
      <p>自动任务已暂停，请登录 Lumen 控制台重新扫码授权。</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="color:#94a3b8;font-size:12px">此邮件由 Lumen 自动发送，请勿回复。</p>
    </div>
    `,
  )
}

/** Notify about task failures. */
export async function notifyTaskFailure(
  email: string,
  nickname: string,
  uid: number,
  taskName: string,
  message: string,
): Promise<void> {
  await sendNotification(
    email,
    `任务执行失败：${taskName}`,
    `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#f59e0b">任务失败提醒</h2>
      <p>你托管的网易云账号 <strong>${nickname || uid}</strong>（UID: ${uid}）的任务「${taskName}」执行失败：</p>
      <p style="background:#fef2f2;padding:12px;border-radius:8px;color:#991b1b">${message}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="color:#94a3b8;font-size:12px">此邮件由 Lumen 自动发送，请勿回复。</p>
    </div>
    `,
  )
}
