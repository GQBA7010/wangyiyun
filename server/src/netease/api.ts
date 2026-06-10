import axios from 'axios'
import { weapi } from './crypto.js'

const BASE = 'https://music.163.com'

const DESKTOP_UA =
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
  profile?: { nickname?: string; avatarUrl?: string }
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

function randomIP(): string {
  // A randomized China-region IPv4 used as X-Real-IP, mirroring the behaviour
  // of common NetEase api wrappers to reduce risk of region/anti-abuse blocks.
  return `116.25.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
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
): Promise<WeapiResult<T>> {
  const data = { ...payload, csrf_token: readCsrf(cookie) }
  const body = new URLSearchParams(
    weapi(data) as unknown as Record<string, string>,
  ).toString()
  const ip = randomIP()
  const res = await axios.post<T>(`${BASE}/weapi${path}`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': DESKTOP_UA,
      Referer: BASE,
      Origin: BASE,
      Cookie: cookie || 'os=pc; appver=2.9.7',
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
    },
    timeout: 15000,
    validateStatus: () => true,
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
export async function accountInfo(cookie: string): Promise<AccountInfo> {
  const { data } = await weapiRequest<AccountInfo>('/w/nuser/account/get', {}, cookie)
  return data
}

/**
 * Lightweight session-validity check. Returns true if the cookie still carries
 * a valid login; false if the session has expired (code 301 or missing account).
 */
export async function checkSession(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false
  try {
    const info = await accountInfo(cookie)
    return !!(info.account?.id ?? info.profile?.userId)
  } catch {
    return false
  }
}

/** Fetch user detail (level, listenSongs count, profile). */
export async function userDetail(
  uid: number,
  cookie: string | undefined,
): Promise<UserDetail> {
  const { data } = await weapiRequest<UserDetail>(`/v1/user/detail/${uid}`, {}, cookie)
  return data
}

/**
 * Daily sign-in. type 0 = PC/web, type 1 = mobile. Returns the raw response;
 * code 200 = success, -2 = already signed in today.
 */
export async function dailySignin(
  type: number,
  cookie: string | undefined,
): Promise<SigninResponse> {
  const { data } = await weapiRequest<SigninResponse>(
    '/point/dailyTask',
    { type },
    cookie,
  )
  return data
}

/** Fetch a playlist's full track id list (used as the scrobble song pool). */
export async function playlistDetail(
  id: number,
  cookie: string | undefined,
): Promise<number[]> {
  const { data } = await weapiRequest<{ playlist?: { trackIds?: { id: number }[] } }>(
    '/v6/playlist/detail',
    { id, n: 1000, s: 0 },
    cookie,
  )
  return (data.playlist?.trackIds ?? []).map((t) => t.id)
}

/**
 * Report a "play" event for a song, incrementing the account's listen count
 * (听歌量). `time` is the played duration in seconds.
 */
export async function scrobble(
  id: number,
  time: number,
  cookie: string | undefined,
  sourceId = '',
): Promise<{ code?: number; data?: unknown }> {
  const logs = JSON.stringify([
    {
      action: 'play',
      json: {
        download: 0,
        end: 'playend',
        id,
        sourceId,
        time,
        type: 'song',
        wifi: 0,
        source: 'list',
      },
    },
  ])
  const { data } = await weapiRequest<{ code?: number; data?: unknown }>(
    '/feedback/weblog',
    { logs },
    cookie,
  )
  return data
}

// ---------------------------------------------------------------------------
// Yunbei task-center APIs
// ---------------------------------------------------------------------------

/** Fetch all yunbei tasks (completed and incomplete). */
export async function yunbeiTasksTodo(
  cookie: string | undefined,
): Promise<YunbeiTodoResponse> {
  const { data } = await weapiRequest<YunbeiTodoResponse>(
    '/usertool/task/todo/query',
    {},
    cookie,
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
): Promise<NeteaseBase> {
  const { data } = await weapiRequest<NeteaseBase>(
    '/usertool/task/point/receive',
    { userTaskId, depositCode: depositCode || 0 },
    cookie,
  )
  return data
}

/** Like / "collect" a song (adds to 我喜欢的音乐). */
export async function likeSong(
  trackId: number,
  cookie: string | undefined,
): Promise<NeteaseBase> {
  const { data } = await weapiRequest<NeteaseBase>(
    '/radio/like',
    { alg: 'itembased', trackId, like: true, time: 25 },
    cookie,
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
async function mpGet<T>(path: string, cookie: string | undefined): Promise<T> {
  const ip = randomIP()
  const res = await axios.get<T>(`${MP_BASE}${path}`, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: MP_REFERER,
      Origin: MP_ORIGIN,
      Cookie: cookie || 'os=pc; appver=2.9.7',
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
    },
    timeout: 15000,
    validateStatus: () => true,
  })
  return res.data
}

/** weapi POST against the music-partner host (csrf carried in body + query). */
async function mpWeapiPost<T>(
  path: string,
  payload: Record<string, unknown>,
  cookie: string | undefined,
): Promise<T> {
  const csrf = readCsrf(cookie)
  const body = new URLSearchParams(
    weapi({ ...payload, csrf_token: csrf }) as unknown as Record<string, string>,
  ).toString()
  const ip = randomIP()
  const res = await axios.post<T>(`${MP_BASE}/weapi${path}?csrf_token=${csrf}`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': DESKTOP_UA,
      Referer: MP_REFERER,
      Origin: MP_ORIGIN,
      Cookie: cookie || 'os=pc; appver=2.9.7',
      'X-Real-IP': ip,
      'X-Forwarded-For': ip,
    },
    timeout: 15000,
    validateStatus: () => true,
  })
  return res.data
}

/** Fetch the daily music-partner evaluation tasks (the base works of the day). */
export async function partnerDailyTasks(
  cookie: string | undefined,
): Promise<PartnerDailyResponse> {
  return mpGet<PartnerDailyResponse>('/api/music/partner/daily/task/get', cookie)
}

/** Fetch the extra "waiting to evaluate" work list (bonus works). */
export async function partnerExtraTasks(
  cookie: string | undefined,
): Promise<PartnerExtraResponse> {
  return mpGet<PartnerExtraResponse>(
    '/api/music/partner/extra/wait/evaluate/work/list',
    cookie,
  )
}

/** Report a "listen end" interaction for an extra work (required before extra evaluate). */
export async function partnerReportListen(
  { workId, resourceId }: { workId: number; resourceId?: string },
  cookie: string | undefined,
): Promise<NeteaseBase> {
  return mpWeapiPost<NeteaseBase>(
    '/partner/resource/interact/report',
    { workId, resourceId, bizResourceId: '', interactType: 'PLAY_END' },
    cookie,
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
  return mpWeapiPost<NeteaseBase>('/music/partner/work/evaluate', payload, cookie)
}
