import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { weapi } from './crypto.js'
import type { DeviceFingerprint } from './fingerprint.js'
import { config } from '../config.js'

const BASE = 'https://music.163.com'

// Reuse a single agent instance when a proxy is configured
const proxyAgent: HttpsProxyAgent<string> | undefined = config.proxyUrl
  ? new HttpsProxyAgent(config.proxyUrl)
  : undefined

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ---------------------------------------------------------------------------
// Response shapes (only the fields we actually consume are typed)
// ---------------------------------------------------------------------------

export interface NeteaseBase {
  code?: number
  message?: string
  msg?: string
}

export interface AccountInfo extends NeteaseBase {
  account?: { id?: number }
  profile?: { userId?: number; nickname?: string; avatarUrl?: string }
}

export interface UserDetail extends NeteaseBase {
  level?: number
  listenSongs?: number
  profile?: {
    nickname?: string
    avatarUrl?: string
    province?: number
    city?: number
  }
}

export interface SigninResponse extends NeteaseBase {
  point?: number
}

export interface QrCheckResult {
  code?: number
  message?: string
  nickname?: string
  avatarUrl?: string
  cookie: string
}

export interface YunbeiTask {
  userTaskId?: number
  depositCode?: number
  taskName?: string
  taskPoint?: number
}

export interface YunbeiTodoResponse extends NeteaseBase {
  data?: YunbeiTask[]
}

export interface PartnerWork {
  id?: number
  name?: string
  authorName?: string
  resourceId?: string
}

export interface PartnerWorkItem {
  completed?: boolean
  work?: PartnerWork
}

export interface PartnerDailyData {
  id?: number
  works?: PartnerWorkItem[]
  count?: number
  completedCount?: number
}

export interface PartnerDailyResponse extends NeteaseBase {
  data?: PartnerDailyData
}

export interface PartnerExtraResponse extends NeteaseBase {
  data?: PartnerWorkItem[]
}

interface WeapiResult<T> {
  status: number
  data: T
  cookies: string[]
  mergedCookie: string
}

