import axios from 'axios'
import { weapi } from './crypto.js'

const BASE = 'https://music.163.com'

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function randomIP() {
  // A randomized China-region IPv4 used as X-Real-IP, mirroring the behaviour
  // of common NetEase api wrappers to reduce risk of region/anti-abuse blocks.
  return `116.25.${Math.floor(Math.random() * 256)}.${Math.floor(
    Math.random() * 256,
  )}`
}

function readCsrf(cookie = '') {
  const m = cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)
  return m ? m[1] : ''
}

/** Merge incoming Set-Cookie headers into an existing cookie string. */
export function mergeCookies(existing = '', setCookie = []) {
  const jar = new Map()
  for (const part of existing.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k) jar.set(k, v.join('='))
  }
  for (const line of setCookie) {
    const first = line.split(';')[0]
    const [k, ...v] = first.trim().split('=')
    if (k) jar.set(k, v.join('='))
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}

/**
 * Low-level weapi POST. Returns { status, data, cookies, mergedCookie } where
 * `cookies` is the array of Set-Cookie header lines from the response and
 * `mergedCookie` is the original cookie updated with any new values from the
 * response (useful for keeping sessions alive).
 */
export async function weapiRequest(path, payload = {}, cookie = '') {
  const data = { ...payload, csrf_token: readCsrf(cookie) }
  const body = new URLSearchParams(weapi(data)).toString()
  const ip = randomIP()
  const res = await axios.post(`${BASE}/weapi${path}`, body, {
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
  const setCookie = res.headers['set-cookie'] || []
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
export async function qrKey() {
  const { data } = await weapiRequest('/login/qrcode/unikey', { type: 1 })
  return data?.unikey
}

/** Build the QR image content URL for a unikey. */
export function qrUrl(key) {
  return `https://music.163.com/login?codekey=${key}`
}

/**
 * Poll QR login status.
 * code: 800 expired, 801 waiting, 802 scanned (awaiting confirm), 803 success.
 * On 803 the returned `cookie` carries MUSIC_U / __csrf.
 */
export async function qrCheck(key) {
  const { data, cookies } = await weapiRequest('/login/qrcode/client/login', {
    key,
    type: 1,
  })
  return {
    code: data?.code,
    message: data?.message,
    nickname: data?.nickname,
    avatarUrl: data?.avatarUrl,
    cookie: mergeCookies('', cookies),
  }
}

/** Fetch the logged-in account summary. */
export async function accountInfo(cookie) {
  const { data } = await weapiRequest('/w/nuser/account/get', {}, cookie)
  return data
}

/**
 * Lightweight session-validity check. Returns true if the cookie still
 * carries a valid login; false if the session has expired (code 301 or
 * missing account).
 */
export async function checkSession(cookie) {
  try {
    const info = await accountInfo(cookie)
    return !!(info?.account?.id || info?.profile?.userId)
  } catch {
    return false
  }
}

/** Fetch user detail (level, listenSongs count, profile). */
export async function userDetail(uid, cookie) {
  const { data } = await weapiRequest(`/v1/user/detail/${uid}`, {}, cookie)
  return data
}

/**
 * Daily sign-in. type 0 = PC/web, type 1 = mobile. Returns the raw response;
 * code 200 = success, -2 = already signed in today.
 */
export async function dailySignin(type, cookie) {
  const { data } = await weapiRequest('/point/dailyTask', { type }, cookie)
  return data
}

/** Fetch a playlist's full track id list (used as the scrobble song pool). */
export async function playlistDetail(id, cookie) {
  const { data } = await weapiRequest(
    '/v6/playlist/detail',
    { id, n: 1000, s: 0 },
    cookie,
  )
  const ids = (data?.playlist?.trackIds || []).map((t) => t.id)
  return ids
}

/**
 * Report a "play" event for a song, incrementing the account's listen count
 * (听歌量). `time` is the played duration in seconds.
 */
export async function scrobble(id, time, cookie, sourceId = '') {
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
  const { data } = await weapiRequest('/feedback/weblog', { logs }, cookie)
  return data
}

// ---------------------------------------------------------------------------
// Yunbei task-center APIs
// ---------------------------------------------------------------------------

/** Fetch all yunbei tasks (completed and incomplete). */
export async function yunbeiTasksTodo(cookie) {
  const { data } = await weapiRequest(
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
export async function yunbeiTaskFinish(userTaskId, depositCode, cookie) {
  const { data } = await weapiRequest('/usertool/task/point/receive', {
    userTaskId,
    depositCode: depositCode || 0,
  }, cookie)
  return data
}

/** Like / "collect" a song (adds to 我喜欢的音乐). */
export async function likeSong(trackId, cookie) {
  const { data } = await weapiRequest('/radio/like', {
    alg: 'itembased',
    trackId,
    like: true,
    time: 25,
  }, cookie)
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
async function mpGet(path, cookie) {
  const ip = randomIP()
  const res = await axios.get(`${MP_BASE}${path}`, {
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
async function mpWeapiPost(path, payload, cookie) {
  const csrf = readCsrf(cookie)
  const body = new URLSearchParams(weapi({ ...payload, csrf_token: csrf })).toString()
  const ip = randomIP()
  const res = await axios.post(`${MP_BASE}/weapi${path}?csrf_token=${csrf}`, body, {
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
export async function partnerDailyTasks(cookie) {
  return mpGet('/api/music/partner/daily/task/get', cookie)
}

/** Fetch the extra "waiting to evaluate" work list (bonus works). */
export async function partnerExtraTasks(cookie) {
  return mpGet('/api/music/partner/extra/wait/evaluate/work/list', cookie)
}

/** Report a "listen end" interaction for an extra work (required before extra evaluate). */
export async function partnerReportListen({ workId, resourceId }, cookie) {
  return mpWeapiPost('/partner/resource/interact/report', {
    workId,
    resourceId,
    bizResourceId: '',
    interactType: 'PLAY_END',
  }, cookie)
}

/**
 * Submit a music-partner evaluation.
 * `score` is an integer 1-5; `extra` marks a bonus (extra) work.
 * code 200 = success; 405 + "资格状态异常" = no qualification / resource issue.
 */
export async function partnerEvaluate({ taskId, workId, score, extra = false }, cookie) {
  const s = String(score)
  const payload = {
    taskId: String(taskId ?? ''),
    workId: String(workId),
    score: s,
    tags: `${s}-A-1`,
    customTags: '%5B%5D',
    comment: '',
    syncYunCircle: 'true',
  }
  if (extra) payload.extraResource = 'true'
  return mpWeapiPost('/music/partner/work/evaluate', payload, cookie)
}
