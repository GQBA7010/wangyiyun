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
 * Low-level weapi POST. Returns { status, data, cookies } where `cookies` is
 * the array of Set-Cookie header lines from the response.
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
  return {
    status: res.status,
    data: res.data,
    cookies: res.headers['set-cookie'] || [],
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