function fallbackIP(): string {
  return `116.25.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
}

/**
 * Build a rich cookie string that looks like a real NetEase client.
 * The reference NeteaseCloudMusicApi enriches cookies with device info,
 * os version, appver, etc. Without these, requests may be rejected.
 */
function buildRichCookie(cookie: string, fp?: DeviceFingerprint, osOverride?: string): string {
  // Parse existing cookie into a map
  const jar = new Map<string, string>()
  for (const part of (cookie || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) {
      jar.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
    }
  }

  // Add device fingerprint cookies
  const os = osOverride || fp?.os || 'pc'
  const appver = fp?.appver || '3.1.17.204416'
  const osver = fp?.osver || 'Microsoft-Windows-10-Professional-build-19045-64bit'
  const channel = fp?.channel || 'netease'
  const deviceId = fp?.deviceId || 'default_device_id'

  jar.set('os', os)
  jar.set('appver', appver)
  jar.set('osver', osver)
  jar.set('channel', channel)
  jar.set('deviceId', deviceId)

  // Standard browser cookies NetEase expects
  if (!jar.has('__remember_me')) jar.set('__remember_me', 'true')
  if (!jar.has('ntes_kaola_ad')) jar.set('ntes_kaola_ad', '1')
  if (!jar.has('_ntes_nuid')) {
    jar.set('_ntes_nuid', deviceId)
    jar.set('_ntes_nnid', `${deviceId},${Date.now()}`)
  }

  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** Common axios config: proxy agent + timeout. */
function baseAxiosOpts(): Partial<AxiosRequestConfig> {
  const opts: Partial<AxiosRequestConfig> = { timeout: 15000, validateStatus: () => true }
  if (proxyAgent) {
    opts.httpAgent = proxyAgent
    opts.httpsAgent = proxyAgent
  }
  return opts
}

function readCsrf(cookie = ''): string {
  const m = /(?:^|;\s*)__csrf=([^;]+)/.exec(cookie)
  return m ? (m[1] ?? '') : ''
}

/** Merge incoming Set-Cookie headers into an existing cookie string. */
export function mergeCookies(existing = '', setCookie: string[] = []): string {
  const jar = new Map<string, string>()
  for (const part of existing.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) jar.set(k, v.join('='))
  }
  for (const line of setCookie) {
    const first = line.split(';')[0] ?? ''
    const [k, ...v] = first.trim().split('=')
    if (k) jar.set(k, v.join('='))
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Low-level weapi POST. Returns the response status, decoded JSON body, the
 * Set-Cookie header lines, and the original cookie updated with any new values
 * (useful for keeping sessions alive).
 */
export async function weapiRequest<T = unknown>(
  path: string,
  payload: Record<string, unknown> = {},
  cookie = '',
  fp?: DeviceFingerprint,
  osOverride?: string,
): Promise<WeapiResult<T>> {
  const richCookie = buildRichCookie(cookie, fp, osOverride)
  const data = { ...payload, csrf_token: readCsrf(cookie) }
  const body = new URLSearchParams(
    weapi(data) as unknown as Record<string, string>,
  ).toString()
  const ip = fp?.ip ?? fallbackIP()
  const ua = fp?.ua ?? DEFAULT_UA
  const res = await axios.post<T>(`${BASE}/weapi${path}`, body, {
    ...baseAxiosOpts(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua,
      Referer: BASE,
      Origin: BASE,
      Cookie: richCookie || 'os=pc; appver=3.1.17.204416',
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
    },
  })
  const setCookie = res.headers['set-cookie'] ?? []
  return {
    status: res.status,
    data: res.data,
    cookies: setCookie,
    mergedCookie: cookie && setCookie.length ? mergeCookies(cookie, setCookie) : cookie,
  }
}

// ---------------------------------------------------------------------------
// High-level API helpers
// ---------------------------------------------------------------------------

/** Generate a login QR unikey. */
export async function qrKey(): Promise<string | undefined> {
  const { data } = await weapiRequest<{ unikey?: string }>('/login/qrcode/unikey', {
    type: 1,
  })
  return data.unikey
}

/** Build the QR image content URL for a unikey. */
export function qrUrl(key: string): string {
  return `https://music.163.com/login?codekey=${key}`
}

/**
 * Poll QR login status.
 * code: 800 expired, 801 waiting, 802 scanned (awaiting confirm), 803 success.
 * On 803 the returned `cookie` carries MUSIC_U / __csrf.
 */
export async function qrCheck(key: string): Promise<QrCheckResult> {
  const { data, cookies } = await weapiRequest<{
    code?: number
    message?: string
    nickname?: string
    avatarUrl?: string
  }>('/login/qrcode/client/login', { key, type: 1 })
  return {
    code: data.code,
    message: data.message,
    nickname: data.nickname,
    avatarUrl: data.avatarUrl,
    cookie: mergeCookies('', cookies),
  }
}

/** Fetch the logged-in account summary. */
export async function accountInfo(
  cookie: string,
  fp?: DeviceFingerprint,
): Promise<AccountInfo> {
  const { data } = await weapiRequest<AccountInfo>('/w/nuser/account/get', {}, cookie, fp)
  return data
}

/**
 * Lightweight session-validity check. Returns true if the cookie still carries
 * a valid login; false if the session has expired (code 301 or missing account).
 */
export async function checkSession(
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<boolean> {
  if (!cookie) return false
  try {
    const info = await accountInfo(cookie, fp)
    return !!(info.account?.id ?? info.profile?.userId)
  } catch {
    return false
  }
}

/** Fetch user detail (level, listenSongs count, profile). */
export async function userDetail(
  uid: number,
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<UserDetail> {
  const { data } = await weapiRequest<UserDetail>(
    `/v1/user/detail/${uid}`,
    {},
    cookie,
    fp,
  )
  return data
}

/**
 * Daily sign-in. type 0 = Android (3 points), type 1 = PC/web (2 points).
 * Returns the raw response; code 200 = success, -2 = already signed in today.
 * The `os` cookie must match the type: 'android' for type=0, 'pc' for type=1.
 */
export async function dailySignin(
  type: number,
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<SigninResponse> {
  const osOverride = type === 0 ? 'android' : 'pc'
  const { data } = await weapiRequest<SigninResponse>(
    '/point/dailyTask',
    { type },
    cookie,
    fp,
    osOverride,
  )
  return data
}

/** Fetch a playlist's full track id list (used as the scrobble song pool). */
export async function playlistDetail(
  id: number,
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<number[]> {
  const { data } = await weapiRequest<{ playlist?: { trackIds?: { id: number }[] } }>(
    '/v6/playlist/detail',
    { id, n: 1000, s: 0 },
    cookie,
    fp,
  )
  return (data.playlist?.trackIds ?? []).map((t) => t.id)
}

/**
 * Report a "play" event for a song, incrementing the account's listen count
 * (听歌量). `time` is the played duration in seconds.
 */
// Realistic variation in scrobble fields
const SCROBBLE_SOURCES = ['list', 'album', 'search', 'fmtrash', 'recommend', 'toplist']
const SCROBBLE_ENDS = ['playend', 'ui', 'interrupt', 'playend', 'playend', 'playend']

export async function scrobble(
  id: number,
  time: number,
  cookie: string | undefined,
  sourceId = '',
  fp?: DeviceFingerprint,
): Promise<{ code?: number; data?: unknown }> {
  const source = SCROBBLE_SOURCES[Math.floor(Math.random() * SCROBBLE_SOURCES.length)]!
  const end = SCROBBLE_ENDS[Math.floor(Math.random() * SCROBBLE_ENDS.length)]!
  const wifi = Math.random() > 0.3 ? 1 : 0
  const download = Math.random() > 0.85 ? 1 : 0
  const logs = JSON.stringify([
    {
      action: 'play',
      json: {
        download,
        end,
        id,
        sourceId,
        time,
        type: 'song',
        wifi,
        source,
        mainsite: 1,
        content: '',
      },
    },
  ])
  const { data } = await weapiRequest<{ code?: number; data?: unknown }>(
    '/feedback/weblog',
    { logs },
    cookie,
    fp,
  )
  return data
}

// ---------------------------------------------------------------------------
// Yunbei task-center APIs
// ---------------------------------------------------------------------------

/** Fetch all yunbei tasks (completed and incomplete). */
export async function yunbeiTasksTodo(
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<YunbeiTodoResponse> {
  const { data } = await weapiRequest<YunbeiTodoResponse>(
    '/usertool/task/todo/query',
    {},
    cookie,
    fp,
  )
  return data
}

/**
 * Claim a completed yunbei task reward.
 * Only works when userTaskId > 0 (the underlying action was already done).
 */
export async function yunbeiTaskFinish(
  userTaskId: number,
  depositCode: number,
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<NeteaseBase> {
  const { data } = await weapiRequest<NeteaseBase>(
    '/usertool/task/point/receive',
    { userTaskId, depositCode: depositCode || 0 },
    cookie,
    fp,
  )
  return data
}

/** Like / "collect" a song (adds to 我喜欢的音乐). */
export async function likeSong(
  trackId: number,
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<NeteaseBase> {
  const { data } = await weapiRequest<NeteaseBase>(
    '/radio/like',
    { alg: 'itembased', trackId, like: true, time: 25 },
    cookie,
    fp,
  )
  return data
}

// ---------------------------------------------------------------------------
// Music Partner (音乐合伙人) evaluation APIs
//
// These live on the `interface.music.163.com` host and are gated behind the
// "音乐合伙人" qualification (NetEase invites a subset of users). Endpoints:
//   GET  /api/music/partner/daily/task/get               -> base daily works
//   GET  /api/music/partner/extra/wait/evaluate/work/list -> bonus works
//   POST /weapi/partner/resource/interact/report          -> report a listen
//   POST /weapi/music/partner/work/evaluate               -> submit a rating
// ---------------------------------------------------------------------------

const MP_BASE = 'https://interface.music.163.com'
const MP_REFERER = 'https://mp.music.163.com/'
const MP_ORIGIN = 'https://mp.music.163.com'

/** Authenticated GET against the music-partner interface host. */
async function mpGet<T>(
  path: string,
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<T> {
  const ip = fp?.ip ?? fallbackIP()
  const ua = fp?.ua ?? DEFAULT_UA
  const richCookie = buildRichCookie(cookie || '', fp)
  const res = await axios.get<T>(`${MP_BASE}${path}`, {
    ...baseAxiosOpts(),
    headers: {
      'User-Agent': ua,
      Referer: MP_REFERER,
      Origin: MP_ORIGIN,
      Cookie: richCookie || 'os=pc; appver=3.1.17.204416',
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
    },
  })
  return res.data
}

/** weapi POST against the music-partner host (csrf carried in body + query). */
async function mpWeapiPost<T>(
  path: string,
  payload: Record<string, unknown>,
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<T> {
  const csrf = readCsrf(cookie)
  const body = new URLSearchParams(
    weapi({ ...payload, csrf_token: csrf }) as unknown as Record<string, string>,
  ).toString()
  const ip = fp?.ip ?? fallbackIP()
  const ua = fp?.ua ?? DEFAULT_UA
  const richCookie = buildRichCookie(cookie || '', fp)
  const res = await axios.post<T>(`${MP_BASE}/weapi${path}?csrf_token=${csrf}`, body, {
    ...baseAxiosOpts(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua,
      Referer: MP_REFERER,
      Origin: MP_ORIGIN,
      Cookie: richCookie || 'os=pc; appver=3.1.17.204416',
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
    },
  })
  return res.data
}

/** Fetch the daily music-partner evaluation tasks (the base works of the day). */
export async function partnerDailyTasks(
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<PartnerDailyResponse> {
  return mpGet<PartnerDailyResponse>('/api/music/partner/daily/task/get', cookie, fp)
}

/** Fetch the extra "waiting to evaluate" work list (bonus works). */
export async function partnerExtraTasks(
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<PartnerExtraResponse> {
  return mpGet<PartnerExtraResponse>(
    '/api/music/partner/extra/wait/evaluate/work/list',
    cookie,
    fp,
  )
}

/** Report a "listen end" interaction for an extra work (required before extra evaluate). */
export async function partnerReportListen(
  { workId, resourceId }: { workId: number; resourceId?: string },
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<NeteaseBase> {
  return mpWeapiPost<NeteaseBase>(
    '/partner/resource/interact/report',
    { workId, resourceId, bizResourceId: '', interactType: 'PLAY_END' },
    cookie,
    fp,
  )
}

/**
 * Submit a music-partner evaluation.
 * `score` is an integer 1-5; `extra` marks a bonus (extra) work.
 * code 200 = success; 405 + "资格状态异常" = no qualification / resource issue.
 */
export async function partnerEvaluate(
  {
    taskId,
    workId,
    score,
    extra = false,
  }: { taskId?: number; workId: number; score: number; extra?: boolean },
  cookie: string | undefined,
  fp?: DeviceFingerprint,
): Promise<NeteaseBase> {
  const s = String(score)
  const payload: Record<string, unknown> = {
    taskId: String(taskId ?? ''),
    workId: String(workId),
    score: s,
    tags: `${s}-A-1`,
    customTags: '%5B%5D',
    comment: '',
    syncYunCircle: 'true',
  }
  if (extra) payload.extraResource = 'true'
  return mpWeapiPost<NeteaseBase>('/music/partner/work/evaluate', payload, cookie, fp)
}
